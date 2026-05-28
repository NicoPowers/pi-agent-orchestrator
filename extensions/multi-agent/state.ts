import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ChildProcess } from "node:child_process";

export const LOG_FILE = path.join(os.tmpdir(), "pi-multi-agent.log");

export function log(tag: string, msg: string, extra?: unknown) {
	const ts = new Date().toISOString();
	const payload = extra !== undefined ? ` ${JSON.stringify(extra)}` : "";
	try {
		fs.appendFileSync(LOG_FILE, `[${ts}] [${tag}] ${msg}${payload}\n`);
	} catch {
		/* ignore */
	}
}

export interface RuntimeToolInfo {
	name: string;
	description?: string;
	sourceInfo?: unknown;
}

export interface RuntimeToolConflict {
	name: string;
	count: number;
	sources: string[];
}

export interface RuntimeToolSnapshot {
	active: RuntimeToolInfo[];
	all: RuntimeToolInfo[];
	reportedAt: number;
	source: "child-agent";
	conflicts?: RuntimeToolConflict[];
}

export type AgentClass =
	| "lead"
	| "scout"
	| "implementer"
	| "reviewer"
	| "orchestrator";

export interface AgentDefinition {
	name: string;
	description: string;
	agentClass?: AgentClass;
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	tools?: string[];
	noTools?: boolean;
	skills?: string[];
	noSkills?: boolean;
	skillTemplates?: string[];
	extensionTemplates?: string[];
	noExtensions?: boolean;
	noContextFiles?: boolean;
	isolated?: boolean;
	delegate?: boolean;
	systemPrompt: string;
	source: "user" | "project" | "package";
	readOnly?: boolean;
	example?: boolean;
	filePath: string;
}

export type AgentStatus =
	| "idle"
	| "queued"
	| "writing"
	| "waiting"
	| "streaming"
	| "error"
	| "exited";

export interface PendingAgentSend {
	message: string;
	startedAt: number;
	timeoutMs: number;
	status: Extract<AgentStatus, "queued" | "writing" | "waiting" | "streaming">;
}

export interface AgentLaunchMetadata {
	command: string;
	args: string[];
	cwd: string;
	pid?: number;
	startedAt: number;
}

export interface NativePiSessionMetadata {
	sessionId?: string;
	sessionFile?: string;
	sessionName?: string;
	reportedAt: number;
}

export interface AgentObservabilityArtifacts {
	sessionId: string;
	agentId: string;
	rootPath: string;
	agentPath: string;
	timelinePath: string;
}

export interface Agent {
	id: string;
	proc: ChildProcess;
	stdin: NodeJS.WritableStream;
	status: AgentStatus;
	accumulatedText: string;
	history: Array<{ role: "user" | "assistant"; text: string }>;
	events: Array<{ ts: number; type: string; event: any }>;
	buffer: string;
	definition?: AgentDefinition;
	model?: string;
	worktreePath: string;
	parent?: string;
	children: string[];
	issueId?: string;
	artifactPath?: string;
	artifactFiles?: import("./artifacts.js").IssueArtifactFiles;
	runtimeTools?: RuntimeToolSnapshot;
	dashboardVisible?: boolean;
	pendingSend?: PendingAgentSend;
	launch?: AgentLaunchMetadata;
	nativeSession?: NativePiSessionMetadata;
	observability?: AgentObservabilityArtifacts;
	_currentSend?: Promise<void>;
	_nextTurn?: { resolve: () => void; reject: (e: Error) => void };
	_rpcRequests?: Map<
		string,
		{
			resolve: (data: any) => void;
			reject: (e: Error) => void;
			timer: NodeJS.Timeout;
		}
	>;
	_turnTimer?: NodeJS.Timeout;
}

export interface PendingTask {
	name: string;
	message: string;
	startTime: number;
}

export function appendAgentEvent(
	agent: Agent,
	type: string,
	event: Record<string, any>,
) {
	agent.events.push({
		ts: Date.now(),
		type,
		event: { type, ...event },
	});
	if (agent.events.length > 500) agent.events.shift();
}

export const agents = new Map<string, Agent>();
export const pendingTasks = new Map<string, PendingTask>();
