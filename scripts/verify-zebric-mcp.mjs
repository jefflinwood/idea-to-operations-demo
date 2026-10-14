// Read-only deployed MCP check. Never claims tasks or runs mutation tools.
// Usage: node scripts/verify-zebric-mcp.mjs [origin]
// Credentials: environment, falling back to .prod.vars (never printed).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let fileEnv = {};
try {
	fileEnv = Object.fromEntries(readFileSync(new URL("../.prod.vars", import.meta.url), "utf8")
		.split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#") && line.includes("="))
		.map((line) => {
			const i = line.indexOf("=");
			return [line.slice(0, i).trim(), line.slice(i + 1).trim().replace(/^(["'])(.*)\1$/, "$2")];
		}));
} catch (error) { if (error.code !== "ENOENT") throw error; }
const env = { ...fileEnv, ...process.env };
const origin = process.argv[2] ?? env.BASE_URL ?? "http://localhost:18800";
const endpoint = new URL("/mcp", origin);
let id = 0;

async function rpc(key, method, params) {
	const requestId = ++id;
	const headers = {
			"content-type": "application/json", accept: "application/json, text/event-stream",
			...(key ? { authorization: `Bearer ${key}` } : {}),
	};
	const bodyText = JSON.stringify({ jsonrpc: "2.0", id: requestId, method, params });
	const response = await fetch(endpoint, {
		method: "POST", headers, body: bodyText,
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) return { status: response.status };
	const body = await response.json();
	assert.equal(body.id, requestId, "JSON-RPC response id");
	assert.equal(body.error, undefined, `MCP ${method} returned a protocol error`);
	return { status: response.status, result: body.result };
}

try {
	assert.equal((await rpc(undefined, "tools/list", {})).status, 401, "MCP requires bearer auth");
	console.log("PASS missing bearer rejected (401)");
	const keys = Object.keys(env).filter((name) => /^AGENT\d+_API_KEY$/.test(name) && env[name])
		.sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
	assert.ok(keys.length, "No AGENT<n>_API_KEY credentials found");
	const required = ["zebric_task_entity_api_list_task", "zebric_claim_task", "zebric_start_change",
		"zebric_acquire_symbol_lease", "zebric_release_symbol_lease", "zebric_record_lease_risk",
		"zebric_record_agent_run", "zebric_submit_change", "zebric_submit_task"];
	for (const name of keys) {
		const key = env[name];
		const init = await rpc(key, "initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "verify-zebric-mcp", version: "1.0.0" } });
		assert.equal(init.status, 200, `${name}: initialize`);
		assert.ok(init.result?.capabilities?.tools, "Server advertises tools");
		const tools = await rpc(key, "tools/list", {});
		assert.equal(tools.status, 200, `${name}: tools/list`);
		const names = new Set(tools.result.tools.map((tool) => tool.name));
		for (const tool of required) assert.ok(names.has(tool), `Missing ${tool}`);
		const tasks = await rpc(key, "tools/call", { name: required[0], arguments: { limit: 1 } });
		assert.equal(tasks.status, 200, `${name}: tools/call`);
		assert.ok(!tasks.result.isError, `${name}: task read denied`);
		const data = JSON.parse(tasks.result.content.find((item) => item.type === "text").text);
		assert.ok(Array.isArray(data), "Task tool returns an array");
		console.log(`PASS ${name}: initialize, ${names.size} tools, authenticated task read`);
	}
	const denied = await rpc("invalid-verification-key", "tools/call", { name: required[0], arguments: { limit: 1 } });
	assert.ok(denied.status === 401 || denied.status === 403 || denied.result?.isError, "Invalid key cannot read tasks");
	console.log("PASS invalid bearer cannot read tasks");
	console.log(`Verified ${keys.length} agent credentials at ${endpoint}; no mutations called.`);
} catch (error) {
	console.error(`FAIL ${error.message}`);
	process.exitCode = 1;
}
