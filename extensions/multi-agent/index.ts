import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import { agents, pendingTasks, log, LOG_FILE } from "./state.js";
import { discoverDefinitions, getDefinition } from "./definitions.js";
import { discoverExtensions } from "./ext-discovery.js";
import { spawnAgent } from "./spawn.js";
import { sendToAgent } from "./send.js";
import { removeWorktree, cleanupOrphanedWorktrees } from "./worktree.js";
import { startServer, broadcast } from "./server.js";

let serverHandle: { url: string; stop: () => void } | undefined;

export default function (pi: ExtensionAPI) {
  log("init", "multi-agent extension loaded");

  cleanupOrphanedWorktrees();

  async function ensureServer(cwd: string) {
    if (serverHandle) return;
    try {
      serverHandle = await startServer({
        repoCwd: cwd,
        spawnAgent,
        sendToAgent,
        removeWorktree,
        discoverDefinitions,
        getDefinition,
        discoverExtensions,
      });
      console.log(`🌐 Dashboard: ${serverHandle.url}`);
    } catch (err: any) {
      log("server", `Failed to start dashboard server: ${err.message}`);
      console.error(`[multi-agent] Dashboard server failed: ${err.message}`);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    if (serverHandle) {
      serverHandle.stop();
      serverHandle = undefined;
    }
    await ensureServer(ctx.cwd);
  });

  pi.on("session_shutdown", async () => {
    log("lifecycle", "session_shutdown -> killing all child agents and removing worktrees");
    if (serverHandle) {
      serverHandle.stop();
      serverHandle = undefined;
    }
    for (const [, agent] of agents) {
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");
    }
    await new Promise((r) => setTimeout(r, 500));
    for (const [, agent] of agents) {
      await removeWorktree(agent.worktreePath);
    }
    agents.clear();
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
              : "No agent definitions found.",
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
      "Spawn a named sub-agent as a persistent Pi RPC process inside a bwrap sandbox.",
      "Root agents (parent='self') get a new git worktree. Sub-agents share their parent's worktree.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Unique instance name, e.g. 'lead' or 'scout_1'" }),
      type: Type.Optional(Type.String({ description: "Agent definition name, e.g. 'coder'" })),
      model: Type.Optional(Type.String({ description: "Override model pattern" })),
      parent: Type.String({ description: "Parent agent name, or 'self' for root agents" }),
      extensions: Type.Optional(Type.Array(Type.String(), { description: "Extension names to load in the agent" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      log("tool", `agent_spawn called`, { name: params.name, type: params.type, parent: params.parent });

      if (agents.has(params.name)) {
        return {
          content: [{ type: "text", text: `Agent '${params.name}' already exists.` }],
          isError: true,
          details: {},
        };
      }

      let definition = params.type ? getDefinition(params.type, ctx.cwd) : undefined;
      if (params.type && !definition) {
        const available = discoverDefinitions(ctx.cwd).map((d) => d.name).join(", ") || "none";
        return {
          content: [
            { type: "text", text: `Agent type '${params.type}' not found. Available: ${available}` },
          ],
          isError: true,
          details: {},
        };
      }

      let worktreePath: string | undefined;
      if (params.parent !== "self") {
        const parentAgent = agents.get(params.parent);
        if (!parentAgent) {
          return {
            content: [{ type: "text", text: `Parent agent '${params.parent}' not found.` }],
            isError: true,
            details: {},
          };
        }
        worktreePath = parentAgent.worktreePath;
        parentAgent.children.push(params.name);
      }

      const allExts = discoverExtensions(ctx.cwd);
      const extensions = (params.extensions || [])
        .map((n: string) => allExts.find((e) => e.name === n))
        .filter((e): e is NonNullable<typeof e> => e !== undefined);

      const result = await spawnAgent(params.name, {
        model: params.model,
        repoCwd: ctx.cwd,
        definition,
        parent: params.parent === "self" ? undefined : params.parent,
        worktreePath,
        extensions,
      });

      if (result.error || !result.agent) {
        return {
          content: [{ type: "text", text: result.error || "Unknown spawn error" }],
          isError: true,
          details: {},
        };
      }

      agents.set(params.name, result.agent);
      await new Promise((r) => setTimeout(r, 1000));

      if (result.agent.status === "error" || result.agent.status === "exited") {
        agents.delete(params.name);
        await removeWorktree(result.agent.worktreePath);
        return {
          content: [
            { type: "text", text: `Failed to spawn agent '${params.name}'. Check logs.` },
          ],
          isError: true,
          details: {},
        };
      }

      const defInfo = definition ? ` (type: ${definition.name})` : "";
      const parentInfo = params.parent === "self" ? "root" : `child of ${params.parent}`;
      return {
        content: [
          {
            type: "text",
            text: `Spawned agent '${params.name}'${defInfo} (${parentInfo}, worktree: ${result.agent.worktreePath}) (status: ${result.agent.status}).`,
          },
        ],
        details: {
          name: params.name,
          status: result.agent.status,
          worktree: result.agent.worktreePath,
          definition: definition
            ? { name: definition.name, model: definition.model, tools: definition.tools }
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
      "If the agent has children, this will recursively delegate through the chain.",
    ].join(" "),
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
      message: Type.String({ description: "Message to send" }),
      timeout_seconds: Type.Optional(Type.Number({ default: 300 })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      log("tool", `agent_send called`, { name: params.name });
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

      const taskId = `${params.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      pendingTasks.set(taskId, { name: params.name, message: params.message, startTime: Date.now() });

      Promise.resolve().then(async () => {
        try {
          await sendToAgent(agent, params.message, (params.timeout_seconds || 300) * 1000);
          const result = agent.accumulatedText || "(agent returned empty response)";
          log("tool", `agent_send async result`, { name: params.name, length: result.length });
          pi.sendUserMessage(`[${params.name}] ${result}`, { deliverAs: "steer" });
        } catch (err: any) {
          log("tool", `agent_send async error`, { name: params.name, error: err.message });
          pi.sendUserMessage(`[${params.name}] Error: ${err.message}`, { deliverAs: "steer" });
        } finally {
          pendingTasks.delete(taskId);
        }
      });

      return {
        content: [
          { type: "text", text: `Queued task for '${params.name}'. Result will be delivered when the agent completes.` },
        ],
        details: { queued: true, agent: params.name, taskId },
      };
    },
  });

  pi.registerTool({
    name: "agent_status",
    label: "Agent Status",
    description: "Check the status of all spawned agents or one specific agent.",
    parameters: Type.Object({
      name: Type.Optional(Type.String({ description: "Optional agent instance name" })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
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
        const parent = agent.parent ? ` [parent: ${agent.parent}]` : " [root]";
        return {
          content: [
            {
              type: "text",
              text: `Agent '${params.name}'${def}${parent}: ${agent.status}, turns: ${Math.floor(agent.history.length / 2)}\nLast: ${last?.text.slice(0, 200) || "(none)"}`,
            },
          ],
          details: {
            name: agent.id,
            status: agent.status,
            worktree: agent.worktreePath,
            turns: Math.floor(agent.history.length / 2),
          },
        };
      }
      const list = Array.from(agents.entries()).map(([name, a]) => ({
        name,
        status: a.status,
        type: a.definition?.name,
        parent: a.parent || "self",
        worktree: a.worktreePath,
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
    description: "Terminate an agent and its children, removing their worktree if root.",
    parameters: Type.Object({
      name: Type.String({ description: "Agent instance name" }),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const agent = agents.get(params.name);
      if (!agent)
        return {
          content: [{ type: "text", text: `Agent '${params.name}' not found.` }],
          isError: true,
          details: {},
        };

      for (const childId of agent.children) {
        const child = agents.get(childId);
        if (child && !child.proc.killed) child.proc.kill("SIGTERM");
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");

      setTimeout(() => {
        if (!agent.proc.killed) agent.proc.kill("SIGKILL");
      }, 3000);

      if (agent.parent) {
        const parent = agents.get(agent.parent);
        if (parent) {
          parent.children = parent.children.filter((c) => c !== params.name);
        }
      }

      if (!agent.parent) {
        await removeWorktree(agent.worktreePath);
      }

      agents.delete(params.name);
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
      const defs = discoverDefinitions(ctx.cwd);
      const lines = defs.map((d) => `- ${d.name} (${d.source}): ${d.description}`);
      ctx.ui.notify(defs.length ? lines.join("\n") : "No agent definitions found.", "info");
    },
  });

  pi.registerCommand("spawn", {
    description: "Spawn a named agent. Usage: /spawn <name> <parent|'self'> [type|model]",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/);
      const name = parts[0];
      const parent = parts[1];
      const typeOrModel = parts[2];

      if (!name || !parent) {
        ctx.ui.notify("Usage: /spawn <name> <parent|'self'> [type|model]", "error");
        return;
      }
      if (agents.has(name)) {
        ctx.ui.notify(`Agent '${name}' already exists.`, "warning");
        return;
      }

      let definition: ReturnType<typeof getDefinition>;
      let overrideModel: string | undefined;
      if (typeOrModel) {
        definition = getDefinition(typeOrModel, ctx.cwd);
        if (!definition) overrideModel = typeOrModel;
      }

      let worktreePath: string | undefined;
      if (parent !== "self") {
        const parentAgent = agents.get(parent);
        if (!parentAgent) {
          ctx.ui.notify(`Parent agent '${parent}' not found.`, "error");
          return;
        }
        worktreePath = parentAgent.worktreePath;
        parentAgent.children.push(name);
      }

      const result = await spawnAgent(name, {
        model: overrideModel,
        repoCwd: ctx.cwd,
        definition,
        parent: parent === "self" ? undefined : parent,
        worktreePath,
      });

      if (result.error || !result.agent) {
        ctx.ui.notify(result.error || "Spawn failed", "error");
        return;
      }

      agents.set(name, result.agent);
      await new Promise((r) => setTimeout(r, 800));

      if (result.agent.status === "error" || result.agent.status === "exited") {
        agents.delete(name);
        await removeWorktree(result.agent.worktreePath);
        ctx.ui.notify(`Agent '${name}' exited immediately after spawn. Check logs.`, "error");
        return;
      }

      const defInfo = definition ? ` (type: ${definition.name})` : "";
      ctx.ui.notify(`Spawned agent '${name}'${defInfo} (parent: ${parent}).`, "info");
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
      const list =
        Array.from(agents.entries())
          .map(([n, a]) => {
            const t = a.definition ? ` (${a.definition.name})` : "";
            const p = a.parent ? ` ←${a.parent}` : " [root]";
            return `${n}${t}${p}: ${a.status}`;
          })
          .join(", ") || "none";
      ctx.ui.notify(`Agents: ${list}`, "info");
    },
  });

  pi.registerCommand("kill", {
    description: "Kill a spawned agent. Usage: /kill <name>",
    handler: async (name, ctx) => {
      const agent = agents.get(name);
      if (!agent) {
        ctx.ui.notify(`Agent '${name}' not found.`, "error");
        return;
      }

      for (const childId of agent.children) {
        const child = agents.get(childId);
        if (child && !child.proc.killed) child.proc.kill("SIGTERM");
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");

      if (agent.parent) {
        const parent = agents.get(agent.parent);
        if (parent) parent.children = parent.children.filter((c) => c !== name);
      } else {
        await removeWorktree(agent.worktreePath);
      }

      agents.delete(name);
      ctx.ui.notify(`Killed agent '${name}'.`, "info");
    },
  });

  pi.registerCommand("dashboard", {
    description: "Print dashboard URL and open browser",
    handler: async (_args, ctx) => {
      if (!serverHandle) {
        await ensureServer(ctx.cwd);
      }
      if (!serverHandle) {
        ctx.ui.notify("Dashboard server failed to start. Check logs.", "error");
        return;
      }
      ctx.ui.notify(`Dashboard: ${serverHandle.url}`, "info");
      // Try to open browser
      const { spawn } = await import("node:child_process");
      const platform = process.platform;
      const cmd = platform === "darwin" ? "open" : platform === "win32" ? "start" : "xdg-open";
      try {
        spawn(cmd, [serverHandle.url], { detached: true, stdio: "ignore" });
      } catch {
        /* ignore open failures */
      }
    },
  });

  pi.registerCommand("logs", {
    description: "Show recent multi-agent logs. Usage: /logs [lines=20]",
    handler: async (args, ctx) => {
      const lines = parseInt(args.trim(), 10) || 20;
      try {
        const all = fs.readFileSync(LOG_FILE, "utf-8").split("\n").filter(Boolean);
        const recent = all.slice(-lines).join("\n");
        ctx.ui.notify(recent || "No logs yet.", "info");
      } catch {
        ctx.ui.notify("Log file not found.", "error");
      }
    },
  });
}
