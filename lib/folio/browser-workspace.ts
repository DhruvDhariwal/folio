import { initialWorkspace } from "./seed";
import type { Workspace } from "./types";
import {
  AppError,
  createWorkspaceApi,
  encodeWorkspace,
  jsonError,
  type WorkspaceStorage,
} from "./workspace-api";

type StoredWorkspace = { revision: number; state: string };
const reviewer = {
  userId: "browser",
  email: "Local reviewer",
  displayName: "Local reviewer",
};

let connection: Promise<IDBDatabase> | undefined;

function openDatabase() {
  connection ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("folio-invoices", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("workspace");
      request.result.createObjectStore("documents");
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = undefined;
      };
      resolve(database);
    };
    request.onerror = () =>
      reject(
        new AppError(
          "Enable browser storage to open this Folio workspace.",
          503,
        ),
      );
  }).catch((error) => {
    connection = undefined;
    throw error;
  });
  return connection;
}

function decodeWorkspace(row?: StoredWorkspace) {
  return row
    ? { revision: row.revision, state: JSON.parse(row.state) as Workspace }
    : { revision: 0, state: initialWorkspace() };
}

async function read<T>(store: "workspace" | "documents", key: string) {
  const database = await openDatabase();
  return new Promise<T | undefined>((resolve, reject) => {
    const request = database.transaction(store).objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}

const storage: WorkspaceStorage = {
  async readWorkspace(owner) {
    return decodeWorkspace(await read<StoredWorkspace>("workspace", owner));
  },
  async mutate(owner, change, original) {
    const database = await openDatabase();
    return new Promise((resolve, reject) => {
      // IndexedDB serializes these writes across tabs. The PDF and its case
      // are committed together so a storage failure cannot leave a partial case.
      const transaction = database.transaction(
        original ? ["workspace", "documents"] : ["workspace"],
        "readwrite",
      );
      const store = transaction.objectStore("workspace");
      const request = store.get(owner);
      transaction.onabort = () => reject(transaction.error);
      request.onsuccess = () => {
        try {
          const { revision, state } = decodeWorkspace(request.result);
          const result = change(state);
          store.put(
            { revision: revision + 1, state: encodeWorkspace(state) },
            owner,
          );
          if (original)
            transaction
              .objectStore("documents")
              .put(original.bytes, original.key);
          transaction.oncomplete = () => resolve({ state, result });
        } catch (error) {
          transaction.abort();
          reject(error);
        }
      };
    });
  },
  async readDocument(key) {
    return (await read<ArrayBuffer>("documents", key)) ?? null;
  },
};

const api = createWorkspaceApi(storage, async () => reviewer);

export async function browserRequest(path: string, options?: RequestInit) {
  const request = new Request(new URL(path, window.location.origin), options);
  const pathname = new URL(request.url).pathname;
  const { method } = request;
  if (pathname === "/api/workspace") {
    if (method === "GET") return api.getWorkspace();
    if (method === "POST") return api.updateWorkspace(request);
  }
  if (pathname === "/api/documents" && method === "POST")
    return api.uploadDocument(request);
  const doc = /^\/api\/documents\/([\w-]+)$/.exec(pathname);
  if (doc && method === "GET") return api.getDocument(doc[1]);
  const invoice = /^\/api\/cases\/([\w-]+)$/.exec(pathname);
  if (invoice) {
    if (method === "GET") return api.getCase(invoice[1]);
    if (method === "POST") return api.updateCase(request, invoice[1]);
  }
  return jsonError(new AppError("Workspace operation not found.", 404));
}
