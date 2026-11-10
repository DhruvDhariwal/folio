"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileCheck2,
  FileSearch,
  FileText,
  FolderOpen,
  History,
  Inbox,
  Layers3,
  LoaderCircle,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Upload,
  X,
  Link2,
  BookOpen,
  ScanLine,
  CheckCircle2,
  LockKeyhole,
  Ban,
} from "lucide-react";
import { PDFViewer } from "./pdf-viewer";
import { extractPDF } from "../../lib/folio/extract";
import {
  candidatePOs,
  cents,
  decimal,
  latest,
  money,
  POLICY,
} from "../../lib/folio/rules";
import {
  CRITICAL,
  FIELD_LABELS,
  OUTCOME_LABELS,
  STAGES,
  type Workspace,
  type InvoiceCase,
  type Extraction,
  type SourceLine,
  type Decision,
  type FieldKey,
  type Check as RuleCheck,
  type PO,
} from "../../lib/folio/types";
import { importCSVs } from "../../lib/folio/csv";
import { INDIAN_EXAMPLES } from "../../lib/folio/examples";

const SAMPLES = [
  {
    file: "clean-invoice.pdf",
    title: "A clean invoice",
    text: "Explicit PO, clear line items",
    icon: FileCheck2,
    tone: "green",
  },
  {
    file: "po-overrun.pdf",
    title: "The final invoice",
    text: "Earlier bills change the answer",
    icon: Layers3,
    tone: "red",
  },
  {
    file: "reissued-invoice.pdf",
    title: "A familiar obligation",
    text: "A reissue with a new reference",
    icon: FileSearch,
    tone: "amber",
  },
  {
    file: "missing-po.pdf",
    title: "Which purchase?",
    text: "Bundled work, missing PO",
    icon: Link2,
    tone: "blue",
  },
  {
    file: "tax-included-scan.pdf",
    title: "Read the fine print",
    text: "A scan with tax already included",
    icon: ScanLine,
    tone: "purple",
  },
];
type View = "queue" | "history" | "procurement";
type Dialog = { title: string; content: ReactNode };
function download(name: string, value: unknown) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function time(s: string) {
  return new Date(s).toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}
function Badge({ outcome, voided }: { outcome?: string; voided?: boolean }) {
  return (
    <span className={`badge ${voided ? "neutral" : outcome || "neutral"}`}>
      <span />
      {voided
        ? "Voided"
        : OUTCOME_LABELS[outcome as keyof typeof OUTCOME_LABELS] ||
          (outcome === "failed"
            ? "Processing failed"
            : outcome === "processing"
              ? "Processing"
              : "Awaiting extraction")}
    </span>
  );
}

