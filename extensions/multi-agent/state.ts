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

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  systemPrompt: string;
  source: "user" | "project" | "package";
  filePath: string;
}

export interface Agent {
  id: string;
  proc: ChildProcess;
  stdin: NodeJS.WritableStream;
  status: "idle" | "streaming" | "error" | "exited";
  accumulatedText: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  buffer: string;
  definition?: AgentDefinition;
  worktreePath: string;
  parent?: string;
  children: string[];
  _currentSend?: Promise<void>;
  _nextTurn?: { resolve: () => void; reject: (e: Error) => void };
  _turnTimer?: NodeJS.Timeout;
}

export interface PendingTask {
  name: string;
  message: string;
  startTime: number;
}

export const agents = new Map<string, Agent>();
export const pendingTasks = new Map<string, PendingTask>();
