import { type ExtensionAPI, type ExtensionContext, getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// ── Agent instance tracking ──

interface Agent {
  id: string;
  proc: ChildProcess;
  stdin: NodeJS.WritableStream;
  status: "idle" | "streaming" | "error" | "exited";
  accumulatedText: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  buffer: string;
  definition?: AgentDefinition;
  _currentSend?: Promise<void>;
  _nextTurn?: { resolve: () => void; reject: (e: Error) => void };
  _turnTimer?: NodeJS.Timeout;
}

const agents = new Map<string, Agent>();

// ── Agent definition types (frontmatter + body) ──

interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  tools?: string[];
  skills?: string[];        // resolved absolute paths to skill dirs
  systemPrompt: string;     // markdown body after frontmatter
  source: "user" | "project" | "package";
  filePath: string;
}

// ── Persistent file logging (doesn't pollute the TUI) ──

const LOG_FILE = path.join(os.tmpdir(), "pi-multi-agent.log");

function log(tag: string, msg: string, extra?: unknown) {
  const ts = new Date().toISOString();
  const payload = extra !== undefined ? ` ${JSON.stringify(extra)}` : "";
  try {
    fs.appendFileSync(LOG_FILE, `[${ts}] [${tag}] ${msg}${payload}\n`);
  } catch {
    /* ignore */
  }
}

// ── Definition discovery ──

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

// Resolve the package's built-in agents/ directory relative to this extension file.
// Works when installed via git, npm, or loaded from a local path.
function getPackageAgentsDir(): string | null {
  try {
    const extDir = __dirname;
    const candidate = path.join(extDir, "..", "agents");
    if (isDirectory(candidate)) return candidate;
  } catch {
    /* __dirname may not be available in some loaders */
  }
  return null;
}

function resolveSkillPath(raw: string, agentFileDir: string, cwd: string): string {
  if (path.isAbsolute(raw)) return raw;

  // 1. Relative to agent definition file
  const relativeToAgent = path.resolve(agentFileDir, raw);
  if (fs.existsSync(relativeToAgent)) return relativeToAgent;

  // 2. Relative to cwd
  const relativeToCwd = path.resolve(cwd, raw);
  if (fs.existsSync(relativeToCwd)) return relativeToCwd;

  // 3. Search Pi global skill dirs by bare name
  const globalSkill = path.join(getAgentDir(), "skills", raw);
  if (fs.existsSync(globalSkill)) return globalSkill;

  const globalSkillAlt = path.join(os.homedir(), ".agents", "skills", raw);
  if (fs.existsSync(globalSkillAlt)) return globalSkillAlt;

  // 4. Search project skill dirs by bare name
  const projectSkill = path.join(cwd, ".pi", "skills", raw);
  if (fs.existsSync(projectSkill)) return projectSkill;

  const projectSkillAlt = path.join(cwd, ".agents", "skills", raw);
  if (fs.existsSync(projectSkillAlt)) return projectSkillAlt;

  // Fallback to cwd-relative (will fail at spawn time if invalid)
  return relativeToCwd;
}

