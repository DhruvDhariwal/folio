export type Outcome = "ready" | "review" | "blocked";
export type FieldKey =
  | "vendor"
  | "entity"
  | "reference"
  | "date"
  | "currency"
  | "po"
  | "net"
  | "tax"
  | "total"
  | "servicePeriod"
  | "fees"
  | "discount";
export type SourceLine = {
  id: string;
  page: number;
  text: string;
  box: [number, number, number, number];
};
export type Field = {
  value: string;
  sourceId?: string;
  confirmed?: boolean;
  derived?: boolean;
};
export type InvoiceLine = {
  code: string;
  description: string;
  quantity: string;
  unitPrice: string;
  net: string;
  sourceId?: string;
  confirmed?: boolean;
};
export type Extraction = {
  fields: Record<FieldKey, Field>;
  lines: InvoiceLine[];
  sources: SourceLine[];
  pages: { width: number; height: number }[];
  method: "native" | "ocr" | "mixed";
  flags: string[];
  confirmedBy?: string;
  confirmedAt?: string;
};
export type Vendor = {
  id: string;
  name: string;
  aliases: string[];
  active: boolean;
  currency: string;
};
export type POLine = {
  id: string;
  description: string;
  kind: "amount_cap" | "quantity" | "milestone";
  cap: number;
  quantity?: string;
  unitPrice?: number;
  period?: string;
};
export type PO = {
  id: string;
  vendorId: string;
  entity: string;
  currency: string;
  cap: number;
  status: "open" | "closed";
  project: string;
  method: "two_way" | "three_way";
  lines: POLine[];
};
export type Commitment = {
  id: string;
  vendorId: string;
  entity: string;
  reference: string;
  date: string;
  currency: string;
  net: number;
  gross: number;
  poId: string;
  lineId: string;
  period?: string;
  quantity?: string;
};
export type Procurement = {
  version: number;
  importedAt: string;
  vendors: Vendor[];
  pos: PO[];
  commitments: Commitment[];
  amendments?: {
    poId: string;
    previousCap: number;
    newCap: number;
    reason: string;
    actor: string;
    at: string;
    version: number;
  }[];
};
export type Check = {
  id: string;
  label: string;
  status: "pass" | "review" | "block" | "na";
  reason: string;
  actual?: string;
  expected?: string;
  difference?: string;
  limit?: string;
  evidence?: string[];
};
export type Balance = {
  poId: string;
  project: string;
  cap: number;
  prior: number;
  local: number;
  available: number;
  current: number;
  remaining: number;
  history: { reference: string; net: number; kind: string }[];
};
export type Decision = {
  id: string;
  revision: number;
  at: string;
  outcome: Outcome;
  summary: string;
  nextAction: string;
  policy: string;
  datasetVersion: number;
  checks: Check[];
  balance?: Balance;
  vendorId?: string;
  poId?: string;
  lineAllocations: { lineId: string; net: number; quantity?: string }[];
  invoice: Extraction;
  actor: string;
  note: string;
};
export type Stage =
  "received" | "read" | "extract" | "validate" | "match" | "policy" | "record";
export type Event = {
  id: string;
  at: string;
  stage: Stage;
  status: "running" | "done" | "failed";
  message: string;
};
export type InvoiceCase = {
  id: string;
  hash: string;
  filename: string;
  fileKey: string;
  createdAt: string;
  status: "uploaded" | "processing" | "completed" | "failed";
  error?: string;
  extraction?: Extraction;
  decisions: Decision[];
  events: Event[];
  selectedPo?: string;
  selectedLine?: string;
  mappingConfirmed?: boolean;
  duplicateResolution?: { reason: string; actor: string; at: string };
  voided?: { reason: string; actor: string; at: string };
  pageCount?: number;
};
export type Workspace = {
  schema: 1;
  procurement: Procurement;
  cases: InvoiceCase[];
};
export const FIELD_LABELS: Record<FieldKey, string> = {
  vendor: "Supplier",
  entity: "Buyer",
  reference: "Invoice number",
  date: "Invoice date",
  currency: "Currency",
  po: "PO reference",
  net: "Net amount",
  tax: "Stated tax",
  total: "Invoice total",
  servicePeriod: "Service period",
  fees: "Additional charges",
  discount: "Discount",
};
export const CRITICAL: FieldKey[] = [
  "vendor",
  "entity",
  "reference",
  "date",
  "currency",
  "net",
  "tax",
  "total",
];
export const STAGES: { id: Stage; label: string }[] = [
  { id: "received", label: "Received" },
  { id: "read", label: "Read PDF" },
  { id: "extract", label: "Extracted" },
  { id: "validate", label: "Validated" },
  { id: "match", label: "PO lookup" },
  { id: "policy", label: "Checked policy" },
  { id: "record", label: "Recorded" },
];
export const OUTCOME_LABELS: Record<Outcome, string> = {
  ready: "Ready for approval",
  review: "Needs review",
  blocked: "Blocked",
};
