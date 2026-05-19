import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { agents } from "../extensions/multi-agent/state.js";

function run(command: string, args: string[], cwd: string) {
  const result = spawnSync(command, args, { cwd, encoding: "utf-8" });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
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

  it("builds Pi args from agent definition without requiring a real Pi process", async () => {
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
      promptInsideBwrap: "/tmp/workspace/.pi/prompts/lead.md",
      delegatePromptInsideBwrap: "/tmp/workspace/.pi/prompts/lead-delegate.md",
      delegateInsideBwrap: "/tmp/workspace/.pi/extensions/delegate-agent.ts",
      extraExtPaths: [],
    });

    expect(args).toContain("--mode");
    expect(args).toContain("rpc");
    expect(args).toContain("--no-session");
    expect(args).toContain("definition-model");
    expect(args).toContain("--thinking");
    expect(args).toContain("low");
    expect(args).toContain("read,bash,delegate");
    expect(args).toContain("--no-skills");
    expect(args).toContain("/skills/tdd");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("/tmp/workspace/.pi/extensions/delegate-agent.ts");
  });

  it("does not restrict tools when extra extensions may register runtime tools", async () => {
    const { buildPiArgs } = await import("../extensions/multi-agent/spawn.js");

    const args = buildPiArgs({
      model: undefined,
      definition: {
        name: "researcher",
        description: "Researches",
        tools: ["read"],
        systemPrompt: "Research",
        source: "project",
        filePath: "/agents/researcher.md",
      },
      promptInsideBwrap: null,
      delegatePromptInsideBwrap: null,
      delegateInsideBwrap: "/tmp/workspace/.pi/extensions/delegate-agent.ts",
      extraExtPaths: ["/home/user/.pi/agent/extensions/web.ts"],
    });

    expect(args).not.toContain("--tools");
    expect(args).toContain("--no-extensions");
    expect(args).toContain("/tmp/workspace/.pi/extensions/delegate-agent.ts");
    expect(args).toContain("/home/user/.pi/agent/extensions/web.ts");
  });

  it("builds bwrap args with workspace and optional agent settings bind mounts", async () => {
    const { buildBwrapArgs } = await import("../extensions/multi-agent/spawn.js");

    const args = buildBwrapArgs({
      worktreePath: "/tmp/pi-worktree-lead-1",
      piInvocation: { command: "pi", args: ["--mode", "rpc"] },
      homeDir: "/home/alice",
      piAgentDirExists: true,
    });

    expect(args).toEqual([
      "--ro-bind", "/", "/",
      "--tmpfs", "/tmp",
      "--dev", "/dev",
      "--bind", "/tmp/pi-worktree-lead-1", "/tmp/workspace",
      "--chdir", "/tmp/workspace",
      "--share-net",
      "--setenv", "HOME", "/home/alice",
      "--bind", "/home/alice/.pi/agent", "/home/alice/.pi/agent",
      "pi", "--mode", "rpc",
    ]);
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
    const { createWorktree, removeWorktree } = await import("../extensions/multi-agent/worktree.js");

    const worktreePath = await createWorktree("lead", repoDir);
    expect(fs.existsSync(path.join(worktreePath, "README.md"))).toBe(true);

    fs.writeFileSync(path.join(worktreePath, "agent-only.txt"), "child\n", "utf-8");
    expect(fs.existsSync(path.join(repoDir, "agent-only.txt"))).toBe(false);

    await removeWorktree(worktreePath);
    expect(fs.existsSync(worktreePath)).toBe(false);
  });

  it("cleans only orphaned pi worktree directories", async () => {
    const { cleanupOrphanedWorktrees } = await import("../extensions/multi-agent/worktree.js");

    const activePath = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-active-"));
    const orphanPath = fs.mkdtempSync(path.join(os.tmpdir(), "pi-worktree-orphan-"));
    agents.set("active", { worktreePath: activePath } as any);

    cleanupOrphanedWorktrees();

    expect(fs.existsSync(activePath)).toBe(true);
    expect(fs.existsSync(orphanPath)).toBe(false);

    agents.clear();
    fs.rmSync(activePath, { recursive: true, force: true });
  });
});