function loadDefinitionsFromDir(dir: string, source: "user" | "project", cwd: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  if (!fs.existsSync(dir)) return defs;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return defs;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const skills = frontmatter.skills
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolveSkillPath(s, dir, cwd));

    defs.push({
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model,
      tools: tools && tools.length > 0 ? tools : undefined,
      skills: skills && skills.length > 0 ? skills : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return defs;
}

function discoverDefinitions(cwd: string): AgentDefinition[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findProjectAgentsDir(cwd);
  const packageDir = getPackageAgentsDir();

  const userDefs = loadDefinitionsFromDir(userDir, "user", cwd);
  const projectDefs = projectDir ? loadDefinitionsFromDir(projectDir, "project", cwd) : [];
  const packageDefs = packageDir ? loadDefinitionsFromDir(packageDir, "package", cwd) : [];

  const map = new Map<string, AgentDefinition>();
  // Package defs are the base defaults
  for (const d of packageDefs) map.set(d.name, d);
  // User defs override package defaults
  for (const d of userDefs) map.set(d.name, d);
  // Project defs have the highest priority
  for (const d of projectDefs) map.set(d.name, d);

  return Array.from(map.values());
}

function getDefinition(name: string, cwd: string): AgentDefinition | undefined {
  return discoverDefinitions(cwd).find((d) => d.name === name);
}

// ── UI panel (widget below editor + footer status) ──

let currentCtx: ExtensionContext | undefined;

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
let spinnerIndex = 0;
let spinnerTimer: NodeJS.Timeout | undefined;

function ensureSpinner() {
  if (spinnerTimer) return;
  spinnerTimer = setInterval(() => {
    spinnerIndex = (spinnerIndex + 1) % SPINNER_FRAMES.length;
    refreshPanel();
  }, 120);
}

function stopSpinnerIfIdle() {
  const anyStreaming = Array.from(agents.values()).some((a) => a.status === "streaming");
  if (!anyStreaming && spinnerTimer) {
    clearInterval(spinnerTimer);
    spinnerTimer = undefined;
  }
}

function refreshPanel() {
  if (!currentCtx?.hasUI) return;
  const theme = currentCtx.ui.theme;
  const lines: string[] = [];

  if (agents.size === 0) {
    lines.push(theme.fg("dim", "No subagents"));
  } else {
    const parts: string[] = [];
    for (const [name, agent] of agents) {
      const defName = agent.definition?.name ? ` (${agent.definition.name})` : "";
      if (agent.status === "streaming") {
        const frame = theme.fg("accent", SPINNER_FRAMES[spinnerIndex]);
        parts.push(`${frame} ${theme.fg("warning", name)}${theme.fg("dim", defName)}`);
      } else if (agent.status === "idle") {
        parts.push(`${theme.fg("success", "●")} ${theme.fg("dim", name)}${theme.fg("dim", defName)}`);
      } else {
        parts.push(`${theme.fg("error", "○")} ${theme.fg("dim", name)}${theme.fg("dim", defName)}`);
      }
    }
    lines.push(parts.join("  "));
  }

  currentCtx.ui.setWidget("multi-agent", lines, { placement: "belowEditor" });

  const alive = Array.from(agents.values()).filter((a) => a.status === "idle" || a.status === "streaming").length;
  const working = Array.from(agents.values()).filter((a) => a.status === "streaming").length;
  const statusText = agents.size
    ? `${alive}/${agents.size} agents${working ? ` (${working} working)` : ""}`
    : "";
  currentCtx.ui.setStatus("multi-agent", theme.fg("dim", statusText));
}

function clearPanel() {
  if (!currentCtx?.hasUI) return;
  currentCtx.ui.setWidget("multi-agent", undefined);
  currentCtx.ui.setStatus("multi-agent", undefined);
}

// ── Spawn helper ──

function getPiInvocation(args: string[]): { command: string; args: string[] } {
  const currentScript = process.argv[1];
  const isBunVirtualScript = currentScript?.startsWith("/$bunfs/root/");
  if (currentScript && !isBunVirtualScript && fs.existsSync(currentScript)) {
    return { command: process.execPath, args: [currentScript, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  const isGenericRuntime = /^(node|bun)(\.exe)?$/.test(execName);
  if (!isGenericRuntime) {
    return { command: process.execPath, args };
  }
  return { command: "pi", args };
}

async function writeTempPrompt(name: string, prompt: string): Promise<string> {
  const tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "pi-subagent-"));
  const safeName = name.replace(/[^\w.-]+/g, "_");
  const filePath = path.join(tmpDir, `prompt-${safeName}.md`);
  await fs.promises.writeFile(filePath, prompt, { encoding: "utf-8", mode: 0o600 });
  return filePath;
}

function spawnAgent(
  id: string,
  options: { model?: string; cwd?: string; definition?: AgentDefinition } = {}
): Agent {
  const { model, cwd, definition } = options;
  const effectiveModel = definition?.model || model;
  const effectiveTools = definition?.tools;

  const invocationArgs = ["--mode", "rpc", "--no-session"];
  if (effectiveModel) invocationArgs.push("--model", effectiveModel);
  if (effectiveTools && effectiveTools.length > 0) invocationArgs.push("--tools", effectiveTools.join(","));

  let tmpPromptPath: string | null = null;

  if (definition?.systemPrompt?.trim()) {
    // Replace template variables and write to temp file
    const filledPrompt = definition.systemPrompt
      .replace(/\{\{name\}\}/g, id)
      .replace(/\{\{type\}\}/g, definition.name);
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-subagent-"));
    const safeName = `${id}_${definition.name}`.replace(/[^\w.-]+/g, "_");
    tmpPromptPath = path.join(tmpDir, `prompt-${safeName}.md`);
    fs.writeFileSync(tmpPromptPath, filledPrompt, { encoding: "utf-8", mode: 0o600 });
    invocationArgs.push("--system-prompt", tmpPromptPath);
  }

  if (definition?.skills) {
    invocationArgs.push("--no-skills");
    for (const skillPath of definition.skills) {
      invocationArgs.push("--skill", skillPath);
    }
  }

  log("spawn", `Starting agent '${id}'`, { command: "pi", args: invocationArgs });

  const invocation = getPiInvocation(invocationArgs);
  const proc = spawn(invocation.command, invocation.args, {
    cwd: cwd || process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
    env: process.env,
  });

  log("spawn", `Agent '${id}' process started (pid=${proc.pid})`);

  const agent: Agent = {
    id,
    proc,
    stdin: proc.stdin!,
    status: "idle",
    accumulatedText: "",
    history: [],
    buffer: "",
    definition,
  };

  const flush = () => {
    const lines = agent.buffer.split("\n");
    agent.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "agent_start") {
          agent.status = "streaming";
          agent.accumulatedText = "";
          ensureSpinner();
          refreshPanel();
        } else if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta" && typeof delta.delta === "string") {
            agent.accumulatedText += delta.delta;
          }
        } else if (event.type === "agent_end") {
          agent.status = "idle";
          const msgs = event.messages || [];
          const lastAssistant = [...msgs].reverse().find((m: any) => m.role === "assistant");
          if (lastAssistant) {
            const text =
              lastAssistant.content
                ?.filter((c: any) => c.type === "text")
                .map((c: any) => c.text)
                .join("") || "";
            if (text && !agent.accumulatedText) agent.accumulatedText = text;
          }
          agent.history.push({ role: "assistant", text: agent.accumulatedText });
          if (agent._nextTurn) {
            agent._nextTurn.resolve();
            agent._nextTurn = undefined;
          }
          stopSpinnerIfIdle();
          refreshPanel();
        }
      } catch (e) {
        log("rpc", `Agent '${id}' malformed JSON line`, line.slice(0, 200));
      }
    }
  };

  proc.stdout!.on("data", (data: Buffer) => {
    agent.buffer += data.toString();
    flush();
  });

  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString().trim();
    if (text) log("rpc", `Agent '${id}' STDERR`, text);
  });

  proc.on("close", (code) => {
    log("spawn", `Agent '${id}' process closed`, { code });
    agent.status = "exited";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' exited with code ${code}`));
      agent._nextTurn = undefined;
    }
    stopSpinnerIfIdle();
    refreshPanel();
    if (tmpPromptPath) {
      try { fs.unlinkSync(tmpPromptPath); } catch { /* ignore */ }
      try { fs.rmdirSync(path.dirname(tmpPromptPath)); } catch { /* ignore */ }
    }
  });

  proc.on("error", (err) => {
    log("spawn", `Agent '${id}' process error`, err.message);
    agent.status = "error";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' process error: ${err.message}`));
      agent._nextTurn = undefined;
    }
    stopSpinnerIfIdle();
    refreshPanel();
  });

  return agent;
}

