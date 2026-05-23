import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";

const COMMS_DIR = path.join(process.cwd(), ".pi", "comms");
const RUNTIME_TOOLS_FILE = path.join(COMMS_DIR, "runtime-tools.json");

function serializeTool(tool: any) {
	return {
		name: tool.name,
		description: tool.description,
		sourceInfo: tool.sourceInfo,
	};
}

function activeToolDetails(pi: ExtensionAPI) {
	const all = pi.getAllTools().map(serializeTool);
	const allByName = new Map(all.map((tool) => [tool.name, tool]));
	const active = pi
		.getActiveTools()
		.map((name) => allByName.get(name) || { name });
	return { active, all };
}

function reportRuntimeTools(pi: ExtensionAPI) {
	try {
		fs.mkdirSync(COMMS_DIR, { recursive: true });
		const { active, all } = activeToolDetails(pi);
		const snapshot = {
			active,
			all,
			reportedAt: Date.now(),
			source: "child-agent",
		};
		fs.writeFileSync(
			RUNTIME_TOOLS_FILE,
			JSON.stringify(snapshot, null, 2),
			"utf-8",
		);
	} catch {
		/* best-effort only */
	}
}

export default function (pi: ExtensionAPI) {
	pi.on("session_start", () => {
		reportRuntimeTools(pi);
		setTimeout(() => reportRuntimeTools(pi), 250);
		setTimeout(() => reportRuntimeTools(pi), 1_000);
	});
	pi.on("agent_start", () => reportRuntimeTools(pi));
	pi.on("agent_end", () => reportRuntimeTools(pi));
}
