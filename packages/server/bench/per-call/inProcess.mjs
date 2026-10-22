/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// In-process model of one Convex default-runtime call: a fresh V8 context per
// call, the bundled entry and its chunks compiled and evaluated in it, then
// the registered function's `invokeQuery`/`invokeMutation` called with a
// `Convex` syscall global backed by an in-memory table store.
//
// node --experimental-vm-modules --expose-gc inProcess.mjs <bundleDir>
//   [--iterations N] [--warmup N] [--cases a,b] [--cached-data]
//   [--profile <outJson>]   (CPU-profile each phase; needs a --readable bundle)
//   [--json <outJson>]
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import inspector from "node:inspector";
import path from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const here = path.dirname(new URL(import.meta.url).pathname);
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const bundleDir = path.resolve(argv[0]);
const iterations = Number(flag("iterations", 40));
const warmup = Number(flag("warmup", 8));
const useCachedData = argv.includes("--cached-data");
const profileOut = flag("profile", undefined);
const jsonOut = flag("json", undefined);
const caseFilter = flag("cases", undefined)?.split(",");
// Profile only the registration window (between the groupDefined and
// registered markers) of the Confect entry.
const profileRegistration = argv.includes("--profile-registration");

// ---------------------------------------------------------------------------
// In-memory store, documents kept as JSON strings as the syscall boundary
// hands them over.
// ---------------------------------------------------------------------------

const statuses = ["backlog", "todo", "in_progress", "done", "canceled"];
const makeTask = (projectId, i) => ({
  projectId,
  title: `Task ${i}: mix the second verse and bounce stems`,
  ...(i % 2 === 0
    ? {
        description:
          "Bounce the stems at 24-bit and upload them to the shared folder before Friday.",
      }
    : {}),
  status: statuses[i % statuses.length],
  priority: i % 5,
  ...(i % 3 === 0 ? { assigneeId: `user_${i % 17}` } : {}),
  labels: ["mix", i % 2 === 0 ? "urgent" : "later"],
  ...(i % 4 === 0 ? { estimate: 3 } : {}),
  dueAt: 1_790_000_000_000 + i * 86_400_000,
  ...(i % 5 === 0 ? { completedAt: 1_790_000_000_000 } : {}),
  archived: false,
  sortKey: `a${i.toString(36).padStart(4, "0")}`,
  metadata: {
    source: "bench",
    ...(i % 2 === 0 ? { externalId: `ext-${i}` } : {}),
  },
});

const tables = { tasks: [], embeddings: [] };
const byId = new Map();
let idCounter = 0;
let creation = 1_790_000_000_000;
const insertDoc = (table, value) => {
  const _id = `${table === "tasks" ? "j9" : "k7"}${(idCounter++).toString(32).padStart(10, "0")}`;
  const doc = { _id, _creationTime: (creation += 1.5), ...value };
  const entry = { doc, json: JSON.stringify(doc) };
  tables[table].push(entry);
  byId.set(_id, { table, entry });
  return _id;
};
for (let i = 0; i < 100; i++) insertDoc("tasks", makeTask("p100", i));
for (let i = 0; i < 1000; i++) insertDoc("tasks", makeTask("p1000", i));
for (let i = 0; i < 300; i++)
  insertDoc("embeddings", {
    setId: "e300",
    chunk: i,
    vector: Array.from({ length: 1536 }, (_, j) => Math.sin(i * 31 + j) / 3),
  });
const taskId = tables.tasks[0].doc._id;

