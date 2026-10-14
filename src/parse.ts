// Parses an agent's reply into file edits. Kept dependency-free so it can be tested under plain node.
export function parseEdits(text: string): { summary: string; edits: Record<string, string> } {
	// Split on FILE headers; a block runs to the next header or ===END===, and models sometimes omit the latter.
	const parts = text.split(/^===FILE:\s*(.+?)\s*===[ \t]*$/m);
	const summary = parts[0].replace(/===SUMMARY===/, "").trim();
	const edits: Record<string, string> = {};
	for (let i = 1; i < parts.length; i += 2) {
		let content = parts[i + 1].split(/^===END===[ \t]*$/m)[0].replace(/^\n/, "").replace(/\s+$/, "");
		const fenced = content.match(/^```[a-z]*\n([\s\S]*?)\n```$/);
		if (fenced) content = fenced[1];
		edits[parts[i]] = content + "\n";
	}
	for (const path of Object.keys(edits)) {
		if (!/^src\/[\w./-]+\.ts$/.test(path) || path.includes("..")) throw new Error(`illegal path ${path}`);
	}
	if (!Object.keys(edits).length) throw new Error("no ===FILE blocks found");
	return { summary, edits };
}

/** Returns a reason if the code silences the type checker instead of satisfying it. */
export function silencesTypeChecker(code: string): string | undefined {
	if (/[\w)\]]!(?![=])/.test(code.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, '""'))) return "a non-null assertion (!)";
	if (/\bas\s+(any|unknown)\b/.test(code)) return "an 'as any' / 'as unknown' cast";
	if (/@ts-(ignore|expect-error|nocheck)/.test(code)) return "a @ts- suppression comment";
	return undefined;
}
