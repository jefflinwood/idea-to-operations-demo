// Generate credentials without copying anyone's Cloudflare or GitHub account data.
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

process.chdir(fileURLToPath(new URL("../", import.meta.url)));
const files = [".dev.vars", ".prod.vars", ".prod.secrets.json", ".dev.human", "mergiraf-spike/.dev.vars"];
if (files.some(existsSync)) throw new Error("Setup files already exist. Keep them or remove them explicitly before generating new credentials.");
const secret = () => randomBytes(32).toString("hex");
const names = ["BETTER_AUTH_SECRET", "SEED_API_KEY", "INTEGRATOR_API_KEY", "HUMAN_API_KEY", "UI_KEY", "SPIKE_KEY", ...Array.from({ length: 10 }, (_, i) => `AGENT${i + 1}_API_KEY`)];
const credentials = Object.fromEntries(names.map((name) => [name, secret()]));
const vars = Object.entries(credentials).map(([name, value]) => `${name}=${value}`).join("\n") + "\n";
const write = (path, value) => writeFileSync(path, value, { mode: 0o600, flag: "wx" });
write(".dev.vars", vars);
write(".prod.vars", vars);
write(".prod.secrets.json", JSON.stringify(credentials, null, 2) + "\n");
write("mergiraf-spike/.dev.vars", `SPIKE_KEY=${credentials.SPIKE_KEY}\n`);
write(".dev.human", `DEMO_HUMAN_NAME=DemoOperator\nDEMO_HUMAN_EMAIL=demo.human@example.test\nDEMO_HUMAN_PASSWORD=${secret()}\n`);
console.log("Created ignored credential files (permissions 0600). Local and deployed demo credentials match; SPIKE_KEY is shared with the merge worker.");