export default function FolioApp({
  request = fetch,
  browserWorkspace = false,
}: {
  request?: (path: string, options?: RequestInit) => Promise<Response>;
  browserWorkspace?: boolean;
} = {}) {
  async function api(path: string, options?: RequestInit) {
    const res = await request(path, options);
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok)
      throw new Error(String(data.error || "The request could not finish."));
    return data;
  }
  const [ws, setWs] = useState<Workspace>(),
    [user, setUser] = useState<{ name: string; email: string }>(),
    [view, setView] = useState<View>("queue"),
    [selected, setSelected] = useState<string>(),
    [historical, setHistorical] = useState<string>(),
    [filter, setFilter] = useState("all"),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [working, setWorking] = useState<string>(),
    [progress, setProgress] = useState(""),
    [source, setSource] = useState<SourceLine>(),
    [editing, setEditing] = useState(false),
    [dialog, setDialog] = useState<Dialog>(),
    [busy, setBusy] = useState(false),
    [dragging, setDragging] = useState(false),
    [exampleIndex, setExampleIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null),
    csvInput = useRef<HTMLInputElement>(null),
    searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (
        dialog ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target.isContentEditable ||
        /INPUT|TEXTAREA|SELECT/.test(target.tagName)
      )
        return;
      if (event.key === "/" && !selected && view !== "procurement") {
        event.preventDefault();
        searchInput.current?.focus();
      }
      if (event.key.toLowerCase() === "n" && !working && !busy && ws) {
        event.preventDefault();
        input.current?.click();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [dialog, selected, view, working, busy, ws]);
  async function refresh() {
    const data = await api("/api/workspace");
    setWs(data.state as Workspace);
    setUser(data.user as { name: string; email: string });
    return data.state as Workspace;
  }
  useEffect(() => {
    refresh()
      .then(() => {
        const id = new URLSearchParams(window.location.search).get("case");
        if (id) setSelected(id);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    if (!dialog) return;
    const panel = document.querySelector<HTMLElement>(".dialog");
    const first = panel?.querySelector<HTMLElement>(
      "textarea,input,button,a[href]",
    );
    first?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDialog(undefined);
        return;
      }
      if (event.key !== "Tab" || !panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          "button:not([disabled]),a[href],input:not([disabled]),textarea:not([disabled]),select:not([disabled])",
        ),
      );
      const start = items[0],
        end = items[items.length - 1];
      if (event.shiftKey && document.activeElement === start) {
        event.preventDefault();
        end?.focus();
      } else if (!event.shiftKey && document.activeElement === end) {
        event.preventDefault();
        start?.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [dialog]);
  function open(id: string) {
    setSelected(id);
    setHistorical(undefined);
    setEditing(false);
    setSource(undefined);
    setError("");
    window.history.replaceState({}, "", `?case=${id}`);
    window.scrollTo(0, 0);
  }
  function back() {
    setSelected(undefined);
    setHistorical(undefined);
    setEditing(false);
    setSource(undefined);
    window.history.replaceState({}, "", window.location.pathname);
    window.scrollTo(0, 0);
  }
  const current = ws?.cases.find((c) => c.id === selected);
  const decision = current
    ? historical
      ? current.decisions.find((d) => d.id === historical)
      : latest(current)
    : undefined;
  const invoice = decision?.invoice || current?.extraction;
  async function postCase(id: string, body: Record<string, unknown>) {
    const result = await api(`/api/cases/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (result.state) setWs(result.state as Workspace);
    return result;
  }
  async function process(id: string, state = ws) {
    if (!state) return;
    setWorking(id);
    setProgress("Opening PDF");
    setError("");
    try {
      const response = await request(`/api/documents/${id}`);
      if (!response.ok)
        throw new Error("The original PDF could not be loaded.");
      const extracted = await extractPDF(
        await response.arrayBuffer(),
        state.procurement.vendors,
        async (stage, status, message) => {
          setProgress(message);
          await postCase(id, {
            action: "stage",
            stage,
            status,
            message,
            retry: true,
          });
        },
        setProgress,
      );
      setProgress("Checking procurement rules and recording the decision");
      await postCase(id, { action: "extract", extraction: extracted });
      setNotice(
        "Invoice checks completed. Local extraction needs source confirmation before clearance.",
      );
    } catch (e) {
      const message =
        e instanceof Error ? e.message : "The document could not be read.";
      setError(message);
      try {
        await postCase(id, { action: "failure", error: message });
      } catch {
        /* Preserve the original error if status persistence is unavailable. */
      }
    } finally {
      setWorking(undefined);
      setProgress("");
    }
  }
  async function upload(file: File) {
    if (working || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const form = new FormData();
      form.set("file", file);
      const data = await api("/api/documents", { method: "POST", body: form });
      const state = data.state as Workspace;
      setWs(state);
      const result = data.result as { id: string; existing: boolean };
      open(result.id);
      setBusy(false);
      if (
        result.existing &&
        state.cases.find((c) => c.id === result.id)?.extraction
      )
        setNotice(
          "This exact PDF was already received. The original case is open; no second obligation was created.",
        );
      else await process(result.id, state);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }
  async function sample(file: string) {
    try {
      const r = await fetch(`/samples/${file}`);
      if (!r.ok) throw new Error("Sample PDF is unavailable.");
      await upload(
        new File([await r.blob()], file.split("/").pop()!, {
          type: "application/pdf",
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function act(body: Record<string, unknown>) {
    if (!current) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await postCase(current.id, {
        ...body,
        expectedRevision: current.decisions.length,
      });
      setHistorical(undefined);
      setEditing(false);
      setDialog(undefined);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function evidence(id: string) {
    const located = invoice?.sources.find((s) => s.id === id);
    if (located) {
      setSource(located);
      document
        .querySelector(".source-panel")
        ?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      return;
    }
    if (id.startsWith("case:")) {
      open(id.slice(5));
      return;
    }
    if (
      id.startsWith("po:") ||
      id === "prior-commitments" ||
      id.startsWith("commitment:")
    ) {
      const po = ws?.procurement.pos.find(
        (p) => p.id === (decision?.poId || id.slice(3).split("/")[0]),
      );
      const h =
        decision?.balance?.history ||
        ws?.procurement.commitments
          .filter((c) => c.poId === po?.id)
          .map((c) => ({
            reference: c.reference,
            net: c.net,
            kind: "Imported approved obligation",
          })) ||
        [];
      setDialog({
        title: "Procurement evidence",
        content: (
          <>
            <p className="muted">
              {po?.id} · {po?.project}
              <br />
              Decision dataset v
              {decision?.datasetVersion || ws?.procurement.version}. The values
              below preserve the basis used for this decision.
            </p>
            {decision?.balance && (
              <div className="dialog-total">
                <span>Authorized net cap at decision</span>
                <strong>
                  {money(
                    decision.balance.cap,
                    decision.invoice.fields.currency.value,
                  )}
                </strong>
              </div>
            )}
            <div className="ledger-list">
              {h.map((v, i) => (
                <div key={i}>
                  <div>
                    <strong>{v.reference}</strong>
                    <small>{v.kind}</small>
                  </div>
                  <b>
                    {money(
                      v.net,
                      decision?.invoice.fields.currency.value || po?.currency,
                    )}
                  </b>
                </div>
              ))}
              {!h.length && <p>No previous commitments for this purchase.</p>}
            </div>
            {h.some((v) => v.reference === "NS-0418") && (
              <a
                className="text-link"
                href="/samples/original-NS-0418.pdf"
                target="_blank"
                rel="noreferrer"
              >
                Open original fictional invoice NS-0418{" "}
                <ArrowUpRight size={14} />
              </a>
            )}
            <p className="fine-print">
              Imported records are synthetic procurement data. Live ERP
              verification is outside this version.
            </p>
          </>
        ),
      });
      return;
    }
    setDialog({
      title: "Evidence reference",
      content: (
        <p>
          This check uses the{" "}
          {id === "procurement:vendors"
            ? "approved supplier dataset"
            : "recorded calculation"}
          . Open Procurement data to inspect the current source records.
        </p>
      ),
    });
  }
  function policy() {
    setDialog({
      title: "The rules behind the decision",
      content: (
        <>
          <p className="muted">Policy {POLICY} · Explicit prototype rules</p>
          <div className="policy-list">
            {[
              [
                "Required evidence",
                "Local extraction is unscored. A person must confirm critical fields and line values.",
              ],
              [
                "Price variance",
                "An increase must fit both 2% of expected net and the currency cap: USD 20 or INR 100. These are demo controls, not exchange-rate equivalents. A reduction above 10% needs review.",
              ],
              [
                "PO capacity",
                "Prior approved obligations plus active local reservations plus this invoice may not exceed PO or line caps.",
              ],
              [
                "Duplicate identity",
                "Exact supplier, entity and invoice reference cannot create a second obligation. Similar reissues need review.",
              ],
              [
                "Decision boundary",
                "Two-way invoice and PO checks do not authorize payment or confirm delivery.",
              ],
            ].map(([title, text]) => (
              <div key={title}>
                <strong>{title}</strong>
                <p>{text}</p>
              </div>
            ))}
          </div>
        </>
      ),
    });
  }
  function amend(po: PO) {
    setDialog({
      title: `Amend ${po.id}`,
      content: (
        <Amendment
          po={po}
          busy={busy}
          save={async (cap, reason) => {
            setBusy(true);
            setError("");
            try {
              const result = await api("/api/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  action: "amend",
                  poId: po.id,
                  cap,
                  reason,
                }),
              });
              setWs(result.state as Workspace);
              setDialog(undefined);
              setNotice(
                "Authorized cap updated as a new procurement version. Existing decision receipts remain unchanged; recheck the relevant invoice.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        />
      ),
    });
  }
  const counts = {
    all: ws?.cases.filter((c) => !c.voided).length || 0,
    review:
      ws?.cases.filter((c) => !c.voided && latest(c)?.outcome === "review")
        .length || 0,
    blocked:
      ws?.cases.filter((c) => !c.voided && latest(c)?.outcome === "blocked")
        .length || 0,
    ready:
      ws?.cases.filter((c) => !c.voided && latest(c)?.outcome === "ready")
        .length || 0,
  };
  const filtered = (ws?.cases || []).filter(
    (c) =>
      (view === "history" || !c.voided) &&
      (filter === "all" || latest(c)?.outcome === filter) &&
      `${c.filename} ${c.extraction?.fields.vendor.value} ${c.extraction?.fields.reference.value}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const example = INDIAN_EXAMPLES[exampleIndex];
  const publicExample = INDIAN_EXAMPLES.find(
    (item) => item.file.split("/").pop() === current?.filename,
  );
  return (
    <div className={`app-shell ${current ? "detail-view" : ""}`}>
      <a className="skip-link" href="#workspace-content">
        Skip to workspace
      </a>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            back();
            setView("queue");
          }}
        >
          <span>Folio</span>
        </a>
        <nav aria-label="Workspace navigation">
          {[
            { id: "queue", icon: Inbox, label: "Invoices", count: counts.all },
            { id: "history", icon: History, label: "History" },
            { id: "procurement", icon: Layers3, label: "Purchases" },
          ].map((n) => (
            <button
              key={n.id}
              aria-label={n.label}
              aria-current={view === n.id ? "page" : undefined}
              title={n.label}
              className={view === n.id ? "active" : ""}
              onClick={() => {
                back();
                setView(n.id as View);
                setFilter("all");
              }}
            >
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="sidebar-policy"
            title="Decision policy"
            onClick={policy}
          >
            <ShieldCheck size={17} />
            <span>Policy</span>
          </button>
          <button
            className="icon-button"
            title="Refresh saved workspace"
            aria-label="Refresh saved workspace"
            onClick={() => refresh().catch((e) => setError(e.message))}
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <main id="workspace-content">
          {error && (
            <div role="alert" className="message error">
              <CircleAlert size={18} />
              <span>{error}</span>
              {!browserWorkspace && error.includes("Sign in") && (
                <a href="/signin-with-chatgpt?return_to=/" target="_top">
                  Sign in
                </a>
              )}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={15} />
              </button>
            </div>
          )}
          {notice && (
            <div className="message notice">
              <CheckCircle2 size={17} />
              <span>{notice}</span>
              <button onClick={() => setNotice("")} aria-label="Dismiss notice">
                <X size={15} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-screen">
              <LoaderCircle className="spin" size={24} />
              <p>Opening your invoice workspace</p>
            </div>
          ) : selected && current ? (
            <>
              <div className="case-top">
                <button className="back-button" onClick={back}>
                  <ArrowLeft size={15} /> All invoices
                </button>
                <div className="case-actions">
                  {decision && (
                    <button
                      className="button secondary"
                      onClick={() =>
                        download(
                          `folio-${invoice?.fields.reference.value || current.id}-r${decision.revision}.json`,
                          {
                            ...decision,
                            document: {
                              id: current.id,
                              hash: current.hash,
                              filename: current.filename,
                            },
                          },
                        )
                      }
                    >
                      <ArrowDownToLine size={15} /> Export receipt
                    </button>
                  )}
                  <button
                    className="button primary"
                    disabled={!!working || busy}
                    onClick={() => input.current?.click()}
                  >
                    <Plus size={16} /> Upload invoice
                  </button>
                </div>
              </div>
              <div className="case-heading">
                <div>
                  <h1>{invoice?.fields.vendor.value || current.filename}</h1>
                  <div className="case-meta">
                    <span>
                      {invoice?.fields.reference.value ||
                        "Reference not yet extracted"}
                    </span>
                    <i />
                    <span>
                      {invoice?.fields.total.value
                        ? `${money(cents(invoice.fields.total.value) || 0, invoice.fields.currency.value)} gross`
                        : current.filename}
                    </span>
                    <i />
                    <span>
                      {current.pageCount
                        ? `${current.pageCount} page${current.pageCount > 1 ? "s" : ""}`
                        : "PDF document"}
                    </span>
                  </div>
                </div>
                <Badge
                  outcome={decision?.outcome || current.status}
                  voided={!!current.voided}
                />
              </div>
              {publicExample && (
                <p className="source-provenance">
                  Published Indian invoice · Privacy-edited copy.{" "}
                  <a
                    href={publicExample.source}
                    target="_blank"
                    rel="noreferrer"
                  >
                    View source <ArrowUpRight size={12} />
                  </a>{" "}
                  Purchase records have not been supplied.
                </p>
              )}
              <div className="stage-strip" aria-live="polite">
                {STAGES.map((s, i) => {
                  const event = [...current.events]
                    .reverse()
                    .find((e) => e.stage === s.id);
                  return (
                    <button
                      key={s.id}
                      className={`stage ${event?.status || "pending"}`}
                      onClick={() =>
                        setDialog({
                          title: s.label,
                          content: (
                            <div className="event-list">
                              {current.events
                                .filter((e) => e.stage === s.id)
                                .map((e) => (
                                  <div key={e.id}>
                                    <span
                                      className={
                                        e.status === "failed" ? "red" : "green"
                                      }
                                    >
                                      {e.status === "done" ? (
                                        <Check size={14} />
                                      ) : e.status === "failed" ? (
                                        <CircleAlert size={14} />
                                      ) : (
                                        <Clock3 size={14} />
                                      )}
                                    </span>
                                    <div>
                                      <p>{e.message}</p>
                                      <small>{time(e.at)}</small>
                                    </div>
                                  </div>
                                ))}
                              {!event && <p>This stage has not run yet.</p>}
                            </div>
                          ),
                        })
                      }
                    >
                      <span className="stage-dot">
                        {event?.status === "done" ? (
                          <Check size={10} />
                        ) : event?.status === "running" ? (
                          <LoaderCircle className="spin" size={11} />
                        ) : event?.status === "failed" ? (
                          <X size={10} />
                        ) : (
                          i + 1
                        )}
                      </span>
                      <span>{s.label}</span>
                      {i < STAGES.length - 1 && (
                        <span className="stage-connector" />
                      )}
                    </button>
                  );
                })}
              </div>
              {working === current.id && (
                <div className="processing-line" role="status">
                  <LoaderCircle size={16} className="spin" />
                  {progress}
                  <span>Actual processing · keep this tab open</span>
                </div>
              )}
              {decision &&
                ws &&
                decision.datasetVersion !== ws.procurement.version &&
                !historical && (
                  <div className="message notice">
                    <CircleAlert size={16} />
                    <span>
                      Procurement data changed after this receipt. Recheck this
                      invoice before continuing; the saved decision below
                      preserves the earlier data.
                    </span>
                    <button
                      className="text-link"
                      disabled={busy || !!working}
                      onClick={() =>
                        act({
                          action: "recheck",
                          reason: "Rechecked after procurement data changed",
                        })
                      }
                    >
                      Recheck <RefreshCw size={13} />
                    </button>
                  </div>
                )}
              {!invoice && !working && (
                <div className="resume-bar">
                  <p>
                    {current.status === "failed"
                      ? current.error
                      : "The original PDF is saved. Read it locally to continue."}
                  </p>
                  <button
                    className="button primary"
                    onClick={() => process(current.id)}
                  >
                    Read invoice <ArrowRight size={15} />
                  </button>
                </div>
              )}
              <div className="case-grid">
                <div className="decision-column">
                  {historical && decision && (
                    <div className="historical-banner">
                      <History size={16} />
                      <span>
                        Historical receipt · revision {decision.revision}
                        <small>
                          Amounts and checks are preserved from{" "}
                          {time(decision.at)}.
                        </small>
                      </span>
                      <button onClick={() => setHistorical(undefined)}>
                        Current <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                  {editing && current.extraction && ws ? (
                    <CorrectionEditor
                      key={current.id + current.decisions.length}
                      current={current}
                      workspace={ws}
                      busy={busy}
                      onSource={evidence}
                      cancel={() => setEditing(false)}
                      save={(extraction, reason, selectedPo, selectedLine) =>
                        act({
                          action: "correct",
                          extraction,
                          reason,
                          selectedPo,
                          selectedLine,
                        })
                      }
                    />
                  ) : decision ? (
                    <>
                      <section
                        className={`panel decision-card ${decision.outcome}`}
                      >
                        <div className="decision-kicker">
                          <span>Decision</span>
                          <span>
                            R{String(decision.revision).padStart(2, "0")}
                          </span>
                        </div>
                        <div className={`decision-symbol ${decision.outcome}`}>
                          {decision.outcome === "ready" ? (
                            <CheckCheck size={23} />
                          ) : decision.outcome === "blocked" ? (
                            <Ban size={23} />
                          ) : (
                            <FileSearch size={23} />
                          )}
                        </div>
                        <h2>
                          {decision.outcome === "blocked" &&
                          decision.balance &&
                          decision.balance.remaining < 0
                            ? `PO capacity exceeded by ${money(-decision.balance.remaining, decision.invoice.fields.currency.value)}`
                            : OUTCOME_LABELS[decision.outcome]}
                        </h2>
                        <p>{decision.summary}</p>
                        <div className="decision-footer">
                          <button onClick={policy}>
                            Policy {decision.policy}
                            <ArrowUpRight size={11} />
                          </button>
                          <span>Dataset v{decision.datasetVersion}</span>
                          <span>Net basis</span>
                          <span>
                            {
                              decision.checks.filter((c) => c.status === "pass")
                                .length
                            }{" "}
                            checks passed
                          </span>
                        </div>
                      </section>
                      {decision.balance && (
                        <BalanceCard
                          decision={decision}
                          onEvidence={evidence}
                        />
                      )}
                      <section className="panel next-action">
                        <div className="eyebrow">Next step</div>
                        <p>{decision.nextAction}</p>
                        <div className="action-caption">
                          {decision.outcome === "ready"
                            ? "Local net capacity reserved once"
                            : "No local capacity reserved"}{" "}
                          · {current.voided ? "Case voided" : "AP review"}
                        </div>
                        {!historical && !current.voided && (
                          <div className="next-buttons">
                            <button
                              className="button primary"
                              disabled={busy}
                              onClick={() => setEditing(true)}
                            >
                              {decision.outcome === "ready"
                                ? "Inspect source values"
                                : "Review source values"}
                              <ArrowRight size={15} />
                            </button>
                            <button
                              className="text-link"
                              disabled={busy}
                              onClick={() =>
                                act({
                                  action: "recheck",
                                  reason:
                                    "Rechecked against current procurement data",
                                })
                              }
                            >
                              <RefreshCw size={13} /> Recheck
                            </button>
                          </div>
                        )}
                      </section>
                      <section className="panel checks-panel">
                        <div className="panel-heading">
                          <span>
                            <ShieldCheck size={15} /> Checks and evidence
                          </span>
                          <span className="small-count">
                            {decision.checks.length}
                          </span>
                        </div>
                        {decision.checks.map((k) => (
                          <CheckRow
                            key={k.id}
                            check={k}
                            onEvidence={evidence}
                          />
                        ))}
                        {!historical &&
                          !current.voided &&
                          decision.checks.some(
                            (k) =>
                              k.id === "duplicate" && k.status === "review",
                          ) && (
                            <div className="duplicate-resolution">
                              <button
                                className="text-link"
                                onClick={() =>
                                  setDialog({
                                    title: "Resolve a possible duplicate",
                                    content: (
                                      <ReasonForm
                                        label="Explain the distinct obligation"
                                        help="Compare the original invoice and service period. Exact duplicate identities remain blocked even after this action."
                                        button="Record resolution and recheck"
                                        min={15}
                                        save={(reason) =>
                                          act({ action: "distinct", reason })
                                        }
                                      />
                                    ),
                                  })
                                }
                              >
                                Document a distinct obligation{" "}
                                <ArrowRight size={14} />
                              </button>
                            </div>
                          )}
                      </section>
                    </>
                  ) : (
                    <section className="panel awaiting-card">
                      <div className="awaiting-icon">
                        <FileSearch size={32} />
                      </div>
                      <h2>
                        {working
                          ? "Reading the invoice"
                          : "The decision will appear here"}
                      </h2>
                      <p>
                        {working
                          ? "Document values are being read locally. Procurement checks will follow the extraction."
                          : "The original document is saved. Start local extraction to check the invoice."}
                      </p>
                    </section>
                  )}
                  {current.decisions.length > 0 && (
                    <section className="panel revisions">
                      <div className="panel-heading">
                        <span>
                          <History size={15} /> Decision history
                        </span>
                        <span className="small-count">
                          {current.decisions.length}
                        </span>
                      </div>
                      {[...current.decisions].reverse().map((d) => (
                        <button
                          key={d.id}
                          className={decision?.id === d.id ? "selected" : ""}
                          onClick={() => {
                            setHistorical(
                              d.id === latest(current).id ? undefined : d.id,
                            );
                            setEditing(false);
                            setSource(undefined);
                          }}
                        >
                          <span className="revision-number">
                            {String(d.revision).padStart(2, "0")}
                          </span>
                          <div>
                            <strong>{OUTCOME_LABELS[d.outcome]}</strong>
                            <small>
                              {time(d.at)} · {d.actor}
                              <br />
                              {d.note}
                            </small>
                          </div>
                          <ChevronRight size={15} />
                        </button>
                      ))}
                      {!current.voided && !working && (
                        <button
                          className="void-action"
                          onClick={() =>
                            setDialog({
                              title: "Void this local case",
                              content: (
                                <ReasonForm
                                  label="Reason for releasing the reservation"
                                  help="The history and original PDF are preserved. This releases only Folio's local capacity claim; it does not reverse a payment."
                                  button="Void case"
                                  min={5}
                                  save={(reason) =>
                                    act({ action: "void", reason })
                                  }
                                />
                              ),
                            })
                          }
                        >
                          Void case and release local reservation
                        </button>
                      )}
                      {current.voided && (
                        <p className="void-note">
                          Voided by {current.voided.actor}:{" "}
                          {current.voided.reason}
                        </p>
                      )}
                    </section>
                  )}
                </div>
                <PDFViewer
                  request={browserWorkspace ? request : undefined}
                  id={current.id}
                  extraction={invoice}
                  source={source}
                />
              </div>
              <div className="boundary-note">
                <ShieldCheck size={14} /> Invoice and PO checked. Delivery and
                payment authorization remain outside this workflow.
              </div>
            </>
          ) : view === "procurement" && ws ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>Purchases.</h1>
                  <p>
                    Approved purchases, supplier records and prior obligations.
                  </p>
                </div>
                <div className="heading-actions">
                  <button
                    className="button secondary"
                    onClick={() =>
                      download("folio-procurement.json", ws.procurement)
                    }
                  >
                    <ArrowDownToLine size={15} /> Export data
                  </button>
                  <button
                    className="button primary"
                    onClick={() => csvInput.current?.click()}
                  >
                    <Upload size={15} /> Import CSVs
                  </button>
                </div>
              </div>
              <input
                ref={csvInput}
                hidden
                type="file"
                accept=".csv,text/csv"
                multiple
                onChange={async (e) => {
                  if (!e.target.files?.length) return;
                  setBusy(true);
                  setError("");
                  try {
                    const data = await importCSVs(Array.from(e.target.files));
                    const result = await api("/api/workspace", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ action: "import", data }),
                    });
                    setWs(result.state as Workspace);
                    setNotice(
                      "Procurement files validated and activated as a new dataset version.",
                    );
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                    if (csvInput.current) csvInput.current.value = "";
                  }
                }}
              />
              <div className="dataset-notice">
                <BookOpen size={18} />
                <div>
                  <strong>
                    Synthetic procurement dataset · version{" "}
                    {ws.procurement.version}
                  </strong>
                  <span>
                    Imported {time(ws.procurement.importedAt)}. These records
                    are fictional and do not connect to an ERP.
                  </span>
                </div>
                <span className="dataset-tag">
                  INR / USD · No currency conversion
                </span>
              </div>
              <section className="panel data-panel">
                <div className="panel-heading">
                  <span>Purchase orders</span>
                  <span className="small-count">
                    {ws.procurement.pos.length}
                  </span>
                </div>
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th>Purchase order</th>
                        <th>Supplier</th>
                        <th>Approved net</th>
                        <th>Committed net</th>
                        <th>Available net</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {ws.procurement.pos.map((po) => {
                        const committed =
                          ws.procurement.commitments
                            .filter((k) => k.poId === po.id)
                            .reduce((a, k) => a + k.net, 0) +
                          ws.cases
                            .filter(
                              (c) =>
                                !c.voided &&
                                latest(c)?.poId === po.id &&
                                latest(c).outcome === "ready",
                            )
                            .reduce(
                              (a, c) =>
                                a +
                                (cents(latest(c).invoice.fields.net.value) ||
                                  0),
                              0,
                            );
                        return (
                          <tr key={po.id}>
                            <td>
                              <strong>{po.id}</strong>
                              <small>{po.project}</small>
                            </td>
                            <td>
                              {
                                ws.procurement.vendors.find(
                                  (v) => v.id === po.vendorId,
                                )?.name
                              }
                            </td>
                            <td className="amount">
                              {money(po.cap, po.currency)}
                            </td>
                            <td className="amount">
                              {money(committed, po.currency)}
                            </td>
                            <td className="amount">
                              {money(po.cap - committed, po.currency)}
                            </td>
                            <td>
                              <button
                                className="text-link"
                                onClick={() => amend(po)}
                              >
                                Amend <ArrowUpRight size={13} />
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>
              <div className="data-columns">
                <section className="panel data-panel">
                  <div className="panel-heading">
                    <span>Approved suppliers</span>
                  </div>
                  {ws.procurement.vendors.map((v) => (
                    <div className="vendor-row" key={v.id}>
                      <div className="vendor-avatar">{v.name.slice(0, 1)}</div>
                      <div>
                        <strong>{v.name}</strong>
                        <small>
                          {v.id} · {v.currency}
                        </small>
                      </div>
                      <span
                        className={`badge ${v.active ? "ready" : "neutral"}`}
                      >
                        <span />
                        {v.active ? "Active" : "Inactive"}
                      </span>
                    </div>
                  ))}
                </section>
                <section className="panel data-panel">
                  <div className="panel-heading">
                    <span>Imported prior commitments</span>
                  </div>
                  <div className="ledger-list">
                    {ws.procurement.commitments.map((c) => (
                      <div key={c.id}>
                        <div>
                          <strong>{c.reference}</strong>
                          <small>
                            {c.poId} · {c.date}
                          </small>
                        </div>
                        <b>{money(c.net, c.currency)}</b>
                      </div>
                    ))}
                  </div>
                  <p className="fine-print">
                    Imported obligations are counted once. Folio reservations
                    are added separately.
                  </p>
                </section>
              </div>
              <p className="fine-print">
                To import the provided seed dataset, select vendors.csv,
                purchase_orders.csv, po_lines.csv and prior_commitments.csv
                together. Existing invoice history preserves its original
                dataset version.
              </p>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>{view === "history" ? "History." : "Invoices."}</h1>
                  <p>
                    {view === "history"
                      ? "Every decision, with its original context."
                      : "A clear view of the document and the decision."}
                  </p>
                </div>
                <button
                  className="button primary"
                  disabled={!!working || busy || !ws}
                  onClick={() => input.current?.click()}
                >
                  <Plus size={17} /> Upload invoice
                </button>
              </div>
              {view !== "history" && (
                <section
                  className={`intake ${dragging ? "dragging" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDragging(false);
                    const file = e.dataTransfer.files[0];
                    if (file) void upload(file);
                  }}
                >
                  <div className="intake-copy">
                    <h2>
                      Open a PDF.
                      <br />
                      <span>Make sense of it.</span>
                    </h2>
                    <p>
                      See the original beside the checks that explain what needs
                      your attention.
                    </p>
                    <button
                      className="button primary"
                      disabled={!!working || busy || !ws}
                      onClick={() => input.current?.click()}
                    >
                      Choose a PDF
                    </button>
                    <span className="intake-limit">
                      Or drop it here. Up to 5 pages, 10 MB.
                    </span>
                    <div className="intake-privacy">
                      <LockKeyhole size={15} />
                      <span>
                        Text and scans are read in your browser.
                        <br />
                        {browserWorkspace
                          ? "PDFs and history stay in this browser."
                          : "Documents stay in your private workspace."}
                      </span>
                    </div>
                  </div>
                  <div className="invoice-showcase">
                    <div
                      className="example-picker"
                      role="group"
                      aria-label="Indian invoice examples"
                    >
                      {INDIAN_EXAMPLES.map((item, i) => (
                        <button
                          key={item.file}
                          aria-pressed={exampleIndex === i}
                          onClick={() => setExampleIndex(i)}
                        >
                          {item.title}
                        </button>
                      ))}
                    </div>
                    <button
                      className="invoice-preview"
                      disabled={!!working || busy || !ws}
                      onClick={() => sample(example.file)}
                      aria-label={`Review ${example.reference} from ${example.recipient}`}
                    >
                      <img
                        src={example.preview}
                        alt={`Published Indian ${example.title.toLowerCase()}, ${example.reference}`}
                      />
                    </button>
                  </div>
                  <div className="example-caption">
                    <div>
                      <strong>{example.supplier}</strong>
                      <span>
                        {example.title} · {example.reference}
                      </span>
                    </div>
                    <div>
                      <button
                        className="text-link"
                        disabled={!!working || busy || !ws}
                        onClick={() => sample(example.file)}
                      >
                        Try this invoice <ChevronRight size={16} />
                      </button>
                      <a href={example.source} target="_blank" rel="noreferrer">
                        Published source <ArrowUpRight size={12} />
                      </a>
                    </div>
                  </div>
                </section>
              )}
              {view !== "history" && (
                <p className="source-disclosure">
                  Real Indian invoices, published by the institutions that
                  received them. Demo copies omit banking and personal contact
                  details. Their purchase records have not been supplied.
                </p>
              )}
              <div className="workspace-heading">
                <h2>
                  {view === "history" ? "Saved activity" : "Your workspace"}
                </h2>
                <span>
                  {counts.all} invoice{counts.all === 1 ? "" : "s"}
                </span>
              </div>

              <section className="panel invoice-list">
                <div className="list-toolbar">
                  <div className="tabs">
                    {[
                      ["all", "All invoices"],
                      ["review", "Needs review"],
                      ["blocked", "Blocked"],
                      ["ready", "Ready"],
                    ].map(([k, label]) => (
                      <button
                        key={k}
                        className={filter === k ? "active" : ""}
                        aria-pressed={filter === k}
                        onClick={() => setFilter(k)}
                      >
                        {label}
                        <span>{counts[k as keyof typeof counts]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="search">
                    <Search size={15} />
                    <input
                      ref={searchInput}
                      aria-label="Search invoices"
                      placeholder="Search invoices…"
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                    />
                    <kbd>/</kbd>
                  </label>
                </div>
                {filtered.length ? (
                  <div className="table-scroll">
                    <table className="invoice-table">
                      <thead>
                        <tr>
                          <th>Invoice / supplier</th>
                          <th>Gross amount</th>
                          <th>Decision</th>
                          <th>Latest result</th>
                          <th>Received</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((c) => {
                          const d = latest(c);
                          return (
                            <tr
                              key={c.id}
                              onClick={() => open(c.id)}
                              tabIndex={0}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") open(c.id);
                              }}
                            >
                              <td>
                                <div className="invoice-cell">
                                  <div className="file-icon">
                                    <FileText size={18} />
                                  </div>
                                  <div>
                                    <strong>
                                      {c.extraction?.fields.vendor.value ||
                                        c.filename}
                                    </strong>
                                    <small>
                                      {c.extraction?.fields.reference.value ||
                                        "Not yet extracted"}
                                    </small>
                                  </div>
                                </div>
                              </td>
                              <td className="amount">
                                {c.extraction?.fields.total.value
                                  ? money(
                                      cents(c.extraction.fields.total.value) ||
                                        0,
                                      c.extraction.fields.currency.value,
                                    )
                                  : "—"}
                              </td>
                              <td>
                                <Badge
                                  outcome={d?.outcome || c.status}
                                  voided={!!c.voided}
                                />
                              </td>
                              <td className="reason-cell">
                                {c.voided
                                  ? c.voided.reason
                                  : d?.summary ||
                                    c.error ||
                                    "Original saved. Continue extraction."}
                              </td>
                              <td className="date-cell">
                                {new Date(c.createdAt).toLocaleDateString(
                                  "en-IN",
                                  { day: "2-digit", month: "short" },
                                )}
                                <small>
                                  {c.decisions.length
                                    ? `${c.decisions.length} revision${c.decisions.length > 1 ? "s" : ""}`
                                    : "Not processed"}
                                </small>
                              </td>
                              <td>
                                <ChevronRight size={15} />
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="empty-table">
                    <FolderOpen size={23} />
                    <strong>
                      {query || filter !== "all"
                        ? "No invoices match this view"
                        : "Your invoice history will appear here"}
                    </strong>
                    <p>
                      {query || filter !== "all"
                        ? "Try a different search or decision filter."
                        : "Real processing runs, saved decisions and source documents."}
                    </p>
                  </div>
                )}
              </section>
              {view !== "history" && (
                <details className="control-lab">
                  <summary>
                    <span>Explore the control scenarios</span>
                    <Plus size={18} />
                  </summary>
                  <p>
                    Fictional USD invoices paired with the demonstration
                    purchase records. The Indian examples above use real public
                    documents.
                  </p>
                  <div className="sample-grid">
                    {SAMPLES.map((s) => (
                      <button
                        key={s.file}
                        className="sample-card"
                        disabled={!!working || busy || !ws}
                        onClick={() => sample(s.file)}
                      >
                        <s.icon size={22} />
                        <strong>{s.title}</strong>
                        <p>{s.text}</p>
                        <span className="text-link">
                          Open scenario <ChevronRight size={13} />
                        </span>
                      </button>
                    ))}
                  </div>
                </details>
              )}
              <div className="workspace-foot">
                <span>
                  <LockKeyhole size={13} />{" "}
                  {browserWorkspace
                    ? "Saved in this browser"
                    : "Private invoice workspace"}
                </span>
                <span>PDFs and scans · Source-linked decisions</span>
                <button className="text-link" onClick={policy}>
                  How decisions work <ArrowUpRight size={13} />
                </button>
              </div>
            </>
          )}
        </main>
      </div>
      {dialog && (
        <div
          className="dialog-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setDialog(undefined);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-title"
            className="dialog"
          >
            <header>
              <h2 id="dialog-title">{dialog.title}</h2>
              <button
                onClick={() => setDialog(undefined)}
                aria-label="Close dialog"
              >
                <X size={19} />
              </button>
            </header>
            <div className="dialog-content">{dialog.content}</div>
          </section>
        </div>
      )}
    </div>
  );
}

function CheckRow({
  check: k,
  onEvidence,
}: {
  check: RuleCheck;
  onEvidence: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(
    k.status === "block" || k.status === "review",
  );
  return (
    <div className={`check-row ${k.status}`}>
      <button
        className="check-title"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className={`check-icon ${k.status}`}>
          {k.status === "pass" ? (
            <Check size={12} />
          ) : k.status === "na" ? (
            <span>–</span>
          ) : k.status === "block" ? (
            <X size={12} />
          ) : (
            <CircleAlert size={13} />
          )}
        </span>
        <strong>{k.label}</strong>
        <span className="check-state">
          {k.status === "pass"
            ? "Passed"
            : k.status === "na"
              ? "Not applicable"
              : k.status === "block"
                ? "Blocked"
                : "Review"}
        </span>
        <ChevronDown size={14} className={expanded ? "rotated" : ""} />
      </button>
      {expanded && (
        <div className="check-body">
          <p>{k.reason}</p>
          {(k.actual || k.expected || k.limit) && (
            <div className="check-values">
              {k.actual && (
                <div>
                  <small>OBSERVED</small>
                  <span>{k.actual}</span>
                </div>
              )}
              {k.expected && (
                <div>
                  <small>EXPECTED</small>
                  <span>{k.expected}</span>
                </div>
              )}
              {k.limit && (
                <div>
                  <small>LIMIT</small>
                  <span>{k.limit}</span>
                </div>
              )}
            </div>
          )}
          {!!k.evidence?.length && (
            <div className="evidence-links">
              {k.evidence.map((e, i) => (
                <button key={e + i} onClick={() => onEvidence(e)}>
                  <Link2 size={11} />
                  {e.startsWith("p") && e.includes("-s")
                    ? `Source ${i + 1}`
                    : e.startsWith("po:")
                      ? e.slice(3)
                      : e.startsWith("case:")
                        ? "Earlier invoice"
                        : e === "prior-commitments"
                          ? "Prior commitments"
                          : e.startsWith("commitment:")
                            ? "Prior invoice"
                            : "Source record"}
                  <ArrowUpRight size={10} />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
function BalanceCard({
  decision: d,
  onEvidence,
}: {
  decision: Decision;
  onEvidence: (id: string) => void;
}) {
  const b = d.balance!;
  const displayMoney = (n: number) => money(n, d.invoice.fields.currency.value);
  const consumed = Math.min(
      100,
      ((b.prior + b.local) / Math.max(1, b.cap)) * 100,
    ),
    current = Math.min(100 - consumed, (b.current / Math.max(1, b.cap)) * 100);
  return (
    <section className="panel balance-card">
      <div className="balance-title">
        <span>Purchase balance</span>
        <button onClick={() => onEvidence(`po:${b.poId}`)}>
          {b.poId}
          <ArrowUpRight size={12} />
        </button>
      </div>
      <p className="balance-project">{b.project}</p>
      <div className="capacity-meter">
        <span style={{ width: `${consumed}%` }} />
        <span style={{ width: `${current}%` }} />
        {b.remaining < 0 && <i />}
      </div>
      <div className="meter-legend">
        <span>
          <i /> Earlier commitments
        </span>
        <span>
          <i /> This invoice
        </span>
      </div>
      <div className="balance-rows">
        <div>
          <span>Approved net cap</span>
          <b>{displayMoney(b.cap)}</b>
        </div>
        <button onClick={() => onEvidence("prior-commitments")}>
          <span>
            Earlier obligations <Link2 size={11} />
          </span>
          <b>{displayMoney(b.prior + b.local)}</b>
        </button>
        <button
          onClick={() => {
            const id = d.invoice.fields.net.sourceId;
            if (id) onEvidence(id);
          }}
        >
          <span>
            This invoice net <Link2 size={11} />
          </span>
          <b>{displayMoney(b.current)}</b>
        </button>
        <div className={`balance-result ${b.remaining < 0 ? "red" : "green"}`}>
          <strong>
            {b.remaining < 0 ? "Capacity deficit" : "Remaining after invoice"}
          </strong>
          <b>{displayMoney(Math.abs(b.remaining))}</b>
        </div>
      </div>
    </section>
  );
}
function CorrectionEditor({
  current: c,
  workspace,
  busy,
  onSource,
  cancel,
  save,
}: {
  current: InvoiceCase;
  workspace: Workspace;
  busy: boolean;
  onSource: (id: string) => void;
  cancel: () => void;
  save: (e: Extraction, reason: string, po: string, line: string) => void;
}) {
  const [draft, setDraft] = useState<Extraction>(() => {
      const e = structuredClone(c.extraction!);
      if (!e.lines.length)
        e.lines = [
          {
            code: "",
            description: "",
            quantity: "",
            unitPrice: "",
            net: e.fields.net.value,
            confirmed: false,
          },
        ];
      return e;
    }),
    [reason, setReason] = useState(""),
    [verified, setVerified] = useState(false),
    [po, setPo] = useState(c.selectedPo || draft.fields.po.value),
    [line, setLine] = useState(c.selectedLine || draft.lines[0]?.code || "");
  const candidates = candidatePOs(workspace, draft);
  const selectedPO = workspace.procurement.pos.find((p) => p.id === po);
  const fieldOrder: FieldKey[] = [
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
  return (
    <form
      className="panel correction-panel"
      onSubmit={(e) => {
        e.preventDefault();
        if (verified) save(draft, reason, po, line);
      }}
    >
      <div className="panel-heading">
        <span>
          <FileSearch size={15} /> Check the source values
        </span>
        <button type="button" onClick={cancel} aria-label="Close source review">
          <X size={16} />
        </button>
      </div>
      <div className="correction-intro">
        <p>
          Compare these values with the PDF. Select a source link to highlight
          its location.
        </p>
        <span>
          Local extraction is unscored. Confirmation never bypasses PO or
          duplicate controls.
        </span>
      </div>
      <div className="field-grid">
        {fieldOrder.map((k) => (
          <label key={k}>
            <span>
              {FIELD_LABELS[k]}
              {CRITICAL.includes(k) && <i>*</i>}
              {draft.fields[k].sourceId && (
                <button
                  type="button"
                  title={`Show source for ${FIELD_LABELS[k]}`}
                  onClick={() => onSource(draft.fields[k].sourceId!)}
                >
                  <Link2 size={12} />
                </button>
              )}
            </span>
            <input
              required={CRITICAL.includes(k)}
              value={draft.fields[k].value}
              placeholder={
                k === "date"
                  ? "YYYY-MM-DD"
                  : k === "fees" || k === "discount"
                    ? "0.00 if absent"
                    : "Not found"
              }
              onChange={(e) => {
                const value = e.target.value;
                setDraft((d) => ({
                  ...d,
                  fields: { ...d.fields, [k]: { ...d.fields[k], value } },
                }));
                setVerified(false);
              }}
            />
            {draft.fields[k].derived && (
              <small>
                {k === "tax"
                  ? "Sum of stated tax components; check each in the PDF"
                  : "Derived from stated gross and tax"}
              </small>
            )}
          </label>
        ))}
      </div>
      <div className="line-edit">
        <div className="line-edit-heading">
          <strong>Invoice line items</strong>
          <button
            type="button"
            className="text-link"
            onClick={() =>
              setDraft((d) => ({
                ...d,
                lines: [
                  ...d.lines,
                  {
                    code: "",
                    description: "",
                    quantity: "",
                    unitPrice: "",
                    net: "",
                  },
                ],
              }))
            }
          >
            <Plus size={12} /> Add line
          </button>
        </div>
        {draft.lines.map((l, i) => (
          <div className="edit-line" key={i}>
            <div className="edit-line-title">
              <span>Line {i + 1}</span>
              {l.sourceId && (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => onSource(l.sourceId!)}
                >
                  Show source <Link2 size={11} />
                </button>
              )}
              <button
                className="remove-line"
                type="button"
                title="Remove line"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    lines: d.lines.filter((_, n) => n !== i),
                  }))
                }
              >
                <X size={13} />
              </button>
            </div>
            <div className="line-numbers">
              {[
                ["code", "PO line"],
                ["quantity", "Quantity"],
                ["unitPrice", "Unit price"],
                ["net", "Line net"],
              ].map(([k, label]) => (
                <label key={k}>
                  <span>{label}</span>
                  <input
                    value={(l[k as keyof typeof l] as string) || ""}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDraft((d) => ({
                        ...d,
                        lines: d.lines.map((l, n) =>
                          n === i ? { ...l, [k]: value } : l,
                        ),
                      }));
                      setVerified(false);
                    }}
                  />
                </label>
              ))}
            </div>
            <label className="line-description">
              <span>Description</span>
              <input
                value={l.description}
                onChange={(e) => {
                  const value = e.target.value;
                  setDraft((d) => ({
                    ...d,
                    lines: d.lines.map((l, n) =>
                      n === i ? { ...l, description: value } : l,
                    ),
                  }));
                }}
              />
            </label>
          </div>
        ))}
      </div>
      <div className="mapping-edit">
        <strong>Purchase order mapping</strong>
        <p>
          Explicit references remain binding. Missing references require a
          justified selection.
        </p>
        <label>
          <span>Purchase order</span>
          <select
            value={po}
            onChange={(e) => {
              setPo(e.target.value);
              setLine("");
              setVerified(false);
            }}
          >
            <option value="">Select a supported purchase order</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} · {p.project}
              </option>
            ))}
            {po && !candidates.some((p) => p.id === po) && (
              <option value={po}>{po} · Check eligibility</option>
            )}
          </select>
        </label>
        <label>
          <span>PO line for a single bundled item</span>
          <select
            value={line}
            onChange={(e) => {
              setLine(e.target.value);
              setVerified(false);
            }}
          >
            <option value="">Use explicit line codes above</option>
            {selectedPO?.lines.map((l) => (
              <option key={l.id} value={l.id}>
                {l.id} · {l.description}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="confirmation">
        <label>
          <input
            type="checkbox"
            checked={verified}
            onChange={(e) => setVerified(e.target.checked)}
          />
          <span>
            I checked the displayed values, line items and purchase mapping
            against the source.
          </span>
        </label>
        <label className="reason-label">
          <span>Confirmation or correction reason</span>
          <textarea
            required
            minLength={5}
            value={reason}
            placeholder="What did you verify or correct?"
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <button
          className="button primary"
          type="submit"
          disabled={!verified || reason.trim().length < 5 || busy}
        >
          {busy ? (
            <LoaderCircle className="spin" size={15} />
          ) : (
            <CheckCheck size={15} />
          )}{" "}
          Confirm fields and recheck
        </button>
        <button type="button" className="text-link" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
function ReasonForm({
  label,
  help,
  button,
  min,
  save,
}: {
  label: string;
  help: string;
  button: string;
  min: number;
  save: (reason: string) => void | Promise<void>;
}) {
  const [reason, setReason] = useState(""),
    [sent, setSent] = useState(false);
  return (
    <form
      className="reason-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setSent(true);
        try {
          await save(reason);
        } finally {
          setSent(false);
        }
      }}
    >
      <p className="muted">{help}</p>
      <label>
        {label}
        <textarea
          autoFocus
          required
          minLength={min}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Record the evidence and reason…"
        />
      </label>
      <button
        className="button primary"
        disabled={reason.trim().length < min || sent}
      >
        {sent ? (
          <LoaderCircle className="spin" size={15} />
        ) : (
          <Check size={15} />
        )}{" "}
        {button}
      </button>
    </form>
  );
}
function Amendment({
  po,
  busy,
  save,
}: {
  po: PO;
  busy: boolean;
  save: (cap: string, reason: string) => void;
}) {
  const [cap, setCap] = useState(decimal(po.cap)),
    [reason, setReason] = useState("");
  return (
    <form
      className="reason-form"
      onSubmit={(e) => {
        e.preventDefault();
        save(cap, reason);
      }}
    >
      <p className="muted">
        Record an authorized change to this synthetic PO. Previous receipts
        retain their original purchasing basis.
      </p>
      <label>
        Approved net cap in {po.currency}
        <input
          required
          inputMode="decimal"
          value={cap}
          onChange={(e) => setCap(e.target.value)}
        />
      </label>
      <label>
        Authorization reference or reason
        <textarea
          required
          minLength={5}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <button
        className="button primary"
        disabled={busy || reason.trim().length < 5}
      >
        Save new procurement version <ArrowRight size={15} />
      </button>
    </form>
  );
}
