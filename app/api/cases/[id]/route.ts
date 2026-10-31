import {
  identity,
  readWorkspace,
  mutate,
  jsonError,
  AppError,
} from "../../../../lib/folio/store";
import { extractionSchema } from "../../../../lib/folio/validation";
import { evaluate, latest } from "../../../../lib/folio/rules";
import { STAGES, type Stage } from "../../../../lib/folio/types";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity();
    const { id } = await params;
    const { state } = await readWorkspace(user.userId);
    const c = state.cases.find((c) => c.id === id);
    if (!c) throw new AppError("Invoice not found.", 404);
    return Response.json(c);
  } catch (e) {
    return jsonError(e);
  }
}
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity();
    const { id } = await params;
    const body = (await req.json()) as {
      action: string;
      expectedRevision?: number;
      stage: "read" | "extract";
      status: "running" | "done";
      message: string;
      retry?: boolean;
      error?: string;
      reason: string;
      extraction: unknown;
      selectedPo?: string;
      selectedLine?: string;
    };
    const result = await mutate(user.userId, (s) => {
      const c = s.cases.find((c) => c.id === id);
      if (!c) throw new AppError("Invoice not found.", 404);
      if (
        body.expectedRevision !== undefined &&
        c.decisions.length !== body.expectedRevision
      )
        throw new AppError(
          "This invoice has a newer decision. Reload it before making a change.",
          409,
        );
      const event = (
        stage: Stage,
        status: "done" | "running" | "failed",
        message: string,
      ) => {
        c.events.push({
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          stage,
          status,
          message: message.slice(0, 300),
        });
        if (c.events.length > 80) c.events = c.events.slice(-80);
      };
      if (body.action === "stage") {
        if (
          !["read", "extract"].includes(body.stage) ||
          !["running", "done"].includes(body.status) ||
          typeof body.message !== "string"
        )
          throw new AppError("Invalid extraction stage.");
        if (c.decisions.length && !body.retry) return { id: c.id };
        c.status = "processing";
        c.error = undefined;
        event(body.stage, body.status, body.message);
        return { id: c.id };
      }
      if (body.action === "failure") {
        c.status = "failed";
        c.error = String(body.error || "Extraction did not finish.").slice(
          0,
          300,
        );
        event("extract", "failed", c.error);
        return { id: c.id };
      }
      if (body.action === "void") {
        if (typeof body.reason !== "string" || body.reason.trim().length < 5)
          throw new AppError(
            "Explain why this local reservation should be released.",
          );
        c.voided = {
          reason: body.reason.trim(),
          actor: user.email,
          at: new Date().toISOString(),
        };
        event(
          "record",
          "done",
          `Case voided by ${user.email}: ${body.reason.trim()}. Any local reservation is released.`,
        );
        return { id: c.id };
      }
      if (c.voided)
        throw new AppError(
          "This case has been voided. Its history is preserved and cannot be cleared again.",
        );
      if (body.action === "extract") {
        if (c.extraction && c.decisions.length)
          throw new AppError(
            "This invoice already has an extraction. Use source correction to preserve its history.",
            409,
          );
        const data = extractionSchema.safeParse(body.extraction);
        if (!data.success)
          throw new AppError(
            "Extracted document data is invalid or exceeds the supported page and field limits.",
          );
        c.extraction = data.data;
        for (const field of Object.values(c.extraction.fields))
          field.confirmed = false;
        for (const line of c.extraction.lines) line.confirmed = false;
        c.extraction.confirmedAt = undefined;
        c.extraction.confirmedBy = undefined;
        c.pageCount = c.extraction.pages.length;
        event(
          "extract",
          "done",
          `${c.extraction.method === "native" ? "Native PDF text" : "Local OCR"} extraction completed; ${c.pageCount} page(s). Fields remain unscored until source confirmation.`,
        );
      } else if (body.action === "correct") {
        if (!c.extraction) throw new AppError("Read the document first.");
        if (typeof body.reason !== "string" || body.reason.trim().length < 5)
          throw new AppError("Add a source confirmation or correction reason.");
        const parsed = extractionSchema.safeParse(body.extraction);
        if (!parsed.success)
          throw new AppError("The corrected invoice fields are invalid.");
        // Preserve the original source data and scope flags. Only user-confirmed
        // field values and line mappings can change through this action.
        c.extraction = {
          ...c.extraction,
          fields: parsed.data.fields,
          lines: parsed.data.lines,
          confirmedAt: new Date().toISOString(),
          confirmedBy: user.email,
        };
        for (const field of Object.values(c.extraction.fields))
          field.confirmed = true;
        for (const line of c.extraction.lines) line.confirmed = true;
        const validSourceIds = new Set(c.extraction.sources.map((x) => x.id));
        for (const field of Object.values(c.extraction.fields))
          if (field.sourceId && !validSourceIds.has(field.sourceId))
            field.sourceId = undefined;
        c.selectedPo =
          typeof body.selectedPo === "string" ? body.selectedPo : undefined;
        c.selectedLine =
          typeof body.selectedLine === "string" ? body.selectedLine : undefined;
        c.mappingConfirmed = !!c.selectedPo;
        // A correction invalidates a previous near-duplicate resolution.
        c.duplicateResolution = undefined;
        event(
          "validate",
          "done",
          `Source values confirmed by ${user.email}. Reason: ${body.reason.trim()}`,
        );
      } else if (body.action === "distinct") {
        if (
          !c.extraction ||
          !latest(c)?.checks.some(
            (k) => k.id === "duplicate" && k.status === "review",
          )
        )
          throw new AppError(
            "There is no possible-duplicate review to resolve.",
          );
        if (typeof body.reason !== "string" || body.reason.trim().length < 15)
          throw new AppError(
            "Document why this is a distinct obligation (at least 15 characters).",
          );
        c.duplicateResolution = {
          reason: body.reason.trim(),
          actor: user.email,
          at: new Date().toISOString(),
        };
      } else if (body.action !== "recheck")
        throw new AppError("Unsupported invoice action.");
      if (!c.extraction)
        throw new AppError("This invoice has not been extracted.");
      if (c.decisions.length >= 20)
        throw new AppError(
          "This prototype retains up to 20 decision revisions per invoice.",
        );
      event(
        "validate",
        "done",
        "Required fields, buyer, dates, arithmetic and duplicate obligations checked.",
      );
      event(
        "match",
        "done",
        "Explicit PO and supported line mappings compared with the current procurement dataset.",
      );
      const decision = evaluate(
        s,
        c,
        user.email,
        String(body.reason || "Initial invoice checks"),
      );
      event(
        "policy",
        "done",
        `${decision.checks.length} controls evaluated against policy ${decision.policy}; current PO commitments included.`,
      );
      c.decisions.push(decision);
      c.status = "completed";
      c.error = undefined;
      event(
        "record",
        "done",
        `Decision revision ${decision.revision} saved. ${decision.outcome === "ready" ? "Net capacity reserved once." : "No local capacity reserved."}`,
      );
      return { id: c.id, decisionId: decision.id };
    });
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
