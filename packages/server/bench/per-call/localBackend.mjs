/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Drives matched plain-Convex / Confect pairs against the running local
// backend and reports client round-trip and server-reported execution time.
// Usage: node localBackend.mjs [iterations] [label]
import { readFileSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

const here = new URL(".", import.meta.url).pathname;
const config = JSON.parse(
  readFileSync(`${here}.convex/local/default/config.json`, "utf8"),
);
const url = `http://127.0.0.1:${config.ports.cloud}`;
const client = new ConvexHttpClient(url);
const iterations = Number(process.argv[2] ?? 40);
const label = process.argv[3] ?? "run";
const warmup = 5;

const ref = (_kind, name) => makeFunctionReference(name);
const call = (kind, name, args) =>
  kind === "query"
    ? client.query(ref(kind, name), args)
    : client.mutation(ref(kind, name), args);
// The local deployment caps writes at 4 MiB/s; back off when seeding hits it.
const seedCall = async (name, args) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call("mutation", name, args);
    } catch (error) {
      if (!String(error).includes("TooManyWrites") || attempt > 20) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
};
const wanted = (caseLabel) =>
  process.env.CASES === undefined ||
  process.env.CASES.split(",").includes(caseLabel);

const fetchLogs = async (cursor) => {
  const all = [];
  let current = cursor;
  for (;;) {
    const response = await fetch(
      `${url}/api/stream_function_logs?cursor=${current}`,
      { headers: { Authorization: `Convex ${config.adminKey}` } },
    );
    const { entries, newCursor } = await response.json();
    all.push(...entries);
    if (entries.length === 0 || newCursor === current)
      return { all, cursor: current };
    current = newCursor;
  }
};

// --- seed (idempotent per run label) ---
const seedTag = `${label}-${Date.now()}`;
const p100 = `p100-${seedTag}`;
const p1000 = `p1000-${seedTag}`;
const e300 = `e300-${seedTag}`;
const [taskId] = await seedCall("seed:tasks", { projectId: p100, count: 100 });
if (wanted("list1000"))
  for (let i = 0; i < 10; i++)
    await seedCall("seed:tasks", { projectId: p1000, count: 100 });
if (wanted("embeddings300x1536"))
  for (let i = 0; i < 6; i++) {
    await seedCall("seed:embeddings", {
      setId: e300,
      count: 50,
      dimensions: 1536,
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

const sampleTask = {
  projectId: `insert-${seedTag}`,
  title: "Task: mix the second verse and bounce stems",
  description:
    "Bounce the stems at 24-bit and upload them to the shared folder before Friday.",
  status: "todo",
  priority: 2,
  assigneeId: "user_3",
  labels: ["mix", "urgent"],
  estimate: 3,
  dueAt: 1_790_000_000_000,
  archived: false,
  sortKey: "a0001",
  metadata: { source: "bench", externalId: "ext-1" },
};
const statuses = ["backlog", "todo", "in_progress", "done"];

const allCases = [
  ["noopQuery", "query", (i) => ({ nonce: i })],
  ["noopMutation", "mutation", (i) => ({ nonce: i })],
  ["getById", "query", (i) => ({ id: taskId, nonce: i })],
  ["list", "query", (i) => ({ projectId: p100, nonce: i }), "list100"],
  ["list", "query", (i) => ({ projectId: p1000, nonce: i }), "list1000"],
  [
    "listEmbeddings",
    "query",
    (i) => ({ setId: e300, nonce: i }),
    "embeddings300x1536",
  ],
  ["insert", "mutation", () => ({ task: sampleTask })],
  [
    "patch",
    "mutation",
    (i) => ({ id: taskId, status: statuses[i % 4], priority: i % 5 }),
  ],
];

const cases = allCases.filter(([name, , , caseLabel = name]) =>
  wanted(caseLabel),
);
let { cursor } = await fetchLogs(0);
const results = {};
let nonce = Math.floor(Math.random() * 1e9);
for (const [name, kind, args, caseLabel = name] of cases) {
  const modules = ["plain", process.env.CONFECT_MODULE ?? "groups/bench"];
  const rtt = { plain: [], confect: [] };
  const failures = { plain: 0, confect: 0 };
  const serverRows = [];
  for (let i = 0; i < warmup + iterations; i++) {
    // Alternate which side goes first so neither systematically benefits.
    const order = i % 2 === 0 ? modules : [...modules].reverse();
    for (const module of order) {
      const a = args(nonce++);
      const side = module === "plain" ? "plain" : "confect";
      const t0 = performance.now();
      try {
        await call(kind, `${module}:${name}`, a);
      } catch (error) {
        if (i >= warmup) failures[side]++;
        console.error(
          `${module}:${name} failed: ${String(error).split("\n")[1] ?? error}`,
        );
        continue;
      }
      const elapsed = performance.now() - t0;
      if (i >= warmup) rtt[side].push(elapsed);
    }
  }
  const logs = await fetchLogs(cursor);
  cursor = logs.cursor;
  for (const entry of logs.all) {
    if (entry.kind !== "Completion") continue;
    serverRows.push(entry);
  }
  const server = { plain: [], confect: [] };
  for (const module of modules) {
    const side = module === "plain" ? "plain" : "confect";
    const rows = serverRows.filter(
      (row) =>
        (row.identifier === `${module}.js:${name}` ||
          row.identifier === `${module}:${name}`) &&
        !row.error,
    );
    server[side] = rows.slice(warmup).map((row) => row.executionTime * 1000);
    if (rows.length === 0)
      console.error("no server rows for", module, name, serverRows.slice(0, 2));
    if (rows.some((row) => row.cachedResult))
      console.error("cached rows seen for", module, name);
  }
  results[caseLabel] = { rtt, server, failures };
  console.error(`done ${caseLabel}`);
}

writeFileSync(`${here}results-${label}.json`, JSON.stringify(results));

const pct = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
};
const fmt = (x) => (x === undefined ? "-" : x.toFixed(2));
console.log(
  `| case | n | plain exec p50 / p95 | Confect exec p50 / p95 | Δ exec p50 | plain RTT p50 | Confect RTT p50 | Δ RTT p50 | failures plain/Confect |`,
);
console.log(`|---|---|---|---|---|---|---|---|---|`);
for (const [caseLabel, { rtt, server, failures }] of Object.entries(results)) {
  console.log(
    `| ${caseLabel} | ${server.confect.length} | ${fmt(pct(server.plain, 50))} / ${fmt(pct(server.plain, 95))} | ${fmt(pct(server.confect, 50))} / ${fmt(pct(server.confect, 95))} | ${fmt(pct(server.confect, 50) - pct(server.plain, 50))} | ${fmt(pct(rtt.plain, 50))} | ${fmt(pct(rtt.confect, 50))} | ${fmt(pct(rtt.confect, 50) - pct(rtt.plain, 50))} | ${failures.plain}/${failures.confect} |`,
  );
}
