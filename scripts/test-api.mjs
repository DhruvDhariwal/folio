import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin = process.env.FOLIO_TEST_ORIGIN || "http://127.0.0.1:5173";
const pdf = await readFile("public/samples/clean-invoice.pdf");
const owner = () => `api-test-${crypto.randomUUID()}`;
async function request(user, path, body, method = "POST") {
  const headers = {
    "oai-authenticated-user-id": user,
    "oai-authenticated-user-email": "test@folio.example",
  };
  let data = body;
  if (!(body instanceof FormData) && body !== undefined) {
    headers["Content-Type"] = "application/json";
    data = JSON.stringify(body);
  }
  const r = await fetch(origin + path, { method, headers, body: data });
  const result = await r.json();
  if (!r.ok) throw Object.assign(new Error(result.error), { status: r.status });
  return result;
}
async function upload(user, unique) {
  const f = new FormData();
  f.set(
    "file",
    new File([pdf, `\n% test variation ${unique}\n`], "api-fixture.pdf", {
      type: "application/pdf",
    }),
  );
  return request(user, "/api/documents", f);
}
function extraction(reference, net = "1000.00", north = false) {
  const values = {
    vendor: north ? "Northstar Studio" : "Cedar Systems",
    entity: "Demo Company",
    reference,
    date: "2026-10-20",
    currency: "USD",
    po: north ? "PO1042" : "PO1043",
    net,
    tax: "0.00",
    total: net,
    servicePeriod: "2026-10",
    fees: "",
    discount: "",
  };
  return {
    fields: Object.fromEntries(
      Object.entries(values).map(([k, value]) => [
        k,
        { value, confirmed: false, sourceId: "p1-s0" },
      ]),
    ),
    lines: [
      {
        code: "L1",
        description: north
          ? "Brand design services"
          : "Implementation support hours",
        quantity: north ? "" : "10",
        unitPrice: north ? "" : "100.00",
        net,
        confirmed: false,
        sourceId: "p1-s0",
      },
    ],
    sources: [
      {
        id: "p1-s0",
        page: 1,
        text: "Synthetic API test values",
        box: [48, 200, 300, 12],
      },
    ],
    pages: [{ width: 595, height: 842 }],
    method: "native",
    flags: [],
  };
}
async function prepare(user, ref, net = "1000.00", north = false) {
  const data = await upload(user, crypto.randomUUID());
  const id = data.result.id;
  const e = extraction(ref, net, north);
  const checked = await request(user, `/api/cases/${id}`, {
    action: "extract",
    extraction: e,
  });
  assert.equal(
    checked.state.cases.find((c) => c.id === id).decisions.at(-1).outcome,
    "review",
  );
  return { id, e };
}
async function confirm(user, { id, e }) {
  return request(user, `/api/cases/${id}`, {
    action: "correct",
    extraction: e,
    reason:
      "Confirmed labeled test fixture fields and line mapping against test input.",
    selectedPo: e.fields.po.value,
    selectedLine: "L1",
    expectedRevision: 1,
  });
}
const passed = [];
const unauth = await fetch(origin + "/api/workspace");
assert.equal(unauth.status, 401);
passed.push("Unauthenticated API rejected");
const user = owner();
const first = await upload(user, "same-content");
const repeat = await upload(user, "same-content");
assert.equal(repeat.result.id, first.result.id);
assert.equal(repeat.result.existing, true);
assert.equal(repeat.state.cases.length, 1);
passed.push("Exact PDF upload reuses one document");
const clean = await prepare(user, "CS-TEST");
let saved = await confirm(user, clean);
let c = saved.state.cases.find((c) => c.id === clean.id);
assert.equal(c.decisions.at(-1).outcome, "ready");
assert.equal(c.decisions.at(-1).balance.remaining, 400000);
passed.push("Source confirmation creates a saved ready receipt");
saved = await request(user, `/api/cases/${clean.id}`, {
  action: "recheck",
  expectedRevision: 2,
  reason: "Recheck the existing reservation",
});
c = saved.state.cases.find((c) => c.id === clean.id);
assert.equal(c.decisions.at(-1).balance.remaining, 400000);
passed.push("Recheck does not double-reserve capacity");
await assert.rejects(
  () =>
    request(user, `/api/cases/${clean.id}`, {
      action: "recheck",
      expectedRevision: 1,
    }),
  { status: 409 },
);
passed.push("Stale revision changes rejected");
await assert.rejects(
  () => request(owner(), `/api/cases/${clean.id}`, undefined, "GET"),
  { status: 404 },
);
passed.push("Cross-workspace invoice access rejected");
const raceUser = owner(),
  ra = await prepare(raceUser, "RACE-A", "2000.00", true),
  rb = await prepare(raceUser, "RACE-B", "2000.00", true);
