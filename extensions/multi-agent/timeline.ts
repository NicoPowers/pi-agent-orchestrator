import type { Agent, AgentDefinition } from "./state.js";

const DEFAULT_TEXT_LIMIT = 4_000;
const DEFAULT_FIELD_LIMIT = 1_000;
const MAX_TIMELINE_EVENTS = 500;

export interface AgentTimelineEntry {
	ts: number;
	time: string;
	type: string;
	label: string;
	text?: string;
	length?: number;
	truncated?: boolean;
	toolName?: string;
	argsPreview?: string;
	code?: number | null;
	signal?: string;
	error?: string;
	details?: Record<string, unknown>;
}

export interface TurnDiagnostics {
	stuck: boolean;
	elapsedMs?: number;
	thresholdMs: number;
	pendingStatus?: NonNullable<Agent["pendingSend"]>["status"];
	reasons: string[];
	likelyCauses: string[];
	actions: string[];
}

export interface AgentTimeline {
	metadata: {
		name: string;
		status: Agent["status"];
		model?: string;
		worktree: string;
		parent?: string;
		children: string[];
		issueId?: string;
		artifactPath?: string;
		artifactFiles?: Agent["artifactFiles"];
		pendingSend?: Agent["pendingSend"];
		turnDiagnostics?: TurnDiagnostics;
		turns: number;
		launch?: Agent["launch"];
		nativeSession?: Agent["nativeSession"];
		observabilityPath?: string;
	};
	definition?: ReturnType<typeof summarizeDefinition>;
	runtimeTools?: Agent["runtimeTools"];
	stderrTail?: string;
	history: Agent["history"];
	entries: AgentTimelineEntry[];
	limits: {
		maxEvents: number;
		textLimit: number;
		fieldLimit: number;
	};
}

export function buildAgentTimeline(
	agent: Agent,
	options: {
		stderrTail?: string;
		now?: number;
		stuckThresholdMs?: number;
	} = {},
): AgentTimeline {
	const entries = buildEntries(agent.events.slice(-MAX_TIMELINE_EVENTS));
	const stderrTail = cleanTail(options.stderrTail);
	return {
		metadata: {
			name: agent.id,
			status: agent.status,
			model: agent.model || agent.definition?.model,
			worktree: agent.worktreePath,
			parent: agent.parent,
			children: agent.children,
			issueId: agent.issueId,
			artifactPath: agent.artifactPath,
			artifactFiles: agent.artifactFiles,
			pendingSend: agent.pendingSend,
			turnDiagnostics: buildTurnDiagnostics(agent, entries, {
				now: options.now,
				stuckThresholdMs: options.stuckThresholdMs,
				stderrTail,
			}),
			turns: Math.floor(agent.history.length / 2),
			launch: agent.launch,
			nativeSession: agent.nativeSession,
			observabilityPath: agent.observability?.agentPath,
		},
		definition: agent.definition
			? summarizeDefinition(agent.definition)
			: undefined,
		runtimeTools: agent.runtimeTools,
		stderrTail,
		history: truncateHistory(agent.history),
		entries,
		limits: {
			maxEvents: MAX_TIMELINE_EVENTS,
			textLimit: DEFAULT_TEXT_LIMIT,
			fieldLimit: DEFAULT_FIELD_LIMIT,
		},
	};
}

function summarizeDefinition(definition: AgentDefinition) {
	const prompt = truncateText(
		definition.systemPrompt || "",
		DEFAULT_TEXT_LIMIT,
	);
	return {
		name: definition.name,
		description: definition.description,
		agentClass: definition.agentClass,
		model: definition.model,
		thinking: definition.thinking,
		tools: definition.tools,
		noTools: definition.noTools,
		skills: definition.skills,
		noSkills: definition.noSkills,
		skillTemplates: definition.skillTemplates,
		extensionTemplates: definition.extensionTemplates,
		noExtensions: definition.noExtensions,
		noContextFiles: definition.noContextFiles,
		isolated: definition.isolated,
		delegate: definition.delegate,
		source: definition.source,
		filePath: definition.filePath,
		systemPromptLength: definition.systemPrompt?.length || 0,
		systemPromptPreview: prompt.text,
		systemPromptTruncated: prompt.truncated,
	};
}

