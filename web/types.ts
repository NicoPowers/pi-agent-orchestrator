// Shared types between server and dashboard

export interface AgentInfo {
  name: string;
  status: "idle" | "streaming" | "error" | "exited";
  definition?: string;
  parent?: string;
  children: string[];
  turns: number;
  worktree: string;
  text?: string;
}

export interface AgentTypeInfo {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  source: string;
}

export interface ExtensionInfo {
  name: string;
  scope: string;
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
