import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { AgentsPanel } from "../web/features/live-agents/LiveAgentsPanel.js";

type TestFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

async function render(
	element: React.ReactElement,
	fetchImpl: TestFetch = async () => new Response("{}", { status: 200 }),
) {
	const window = new Window({ url: "http://localhost/dashboard" });
	const previous = {
		window: globalThis.window,
		document: globalThis.document,
		navigator: globalThis.navigator,
		fetch: globalThis.fetch,
	};
	(window as any).SyntaxError = SyntaxError;
	Object.assign(globalThis, {
		window,
		document: window.document,
		navigator: window.navigator,
		fetch: fetchImpl as any,
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

describe("Live Agents dashboard", () => {
	it("renders a persistent spawn control for active agents", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{}}
				stats={{}}
				agentTypes={[
					{
						name: "team-coder",
						description: "Writes code",
						source: "project",
					},
				]}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("Spawn Agent");
			expect(text).toContain("team-coder");
			expect(text).toContain("No agents running.");
		} finally {
			await cleanup();
		}
	});

	it("spawns a persistent root agent from the Live Agents panel", async () => {
		const requests: Array<{ url: string; body: any }> = [];
		const logs: string[] = [];
		const spawned: any[] = [];
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{}}
				stats={{}}
				agentTypes={[
					{
						name: "team-coder",
						description: "Writes code",
						source: "project",
					},
				]}
				onInspect={() => {}}
				onAgentSpawned={(agent) => spawned.push(agent)}
				pushLog={(text) => logs.push(text)}
			/>,
			async (input, init) => {
				requests.push({
					url: String(input),
					body: JSON.parse(String(init?.body || "{}")),
				});
				return new Response(
					JSON.stringify({
						name: "team-coder-agent",
						status: "idle",
						definition: "team-coder",
						model: "openai/gpt-5.5",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-team-coder-agent",
					}),
					{ status: 201, headers: { "content-type": "application/json" } },
				);
			},
		);
		try {
			const spawnButton = Array.from(
				window.document.querySelectorAll("button"),
			).find((button) => button.textContent === "Spawn Agent") as
				| HTMLButtonElement
				| undefined;
			expect(spawnButton).toBeTruthy();
			spawnButton!.click();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				url: "/api/spawn",
				body: { parent: "self", type: "team-coder" },
			});
			expect(requests[0]!.body.name).toContain("team-coder");
			expect(spawned).toContainEqual(
				expect.objectContaining({
					name: "team-coder-agent",
					model: "openai/gpt-5.5",
				}),
			);
			expect(
				logs.some((line) => line.includes("Spawned team-coder-agent")),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it("renders pending sent messages in the agent preview", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "waiting",
						definition: "lead",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
						pendingSend: {
							message: "Can you hear me?",
							startedAt: Date.now(),
							timeoutMs: 300_000,
							status: "waiting",
						},
					},
				}}
				stats={{}}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("You: Can you hear me?");
			expect(text).toContain("waiting for response");
		} finally {
			await cleanup();
		}
	});

	it("highlights agents with stuck pending turns", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "waiting",
						definition: "lead",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
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
							likelyCauses: ["timeout pending"],
							actions: ["copy diagnostics", "kill agent"],
						},
					},
				}}
				stats={{}}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("stuck");
			expect(text).toContain(
				"No agent_start or assistant delta after threshold",
			);
		} finally {
			await cleanup();
		}
	});

	it("renders agent preview text as markdown", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "lead",
						children: [],
						turns: 1,
						worktree: "/tmp/pi-worktree-lead",
						text: "### Findings\n\n- **Ready** to test",
					},
				}}
				stats={{}}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const headings = Array.from(window.document.querySelectorAll("h3")).map(
				(heading) => heading.textContent,
			);
			expect(headings).toContain("Findings");
			expect(window.document.querySelector("strong")?.textContent).toBe(
				"Ready",
			);
		} finally {
			await cleanup();
		}
	});

	it("shows issue handoff metadata on agent cards", async () => {
		const artifactPath =
			"/workspaces/repo/.pi/pi-lattice/issues/pi-lattice-f91c";
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "lead",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
						issueId: "pi-lattice-f91c",
						artifactPath,
					},
				}}
				stats={{}}
				onInspect={() => {}}
				pushLog={() => {}}
			/>,
		);
		try {
			const text = window.document.body.textContent || "";
			expect(text).toContain("model: default");
			expect(text).toContain("issue: pi-lattice-f91c");
			expect(text).toContain("artifacts:");
			const artifact = Array.from(
				window.document.querySelectorAll("span"),
			).find((element) => element.textContent?.includes("artifacts:"));
			expect(artifact?.getAttribute("title")).toBe(artifactPath);
		} finally {
			await cleanup();
		}
	});
});
