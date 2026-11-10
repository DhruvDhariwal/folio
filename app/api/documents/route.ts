import { workspaceApi } from "../../../lib/folio/store";

export function POST(req: Request) {
  return workspaceApi.uploadDocument(req);
}