const makeConvexGlobal = () => {
  const streams = new Map();
  let nextQueryId = 1;
  const sync = (op, argsJson) => {
    const args = JSON.parse(argsJson);
    switch (op) {
      case "1.0/queryStream": {
        const { source } = args.query;
        if (source.type !== "IndexRange")
          throw new Error(`unsupported ${source.type}`);
        const [table] = source.indexName.split(".");
        const eqs = source.range.filter((r) => r.type === "Eq");
        const rows = tables[table].filter(({ doc }) =>
          eqs.every((r) => doc[r.fieldPath] === r.value),
        );
        const queryId = nextQueryId++;
        streams.set(queryId, { rows, position: 0 });
        return JSON.stringify({ queryId });
      }
      case "1.0/queryCleanup":
        streams.delete(args.queryId);
        return "true";
      default:
        throw new Error(`unsupported syscall ${op}`);
    }
  };
  const async = (op, argsJson) => {
    switch (op) {
      case "1.0/queryStreamNext": {
        const { queryId } = JSON.parse(argsJson);
        const stream = streams.get(queryId);
        const row = stream.rows[stream.position++];
        return row === undefined
          ? '{"value":null,"done":true}'
          : `{"value":${row.json},"done":false}`;
      }
      case "1.0/get": {
        const { id } = JSON.parse(argsJson);
        return byId.get(id)?.entry.json ?? "null";
      }
      case "1.0/insert": {
        const { table, value } = JSON.parse(argsJson);
        // Inserts land in a scratch table so read cases stay stable.
        const _id = `j9ins${(idCounter++).toString(32)}`;
        void value;
        void table;
        return JSON.stringify({ _id });
      }
      case "1.0/shallowMerge":
      case "1.0/replace":
        JSON.parse(argsJson);
        return "null";
      default:
        throw new Error(`unsupported async syscall ${op}`);
    }
  };
  return {
    syscall: sync,
    asyncSyscall: (op, argsJson) => {
      try {
        return Promise.resolve(async(op, argsJson));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    jsSyscall: (op) => {
      throw new Error(`unsupported jsSyscall ${op}`);
    },
  };
};

// ---------------------------------------------------------------------------
// Module loading
// ---------------------------------------------------------------------------

const entryFiles = {
  plain: "plain.js",
  confect: flag("confect-entry", "groups/bench.js"),
};
const MARKERS = [
  ["// confect/tables/", "libraryEvaluated"],
  ["// confect/_generated/registeredFunctions/", "groupDefined"],
  ["// convex/groups/", "registered"],
];
const sources = new Map();
const readSource = (file) => {
  if (!sources.has(file)) {
    let source = readFileSync(file, "utf8");
    for (const [prefix, mark] of MARKERS) {
      const at = source.indexOf(`\n${prefix}`);
      if (at !== -1)
        source = `${source.slice(0, at)}\nglobalThis.__mark("${mark}");${source.slice(at)}`;
    }
    sources.set(file, source);
  }
  return sources.get(file);
};
const cachedData = new Map();

const registrationProfiling = { active: false };
const makeContext = (marks) =>
  vm.createContext({
    console,
    Convex: makeConvexGlobal(),
    TextEncoder,
    TextDecoder,
    URL,
    URLSearchParams,
    atob,
    btoa,
    structuredClone,
    crypto: globalThis.crypto,
    setTimeout,
    clearTimeout,
    queueMicrotask,
    __mark: (name) => {
      marks.push([name, performance.now()]);
      if (registrationProfiling.active && name === "groupDefined")
        session.post("Profiler.start");
      if (registrationProfiling.active && name === "registered")
        session.post("Profiler.stop", (error, result) => {
          if (!error) (profiles["registration"] ??= []).push(result.profile);
        });
    },
  });

const loadEntry = async (side, timings) => {
  const marks = [];
  const t0 = performance.now();
  const context = makeContext(marks);
  const t1 = performance.now();
  const modules = new Map();
  const compile = (file) => {
    if (modules.has(file)) return modules.get(file);
    const options = { context, identifier: pathToFileURL(file).href };
    if (useCachedData && cachedData.has(file))
      options.cachedData = cachedData.get(file);
    const module = new vm.SourceTextModule(readSource(file), options);
    if (useCachedData && !cachedData.has(file))
      cachedData.set(file, module.createCachedData());
    modules.set(file, module);
    return module;
  };
  // Compile the whole graph up front so compile and evaluate time separate.
  const entryFile = path.join(bundleDir, entryFiles[side]);
  const pending = [entryFile];
  while (pending.length > 0) {
    const file = pending.pop();
    const module = compile(file);
    for (const { specifier } of module.moduleRequests ?? [])
      pending.push(path.resolve(path.dirname(file), specifier));
  }
  const t2 = performance.now();
  const entry = modules.get(entryFile);
  await entry.link((specifier, referencing) =>
    compile(
      path.resolve(
        path.dirname(new URL(referencing.identifier).pathname),
        specifier,
      ),
    ),
  );
  const t3 = performance.now();
  await entry.evaluate();
  const t4 = performance.now();
  if (timings) {
    timings.context = t1 - t0;
    timings.compile = t2 - t1;
    timings.link = t3 - t2;
    timings.evaluate = t4 - t3;
    let previous = t3;
    for (const [name, at] of marks) {
      timings[`evaluate:${name}`] = at - previous;
      previous = at;
    }
    if (marks.length > 0) timings["evaluate:exports"] = t4 - previous;
  }
  return entry.namespace;
};

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const sampleTask = makeTask("insert", 1);
const allCases = [
  ["noopQuery", "query", "noopQuery", () => ({ nonce: 1 })],
  ["noopMutation", "mutation", "noopMutation", () => ({ nonce: 1 })],
  ["getById", "query", "getById", () => ({ id: taskId, nonce: 1 })],
  ["list100", "query", "list", () => ({ projectId: "p100", nonce: 1 })],
  ["list1000", "query", "list", () => ({ projectId: "p1000", nonce: 1 })],
  [
    "embeddings300x1536",
    "query",
    "listEmbeddings",
    () => ({ setId: "e300", nonce: 1 }),
  ],
  ["insert", "mutation", "insert", () => ({ task: sampleTask })],
  [
    "patch",
    "mutation",
    "patch",
    (i) => ({ id: taskId, status: statuses[i % 4], priority: i % 5 }),
  ],
];
const cases = allCases.filter(
  ([label]) => caseFilter === undefined || caseFilter.includes(label),
);

const invoke = (exports, kind, name, args) => {
  const fn = exports[name];
  const argsJson = JSON.stringify([args]);
  return kind === "query"
    ? fn.invokeQuery(argsJson)
    : fn.invokeMutation(argsJson);
};

// Sanity: both sides return the same JSON for every case.
for (const [label, kind, name, args] of cases) {
  const plain = await invoke(await loadEntry("plain"), kind, name, args(0));
  const confect = await invoke(await loadEntry("confect"), kind, name, args(0));
  if (kind === "query" && plain !== confect)
    throw new Error(
      `${label}: plain and Confect results differ\n${plain.slice(0, 300)}\n${confect.slice(0, 300)}`,
    );
}

// ---------------------------------------------------------------------------
// Profiling support
// ---------------------------------------------------------------------------

// Only attach the inspector when profiling: an attached session changes how
// V8 compiles.
const session =
  profileOut || profileRegistration ? new inspector.Session() : undefined;
session?.connect();
const post = (method, params) =>
  new Promise((resolve, reject) =>
    session.post(method, params, (error, result) =>
      error ? reject(error) : resolve(result),
    ),
  );
const profiles = {};
if (profileOut || profileRegistration) {
  await post("Profiler.enable");
  await post("Profiler.setSamplingInterval", { interval: 50 });
}
const profiled = async (key, run) => {
  if (!profileOut) return run();
  await post("Profiler.start");
  try {
    return await run();
  } finally {
    const { profile } = await post("Profiler.stop");
    (profiles[key] ??= []).push(profile);
  }
};

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

const results = {};
for (const [label, kind, name, args] of cases) {
  const samples = { plain: [], confect: [] };
  for (let i = 0; i < warmup + iterations; i++) {
    const order = i % 2 === 0 ? ["plain", "confect"] : ["confect", "plain"];
    for (const side of order) {
      globalThis.gc?.();
      const timings = {};
      const recording = i >= warmup;
      registrationProfiling.active =
        profileRegistration && recording && side === "confect";
      const exports =
        recording && profileOut
          ? await profiled(`${label}/${side}/load`, () =>
              loadEntry(side, timings),
            )
          : await loadEntry(side, timings);
      const t0 = performance.now();
      if (recording && profileOut)
        await profiled(`${label}/${side}/invoke`, () =>
          invoke(exports, kind, name, args(i)),
        );
      else await invoke(exports, kind, name, args(i));
      timings.invoke = performance.now() - t0;
      timings.total =
        timings.context +
        timings.compile +
        timings.link +
        timings.evaluate +
        timings.invoke;
      if (recording) samples[side].push(timings);
    }
  }
  results[label] = samples;
  console.error(`done ${label}`);
}

const pct = (xs, p) => {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
};
const stat = (rows, key) => {
  const xs = rows.map((row) => row[key]).filter((x) => x !== undefined);
  return xs.length === 0
    ? undefined
    : { p50: pct(xs, 50), p95: pct(xs, 95), n: xs.length };
};
const fmt = (s) =>
  s === undefined ? "-" : `${s.p50.toFixed(2)} / ${s.p95.toFixed(2)}`;
const keys = ["compile", "evaluate", "invoke", "total"];
console.log(
  `bundle ${path.basename(bundleDir)}, cachedData=${useCachedData}, n=${iterations} per side, ms p50 / p95`,
);
console.log(
  `| case | ${keys.map((k) => `plain ${k}`).join(" | ")} | ${keys.map((k) => `Confect ${k}`).join(" | ")} | Δ total p50 |`,
);
console.log(
  `|---|${keys.map(() => "---").join("|")}|${keys.map(() => "---").join("|")}|---|`,
);
const summary = {};
for (const [label, { plain, confect }] of Object.entries(results)) {
  const row = { plain: {}, confect: {} };
  for (const key of new Set([
    ...plain.flatMap(Object.keys),
    ...confect.flatMap(Object.keys),
  ])) {
    row.plain[key] = stat(plain, key);
    row.confect[key] = stat(confect, key);
  }
  summary[label] = row;
  console.log(
    `| ${label} | ${keys.map((k) => fmt(row.plain[k])).join(" | ")} | ${keys.map((k) => fmt(row.confect[k])).join(" | ")} | ${(row.confect.total.p50 - row.plain.total.p50).toFixed(2)} |`,
  );
}
const evalKeys = Object.keys(summary[Object.keys(summary)[0]].confect).filter(
  (k) => k.startsWith("evaluate:"),
);
if (evalKeys.length > 0) {
  console.log(
    `\nConfect evaluate split (first case, p50 ms): ${evalKeys.map((k) => `${k.slice(9)} ${summary[Object.keys(summary)[0]].confect[k].p50.toFixed(2)}`).join(", ")}`,
  );
}
if (jsonOut)
  writeFileSync(jsonOut, JSON.stringify({ summary, results }, null, 0));
if (profileOut) writeFileSync(profileOut, JSON.stringify(profiles));
if (profileRegistration)
  writeFileSync(
    flag("profile-registration-out", "registration-profile.json"),
    JSON.stringify(profiles),
  );
session?.disconnect();
void createRequire;
void existsSync;
