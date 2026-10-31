import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
mkdirSync("work/tests", { recursive: true });
writeFileSync("work/tests/package.json", '{"type":"commonjs"}');
const compiled = spawnSync(
  process.execPath,
  [
    "node_modules/typescript/bin/tsc",
    "tests/rules.test.ts",
    "--outDir",
    "work/tests",
    "--target",
    "ES2022",
    "--module",
    "commonjs",
    "--moduleResolution",
    "node",
    "--esModuleInterop",
    "--skipLibCheck",
    "--types",
    "node",
  ],
  { stdio: "inherit" },
);
if (compiled.status !== 0) process.exit(compiled.status || 1);
const result = spawnSync(
  process.execPath,
  ["--test", "work/tests/tests/rules.test.js"],
  { stdio: "inherit" },
);
process.exit(result.status || 0);
