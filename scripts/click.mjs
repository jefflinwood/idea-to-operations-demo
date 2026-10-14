// Signs in and clicks one button on one page of your own deployment, then screenshots. ALLOW_REMOTE=1 BASE_URL=... node scripts/click.mjs <path> <label> <out.png>
import { readFileSync } from "node:fs";
import { launch } from "./cdp.mjs";
const [path, label, out] = process.argv.slice(2), B = process.env.BASE_URL;
const creds = Object.fromEntries(readFileSync(new URL("../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const b = await launch({ width: 1280 });
const set = (id, v) => `(() => { const el = document.getElementById(${JSON.stringify(id)}); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event("input", { bubbles: true })) })()`;
await b.go(`${B}/auth/sign-in`);
await b.js(`${set("email", creds.DEMO_HUMAN_EMAIL)};${set("password", creds.DEMO_HUMAN_PASSWORD)};document.getElementById("sign-in-form").requestSubmit()`);
// Sign-in sometimes hangs on "Signing in..." (intermittent, server side): wait up to 10 s to leave /auth, and sign in again if not.
for (let attempt = 1; attempt <= 3; attempt++) {
  if (await b.waitFor(`!location.pathname.startsWith("/auth")`, 10000)) break;
  await b.go(`${B}/auth/sign-in`);
  await b.js(`${set("email", creds.DEMO_HUMAN_EMAIL)};${set("password", creds.DEMO_HUMAN_PASSWORD)};document.getElementById("sign-in-form").requestSubmit()`);
}
await b.go(`${B}${path}`, 2500);
console.log("clicked:", await b.js(`(() => { const x = [...document.querySelectorAll("button")].find((e) => e.textContent.trim() === ${JSON.stringify(label)}); if (!x) return false; x.click(); return true })()`));
await sleep(6000); await b.shot(out); console.log((await b.text()).slice(0, 300).replace(/\n/g, " | ")); b.close();
