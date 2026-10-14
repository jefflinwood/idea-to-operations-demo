// Runs fixtures A-D against a merge service: BASE_URL (default local container).
// Usage: BASE_URL=http://localhost:8080 [AUTH_TOKEN=...] node --experimental-strip-types scripts/run.ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8080";
const headers: Record<string, string> = { "content-type": "application/json" };
if (process.env.AUTH_TOKEN) headers.authorization = `Bearer ${process.env.AUTH_TOKEN}`;

const fx = (dir: string, f: string) =>
  readFileSync(fileURLToPath(new URL(`../fixtures/${dir}/${f}.ts`, import.meta.url)), "utf8");

async function post(path: string, body: unknown) {
  const res = await fetch(BASE_URL + path, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`${path} -> ${res.status} ${await res.text()}`);
  return res.json() as Promise<any>;
}

type Case = { id: string; name: string; expectMerge: "merged" | "conflict"; expectTsc?: "passed" | "failed" };
const cases: Case[] = [
  { id: "A", name: "independent symbols", expectMerge: "merged", expectTsc: "passed" },
  { id: "B", name: "imports + both append new function at same spot", expectMerge: "conflict" },
  { id: "B2", name: "imports + new functions at different spots", expectMerge: "merged", expectTsc: "passed" },
  { id: "C", name: "same-symbol collision", expectMerge: "conflict" },
  { id: "D", name: "semantic conflict (return type vs consumer)", expectMerge: "merged", expectTsc: "failed" },
];

const runs = Number(process.env.RUNS ?? 1);
let failures = 0;
for (let i = 0; i < runs; i++) {
  for (const c of cases) {
    const t0 = Date.now();
    const m = await post("/merge", { base: fx(c.id, "base"), ours: fx(c.id, "ours"), theirs: fx(c.id, "theirs"), path: "src/file.ts" });
    let tsc: any;
    if (c.expectTsc) tsc = await post("/typecheck", { files: { "src/file.ts": m.result } });
    const ok = m.status === c.expectMerge && (!c.expectTsc || tsc.status === c.expectTsc);
    if (!ok) failures++;
    console.log(
      `${ok ? "PASS" : "FAIL"} ${c.id.padEnd(2)} ${c.name.padEnd(48)} merge=${m.status}` +
        (m.conflicts?.length ? `(${m.conflicts.length} conflict)` : "") +
        (tsc ? ` tsc=${tsc.status}` : "") + ` ${Date.now() - t0}ms`,
    );
    if (process.env.VERBOSE) {
      console.log(m.result);
      if (tsc?.diagnostics?.length) console.log(tsc.diagnostics.join("\n"));
    } else if (tsc?.status === "failed" && i === 0) {
      console.log("     " + tsc.diagnostics.join("\n     "));
    }
  }
}
console.log(failures ? `\n${failures} FAILED` : "\nall as expected");
process.exit(failures ? 1 : 0);
