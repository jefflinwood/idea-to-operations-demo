// Minimal headless-Chrome driver over the DevTools protocol (no dependencies).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME ?? (process.platform === "darwin" ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" : process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ width = 1280, height = 1400 } = {}) {
  const port = 9300 + Math.floor(Math.random() * 500);
  const chrome = spawn(CHROME, [`--remote-debugging-port=${port}`, `--user-data-dir=${mkdtempSync(join(tmpdir(), "cdp-"))}`, "--headless=new", "--disable-gpu", "--hide-scrollbars", `--window-size=${width},${height}`, "about:blank"], { stdio: "ignore" });
  let target;
  for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page"); } catch {} }
  if (!target) throw new Error("could not reach Chrome");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pending = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await cdp("Page.enable");
  const js = async (expr) => { const r = await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.text + " " + (r.result.exceptionDetails.exception?.description ?? "")); return r.result?.result?.value; };
  return {
    js,
    async go(url, settleMs = 1500) { await cdp("Page.navigate", { url }); await sleep(settleMs); },
    async waitFor(expr, ms = 15000) { const end = Date.now() + ms; while (Date.now() < end) { if (await js(expr).catch(() => false)) return true; await sleep(300); } return false; },
    async shot(file, fullPage = true) {
      const h = fullPage ? Math.min(3200, Math.max(800, (await js("document.documentElement.scrollHeight")) + 10)) : height;
      await cdp("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: false });
      writeFileSync(file, Buffer.from((await cdp("Page.captureScreenshot", { format: "png" })).result.data, "base64"));
    },
    text: () => js("document.body.innerText"),
    close() { chrome.kill(); },
  };
}
