/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Generates confect/_generated/aotSchemas.js with Effect's SchemaAOTCompiler
// for the targets in confect/aotTargets.ts.
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(
  createRequire(path.join(here, "noop.js")).resolve("convex/package.json"),
);
const esbuild = require("esbuild");
const tmp = mkdtempSync(path.join(here, ".aot-"));
try {
  await esbuild.build({
    entryPoints: [path.join(here, "confect/aotTargets.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: path.join(tmp, "targets.mjs"),
    logLevel: "warning",
  });
  const { targets } = await import(
    pathToFileURL(path.join(tmp, "targets.mjs")).href
  );
  const effectAot = createRequire(path.join(here, "noop.js")).resolve(
    "effect/schema/SchemaAOTCompiler",
  );
  const { compile } = await import(pathToFileURL(effectAot).href);
  const source = compile(targets());
  writeFileSync(path.join(here, "confect/_generated/aotSchemas.js"), source);
  console.log(
    `aotSchemas.js: ${source.length} bytes, ${targets().length} targets`,
  );
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
