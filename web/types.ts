// Shared types between server and dashboard

export interface RuntimeToolInfo {
  name: string;
  description?: string;
  sourceInfo?: unknown;
}

export interface RuntimeToolSnapshot {
  active: RuntimeToolInfo[];
  all: RuntimeToolInfo[];
  reportedAt: number;
  source: "child-agent";
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
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools?: string[];
  skills?: string[];
  skillTemplates?: string[];
  extensionTemplates?: string[];
  source: string;
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
  editable?: boolean;
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
