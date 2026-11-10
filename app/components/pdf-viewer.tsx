"use client";
import { useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  FileText,
  LoaderCircle,
} from "lucide-react";
import { pdfLibrary } from "../../lib/folio/extract";
import type { Extraction, SourceLine } from "../../lib/folio/types";
import type { PDFDocumentProxy } from "pdfjs-dist";

export function PDFViewer({
  id,
  extraction,
  source,
  request,
}: {
  id: string;
  extraction?: Extraction;
  source?: SourceLine;
  request?: (path: string) => Promise<Response>;
}) {
  const holder = useRef<HTMLDivElement>(null),
    canvas = useRef<HTMLCanvasElement>(null);
  const [pdf, setPdf] = useState<PDFDocumentProxy>(),
    [page, setPage] = useState(1),
    [width, setWidth] = useState(500),
    [error, setError] = useState(""),
    [originalUrl, setOriginalUrl] = useState<string>(),
    [rendered, setRendered] = useState(false),
    [ratio, setRatio] = useState(1.414),
    [zoom, setZoom] = useState(1);
  useEffect(() => {
    let disposed = false;
    let document: PDFDocumentProxy | undefined;
    let blobUrl: string | undefined;
    setPdf(undefined);
    setOriginalUrl(undefined);
    setError("");
    setRendered(false);
    setPage(1);

    async function load() {
      const lib = await pdfLibrary();
      const path = `/api/documents/${id}`;
      if (request) {
        const response = await request(path);
        if (!response.ok)
          throw new Error("The original PDF could not be loaded.");
        const blob = await response.blob();
        if (disposed) return;
        blobUrl = URL.createObjectURL(blob);
        setOriginalUrl(blobUrl);
      }
      if (disposed) return;
      document = await lib.getDocument({
        url: blobUrl ?? path,
        useSystemFonts: true,
      }).promise;
      if (disposed) void document.destroy();
      else setPdf(document);
    }

    load().catch((e) => {
      if (!disposed)
        setError(
          e instanceof Error ? e.message : "The PDF preview could not load.",
        );
    });
    return () => {
      disposed = true;
      if (document) void document.destroy();
      if (blobUrl) URL.revokeObjectURL(blobUrl);
    };
  }, [id, request]);
  useEffect(() => {
    if (!holder.current) return;
    const o = new ResizeObserver((entries) =>
      setWidth(Math.max(240, entries[0].contentRect.width)),
    );
    o.observe(holder.current);
    return () => o.disconnect();
  }, []);
  useEffect(() => {
    if (source) setPage(source.page);
  }, [source]);
  useEffect(() => {
    if (!pdf || !canvas.current) return;
    let cancelled = false;
    let task:
      | ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]>
      | undefined;
    setRendered(false);
    pdf
      .getPage(page)
      .then((p) => {
        if (cancelled || !canvas.current) return;
        const base = p.getViewport({ scale: 1 });
        setRatio(base.height / base.width);
        const scale = (width * zoom) / base.width;
        const viewport = p.getViewport({
          scale: scale * window.devicePixelRatio,
        });
        const el = canvas.current;
        el.width = Math.floor(viewport.width);
        el.height = Math.floor(viewport.height);
        el.style.width = `${width * zoom}px`;
        el.style.height = `${(width * zoom * base.height) / base.width}px`;
        const ctx = el.getContext("2d");
        if (!ctx) return;
        task = p.render({ canvasContext: ctx, canvas: el, viewport });
        return task.promise;
      })
      .then(() => {
        if (!cancelled) setRendered(true);
      })
      .catch((e) => {
        if (!cancelled && e?.name !== "RenderingCancelledException")
          setError(
            "The page preview could not render. Open the original PDF to inspect it.",
          );
      });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [pdf, page, width, zoom]);
  const dimensions = extraction?.pages[page - 1];
  const show = source && source.page === page && dimensions;
  return (
    <section className="source-panel panel">
      <div className="panel-heading">
        <span>
          <FileText size={15} /> Source document
        </span>
        <a
          href={request ? originalUrl : `/api/documents/${id}`}
          target="_blank"
          rel="noreferrer"
          title="Open original PDF"
        >
          <ExternalLink size={15} />
        </a>
      </div>
      <div className="pdf-toolbar">
        <span>
          {extraction
            ? extraction.method === "native"
              ? "Native PDF"
              : "Locally read scan"
            : "Original PDF"}
        </span>
        <div className="pdf-zoom">
          <button
            aria-label="Zoom out document"
            disabled={zoom <= 1}
            onClick={() => setZoom((z) => z - 0.25)}
          >
            −
          </button>
          <span>{Math.round(zoom * 100)}%</span>
          <button
            aria-label="Zoom in document"
            disabled={zoom >= 2}
            onClick={() => setZoom((z) => z + 0.25)}
          >
            +
          </button>
        </div>
        <div>
          <button
            aria-label="Previous page"
            disabled={page <= 1}
            onClick={() => setPage((p) => p - 1)}
          >
            <ChevronLeft size={15} />
          </button>
          <span>
            {page} / {pdf?.numPages || "—"}
          </span>
          <button
            aria-label="Next page"
            disabled={!pdf || page >= pdf.numPages}
            onClick={() => setPage((p) => p + 1)}
          >
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="pdf-surround" ref={holder}>
        <div
          className="pdf-page"
          style={{ width: width * zoom, minHeight: width * zoom * ratio }}
        >
          <canvas ref={canvas} />
          {!rendered && !error && (
            <div className="pdf-loading">
              <LoaderCircle size={22} className="spin" />
              <span>Opening original document</span>
            </div>
          )}
          {error && (
            <div className="pdf-loading">
              <FileText size={24} />
              <p>{error}</p>
            </div>
          )}
          {show && (
            <div
              className="evidence-highlight"
              style={{
                left: `${(source.box[0] / dimensions.width) * 100}%`,
                top: `${(source.box[1] / dimensions.height) * 100}%`,
                width: `${(source.box[2] / dimensions.width) * 100}%`,
                height: `${(source.box[3] / dimensions.height) * 100}%`,
              }}
            />
          )}
        </div>
      </div>
      <div className={`source-caption ${source ? "selected" : ""}`}>
        {source ? (
          <>
            <span className="evidence-number">1</span>
            <span>
              <strong>Selected source · page {source.page}</strong>
              <br />
              {source.text}
            </span>
          </>
        ) : (
          <>
            <span className="evidence-number neutral">↗</span>
            <span>
              Select a value or evidence reference to locate it in the original.
            </span>
          </>
        )}
      </div>
    </section>
  );
}
