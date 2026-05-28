import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { InspectTimeline } from "../web/features/live-agents/InspectTimeline.js";

async function render(element: React.ReactElement) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
	};
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
	});
	const container = window.document.createElement("div");
	window.document.body.appendChild(container);
	const root = createRoot(container as unknown as Element);
	root.render(element);
	await window.happyDOM.waitUntilComplete();
	await new Promise((resolve) => setTimeout(resolve, 0));
	return {
		window,
		cleanup: async () => {
			root.unmount();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			Object.assign(globalThis, previous);
		},
	};
}

describe("InspectTimeline", () => {
	it("renders stuck-turn diagnostics and operator actions", async () => {
		const { window, cleanup } = await render(
			<InspectTimeline
				timeline={{
					metadata: {
						name: "lead",
						status: "waiting",
						worktree: "/tmp/pi-worktree-lead",
						children: [],
						turns: 0,
						pendingSend: {
							message: "please continue",
							startedAt: Date.now() - 60_000,
							timeoutMs: 300_000,
							status: "waiting",
						},
						turnDiagnostics: {
							stuck: true,
							elapsedMs: 60_000,
							thresholdMs: 30_000,
							pendingStatus: "waiting",
							reasons: ["No agent_start or assistant delta after threshold"],
							likelyCauses: ["stderr present", "timeout pending"],
							actions: ["copy diagnostics", "steer agent", "kill agent"],
						},
					},
					stderrTail: "provider warning",
					entries: [],
				}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("Turn diagnostics");
			expect(text).toContain("Stuck turn detected");
			expect(text).toContain(
				"No agent_start or assistant delta after threshold",
			);
			expect(text).toContain("stderr present");
			expect(text).toContain("Copy Diagnostics");
			expect(text).toContain("Steer");
			expect(text).toContain("Kill");
			expect(text).toContain("Copy Worktree Path");
		} finally {
			await cleanup();
		}
	});

	it("renders native Pi session metadata for the inspected agent", async () => {
		const { window, cleanup } = await render(
			<InspectTimeline
				timeline={{
					metadata: {
						name: "lead",
						status: "idle",
						worktree: "/tmp/pi-worktree-lead",
						children: [],
						turns: 0,
						nativeSession: {
							sessionId: "pi-lattice.run-abc.lead",
							sessionFile: "/repo/.pi/sessions/pi-lattice.run-abc.lead.jsonl",
							sessionName: "lead session",
						},
					},
					entries: [],
				}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("Pi session");
			expect(text).toContain("pi-lattice.run-abc.lead");
			expect(text).toContain("lead session");
			expect(text).toContain(
				"/repo/.pi/sessions/pi-lattice.run-abc.lead.jsonl",
			);
		} finally {
			await cleanup();
		}
	});

	it("renders detailed context and cost telemetry for the inspected agent", async () => {
		const { window, cleanup } = await render(
			<InspectTimeline
				timeline={{
					metadata: {
						name: "lead",
						status: "idle",
						model: "test-model",
						worktree: "/tmp/pi-worktree-lead",
						children: [],
						turns: 2,
					},
					entries: [],
				}}
				stats={{
					stats: {
						cost: 0.123456,
						contextUsage: {
							tokens: 24_000,
							contextWindow: 120_000,
						},
						tokens: {
							input: 20_000,
							output: 4_000,
							total: 24_000,
						},
					},
					state: {
						model: { contextWindow: 120_000 },
					},
				}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("Context & cost");
			expect(text).toContain("20%");
			expect(text).toContain("24.0K / 120.0K");
			expect(text).toContain("input tokens");
			expect(text).toContain("20.0K");
			expect(text).toContain("output tokens");
			expect(text).toContain("4.0K");
			expect(text).toContain("$0.1235");
		} finally {
			await cleanup();
		}
	});
});
