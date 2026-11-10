import { extractionSchema, procurementSchema } from "./validation";
import { cents, entityId, evaluate, latest, safeRef } from "./rules";
import type { InvoiceCase, Stage, Workspace } from "./types";

export type OriginalDocument = { key: string; bytes: ArrayBuffer };
export type WorkspaceStorage = {
  readWorkspace(owner: string): Promise<{ revision: number; state: Workspace }>;
  mutate<T>(
    owner: string,
    change: (state: Workspace) => T,
    original?: OriginalDocument,
  ): Promise<{ state: Workspace; result: T }>;
  readDocument(key: string): Promise<BodyInit | null>;
};

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export function jsonError(error: unknown) {
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Folio request failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  return Response.json(
    {
      error:
        "The operation could not finish. Your saved records are still available. Please retry.",
    },
    { status: 500 },
  );
}

export function encodeWorkspace(state: Workspace) {
  const encoded = JSON.stringify(state);
  if (new TextEncoder().encode(encoded).length > 1500000)
    throw new AppError(
      "This prototype workspace has reached its history limit. Export the receipts before starting a new workspace.",
      413,
    );
  return encoded;
}

export function createWorkspaceApi(
  { readWorkspace, mutate, readDocument }: WorkspaceStorage,
  identity: () => Promise<{
    userId: string;
    email: string;
    displayName: string;
  }>,
) {
  async function getWorkspace() {
    try {
      const user = await identity();
      const data = await readWorkspace(user.userId);
      return Response.json({
        ...data,
        user: { name: user.displayName, email: user.email },
      });
    } catch (e) {
      return jsonError(e);
    }
  }
  async function updateWorkspace(req: Request) {
    try {
      const user = await identity();
      const body = (await req.json()) as {
        action: string;
        cap?: string;
        reason: string;
        poId?: string;
        data?: unknown;
      };
      if (body.action === "amend") {
        const cap = cents(String(body.cap));
        if (
          cap === null ||
          cap < 0 ||
          typeof body.reason !== "string" ||
          body.reason.trim().length < 5
        )
          throw new AppError(
            "Provide a valid cap and the authorization reason.",
          );
        const changed = await mutate(user.userId, (s) => {
          const po = s.procurement.pos.find((p) => p.id === body.poId);
          if (!po) throw new AppError("PO not found.", 404);
          if (po.lines.length !== 1)
            throw new AppError(
              "Amend multi-line purchases through a validated data import.",
            );
          const previousCap = po.cap;
          po.cap = cap;
          po.lines[0].cap = cap;
          s.procurement.version++;
          s.procurement.importedAt = new Date().toISOString();
          s.procurement.amendments ??= [];
          s.procurement.amendments.push({
            poId: po.id,
            previousCap,
            newCap: cap,
            reason: body.reason.trim(),
            actor: user.email,
            at: s.procurement.importedAt,
            version: s.procurement.version,
          });
          return {
            poId: po.id,
            cap,
            reason: body.reason.trim(),
            actor: user.email,
          };
        });
        return Response.json(changed);
      }
      if (body.action === "import") {
        const parsed = procurementSchema.safeParse(body.data);
        if (!parsed.success)
          throw new AppError(
            parsed.error.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; "),
          );
        const data = parsed.data;
        const unique = (v: string[]) => new Set(v).size === v.length;
        const names = new Map<string, string>();
        for (const vendor of data.vendors)
          for (const name of [vendor.name, ...vendor.aliases]) {
            const key = name.trim().toLowerCase().replace(/\s+/g, " ");
            if (names.has(key) && names.get(key) !== vendor.id)
              throw new AppError(
                `Supplier name or alias ${name} is ambiguous across vendor IDs.`,
              );
            names.set(key, vendor.id);
          }
        if (
          !unique(data.vendors.map((v) => v.id)) ||
          !unique(data.pos.map((p) => p.id)) ||
          !unique(data.commitments.map((c) => c.id)) ||
          !unique(
            data.commitments.map(
              (c) => `${c.vendorId}|${safeRef(c.reference)}`,
            ),
          )
        )
          throw new AppError(
            "The import contains duplicate IDs or invoice identities.",
          );
        for (const po of data.pos) {
          if (
            !data.vendors.some((v) => v.id === po.vendorId) ||
            !unique(po.lines.map((l) => l.id))
          )
            throw new AppError(
              `PO ${po.id}: unknown vendor or duplicate line ID.`,
            );
        }
        for (const c of data.commitments) {
          const po = data.pos.find((p) => p.id === c.poId);
          if (
            !po ||
            po.vendorId !== c.vendorId ||
            po.currency !== c.currency ||
            entityId(po.entity) !== entityId(c.entity) ||
            !po.lines.some((l) => l.id === c.lineId)
          )
            throw new AppError(
              `Commitment ${c.id}: supplier, buyer, currency, PO or line does not match.`,
            );
        }
        const canonical = (items: { id: string }[]) =>
          JSON.stringify(
            [...items]
              .sort((a, b) => a.id.localeCompare(b.id))
              .map((c) =>
                Object.entries(c)
                  .filter(([, v]) => v !== undefined)
                  .sort(([a], [b]) => a.localeCompare(b)),
              ),
          );
        const changed = await mutate(user.userId, (s) => {
          if (
            s.cases.length &&
            canonical(data.commitments) !== canonical(s.procurement.commitments)
          )
            throw new AppError(
              "Prior commitments are fixed once invoices exist. Import the same baseline or start a separate workspace to avoid double counting.",
            );
          s.procurement = {
            ...data,
            amendments: s.procurement.amendments,
            version: s.procurement.version + 1,
            importedAt: new Date().toISOString(),
          };
          return { version: s.procurement.version };
        });
        return Response.json(changed);
      }
      if (body.action === "export")
        return Response.json((await readWorkspace(user.userId)).state);
      throw new AppError("Unsupported workspace action.");
    } catch (e) {
      return jsonError(e);
    }
  }
  async function getCase(id: string) {
    try {
      const user = await identity();
      const { state } = await readWorkspace(user.userId);
      const c = state.cases.find((c) => c.id === id);
      if (!c) throw new AppError("Invoice not found.", 404);
      return Response.json(c);
    } catch (e) {
      return jsonError(e);
    }
  }
  async function updateCase(req: Request, id: string) {
    try {
      const user = await identity();
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
            throw new AppError(
              "Add a source confirmation or correction reason.",
            );
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
            typeof body.selectedLine === "string"
              ? body.selectedLine
              : undefined;
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
  async function uploadDocument(req: Request) {
    try {
      const user = await identity();
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw new AppError("Choose a PDF invoice.");
      if (file.size > 10 * 1024 * 1024)
        throw new AppError("PDFs must be 10 MB or smaller.", 413);
      const bytes = await file.arrayBuffer();
      if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
        throw new AppError("The selected file is not a PDF.");
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
        (v) => v.toString(16).padStart(2, "0"),
      ).join("");
      const id = crypto.randomUUID();
      const fileKey = `${user.userId}/${hash}.pdf`;
      const result = await mutate(
        user.userId,
        (s) => {
          const old = s.cases.find((c) => c.hash === hash);
          if (old) return { id: old.id, existing: true };
          if (s.cases.length >= 60)
            throw new AppError(
              "This prototype workspace supports 60 invoices. Export your history before opening a new workspace.",
              413,
            );
          const now = new Date().toISOString();
          const c: InvoiceCase = {
            id,
            hash,
            filename: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150),
            fileKey,
            createdAt: now,
            status: "uploaded",
            decisions: [],
            events: [
              {
                id: crypto.randomUUID(),
                at: now,
                stage: "received",
                status: "done",
                message: `PDF received. ${file.size.toLocaleString()} bytes; content hash recorded.`,
              },
            ],
          };
          s.cases.unshift(c);
          return { id, existing: false };
        },
        { key: fileKey, bytes },
      );
      return Response.json(result);
    } catch (e) {
      return jsonError(e);
    }
  }
  async function getDocument(id: string) {
    try {
      const user = await identity();
      const { state } = await readWorkspace(user.userId);
      const c = state.cases.find((c) => c.id === id);
      if (!c) throw new AppError("Invoice not found.", 404);
      const file = await readDocument(c.fileKey);
      if (!file)
        throw new AppError("The original document is unavailable.", 404);
      return new Response(file, {
        headers: {
          "Content-Type": "application/pdf",
          "Content-Disposition": `inline; filename="${c.filename}"`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (e) {
      return jsonError(e);
    }
  }

  return {
    getWorkspace,
    updateWorkspace,
    getCase,
    updateCase,
    uploadDocument,
    getDocument,
  };
}
