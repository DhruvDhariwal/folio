import {
  CRITICAL,
  type Workspace,
  type InvoiceCase,
  type Extraction,
  type Check,
  type Decision,
  type Balance,
  type PO,
} from "./types";

export const POLICY = "1.1-local";
export function cents(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const raw = value.trim().replace(/^(?:USD|EUR|INR|US\$|\$|₹|Rs\.?)\s*/i, "");
  if (
    !/^-?(?:\d+|\d{1,3}(?:,\d{3})+|\d{1,2}(?:,\d{2})*,\d{3})(?:\.\d{1,2})?$/.test(
      raw,
    )
  )
    return null;
  const s = raw.replace(/,/g, "");
  const negative = s.startsWith("-");
  const [whole, decimal = ""] = s.replace(/^-/, "").split(".");
  const result = Number(whole) * 100 + Number(decimal.padEnd(2, "0"));
  return Number.isSafeInteger(result) ? (negative ? -result : result) : null;
}
export const decimal = (n: number) => (n / 100).toFixed(2);
export const money = (n: number, currency = "USD") =>
  new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency: /^[A-Z]{3}$/.test(currency) ? currency : "USD",
  }).format(n / 100);
export const safeRef = (s: string) => s.trim().toUpperCase();
export const simple = (s: string) =>
  s.trim().toLowerCase().replace(/\s+/g, " ");
export const entityId = (s: string) =>
  ["demo company", "democo"].includes(simple(s))
    ? "DEMOCO"
    : s.trim().toUpperCase();
