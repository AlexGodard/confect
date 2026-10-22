/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Inclusive time per registration step in a `--profile-registration` run,
// identified by the original source range of each frame's function (line
// ranges are for main at 09adbf6e).
// node registrationSteps.mjs <profiles.json> registration <readableBundleDir>
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
const [file, key] = process.argv.slice(2);
const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(
  path.join(
    here,
    "../../../../node_modules/.pnpm/source-map-js@1.2.2/node_modules/source-map-js/package.json",
  ),
);
const { SourceMapConsumer } = require("source-map-js");
const ranges = {
  compile: [/core\/src\/SchemaToValidator\.ts$/, 44, 67],
  groupRegistry: [/src\/GroupRegistry\.ts$/, 9, 25],
  prepare: [/src\/RegisteredConvexFunction\.ts$/, 61, 118],
  register: [/src\/RegisteredConvexFunction\.ts$/, 127, 140],
  buildForGroup: [/src\/ConvexFunctionDefinitions\.ts$/, 62, 91],
};
const consumers = new Map();
const where = (cf) => {
  if (!cf.url?.startsWith("file://") || cf.lineNumber < 0) return null;
  if (!consumers.has(cf.url)) {
    const f = fileURLToPath(cf.url);
    consumers.set(
      cf.url,
      existsSync(`${f}.map`)
        ? new SourceMapConsumer(JSON.parse(readFileSync(`${f}.map`, "utf8")))
        : null,
    );
  }
  const c = consumers.get(cf.url);
  if (!c) return null;
  const p = c.originalPositionFor({
    line: cf.lineNumber + 1,
    column: cf.columnNumber,
  });
  return p.source ? [p.source, p.line] : null;
};
const runs = JSON.parse(readFileSync(file, "utf8"))[key];
const totals = Object.fromEntries(Object.keys(ranges).map((k) => [k, 0]));
let all = 0;
for (const profile of runs) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes)
    for (const c of n.children ?? []) parent.set(c, n.id);
  const tag = new Map();
  for (const n of profile.nodes) {
    const w = where(n.callFrame);
    tag.set(
      n.id,
      w
        ? Object.keys(ranges).filter(
            (k) =>
              ranges[k][0].test(w[0]) &&
              w[1] >= ranges[k][1] &&
              w[1] <= ranges[k][2],
          )
        : [],
    );
  }
  for (let i = 0; i < profile.samples.length; i++) {
    const delta = (profile.timeDeltas[i + 1] ?? 0) / 1000;
    let id = profile.samples[i];
    if (nodes.get(id).callFrame.functionName === "(idle)") continue;
    all += delta;
    const seen = new Set();
    while (id !== undefined) {
      for (const k of tag.get(id))
        if (!seen.has(k)) {
          totals[k] += delta;
          seen.add(k);
        }
      id = parent.get(id);
    }
  }
}
console.log(
  `sampled ${(all / runs.length).toFixed(2)} ms per run (${runs.length} runs)`,
);
for (const k of Object.keys(ranges))
  console.log(`${(totals[k] / runs.length).toFixed(2).padStart(7)} ms  ${k}`);
