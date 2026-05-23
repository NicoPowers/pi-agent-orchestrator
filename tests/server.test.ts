import { describe, it, expect } from "bun:test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PassThrough } from "node:stream";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

async function findPort(preferred = [18765, 18766, 18767]): Promise<number> {
	for (const port of preferred) {
		try {
			const server = createServer();
			await new Promise<void>((resolve, reject) => {
				server.once("error", reject);
				server.listen(port, () => {
					server.close(() => resolve());
				});
			});
			return port;
		} catch {
			/* try next */
		}
	}
	// Fall back to OS-assigned ephemeral port
	const server = createServer();
	return new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, () => {
			const addr = server.address() as AddressInfo;
			server.close(() => resolve(addr.port));
		});
	});
}

describe("port probing", () => {
	it("returns the first free port from the preferred list", async () => {
		const port = await findPort([39000, 39001, 39002]);
		expect(port).toBeGreaterThanOrEqual(39000);
		expect(port).toBeLessThanOrEqual(39002);
	});

	it("falls back to an OS-assigned ephemeral port if all preferred are taken", async () => {
		// Occupy all preferred ports
		const occupied: ReturnType<typeof createServer>[] = [];
		for (let p = 39100; p < 39103; p++) {
			const srv = createServer();
			await new Promise<void>((resolve) => srv.listen(p, resolve));
			occupied.push(srv);
		}

		const port = await findPort([39100, 39101, 39102]);

		// Clean up
		for (const srv of occupied) srv.close();

		// Fallback should be a valid ephemeral port
		expect(port).toBeGreaterThan(0);
		expect(port).toBeLessThanOrEqual(65535);
	});
});

