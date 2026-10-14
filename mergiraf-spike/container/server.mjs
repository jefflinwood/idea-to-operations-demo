// Minimal merge/typecheck service. Shells out to mergiraf and tsc; no framework.
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile, readFile, mkdir, rm } from "node:fs/promises";
import { tmpdir, loadavg, cpus } from "node:os";
import { dirname, join, normalize, extname } from "node:path";

const run = (cmd, args, opts = {}) =>
  new Promise((resolve) =>
    execFile(cmd, args, { maxBuffer: 16 * 1024 * 1024, ...opts }, (err, stdout, stderr) =>
      resolve({ code: err ? (typeof err.code === "number" ? err.code : -1) : 0, stdout, stderr }),
    ),
  );

const markerRe = /^<<<<<<< .*\n([\s\S]*?)^\|\|\|\|\|\|\| .*\n([\s\S]*?)^=======\n([\s\S]*?)^>>>>>>> .*\n/gm;

function parseConflicts(text) {
  return [...text.matchAll(markerRe)].map((m) => ({
    index: m.index,
    ours: m[1],
    base: m[2],
    theirs: m[3],
  }));
}

async function merge({ base, ours, theirs, path = "file.ts" }) {
  const ext = extname(path) || ".ts";
  const dir = await mkdtemp(join(tmpdir(), "merge-"));
  try {
    await Promise.all([
      writeFile(join(dir, `base${ext}`), base),
      writeFile(join(dir, `ours${ext}`), ours),
      writeFile(join(dir, `theirs${ext}`), theirs),
    ]);
    const r = await run("mergiraf", [
      "merge", join(dir, `base${ext}`), join(dir, `ours${ext}`), join(dir, `theirs${ext}`),
      "-p", path, "-s", "base", "-x", "ours", "-y", "theirs",
    ]);
    if (r.code !== 0 && r.code !== 1) {
      return { status: "error", result: "", conflicts: [], stderr: r.stderr };
    }
    const conflicts = parseConflicts(r.stdout);
    return {
      status: r.code === 0 ? "merged" : "conflict",
      result: r.stdout,
      conflicts,
      stderr: r.stderr,
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

// files: { "src/a.ts": "..." }. Runs the container's tsc over them.
async function typecheck({ files }) {
  const dir = await mkdtemp(join(tmpdir(), "tsc-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      const rel = normalize(name);
      if (rel.startsWith("..") || rel.startsWith("/")) throw new Error(`bad path: ${name}`);
      await mkdir(dirname(join(dir, rel)), { recursive: true });
      await writeFile(join(dir, rel), content);
    }
    await writeFile(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          target: "ES2022", module: "ESNext", moduleResolution: "Bundler", strict: true,
          noEmit: true, skipLibCheck: true, types: ["node"], typeRoots: ["/app/node_modules/@types"],
        },
        include: ["**/*.ts"],
      }),
    );
    const t0 = Date.now();
    const r = await run("node", ["/app/node_modules/typescript/bin/tsc", "-p", dir, "--pretty", "false"]);
    const tscMs = Date.now() - t0;
    const diagnostics = r.stdout.split("\n").filter((l) => l.includes(": error TS"));
    return { status: r.code === 0 ? "passed" : "failed", diagnostics, output: r.stdout, tscMs, load: loadavg(), cpus: cpus().length };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

const routes = { "/merge": merge, "/typecheck": typecheck };

createServer(async (req, res) => {
  const send = (code, body) => {
    res.writeHead(code, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.method === "GET" && req.url === "/health") return send(200, { ok: true });
  const handler = routes[req.url];
  if (req.method !== "POST" || !handler) return send(404, { error: "not found" });
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    send(200, await handler(JSON.parse(Buffer.concat(chunks).toString("utf8"))));
  } catch (e) {
    send(500, { error: String(e?.message ?? e) });
  }
}).listen(8080, () => console.log("merge container listening on 8080"));
