// Creates (first run) and signs in the local test human through Zebric's own sign-up/sign-in forms, localhost only.
// Credentials live in the git-ignored .dev.human file. Usage: BASE_URL=http://localhost:18791 node scripts/spike/zebric-ui-login.mjs
import { readFileSync } from "node:fs";
import { launch } from "../cdp.mjs";
const B = process.env.BASE_URL ?? "http://localhost:18791";
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(B)) throw new Error("this helper only creates test accounts on a local development host");
const creds = Object.fromEntries(readFileSync(new URL("../../.dev.human", import.meta.url), "utf8").trim().split("\n").map((l) => l.split("=")));
const b = await launch();
await b.go(`${B}/auth/sign-up`);
await b.js(`(() => { const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); };
  set("name", "Demo Human"); set("email", ${JSON.stringify(creds.DEMO_HUMAN_EMAIL)}); set("password", ${JSON.stringify(creds.DEMO_HUMAN_PASSWORD)});
  document.getElementById("sign-up-form").requestSubmit(); })()`);
await b.waitFor(`location.pathname === "/" && !document.body.innerText.includes("Sign up")`, 15000);
console.log("after sign-up:", await b.js("location.pathname"), (await b.text()).slice(0, 80).replace(/\n/g, " | "));
b.close();
