import { workspaceApi } from "../../../../lib/folio/store";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return workspaceApi.getDocument((await params).id);
}
