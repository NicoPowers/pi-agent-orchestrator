import { describe, it, expect } from "bun:test";
import { Window } from "happy-dom";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

describe("dashboard bundle smoke test", () => {
	it("loads the built dashboard without console/runtime errors", async () => {
		const window = new Window({ url: "http://localhost/dashboard" });
		const root = window.document.createElement("div");
		root.id = "root";
		window.document.body.appendChild(root);

		const errors: unknown[] = [];
		const originalConsoleError = console.error;
		console.error = (...args: unknown[]) => {
			errors.push(args);
			originalConsoleError(...args);
		};

		class FakeEventSource extends window.EventTarget {
			url: string;
			onopen: ((event: Event) => void) | null = null;
			onmessage: ((event: MessageEvent) => void) | null = null;
			onerror: ((event: Event) => void) | null = null;

			constructor(url: string) {
				super();
				this.url = url;
				queueMicrotask(() => {
					this.onopen?.(new window.Event("open") as unknown as Event);
					this.onmessage?.(
						new window.MessageEvent("message", {
							data: JSON.stringify({ type: "init", data: { agents: {} } }),
						}) as unknown as MessageEvent,
					);
				});
			}

			close() {}
		}

		const previous = {
			window: globalThis.window,
			document: globalThis.document,
			navigator: globalThis.navigator,
			EventSource: globalThis.EventSource,
			fetch: globalThis.fetch,
			confirm: globalThis.confirm,
		};
		const bootstrapRequests: any[] = [];

		try {
			(window as any).event = undefined;
			(window as any).SyntaxError = SyntaxError;
			Object.assign(globalThis, {
				window,
				document: window.document,
				navigator: window.navigator,
				EventSource: FakeEventSource,
				fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
					const url = String(input);
					if (url.includes("/api/agent-types")) return Response.json([]);
					if (url.includes("/api/root-profiles/default"))
						return Response.json({
							profile: {
								name: "default",
								description: "Default root profile",
								instructions: "Coordinate spawned agents.",
								source: "package",
								filePath: "/pkg/orchestrator-profiles/default.md",
								readOnly: true,
							},
							content:
								"---\nname: default\ndescription: Default root profile\n---\n\nCoordinate spawned agents.",
							frontmatter: {
								name: "default",
								description: "Default root profile",
							},
							body: "Coordinate spawned agents.",
							mtimeMs: 1,
							hash: "hash",
						});
					if (url.includes("/api/root-profiles"))
						return Response.json([
							{
								name: "default",
								description: "Default root profile",
								instructions: "Coordinate spawned agents.",
								source: "package",
								filePath: "/pkg/orchestrator-profiles/default.md",
								readOnly: true,
							},
						]);
					if (url.includes("/api/models")) return Response.json([]);
					if (url.includes("/api/agent-stats")) return Response.json({});
					if (url.includes("/api/roadmap"))
						return Response.json({
							source: {
								type: "seeds",
								path: "/tmp/repo/.seeds/issues.jsonl",
								exists: true,
							},
							generatedAt: "2026-05-20T00:00:00.000Z",
							issues: [
								{
									id: "roadmap-epic",
									title: "Epic: Read-only Roadmap dashboard backed by Seeds",
									type: "epic",
									status: "in_progress",
									priority: 1,
									labels: ["dashboard", "roadmap", "epic"],
									description: "Roadmap epic description",
									createdAt: "2026-05-20T00:00:00.000Z",
									updatedAt: "2026-05-20T01:00:00.000Z",
									blocks: [],
									blockedBy: [],
								},
								{
									id: "tracer-4",
									title:
										"Roadmap tracer 4: add read-only issue detail panel and filters",
									type: "task",
									status: "open",
									priority: 2,
									labels: ["dashboard", "roadmap", "frontend", "tracer"],
									description: "Detail panel should show long issue context.",
									createdAt: "2026-05-20T00:00:00.000Z",
									updatedAt: "2026-05-20T02:00:00.000Z",
									blocks: ["tracer-5"],
									blockedBy: [],
								},
								{
									id: "tracer-5",
									title: "Roadmap tracer 5: polish source boundary",
									type: "task",
									status: "open",
									priority: 2,
									labels: ["dashboard", "roadmap"],
									description: "Polish follow-up.",
									createdAt: "2026-05-20T00:00:00.000Z",
									updatedAt: "2026-05-20T03:00:00.000Z",
									blocks: [],
									blockedBy: ["tracer-4"],
								},
								{
									id: "closed-roadmap",
									title: "Closed roadmap task",
									type: "task",
									status: "closed",
									priority: 3,
									labels: ["dashboard", "roadmap"],
									description: "Closed context.",
									createdAt: "2026-05-19T00:00:00.000Z",
									updatedAt: "2026-05-19T01:00:00.000Z",
									closedAt: "2026-05-19T02:00:00.000Z",
									closeReason: "Done",
									blocks: [],
									blockedBy: [],
								},
							],
							counts: {
								total: 9,
								inProgress: 1,
								ready: 2,
								nextUp: 2,
								blocked: 3,
								backlog: 4,
								closed: 1,
							},
							groups: {
								inProgress: ["roadmap-epic"],
								ready: ["tracer-4"],
								nextUp: ["tracer-4"],
								blocked: ["tracer-5"],
								backlog: ["tracer-4", "tracer-5"],
								closed: ["closed-roadmap"],
							},
							dependencyMap: {
								blockers: {
									"tracer-5": [
										{
											id: "tracer-4",
											title:
												"Roadmap tracer 4: add read-only issue detail panel and filters",
											status: "open",
											type: "task",
											priority: 2,
										},
									],
								},
								unresolvedBlockers: {
									"roadmap-epic": [],
									"tracer-4": [],
									"tracer-5": [
										{
											id: "tracer-4",
											title:
												"Roadmap tracer 4: add read-only issue detail panel and filters",
											status: "open",
											type: "task",
											priority: 2,
										},
									],
									"closed-roadmap": [],
								},
								dependents: {
									"roadmap-epic": [
										{
											id: "tracer-4",
											title:
												"Roadmap tracer 4: add read-only issue detail panel and filters",
											status: "open",
											type: "task",
											priority: 2,
										},
									],
									"tracer-4": [
										{
											id: "tracer-5",
											title: "Roadmap tracer 5: polish source boundary",
											status: "open",
											type: "task",
											priority: 2,
										},
									],
								},
							},
						});
					if (url.includes("/api/skill-templates")) return Response.json([]);
					if (url.includes("/api/extension-templates"))
						return Response.json([]);
					if (url.includes("/api/extensions")) return Response.json([]);
					if (
						url.includes("/api/lattice-libraries/bootstrap") &&
						init?.method === "POST"
					) {
						bootstrapRequests.push(JSON.parse(String(init.body || "{}")));
						return Response.json({
							success: true,
							scope: "project",
							library: {
								root: "/tmp/repo/.pi/lattice-library",
								manifestPath:
									"/tmp/repo/.pi/lattice-library/lattice-library.json",
								manifest: {
									schema: "pio.lattice-library.v1",
									name: "team-ai",
									description: "Team library",
									resources: {},
								},
								diagnostics: [],
								valid: true,
							},
						});
					}
					if (url.includes("/api/lattice-libraries"))
						return Response.json({
							libraries: [],
							resources: [],
							diagnostics: [],
							valid: true,
							settings: {
								showPackageExamples: true,
								settingsPath: "/tmp/.pi/settings.json",
								exists: false,
							},
						});
					if (url.endsWith("/api/skills/demo-id"))
						return Response.json({
							skill: {
								id: "demo-id",
								name: "demo",
								description: "Demo skill",
								path: "/tmp/demo/SKILL.md",
								scope: "project",
								kind: "directory",
								editable: true,
								packageProvided: false,
							},
							content:
								"---\nname: demo\ndescription: Demo skill\n---\n# Demo Skill\n\nSkill body.",
							frontmatter: { name: "demo", description: "Demo skill" },
							body: "# Demo Skill\n\nSkill body.",
							mtimeMs: 1,
							hash: "hash",
						});
					if (url.endsWith("/api/skills/librarian-id"))
						return new Promise((resolve) =>
							setTimeout(
								() =>
									resolve(
										Response.json({
											skill: {
												id: "librarian-id",
												name: "librarian",
												description: "Package skill",
												path: "/home/ubuntu/.pi/agent/npm/node_modules/pi-web-access/skills/librarian/SKILL.md",
												scope: "global",
												kind: "directory",
												editable: false,
												packageProvided: true,
											},
											content:
												"---\nname: librarian\ndescription: Package skill\n---\n# Librarian",
											frontmatter: {
												name: "librarian",
												description: "Package skill",
											},
											body: "# Librarian",
											mtimeMs: 1,
											hash: "package-hash",
										}),
									),
								75,
							),
						);
					if (url.endsWith("/api/skills"))
						return Response.json([
							{
								id: "demo-id",
								name: "demo",
								description: "Demo skill",
								path: "/tmp/demo/SKILL.md",
								scope: "project",
								kind: "directory",
								editable: true,
								packageProvided: false,
							},
							{
								id: "librarian-id",
								name: "librarian",
								description: "Package skill",
								path: "/home/ubuntu/.pi/agent/npm/node_modules/pi-web-access/skills/librarian/SKILL.md",
								scope: "global",
								kind: "directory",
								editable: false,
								packageProvided: true,
							},
						]);
					return Response.json({});
				},
				confirm: () => true,
			});

			await import(
				pathToFileURL(path.resolve("web/app.js")).href + `?t=${Date.now()}`
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));

			expect(window.document.getElementById("root")?.textContent).toContain(
				"Pi Orchestrator",
			);
			expect(window.document.getElementById("root")?.textContent).toContain(
				"No agents running.",
			);
			const roadmapNav = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Roadmap"));
			roadmapNav?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const roadmapText =
				window.document.getElementById("root")?.textContent || "";
			expect(roadmapText).toContain("Project Roadmap");
			expect(roadmapText).toContain("Focus epic");
			expect(roadmapText).toContain("Epic Roadmap");
			expect(roadmapText).not.toContain("Ready & blocked queues");
			expect(roadmapText).toContain("9 total");
			expect(roadmapText).toContain("Roadmap tracer 4");
			expect(roadmapText).not.toContain(
				"In Progress11Next Up22Blocked33Backlog / Open44Closed11",
			);
			const epicButton = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) =>
				button.textContent?.includes(
					"Epic: Read-only Roadmap dashboard backed by Seeds",
				),
			);
			epicButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(
				window.document.getElementById("root")?.textContent || "",
			).toContain("Epic Details");
			expect(
				window.document.getElementById("root")?.textContent || "",
			).toContain("Tasks in this epic");
			const epicDialog = window.document.querySelector('[role="dialog"]');
			const tracerButton = Array.from(
				epicDialog?.getElementsByTagName("button") || [],
			).find((button) => button.textContent?.includes("Roadmap tracer 4"));
			tracerButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const detailText =
				window.document.getElementById("root")?.textContent || "";
			expect(detailText).toContain("Issue Details");
			expect(detailText).toContain("←");
			expect(detailText).not.toContain("Back to epic");
			expect(detailText).toContain(
				"Detail panel should show long issue context.",
			);
			expect(detailText).toContain("Dependents");
			expect(detailText).toContain("tracer-5");
			const dependentButton = Array.from(
				window.document
					.querySelector('[role="dialog"]')
					?.getElementsByTagName("button") || [],
			).find((button) => button.textContent?.includes("Roadmap tracer 5"));
			dependentButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const dependentText =
				window.document.getElementById("root")?.textContent || "";
			expect(dependentText).toContain("Issue Details");
			expect(dependentText).toContain("←");
			expect(dependentText).toContain("Polish follow-up.");
			const backButton = Array.from(
				window.document
					.querySelector('[role="dialog"]')
					?.getElementsByTagName("button") || [],
			).find((button) => button.textContent?.trim() === "←");
			backButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const backText =
				window.document.getElementById("root")?.textContent || "";
			expect(backText).toContain("Epic Details");
			expect(backText).toContain("Tasks in this epic");
			const dialog = window.document.querySelector('[role="dialog"]');
			dialog?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const hierarchyNav = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Hierarchy"));
			hierarchyNav?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(window.document.getElementById("root")?.textContent).toContain(
				"No agents yet.",
			);

			const rootProfilesNav = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Root Profiles"));
			rootProfilesNav?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const rootProfilesText =
				window.document.getElementById("root")?.textContent || "";
			expect(rootProfilesText).toContain("Root Orchestrator Profiles");
			expect(rootProfilesText).toContain("not spawnable Agent Types");
			expect(rootProfilesText).toContain("read-only");

			const skillNav = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Skill Library"));
			skillNav?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const text = window.document.getElementById("root")?.textContent || "";
			expect(text).toContain("Demo Skill");
			expect(text).toContain("Preview");
			expect(text).toContain("Raw");
			expect(text).toContain("Metadata");
			expect(text).toContain("package");
			expect(text).not.toContain("Skill & Extension Paths");

			const libraryNav = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Lattice Libraries"));
			libraryNav?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const libraryText =
				window.document.getElementById("root")?.textContent || "";
			expect(libraryText).toContain(
				"Click here to scaffold your first Lattice Library",
			);
			expect(libraryText).not.toContain("Target path");
			expect(libraryText).not.toContain("Create library");

			const scaffoldButton = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) =>
				button.textContent?.includes(
					"Click here to scaffold your first Lattice Library",
				),
			);
			scaffoldButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			const modalText =
				window.document.getElementById("root")?.textContent || "";
			expect(modalText).toContain("repo-local auto-discovery folder");
			expect(modalText).not.toContain("Target path");
			expect(modalText).toContain("Library name");
			expect(modalText).toContain("Create library");

			const nameInput = Array.from(
				window.document.getElementsByTagName("input"),
			).find((input) => input.getAttribute("placeholder") === "team-ai");
			const descriptionInput = Array.from(
				window.document.getElementsByTagName("textarea"),
			).find(
				(input) =>
					input.getAttribute("placeholder") ===
					"Shared team orchestrator resources.",
			);
			expect(nameInput).toBeTruthy();
			expect(descriptionInput).toBeTruthy();
			const createButton = Array.from(
				window.document.getElementsByTagName("button"),
			).find((button) => button.textContent?.includes("Create library"));
			createButton?.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true }),
			);
			await window.happyDOM.waitUntilComplete();
			await new Promise((resolve) => setTimeout(resolve, 50));
			expect(bootstrapRequests).toEqual([
				{
					targetPath: "./.pi/pi-lattice/libraries/lattice-library",
				},
			]);
			expect(text).not.toContain("name: demodescription:");
			expect(errors).toEqual([]);
		} finally {
			console.error = originalConsoleError;
			Object.assign(globalThis, previous);
			window.close();
		}
	});
});
