// Shared types between server and dashboard

export interface RuntimeToolInfo {
  name: string;
  description?: string;
  sourceInfo?: unknown;
}

export interface RuntimeToolConflict {
  name: string;
  count: number;
  sources: string[];
}

export interface RuntimeToolSnapshot {
  active: RuntimeToolInfo[];
  all: RuntimeToolInfo[];
  reportedAt: number;
  source: "child-agent";
  conflicts?: RuntimeToolConflict[];
}

export interface AgentInfo {
  name: string;
  status: "idle" | "streaming" | "error" | "exited";
  definition?: string;
  parent?: string;
  children: string[];
  turns: number;
  worktree: string;
  runtimeTools?: RuntimeToolSnapshot;
  text?: string;
}

export interface AgentTypeInfo {
  name: string;
  description: string;
  agentClass?: "lead" | "scout" | "implementer" | "reviewer" | "orchestrator";
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools?: string[];
  skills?: string[];
  skillTemplates?: string[];
  extensionTemplates?: string[];
  source: string;
  readOnly?: boolean;
  example?: boolean;
}

export interface ModelInfo {
  provider: string;
  id: string;
  context: string;
  maxOut: string;
  thinking: boolean;
  images: boolean;
  thinkingLevels?: Array<"off" | "minimal" | "low" | "medium" | "high" | "xhigh">;
}

export interface SkillInfo {
  id?: string;
  name: string;
  description?: string;
  path: string;
  filePath?: string;
  baseDir?: string;
  source?: string;
  scope?: string;
  kind?: "directory" | "file";
  audience?: "spawned" | "orchestrator" | "all";
  editable?: boolean;
  packageProvided?: boolean;
  ref?: string;
}

export interface SkillDetailInfo {
  skill: SkillInfo;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
  hash: string;
}

export interface ExtensionInfo {
  name: string;
  scope: string;
  description?: string;
  expectedTools?: string[];
  metadataStatus?: "provided" | "unknown" | "invalid";
  metadataSource?: string;
}

export interface ExtensionTemplateSmokeTestResult {
  success: boolean;
  template: string;
  extensions: Array<{ name: string; path: string; scope?: string }>;
  missingExtensions: string[];
  runtimeTools?: RuntimeToolSnapshot;
  diagnostics: Array<{ level: "error" | "warning" | "info"; message: string }>;
  stderrTail?: string;
  smokeAgent?: { id: string; definition: string; model?: string; worktree?: string };
}

export interface RootProfileInfo {
  name: string;
  description: string;
  skills?: string[];
  skillTemplates?: string[];
  instructions: string;
  source: "user" | "project" | "package" | "orchestrator-library";
  scope?: string;
  filePath: string;
  readOnly?: boolean;
}

export interface RootProfileDetailInfo {
  profile: RootProfileInfo;
  content: string;
  frontmatter: Record<string, unknown>;
  body: string;
  mtimeMs: number;
  hash: string;
}

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
  scope: "global" | "project";
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

export interface ResourceSettingsInfo {
  global: ResourceScopeSettings;
  project: ResourceScopeSettings;
}

export interface OrchestratorLibraryDiagnosticInfo {
  level: "error" | "warning";
  message: string;
  path?: string;
}

export interface OrchestratorLibraryInfo {
  root: string;
  manifestPath: string;
  manifest?: {
    schema: string;
    name: string;
    description?: string;
    compatibility?: Record<string, unknown>;
    resources: Record<string, string>;
  };
  diagnostics: OrchestratorLibraryDiagnosticInfo[];
  valid: boolean;
}

export interface OrchestratorLibraryResourceInfo {
  id: string;
  kind: "agents" | "skillTemplates" | "extensionTemplates" | "skills" | "extensions";
  name: string;
  description?: string;
  libraryName: string;
  libraryPath: string;
  filePath: string;
  relativePath: string;
  editable: boolean;
  readOnly: boolean;
  diagnostics: OrchestratorLibraryDiagnosticInfo[];
}

export interface OrchestratorDisplaySettingsInfo {
  showPackageExamples: boolean;
  settingsPath: string;
  exists: boolean;
  parseError?: string;
  readError?: string;
}

export interface OrchestratorLibrariesInfo {
  libraries: OrchestratorLibraryInfo[];
  resources: OrchestratorLibraryResourceInfo[];
  diagnostics: OrchestratorLibraryDiagnosticInfo[];
  valid: boolean;
  settings: OrchestratorDisplaySettingsInfo;
}

export type ServerEvent =
  | { type: "init"; data: { agents: Record<string, AgentInfo> } }
  | { type: "agent-spawned"; data: AgentInfo }
  | { type: "agent-killed"; data: { name: string } }
  | { type: "agent-start"; data: { name: string } }
  | { type: "agent-end"; data: { name: string; text: string } }
  | { type: "agent-error"; data: { name: string; error: string } }
  | { type: "agent-exit"; data: { name: string; code?: number | null } }
  | { type: "agent-delta"; data: { name: string; delta: string } }
  | { type: "delegate"; data: { from: string; to: string; task: string } };
