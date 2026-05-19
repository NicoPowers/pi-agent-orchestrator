import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export type ResourceScope = "global" | "project";
export type ResourceKind = "skills" | "extensions";

export interface ResourcePathValidation {
  rawPath: string;
  resolvedPath?: string;
  exists: boolean;
  type: "file" | "directory" | "missing" | "glob" | "exclusion" | "unknown";
  count?: number;
  warnings: string[];
  errors: string[];
}

export interface ResourceScopeSettings {
  scope: ResourceScope;
  label: string;
  settingsPath: string;
  exists: boolean;
  skills: string[];
  extensions: string[];
  parseError?: string;
  readError?: string;
  validation: {
    skills: ResourcePathValidation[];
    extensions: ResourcePathValidation[];
  };
}

export interface ResourceSettingsPayload {
  global: ResourceScopeSettings;
  project: ResourceScopeSettings;
}

export interface UpdateResourceSettingsInput {
  scope: ResourceScope;
  skills?: string[];
  extensions?: string[];
}

function globalSettingsPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "settings.json");
}

function projectSettingsPath(repoCwd: string): string {
  return path.join(repoCwd, ".pi", "settings.json");
}

function baseDirFor(scope: ResourceScope, repoCwd: string): string {
  return scope === "global" ? path.join(os.homedir(), ".pi", "agent") : path.join(repoCwd, ".pi");
}

function settingsPathFor(scope: ResourceScope, repoCwd: string): string {
  return scope === "global" ? globalSettingsPath() : projectSettingsPath(repoCwd);
}

function emptySettings(): Record<string, unknown> {
  return {};
}

function readSettingsFile(filePath: string): { exists: boolean; settings: Record<string, unknown>; parseError?: string; readError?: string } {
  if (!fs.existsSync(filePath)) return { exists: false, settings: emptySettings() };
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    return { exists: true, settings: emptySettings(), readError: err?.message || String(err) };
  }
  if (!raw.trim()) return { exists: true, settings: emptySettings() };
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { exists: true, settings: emptySettings(), parseError: "settings.json must contain a JSON object" };
    }
    return { exists: true, settings: parsed as Record<string, unknown> };
  } catch (err: any) {
    return { exists: true, settings: emptySettings(), parseError: err?.message || String(err) };
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item)).filter((item) => item.length > 0);
}

function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function hasGlobSyntax(input: string): boolean {
  return /[*?\[\]{}]/.test(input);
}

function resolveResourcePath(rawPath: string, scope: ResourceScope, repoCwd: string): string | undefined {
  const trimmed = rawPath.trim();
  if (!trimmed || trimmed.startsWith("!")) return undefined;
  const expanded = expandTilde(trimmed);
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  return path.resolve(baseDirFor(scope, repoCwd), expanded);
}

function countSkillResources(target: string): number | undefined {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return path.basename(target) === "SKILL.md" || target.endsWith(".md") ? 1 : 0;
    if (!stat.isDirectory()) return 0;
    let count = fs.existsSync(path.join(target, "SKILL.md")) ? 1 : 0;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      if (entry.isDirectory() && fs.existsSync(path.join(target, entry.name, "SKILL.md"))) count += 1;
      if (entry.isFile() && entry.name.endsWith(".md")) count += 1;
    }
    return count;
  } catch {
    return undefined;
  }
}

function countExtensionResources(target: string): number | undefined {
  try {
    const stat = fs.statSync(target);
    if (stat.isFile()) return /\.(ts|js)$/.test(target) ? 1 : 0;
    if (!stat.isDirectory()) return 0;
    let count = 0;
    for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
      const entryPath = path.join(target, entry.name);
      if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) count += 1;
      if (entry.isDirectory() && (fs.existsSync(path.join(entryPath, "index.ts")) || fs.existsSync(path.join(entryPath, "index.js")) || fs.existsSync(path.join(entryPath, "package.json")))) count += 1;
    }
    return count;
  } catch {
    return undefined;
  }
}

