import {
  identity,
  mutate,
  bucket,
  jsonError,
  AppError,
} from "../../../lib/folio/store";
import type { InvoiceCase } from "../../../lib/folio/types";
export async function POST(req: Request) {
  try {
    const user = await identity();
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("Choose a PDF invoice.");
    if (file.size > 10 * 1024 * 1024)
      throw new AppError("PDFs must be 10 MB or smaller.", 413);
    const bytes = await file.arrayBuffer();
    if (new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-")
      throw new AppError("The selected file is not a PDF.");
    const hash = Array.from(
      new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
      (v) => v.toString(16).padStart(2, "0"),
    ).join("");
    const id = crypto.randomUUID();
    const fileKey = `${user.userId}/${hash}.pdf`;
    await bucket().put(fileKey, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const result = await mutate(user.userId, (s) => {
      const old = s.cases.find((c) => c.hash === hash);
      if (old) return { id: old.id, existing: true };
      if (s.cases.length >= 60)
        throw new AppError(
          "This prototype workspace supports 60 invoices. Export your history before opening a new workspace.",
          413,
        );
      const now = new Date().toISOString();
      const c: InvoiceCase = {
        id,
        hash,
        filename: file.name.replace(/[^\w.\- ()]/g, "_").slice(0, 150),
        fileKey,
        createdAt: now,
        status: "uploaded",
        decisions: [],
        events: [
          {
            id: crypto.randomUUID(),
            at: now,
            stage: "received",
            status: "done",
            message: `PDF received. ${file.size.toLocaleString()} bytes; content hash recorded.`,
          },
        ],
      };
      s.cases.unshift(c);
      return { id, existing: false };
    });
    return Response.json(result);
  } catch (e) {
    return jsonError(e);
  }
}