export function quantityProduct(
  quantity: string,
  unitCents: number,
): number | null {
  if (
    !/^\d+(?:\.\d{1,4})?$/.test(quantity) ||
    !Number.isSafeInteger(unitCents) ||
    unitCents < 0
  )
    return null;
  const [whole, fraction = ""] = quantity.split(".");
  const numerator =
    BigInt(whole) * BigInt(10000) + BigInt(fraction.padEnd(4, "0"));
  const value = Number(
    (numerator * BigInt(unitCents) + BigInt(5000)) / BigInt(10000),
  );
  return Number.isSafeInteger(value) ? value : null;
}
export function scaledQuantity(s: string): number | null {
  if (!/^\d+(?:\.\d{1,4})?$/.test(s)) return null;
  const [whole, fraction = ""] = s.split(".");
  const n = Number(whole) * 10000 + Number(fraction.padEnd(4, "0"));
  return Number.isSafeInteger(n) ? n : null;
}
export function isoDate(s: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(s + "T00:00:00Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s
    ? s
    : null;
}
export function similarity(a: string, b: string): number {
  a = safeRef(a).replace(/[^A-Z0-9]/g, "");
  b = safeRef(b).replace(/[^A-Z0-9]/g, "");
  if (!a || !b) return 0;
  let row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++)
      next[j] = Math.min(
        next[j - 1] + 1,
        row[j] + 1,
        row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    row = next;
  }
  return 1 - row[b.length] / Math.max(a.length, b.length);
}
export function latest(c: InvoiceCase) {
  return c.decisions[c.decisions.length - 1];
}
export function activeReady(s: Workspace, exclude: string) {
  return s.cases.filter(
    (c) => c.id !== exclude && !c.voided && latest(c)?.outcome === "ready",
  );
}
export function candidatePOs(s: Workspace, invoice: Extraction): PO[] {
  const name = simple(invoice.fields.vendor.value);
  const v = s.procurement.vendors.find((x) =>
    [x.name, ...x.aliases].some((n) => simple(n) === name),
  );
  return s.procurement.pos.filter(
    (p) =>
      p.vendorId === v?.id &&
      entityId(p.entity) === entityId(invoice.fields.entity.value) &&
      p.currency === invoice.fields.currency.value.toUpperCase() &&
      p.status === "open",
  );
}
export function evaluate(
  s: Workspace,
  c: InvoiceCase,
  actor: string,
  note = "",
): Decision {
  const inv = c.extraction!;
  const f = inv.fields;
  const invoiceCurrency = f.currency.value.toUpperCase();
  const displayMoney = (n: number) => money(n, invoiceCurrency || "USD");
  const approvedEntities = new Set(
    s.procurement.pos.map((p) => entityId(p.entity)),
  );
  const referencedPO = s.procurement.pos.find(
    (p) => p.id === f.po.value.trim().toUpperCase(),
  );
  const checks: Check[] = [];
  const add = (
    id: string,
    label: string,
    status: Check["status"],
    reason: string,
    more: Partial<Check> = {},
  ) => checks.push({ id, label, status, reason, ...more });
  const net = cents(f.net.value),
    tax = cents(f.tax.value),
    total = cents(f.total.value),
    fees = cents(f.fees.value || "0"),
    discount = cents(f.discount.value || "0");
  const vendor = s.procurement.vendors.find((v) =>
    [v.name, ...v.aliases].some((n) => simple(n) === simple(f.vendor.value)),
  );
  const missing = CRITICAL.filter((k) => !f[k]?.value.trim());
  add(
    "fields",
    "Required information",
    missing.length ? "review" : "pass",
    missing.length
      ? `Missing: ${missing.join(", ")}. Confirm the source or request a corrected invoice.`
      : "Required invoice fields are present.",
    {
      evidence: CRITICAL.map((k) => f[k].sourceId).filter(Boolean) as string[],
    },
  );
  const unverified = CRITICAL.filter((k) => !f[k]?.confirmed);
  const linesUnverified = inv.lines.some((l) => !l.confirmed);
  add(
    "evidence",
    "Source confirmation",
    unverified.length || linesUnverified ? "review" : "pass",
    unverified.length || linesUnverified
      ? "Local extraction has no calibrated field confidence. Check the displayed values and line items against the PDF before confirming."
      : `Source values confirmed by ${inv.confirmedBy || actor}.`,
    {
      actual: `${CRITICAL.length - unverified.length} of ${CRITICAL.length} critical fields confirmed`,
    },
  );
  add(
    "supplier",
    "Approved supplier",
    !vendor ? "review" : !vendor.active ? "block" : "pass",
    !vendor
      ? "This supplier is not in the approved vendor data."
      : !vendor.active
        ? `${vendor.name} is inactive.`
        : `${vendor.name} matches the approved vendor record.`,
    {
      evidence: ["procurement:vendors", f.vendor.sourceId || ""].filter(
        Boolean,
      ),
    },
  );
  add(
    "entity",
    "Buyer entity",
    !f.entity.value
      ? "review"
      : referencedPO &&
          entityId(f.entity.value) !== entityId(referencedPO.entity)
        ? "block"
        : approvedEntities.has(entityId(f.entity.value))
          ? "pass"
          : "review",
    referencedPO && entityId(f.entity.value) !== entityId(referencedPO.entity)
      ? "The buyer conflicts with the entity on the referenced purchase order."
      : approvedEntities.has(entityId(f.entity.value))
        ? "The buyer is present in the supplied purchasing records."
        : "This buyer has no matching purchasing records in the workspace. Supply the correct records before clearance.",
    {
      actual: f.entity.value,
      expected:
        referencedPO?.entity || "A buyer in the supplied purchasing records",
    },
  );
  add(
    "date",
    "Invoice date",
    isoDate(f.date.value) ? "pass" : "review",
    isoDate(f.date.value)
      ? "The date is explicit and valid."
      : "Use an unambiguous date in YYYY-MM-DD format after checking the invoice.",
    {
      actual: f.date.value,
      evidence: f.date.sourceId ? [f.date.sourceId] : [],
    },
  );
  add(
    "type",
    "Document scope",
    inv.flags.length ? "review" : "pass",
    inv.flags.length ? inv.flags.join(" ") : "One supported invoice detected.",
  );
  const validMoney =
    net !== null &&
    tax !== null &&
    total !== null &&
    fees !== null &&
    discount !== null &&
    tax >= 0 &&
    fees >= 0 &&
    discount >= 0;
  if (validMoney) {
    const diff = total! - (net! + tax! + fees! - discount!);
    add(
      "arithmetic",
      "Invoice arithmetic",
      net! < 0 || total! < 0
        ? "review"
        : Math.abs(diff) > 2
          ? "review"
          : "pass",
      net! < 0 || total! < 0
        ? "Credit notes require a separate manual process."
        : Math.abs(diff) > 2
          ? `The stated amounts do not reconcile within the ${displayMoney(2)} rounding allowance.`
          : "Net plus stated tax and charges, less discount, reconciles to the invoice total.",
      {
        actual: displayMoney(total!),
        expected: displayMoney(net! + tax! + fees! - discount!),
        difference: displayMoney(diff),
        limit: displayMoney(2),
        evidence: [f.net.sourceId, f.tax.sourceId, f.total.sourceId].filter(
          Boolean,
        ) as string[],
      },
    );
  } else
    add(
      "arithmetic",
      "Invoice arithmetic",
      "review",
      "One or more amounts is missing or invalid. Do not infer a missing invoice total.",
    );
  if ((fees || 0) > 0 || (discount || 0) > 0)
    add(
      "separate_charges",
      "Charges and discounts",
      "review",
      "Separately stated charges or discounts need an explicit purchasing allocation. This version cannot clear them against the subtotal alone.",
    );
  const known = s.procurement.commitments.map((x) => ({
    ...x,
    caseId: undefined as string | undefined,
  }));
  const other = s.cases
    .filter(
      (o) =>
        o.id !== c.id &&
        !o.voided &&
        o.extraction?.fields.vendor.confirmed &&
        o.extraction.fields.reference.confirmed &&
        o.extraction.fields.entity.confirmed,
    )
    .map((o) => {
      const oi = o.extraction!;
      const vd = s.procurement.vendors.find((v) =>
        [v.name, ...v.aliases].some(
          (n) => simple(n) === simple(oi.fields.vendor.value),
        ),
      );
      return {
        id: o.id,
        caseId: o.id,
        vendorId: vd?.id,
        entity: entityId(oi.fields.entity.value),
        reference: oi.fields.reference.value,
        date: oi.fields.date.value,
        currency: oi.fields.currency.value.toUpperCase(),
        gross: cents(oi.fields.total.value) ?? -1,
        net: cents(oi.fields.net.value) ?? 0,
        period: oi.fields.servicePeriod.value,
        poId: latest(o)?.poId || oi.fields.po.value,
        lineId: "",
      };
    });
  const identityConfirmed =
    f.vendor.confirmed && f.reference.confirmed && f.entity.confirmed;
  const candidates = [...known, ...other].filter(
    (k) => k.vendorId === vendor?.id && k.entity === entityId(f.entity.value),
  );
  const exact = f.reference.value
    ? candidates.find(
        (k) => safeRef(k.reference) === safeRef(f.reference.value),
      )
    : undefined;
  const near = candidates.find(
    (k) =>
      k.currency === f.currency.value.toUpperCase() &&
      k.gross === total &&
      isoDate(k.date) &&
      isoDate(f.date.value) &&
      Math.abs(Date.parse(k.date) - Date.parse(f.date.value)) <=
        30 * 86400000 &&
      similarity(k.reference, f.reference.value) >= 0.85 &&
      !(
        k.period &&
        f.servicePeriod.value &&
        k.period !== f.servicePeriod.value
      ),
  );
  if (exact)
    add(
      "duplicate",
      "Duplicate obligation",
      identityConfirmed ? "block" : "review",
      `Invoice ${exact.reference} already exists${exact.caseId ? " in this workspace" : " in prior commitments"}. ${exact.gross !== total ? "The changed amount is a conflicting revision, not a new obligation." : "A different PDF does not create a new obligation."}`,
      {
        evidence: [
          exact.caseId ? `case:${exact.caseId}` : `commitment:${exact.id}`,
        ],
        actual: f.reference.value,
        expected: "A distinct invoice identity",
      },
    );
  else if (near && !c.duplicateResolution)
    add(
      "duplicate",
      "Duplicate obligation",
      "review",
      `Possible reissue of ${near.reference}. Compare the documents and establish whether this is a distinct obligation.`,
      {
        evidence: [
          near.caseId ? `case:${near.caseId}` : `commitment:${near.id}`,
        ],
      },
    );
  else
    add(
      "duplicate",
      "Duplicate obligation",
      "pass",
      c.duplicateResolution
        ? `Possible duplicate resolved: ${c.duplicateResolution.reason}`
        : "No exact or qualifying similar obligation found in retained history.",
    );
  const rawExplicit = f.po.value.trim().toUpperCase();
  const explicit = /^PO[\s-]?\d+$/.test(rawExplicit)
    ? rawExplicit.replace(/[\s-]/g, "")
    : rawExplicit;
  const po = s.procurement.pos.find((p) => p.id === (c.selectedPo || explicit));
  const explicitPo = explicit
    ? s.procurement.pos.find((p) => p.id === explicit)
    : undefined;
  if (explicit && c.selectedPo && c.selectedPo !== explicit)
    add(
      "po_identity",
      "Purchase order identity",
      "block",
      "The selected PO conflicts with the invoice's explicit reference. Correct the source field if it was read incorrectly; do not silently replace the purchase.",
      { actual: c.selectedPo, expected: explicit },
    );
  else if (
    explicit &&
    (!explicitPo ||
      explicitPo.vendorId !== vendor?.id ||
      entityId(explicitPo.entity) !== entityId(f.entity.value))
  )
    add(
      "po_identity",
      "Purchase order identity",
      !explicitPo && !vendor ? "review" : "block",
      !explicitPo && !vendor
        ? "The referenced purchase and supplier are not in the supplied data. Import matching purchasing records; the invoice alone cannot prove authorization."
        : "The explicit PO is unknown or belongs to a different supplier or entity. Correct the source or procurement record.",
      { actual: explicit },
    );
  else if (!po)
    add(
      "po_identity",
      "Purchase order identity",
      "review",
      `No unambiguous purchase order selected. ${candidatePOs(s, inv).length} eligible candidates are available. An amount alone cannot establish the purchase.`,
    );
  else if (
    po.vendorId !== vendor?.id ||
    entityId(po.entity) !== entityId(f.entity.value)
  )
    add(
      "po_identity",
      "Purchase order identity",
      "block",
      "The selected PO belongs to a different supplier or buyer.",
    );
  else if (po.status !== "open")
    add(
      "po_identity",
      "Purchase order identity",
      "block",
      "The purchase order is closed.",
    );
  else if (!explicit && !c.mappingConfirmed)
    add(
      "po_identity",
      "Purchase order identity",
      "review",
      "A missing PO reference requires a documented human selection.",
    );
  else
    add(
      "po_identity",
      "Purchase order identity",
      "pass",
      `${po.id} matches the supplier and buyer.`,
      {
        actual: po.id,
        evidence: [`po:${po.id}`, f.po.sourceId || ""].filter(Boolean),
      },
    );
  add(
    "currency",
    "Currency",
    !f.currency.value
      ? "review"
      : !["USD", "INR"].includes(f.currency.value.toUpperCase()) ||
          (po && po.currency !== f.currency.value.toUpperCase())
        ? "block"
        : "pass",
    ["USD", "INR"].includes(f.currency.value.toUpperCase()) &&
      (!po || po.currency === f.currency.value.toUpperCase())
      ? `The stated currency is ${f.currency.value.toUpperCase()}. Amounts are compared only with purchasing records in the same currency.`
      : "This workflow does not convert currencies.",
    {
      actual: f.currency.value,
      expected: po?.currency || "INR or USD; no currency conversion",
    },
  );
  if (po?.method === "three_way")
    add(
      "receipt",
      "Receipt confirmation",
      "review",
      "This purchase requires receipt confirmation, which is outside two-way checking.",
    );
  let balance: Balance | undefined;
  const allocations: Decision["lineAllocations"] = [];
  const actives = activeReady(s, c.id);
  if (po && net !== null && net >= 0) {
    const prior = s.procurement.commitments
      .filter((k) => k.poId === po.id)
      .reduce((a, k) => a + k.net, 0);
    const locals = actives.filter((o) => latest(o).poId === po.id);
    const local = locals.reduce(
      (a, o) => a + (cents(latest(o).invoice.fields.net.value) || 0),
      0,
    );
    balance = {
      poId: po.id,
      project: po.project,
      cap: po.cap,
      prior,
      local,
      available: po.cap - prior - local,
      current: net,
      remaining: po.cap - prior - local - net,
      history: [
        ...s.procurement.commitments
          .filter((k) => k.poId === po.id)
          .map((k) => ({
            reference: k.reference,
            net: k.net,
            kind: "Imported approved obligation",
          })),
        ...locals.map((o) => ({
          reference: latest(o).invoice.fields.reference.value,
          net: cents(latest(o).invoice.fields.net.value) || 0,
          kind: "Folio reservation",
        })),
      ],
    };
    add(
      "capacity",
      "Cumulative PO capacity",
      balance.remaining < 0 ? "block" : "pass",
      balance.remaining < 0
        ? `This invoice exceeds ${po.id} by ${displayMoney(-balance.remaining)}. Earlier commitments leave ${displayMoney(balance.available)} available.`
        : `${displayMoney(balance.remaining)} remains after this invoice.`,
      {
        actual: displayMoney(prior + local + net),
        expected: displayMoney(po.cap),
        difference: displayMoney(Math.max(0, -balance.remaining)),
        limit: "$0.00 overrun",
        evidence: [
          `po:${po.id}`,
          "prior-commitments",
          f.net.sourceId || "",
        ].filter(Boolean),
      },
    );
    if (!inv.lines.length)
      add(
        "line_mapping",
        "PO line mapping",
        "review",
        "No supported line mapping is available. Check the line items and select the appropriate PO line.",
      );
    const grouped: Record<string, { net: number; quantity: number }> = {};
    let lineSum = 0;
    let allMapped = true;
    for (let i = 0; i < inv.lines.length; i++) {
      const line = inv.lines[i],
        ln = cents(line.net);
      const mapped = po.lines.find(
        (l) =>
          l.id ===
          (inv.lines.length === 1 && c.selectedLine
            ? c.selectedLine
            : line.code),
      );
      if (!mapped || ln === null) {
        allMapped = false;
        add(
          `line_${i}`,
          `Line ${i + 1} mapping`,
          "review",
          "A line has no explicit, supported mapping or net amount.",
        );
        continue;
      }
      lineSum += ln;
      const qty = scaledQuantity(line.quantity);
      if (!grouped[mapped.id]) grouped[mapped.id] = { net: 0, quantity: 0 };
      grouped[mapped.id].net += ln;
      grouped[mapped.id].quantity += qty || 0;
      allocations.push({
        lineId: mapped.id,
        net: ln,
        quantity: qty !== null ? line.quantity : undefined,
      });
      if (mapped.kind === "amount_cap")
        add(
          `price_${i}`,
          `Line ${i + 1} price`,
          "na",
          "This blanket service line has an amount cap, not a fixed unit price. Cumulative capacity is checked instead.",
        );
      else {
        const expected =
          mapped.kind === "milestone"
            ? mapped.cap
            : qty !== null && mapped.unitPrice !== undefined
              ? quantityProduct(line.quantity, mapped.unitPrice)
              : null;
        const statedUnit = cents(line.unitPrice);
        if (
          expected === null ||
          (mapped.kind === "quantity" && (qty === null || statedUnit === null))
        )
          add(
            `price_${i}`,
            `Line ${i + 1} price`,
            "review",
            "Quantity or price evidence is missing.",
          );
        else {
          const diff = ln - expected;
          const allowed = Math.min(
            Math.floor((expected * 2) / 100),
            invoiceCurrency === "INR" ? 10000 : 2000,
          );
          const amountFromUnit =
            qty !== null && statedUnit !== null
              ? quantityProduct(line.quantity, statedUnit)
              : ln;
          const badArithmetic =
            amountFromUnit === null || Math.abs(amountFromUnit - ln) > 2;
          add(
            `price_${i}`,
            `Line ${i + 1} price`,
            badArithmetic
              ? "review"
              : diff > allowed
                ? "block"
                : diff * 10 < -expected
                  ? "review"
                  : "pass",
            badArithmetic
              ? "Quantity multiplied by stated unit price does not reconcile to the line net."
              : diff > allowed
                ? "The price difference exceeds the configured tolerance."
                : diff * 10 < -expected
                  ? "The price is more than 10% below the expected amount; review the reason."
                  : "The mapped line price is within the permitted variance.",
            {
              actual: displayMoney(ln),
              expected: displayMoney(expected),
              difference: displayMoney(diff),
              limit: displayMoney(allowed),
              evidence: line.sourceId
                ? [line.sourceId, `po:${po.id}/${mapped.id}`]
                : [`po:${po.id}/${mapped.id}`],
            },
          );
        }
      }
    }
    if (inv.lines.length && allMapped)
      add(
        "line_total",
        "Line amounts reconcile",
        Math.abs(lineSum - net) > 2 ? "review" : "pass",
        Math.abs(lineSum - net) > 2
          ? "Mapped line amounts do not reconcile to the invoice net."
          : "The line amounts reconcile to the invoice net.",
        {
          actual: displayMoney(lineSum),
          expected: displayMoney(net),
          limit: displayMoney(2),
        },
      );
    for (const [id, g] of Object.entries(grouped)) {
      const pl = po.lines.find((l) => l.id === id)!;
      const prev =
        s.procurement.commitments
          .filter((k) => k.poId === po.id && k.lineId === id)
          .reduce((a, k) => a + k.net, 0) +
        locals
          .flatMap((o) => latest(o).lineAllocations)
          .filter((a) => a.lineId === id)
          .reduce((a, l) => a + l.net, 0);
      add(
        `line_capacity_${id}`,
        `${id} remaining capacity`,
        prev + g.net > pl.cap ? "block" : "pass",
        prev + g.net > pl.cap
          ? `This line would exceed its authorization by ${displayMoney(prev + g.net - pl.cap)}.`
          : "This line remains within its authorized net cap.",
        {
          actual: displayMoney(prev + g.net),
          expected: displayMoney(pl.cap),
          limit: "$0.00 overrun",
          evidence: [`po:${po.id}/${id}`],
        },
      );
      if (pl.kind === "quantity" && pl.quantity) {
        const imported = s.procurement.commitments.filter(
          (k) => k.poId === po.id && k.lineId === id,
        );
        const unknown = imported.some(
          (k) => scaledQuantity(k.quantity || "") === null,
        );
        const cap = scaledQuantity(pl.quantity);
        const previousQty =
          imported.reduce(
            (a, k) => a + (scaledQuantity(k.quantity || "") || 0),
            0,
          ) +
          locals
            .flatMap((o) => latest(o).lineAllocations)
            .filter((a) => a.lineId === id)
            .reduce((a, l) => a + (scaledQuantity(l.quantity || "") || 0), 0);
        add(
          `quantity_${id}`,
          `${id} quantity`,
          unknown || cap === null
            ? "review"
            : previousQty + g.quantity > cap
              ? "block"
              : "pass",
          unknown
            ? "Prior invoices on this quantity-based line have no supported quantities. Confirm the procurement history before clearance."
            : "Billed quantities must fit the PO quantity; a price tolerance cannot waive a quantity overrun.",
          {
            actual: String((previousQty + g.quantity) / 10000),
            expected: pl.quantity,
          },
        );
      }
    }
  }
  const blocks = checks.filter((k) => k.status === "block"),
    reviews = checks.filter((k) => k.status === "review");
  const outcome = blocks.length
    ? "blocked"
    : reviews.length
      ? "review"
      : "ready";
  const lead = blocks[0] || reviews[0];
  const summary =
    outcome === "ready"
      ? "Invoice and purchase order checks passed."
      : lead!.reason;
  const nextAction =
    outcome === "ready"
      ? "Continue through your company's approval process. Delivery and payment authorization remain separate."
      : blocks.some((b) => b.id === "duplicate")
        ? "Resolve the original obligation or corrected document; an exact duplicate cannot be overridden."
        : blocks.some((b) => b.id.includes("capacity"))
          ? "Obtain an authorized PO amendment or corrected invoice, then recheck."
          : blocks.length
            ? "Correct the invoice or authorized procurement data, then recheck."
            : unverified.length || linesUnverified
              ? "Check the extracted fields against the PDF, confirm them, and recheck all controls."
              : !po || !explicit
                ? "Confirm the purchase order and supported line mapping, with a reason."
                : "Resolve the listed missing or ambiguous evidence, then recheck.";
  return {
    id: crypto.randomUUID(),
    revision: c.decisions.length + 1,
    at: new Date().toISOString(),
    outcome,
    summary,
    nextAction,
    policy: POLICY,
    datasetVersion: s.procurement.version,
    checks,
    balance,
    vendorId: vendor?.id,
    poId: po?.id,
    lineAllocations: allocations,
    invoice: structuredClone(inv),
    actor,
    note,
  };
}
