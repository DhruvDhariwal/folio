import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../app/chatgpt-auth";
import { initialWorkspace } from "./seed";
import type { Workspace } from "./types";

export class AppError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export async function identity() {
  const user = await getChatGPTUser();
  if (!user) throw new AppError("Sign in to open your invoice workspace.", 401);
  return user;
}
export function database() {
  if (!env.DB) throw new AppError("Workspace database is unavailable.", 503);
  return env.DB;
}
export function bucket() {
  if (!env.BUCKET) throw new AppError("Document storage is unavailable.", 503);
  return env.BUCKET;
}
export async function readWorkspace(owner: string) {
  const db = database();
  await db
    .prepare(
      "INSERT OR IGNORE INTO workspaces (owner,revision,state) VALUES (?,0,?)",
    )
    .bind(owner, JSON.stringify(initialWorkspace()))
    .run();
  const row = await db
    .prepare("SELECT revision,state FROM workspaces WHERE owner=?")
    .bind(owner)
    .first<{ revision: number; state: string }>();
  if (!row) throw new AppError("Workspace could not be loaded.", 503);
  return { revision: row.revision, state: JSON.parse(row.state) as Workspace };
}
// The entire aggregate (claims, capacity and new receipt) advances in one atomic
// UPDATE. A concurrent writer makes the predicate fail and forces reevaluation.
export async function mutate<T>(
  owner: string,
  fn: (s: Workspace) => T,
): Promise<{ state: Workspace; result: T }> {
  for (let attempt = 0; attempt < 12; attempt++) {
    const { revision, state } = await readWorkspace(owner);
    const result = fn(state);
    const encoded = JSON.stringify(state);
    if (new TextEncoder().encode(encoded).length > 1500000)
      throw new AppError(
        "This prototype workspace has reached its history limit. Export the receipts before starting a new workspace.",
        413,
      );
    const saved = await database()
      .prepare(
        "UPDATE workspaces SET state=?,revision=revision+1 WHERE owner=? AND revision=?",
      )
      .bind(encoded, owner, revision)
      .run();
    if (saved.meta.changes === 1) return { state, result };
  }
  throw new AppError(
    "Another invoice changed the workspace. Please retry; nothing was double counted.",
    409,
  );
}
export function jsonError(error: unknown) {
  if (error instanceof AppError)
    return Response.json({ error: error.message }, { status: error.status });
  console.error(
    "Folio request failed",
    error instanceof Error ? error.message : "Unknown failure",
  );
  return Response.json(
    {
      error:
        "The operation could not finish. Your saved records are still available. Please retry.",
    },
    { status: 500 },
  );
}
