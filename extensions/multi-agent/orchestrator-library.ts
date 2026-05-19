import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export const ORCHESTRATOR_LIBRARY_MANIFEST = "orchestrator-library.json";
export const ORCHESTRATOR_LIBRARY_SCHEMA = "pi-orchestrator-library/v1";

export type OrchestratorResourceKind = "agents" | "skillTemplates" | "extensionTemplates" | "skills" | "extensions";

export interface OrchestratorLibraryManifest {
  schema: string;
  name: string;
  description?: string;
  compatibility?: {
    piAgentOrchestrator?: string;
    [key: string]: unknown;
  };
  resources: Record<OrchestratorResourceKind, string>;
}

export interface ResolvedOrchestratorResourceDir {
  kind: OrchestratorResourceKind;
  rawPath: string;
  resolvedPath: string;
  exists: boolean;
}

export interface OrchestratorLibraryDiagnostic {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export interface OrchestratorLibraryInfo {
  root: string;
  manifestPath: string;
  manifest?: OrchestratorLibraryManifest;
  resourceDirs: Record<OrchestratorResourceKind, ResolvedOrchestratorResourceDir>;
  diagnostics: OrchestratorLibraryDiagnostic[];
  valid: boolean;
}

export interface OrchestratorLibrarySet {
  libraries: OrchestratorLibraryInfo[];
  diagnostics: OrchestratorLibraryDiagnostic[];
  valid: boolean;
}

export type OrchestratorLibrarySettingsScope = "global" | "project";

export interface ConfiguredOrchestratorLibrary {
  path: string;
  scope: OrchestratorLibrarySettingsScope;
  editable?: boolean;
}

export interface OrchestratorLibraryScopeSettings {
  scope: OrchestratorLibrarySettingsScope;
  settingsPath: string;
  exists: boolean;
  libraries: ConfiguredOrchestratorLibrary[];
  parseError?: string;
  readError?: string;
}

export interface OrchestratorLibrarySettingsPayload {
  global: OrchestratorLibraryScopeSettings;
  project: OrchestratorLibraryScopeSettings;
  libraries: ConfiguredOrchestratorLibrary[];
}

export interface OrchestratorLibrarySettingsPaths {
  globalSettingsPath?: string;
  projectSettingsPath?: string;
}

export interface DiscoveredOrchestratorResource {
  id: string;
  kind: OrchestratorResourceKind;
  name: string;
  description?: string;
  libraryName: string;
  libraryPath: string;
  filePath: string;
  relativePath: string;
  editable: boolean;
  readOnly: boolean;
  diagnostics: OrchestratorLibraryDiagnostic[];
}

export interface OrchestratorLibraryDiscovery {
  library: OrchestratorLibraryInfo;
  resources: DiscoveredOrchestratorResource[];
  diagnostics: OrchestratorLibraryDiagnostic[];
}

export interface OrchestratorLibrariesDiscovery {
  libraries: OrchestratorLibraryInfo[];
  resources: DiscoveredOrchestratorResource[];
  diagnostics: OrchestratorLibraryDiagnostic[];
  valid: boolean;
}

export interface BootstrapOrchestratorLibraryResult {
  success: boolean;
  status?: number;
  error?: string;
  scope?: OrchestratorLibrarySettingsScope;
  library?: OrchestratorLibraryInfo;
  settings?: OrchestratorLibrarySettingsPayload;
}

const resourceDefaults: Record<OrchestratorResourceKind, string> = {
  agents: "agents",
  skillTemplates: "skill-templates",
  extensionTemplates: "extension-templates",
  skills: "skills",
  extensions: "extensions",
};

const manifestResourceKeys: Array<[OrchestratorResourceKind, string]> = [
  ["agents", "agents"],
  ["skillTemplates", "skillTemplates"],
  ["extensionTemplates", "extensionTemplates"],
  ["skills", "skills"],
  ["extensions", "extensions"],
];

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function globalSettingsPath(): string {
  return path.join(os.homedir(), ".pi", "agent", "settings.json");
}

function projectSettingsPath(repoCwd: string): string {
  return path.join(repoCwd, ".pi", "settings.json");
}

function settingsPathFor(scope: OrchestratorLibrarySettingsScope, repoCwd: string, paths: OrchestratorLibrarySettingsPaths = {}): string {
  if (scope === "global") return paths.globalSettingsPath || globalSettingsPath();
  return paths.projectSettingsPath || projectSettingsPath(repoCwd);
}

function readSettingsFile(filePath: string): { exists: boolean; settings: Record<string, unknown>; parseError?: string; readError?: string } {
  if (!fs.existsSync(filePath)) return { exists: false, settings: {} };
  let raw = "";
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err: any) {
    return { exists: true, settings: {}, readError: err?.message || String(err) };
  }
  if (!raw.trim()) return { exists: true, settings: {} };
  try {
    const parsed = JSON.parse(raw);
    if (!isObject(parsed)) return { exists: true, settings: {}, parseError: "settings.json must contain a JSON object" };
    return { exists: true, settings: parsed };
  } catch (err: any) {
    return { exists: true, settings: {}, parseError: err?.message || String(err) };
  }
}