await Promise.all([confirm(raceUser, ra), confirm(raceUser, rb)]);
const race = (await request(raceUser, "/api/workspace", undefined, "GET"))
  .state;
assert.deepEqual(race.cases.map((c) => c.decisions.at(-1).outcome).sort(), [
  "blocked",
  "ready",
]);
const active = race.cases.filter((c) => c.decisions.at(-1).outcome === "ready");
assert.equal(active[0].decisions.at(-1).balance.remaining, 80000);
passed.push("Simultaneous invoices cannot overspend the same PO");
const duplicateUser = owner(),
  da = await prepare(duplicateUser, "CS-DUPLICATE"),
  db = await prepare(duplicateUser, "CS-DUPLICATE");
await Promise.all([confirm(duplicateUser, da), confirm(duplicateUser, db)]);
const dup = (await request(duplicateUser, "/api/workspace", undefined, "GET"))
  .state;
assert.deepEqual(dup.cases.map((c) => c.decisions.at(-1).outcome).sort(), [
  "blocked",
  "ready",
]);
passed.push("Simultaneous business duplicates create one ready obligation");
await request(user, "/api/workspace", {
  action: "amend",
  poId: "PO1043",
  cap: "6000.00",
  reason: "Approved fictional PO amendment for integration test",
});
const history = await request(user, `/api/cases/${clean.id}`, undefined, "GET");
assert.equal(history.decisions[1].balance.cap, 500000);
saved = await request(user, `/api/cases/${clean.id}`, {
  action: "recheck",
  expectedRevision: 3,
});
assert.equal(
  saved.state.cases.find((c) => c.id === clean.id).decisions.at(-1).balance.cap,
  600000,
);
passed.push(
  "PO amendment preserves historical receipt and changes a fresh decision",
);
const priorData = (await request(user, "/api/workspace", undefined, "GET"))
  .state.procurement;
const imported = await request(user, "/api/workspace", {
  action: "import",
  data: priorData,
});
assert.equal(imported.state.procurement.version, priorData.version + 1);
assert.equal(
  imported.state.cases.find((c) => c.id === clean.id).decisions[1].balance.cap,
  500000,
);
passed.push(
  "Equivalent baseline reimport succeeds without rewriting receipt history",
);
const ambiguous = structuredClone(priorData);
ambiguous.vendors[1].aliases.push(ambiguous.vendors[0].name);
await assert.rejects(
  () => request(user, "/api/workspace", { action: "import", data: ambiguous }),
  { status: 400 },
);
passed.push(
  "Ambiguous supplier aliases are rejected before dataset activation",
);
const mixedCurrency = structuredClone(priorData);
mixedCurrency.commitments[0].currency = "INR";
await assert.rejects(
  () =>
    request(user, "/api/workspace", { action: "import", data: mixedCurrency }),
  { status: 400 },
);
passed.push("Imported prior obligations cannot cross currency boundaries");
const indianUser = owner();
const indianData = structuredClone(priorData);
indianData.pos[1].currency = "INR";
indianData.pos[1].entity = "INDIAN TEST BUYER";
const indianImport = await request(indianUser, "/api/workspace", {
  action: "import",
  data: indianData,
});
assert.equal(indianImport.state.procurement.pos[1].currency, "INR");
assert.equal(indianImport.state.procurement.pos[1].entity, "INDIAN TEST BUYER");
passed.push(
  "INR purchases and explicitly declared buyer entities import successfully",
);
console.log(JSON.stringify({ passed: passed.length, checks: passed }, null, 2));
