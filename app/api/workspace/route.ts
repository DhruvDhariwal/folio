import { workspaceApi } from "../../../lib/folio/store";

export function GET() {
  return workspaceApi.getWorkspace();
}

export function POST(req: Request) {
  return workspaceApi.updateWorkspace(req);
}
