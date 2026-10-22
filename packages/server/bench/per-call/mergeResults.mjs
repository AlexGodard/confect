/* oxlint-disable -- Plain Node benchmark tooling, not library code: its timing loops await one call at a time on purpose. */
// node merge.mjs results/*.json — one table row per case file, case order fixed
import { readFileSync } from "node:fs";
const order = [
  "noopQuery",
  "noopMutation",
  "getById",
  "list100",
  "list1000",
  "embeddings300x1536",
  "insert",
  "patch",
];
const rows = {};
for (const file of process.argv.slice(2))
  Object.assign(rows, JSON.parse(readFileSync(file, "utf8")).summary);
const f = (s) => (s ? `${s.p50.toFixed(2)} / ${s.p95.toFixed(2)}` : "-");
const keys = ["compile", "evaluate", "invoke", "total"];
console.log(
  `| case | n | ${keys.map((k) => `plain ${k}`).join(" | ")} | ${keys.map((k) => `Confect ${k}`).join(" | ")} | Δ total p50 |`,
);
console.log(
  `|---|---|${keys.map(() => "---").join("|")}|${keys.map(() => "---").join("|")}|---|`,
);
for (const label of order) {
  const row = rows[label];
  if (!row) continue;
  console.log(
    `| ${label} | ${row.confect.total.n} | ${keys.map((k) => f(row.plain[k])).join(" | ")} | ${keys.map((k) => f(row.confect[k])).join(" | ")} | ${(row.confect.total.p50 - row.plain.total.p50).toFixed(2)} |`,
  );
}
for (const label of ["noopQuery", "noopMutation"]) {
  const c = rows[label]?.confect;
  if (!c) continue;
  console.log(
    `${label} Confect evaluate split p50/p95: ` +
      Object.keys(c)
        .filter((k) => k.startsWith("evaluate:"))
        .map((k) => `${k.slice(9)} ${f(c[k])}`)
        .join(", ") +
      ` | context ${f(c.context)} link ${f(c.link)}`,
  );
}
