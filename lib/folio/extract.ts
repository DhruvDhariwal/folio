import type { Extraction, SourceLine, Vendor } from "./types";
import { parseInvoice } from "./parse";

export async function pdfLibrary() {
  const pdf = await import("pdfjs-dist");
  pdf.GlobalWorkerOptions.workerSrc = "/engines/pdf.worker.min.mjs";
  return pdf;
}
export async function extractPDF(
  bytes: ArrayBuffer,
  vendors: Vendor[],
  onStage: (
    stage: "read" | "extract",
    status: "running" | "done",
    message: string,
  ) => Promise<void>,
  onProgress: (message: string) => void,
): Promise<Extraction> {
  await onStage("read", "running", "Opening the original PDF in this browser.");
  const pdfjs = await pdfLibrary();
  let pdf: import("pdfjs-dist").PDFDocumentProxy;
  try {
    pdf = await pdfjs.getDocument({
      data: new Uint8Array(bytes.slice(0)),
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException")
      throw new Error(
        "This PDF is password protected. Upload an unlocked copy.",
      );
    throw error;
  }
  if (pdf.numPages > 5) {
    await pdf.destroy();
    throw new Error(
      "This version supports one invoice with up to five pages. No pages were silently skipped.",
    );
  }
  await onStage(
    "read",
    "done",
    `PDF opened successfully. ${pdf.numPages} page(s) available.`,
  );
  await onStage(
    "extract",
    "running",
    "Reading actual PDF text; scans will use local OCR.",
  );
  const sources: SourceLine[] = [];
  const pages: Extraction["pages"] = [];
  let native = 0,
    scanned = 0;
  let worker:
    | Awaited<ReturnType<(typeof import("tesseract.js"))["createWorker"]>>
    | undefined;
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress(`Reading page ${n} of ${pdf.numPages}`);
      const page = await pdf.getPage(n);
      const viewport = page.getViewport({ scale: 1 });
      pages.push({ width: viewport.width, height: viewport.height });
      const content = await page.getTextContent();
      const items = content.items.filter(
        (x): x is import("pdfjs-dist/types/src/display/api").TextItem =>
          "str" in x && !!x.str.trim(),
      );
      if (items.reduce((a, i) => a + i.str.trim().length, 0) > 30) {
        native++;
        const rows: {
          text: string;
          x: number;
          y: number;
          w: number;
          h: number;
        }[][] = [];
        for (const item of items) {
          const [x, y] = viewport.convertToViewportPoint(
            item.transform[4],
            item.transform[5],
          );
          const h = Math.max(7, Math.abs(item.height));
          const part = {
            text: item.str,
            x,
            y: y - h,
            w: Math.abs(item.width),
            h,
          };
          let row = rows.find(
            (r) => Math.abs(r[0].y - part.y) < Math.min(h * 0.5, 5),
          );
          if (!row) {
            row = [];
            rows.push(row);
          }
          row.push(part);
        }
        rows.sort((a, b) => a[0].y - b[0].y);
        for (const row of rows) {
          row.sort((a, b) => a.x - b.x);
          const x = Math.min(...row.map((i) => i.x)),
            y = Math.min(...row.map((i) => i.y)),
            right = Math.max(...row.map((i) => i.x + i.w)),
            bottom = Math.max(...row.map((i) => i.y + i.h));
          sources.push({
            id: `p${n}-s${sources.length}`,
            page: n,
            text: row
              .map((i) => i.text)
              .join("  ")
              .trim()
              .slice(0, 500),
            box: [x, y, right - x, bottom - y],
          });
        }
      } else {
        scanned++;
        onProgress(`Page ${n} is a scan. Loading local OCR…`);
        if (!worker) {
          const t = await import("tesseract.js");
          worker = await t.createWorker("eng", 1, {
            workerPath: "/engines/ocr-worker.min.js",
            corePath: "/engines",
            langPath: "/engines",
            workerBlobURL: false,
            logger: (m) => {
              if (m.status === "recognizing text")
                onProgress(
                  `Local OCR · page ${n} · ${Math.round(m.progress * 100)}%`,
                );
            },
          });
        }
        const scale = Math.min(
          2.2,
          2200 / Math.max(viewport.width, viewport.height),
        );
        const view = page.getViewport({ scale });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(view.width);
        canvas.height = Math.ceil(view.height);
        const context = canvas.getContext("2d");
        if (!context)
          throw new Error("This browser could not create a page image.");
        await page.render({ canvasContext: context, canvas, viewport: view })
          .promise;
        const { data } = await worker.recognize(
          canvas,
          {},
          { text: true, blocks: true },
        );
        for (const block of data.blocks || [])
          for (const p of block.paragraphs)
            for (const l of p.lines) {
              if (l.text.trim())
                sources.push({
                  id: `p${n}-s${sources.length}`,
                  page: n,
                  text: l.text.trim().slice(0, 500),
                  box: [
                    l.bbox.x0 / scale,
                    l.bbox.y0 / scale,
                    (l.bbox.x1 - l.bbox.x0) / scale,
                    (l.bbox.y1 - l.bbox.y0) / scale,
                  ],
                });
            }
        canvas.width = 1;
        canvas.height = 1;
      }
    }
    if (!sources.length)
      throw new Error(
        "No readable invoice text was found. Try a clearer scan or a native PDF.",
      );
    if (sources.length > 300)
      throw new Error(
        "This document exceeds the supported source-line limit. Split the invoice into a smaller document.",
      );
    return parseInvoice(
      sources,
      pages,
      native && scanned ? "mixed" : scanned ? "ocr" : "native",
      vendors,
    );
  } finally {
    await worker?.terminate();
    await pdf.destroy();
  }
}
