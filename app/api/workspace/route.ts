import {
  identity,
  readWorkspace,
  mutate,
  jsonError,
  AppError,
} from "../../../lib/folio/store";
import { procurementSchema } from "../../../lib/folio/validation";
import { cents, latest, safeRef } from "../../../lib/folio/rules";
export async function GET() {
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
export async function POST(req: Request) {
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
        throw new AppError("Provide a valid cap and the authorization reason.");
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
          data.commitments.map((c) => `${c.vendorId}|${safeRef(c.reference)}`),
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
          !po.lines.some((l) => l.id === c.lineId)
        )
          throw new AppError(
            `Commitment ${c.id}: supplier, PO or line does not match.`,
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
