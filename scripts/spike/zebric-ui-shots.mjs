// Signs in as the local test human and screenshots Zebric's own pages. Localhost only.
// Usage: BASE_URL=http://localhost:18791 [REPO=<id>] [CHANGE=<id>] [DECISION=<id>] [OUT=dir] node scripts/spike/zebric-ui-shots.mjs
import { readFileSync, mkdirSync } from "node:fs";
import { launch } from "../cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18791";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) throw new Error("local development host only");
const OUT = process.env.OUT ?? new URL("../../results/zebric-ui/", import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const creds = Object.fromEntries(readFileSync(new URL("../../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const b = await launch();
await b.go(`${B}/auth/sign-in`);
await b.js(`(() => { const set = (n, v) => { const el = document.querySelector('[name="' + n + '"]'); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
  set("email", ${JSON.stringify(creds.DEMO_HUMAN_EMAIL)}); set("password", ${JSON.stringify(creds.DEMO_HUMAN_PASSWORD)}); document.querySelector("form").requestSubmit(); })()`);
await b.waitFor(`!location.pathname.startsWith("/auth/")`, 15000);
const pages = [["runs", "/"]];
if (process.env.REPO) pages.push(["swarm", `/runs/${process.env.REPO}`], ["changes", `/runs/${process.env.REPO}/changes`]);
if (process.env.CHANGE) pages.push(["change", `/changes/${process.env.CHANGE}`]);
if (process.env.DECISION) pages.push(["decision", `/decisions/${process.env.DECISION}`]);
for (const [name, path] of pages) { await b.go(`${B}${path}`, 2500); await b.shot(`${OUT}${name}.png`); console.log(name, path, "->", await b.js("location.pathname"), (await b.text()).length, "chars"); }
b.close();