function validateResourcePath(rawPath: string, scope: ResourceScope, kind: ResourceKind, repoCwd: string): ResourcePathValidation {
  const trimmed = rawPath.trim();
  const warnings: string[] = [];
  const errors: string[] = [];
  if (!trimmed) return { rawPath, exists: false, type: "missing", warnings: [], errors: ["Path is empty"] };
  if (trimmed.startsWith("!")) {
    warnings.push("Exclusion pattern; Pi will remove matching resources from previous includes.");
    return { rawPath, exists: false, type: "exclusion", warnings, errors };
  }
  if (hasGlobSyntax(trimmed)) {
    warnings.push("Glob/pattern validation is best effort; exact matches are resolved by Pi at load time.");
    const resolvedBase = resolveResourcePath(trimmed.replace(/[*?\[\]{}].*$/, ""), scope, repoCwd);
    return { rawPath, resolvedPath: resolvedBase, exists: !!resolvedBase && fs.existsSync(resolvedBase), type: "glob", warnings, errors };
  }
  const resolvedPath = resolveResourcePath(trimmed, scope, repoCwd);
  if (!resolvedPath) return { rawPath, exists: false, type: "unknown", warnings, errors: ["Unable to resolve path"] };
  try {
    const stat = fs.statSync(resolvedPath);
    const type = stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "unknown";
    const count = kind === "skills" ? countSkillResources(resolvedPath) : countExtensionResources(resolvedPath);
    if (kind === "extensions") warnings.push("Extensions execute code with full system permissions; only use trusted paths.");
    if (count === 0) warnings.push(`No ${kind} found by the dashboard's approximate scan.`);
    return { rawPath, resolvedPath, exists: true, type, count, warnings, errors };
  } catch {
    warnings.push("Path does not exist yet. Pi will only discover resources after it is created.");
    if (kind === "extensions") warnings.push("Only add extension paths from trusted sources.");
    return { rawPath, resolvedPath, exists: false, type: "missing", warnings, errors };
  }
}

function buildScope(scope: ResourceScope, repoCwd: string): ResourceScopeSettings {
  const settingsPath = settingsPathFor(scope, repoCwd);
  const read = readSettingsFile(settingsPath);
  const skills = toStringArray(read.settings.skills);
  const extensions = toStringArray(read.settings.extensions);
  return {
    scope,
    label: scope === "global" ? "Global / all projects on this machine" : "Project / current repository only",
    settingsPath,
    exists: read.exists,
    skills,
    extensions,
    parseError: read.parseError,
    readError: read.readError,
    validation: {
      skills: skills.map((p) => validateResourcePath(p, scope, "skills", repoCwd)),
      extensions: extensions.map((p) => validateResourcePath(p, scope, "extensions", repoCwd)),
    },
  };
}

export function readResourceSettings(repoCwd: string): ResourceSettingsPayload {
  return {
    global: buildScope("global", repoCwd),
    project: buildScope("project", repoCwd),
  };
}

function normalizeInputArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of strings`);
  return value.map((item) => String(item).trim()).filter(Boolean);
}

export function updateResourceSettings(input: UpdateResourceSettingsInput, repoCwd: string): { success: boolean; status?: number; error?: string; settings?: ResourceSettingsPayload } {
  if (input.scope !== "global" && input.scope !== "project") return { success: false, status: 400, error: "scope must be 'global' or 'project'" };
  let skills: string[] | undefined;
  let extensions: string[] | undefined;
  try {
    skills = normalizeInputArray(input.skills, "skills");
    extensions = normalizeInputArray(input.extensions, "extensions");
  } catch (err: any) {
    return { success: false, status: 400, error: err?.message || String(err) };
  }
  if (skills === undefined && extensions === undefined) return { success: false, status: 400, error: "Provide skills and/or extensions to update" };

  const settingsPath = settingsPathFor(input.scope, repoCwd);
  const read = readSettingsFile(settingsPath);
  if (read.parseError || read.readError) return { success: false, status: 400, error: `Cannot update ${settingsPath}: ${read.parseError || read.readError}` };
  const next = { ...read.settings };
  if (skills !== undefined) next.skills = skills;
  if (extensions !== undefined) next.extensions = extensions;
  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
    return { success: true, settings: readResourceSettings(repoCwd) };
  } catch (err: any) {
    return { success: false, status: 500, error: err?.message || String(err) };
  }
}
