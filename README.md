# Folio invoice workspace

A working first version of Zamp PS 1: a real PDF becomes an evidence-backed invoice decision against procurement data and earlier obligations.

## Run locally

Requires Node 22.13 or newer. This checkout has its dependencies and self-hosted extraction assets installed.

```powershell
npm ci
npm run engines:prepare
npm run build
node --import ./scripts/sites-env.mjs ./node_modules/wrangler/bin/wrangler.js d1 execute DB --local --config dist/server/wrangler.json --persist-to .wrangler/state --file drizzle/0000_amusing_nemesis.sql
npm run dev
```

Apply the migration only to a new local database, not again to an initialized one. Open the printed local URL. For local development, use `/signin-with-chatgpt?return_to=/`; the Sites starter provides a clearly scoped local test identity. The hosted Sites workspace uses ChatGPT sign-in.

## Vercel demo

Run `npm ci` and `npm run build:vercel` to produce the static site in `dist-vercel`. For local browser testing, serve the output with `npx vite preview --config vite.config.vercel.ts`. Vercel uses `vercel.json` to build the same output.

The Vercel demo uses the same PDF readers, procurement checks, and invoice review actions as the Sites workspace. It runs without sign-in. Uploaded originals, procurement imports, and decisions are stored together in IndexedDB on the current browser and origin. They survive reloads but do not sync across browsers or devices. Clearing site data removes them, so export decision receipts before clearing the workspace. The review actor is labeled Local reviewer.

## What works

- Real PDF uploads with server-computed hashes, private original file storage and exact-file reuse.
- PDF.js reads native text; Tesseract runs locally in the browser for image-only scans. Workers, language data and engine files are self-hosted.
- Evidence locations link invoice fields to highlighted regions in the source PDF.
- Explicit supplier, buyer, currency, date, arithmetic, duplicate, PO, line price and cumulative capacity checks.
- Source correction and confirmation, justified missing-PO mapping, possible-duplicate resolution and versioned receipts.
- Persistent queue, history, JSON receipt exports, CSV procurement imports and authorized synthetic PO cap amendments.
- Concurrency-safe invoice identity and capacity decisions using atomic compare-and-swap updates in D1.
- Five example scenarios use real fictional PDFs through the same pipeline as other uploads.

## Deliberate differences from the initial PRD

The user selected local processing. There is no Azure, AWS or generative-model call and no invented extraction confidence. Every locally extracted invoice needs source confirmation before clearance. Hard procurement blockers can still be surfaced immediately. OCR is real, but label and line interpretation is conservative and bounded; unfamiliar layouts may need manual field correction or mapping.

React and Vinext run on the Sites Worker host. D1 replaces the proposed PostgreSQL service, and R2 stores PDFs. A single owner-scoped state aggregate advances with `UPDATE ... WHERE revision = ?`. A losing concurrent request reloads the state and reruns the decision. This atomically includes invoice identity, the new receipt and any capacity reservation. No check-then-write race is permitted. The API integration suite includes simultaneous invoices and duplicates.

Local extraction runs while the tab is open. Closing it pauses the local work; the uploaded original and stage events are retained, and the case can resume. The app does not claim a background OCR worker or fabricated processing stages.

The prototype is limited to 60 documents per private workspace, 20 decision revisions per document, five PDF pages, 10 MB and English text, INR or USD, and buyer entities declared in the supplied purchasing data. The aggregate has an explicit 1.5 MB history limit. Production scale would require splitting records into relational tables, a durable job service and reconciliation with the actual ERP.

The initial procurement dataset is fictional. PO1042 has USD 10,000 net authorized and USD 7,200 in approved prior obligations. The overrun PDF adds USD 3,100 and must be blocked by USD 300. Cap changes require a reason, create a new dataset version and preserve previous receipts. The imported baseline cannot change once invoice cases exist, preventing accidental double counting.

## Indian invoice examples

