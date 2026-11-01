import { cents } from "./rules";
import type { Procurement } from "./types";
function rows(text: string) {
  const records: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c.trim())) records.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted value.");
  if (cell || row.length) {
    row.push(cell);
    records.push(row);
  }
  const headers = (records.shift() || []).map((h) =>
    h.replace(/^\uFEFF/, "").trim(),
  );
  return records.map((r, i) => {
    if (r.length !== headers.length)
      throw new Error(
        `CSV row ${i + 2} has ${r.length} fields; expected ${headers.length}.`,
      );
    return Object.fromEntries(headers.map((h, n) => [h, r[n].trim()]));
  });
}
function cash(v: string, location: string) {
  const n = cents(v);
  if (n === null || n < 0)
    throw new Error(`${location}: invalid or missing amount.`);
  return n;
}
export async function importCSVs(
  files: File[],
): Promise<Omit<Procurement, "version" | "importedAt">> {
  const entries = await Promise.all(
    files.map(
      async (f) => [f.name.toLowerCase(), rows(await f.text())] as const,
    ),
  );
  const get = (name: string) => {
    const e = entries.find((e) => e[0] === name);
    if (!e) throw new Error(`Select all four CSVs together. Missing ${name}.`);
    return e[1];
  };
  const vendors = get("vendors.csv").map((r, i) => {
    if (!["true", "false"].includes(r.active))
      throw new Error(
        `vendors.csv row ${i + 2}: active must be true or false.`,
      );
    return {
      id: r.vendor_id,
      name: r.legal_name,
      aliases: r.approved_alias ? [r.approved_alias] : [],
      active: r.active === "true",
      currency: r.currency,
    };
  });
  const lines = get("po_lines.csv");
  const pos = get("purchase_orders.csv").map((r, i) => ({
    id: r.po_id,
    vendorId: r.vendor_id,
    entity: r.entity_id,
    currency: r.currency,
    cap: cash(r.approved_net_cap, `purchase_orders.csv row ${i + 2}`),
    status: r.status as "open" | "closed",
    method: r.matching_method as "two_way" | "three_way",
    project: r.project,
    lines: lines
      .filter((l) => l.po_id === r.po_id)
      .map((l) => ({
        id: l.line_id,
        description: l.description,
        kind: l.kind as "amount_cap" | "quantity" | "milestone",
        cap: cash(l.approved_net_cap, `PO ${r.po_id} line ${l.line_id}`),
        quantity: l.quantity || undefined,
        unitPrice: l.unit_price
          ? cash(l.unit_price, `PO ${r.po_id} unit price`)
          : undefined,
        period: l.service_period || undefined,
      })),
  }));
  const commitments = get("prior_commitments.csv").map((r, i) => ({
    id: r.external_obligation_id,
    entity: r.entity_id,
    vendorId: r.vendor_id,
    reference: r.invoice_reference,
    date: r.invoice_date,
    currency: r.currency,
    net: cash(r.net_amount, `prior_commitments.csv row ${i + 2}`),
    gross: cash(r.gross_amount, `prior_commitments.csv row ${i + 2}`),
    poId: r.po_id,
    lineId: r.line_id,
    period: r.service_period || undefined,
    quantity: r.quantity || undefined,
  }));
  return { vendors, pos, commitments };
}
