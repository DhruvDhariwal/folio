import {
  identity,
  readWorkspace,
  bucket,
  jsonError,
  AppError,
} from "../../../../lib/folio/store";
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await identity();
    const { id } = await params;
    const { state } = await readWorkspace(user.userId);
    const c = state.cases.find((c) => c.id === id);
    if (!c) throw new AppError("Invoice not found.", 404);
    const file = await bucket().get(c.fileKey);
    if (!file) throw new AppError("The original document is unavailable.", 404);
    return new Response(file.body, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${c.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