// ── Send helper ──

async function sendToAgent(agent: Agent, message: string, timeoutMs: number, signal?: AbortSignal): Promise<void> {
  log("send", `Agent '${agent.id}' queuing send`);
  while (agent._currentSend) {
    if (signal?.aborted) throw new Error("Aborted");
    try {
      await agent._currentSend;
    } catch {
      /* ignore previous errors */
    }
  }

  const perform = async () => {
    if (agent.status === "error" || agent.status === "exited") {
      throw new Error(`Agent is ${agent.status}`);
    }

    agent.history.push({ role: "user", text: message });
    agent.accumulatedText = "";

    const cmd = { type: "prompt", message };
    agent.stdin.write(JSON.stringify(cmd) + "\n");
    log("send", `Agent '${agent.id}' prompt written`);

    await new Promise<void>((resolve, reject) => {
      agent._nextTurn = { resolve, reject };
      agent._turnTimer = setTimeout(() => {
        reject(new Error(`Timeout after ${timeoutMs}ms`));
      }, timeoutMs);

      if (signal) {
        signal.addEventListener(
          "abort",
          () => {
            reject(new Error("Aborted"));
          },
          { once: true },
        );
      }
    });

    if (agent._turnTimer) {
      clearTimeout(agent._turnTimer);
      agent._turnTimer = undefined;
    }
    agent._nextTurn = undefined;
    log("send", `Agent '${agent.id}' send resolved`);
  };

  agent._currentSend = perform();
  try {
    await agent._currentSend;
  } finally {
    agent._currentSend = undefined;
  }
}

