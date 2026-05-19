import * as fs from "node:fs";
import * as path from "node:path";

import { log, type RuntimeToolConflict, type RuntimeToolInfo, type RuntimeToolSnapshot } from "./state.js";

const loggedConflictKeys = new Set<string>();

export function runtimeToolsPath(worktreePath: string): string {
  return path.join(worktreePath, ".pi", "comms", "runtime-tools.json");
}

function normalizeTool(tool: any): RuntimeToolInfo | undefined {
  if (!tool || typeof tool.name !== "string" || !tool.name.trim()) return undefined;
  return {
    name: tool.name.trim(),
    description: typeof tool.description === "string" ? tool.description : undefined,
    sourceInfo: tool.sourceInfo,
  };
}

function normalizeList(value: unknown): RuntimeToolInfo[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const result: RuntimeToolInfo[] = [];
  for (const item of value) {
    const tool = normalizeTool(item);
    if (!tool || seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push(tool);
  }
  return result;
}

function normalizeActiveList(value: unknown, allTools: RuntimeToolInfo[]): RuntimeToolInfo[] {
  if (!Array.isArray(value)) return [];
  const allByName = new Map(allTools.map((tool) => [tool.name, tool]));
  const seen = new Set<string>();
  const result: RuntimeToolInfo[] = [];
  for (const item of value) {
    const name = typeof item === "string" ? item.trim() : undefined;
    const tool = name ? (allByName.get(name) || { name }) : normalizeTool(item);
    if (!tool || seen.has(tool.name)) continue;
    seen.add(tool.name);
    result.push(tool);
  }
  return result;
}

function sourceLabel(tool: RuntimeToolInfo): string {
  const info = tool.sourceInfo as any;
  if (info && typeof info === "object") {
    for (const key of ["extension", "name", "namespace", "path", "source"]) {
      if (typeof info[key] === "string" && info[key].trim()) return `${key}:${info[key].trim()}`;
    }
  }
  if (typeof tool.description === "string" && tool.description.trim()) return tool.description.trim();
  return "unknown";
}

export function detectRuntimeToolConflicts(value: unknown): RuntimeToolConflict[] {
  if (!Array.isArray(value)) return [];
  const byName = new Map<string, RuntimeToolInfo[]>();
  for (const item of value) {
    const tool = normalizeTool(item);
    if (!tool) continue;
    byName.set(tool.name, [...(byName.get(tool.name) || []), tool]);
  }
  return Array.from(byName.entries())
    .filter(([, tools]) => tools.length > 1)
    .map(([name, tools]) => ({
      name,
      count: tools.length,
      sources: Array.from(new Set(tools.map(sourceLabel))),
    }));
}

export function logRuntimeToolConflicts(agentName: string, snapshot: RuntimeToolSnapshot | undefined): void {
  if (!snapshot?.conflicts?.length) return;
  for (const conflict of snapshot.conflicts) {
    const key = `${agentName}:${snapshot.reportedAt}:${conflict.name}:${conflict.count}:${conflict.sources.join("|")}`;
    if (loggedConflictKeys.has(key)) continue;
    loggedConflictKeys.add(key);
    log("runtime-tools", `Agent '${agentName}' reported conflicting runtime tool '${conflict.name}'`, {
      count: conflict.count,
      sources: conflict.sources,
    });
  }
}

export function readRuntimeToolSnapshot(worktreePath: string): RuntimeToolSnapshot | undefined {
  const filePath = runtimeToolsPath(worktreePath);
  if (!fs.existsSync(filePath)) return undefined;

  try {
    const raw = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const reportedAt = typeof raw.reportedAt === "number" && Number.isFinite(raw.reportedAt) ? raw.reportedAt : 0;
    const conflicts = detectRuntimeToolConflicts(raw.all);
    const all = normalizeList(raw.all);
    return {
      active: normalizeActiveList(raw.active, all),
      all,
      reportedAt,
      source: "child-agent",
      ...(conflicts.length ? { conflicts } : {}),
    };
  } catch {
    return undefined;
  }
}