function buildEntries(events: Agent["events"]): AgentTimelineEntry[] {
	const entries: AgentTimelineEntry[] = [];
	let textBuffer = "";
	let textStartTs = 0;

	const flushAssistantText = () => {
		if (!textBuffer) return;
		const trimmed = textBuffer.trim();
		if (trimmed) {
			const preview = truncateText(trimmed, DEFAULT_TEXT_LIMIT);
			entries.push({
				ts: textStartTs,
				time: new Date(textStartTs).toISOString(),
				type: "assistant_text",
				label: "Assistant text",
				text: preview.text,
				length: trimmed.length,
				truncated: preview.truncated,
			});
		}
		textBuffer = "";
		textStartTs = 0;
	};

	for (const item of events) {
		const ev = item.event || {};
		const eventType = ev.type || item.type || "unknown";
		const delta = ev.assistantMessageEvent;
		if (eventType === "message_update" && delta?.type === "text_delta") {
			if (!textStartTs) textStartTs = item.ts;
			textBuffer += typeof delta.delta === "string" ? delta.delta : "";
			continue;
		}
		if (eventType === "message_update") continue;
		flushAssistantText();
		entries.push(normalizeEntry(item.ts, eventType, ev));
	}
	flushAssistantText();
	return entries;
}

function buildTurnDiagnostics(
	agent: Agent,
	entries: AgentTimelineEntry[],
	options: {
		now?: number;
		stuckThresholdMs?: number;
		stderrTail?: string;
	},
): TurnDiagnostics | undefined {
	const pending = agent.pendingSend;
	if (!pending) return undefined;

	const now = options.now ?? Date.now();
	const thresholdMs = options.stuckThresholdMs ?? 30_000;
	const elapsedMs = Math.max(0, now - pending.startedAt);
	const eventsSinceSend = agent.events.filter(
		(item) => item.ts >= pending.startedAt,
	);
	const hasAgentStart = eventsSinceSend.some(
		(item) => (item.event?.type || item.type) === "agent_start",
	);
	const hasAssistantDelta = eventsSinceSend.some(
		(item) =>
			(item.event?.type || item.type) === "message_update" &&
			item.event?.assistantMessageEvent?.type === "text_delta",
	);
	const hasSendError = entries.some(
		(entry) => entry.type === "send_error" || entry.type === "agent_error",
	);
	const proc = agent.proc as any;
	const stdin = agent.stdin as any;
	const processExited =
		agent.status === "exited" ||
		(proc?.exitCode !== null && proc?.exitCode !== undefined) ||
		!!proc?.signalCode;
	const stdinClosed = !!(
		stdin?.destroyed ||
		stdin?.closed ||
		stdin?.writableDestroyed ||
		stdin?.writableEnded ||
		stdin?.writableFinished
	);
	const preflightPending =
		pending.status === "queued" || pending.status === "writing";
	const timeoutPending = elapsedMs < pending.timeoutMs;
	const noUsefulEvents = !hasAgentStart && !hasAssistantDelta;
	const stuck = elapsedMs >= thresholdMs && noUsefulEvents;

	const reasons: string[] = [];
	if (stuck) reasons.push("No agent_start or assistant delta after threshold");
	if (preflightPending)
		reasons.push("Prompt is still in preflight/write phase");
	if (hasSendError) reasons.push("Send error recorded");
	if (processExited) reasons.push("Process exited while turn was pending");
	if (stdinClosed) reasons.push("Agent stdin is closed");
	if (timeoutPending) reasons.push("Turn timeout has not elapsed yet");

	const likelyCauses: string[] = [];
	if (preflightPending) likelyCauses.push("preflight pending");
	if (pending.status === "waiting" && noUsefulEvents)
		likelyCauses.push("no RPC response or model event yet");
	if (options.stderrTail) likelyCauses.push("stderr present");
	if (processExited) likelyCauses.push("process exited");
	if (stdinClosed) likelyCauses.push("stdin closed");
	if (timeoutPending) likelyCauses.push("timeout pending");
	if (!likelyCauses.length) likelyCauses.push("pending turn in progress");

	return {
		stuck,
		elapsedMs,
		thresholdMs,
		pendingStatus: pending.status,
		reasons,
		likelyCauses: Array.from(new Set(likelyCauses)),
		actions: [
			"copy diagnostics",
			"inspect stderr",
			"open worktree/log path",
			"retry or send new prompt if safe",
			"steer agent",
			"kill agent",
		],
	};
}

