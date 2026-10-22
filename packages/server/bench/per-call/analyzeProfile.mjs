/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Attributes the CPU samples `inProcess.mjs --profile` recorded to original
// source files through the readable bundle's source maps.
// node analyzeProfile.mjs <profiles.json> <readableBundleDir> [keyFilter]
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(new URL(import.meta.url).pathname);
const require = createRequire(
  path.join(
    here,
    "../../../../node_modules/.pnpm/source-map-js@1.2.2/node_modules/source-map-js/package.json",
  ),
);
const { SourceMapConsumer } = require("source-map-js");

const [profilesFile, bundleDir, keyFilter] = process.argv.slice(2);
const profiles = JSON.parse(readFileSync(profilesFile, "utf8"));
const consumers = new Map();
const consumerFor = (url) => {
  if (!consumers.has(url)) {
    let consumer = null;
    if (url.startsWith("file://")) {
      const file = fileURLToPath(url);
      if (file.startsWith(path.resolve(bundleDir)) && existsSync(`${file}.map`))
        consumer = new SourceMapConsumer(
          JSON.parse(readFileSync(`${file}.map`, "utf8")),
        );
    }
    consumers.set(url, consumer);
  }
  return consumers.get(url);
};

const sourceOf = (callFrame) => {
  const consumer = consumerFor(callFrame.url);
  if (consumer === null || callFrame.lineNumber < 0) return null;
  const position = consumer.originalPositionFor({
    line: callFrame.lineNumber + 1,
    column: callFrame.columnNumber,
  });
  return position.source;
};

const group = (callFrame, source) => {
  if (callFrame.url === "" || callFrame.url === undefined) {
    const name = callFrame.functionName || "(anonymous)";
    if (name.startsWith("(")) return [name, name];
    return ["(V8 builtins)", name];
  }
  if (source === null) {
    if (
      callFrame.url.startsWith("node:") ||
      callFrame.url.includes("inProcess.mjs")
    )
      return ["(harness)", callFrame.url];
    return ["(unmapped)", callFrame.url];
  }
  const effect = source.match(/effect\/(?:src|dist)\/(.*)\.[jt]s$/);
  if (effect) {
    const file = effect[1];
    if (/^(Schema|internal\/schema)/.test(file)) return ["effect Schema", file];
    if (/^(Layer|Context|Scope|internal\/layer|MutableHashMap)/.test(file))
      return ["effect Layer/Context/Scope", file];
    if (
      /^(Stream|Channel|Queue|Pull|Chunk|internal\/channel|internal\/stream|MutableList|Take|Sink)/.test(
        file,
      )
    )
      return ["effect Stream/Channel/Queue", file];
    return ["effect runtime (fiber, core)", file];
  }
  const convex = source.match(/convex\/(?:src|dist\/esm)\/(.*)\.[jt]s$/);
  if (convex) return ["convex JS runtime", convex[1]];
  const confectCore = source.match(/core\/(?:dist|src)\/(.*)\.[jt]s$/);
  if (confectCore) return ["@confect/core", confectCore[1]];
  const confectServer = source.match(
    /^(?:\.\.\/)+(?:packages\/server\/)?(?:dist|src)\/(.*)\.[jt]s$/,
  );
  if (confectServer) return ["@confect/server", confectServer[1]];
  return ["project code", source.replace(/^.*per-call\//, "")];
};

const totals = {};
for (const [key, runs] of Object.entries(profiles)) {
  if (keyFilter && !key.includes(keyFilter)) continue;
  const groups = new Map();
  const files = new Map();
  const functions = new Map();
  let total = 0;
  let idle = 0;
  let wall = 0;
  for (const profile of runs) {
    wall += (profile.endTime - profile.startTime) / 1000;
    const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
    const classified = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const delta = (profile.timeDeltas[i + 1] ?? 0) / 1000;
      const node = nodes.get(profile.samples[i]);
      if (!classified.has(node.id)) {
        const source = sourceOf(node.callFrame);
        classified.set(node.id, group(node.callFrame, source));
      }
      const [groupName, fileName] = classified.get(node.id);
      if (groupName === "(idle)" || groupName === "(harness)") {
        idle += delta;
        continue;
      }
      total += delta;
      groups.set(groupName, (groups.get(groupName) ?? 0) + delta);
      files.set(
        `${groupName} :: ${fileName}`,
        (files.get(`${groupName} :: ${fileName}`) ?? 0) + delta,
      );
      const fn = `${fileName} :: ${node.callFrame.functionName || "(anonymous)"}`;
      functions.set(fn, (functions.get(fn) ?? 0) + delta);
    }
  }
  const n = runs.length;
  const sorted = (map, limit) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([k, v]) => `    ${(v / n).toFixed(3).padStart(8)} ms  ${k}`)
      .join("\n");
  totals[key] = {
    total: total / n,
    groups: Object.fromEntries([...groups].map(([k, v]) => [k, v / n])),
  };
  console.log(
    `\n## ${key} — ${n} profiles, ${(total / n).toFixed(2)} ms sampled per call (plus ${(idle / n).toFixed(2)} ms idle/harness; profile wall ${(wall / n).toFixed(2)} ms)`,
  );
  console.log("  by group:\n" + sorted(groups, 20));
  console.log("  by file:\n" + sorted(files, 18));
  console.log("  by function:\n" + sorted(functions, 15));
}
if (process.env.TOTALS_JSON) {
  const { writeFileSync } = await import("node:fs");
  writeFileSync(process.env.TOTALS_JSON, JSON.stringify(totals, null, 2));
}
