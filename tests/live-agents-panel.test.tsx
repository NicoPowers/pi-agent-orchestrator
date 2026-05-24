import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { AgentsPanel } from "../web/features/live-agents/LiveAgentsPanel.js";

type TestFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

function setInputValue(window: Window, input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(
		new window.Event("input", { bubbles: true }) as unknown as Event,
	);
	input.dispatchEvent(
		new window.Event("change", { bubbles: true }) as unknown as Event,
	);
}

async function expandDraftCard(window: Window, draftCard: any) {
	const addButton = Array.from(
		draftCard.querySelectorAll("button") as Iterable<HTMLButtonElement>,
	).find((button) => button.textContent?.includes("Add Agent"));
	expect(addButton).toBeTruthy();
	addButton!.click();
	await window.happyDOM.waitUntilComplete();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

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
	it("renders the add-agent draft card inside the live agent grid when no agents are running", async () => {
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
			const grid = window.document.querySelector(
				'[data-testid="live-agent-grid"]',
			);
			expect(grid).toBeTruthy();
			expect(
				grid!.querySelector('[data-testid="spawn-agent-draft-card"]'),
			).toBeTruthy();
			const text = grid!.textContent || "";
			expect(text).toContain("Add Agent");
			expect(text).not.toContain("Agent name");
			expect(text).not.toContain("No agents running.");
		} finally {
			await cleanup();
		}
	});

	it("renders the add-agent draft card and active agent cards in the same grid", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "team-coder",
						model: "openai/gpt-5.5",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
					},
				}}
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
			const grid = window.document.querySelector(
				'[data-testid="live-agent-grid"]',
			);
			expect(grid).toBeTruthy();
			expect(
				grid!.querySelector('[data-testid="spawn-agent-draft-card"]'),
			).toBeTruthy();
			expect(grid!.textContent || "").toContain("lead");
			expect(window.document.body.textContent || "").not.toContain(
				"No agents running.",
			);
		} finally {
			await cleanup();
		}
	});

	it("keeps the add-agent card first while rendering several live agent cards", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={Object.fromEntries(
					Array.from({ length: 6 }, (_, index) => [
						`agent-${index + 1}`,
						{
							name: `agent-${index + 1}`,
							status: "idle",
							definition: "team-coder",
							model: "openai/gpt-5.5",
							children: [],
							turns: index,
							worktree: `/tmp/pi-worktree-agent-${index + 1}`,
						},
					]),
				)}
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
			const grid = window.document.querySelector(
				'[data-testid="live-agent-grid"]',
			)!;
			const cards = Array.from(
				grid.querySelectorAll('[data-live-agent-card="true"]'),
			);
			expect(cards).toHaveLength(7);
			expect(cards[0]!.getAttribute("data-testid")).toBe(
				"spawn-agent-draft-card",
			);
			for (let index = 1; index <= 6; index += 1) {
				expect(grid.textContent || "").toContain(`agent-${index}`);
			}
		} finally {
			await cleanup();
		}
	});

	it("uses the same live-agent card shell for draft and active cards", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "team-coder",
						model: "openai/gpt-5.5",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
					},
				}}
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
			const grid = window.document.querySelector(
				'[data-testid="live-agent-grid"]',
			)!;
			const cards = Array.from(
				grid.querySelectorAll('[data-live-agent-card="true"]'),
			);
			expect(cards).toHaveLength(2);
			expect(cards.every((card) => card.className.includes("min-h-["))).toBe(
				true,
			);
			expect(
				cards.some(
					(card) =>
						card.getAttribute("data-testid") === "spawn-agent-draft-card" &&
						card.className.includes("border-dashed"),
				),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});

	it("labels the ghost add-agent card distinctly from running agent cards", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "team-coder",
						model: "openai/gpt-5.5",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
					},
				}}
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
			const draftCard = window.document.querySelector(
				'[data-testid="spawn-agent-draft-card"]',
			)!;
			expect(draftCard.getAttribute("aria-label")).toBe("Add Agent");
			expect(draftCard.textContent || "").toContain("Add Agent");
			expect(draftCard.textContent || "").not.toContain("lead");
		} finally {
			await cleanup();
		}
	});

	it("expands the add-agent card in place and can cancel without removing active agents", async () => {
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{
					lead: {
						name: "lead",
						status: "idle",
						definition: "team-coder",
						model: "openai/gpt-5.5",
						children: [],
						turns: 0,
						worktree: "/tmp/pi-worktree-lead",
					},
				}}
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
			const draftCard = window.document.querySelector(
				'[data-testid="spawn-agent-draft-card"]',
			)!;
			expect(draftCard.querySelector('input[placeholder="Agent name"]')).toBe(
				null,
			);
			await expandDraftCard(window, draftCard);
			expect(
				draftCard.querySelector('input[placeholder="Agent name"]'),
			).toBeTruthy();
			const cancelButton = Array.from(
				draftCard.querySelectorAll("button"),
			).find((button) => button.textContent === "Cancel") as
				| HTMLButtonElement
				| undefined;
			expect(cancelButton).toBeTruthy();
			cancelButton!.click();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(draftCard.querySelector('input[placeholder="Agent name"]')).toBe(
				null,
			);
			expect(window.document.body.textContent || "").toContain("lead");
		} finally {
			await cleanup();
		}
	});

	it("spawns a persistent root agent from the draft card with optional handoff fields", async () => {
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
			const draftCard = window.document.querySelector(
				'[data-testid="spawn-agent-draft-card"]',
			)!;
			await expandDraftCard(window, draftCard);
			const inputs = Array.from(draftCard.querySelectorAll("input"));
			const nameInput = inputs.find(
				(input) => input.getAttribute("placeholder") === "Agent name",
			) as unknown as HTMLInputElement;
			const modelInput = inputs.find(
				(input) =>
					input.getAttribute("placeholder") === "Optional model override",
			) as unknown as HTMLInputElement;
			const issueInput = inputs.find((input) =>
				input.getAttribute("placeholder")?.includes("Optional Seeds issue id"),
			) as unknown as HTMLInputElement;
			setInputValue(window, nameInput, "team-coder-agent");
			setInputValue(window, modelInput, "openai/gpt-5.5");
			setInputValue(window, issueInput, "pi-agent-orchestrator-e54c");
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const spawnButton = Array.from(draftCard.querySelectorAll("button")).find(
				(button) => button.textContent === "Spawn Agent",
			) as HTMLButtonElement | undefined;
			expect(spawnButton).toBeTruthy();
			spawnButton!.click();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(requests).toHaveLength(1);
			expect(requests[0]).toMatchObject({
				url: "/api/spawn",
				body: {
					name: "team-coder-agent",
					parent: "self",
					type: "team-coder",
					model: "openai/gpt-5.5",
					issueId: "pi-agent-orchestrator-e54c",
				},
			});
			expect(spawned).toContainEqual(
				expect.objectContaining({
					name: "team-coder-agent",
					model: "openai/gpt-5.5",
				}),
			);
			expect(
				logs.some((line) => line.includes("Spawned team-coder-agent")),
			).toBe(true);
			expect(draftCard.querySelector('input[placeholder="Agent name"]')).toBe(
				null,
			);
		} finally {
			await cleanup();
		}
	});

	it("keeps draft-card spawn validation and filters non-spawnable orchestrator types", async () => {
		const requests: Array<{ url: string; body: any }> = [];
		const logs: string[] = [];
		const { window, cleanup } = await render(
			<AgentsPanel
				agents={{}}
				stats={{}}
				agentTypes={[
					{
						name: "root-orchestrator",
						description: "Root only",
						source: "project",
						agentClass: "orchestrator",
					},
					{
						name: "team-coder",
						description: "Writes code",
						source: "project",
					},
				]}
				onInspect={() => {}}
				pushLog={(text) => logs.push(text)}
			/>,
			async (input, init) => {
				requests.push({
					url: String(input),
					body: JSON.parse(String(init?.body || "{}")),
				});
				return new Response("{}", { status: 201 });
			},
		);
		try {
			const draftCard = window.document.querySelector(
				'[data-testid="spawn-agent-draft-card"]',
			)!;
			await expandDraftCard(window, draftCard);
			expect(draftCard.textContent || "").toContain("team-coder");
			expect(draftCard.textContent || "").not.toContain("root-orchestrator");

			const nameInput = Array.from(draftCard.querySelectorAll("input")).find(
				(input) => input.getAttribute("placeholder") === "Agent name",
			) as unknown as HTMLInputElement;
			setInputValue(window, nameInput, "");
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));
			const spawnButton = Array.from(draftCard.querySelectorAll("button")).find(
				(button) => button.textContent === "Spawn Agent",
			) as HTMLButtonElement | undefined;
			expect(spawnButton).toBeTruthy();
			expect(spawnButton!.disabled).toBe(true);
			spawnButton!.click();
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 0));

			expect(requests).toHaveLength(0);
			expect(logs).not.toContain("Agent name is required");
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
