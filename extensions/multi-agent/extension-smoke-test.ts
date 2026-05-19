import * as fs from "node:fs";
import * as path from "node:path";

import { resolveCapabilities, type ExtensionRef } from "./capability-resolution.js";
import { getExtensionTemplate, type ExtensionTemplate } from "./extension-templates.js";
import { readRuntimeToolSnapshot } from "./runtime-tools.js";
import { log, type Agent, type RuntimeToolSnapshot } from "./state.js";

export interface ExtensionTemplateSmokeTestResult {
  success: boolean;
  template: string;
  extensions: ExtensionRef[];
  missingExtensions: string[];
  runtimeTools?: RuntimeToolSnapshot;
  diagnostics: Array<{ level: "error" | "warning" | "info"; message: string }>;
  stderrTail?: string;
  smokeAgent?: { id: string; definition: string; model?: string; worktree?: string };
}

export interface ExtensionTemplateSmokeTestDeps {
  repoCwd: string;
  discoverExtensions: (cwd: string) => ExtensionRef[];
  spawnAgent: (id: string, options: any) => Promise<{ agent: Agent; error?: string }>;
  sendToAgent?: (agent: Agent, message: string, timeoutMs: number) => Promise<void>;
  removeWorktree: (worktreePath: string) => Promise<void>;
  currentModel?: () => string | undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForRuntimeTools(worktreePath: string, timeoutMs = 3_000, options: { afterReportedAt?: number; preferActive?: boolean } = {}): Promise<RuntimeToolSnapshot | undefined> {
  const deadline = Date.now() + timeoutMs;
  let latest: RuntimeToolSnapshot | undefined;
  while (Date.now() < deadline) {
    const snapshot = readRuntimeToolSnapshot(worktreePath);
    if (snapshot) {
      latest = snapshot;
      const isNewEnough = options.afterReportedAt === undefined || snapshot.reportedAt > options.afterReportedAt;
      const isActiveEnough = !options.preferActive || snapshot.active.length > 0;
      if (isNewEnough && isActiveEnough) return snapshot;
    }
    await sleep(100);
  }
  return latest;
}

function readStderrTail(worktreePath: string): string | undefined {
  const filePath = path.join(worktreePath, ".pi", "stderr.log");
  try {
    if (!fs.existsSync(filePath)) return undefined;
    const text = fs.readFileSync(filePath, "utf-8").trim();
    return text ? text.slice(-4_000) : undefined;
  } catch {
    return undefined;
  }
}

function diagnosticsForSnapshot(snapshot: RuntimeToolSnapshot | undefined, requestedExtensions: ExtensionRef[]): ExtensionTemplateSmokeTestResult["diagnostics"] {
  if (!snapshot) {
    return [{ level: "error", message: "No runtime tool snapshot was reported before the smoke-test timeout." }];
  }
  const diagnostics: ExtensionTemplateSmokeTestResult["diagnostics"] = [
    { level: "info", message: `Runtime reported ${snapshot.active.length} active tools and ${snapshot.all.length} total tools.` },
  ];
  if (!snapshot.active.length) {
    diagnostics.push({
      level: "error",
      message: `No active tools were available after loading requested extensions (${requestedExtensions.map((extension) => extension.name).join(", ") || "none"}). Extension template smoke tests require at least one active runtime tool.`,
    });
  }
  for (const conflict of snapshot.conflicts || []) {
    diagnostics.push({
      level: "error",
      message: `Runtime tool '${conflict.name}' was registered ${conflict.count} times${conflict.sources.length ? ` by ${conflict.sources.join(", ")}` : ""}.`,
    });
  }
  return diagnostics;
}

export async function smokeTestExtensionTemplate(name: string, deps: ExtensionTemplateSmokeTestDeps): Promise<ExtensionTemplateSmokeTestResult | { error: string; status: number }> {
  const template: ExtensionTemplate | undefined = getExtensionTemplate(name, deps.repoCwd);
  if (!template) return { error: "Extension template not found", status: 404 };

  const capabilities = resolveCapabilities({
    cwd: deps.repoCwd,
    requestedExtensions: template.items,
    availableExtensions: deps.discoverExtensions(deps.repoCwd),
  });

  const base: Omit<ExtensionTemplateSmokeTestResult, "success"> = {
    template: template.name,
    extensions: capabilities.extensions,
    missingExtensions: capabilities.missingExtensions,
    diagnostics: [],
  };

  if (capabilities.missingExtensions.length) {
    return {
      ...base,
      success: false,
      diagnostics: capabilities.missingExtensions.map((extension) => ({ level: "error", message: `Extension '${extension}' was not found.` })),
    };
  }

  const agentId = `smoke-${template.name.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`;
  const smokeDefinitionName = "extension-smoke-test";
  const smokeModel = deps.currentModel?.();
  log("extension-smoke-test", `Spawning temporary smoke-test agent '${agentId}'`, { template: template.name, model: smokeModel || "default", extensions: capabilities.extensions.map((extension) => extension.name) });
  let agent: Agent | undefined;
  try {
    const result = await deps.spawnAgent(agentId, {
      model: smokeModel,
      repoCwd: deps.repoCwd,
      definition: {
        name: smokeDefinitionName,
        description: "Temporary extension template smoke-test agent",
        tools: [],
        systemPrompt: "You are a temporary smoke-test agent. Do not perform any task.",
        source: "project",
        filePath: "",
      },
      extensions: capabilities.extensions,
    });
    agent = result.agent;
    const smokeAgent = { id: agentId, definition: smokeDefinitionName, model: smokeModel, worktree: agent?.worktreePath };
    if (result.error || !agent) {
      return { ...base, success: false, smokeAgent, diagnostics: [{ level: "error", message: result.error || "Smoke-test agent failed to spawn." }] };
    }

    let snapshot = await waitForRuntimeTools(agent.worktreePath, 1_250, { preferActive: true });
    const activationDiagnostics: ExtensionTemplateSmokeTestResult["diagnostics"] = [];
    if (snapshot && snapshot.active.length === 0 && deps.sendToAgent) {
      const previousReportedAt = snapshot.reportedAt;
      activationDiagnostics.push({ level: "info", message: "Startup snapshot reported no active tools; sending a minimal activation turn before rereading runtime tools." });
      try {
        await deps.sendToAgent(agent, "Smoke test ping: reply exactly OK.", 30_000);
        const updatedSnapshot = await waitForRuntimeTools(agent.worktreePath, 1_000, { afterReportedAt: previousReportedAt });
        if (updatedSnapshot && updatedSnapshot.reportedAt > previousReportedAt) {
          snapshot = updatedSnapshot;
          activationDiagnostics.push({ level: "info", message: "Completed minimal activation turn and reread runtime tool snapshot." });
        } else {
          activationDiagnostics.push({ level: "warning", message: "Minimal activation turn completed but no newer runtime tool snapshot was reported." });
        }
      } catch (err: any) {
        activationDiagnostics.push({ level: "warning", message: `Minimal activation turn failed: ${err?.message || String(err)}` });
      }
    }
    const stderrTail = readStderrTail(agent.worktreePath);
    const diagnostics = [
      { level: "info" as const, message: `Spawned temporary smoke-test agent '${agentId}' using definition '${smokeDefinitionName}'${smokeModel ? ` and model '${smokeModel}'` : " with default model selection"} in worktree ${agent.worktreePath}.` },
      ...activationDiagnostics,
      ...diagnosticsForSnapshot(snapshot, capabilities.extensions),
    ];
    log("extension-smoke-test", `Runtime tool snapshot for '${agentId}'`, { active: snapshot?.active.length || 0, total: snapshot?.all.length || 0, worktree: agent.worktreePath });
    if (agent.status === "error" || agent.status === "exited") {
      diagnostics.push({ level: "error", message: `Smoke-test agent ended with status '${agent.status}'.` });
    }
    if (stderrTail) diagnostics.push({ level: "warning", message: "Smoke-test agent wrote to stderr; inspect stderrTail for details." });

    return {
      ...base,
      success: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
      runtimeTools: snapshot,
      diagnostics,
      stderrTail,
      smokeAgent,
    };
  } finally {
    if (agent) {
      try { if (!agent.proc.killed) agent.proc.kill("SIGTERM"); } catch {}
      await deps.removeWorktree(agent.worktreePath).catch(() => {});
    }
  }
}