function normalizeEntry(
	ts: number,
	type: string,
	event: Record<string, unknown>,
): AgentTimelineEntry {
	const base = (label: string): AgentTimelineEntry => ({
		ts,
		time: new Date(ts).toISOString(),
		type,
		label,
	});
	if (type === "user_message") {
		const entry = base("User send");
		entry.text = truncateText(
			String(event.message || ""),
			DEFAULT_TEXT_LIMIT,
		).text;
		return entry;
	}
	if (type === "steer_message") {
		const entry = base("Operator steer");
		entry.text = truncateText(
			String(event.message || ""),
			DEFAULT_TEXT_LIMIT,
		).text;
		return entry;
	}
	if (type === "tool_execution_start") {
		return {
			...base("Tool start"),
			type: "tool_start",
			toolName: String(event.toolName || ""),
			argsPreview: previewJson(event.args),
		};
	}
	if (type === "tool_execution_end") {
		return {
			...base("Tool end"),
			type: "tool_end",
			toolName: String(event.toolName || ""),
		};
	}
	if (type === "send_error" || type === "agent_error") {
		return {
			...base("Error"),
			error: String(event.error || "Unknown error"),
			details: smallDetails(event),
		};
	}
	if (type === "stderr") {
		const entry = base("stderr");
		entry.text = truncateText(
			String(event.text || ""),
			DEFAULT_FIELD_LIMIT,
		).text;
		entry.length =
			typeof event.length === "number" ? event.length : entry.text.length;
		return entry;
	}
	if (type === "agent_exit") {
		return {
			...base("Agent exit"),
			code: typeof event.code === "number" ? event.code : null,
			signal: typeof event.signal === "string" ? event.signal : undefined,
		};
	}
	if (type === "agent_kill" || type === "kill_requested") {
		return { ...base("Agent killed"), details: smallDetails(event) };
	}
	return { ...base(type), details: smallDetails(event) };
}

function truncateHistory(history: Agent["history"]): Agent["history"] {
	return history.slice(-20).map((entry) => ({
		role: entry.role,
		text: truncateText(entry.text, DEFAULT_TEXT_LIMIT).text,
	}));
}

function truncateText(
	text: string,
	limit: number,
): { text: string; truncated: boolean } {
	if (text.length <= limit) return { text, truncated: false };
	return { text: `${text.slice(0, Math.max(0, limit - 1))}…`, truncated: true };
}

function previewJson(value: unknown): string | undefined {
	if (value === undefined) return undefined;
	try {
		return truncateText(JSON.stringify(value), DEFAULT_FIELD_LIMIT).text;
	} catch {
		return truncateText(String(value), DEFAULT_FIELD_LIMIT).text;
	}
}

function smallDetails(value: Record<string, unknown>): Record<string, unknown> {
	const details: Record<string, unknown> = {};
	for (const [key, raw] of Object.entries(value)) {
		if (["type", "message", "args"].includes(key)) continue;
		if (typeof raw === "string")
			details[key] = truncateText(raw, DEFAULT_FIELD_LIMIT).text;
		else if (raw === null || ["number", "boolean"].includes(typeof raw))
			details[key] = raw;
		else if (raw !== undefined) details[key] = previewJson(raw);
	}
	return details;
}

function cleanTail(text?: string): string | undefined {
	const trimmed = text?.trim();
	if (!trimmed) return undefined;
	return truncateText(trimmed, DEFAULT_TEXT_LIMIT).text;
}
