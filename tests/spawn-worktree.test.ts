import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agents } from "../extensions/multi-agent/state.js";

function run(command: string, args: string[], cwd: string) {
	const result = spawnSync(command, args, { cwd, encoding: "utf-8" });
	if (result.status !== 0) {
		throw new Error(
			`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
		);
	}
	return result;
}

describe("spawn planning", () => {
	it("rejects orchestrator-class definitions before launching a child process", async () => {
		const { spawnAgent } = await import("../extensions/multi-agent/spawn.js");
		const result = await spawnAgent("rootish", {
			repoCwd: process.cwd(),
			definition: {
				name: "root-orchestrator",
				description: "Root only",
				agentClass: "orchestrator",
				systemPrompt: "Root only.",
				source: "project",
				filePath: "",
			},
		});
		expect(result.error).toContain("root /orchestrate session");
	});

	it("builds Pi args from agent definition without requiring path translation", async () => {
		const { buildPiArgs } = await import("../extensions/multi-agent/spawn.js");

		const args = buildPiArgs({
			model: "fallback-model",
			definition: {
				name: "coder",
				description: "Writes code",
				model: "definition-model",
				thinking: "low",
				tools: ["read", "bash"],
				skills: ["/skills/tdd"],
				systemPrompt: "You are {{name}}",
				source: "project",
				filePath: "/agents/coder.md",
			},
			promptPath: "/tmp/pi-worktree-lead/.pi/prompts/lead.md",
			delegatePromptPath: "/tmp/pi-worktree-lead/.pi/prompts/lead-delegate.md",
			delegateExtensionPath:
				"/tmp/pi-worktree-lead/.pi/extensions/delegate-agent.ts",
			artifactPromptPath: "/tmp/pi-worktree-lead/.pi/prompts/lead-artifacts.md",
			extraExtPaths: [],
		});

		expect(args).toContain("--mode");
		expect(args).toContain("rpc");
		expect(args).toContain("--session-id");
		const sessionId = args[args.indexOf("--session-id") + 1];
		expect(sessionId).toStartWith("pi-lattice.run-");
		expect(sessionId).toEndWith(".coder");
		expect(sessionId).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])$/);
		expect(args).not.toContain("--no-session");
		expect(args).toContain("definition-model");
		expect(args).toContain("--thinking");
		expect(args).toContain("low");
		expect(args).toContain("read,bash");
		expect(args).not.toContain("read,bash,delegate");
		expect(args).toContain("--no-skills");
		expect(args).toContain("/skills/tdd");
		expect(args).toContain("--no-extensions");
		expect(args).toContain(
			"/tmp/pi-worktree-lead/.pi/extensions/delegate-agent.ts",
		);
		expect(args).toContain(
			"/tmp/pi-worktree-lead/.pi/prompts/lead-artifacts.md",
		);
		expect(args.filter((arg) => arg === "--append-system-prompt")).toHaveLength(
			2,
		);
		expect(args.join(" ")).not.toContain("/tmp/workspace");
	});

	it("builds stable valid Pi session IDs for child agents", async () => {
		const { buildAgentSessionId } = await import(
			"../extensions/multi-agent/spawn.js"
		);

		const sessionId = buildAgentSessionId({
			agentId: "Lead Agent!!",
			runId: "run:2026/05/28",
		});

		expect(sessionId).toBe("pi-lattice.run-2026-05-28.Lead-Agent");
		expect(
			buildAgentSessionId({ agentId: "Lead Agent!!", runId: "run:2026/05/28" }),
		).toBe(sessionId);
		expect(sessionId).toMatch(/^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])$/);
	});

	it("keeps exact tool allowlists when extra extensions register runtime tools", async () => {
		const { buildPiArgs } = await import("../extensions/multi-agent/spawn.js");

		const args = buildPiArgs({
			model: undefined,
			definition: {
				name: "researcher",
				description: "Researches",
				tools: ["read", "web_search"],
				systemPrompt: "Research",
				source: "project",
				filePath: "/agents/researcher.md",
			},
			promptPath: null,
			delegatePromptPath: null,
			delegateExtensionPath:
				"/tmp/pi-worktree-researcher/.pi/extensions/delegate-agent.ts",
			artifactPromptPath: null,
			extraExtPaths: ["/home/user/.pi/agent/extensions/web.ts"],
		});

		expect(args).toContain("--tools");
		expect(args).toContain("read,web_search");
		expect(args).not.toContain("read,web_search,delegate");
		expect(args).toContain("--no-extensions");
		expect(args).toContain(
			"/tmp/pi-worktree-researcher/.pi/extensions/delegate-agent.ts",
		);
		expect(args).toContain("/home/user/.pi/agent/extensions/web.ts");
		expect(args.join(" ")).not.toContain("/tmp/workspace");
	});

	it("isolates basic test agents from external skills, context files, and delegate while keeping built-in tools", async () => {
		const { buildPiArgs } = await import("../extensions/multi-agent/spawn.js");

		const args = buildPiArgs({
			model: "fallback-model",
			definition: {
				name: "test-agent",
				description: "Basic test agent",
				isolated: true,
				delegate: false,
				systemPrompt: "",
				source: "project",
				filePath: "/agents/test-agent.md",
			},
			promptPath: null,
			delegatePromptPath: null,
			runtimeToolsExtensionPath:
				"/tmp/pi-worktree-test/.pi/extensions/runtime-tools-reporter.ts",
			delegateExtensionPath: null,
			artifactPromptPath: null,
			extraExtPaths: [],
		});

		expect(args).not.toContain("--no-tools");
		expect(args).not.toContain("--tools");
		expect(args).toContain("--no-skills");
		expect(args).toContain("--no-context-files");
		expect(args).toContain("--no-extensions");
		expect(args).toContain(
			"/tmp/pi-worktree-test/.pi/extensions/runtime-tools-reporter.ts",
		);
		expect(args.join(" ")).not.toContain("delegate-agent.ts");
	});

	it("loads bundled Cursor provider extension for cursor models", async () => {
		const { bundledProviderExtensionPaths } = await import(
			"../extensions/multi-agent/spawn.js"
		);

		const paths = bundledProviderExtensionPaths({
			model: "cursor/composer-2.5",
			repoCwd: process.cwd(),
		});

		expect(
			paths.some((p) => p.endsWith("node_modules/pi-cursor-sdk/src/index.ts")),
		).toBe(true);
	});

	it("disables ambient Cursor setting sources for cursor models", async () => {
		const { buildProcessEnv } = await import(
			"../extensions/multi-agent/spawn.js"
		);

		const env = buildProcessEnv({
			model: "cursor/composer-2.5",
			baseEnv: { EXISTING: "1" },
		});

		expect(env.EXISTING).toBe("1");
		expect(env.PI_CURSOR_SETTING_SOURCES).toBe("none");
	});

	it("builds direct child process launch metadata with the worktree as cwd", async () => {
		const { buildProcessLaunch } = await import(
			"../extensions/multi-agent/spawn.js"
		);

		const launch = buildProcessLaunch({
			worktreePath: "/tmp/pi-worktree-lead-1",
			piInvocation: { command: "pi", args: ["--mode", "rpc"] },
		});

		expect(launch).toEqual({
			command: "pi",
			args: ["--mode", "rpc"],
			cwd: "/tmp/pi-worktree-lead-1",
		});
		expect(JSON.stringify(launch)).not.toContain("bwrap");
		expect(JSON.stringify(launch)).not.toContain("/tmp/workspace");
	});
});

describe("worktree lifecycle", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-repo-"));
		run("git", ["init"], repoDir);
		run("git", ["config", "user.email", "tests@example.com"], repoDir);
		run("git", ["config", "user.name", "Tests"], repoDir);
		fs.writeFileSync(path.join(repoDir, "README.md"), "root\n", "utf-8");
		run("git", ["add", "README.md"], repoDir);
		run("git", ["commit", "-m", "init"], repoDir);
	});

	afterEach(() => {
		agents.clear();
		fs.rmSync(repoDir, { recursive: true, force: true });
	});

	it("creates an isolated git worktree and removes it", async () => {
		const { createWorktree, removeWorktree } = await import(
			"../extensions/multi-agent/worktree.js"
		);

		const worktreePath = await createWorktree("lead", repoDir);
		expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

		fs.writeFileSync(
			path.join(worktreePath, "agent-only.txt"),
			"child\n",
			"utf-8",
		);
		expect(fs.existsSync(path.join(repoDir, "agent-only.txt"))).toBe(false);

		await removeWorktree(worktreePath);
		expect(fs.existsSync(worktreePath)).toBe(false);
	});

	it("cleans only orphaned pi worktree directories", async () => {
		const { cleanupOrphanedWorktrees } = await import(
			"../extensions/multi-agent/worktree.js"
		);

		const activePath = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-worktree-active-"),
		);
		const orphanPath = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-worktree-orphan-"),
		);
		agents.set("active", { worktreePath: activePath } as any);

		cleanupOrphanedWorktrees();

		expect(fs.existsSync(activePath)).toBe(true);
		expect(fs.existsSync(orphanPath)).toBe(false);

		agents.clear();
		fs.rmSync(activePath, { recursive: true, force: true });
	});

	it("does not delete a worktree while serialized creation is still finishing", async () => {
		const { cleanupOrphanedWorktrees, createWorktree, removeWorktree } =
			await import("../extensions/multi-agent/worktree.js");

		const worktreePath = await createWorktree("pending", repoDir);

		cleanupOrphanedWorktrees();

		expect(fs.existsSync(worktreePath)).toBe(true);
		await removeWorktree(worktreePath);
	});
});
