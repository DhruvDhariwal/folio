import { mkdir, copyFile, readdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
const target = path.resolve("public/engines");
await mkdir(target, { recursive: true });
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  path.join(target, "pdf.worker.min.mjs"),
);
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js",
  path.join(target, "ocr-worker.min.js"),
);
for (const file of await readdir("node_modules/tesseract.js-core"))
  if (file.includes("lstm.wasm"))
    await copyFile(
      path.join("node_modules/tesseract.js-core", file),
      path.join(target, file),
    );
try {
  await access(path.join(target, "eng.traineddata.gz"));
} catch {
  const response = await fetch(
    "https://tessdata.projectnaptha.com/4.0.0/eng.traineddata.gz",
  );
  if (!response.ok)
    throw new Error("Could not download the English OCR language data.");
  await writeFile(
    path.join(target, "eng.traineddata.gz"),
    new Uint8Array(await response.arrayBuffer()),
  );
}
console.log(
  "Self-hosted PDF worker, local OCR engine and English language data are ready.",
);