// ── Extension export ──

export default function (pi: ExtensionAPI) {
  log("init", "multi-agent extension loaded");

  pi.on("session_start", (_event, ctx) => {
    currentCtx = ctx;
    refreshPanel();
  });

  pi.on("session_shutdown", () => {
    log("lifecycle", "session_shutdown -> killing all child agents");
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = undefined;
    }
    for (const [, agent] of agents) {
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");
    }
    agents.clear();
    clearPanel();
  });

  // ====== TOOLS ======

  pi.registerTool({
    name: "agent_types",
    label: "Agent Types",
    description: "List available agent definitions discovered from ~/.pi/agent/agents and .pi/agents.",
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const defs = discoverDefinitions(ctx.cwd);
      const lines = defs.map((d) => {
        const skills = d.skills ? ` [skills: ${d.skills.length}]` : "";
        const tools = d.tools ? ` [tools: ${d.tools.join(",")}]` : "";
        return `- ${d.name} (${d.source}): ${d.description}${tools}${skills}`;
      });
      return {
        content: [
          {
            type: "text",
            text: defs.length
              ? `Available agent types:\n${lines.join("\n")}`
              : "No agent definitions found. Create markdown files in ~/.pi/agent/agents/ or .pi/agents/",
          },
        ],
        details: { definitions: defs.map((d) => ({ name: d.name, source: d.source, description: d.description })) },
      };
    },
  });

  pi.registerTool({
    name: "agent_spawn",
    label: "Spawn Agent",
    description: [
      "Spawn a named sub-agent as a persistent Pi RPC process.",
      "If 'type' is provided, looks up an agent definition from ~/.pi/agent/agents/ or .pi/agents/",
      "and applies its model, tools, skills, and system prompt. Otherwise uses raw parameters.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Unique instance name, e.g. 'coder_1'" }),
      type: Type.Optional(Type.String({ description: "Agent definition name, e.g. 'coder' or 'reviewer'" })),
      model: Type.Optional(Type.String({ description: "Override model pattern" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      log("tool", `agent_spawn called`, { name: params.name, type: params.type, model: params.model });
      currentCtx = ctx;

      if (agents.has(params.name)) {
        return {
          content: [{ type: "text", text: `Agent '${params.name}' already exists.` }],
          isError: true,
          details: {},
        };
      }

      let definition: AgentDefinition | undefined;
      if (params.type) {
        definition = getDefinition(params.type, ctx.cwd);
        if (!definition) {
          const available = discoverDefinitions(ctx.cwd).map((d) => d.name).join(", ") || "none";
          return {
            content: [
              {
                type: "text",
                text: `Agent type '${params.type}' not found. Available: ${available}`,
              },
            ],
            isError: true,
            details: {},
          };
        }
      }

      // Allow raw model override even when using a definition
      const spawnOptions: Parameters<typeof spawnAgent>[1] = {
        cwd: ctx.cwd,
        definition,
      };
      if (params.model) spawnOptions.model = params.model;

      const agent = spawnAgent(params.name, spawnOptions);
      agents.set(params.name, agent);
      await new Promise((r) => setTimeout(r, 600));
      refreshPanel();

      if (agent.status === "error" || agent.status === "exited") {
        agents.delete(params.name);
        return {
          content: [
            { type: "text", text: `Failed to spawn agent '${params.name}'. Is 'pi' in your PATH?` },
          ],
          isError: true,
          details: {},
        };
      }

      const defInfo = definition ? ` (type: ${definition.name}, source: ${definition.source})` : "";
      const skillInfo = definition?.skills ? `, skills: ${definition.skills.length}` : "";
      return {
        content: [
          {
            type: "text",
            text: `Spawned agent '${params.name}'${defInfo}${skillInfo} (status: ${agent.status}).`,
          },
        ],
        details: {
          name: params.name,
          status: agent.status,
          definition: definition
            ? { name: definition.name, model: definition.model, tools: definition.tools, skills: definition.skills }
            : undefined,
        },
      };
    },
  });

  pi.registerTool({
    name: "agent_send",
    label: "Send to Agent",
    description: [
      "Send a message to a spawned agent and wait for its response.",
      "Agents process one message at a time. Returns the agent's final text.",
      "To relay between agents: read one agent's reply, then agent_send it to another.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
      message: Type.String({ description: "Message to send. Be explicit about the task." }),
      timeout_seconds: Type.Optional(Type.Number({ default: 300 })),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      log("tool", `agent_send called`, { name: params.name });
      currentCtx = ctx;
      const agent = agents.get(params.name);
      if (!agent) {
        return {
          content: [
            { type: "text", text: `Agent '${params.name}' not found. Use agent_status to list agents.` },
          ],
          isError: true,
          details: {},
        };
      }
      try {
        await sendToAgent(agent, params.message, (params.timeout_seconds || 300) * 1000, signal);
        log("tool", `agent_send result`, { name: params.name, length: agent.accumulatedText.length });
        return {
          content: [{ type: "text", text: agent.accumulatedText || "(agent returned empty response)" }],
          details: {
            name: params.name,
            status: agent.status,
            turns: Math.floor(agent.history.length / 2),
          },
        };
      } catch (err: any) {
        log("tool", `agent_send error`, { name: params.name, error: err.message });
        return {
          content: [{ type: "text", text: `Error: ${err.message}` }],
          isError: true,
          details: {},
        };
      }
    },
  });

  pi.registerTool({
    name: "agent_status",
    label: "Agent Status",
    description: "Check the status of all spawned agents or one specific agent.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Optional agent instance name. Omit to list all." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      if (params.name) {
        const agent = agents.get(params.name);
        if (!agent)
          return {
            content: [{ type: "text", text: `Agent '${params.name}' not found.` }],
            isError: true,
            details: {},
          };
        const last = agent.history[agent.history.length - 1];
        const def = agent.definition ? ` [type: ${agent.definition.name}]` : "";
        return {
          content: [
            {
              type: "text",
              text: `Agent '${params.name}'${def}: ${agent.status}, turns: ${Math.floor(agent.history.length / 2)}\nLast: ${last?.text.slice(0, 200) || "(none)"}`,
            },
          ],
          details: {
            name: agent.id,
            status: agent.status,
            turns: Math.floor(agent.history.length / 2),
            last_response: agent.accumulatedText,
          },
        };
      }
      const list = Array.from(agents.entries()).map(([name, a]) => ({
        name,
        status: a.status,
        type: a.definition?.name,
        turns: Math.floor(a.history.length / 2),
      }));
      return {
        content: [
          { type: "text", text: list.length ? JSON.stringify(list, null, 2) : "No active agents." },
        ],
        details: { agents: list },
      };
    },
  });

  pi.registerTool({
    name: "agent_kill",
    label: "Kill Agent",
    description: "Terminate a spawned agent process immediately.",
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      currentCtx = ctx;
      const agent = agents.get(params.name);
      if (!agent)
        return {
          content: [{ type: "text", text: `Agent '${params.name}' not found.` }],
          isError: true,
          details: {},
        };
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");
      setTimeout(() => {
        if (!agent.proc.killed) agent.proc.kill("SIGKILL");
      }, 3000);
      agents.delete(params.name);
      stopSpinnerIfIdle();
      refreshPanel();
      return {
        content: [{ type: "text", text: `Killed agent '${params.name}'.` }],
        details: {},
      };
    },
  });

  // ====== COMMANDS ======

  pi.registerCommand("agent-types", {
    description: "List available agent definitions",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      const defs = discoverDefinitions(ctx.cwd);
      const lines = defs.map((d) => `- ${d.name} (${d.source}): ${d.description}`);
      ctx.ui.notify(defs.length ? lines.join("\n") : "No agent definitions found.", "info");
    },
  });

  pi.registerCommand("spawn", {
    description: "Spawn a named agent. Usage: /spawn <name> [type|model]",
    handler: async (args, ctx) => {
      const [name, typeOrModel] = args.trim().split(/\s+/);
      currentCtx = ctx;
      if (!name) {
        ctx.ui.notify("Usage: /spawn <name> [type|model]", "error");
        return;
      }
      if (agents.has(name)) {
        ctx.ui.notify(`Agent '${name}' already exists.`, "warning");
        return;
      }

      let definition: AgentDefinition | undefined;
      let overrideModel: string | undefined;

      if (typeOrModel) {
        definition = getDefinition(typeOrModel, ctx.cwd);
        if (!definition) {
          // Treat as raw model
          overrideModel = typeOrModel;
        }
      }

      const agent = spawnAgent(name, { cwd: ctx.cwd, definition, model: overrideModel });
      agents.set(name, agent);
      await new Promise((r) => setTimeout(r, 500));
      refreshPanel();
      const defInfo = definition ? ` (type: ${definition.name})` : "";
      ctx.ui.notify(`Spawned agent '${name}'${defInfo} (${agent.status}).`, "info");
    },
  });

  pi.registerCommand("ask", {
    description: "Send a message to an agent and show its reply. Usage: /ask <name> <message>",
    handler: async (args, ctx) => {
      const space = args.indexOf(" ");
      if (space === -1) {
        ctx.ui.notify("Usage: /ask <name> <message>", "error");
        return;
      }
      const name = args.slice(0, space);
      const message = args.slice(space + 1);
      currentCtx = ctx;
      const agent = agents.get(name);
      if (!agent) {
        ctx.ui.notify(`Agent '${name}' not found.`, "error");
        return;
      }
      try {
        await sendToAgent(agent, message, 300_000);
        pi.sendMessage({
          customType: "agent-reply",
          content: `**${name}:**\n${agent.accumulatedText}`,
          display: true,
        });
      } catch (err: any) {
        ctx.ui.notify(err.message, "error");
      }
    },
  });

  pi.registerCommand("agents", {
    description: "List all spawned agents",
    handler: async (_args, ctx) => {
      currentCtx = ctx;
      const list =
        Array.from(agents.entries())
          .map(([n, a]) => {
            const t = a.definition ? ` (${a.definition.name})` : "";
            return `${n}${t}: ${a.status}`;
          })
          .join(", ") || "none";
      ctx.ui.notify(`Agents: ${list}`, "info");
    },
  });

  pi.registerCommand("kill", {
    description: "Kill a spawned agent. Usage: /kill <name>",
    handler: async (name, ctx) => {
      currentCtx = ctx;
      const agent = agents.get(name);
      if (!agent) {
        ctx.ui.notify(`Agent '${name}' not found.`, "error");
        return;
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");
      agents.delete(name);
      stopSpinnerIfIdle();
      refreshPanel();
      ctx.ui.notify(`Killed agent '${name}'.`, "info");
    },
  });
}