describe("SSE formatting", () => {
	it("formats events correctly", () => {
		const event = {
			type: "agent-spawned",
			data: { name: "lead", status: "idle" },
		};
		const sse = `data: ${JSON.stringify(event)}\n\n`;
		expect(sse).toContain('data: {"type":"agent-spawned"');
		expect(sse).toEndWith("\n\n");
	});

	it("keeps idle event streams alive with heartbeat comments", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { agents } = await import("../extensions/multi-agent/state.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-sse-heartbeat-"));
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
			sseHeartbeatMs: 10,
		});
		const controller = new AbortController();
		try {
			const res = await fetch(`${handle.url}/events`, {
				signal: controller.signal,
			});
			expect(res.status).toBe(200);
			const reader = res.body!.getReader();
			let text = "";
			const timeoutAt = Date.now() + 1000;
			while (!text.includes(": heartbeat\n\n") && Date.now() < timeoutAt) {
				const { value, done } = await reader.read();
				if (done) break;
				text += new TextDecoder().decode(value);
			}
			expect(text).toContain('data: {"type":"init"');
			expect(text).toContain(": heartbeat\n\n");
			await reader.cancel().catch(() => {});
		} finally {
			controller.abort();
			handle.stop();
			agents.clear();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("agent timeline API", () => {
	it("returns a rich timeline payload for active agents", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { agents } = await import("../extensions/multi-agent/state.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-agent-timeline-api-"),
		);
		const worktree = path.join(tmpDir, "worktree");
		fs.mkdirSync(path.join(worktree, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(worktree, ".pi", "stderr.log"),
			"warn\n",
			"utf-8",
		);
		agents.set("lead", {
			id: "lead",
			proc: { killed: false } as any,
			stdin: {} as any,
			status: "idle",
			accumulatedText: "answer",
			history: [],
			events: [
				{
					ts: 1_700_000_000_000,
					type: "message_update",
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "hello " },
					},
				},
				{
					ts: 1_700_000_000_001,
					type: "message_update",
					event: {
						type: "message_update",
						assistantMessageEvent: { type: "text_delta", delta: "world" },
					},
				},
			],
			buffer: "",
			definition: {
				name: "lead",
				description: "Lead agent",
				tools: ["read"],
				skills: ["tdd"],
				systemPrompt: "prompt",
				source: "project",
				filePath: "/agents/lead.md",
			},
			model: "test-model",
			worktreePath: worktree,
			children: [],
		});
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			const res = await fetch(`${handle.url}/api/agents/lead/events`);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.timeline.metadata).toMatchObject({
				name: "lead",
				model: "test-model",
				worktree,
			});
			expect(body.timeline.definition).toMatchObject({
				name: "lead",
				tools: ["read"],
				skills: ["tdd"],
			});
			expect(body.timeline.stderrTail).toBe("warn");
			expect(body.timeline.entries).toContainEqual(
				expect.objectContaining({
					type: "assistant_text",
					text: "hello world",
				}),
			);
		} finally {
			handle.stop();
			agents.clear();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("roadmap API", () => {
	it("returns a read-only Roadmap overview backed by Seeds", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-roadmap-api-"));
		fs.mkdirSync(path.join(tmpDir, ".seeds"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".seeds", "issues.jsonl"),
			[
				JSON.stringify({
					id: "ready",
					title: "Ready",
					status: "open",
					type: "task",
					priority: 1,
					createdAt: "2026-05-20T00:00:00.000Z",
					updatedAt: "2026-05-20T00:00:00.000Z",
					labels: [],
					description: "",
				}),
				JSON.stringify({
					id: "blocker",
					title: "Blocker",
					status: "open",
					type: "task",
					priority: 1,
					createdAt: "2026-05-20T00:00:00.000Z",
					updatedAt: "2026-05-20T00:00:00.000Z",
					labels: [],
					description: "",
					blocks: ["blocked"],
				}),
				JSON.stringify({
					id: "blocked",
					title: "Blocked",
					status: "open",
					type: "task",
					priority: 2,
					createdAt: "2026-05-20T00:00:00.000Z",
					updatedAt: "2026-05-20T00:00:00.000Z",
					labels: [],
					description: "",
					blockedBy: ["blocker"],
				}),
			].join("\n"),
		);
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			const res = await fetch(`${handle.url}/api/roadmap`);
			expect(res.status).toBe(200);
			const overview = await res.json();
			expect(overview.source).toMatchObject({ type: "seeds", exists: true });
			expect(overview.counts).toMatchObject({ total: 3, ready: 2, blocked: 1 });
			expect(overview.groups.blocked).toEqual(["blocked"]);
			expect(
				overview.dependencyMap.unresolvedBlockers.blocked[0],
			).toMatchObject({ id: "blocker", title: "Blocker", status: "open" });
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("template API", () => {
	it("creates, lists, loads, and deletes skill templates", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-api-"));
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			const createRes = await fetch(`${handle.url}/api/skill-templates`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "common",
					description: "Common skills",
					skills: ["tdd", "security-checklist"],
					applyToAll: true,
				}),
			});
			expect(createRes.status).toBe(200);

			const listRes = await fetch(`${handle.url}/api/skill-templates`);
			expect(listRes.status).toBe(200);
			const list = await listRes.json();
			expect(list[0].name).toBe("common");
			expect(list[0].items).toEqual(["tdd", "security-checklist"]);

			const getRes = await fetch(`${handle.url}/api/skill-templates/common`);
			expect(getRes.status).toBe(200);
			expect((await getRes.json()).applyToAll).toBe(true);

			const deleteRes = await fetch(
				`${handle.url}/api/skill-templates/common`,
				{ method: "DELETE" },
			);
			expect(deleteRes.status).toBe(200);

			const missingRes = await fetch(
				`${handle.url}/api/skill-templates/common`,
			);
			expect(missingRes.status).toBe(404);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("root profile API", () => {
	it("lists, loads, saves, copies, and deletes root profiles", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { LATTICE_LIBRARY_SCHEMA } = await import(
			"../extensions/multi-agent/lattice-library.js"
		);
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-root-profile-api-"),
		);
		const libraryRoot = path.join(tmpDir, "team-library");
		fs.mkdirSync(libraryRoot, { recursive: true });
		fs.writeFileSync(
			path.join(libraryRoot, "lattice-library.json"),
			JSON.stringify({
				schema: LATTICE_LIBRARY_SCHEMA,
				name: "team",
				resources: { orchestratorProfiles: "profiles" },
			}),
		);
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "settings.json"),
			JSON.stringify({
				piLattice: { libraries: ["./team-library"] },
			}),
		);
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			let res = await fetch(`${handle.url}/api/root-profiles`);
			expect(res.status).toBe(200);
			expect(
				(await res.json()).some(
					(profile: any) => profile.name === "default" && profile.readOnly,
				),
			).toBe(true);

			res = await fetch(`${handle.url}/api/root-profiles`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					targetLibrary: "team",
					name: "planning",
					description: "Planning",
					skillTemplates: ["root-planning"],
					instructions: "Plan.",
				}),
			});
			expect(res.status).toBe(200);
			expect((await res.json()).path).toBe(
				path.join(libraryRoot, "profiles", "planning.md"),
			);

			res = await fetch(`${handle.url}/api/root-profiles/planning`);
			expect(res.status).toBe(200);
			const detail = await res.json();
			expect(detail.profile.scope).toBe("team");
			expect(detail.frontmatter.skillTemplates).toBe("root-planning");
			expect(detail.body).toBe("Plan.");

			res = await fetch(`${handle.url}/api/root-profiles/planning/copy`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					targetLibrary: "team",
					name: "planning-copy",
					description: "Copy",
				}),
			});
			expect(res.status).toBe(200);
			expect(
				fs.existsSync(path.join(libraryRoot, "profiles", "planning-copy.md")),
			).toBe(true);

			res = await fetch(`${handle.url}/api/root-profiles/default`, {
				method: "DELETE",
			});
			expect(res.status).toBe(403);

			res = await fetch(`${handle.url}/api/root-profiles/planning-copy`, {
				method: "DELETE",
			});
			expect(res.status).toBe(200);
			expect(
				fs.existsSync(path.join(libraryRoot, "profiles", "planning-copy.md")),
			).toBe(false);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("orchestrator display settings API", () => {
	it("hides package example agent types when the project toggle is off", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-display-api-"));
		const definitions = [
			{
				name: "pio-example-coder",
				description: "Example",
				agentClass: "implementer",
				systemPrompt: "",
				source: "package",
				filePath: "",
				readOnly: true,
				example: true,
			},
			{
				name: "pio-example-orchestrator",
				description: "Root profile",
				agentClass: "orchestrator",
				systemPrompt: "",
				source: "package",
				filePath: "",
				readOnly: true,
				example: true,
			},
			{
				name: "team-coder",
				description: "Team",
				agentClass: "implementer",
				systemPrompt: "Persisted team coder prompt.",
				source: "project",
				filePath: "",
			},
		];
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => definitions as any,
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			let res = await fetch(`${handle.url}/api/agent-types`);
			expect(res.status).toBe(200);
			let agentTypes = await res.json();
			expect(agentTypes.map((item: any) => item.name)).toEqual([
				"pio-example-coder",
				"team-coder",
			]);
			const teamCoder = agentTypes.find(
				(item: any) => item.name === "team-coder",
			);
			expect(teamCoder?.agentClass).toBe("implementer");
			expect(teamCoder?.prompt).toBe("Persisted team coder prompt.");

			res = await fetch(
				`${handle.url}/api/lattice-libraries/display-settings`,
				{
					method: "PUT",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ showPackageExamples: false }),
				},
			);
			expect(res.status).toBe(200);
			expect((await res.json()).showPackageExamples).toBe(false);

			res = await fetch(`${handle.url}/api/agent-types`);
			expect(res.status).toBe(200);
			agentTypes = await res.json();
			expect(agentTypes.map((item: any) => item.name)).toEqual(["team-coder"]);

			const saveOrchestrator = await fetch(`${handle.url}/api/agent-types`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "root-orchestrator",
					description: "Root only",
					agentClass: "orchestrator",
				}),
			});
			expect(saveOrchestrator.status).toBe(403);
			expect(await saveOrchestrator.text()).toContain(
				"root /orchestrate session",
			);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("agent type test session API", () => {
	it("spawns a disposable agent type test session, sends a message, and cleans up", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-agent-type-test-api-"),
		);
		const worktreeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-agent-type-test-worktree-"),
		);
		let removedWorktree: string | undefined;
		let sentMessage = "";
		let killed = false;
		let spawnedOptions: any;
		const definitions = [
			{
				name: "team-coder",
				description: "Team coder",
				agentClass: "implementer",
				systemPrompt: "Code.",
				source: "project",
				filePath: "",
			},
			{
				name: "root-orchestrator",
				description: "Root only",
				agentClass: "orchestrator",
				systemPrompt: "Root.",
				source: "project",
				filePath: "",
			},
		];
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async (id, options) => {
				spawnedOptions = options;
				return {
					agent: {
						id,
						proc: {
							get killed() {
								return killed;
							},
							kill() {
								killed = true;
							},
						},
						stdin: new PassThrough(),
						status: "idle",
						accumulatedText: "",
						history: [],
						events: [],
						buffer: "",
						worktreePath: worktreeDir,
						children: [],
						_rpcRequests: new Map(),
					} as any,
				};
			},
			sendToAgent: async (agent, message) => {
				sentMessage = message;
				agent.accumulatedText = "pong";
			},
			removeWorktree: async (worktreePath) => {
				removedWorktree = worktreePath;
			},
			discoverDefinitions: () => definitions as any,
			getDefinition: (name) =>
				definitions.find((definition) => definition.name === name) as any,
			discoverExtensions: () => [],
		});

		try {
			let res = await fetch(
				`${handle.url}/api/agent-types/root-orchestrator/test-session`,
				{ method: "POST" },
			);
			expect(res.status).toBe(403);

			res = await fetch(
				`${handle.url}/api/agent-types/team-coder/test-session`,
				{ method: "POST" },
			);
			expect(res.status).toBe(200);
			const started = await res.json();
			expect(started.session.agentType).toBe("team-coder");
			expect(started.session.status).toBe("idle");
			expect(started.session.worktree).toBe(worktreeDir);
			expect(spawnedOptions.definition.name).toBe("team-coder");
			expect(spawnedOptions.dashboardVisible).toBe(false);

			const liveAgents = await (await fetch(`${handle.url}/api/agents`)).json();
			expect(liveAgents).toEqual([]);

			res = await fetch(
				`${handle.url}/api/agent-type-test-sessions/${started.session.id}/messages`,
				{
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ message: "ping" }),
				},
			);
			expect(res.status).toBe(200);
			const sent = await res.json();
			expect(sent.response).toBe("pong");
			expect(sentMessage).toBe("ping");

			res = await fetch(
				`${handle.url}/api/agent-type-test-sessions/${started.session.id}`,
				{ method: "DELETE" },
			);
			expect(res.status).toBe(200);
			expect(killed).toBe(true);
			expect(removedWorktree).toBe(worktreeDir);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
			fs.rmSync(worktreeDir, { recursive: true, force: true });
		}
	});
});

