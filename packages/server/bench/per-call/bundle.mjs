/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Bundles the plain and Confect entry modules with the options `convex dev`
// uses for the default runtime (convex@1.46.0 `innerEsbuild`), and reports
// each entry's evaluated bytes and their split by package.
// Usage: node bundle.mjs <outDir> [--readable]
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(
  require_resolve_from(here, "convex/package.json"),
);
function require_resolve_from(dir, request) {
  return createRequire(path.join(dir, "noop.js")).resolve(request);
}
const esbuild = require("esbuild");

const outDir = path.resolve(process.argv[2] ?? path.join(here, "out"));
const readable = process.argv.includes("--readable");
// Size-sensitivity experiment: replace the experimental QueryStream modules
// QueryInitializer imports with stubs, as if `stream` were not reachable.
const stubQueryStream = process.argv.includes("--stub-query-stream");
const stubPlugin = {
  name: "stub-query-stream",
  setup(build) {
    build.onResolve({ filter: /^\.\/QueryStream(IndexRange)?\.js$/ }, (args) =>
      args.importer.endsWith(`${path.sep}QueryInitializer.js`)
        ? { path: args.path, namespace: "stub" }
        : undefined,
    );
    build.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({
      contents: args.path.includes("IndexRange")
        ? "export const builder = () => { throw new Error('stubbed'); };"
        : "export const fromReflection = () => { throw new Error('stubbed'); };",
      loader: "js",
    }));
  },
};
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const entryPoints = [
  "convex/plain.ts",
  "convex/groups/bench.ts",
  "convex/groups/benchJit.ts",
  "convex/groups/benchAot.ts",
]
  .map((entry) => path.join(here, entry))
  .filter((entry) => existsSync(entry));

const result = await esbuild.build({
  entryPoints,
  bundle: true,
  platform: "browser",
  format: "esm",
  target: "esnext",
  jsx: "automatic",
  outdir: outDir,
  outbase: path.join(here, "convex"),
  conditions: ["convex", "module"],
  splitting: true,
  chunkNames: "_deps/[hash]",
  treeShaking: true,
  minifySyntax: true,
  minifyIdentifiers: !readable,
  minifyWhitespace: false,
  keepNames: true,
  sourcemap: readable ? "external" : false,
  define: { "process.env.NODE_ENV": '"production"' },
  metafile: true,
  logLevel: "warning",
  plugins: stubQueryStream ? [stubPlugin] : [],
});

writeFileSync(path.join(outDir, "meta.json"), JSON.stringify(result.metafile));

const outputs = result.metafile.outputs;
const closure = (file, seen = new Set()) => {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const imported of outputs[file].imports)
    if (imported.kind === "import-statement" && outputs[imported.path])
      closure(imported.path, seen);
  return seen;
};
const packageOf = (input) => {
  const match = input.match(
    /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/,
  );
  if (match) return match[1];
  const absolute = path.resolve(here, input);
  if (absolute.includes("/packages/server/dist/")) return "@confect/server";
  if (absolute.includes("/packages/core/dist/")) return "@confect/core";
  return "(project)";
};
const report = {};
for (const [file, output] of Object.entries(outputs)) {
  if (!output.entryPoint) continue;
  const files = [...closure(file)].filter((f) => f.endsWith(".js"));
  const bytes = files.reduce((sum, f) => sum + outputs[f].bytes, 0);
  const byPackage = {};
  for (const f of files)
    for (const [input, { bytesInOutput }] of Object.entries(
      outputs[f].inputs,
    )) {
      const pkg = packageOf(input);
      byPackage[pkg] = (byPackage[pkg] ?? 0) + bytesInOutput;
    }
  report[path.relative(outDir, file)] = {
    files: files.map((f) => path.relative(outDir, f)),
    bytes,
    byPackage: Object.fromEntries(
      Object.entries(byPackage).sort((a, b) => b[1] - a[1]),
    ),
  };
}
writeFileSync(
  path.join(outDir, "report.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report, null, 2));
