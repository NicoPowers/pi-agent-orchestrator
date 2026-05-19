import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";
import { type ChildProcess } from "node:child_process";

export const LOG_FILE = path.join(os.tmpdir(), "pi-multi-agent.log");

export function log(tag: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const payload = extra !== undefined ? ` ${JSON.stringify(extra)}` : "";
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] [${tag}] ${msg}${payload}\n`);
  } catch {
    /* ignore */
  }
}

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

export type AgentClass = "lead" | "scout" | "implementer" | "reviewer" | "orchestrator";

export interface AgentDefinition {
  name: string;
  description: string;
  agentClass?: AgentClass;
  model?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  tools?: string[];
  skills?: string[];
  skillTemplates?: string[];
  extensionTemplates?: string[];
  systemPrompt: string;
  source: "user" | "project" | "package";
  readOnly?: boolean;
  example?: boolean;
  filePath: string;
}

export interface Agent {
  id: string;
  proc: ChildProcess;
  stdin: NodeJS.WritableStream;
  status: "idle" | "streaming" | "error" | "exited";
  accumulatedText: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  events: Array<{ ts: number; type: string; event: any }>;
  buffer: string;
  definition?: AgentDefinition;
  worktreePath: string;
  parent?: string;
  children: string[];
  runtimeTools?: RuntimeToolSnapshot;
  _currentSend?: Promise<void>;
  _nextTurn?: { resolve: () => void; reject: (e: Error) => void };
  _rpcRequests?: Map<string, { resolve: (data: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }>;
  _turnTimer?: NodeJS.Timeout;
}

export interface PendingTask {
  name: string;
  message: string;
  startTime: number;
}

export const agents = new Map<string, Agent>();
export const pendingTasks = new Map<string, PendingTask>();
