import { describe, expect, it } from "bun:test";
import type { Agent } from "../extensions/multi-agent/state.js";
import { buildAgentTimeline } from "../extensions/multi-agent/timeline.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
	return {
		id: "lead",
		proc: { killed: false } as any,
		stdin: {} as any,
		status: "idle",
		accumulatedText: "final answer",
		history: [{ role: "user", text: "hello" }],
		events: [],
		buffer: "",
		definition: {
			name: "lead",
			description: "Coordinates work",
			agentClass: "lead",
			model: "definition-model",
			thinking: "high",
			tools: ["read", "bash"],
			skills: ["tdd"],
			skillTemplates: ["team/common"],
			extensionTemplates: ["team/tools"],
			systemPrompt: "You are lead. ".repeat(400),
			source: "project",
			filePath: "/repo/agents/lead.md",
		},
		model: "runtime-model",
		worktreePath: "/tmp/pi-worktree-lead",
		parent: "self",
		children: ["scout"],
		issueId: "pi-lattice-7510",
		artifactPath:
			"/repo/.pi/pi-lattice/issues/pi-lattice-7510",
		artifactFiles: { handoff: "/repo/handoff.md" } as any,
		runtimeTools: {
			active: [{ name: "read" }, { name: "bash" }],
			all: [{ name: "read" }, { name: "bash" }, { name: "edit" }],
			reportedAt: 1_700_000_000_000,
			source: "child-agent",
		},
		...overrides,
	};
}

describe("agent timeline", () => {
	it("summarizes spawn metadata and truncates large prompts", () => {
		const timeline = buildAgentTimeline(makeAgent(), { stderrTail: "warn\n" });

		expect(timeline.metadata).toMatchObject({
			name: "lead",
			status: "idle",
			model: "runtime-model",
			worktree: "/tmp/pi-worktree-lead",
			parent: "self",
			children: ["scout"],
			issueId: "pi-lattice-7510",
		});
		expect(timeline.definition).toMatchObject({
			name: "lead",
			description: "Coordinates work",
			agentClass: "lead",
			tools: ["read", "bash"],
			skills: ["tdd"],
			skillTemplates: ["team/common"],
			extensionTemplates: ["team/tools"],
		});
		expect(timeline.definition?.systemPromptPreview).toEndWith("…");
		expect(timeline.definition?.systemPromptLength).toBeGreaterThan(
			timeline.definition!.systemPromptPreview!.length,
		);
		expect(timeline.stderrTail).toBe("warn");
	});

	it("coalesces assistant text deltas and keeps operator/tool events readable", () => {
		const now = 1_700_000_000_000;
		const timeline = buildAgentTimeline(
			makeAgent({
				events: [
					{
						ts: now,
						type: "user_message",
						event: { type: "user_message", message: "build it" },
					},
					{
						ts: now + 1,
						type: "message_update",
						event: {
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "hello " },
						},
					},
					{
						ts: now + 2,
						type: "message_update",
						event: {
							type: "message_update",
							assistantMessageEvent: { type: "text_delta", delta: "world" },
						},
					},
					{
						ts: now + 3,
						type: "tool_execution_start",
						event: {
							type: "tool_execution_start",
							toolName: "read",
							args: { path: "README.md" },
						},
					},
					{
						ts: now + 4,
						type: "tool_execution_end",
						event: { type: "tool_execution_end", toolName: "read" },
					},
					{
						ts: now + 5,
						type: "steer_message",
						event: { type: "steer_message", message: "focus" },
					},
					{
						ts: now + 6,
						type: "agent_exit",
						event: { type: "agent_exit", code: null, signal: "SIGTERM" },
					},
				],
			}),
		);

		expect(timeline.entries.map((entry) => entry.type)).toEqual([
			"user_message",
			"assistant_text",
			"tool_start",
			"tool_end",
			"steer_message",
			"agent_exit",
		]);
		expect(timeline.entries[1]).toMatchObject({
			type: "assistant_text",
			text: "hello world",
			length: 11,
		});
		expect(timeline.entries[2]).toMatchObject({
			type: "tool_start",
			toolName: "read",
		});
	});

	it("flags pending turns that exceed the no-events threshold", () => {
		const now = 1_700_000_060_000;
		const timeline = buildAgentTimeline(
			makeAgent({
				status: "waiting",
				pendingSend: {
					message: "please continue",
					startedAt: now - 60_000,
					timeoutMs: 300_000,
					status: "waiting",
				},
				events: [
					{
						ts: now - 60_000,
						type: "user_message",
						event: { type: "user_message", message: "please continue" },
					},
				],
			}),
			{ now, stuckThresholdMs: 30_000, stderrTail: "provider warning" },
		);

		expect(timeline.metadata.turnDiagnostics).toMatchObject({
			stuck: true,
			thresholdMs: 30_000,
			elapsedMs: 60_000,
			pendingStatus: "waiting",
		});
		expect(timeline.metadata.turnDiagnostics?.reasons).toContain(
			"No agent_start or assistant delta after threshold",
		);
		expect(timeline.metadata.turnDiagnostics?.likelyCauses).toContain(
			"stderr present",
		);
		expect(timeline.metadata.turnDiagnostics?.actions).toContain("kill agent");
	});
});