function expandTilde(input: string): string {
  if (input === "~") return os.homedir();
  if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
  return input;
}

function resolveConfiguredLibraryPath(library: ConfiguredOrchestratorLibrary, repoCwd: string): string {
  const expanded = expandTilde(library.path);
  if (path.isAbsolute(expanded)) return path.resolve(expanded);
  return path.resolve(repoCwd, expanded);
}

function normalizeConfiguredLibraries(value: unknown, scope: OrchestratorLibrarySettingsScope): ConfiguredOrchestratorLibrary[] {
  if (!Array.isArray(value)) return [];
  const libraries: ConfiguredOrchestratorLibrary[] = [];
  for (const entry of value) {
    if (typeof entry === "string" && entry.trim()) {
      libraries.push({ path: entry.trim(), scope });
    } else if (isObject(entry) && typeof entry.path === "string" && entry.path.trim()) {
      libraries.push({ path: entry.path.trim(), scope, editable: typeof entry.editable === "boolean" ? entry.editable : undefined });
    }
  }
  return libraries;
}

function getOrchestratorSettings(settings: Record<string, unknown>): Record<string, unknown> {
  return isObject(settings.piAgentOrchestrator) ? settings.piAgentOrchestrator : {};
}

function readLibraryScopeSettings(scope: OrchestratorLibrarySettingsScope, repoCwd: string, paths: OrchestratorLibrarySettingsPaths = {}): OrchestratorLibraryScopeSettings {
  const settingsPath = settingsPathFor(scope, repoCwd, paths);
  const read = readSettingsFile(settingsPath);
  return {
    scope,
    settingsPath,
    exists: read.exists,
    libraries: normalizeConfiguredLibraries(getOrchestratorSettings(read.settings).libraries, scope),
    parseError: read.parseError,
    readError: read.readError,
  };
}

export function validateLibraryName(name: unknown): string | undefined {
  if (typeof name !== "string" || !name.trim()) return "manifest name is required";
  if (!/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(name.trim()) && !/^[a-z0-9]$/.test(name.trim())) {
    return "manifest name must be 1-64 lowercase letters, numbers, dots, underscores, or dashes, with no leading/trailing punctuation";
  }
  return undefined;
}

function resolveResourceDir(root: string, kind: OrchestratorResourceKind, rawPath: string): { dir?: ResolvedOrchestratorResourceDir; error?: string } {
  const trimmed = rawPath.trim();
  if (!trimmed) return { error: `${kind} resource path is empty` };
  if (path.isAbsolute(trimmed)) return { error: `${kind} resource path must be relative to the library root` };
  const resolvedPath = path.resolve(root, trimmed);
  const relative = path.relative(root, resolvedPath);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return { error: `${kind} resource path must stay inside the library root` };
  }
  return {
    dir: {
      kind,
      rawPath: trimmed,
      resolvedPath,
      exists: fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory(),
    },
  };
}

