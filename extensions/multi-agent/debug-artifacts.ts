import * as fs from "node:fs";
import * as path from "node:path";
import type { Agent, AgentObservabilityArtifacts } from "./state.js";
import { buildAgentTimeline, type AgentTimeline } from "./timeline.js";

const DEBUG_ROOT_SEGMENTS = [
	".pi",
	"pi-lattice",
	"sessions",
] as const;
const MAX_SERIALIZED_TEXT = 200_000;
const SECRET_PATTERN =
	/(sk-[A-Za-z0-9_-]{4,}|(?:api[_-]?key|token|secret|password)(?:=|":\s*")[^\s",}]+)/gi;

export interface PersistedAgentDebugTimeline {
	kind: "spawned-agent-debug-timeline";
	version: 1;
	sessionId: string;
	agentId: string;
	capturedAt: string;
	note: string;
	timeline: AgentTimeline;
}

export function sanitizeArtifactId(value: string): string {
	const sanitized = value
		.trim()
		.replace(/[\\/]+/g, "-")
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "")
		.slice(0, 120);
	if (!sanitized) throw new Error("Artifact id is required.");
	return sanitized;
}

export function defaultObservabilitySessionId(now = Date.now()): string {
	return new Date(now).toISOString().replace(/[:.]/g, "-");
}

export function prepareAgentDebugArtifacts(options: {
	repoCwd: string;
	agentId: string;
	sessionId?: string;
}): AgentObservabilityArtifacts {
	const sessionId = sanitizeArtifactId(
		options.sessionId || defaultObservabilitySessionId(),
	);
	const agentId = sanitizeArtifactId(options.agentId);
	const rootPath = path.resolve(
		options.repoCwd,
		...DEBUG_ROOT_SEGMENTS,
		sessionId,
	);
	const agentPath = path.join(rootPath, "agents", agentId);
	const timelinePath = path.join(agentPath, "timeline.json");
	fs.mkdirSync(agentPath, { recursive: true });
	return { sessionId, agentId, rootPath, agentPath, timelinePath };
}

export function persistAgentDebugSnapshot(
	agent: Agent,
	options: { repoCwd: string; stderrTail?: string; now?: number },
): PersistedAgentDebugTimeline | undefined {
	const observability =
		agent.observability ||
		prepareAgentDebugArtifacts({
			repoCwd: options.repoCwd,
			agentId: agent.id,
		});
	agent.observability = observability;
	const record: PersistedAgentDebugTimeline = {
		kind: "spawned-agent-debug-timeline",
		version: 1,
		sessionId: observability.sessionId,
		agentId: observability.agentId,
		capturedAt: new Date(options.now || Date.now()).toISOString(),
		note: "Operational spawned-agent observability artifact. Not Seeds tracker state and not Mulch durable knowledge unless promoted by root orchestrator.",
		timeline: buildAgentTimeline(agent, { stderrTail: options.stderrTail }),
	};
	try {
		fs.mkdirSync(observability.agentPath, { recursive: true });
		fs.writeFileSync(
			observability.timelinePath,
			redactAndLimit(JSON.stringify(record, null, 2)),
			{ encoding: "utf-8", mode: 0o600 },
		);
		return record;
	} catch {
		return undefined;
	}
}

export function readLatestAgentDebugTimeline(
	repoCwd: string,
	agentId: string,
): PersistedAgentDebugTimeline | undefined {
	const sessionsRoot = path.resolve(repoCwd, ...DEBUG_ROOT_SEGMENTS);
	const safeAgentId = sanitizeArtifactId(agentId);
	try {
		if (!fs.existsSync(sessionsRoot)) return undefined;
		const candidates: Array<{ mtimeMs: number; filePath: string }> = [];
		for (const sessionDir of fs.readdirSync(sessionsRoot, {
			withFileTypes: true,
		})) {
			if (!sessionDir.isDirectory()) continue;
			const filePath = path.join(
				sessionsRoot,
				sessionDir.name,
				"agents",
				safeAgentId,
				"timeline.json",
			);
			if (!fs.existsSync(filePath)) continue;
			const stat = fs.statSync(filePath);
			candidates.push({ mtimeMs: stat.mtimeMs, filePath });
		}
		candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
		const latest = candidates[0];
		if (!latest) return undefined;
		return JSON.parse(
			fs.readFileSync(latest.filePath, "utf-8"),
		) as PersistedAgentDebugTimeline;
	} catch {
		return undefined;
	}
}

function redactAndLimit(text: string): string {
	const redacted = text.replace(SECRET_PATTERN, (match) => {
		if (match.startsWith("sk-")) return "[REDACTED]";
		const separator = match.includes("=") ? "=" : '": "';
		const key = match.split(separator)[0];
		return `${key}${separator}[REDACTED]`;
	});
	if (redacted.length <= MAX_SERIALIZED_TEXT) return redacted;
	return `${redacted.slice(0, MAX_SERIALIZED_TEXT)}\n... [TRUNCATED]`;
}
