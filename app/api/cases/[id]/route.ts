import { workspaceApi } from "../../../../lib/folio/store";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Context) {
  return workspaceApi.getCase((await params).id);
}

export async function POST(req: Request, { params }: Context) {
  return workspaceApi.updateCase(req, (await params).id);
}