export function readOrchestratorLibrary(rootPath: string): OrchestratorLibraryInfo {
  const root = path.resolve(rootPath);
  const manifestPath = path.join(root, ORCHESTRATOR_LIBRARY_MANIFEST);
  const diagnostics: OrchestratorLibraryDiagnostic[] = [];
  const resourceDirs = {} as Record<OrchestratorResourceKind, ResolvedOrchestratorResourceDir>;

  if (!fs.existsSync(manifestPath)) {
    diagnostics.push({ level: "error", message: `Missing ${ORCHESTRATOR_LIBRARY_MANIFEST}`, path: manifestPath });
    for (const [kind] of manifestResourceKeys) {
      const resolved = resolveResourceDir(root, kind, resourceDefaults[kind]);
      if (resolved.dir) resourceDirs[kind] = resolved.dir;
    }
    return { root, manifestPath, resourceDirs, diagnostics, valid: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  } catch (err: any) {
    diagnostics.push({ level: "error", message: `Invalid ${ORCHESTRATOR_LIBRARY_MANIFEST}: ${err?.message || String(err)}`, path: manifestPath });
    for (const [kind] of manifestResourceKeys) {
      const resolved = resolveResourceDir(root, kind, resourceDefaults[kind]);
      if (resolved.dir) resourceDirs[kind] = resolved.dir;
    }
    return { root, manifestPath, resourceDirs, diagnostics, valid: false };
  }

  if (!isObject(parsed)) {
    diagnostics.push({ level: "error", message: `${ORCHESTRATOR_LIBRARY_MANIFEST} must contain a JSON object`, path: manifestPath });
    return { root, manifestPath, resourceDirs, diagnostics, valid: false };
  }

  if (parsed.schema !== ORCHESTRATOR_LIBRARY_SCHEMA) {
    diagnostics.push({ level: "error", message: `Unsupported orchestrator library schema '${String(parsed.schema || "")}'. Expected '${ORCHESTRATOR_LIBRARY_SCHEMA}'.`, path: manifestPath });
  }

  const nameError = validateLibraryName(parsed.name);
  if (nameError) diagnostics.push({ level: "error", message: nameError, path: manifestPath });

  if (parsed.description !== undefined && typeof parsed.description !== "string") {
    diagnostics.push({ level: "error", message: "manifest description must be a string when provided", path: manifestPath });
  }

  if (parsed.compatibility !== undefined && !isObject(parsed.compatibility)) {
    diagnostics.push({ level: "error", message: "manifest compatibility must be an object when provided", path: manifestPath });
  }

  const rawResources = isObject(parsed.resources) ? parsed.resources : {};
  if (!isObject(parsed.resources)) {
    diagnostics.push({ level: "warning", message: "manifest resources object is missing; using default resource directories", path: manifestPath });
  }

  const resources = {} as Record<OrchestratorResourceKind, string>;
  for (const [kind, manifestKey] of manifestResourceKeys) {
    const rawValue = rawResources[manifestKey];
    const rawPath = typeof rawValue === "string" && rawValue.trim() ? rawValue : resourceDefaults[kind];
    if (rawValue === undefined) {
      diagnostics.push({ level: "warning", message: `manifest resources.${manifestKey} is missing; using '${resourceDefaults[kind]}'`, path: manifestPath });
    } else if (typeof rawValue !== "string") {
      diagnostics.push({ level: "error", message: `manifest resources.${manifestKey} must be a string`, path: manifestPath });
    }
    resources[kind] = rawPath;
    const resolved = resolveResourceDir(root, kind, rawPath);
    if (resolved.error) {
      diagnostics.push({ level: "error", message: resolved.error, path: manifestPath });
    } else if (resolved.dir) {
      resourceDirs[kind] = resolved.dir;
      if (!resolved.dir.exists) {
        diagnostics.push({ level: "warning", message: `${kind} directory does not exist: ${resolved.dir.rawPath}`, path: resolved.dir.resolvedPath });
      }
    }
  }

  const manifest: OrchestratorLibraryManifest | undefined = typeof parsed.name === "string" && typeof parsed.schema === "string"
    ? {
      schema: parsed.schema,
      name: parsed.name.trim(),
      description: typeof parsed.description === "string" ? parsed.description : undefined,
      compatibility: isObject(parsed.compatibility) ? parsed.compatibility as OrchestratorLibraryManifest["compatibility"] : undefined,
      resources,
    }
    : undefined;

  return {
    root,
    manifestPath,
    manifest,
    resourceDirs,
    diagnostics,
    valid: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  };
}

function relativeResourcePath(root: string, filePath: string): string {
  return path.relative(root, filePath).replace(/\\/g, "/");
}

function resourceId(libraryName: string, relativePath: string): string {
  return `${libraryName}:${relativePath}`;
}

function readMarkdownResource(kind: OrchestratorResourceKind, library: OrchestratorLibraryInfo, filePath: string): DiscoveredOrchestratorResource | undefined {
  if (!library.manifest) return undefined;
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
    const name = typeof frontmatter.name === "string" && frontmatter.name.trim() ? frontmatter.name.trim() : path.basename(filePath, ".md");
    const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : undefined;
    const relativePath = relativeResourcePath(library.root, filePath);
    return {
      id: resourceId(library.manifest.name, relativePath),
      kind,
      name,
      description,
      libraryName: library.manifest.name,
      libraryPath: library.root,
      filePath,
      relativePath,
      editable: true,
      readOnly: false,
      diagnostics: [],
    };
  } catch (err: any) {
    return {
      id: resourceId(library.manifest.name, relativeResourcePath(library.root, filePath)),
      kind,
      name: path.basename(filePath, ".md"),
      libraryName: library.manifest.name,
      libraryPath: library.root,
      filePath,
      relativePath: relativeResourcePath(library.root, filePath),
      editable: false,
      readOnly: true,
      diagnostics: [{ level: "error", message: `Failed to read ${kind} resource: ${err?.message || String(err)}`, path: filePath }],
    };
  }
}