The opening preview uses two real Indian invoices published by Vignan and MIT-ADT. Banking and personal contact details are removed. Their purchase orders, vendor authorization and prior obligations have not been supplied; they remain review tasks until matching records are imported. The app does not invent Indian purchasing records.

Rupees use Indian number grouping. Stated GST components can be summed, and a recognized, fully labeled IRP totals row can be read. This is document arithmetic, not GST compliance, GSTIN or IRN verification. INR and USD never convert or share capacity. The demo price variance is capped at the lower of 2% and INR 100, or 2% and USD 20.

See `docs/DESIGN.md` for the Apple-page study and type/layout decisions. Hanken Grotesk is self-hosted under the included SIL Open Font License.

## Fictional control-scenario walkthrough

1. Process **A clean invoice**. Open source review, inspect the values and line, enter a reason and confirm. It becomes ready with one USD 1,000 net reservation.
2. Process **The final invoice**. It blocks because earlier obligations leave USD 2,800 while this invoice requests USD 3,100.
3. Process **A familiar obligation**. The suffixed reference is a possible reissue of prior invoice NS-0418. Compare its source and procurement evidence before resolving it.
4. Process **Which purchase**. It lacks an explicit PO and supported line mapping. Choose a justified service PO and line, record the source context and recheck. The system does not choose by the nearest amount.
5. Process **Read the fine print**. Local OCR reads an image-only PDF with included tax. Inspect the identifier: a real OCR run may read the letter O as zero. Confirm the actual reference, USD 180 included tax and USD 1,000 derived net. The previous receipt remains unchanged.

Two-way checking is not delivery verification or payment authorization. No payments, emails or ERP postings occur.

## Verification

```powershell
npm run check
npm test
```

For API integration tests, start the built Worker with a separate local persistence directory and apply the schema there first. Then run:

```powershell
$env:FOLIO_TEST_ORIGIN='http://127.0.0.1:5174'
npm run test:api
```

The test script supplies isolated identity headers to a **local built Worker**, where there is no hosted dispatch. The Vite development server intentionally strips those headers and requires its test sign-in, so the API script must use the isolated built preview. Never add a test authentication bypass to the deployed application. Sites controls authenticated headers on the private host.

Twenty-seven rule/parser tests and the actual API integration suite were run successfully during authoring. The browser walkthrough also exercised all five sample scenarios, including native extraction, local OCR, source correction, cumulative overrun, reissue detection and justified missing-PO mapping. These are finite prototype checks, not measured production accuracy or completion of the PRD's full 24-document holdout evaluation.

Separately stated charges or discounts require review until they have an explicit purchasing allocation. Imported quantity-based obligations need supported quantities; an optional `quantity` column on prior_commitments.csv supplies them. These limits prevent an apparently matching subtotal from hiding unapproved exposure.

## Source map

- `lib/folio/rules.ts`: pure financial decisions, integer cents and exact quantity multiplication.
- `lib/folio/parse.ts` and `extract.ts`: conservative field interpretation and local PDF/OCR processing.
- `lib/folio/store.ts`: authenticated workspace access and atomic revision-protected persistence.
- `app/api`: upload, original document, extraction/correction and procurement endpoints.
- `app/components`: queue, source viewer, receipts, review form and procurement interface.
- `db/schema.ts` and `drizzle`: schema-only database migration.
- `public/samples/india`: two attributed, privacy-edited real Indian invoices; source details in `SOURCES.md`.
- `public/samples`: six fictional control-scenario PDFs, including an image-only scan.
- `tests/rules.test.ts` and `scripts/test-api.mjs`: financial and concurrent API verification.

## Deployment

`.openai/hosting.json` preserves this Site's registered identity and declares D1 and R2 bindings. Publish with the Sites skill workflow; it pushes source, packages the built output, applies hosted schema migrations and deploys privately. No extraction API key is required. The Sites audience is managed independently of the Vercel demo.
