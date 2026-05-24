import type React from "react";
import { describe, expect, it } from "bun:test";
import { Window } from "happy-dom";
import { createRoot } from "react-dom/client";
import { RoadmapPanel } from "../web/features/roadmap/RoadmapPanel.js";
import type { RoadmapIssue, RoadmapOverview } from "../web/types.js";

type TestFetch = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

async function renderRoadmapPanel(
	fetchImpl: TestFetch,
	pushLog: (
		text: string,
		level?: "info" | "success" | "warn" | "error",
	) => void = () => {},
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
	root.render(<RoadmapPanel pushLog={pushLog} />);
	await flush(window);
	return {
		window,
		cleanup: async () => {
			root.unmount();
			await flush(window);
			Object.assign(globalThis, previous);
		},
	};
}

async function flush(window: Window) {
	await window.happyDOM.waitUntilComplete();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

function clickButton(window: Window, text: string) {
	const button = Array.from(window.document.querySelectorAll("button")).find(
		(button) => button.textContent?.includes(text),
	) as HTMLButtonElement | undefined;
	expect(button).toBeTruthy();
	button!.click();
}

function changeStatus(window: Window, status: string) {
	const select = window.document.querySelector(
		"select[aria-label='Issue status']",
	) as HTMLSelectElement | null;
	expect(select).toBeTruthy();
	select!.value = status;
	select!.dispatchEvent(
		new window.Event("change", { bubbles: true }) as unknown as Event,
	);
}

function changeDescription(window: Window, description: string) {
	const textarea = window.document.querySelector(
		"textarea[aria-label='Issue description']",
	) as HTMLTextAreaElement | null;
	expect(textarea).toBeTruthy();
	textarea!.value = description;
	textarea!.dispatchEvent(
		new window.Event("input", { bubbles: true }) as unknown as Event,
	);
}

function overview(issues: RoadmapIssue[]): RoadmapOverview {
	const blockers: RoadmapOverview["dependencyMap"]["blockers"] = {};
	const unresolvedBlockers: RoadmapOverview["dependencyMap"]["unresolvedBlockers"] =
		{};
	const dependents: RoadmapOverview["dependencyMap"]["dependents"] = {};
	for (const issue of issues) {
		blockers[issue.id] = [];
		unresolvedBlockers[issue.id] = [];
		dependents[issue.id] = [];
	}
	return {
		source: { type: "seeds", path: ".seeds/issues.jsonl", exists: true },
		generatedAt: "2026-05-24T00:00:00.000Z",
		issues,
		counts: {
			total: issues.length,
			inProgress: issues.filter((issue) => issue.status === "in_progress")
				.length,
			ready: issues.filter((issue) => issue.status === "open").length,
			nextUp: issues.filter((issue) => issue.status === "open").length,
			blocked: 0,
			backlog: issues.filter((issue) => issue.status === "open").length,
			closed: issues.filter((issue) => issue.status === "closed").length,
		},
		groups: {
			inProgress: issues
				.filter((issue) => issue.status === "in_progress")
				.map((issue) => issue.id),
			ready: issues
				.filter((issue) => issue.status === "open")
				.map((issue) => issue.id),
			nextUp: issues
				.filter((issue) => issue.status === "open")
				.map((issue) => issue.id),
			blocked: [],
			backlog: issues
				.filter((issue) => issue.status === "open")
				.map((issue) => issue.id),
			closed: issues
				.filter((issue) => issue.status === "closed")
				.map((issue) => issue.id),
		},
		dependencyMap: { blockers, unresolvedBlockers, dependents },
	};
}

function issue(
	partial: Partial<RoadmapIssue> & Pick<RoadmapIssue, "id" | "title">,
): RoadmapIssue {
	return {
		id: partial.id,
		title: partial.title,
		type: partial.type || "task",
		status: partial.status || "open",
		priority: partial.priority ?? 2,
		labels: partial.labels || [],
		description: partial.description || "",
		createdAt: partial.createdAt || "2026-05-20T00:00:00.000Z",
		updatedAt: partial.updatedAt || "2026-05-21T00:00:00.000Z",
		closedAt: partial.closedAt,
		closeReason: partial.closeReason,
		blocks: partial.blocks || [],
		blockedBy: partial.blockedBy || [],
	};
}

describe("RoadmapPanel status controls", () => {
	it("changes a task from open to in progress and updates the displayed status", async () => {
		const requests: Array<{ url: string; method?: string; body?: any }> = [];
		const initial = overview([
			issue({ id: "epic-1", title: "Epic", type: "epic", labels: ["feature"] }),
			issue({ id: "task-1", title: "Build task" }),
		]);
		const updated = overview([
			issue({ id: "epic-1", title: "Epic", type: "epic", labels: ["feature"] }),
			issue({ id: "task-1", title: "Build task", status: "in_progress" }),
		]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (input, init) => {
				requests.push({
					url: String(input),
					method: init?.method,
					body: init?.body ? JSON.parse(String(init.body)) : undefined,
				});
				return new Response(
					JSON.stringify(init?.method === "PATCH" ? updated : initial),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		try {
			clickButton(window, "Build task");
			await flush(window);
			changeStatus(window, "in_progress");
			clickButton(window, "Save status");
			await flush(window);

			expect(requests.at(-1)).toEqual({
				url: "/api/roadmap/issues/task-1",
				method: "PATCH",
				body: { status: "in_progress" },
			});
			expect(window.document.body.textContent).toContain(
				"Status updated to in progress",
			);
			expect(window.document.body.textContent).toContain("in progress");
		} finally {
			await cleanup();
		}
	});

	it("changes an epic status and preserves the selected epic detail view", async () => {
		const initial = overview([
			issue({ id: "epic-1", title: "Epic", type: "epic" }),
		]);
		const updated = overview([
			issue({ id: "epic-1", title: "Epic", type: "epic", status: "closed" }),
		]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (_input, init) =>
				new Response(
					JSON.stringify(init?.method === "PATCH" ? updated : initial),
					{ status: 200 },
				),
		);
		try {
			clickButton(window, "Epic");
			await flush(window);
			changeStatus(window, "closed");
			clickButton(window, "Save status");
			await flush(window);

			expect(window.document.body.textContent).toContain("Epic Details");
			expect(window.document.body.textContent).toContain("Tasks in this epic");
			expect(window.document.body.textContent).toContain(
				"Status updated to closed",
			);
		} finally {
			await cleanup();
		}
	});

	it("leaves the prior status visible and surfaces an error when mutation fails", async () => {
		const logs: string[] = [];
		const initial = overview([issue({ id: "task-1", title: "Build task" })]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (_input, init) =>
				init?.method === "PATCH"
					? new Response("Nope", { status: 500 })
					: new Response(JSON.stringify(initial), { status: 200 }),
			(text) => logs.push(text),
		);
		try {
			clickButton(window, "Build task");
			await flush(window);
			changeStatus(window, "closed");
			clickButton(window, "Save status");
			await flush(window);

			expect(window.document.body.textContent).toContain(
				"Failed to update status: Nope",
			);
			expect(window.document.body.textContent).toContain("open");
			expect(
				logs.some((line) =>
					line.includes("Failed to update Roadmap issue task-1"),
				),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});
});

describe("RoadmapPanel description editing", () => {
	it("saves multiline markdown with the exact PATCH body and renders the refreshed text", async () => {
		const requests: Array<{ url: string; method?: string; body?: any }> = [];
		const nextDescription = "Line 1\n\n- item **bold**\n`code`";
		const initial = overview([
			issue({
				id: "task-1",
				title: "Build task",
				description: "Old description",
			}),
		]);
		const updated = overview([
			issue({
				id: "task-1",
				title: "Build task",
				description: nextDescription,
			}),
		]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (input, init) => {
				requests.push({
					url: String(input),
					method: init?.method,
					body: init?.body ? JSON.parse(String(init.body)) : undefined,
				});
				return new Response(
					JSON.stringify(init?.method === "PATCH" ? updated : initial),
					{ status: 200, headers: { "content-type": "application/json" } },
				);
			},
		);
		try {
			clickButton(window, "Build task");
			await flush(window);
			clickButton(window, "Edit description");
			await flush(window);
			changeDescription(window, nextDescription);
			await flush(window);
			clickButton(window, "Save description");
			await flush(window);

			expect(requests.at(-1)).toEqual({
				url: "/api/roadmap/issues/task-1",
				method: "PATCH",
				body: { description: nextDescription },
			});
			expect(window.document.body.textContent).toContain("Description updated");
			expect(window.document.body.textContent).toContain("Line 1");
			expect(window.document.body.textContent).toContain("- item **bold**");
		} finally {
			await cleanup();
		}
	});

	it("cancels description editing without sending a PATCH and restores the original description", async () => {
		const requests: Array<{ method?: string }> = [];
		const initial = overview([
			issue({
				id: "task-1",
				title: "Build task",
				description: "Original description",
			}),
		]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (_input, init) => {
				requests.push({ method: init?.method });
				return new Response(JSON.stringify(initial), { status: 200 });
			},
		);
		try {
			clickButton(window, "Build task");
			await flush(window);
			clickButton(window, "Edit description");
			await flush(window);
			changeDescription(window, "Changed but discarded");
			await flush(window);
			clickButton(window, "Cancel");
			await flush(window);

			expect(requests.some((request) => request.method === "PATCH")).toBe(
				false,
			);
			expect(window.document.body.textContent).toContain(
				"Original description",
			);
			expect(window.document.body.textContent).not.toContain(
				"Changed but discarded",
			);
			expect(
				window.document.querySelector(
					"textarea[aria-label='Issue description']",
				),
			).toBeNull();
		} finally {
			await cleanup();
		}
	});

	it("keeps edited description text and surfaces an error when save fails", async () => {
		const logs: string[] = [];
		const initial = overview([
			issue({
				id: "task-1",
				title: "Build task",
				description: "Original description",
			}),
		]);
		const { window, cleanup } = await renderRoadmapPanel(
			async (_input, init) =>
				init?.method === "PATCH"
					? new Response("Description failed", { status: 500 })
					: new Response(JSON.stringify(initial), { status: 200 }),
			(text) => logs.push(text),
		);
		try {
			clickButton(window, "Build task");
			await flush(window);
			clickButton(window, "Edit description");
			await flush(window);
			changeDescription(window, "Unsaved\ntext");
			await flush(window);
			clickButton(window, "Save description");
			await flush(window);

			const textarea = window.document.querySelector(
				"textarea[aria-label='Issue description']",
			) as HTMLTextAreaElement | null;
			expect(textarea).toBeTruthy();
			expect(textarea!.value).toBe("Unsaved\ntext");
			expect(window.document.body.textContent).toContain(
				"Failed to update description: Description failed",
			);
			expect(
				logs.some((line) =>
					line.includes("Failed to update Roadmap issue task-1 description"),
				),
			).toBe(true);
		} finally {
			await cleanup();
		}
	});
});