function discoverMarkdownResources(kind: OrchestratorResourceKind, library: OrchestratorLibraryInfo): DiscoveredOrchestratorResource[] {
  const dir = library.resourceDirs[kind];
  if (!dir?.exists) return [];
  return fs.readdirSync(dir.resolvedPath, { withFileTypes: true })
    .filter((entry) => (entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md"))
    .map((entry) => readMarkdownResource(kind, library, path.join(dir.resolvedPath, entry.name)))
    .filter((resource): resource is DiscoveredOrchestratorResource => !!resource)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function discoverSkillResources(library: OrchestratorLibraryInfo): DiscoveredOrchestratorResource[] {
  const dir = library.resourceDirs.skills;
  if (!library.manifest || !dir?.exists) return [];
  const resources: DiscoveredOrchestratorResource[] = [];
  const addSkill = (skillFile: string) => {
    const resource = readMarkdownResource("skills", library, skillFile);
    if (resource) resources.push(resource);
  };
  for (const entry of fs.readdirSync(dir.resolvedPath, { withFileTypes: true })) {
    const full = path.join(dir.resolvedPath, entry.name);
    if (entry.isDirectory() && fs.existsSync(path.join(full, "SKILL.md"))) addSkill(path.join(full, "SKILL.md"));
    if ((entry.isFile() || entry.isSymbolicLink()) && entry.name.endsWith(".md")) addSkill(full);
  }
  return resources.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverExtensionResources(library: OrchestratorLibraryInfo): DiscoveredOrchestratorResource[] {
  const dir = library.resourceDirs.extensions;
  if (!library.manifest || !dir?.exists) return [];
  const resources: DiscoveredOrchestratorResource[] = [];
  for (const entry of fs.readdirSync(dir.resolvedPath, { withFileTypes: true })) {
    const full = path.join(dir.resolvedPath, entry.name);
    let filePath: string | undefined;
    if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) filePath = full;
    if (entry.isDirectory()) {
      const indexTs = path.join(full, "index.ts");
      const indexJs = path.join(full, "index.js");
      if (fs.existsSync(indexTs)) filePath = indexTs;
      else if (fs.existsSync(indexJs)) filePath = indexJs;
    }
    if (!filePath) continue;
    const relativePath = relativeResourcePath(library.root, filePath);
    resources.push({
      id: resourceId(library.manifest.name, relativePath),
      kind: "extensions",
      name: entry.isDirectory() ? entry.name : path.basename(entry.name, path.extname(entry.name)),
      libraryName: library.manifest.name,
      libraryPath: library.root,
      filePath,
      relativePath,
      editable: true,
      readOnly: false,
      diagnostics: [],
    });
  }
  return resources.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverOrchestratorLibraryResources(rootPath: string): OrchestratorLibraryDiscovery {
  const library = readOrchestratorLibrary(rootPath);
  if (!library.valid || !library.manifest) return { library, resources: [], diagnostics: library.diagnostics };
  const resources = [
    ...discoverMarkdownResources("agents", library),
    ...discoverMarkdownResources("skillTemplates", library),
    ...discoverMarkdownResources("extensionTemplates", library),
    ...discoverSkillResources(library),
    ...discoverExtensionResources(library),
  ];
  const diagnostics = [...library.diagnostics, ...resources.flatMap((resource) => resource.diagnostics)];
  return { library, resources, diagnostics };
}

export function readOrchestratorLibrarySettings(repoCwd: string, paths: OrchestratorLibrarySettingsPaths = {}): OrchestratorLibrarySettingsPayload {
  const global = readLibraryScopeSettings("global", repoCwd, paths);
  const project = readLibraryScopeSettings("project", repoCwd, paths);
  return {
    global,
    project,
    libraries: [...global.libraries, ...project.libraries],
  };
}

export function updateOrchestratorLibrarySettings(
  input: { scope: OrchestratorLibrarySettingsScope; libraries: Array<string | { path: string; editable?: boolean }> },
  repoCwd: string,
  paths: OrchestratorLibrarySettingsPaths = {}
): { success: boolean; status?: number; error?: string; settings?: OrchestratorLibrarySettingsPayload } {
  if (input.scope !== "global" && input.scope !== "project") return { success: false, status: 400, error: "scope must be 'global' or 'project'" };
  if (!Array.isArray(input.libraries)) return { success: false, status: 400, error: "libraries must be an array" };

  const settingsPath = settingsPathFor(input.scope, repoCwd, paths);
  const read = readSettingsFile(settingsPath);
  if (read.parseError || read.readError) return { success: false, status: 400, error: `Cannot update ${settingsPath}: ${read.parseError || read.readError}` };

  const normalized = normalizeConfiguredLibraries(input.libraries, input.scope)
    .map((library) => library.editable === undefined ? { path: library.path } : { path: library.path, editable: library.editable });
  if (normalized.length !== input.libraries.length) return { success: false, status: 400, error: "each library entry must be a path string or object with a path string" };

  const next = { ...read.settings };
  const existingOrchestratorSettings = getOrchestratorSettings(read.settings);
  next.piAgentOrchestrator = { ...existingOrchestratorSettings, libraries: normalized };

  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
  return { success: true, settings: readOrchestratorLibrarySettings(repoCwd, paths) };
}

function isDirectoryEmpty(dir: string): boolean {
  return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
}

function classifyBootstrapScope(targetPath: string, repoCwd: string): OrchestratorLibrarySettingsScope {
  const resolved = path.resolve(repoCwd, expandTilde(targetPath));
  const relative = path.relative(path.resolve(repoCwd), resolved);
  return !relative.startsWith("..") && !path.isAbsolute(relative) ? "project" : "global";
}

function writeStarterFile(filePath: string, content: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, "utf-8");
}

export function bootstrapOrchestratorLibrary(
  input: { targetPath: string; name?: string; description?: string },
  repoCwd: string,
  paths: OrchestratorLibrarySettingsPaths = {}
): BootstrapOrchestratorLibraryResult {
  if (!input.targetPath?.trim()) return { success: false, status: 400, error: "targetPath is required" };
  const targetPath = input.targetPath.trim();
  const resolvedTarget = path.resolve(repoCwd, expandTilde(targetPath));
  if (fs.existsSync(resolvedTarget) && !fs.statSync(resolvedTarget).isDirectory()) return { success: false, status: 409, error: "target path exists and is not a directory" };
  if (!isDirectoryEmpty(resolvedTarget) && !fs.existsSync(path.join(resolvedTarget, ORCHESTRATOR_LIBRARY_MANIFEST))) {
    return { success: false, status: 409, error: "target directory is not empty and does not contain an orchestrator-library.json manifest" };
  }
  if (fs.existsSync(path.join(resolvedTarget, ORCHESTRATOR_LIBRARY_MANIFEST))) return { success: false, status: 409, error: "orchestrator library already exists at target path" };

  const defaultName = path.basename(resolvedTarget).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[._-]+|[._-]+$/g, "") || "orchestrator-library";
  const name = input.name?.trim() || defaultName;
  const nameError = validateLibraryName(name);
  if (nameError) return { success: false, status: 400, error: nameError };

  fs.mkdirSync(resolvedTarget, { recursive: true });
  const manifest = {
    schema: ORCHESTRATOR_LIBRARY_SCHEMA,
    name,
    description: input.description?.trim() || "User-owned Pi Orchestrator Library",
    compatibility: { piAgentOrchestrator: ">=0.3.0" },
    resources: { ...resourceDefaults },
  };
  writeStarterFile(path.join(resolvedTarget, ORCHESTRATOR_LIBRARY_MANIFEST), `${JSON.stringify(manifest, null, 2)}\n`);
  writeStarterFile(path.join(resolvedTarget, "README.md"), `# ${name}\n\nVersion-controlled Pi Orchestrator Library for agent types, templates, skills, and extensions.\n`);
  writeStarterFile(path.join(resolvedTarget, "agents", "example-researcher.md"), "---\nname: example-researcher\ndescription: Example researcher agent type for this Orchestrator Library.\ntools: read, bash\nskillTemplates: example-core-skills\nextensionTemplates: example-web-tools\n---\n\nYou are an example researcher agent. Use this file as a starting point for your own agent types.\n");
  writeStarterFile(path.join(resolvedTarget, "skill-templates", "example-core-skills.md"), "---\nname: example-core-skills\ndescription: Example skill template referencing a library skill.\napplyToAll: false\nskills: skills/example-analysis\n---\n");
  writeStarterFile(path.join(resolvedTarget, "extension-templates", "example-web-tools.md"), "---\nname: example-web-tools\ndescription: Example extension template referencing a library extension.\napplyToAll: false\nextensions: extensions/example-extension\n---\n");
  writeStarterFile(path.join(resolvedTarget, "skills", "example-analysis", "SKILL.md"), "---\nname: example-analysis\ndescription: Example analysis skill. Use when demonstrating Orchestrator Library skill structure.\n---\n\n# Example Analysis\n\nReplace this starter skill with your own workflow.\n");
  writeStarterFile(path.join(resolvedTarget, "extensions", "example-extension", "index.ts"), "// Example Pi extension placeholder. Replace with a real extension before assigning it to agents.\nexport default function () {\n  // no-op example\n}\n");

  const scope = classifyBootstrapScope(targetPath, repoCwd);
  const current = readOrchestratorLibrarySettings(repoCwd, paths)[scope].libraries;
  const storedPath = scope === "project" ? path.relative(repoCwd, resolvedTarget).replace(/\\/g, "/") || "." : targetPath;
  const update = updateOrchestratorLibrarySettings({ scope, libraries: [...current.map((library) => library.editable === undefined ? library.path : { path: library.path, editable: library.editable }), storedPath] }, repoCwd, paths);
  if (!update.success) return { success: false, status: update.status, error: update.error };
  return { success: true, scope, library: readOrchestratorLibrary(resolvedTarget), settings: update.settings };
}

export function discoverConfiguredOrchestratorLibraries(repoCwd: string, paths: OrchestratorLibrarySettingsPaths = {}): OrchestratorLibrariesDiscovery {
  const settings = readOrchestratorLibrarySettings(repoCwd, paths);
  const rootPaths = settings.libraries.map((library) => resolveConfiguredLibraryPath(library, repoCwd));
  const set = readOrchestratorLibraries(rootPaths);
  const resources: DiscoveredOrchestratorResource[] = [];
  const diagnostics = [...set.diagnostics];

  for (const library of set.libraries) {
    if (!library.valid || !library.manifest) continue;
    const discovery = discoverOrchestratorLibraryResources(library.root);
    resources.push(...discovery.resources);
    diagnostics.push(...discovery.diagnostics.filter((diagnostic) => !diagnostics.includes(diagnostic)));
  }

  return {
    libraries: set.libraries,
    resources,
    diagnostics,
    valid: set.valid && diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  };
}

export function readOrchestratorLibraries(rootPaths: string[]): OrchestratorLibrarySet {
  const libraries = rootPaths.map((rootPath) => readOrchestratorLibrary(rootPath));
  const diagnostics = libraries.flatMap((library) => library.diagnostics);
  const byName = new Map<string, OrchestratorLibraryInfo>();

  for (const library of libraries) {
    const name = library.manifest?.name;
    if (!name) continue;
    const existing = byName.get(name);
    if (!existing) {
      byName.set(name, library);
      continue;
    }
    const message = `Duplicate Orchestrator Library namespace '${name}' found at ${existing.root} and ${library.root}`;
    const duplicateDiagnostic: OrchestratorLibraryDiagnostic = { level: "error", message, path: library.manifestPath };
    diagnostics.push(duplicateDiagnostic);
    library.diagnostics.push(duplicateDiagnostic);
    library.valid = false;
  }

  return {
    libraries,
    diagnostics,
    valid: libraries.every((library) => library.valid) && diagnostics.every((diagnostic) => diagnostic.level !== "error"),
  };
}
