/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// Starts a local backend for this fixture, runs the plain-vs-Confect
// comparison against it, and stops the backend.
//
//   pnpm build && pnpm --filter @confect/server-per-call-bench bench [iterations]
//
// `CASES=list1000,insert` limits the cases; `CONFECT_MODULE=groups/benchAot`
// compares a different Confect entry. The plain modules in `convex/` are not
// generated: `confect codegen` deletes them, so restore them from
// `plainConvex/` after running codegen here.
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";

const here = path.dirname(new URL(import.meta.url).pathname);
const iterations = process.argv[2] ?? "30";
const port = "3290";

const backend = spawn(
  "pnpm",
  [
    "convex",
    "dev",
    "--typecheck=disable",
    "--codegen=disable",
    "--tail-logs=disable",
    "--local-cloud-port",
    port,
    "--local-site-port",
    "3291",
  ],
  {
    cwd: here,
    detached: true,
    env: { ...process.env, CONVEX_AGENT_MODE: "anonymous" },
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const stop = () => {
  try {
    process.kill(-backend.pid, "SIGINT");
  } catch {
    // Already gone.
  }
  // `convex dev` can leave the backend binary running after its own exit.
  spawnSync("pkill", ["-INT", "-f", `convex-local-backend --port ${port}`]);
};

try {
  await new Promise((resolve, reject) => {
    let output = "";
    const timer = setTimeout(
      () => reject(new Error(`convex dev not ready after 180 s:\n${output}`)),
      180_000,
    );
    const onData = (chunk) => {
      output += chunk;
      if (output.includes("Convex functions ready")) {
        clearTimeout(timer);
        resolve();
      }
    };
    backend.stdout.on("data", onData);
    backend.stderr.on("data", onData);
    backend.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`convex dev exited with ${code}:\n${output}`));
    });
  });
  const run = spawnSync(
    process.execPath,
    [path.join(here, "localBackend.mjs"), iterations, "run"],
    { cwd: here, stdio: "inherit" },
  );
  process.exitCode = run.status ?? 1;
} finally {
  stop();
}
