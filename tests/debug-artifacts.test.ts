import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Agent } from "../extensions/multi-agent/state.js";
import {
	prepareAgentDebugArtifacts,
	persistAgentDebugSnapshot,
	readLatestAgentDebugTimeline,
} from "../extensions/multi-agent/debug-artifacts.js";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
	return {
		id: "lead/one",
		proc: { pid: 123, killed: false } as any,
		stdin: {} as any,
		status: "idle",
		accumulatedText: "answer",
		history: [{ role: "user", text: "hello" }],
		events: [
			{
				ts: 1_700_000_000_000,
				type: "send_error",
				event: {
					type: "send_error",
					phase: "preflight",
					error: "No API key found",
					apiKey: "sk-secret",
				},
			},
		],
		buffer: "",
		definition: {
			name: "lead",
			description: "Lead agent",
			systemPrompt: "prompt",
			source: "project",
			filePath: "/repo/agents/lead.md",
		},
		model: "test-model",
		worktreePath: "/tmp/pi-worktree-lead",
		children: [],
		launch: {
			command: "pi",
			args: ["--mode", "rpc", "--api-key", "sk-secret"],
			cwd: "/tmp/pi-worktree-lead",
			pid: 123,
			startedAt: 1_700_000_000_000,
		},
		nativeSession: {
			sessionId: "pi-lattice.run-123.lead-one",
			sessionFile: "/repo/.pi/sessions/pi-lattice.run-123.lead-one.jsonl",
			sessionName: "lead one",
			reportedAt: 1_700_000_000_100,
		},
		...overrides,
	};
}

describe("agent debug artifacts", () => {
	it("persists redacted per-agent timeline under session artifacts, not issue handoff artifacts", () => {
		const repoCwd = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-debug-artifacts-"),
		);
		try {
			const artifacts = prepareAgentDebugArtifacts({
				repoCwd,
				agentId: "lead/one",
				sessionId: "session-123",
			});
			const agent = makeAgent({ observability: artifacts });

			const record = persistAgentDebugSnapshot(agent, {
				repoCwd,
				stderrTail: "warn",
			});

			expect(record?.sessionId).toBe("session-123");
			expect(record?.agentId).toBe("lead-one");
			expect(record?.kind).toBe("spawned-agent-debug-timeline");
			expect(record?.note.toLowerCase()).toContain("not seeds tracker state");
			expect(record?.timeline.metadata.launch).toMatchObject({
				command: "pi",
				cwd: "/tmp/pi-worktree-lead",
			});
			expect(record?.timeline.metadata.nativeSession).toMatchObject({
				sessionId: "pi-lattice.run-123.lead-one",
				sessionFile: "/repo/.pi/sessions/pi-lattice.run-123.lead-one.jsonl",
				sessionName: "lead one",
			});
			expect(record?.timeline.stderrTail).toBe("warn");
			expect(artifacts.timelinePath).toContain(
				path.join(
					".pi",
					"pi-lattice",
					"sessions",
					"session-123",
					"agents",
					"lead-one",
				),
			);
			expect(artifacts.timelinePath).not.toContain(
				`${path.sep}issues${path.sep}`,
			);
			expect(fs.existsSync(artifacts.timelinePath)).toBe(true);
			const raw = fs.readFileSync(artifacts.timelinePath, "utf-8");
			expect(raw).not.toContain("sk-secret");
			expect(raw).toContain("[REDACTED]");
		} finally {
			fs.rmSync(repoCwd, { recursive: true, force: true });
		}
	});

	it("loads latest persisted debug timeline for recently exited agents", () => {
		const repoCwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-debug-read-"));
		try {
			const older = prepareAgentDebugArtifacts({
				repoCwd,
				agentId: "lead",
				sessionId: "session-old",
			});
			persistAgentDebugSnapshot(
				makeAgent({ id: "lead", observability: older }),
				{
					repoCwd,
					now: 1,
				},
			);

			const newer = prepareAgentDebugArtifacts({
				repoCwd,
				agentId: "lead",
				sessionId: "session-new",
			});
			persistAgentDebugSnapshot(
				makeAgent({ id: "lead", status: "exited", observability: newer }),
				{ repoCwd, now: 2 },
			);

			const record = readLatestAgentDebugTimeline(repoCwd, "lead");
			expect(record?.sessionId).toBe("session-new");
			expect(record?.timeline.metadata.status).toBe("exited");
		} finally {
			fs.rmSync(repoCwd, { recursive: true, force: true });
		}
	});
});
