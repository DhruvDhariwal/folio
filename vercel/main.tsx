import { createRoot } from "react-dom/client";
import FolioApp from "../app/components/folio-app";
import { browserRequest } from "../lib/folio/browser-workspace";
import "../app/folio.css";

createRoot(document.getElementById("root")!).render(
  <FolioApp request={browserRequest} browserWorkspace />,
);
