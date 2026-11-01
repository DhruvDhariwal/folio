import type { Extraction, Field, FieldKey, SourceLine, Vendor } from "./types";
import { cents, decimal, simple } from "./rules";

export function parseInvoice(
  sources: SourceLine[],
  pages: Extraction["pages"],
  method: Extraction["method"],
  vendors: Vendor[],
): Extraction {
  const keys: FieldKey[] = [
    "vendor",
    "entity",
    "reference",
    "date",
    "currency",
    "po",
    "net",
    "tax",
    "total",
    "servicePeriod",
    "fees",
    "discount",
  ];
  const fields = Object.fromEntries(
    keys.map((k) => [k, { value: "", confirmed: false }]),
  ) as Record<FieldKey, Field>;
  const find = (key: FieldKey, pattern: RegExp) => {
    for (const l of sources) {
      const m = l.text.trim().match(pattern);
      if (m) {
        fields[key] = { value: m[1].trim(), sourceId: l.id, confirmed: false };
        return;
      }
    }
  };
  find("vendor", /^(?:vendor(?: name)?|supplier(?: name)?)\s*[:\-]\s*(.+)$/i);
  if (/^(?:recipient|buyer|bill to)\s*:/i.test(fields.vendor.value))
    fields.vendor = { value: "", confirmed: false };
  if (!fields.vendor.value) {
    const found = sources.find((l) =>
      vendors.some((v) =>
        [v.name, ...v.aliases].some((n) => simple(n) === simple(l.text)),
      ),
    );
    if (found)
      fields.vendor = {
        value: found.text.trim(),
        sourceId: found.id,
        confirmed: false,
      };
  }
  if (!fields.vendor.value) {
    const company = sources.find((s) =>
      /^.{3,100}(?:private limited|pvt\.?\s*ltd\.?|limited|llp)\b/i.test(
        s.text,
      ),
    );
    if (company) {
      const m = company.text.match(
        /^(.{3,100}?(?:private limited|pvt\.?\s*ltd\.?|limited|llp))\b/i,
      );
      if (m)
        fields.vendor = {
          value: m[1].trim(),
          sourceId: company.id,
          confirmed: false,
        };
    }
  }
  find(
    "entity",
    /^(?:bill(?:ed)? to|buyer|customer|legal entity)\s*[:\-]\s*(.+)$/i,
  );
  if (!fields.entity.value) {
    const l = sources.find((s) =>
      ["demo company", "democo"].includes(simple(s.text)),
    );
    if (l)
      fields.entity = {
        value: l.text.trim(),
        sourceId: l.id,
        confirmed: false,
      };
  }
  // Indian IRP prints can put supplier and recipient in parallel columns.
  if (!fields.entity.value) {
    const party = sources.findIndex((s) =>
      /^Supplier\s*:\s{2,}Recipient\s*:/i.test(s.text),
    );
    const names = party >= 0 ? sources[party + 2] : undefined;
    const columns = names?.text.split(/\s{2,}/);
    if (names && columns && columns.length === 2)
      fields.entity = {
        value: columns[1].trim(),
        sourceId: names.id,
        confirmed: false,
      };
  }
  if (!fields.entity.value) {
    const start = sources.findIndex((s) =>
      /^bill\s*to(?:\s+account manager)?$/i.test(s.text.trim()),
    );
    const first = sources[start + 1];
    if (start >= 0 && first && first.text.length < 160) {
      const continuation = sources[start + 2];
      fields.entity = {
        value:
          first.text +
          (continuation &&
          /^(?:university|college|institute)\b/i.test(continuation.text)
            ? " " + continuation.text
            : ""),
        sourceId: first.id,
        confirmed: false,
      };
    }
  }
  find(
    "reference",
    /(?:^|\s{2,})(?:invoice|bill|document)\s*(?:number|no\.?|#|id|reference|ref\.?)\s*[:#\-]?\s+([A-Z0-9][A-Z0-9/_.\-]*(?: [A-Z0-9/_.\-]+)*)(?=\s{2,}|$)/i,
  );
  find(
    "date",
    /(?:^|\s{2,})(?:invoice date|document date|issued|issue date|date)\s*[:\-]?\s+(.+)$/i,
  );
  const date = fields.date.value;
  const numericDate = date.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (numericDate) {
    const a = Number(numericDate[1]),
      b = Number(numericDate[2]);
    if ((a > 12 && b <= 12) || (b > 12 && a <= 12)) {
      const day = a > 12 ? a : b,
        month = a > 12 ? b : a;
      fields.date.value = `${numericDate[3]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }
  const monthNames =
    "january february march april may june july august september october november december".split(
      " ",
    );
  const named = date.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (named) {
    const mi = monthNames.findIndex((m) =>
      m.startsWith(named[2].toLowerCase()),
    );
    if (mi >= 0)
      fields.date.value = `${named[3]}-${String(mi + 1).padStart(2, "0")}-${named[1].padStart(2, "0")}`;
  }
  find(
    "po",
    /(?:^|\s{2,})(?:purchase order(?: number| no\.?)?|po(?: reference| number| no\.?)?)\s*[:#\-]?\s+([A-Z0-9][A-Z0-9/_. &\-]{0,120})$/i,
  );
  if (fields.po.value)
    fields.po.value = /^PO[\s-]?\d+$/i.test(fields.po.value)
      ? fields.po.value.replace(/[\s-]/g, "").toUpperCase()
      : fields.po.value.toUpperCase();
  find("currency", /^currency\s*[:\-]?\s+([A-Z]{3})$/i);
  if (!fields.currency.value) {
    const l = sources.find((l) => /\b(?:USD|INR)\b|₹/.test(l.text));
    if (l)
      fields.currency = {
        value: /\bINR\b|₹/.test(l.text) ? "INR" : "USD",
        sourceId: l.id,
        confirmed: false,
      };
  }
  if (
    !fields.currency.value &&
    sources.some((s) => /GSTIN\s*:/i.test(s.text))
  ) {
    const rupee = sources.find((s) => /Price\s*\(Rs\)/i.test(s.text));
    if (rupee)
      fields.currency = { value: "INR", sourceId: rupee.id, confirmed: false };
  }
  const amount =
    "([()\\-]?(?:(?:USD|EUR|INR|US\\$|\\$|₹|Rs\\.?)\\s*)?\\d[\\d,]*(?:\\.\\d{1,2})?\\)?)";
  find(
    "net",
    new RegExp(
      "^(?:net(?: amount| total)?|sub\\s?total|taxable amount)\\s*(?:USD)?\\s*[:\\-]?\\s+" +
        amount +
        "$",
      "i",
    ),
  );
  find(
    "tax",
    new RegExp(
      "^(?:included tax|tax(?: amount| included)?|VAT|sales tax)\\s*(?:USD)?\\s*[:\\-]?\\s+" +
        amount +
        "$",
      "i",
    ),
  );
  find(
    "total",
    new RegExp(
      "^(?:grand total|invoice total|total(?: USD)?)\\s*(?:USD)?\\s*[:\\-]?\\s+" +
        amount +
        "$",
      "i",
    ),
  );
  find(
    "fees",
    new RegExp(
      "^(?:additional charges|charges|shipping|freight)\\s*[:\\-]?\\s+" +
        amount +
        "$",
      "i",
    ),
  );
  find("discount", new RegExp("^discount\\s*[:\\-]?\\s+" + amount + "$", "i"));
  find(
    "servicePeriod",
    /^(?:service period|billing period|period)\s*[:\-]?\s+(.+)$/i,
  );
  // Read a fully labeled GST totals row only when each header has one numeric
  // cell. Unrecognized or incomplete tables remain manual review work.
  const summaryIndex = sources.findIndex(
    (s) => /Tax.?ble Amt/i.test(s.text) && /Tot Inv\.? Amt/i.test(s.text),
  );
  const summary = summaryIndex >= 0 ? sources[summaryIndex + 1] : undefined;
  if (summary) {
    const labels = sources[summaryIndex].text
      .trim()
      .split(/\s{2,}/)
      .map((s) => s.toLowerCase().replace(/[^a-z]/g, ""));
    const values = summary.text.trim().split(/\s+/).map(cents);
    const expected = [
      "taxbleamt",
      "cgstamt",
      "sgstamt",
      "igstamt",
      "cessamt",
      "statecess",
      "discount",
      "othercharges",
      "roundoffamt",
      "totinvamt",
    ];
    if (
      labels.join("|") === expected.join("|") &&
      values.length === labels.length &&
      values.every((v) => v !== null)
    ) {
      const set = (key: FieldKey, value: number, derived = false) => {
        if (!fields[key].value)
          fields[key] = {
            value: decimal(value),
            sourceId: summary.id,
            confirmed: false,
            derived,
          };
      };
      set("net", values[0]!);
      set("total", values[9]!);
      set(
        "tax",
        values.slice(1, 6).reduce<number>((a, v) => a + v!, 0),
        true,
      );
      set("discount", values[6]!);
      set("fees", values[7]!);
    }
  }
  // Add explicitly stated GST components. This is arithmetic extraction, not
  // validation of GST rates, GSTINs, place of supply, or portal authenticity.
  if (!fields.tax.value) {
    const components = sources.filter((s) =>
      /^(?:CGST|SGST|IGST|UTGST)\b/i.test(s.text),
    );
    const found = components.map((s) => ({
      source: s,
      value: s.text.match(/(?:INR|₹|Rs\.?)?\s*([\d,]+\.\d{2})\s*$/i)?.[1],
    }));
    if (
      found.length &&
      found.every((c) => c.value && cents(c.value) !== null) &&
      new Set(components.map((c) => c.text.match(/^(\w+)/)?.[1].toUpperCase()))
        .size === found.length
    ) {
      fields.tax = {
        value: decimal(found.reduce((sum, c) => sum + cents(c.value!)!, 0)),
        sourceId:
          found.find((c) => cents(c.value!)! > 0)?.source.id ||
          found[0].source.id,
        confirmed: false,
        derived: true,
      };
    }
  }
  for (const key of ["net", "tax", "total", "fees", "discount"] as FieldKey[]) {
    const v = cents(fields[key].value);
    if (v !== null) fields[key].value = decimal(v);
  }
  const flags: string[] = [];
  const amountDue = sources.find((s) =>
    /^amount due\s*[:\-]?\s+/i.test(s.text),
  );
  if (amountDue) {
    const due = cents(amountDue.text.replace(/^amount due\s*[:\-]?\s+/i, ""));
    if (due === null || due !== cents(fields.total.value))
      flags.push(
        "Amount due differs from the invoice total or is unclear. Review prior payments before clearance.",
      );
  }
  const refs = sources.filter((s) =>
    /^(?:invoice|bill)\s*(?:number|no\.?|#|reference)\b/i.test(s.text),
  );
  if (new Set(refs.map((r) => r.text)).size > 1)
    flags.push(
      "Multiple invoice identities were detected in this PDF. Split it into separate invoices for review.",
    );
  if (sources.some((s) => /\bcredit note\b|\bcredit memo\b/i.test(s.text)))
    flags.push("A credit note requires a separate manual accounting process.");
  if (
    sources.some((s) =>
      /\bprior balance\b|\bprevious balance\b|\bprepayment\b/i.test(s.text),
    )
  )
    flags.push(
      "Prior balances or prepayments need review; invoice total and amount due may differ.",
    );
  if (
    !fields.net.value &&
    fields.total.value &&
    fields.tax.value &&
    sources.some((s) => /tax included|included tax|includes? tax/i.test(s.text))
  ) {
    const total = cents(fields.total.value),
      tax = cents(fields.tax.value);
    if (total !== null && tax !== null)
      fields.net = {
        value: decimal(total - tax),
        sourceId: fields.total.sourceId,
        derived: true,
        confirmed: false,
      };
  }
  const lines: Extraction["lines"] = [];
  for (const s of sources) {
    const str = s.text.replace(/\s*\|\s*/g, "  ").trim();
    // A supported explicit line code and numeric row are necessary. Unrecognized
    // layouts remain editable review tasks; no quantity or mapping is invented.
    let m = str.match(
      /^(L\d+)\s+(.+?)\s+(\d+(?:\.\d{1,4})?)\s+(\d[\d,]*\.\d{2})\s+(\d[\d,]*\.\d{2})$/i,
    );
    if (m) {
      lines.push({
        code: m[1].toUpperCase(),
        description: m[2],
        quantity: m[3],
        unitPrice: m[4].replace(/,/g, ""),
        net: m[5].replace(/,/g, ""),
        sourceId: s.id,
        confirmed: false,
      });
      continue;
    }
    m = str.match(/^(L\d+)\s+(.+?)\s+(\d[\d,]*\.\d{2})$/i);
    if (m)
      lines.push({
        code: m[1].toUpperCase(),
        description: m[2],
        quantity: "",
        unitPrice: "",
        net: m[3].replace(/,/g, ""),
        sourceId: s.id,
        confirmed: false,
      });
  }
  return {
    fields,
    lines,
    sources: sources.slice(0, 300),
    pages,
    method,
    flags,
  };
}