describe("extension template smoke-test API", () => {
	it("spawns a temporary agent, reads runtime tools, and cleans up", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { runtimeToolsPath } = await import(
			"../extensions/multi-agent/runtime-tools.js"
		);
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-smoke-api-"));
		const worktreeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-worktree-"),
		);
		let removedWorktree: string | undefined;
		let spawnedExtensions: any[] = [];
		let spawnedModel: string | undefined;
		let spawnedOptions: any;
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async (_id, options) => {
				spawnedOptions = options;
				spawnedExtensions = options.extensions;
				spawnedModel = options.model;
				const snapshotPath = runtimeToolsPath(worktreeDir);
				fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
				fs.writeFileSync(
					snapshotPath,
					JSON.stringify({
						active: [{ name: "delegate" }, { name: "foo_tool" }],
						all: [
							{ name: "delegate", sourceInfo: { extension: "delegate" } },
							{ name: "foo_tool", sourceInfo: { extension: "foo" } },
							{ name: "foo_tool", sourceInfo: { extension: "bar" } },
						],
						reportedAt: 123,
						source: "child-agent",
					}),
					"utf-8",
				);
				return {
					agent: {
						id: "smoke-test",
						proc: {
							killed: false,
							kill() {
								this.killed = true;
							},
						},
						stdin: new PassThrough(),
						status: "idle",
						accumulatedText: "",
						history: [],
						events: [],
						buffer: "",
						worktreePath: worktreeDir,
						children: [],
						_rpcRequests: new Map(),
					} as any,
				};
			},
			sendToAgent: async () => {},
			removeWorktree: async (worktreePath) => {
				removedWorktree = worktreePath;
			},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [
				{ name: "foo", path: "/tmp/foo.ts", scope: "project" },
				{ name: "bar", path: "/tmp/bar.ts", scope: "project" },
			],
			currentModel: () => "anthropic/claude-sonnet-4-5",
		});

		try {
			const createRes = await fetch(`${handle.url}/api/extension-templates`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "tooling",
					description: "Tooling",
					extensions: ["foo", "bar"],
				}),
			});
			expect(createRes.status).toBe(200);

			const smokeRes = await fetch(
				`${handle.url}/api/extension-templates/tooling/smoke-test`,
				{ method: "POST" },
			);
			expect(smokeRes.status).toBe(200);
			const result = await smokeRes.json();
			expect(spawnedExtensions.map((extension) => extension.name)).toEqual([
				"foo",
				"bar",
			]);
			expect(spawnedModel).toBe("anthropic/claude-sonnet-4-5");
			expect(spawnedOptions.dashboardVisible).toBe(false);
			expect(result.smokeAgent.model).toBe("anthropic/claude-sonnet-4-5");
			expect(result.success).toBe(false);
			expect(result.runtimeTools.active.map((tool: any) => tool.name)).toEqual([
				"delegate",
				"foo_tool",
			]);
			expect(result.runtimeTools.conflicts[0].name).toBe("foo_tool");
			expect(removedWorktree).toBe(worktreeDir);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
			fs.rmSync(worktreeDir, { recursive: true, force: true });
		}
	});

	it("runs a minimal activation turn and rereads runtime tools when the startup snapshot has no active tools", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { runtimeToolsPath } = await import(
			"../extensions/multi-agent/runtime-tools.js"
		);
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-activation-api-"),
		);
		const worktreeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-activation-worktree-"),
		);
		const snapshotPath = runtimeToolsPath(worktreeDir);
		let sentMessage = "";
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async (id) => {
				fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
				fs.writeFileSync(
					snapshotPath,
					JSON.stringify({
						active: [],
						all: [
							{ name: "web_search", sourceInfo: { source: "pi-web-access" } },
						],
						reportedAt: 100,
						source: "child-agent",
					}),
					"utf-8",
				);
				return {
					agent: {
						id,
						proc: {
							killed: false,
							kill() {
								this.killed = true;
							},
						},
						stdin: new PassThrough(),
						status: "idle",
						accumulatedText: "",
						history: [],
						events: [],
						buffer: "",
						worktreePath: worktreeDir,
						children: [],
						_rpcRequests: new Map(),
					} as any,
				};
			},
			sendToAgent: async (_agent, message) => {
				sentMessage = message;
				fs.writeFileSync(
					snapshotPath,
					JSON.stringify({
						active: ["web_search"],
						all: [
							{ name: "web_search", sourceInfo: { source: "pi-web-access" } },
						],
						reportedAt: 200,
						source: "child-agent",
					}),
					"utf-8",
				);
			},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [
				{ name: "web-access", path: "/tmp/web-access.ts", scope: "project" },
			],
		});

		try {
			await fetch(`${handle.url}/api/extension-templates`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "web-activation",
					description: "Web",
					extensions: ["web-access"],
				}),
			});
			const smokeRes = await fetch(
				`${handle.url}/api/extension-templates/web-activation/smoke-test`,
				{ method: "POST" },
			);
			expect(smokeRes.status).toBe(200);
			const result = await smokeRes.json();
			expect(result.success).toBe(true);
			expect(sentMessage).toContain("Smoke test ping");
			expect(result.runtimeTools.active.map((tool: any) => tool.name)).toEqual([
				"web_search",
			]);
			expect(
				result.diagnostics.some((diagnostic: any) =>
					diagnostic.message.includes("minimal activation turn"),
				),
			).toBe(true);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
			fs.rmSync(worktreeDir, { recursive: true, force: true });
		}
	});

	it("fails when requested extensions report zero active runtime tools", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const { runtimeToolsPath } = await import(
			"../extensions/multi-agent/runtime-tools.js"
		);
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-zero-tools-api-"),
		);
		const worktreeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-zero-tools-worktree-"),
		);
		let spawnedId = "";
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async (id) => {
				spawnedId = id;
				const snapshotPath = runtimeToolsPath(worktreeDir);
				fs.mkdirSync(path.dirname(snapshotPath), { recursive: true });
				fs.writeFileSync(
					snapshotPath,
					JSON.stringify({
						active: [],
						all: Array.from({ length: 19 }, (_, index) => ({
							name: `known_tool_${index}`,
						})),
						reportedAt: 456,
						source: "child-agent",
					}),
					"utf-8",
				);
				return {
					agent: {
						id,
						proc: {
							killed: false,
							kill() {
								this.killed = true;
							},
						},
						stdin: new PassThrough(),
						status: "idle",
						accumulatedText: "",
						history: [],
						events: [],
						buffer: "",
						worktreePath: worktreeDir,
						children: [],
						_rpcRequests: new Map(),
					} as any,
				};
			},
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [
				{ name: "web-access", path: "/tmp/web-access.ts", scope: "project" },
			],
			currentModel: () => undefined,
		});

		try {
			await fetch(`${handle.url}/api/extension-templates`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "webby",
					description: "Web",
					extensions: ["web-access"],
				}),
			});
			const smokeRes = await fetch(
				`${handle.url}/api/extension-templates/webby/smoke-test`,
				{ method: "POST" },
			);
			expect(smokeRes.status).toBe(200);
			const result = await smokeRes.json();
			expect(result.success).toBe(false);
			expect(result.runtimeTools.active).toEqual([]);
			expect(result.smokeAgent.id).toBe(spawnedId);
			expect(result.smokeAgent.definition).toBe("extension-smoke-test");
			expect(result.smokeAgent.model).toBeUndefined();
			expect(
				result.diagnostics.some((diagnostic: any) =>
					diagnostic.message.includes("default model selection"),
				),
			).toBe(true);
			expect(
				result.diagnostics.some((diagnostic: any) =>
					diagnostic.message.includes("No active tools were available"),
				),
			).toBe(true);
			expect(
				result.diagnostics.some((diagnostic: any) =>
					diagnostic.message.includes("Spawned temporary smoke-test agent"),
				),
			).toBe(true);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
			fs.rmSync(worktreeDir, { recursive: true, force: true });
		}
	});

	it("reports missing template extensions without spawning", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-ext-smoke-missing-api-"),
		);
		let spawned = false;
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => {
				spawned = true;
				return { agent: undefined as any, error: "should not spawn" };
			},
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			await fetch(`${handle.url}/api/extension-templates`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					name: "missing",
					description: "Missing",
					extensions: ["nope"],
				}),
			});
			const smokeRes = await fetch(
				`${handle.url}/api/extension-templates/missing/smoke-test`,
				{ method: "POST" },
			);
			expect(smokeRes.status).toBe(200);
			const result = await smokeRes.json();
			expect(result.success).toBe(false);
			expect(result.missingExtensions).toEqual(["nope"]);
			expect(spawned).toBe(false);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("skill library API", () => {
	it("creates and updates project skills with hash guards", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skill-edit-api-"));
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			const createRes = await fetch(`${handle.url}/api/skills`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope: "project",
					name: "My Skill",
					description: "Helps with tests",
				}),
			});
			expect(createRes.status).toBe(200);
			const created = await createRes.json();
			expect(created.skill.name).toBe("my-skill");
			expect(created.skill.editable).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpDir, ".pi", "skills", "my-skill", "SKILL.md"),
				),
			).toBe(true);

			const richRes = await fetch(`${handle.url}/api/skills`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope: "project",
					name: "Rich Skill",
					description: "Rich scaffold",
					scaffold: "rich",
				}),
			});
			expect(richRes.status).toBe(200);
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						".pi",
						"skills",
						"rich-skill",
						"references",
						"README.md",
					),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						".pi",
						"skills",
						"rich-skill",
						"scripts",
						"README.md",
					),
				),
			).toBe(true);

			const copyRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}/copy`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						scope: "project",
						name: "Copied Skill",
						description: "Copied description",
					}),
				},
			);
			expect(copyRes.status).toBe(200);
			const copied = await copyRes.json();
			expect(copied.skill.name).toBe("copied-skill");
			expect(
				fs.readFileSync(
					path.join(tmpDir, ".pi", "skills", "copied-skill", "SKILL.md"),
					"utf-8",
				),
			).toContain("description: Copied description");

			const detailRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`,
			);
			const detail = await detailRes.json();
			const updatedContent = `---\nname: my-skill\ndescription: Helps with tests\n---\n# My Skill\n\nUpdated body.`;
			const updateRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						content: updatedContent,
						expectedHash: detail.hash,
					}),
				},
			);
			expect(updateRes.status).toBe(200);
			expect((await updateRes.json()).body).toContain("Updated body");

			const staleRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						content: updatedContent,
						expectedHash: "stale",
					}),
				},
			);
			expect(staleRes.status).toBe(409);

			const deleteRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`,
				{ method: "DELETE" },
			);
			expect(deleteRes.status).toBe(200);
			expect(
				fs.existsSync(path.join(tmpDir, ".pi", "skills", "my-skill")),
			).toBe(false);

			const missingAfterDelete = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(created.skill.id)}`,
			);
			expect(missingAfterDelete.status).toBe(404);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("lists skill metadata and loads skill markdown by id", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-skill-library-api-"),
		);
		const skillDir = path.join(tmpDir, ".pi", "skills", "demo");
		fs.mkdirSync(skillDir, { recursive: true });
		fs.writeFileSync(
			path.join(skillDir, "SKILL.md"),
			`---\nname: demo\ndescription: Demo skill\n---\n# Demo\n\nSee [Reference](references/ref.md).`,
			"utf-8",
		);

		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async () => ({
				agent: undefined as any,
				error: "disabled in tests",
			}),
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
		});

		try {
			const listRes = await fetch(`${handle.url}/api/skills`);
			expect(listRes.status).toBe(200);
			const list = await listRes.json();
			const demo = list.find((skill: any) => skill.name === "demo");
			expect(demo.id).toBeString();
			expect(demo.kind).toBe("directory");
			expect(demo.editable).toBe(true);

			const getRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(demo.id)}`,
			);
			expect(getRes.status).toBe(200);
			const detail = await getRes.json();
			expect(detail.skill.name).toBe("demo");
			expect(detail.content).toContain("# Demo");
			expect(detail.frontmatter.name).toBe("demo");
			expect(detail.body).toContain("See [Reference]");
			expect(detail.hash).toBeString();
			expect(detail.mtimeMs).toBeGreaterThan(0);

			fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
			fs.writeFileSync(
				path.join(skillDir, "references", "ref.md"),
				"# Reference\n\nDetails",
				"utf-8",
			);
			const treeRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(demo.id)}/tree`,
			);
			expect(treeRes.status).toBe(200);
			const tree = await treeRes.json();
			expect(
				tree.files.some((file: any) => file.path === "references/ref.md"),
			).toBe(true);

			const fileRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(demo.id)}/files?path=${encodeURIComponent("references/ref.md")}`,
			);
			expect(fileRes.status).toBe(200);
			const fileDetail = await fileRes.json();
			expect(fileDetail.content).toContain("# Reference");

			const updateFileRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(demo.id)}/files?path=${encodeURIComponent("references/ref.md")}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						content: "# Reference\n\nUpdated details",
						expectedHash: fileDetail.hash,
					}),
				},
			);
			expect(updateFileRes.status).toBe(200);
			expect((await updateFileRes.json()).content).toContain("Updated details");

			const traversalRes = await fetch(
				`${handle.url}/api/skills/${encodeURIComponent(demo.id)}/files?path=${encodeURIComponent("../../package.json")}`,
			);
			expect(traversalRes.status).toBe(400);

			const missingRes = await fetch(`${handle.url}/api/skills/not-a-real-id`);
			expect(missingRes.status).toBe(404);
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});

describe("agent spawn API", () => {
	it("passes issue metadata through to spawned-agent runtime state", async () => {
		const { startServer } = await import("../extensions/multi-agent/server.js");
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-spawn-api-"));
		const worktreeDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-spawn-worktree-"),
		);
		let spawnedOptions: any;
		const artifactPath = path.join(
			tmpDir,
			".pi",
			"pi-lattice",
			"issues",
			"pi-lattice-f91c",
		);
		const handle = await startServer({
			repoCwd: tmpDir,
			spawnAgent: async (id, options) => {
				spawnedOptions = options;
				return {
					agent: {
						id,
						proc: { killed: false, kill() {} },
						stdin: new PassThrough(),
						status: "idle",
						accumulatedText: "",
						history: [],
						events: [],
						buffer: "",
						model: options.model,
						worktreePath: worktreeDir,
						children: [],
						issueId: "pi-lattice-f91c",
						artifactPath,
						_rpcRequests: new Map(),
					} as any,
				};
			},
			sendToAgent: async () => {},
			removeWorktree: async () => {},
			discoverDefinitions: () => [],
			getDefinition: () => undefined,
			discoverExtensions: () => [],
			currentModel: () => "openai/gpt-5.5",
		});

		try {
			const res = await fetch(`${handle.url}/api/spawn`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					name: "lead",
					parent: "self",
					issueId: "pi-lattice-f91c",
				}),
			});

			expect(res.status).toBe(201);
			expect(spawnedOptions.issueId).toBe("pi-lattice-f91c");
			expect(spawnedOptions.model).toBe("openai/gpt-5.5");
			const spawned = await res.json();
			expect(spawned.issueId).toBe("pi-lattice-f91c");
			expect(spawned.artifactPath).toBe(artifactPath);
			expect(spawned.model).toBe("openai/gpt-5.5");

			const inspectRes = await fetch(`${handle.url}/api/agents/lead/events`);
			expect(inspectRes.status).toBe(200);
			const inspect = await inspectRes.json();
			expect(inspect.issueId).toBe("pi-lattice-f91c");
			expect(inspect.artifactPath).toBe(artifactPath);
			expect(inspect.model).toBe("openai/gpt-5.5");
		} finally {
			handle.stop();
			fs.rmSync(tmpDir, { recursive: true, force: true });
			fs.rmSync(worktreeDir, { recursive: true, force: true });
		}
	});
});
