// Local visual check: signs in as the dev human (creating it on first use, localhost only) and screenshots pages.
//   BASE_URL=http://localhost:18800 node scripts/shots.mjs [outDir] /path ...
import { readFileSync, mkdirSync } from "node:fs";
import { launch } from "./cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18800";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B) && process.env.ALLOW_REMOTE !== "1") throw new Error("local only; set ALLOW_REMOTE=1 for your own deployment");
const creds = Object.fromEntries(readFileSync(new URL("../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const [out, ...paths] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const b = await launch({ width: Number(process.env.WIDTH ?? 1280) });
const set = (id, v) => `(() => { const el = document.getElementById(${JSON.stringify(id)}); if (!el) return false; el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event("input", { bubbles: true })); return true })()`;
await b.go(`${B}/auth/sign-in`);
await b.js(`${set("email", creds.DEMO_HUMAN_EMAIL)};${set("password", creds.DEMO_HUMAN_PASSWORD)};document.getElementById("sign-in-form").requestSubmit()`);
await new Promise((r) => setTimeout(r, 2500));
if ((await b.js("location.pathname")).startsWith("/auth")) {
  await b.go(`${B}/auth/sign-up`);
  await b.js(`${set("name", creds.DEMO_HUMAN_NAME ?? "Demo Operator")};${set("email", creds.DEMO_HUMAN_EMAIL)};${set("password", creds.DEMO_HUMAN_PASSWORD)};document.getElementById("sign-up-form").requestSubmit()`);
  await new Promise((r) => setTimeout(r, 3000));
}
for (const p of paths) {
  await b.go(`${B}${p}`, 2500);
  const name = (p === "/" ? "home" : p.replace(/^\//, "").replace(/[\/:]/g, "_")) + ".png";
  await b.shot(`${out}/${name}`);
  console.log(p, "->", (await b.js("document.title")), (await b.text()).slice(0, 70).replace(/\n/g, " | "));
}
b.close();
