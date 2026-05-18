import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { type Agent, type AgentDefinition, agents, log } from "./state.js";
import { createWorktree, removeWorktree } from "./worktree.js";
import { sendToAgent } from "./send.js";
import { broadcast } from "./server.js";

export function hasBwrap(): boolean {
  try {
    const result = spawnSync("which", ["bwrap"], { encoding: "utf-8" });
    return result.status === 0;
  } catch {
    return false;
  }
}

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

export async function spawnAgent(
  id: string,
  options: {
    model?: string;
    repoCwd: string;
    definition?: AgentDefinition;
    parent?: string;
    worktreePath?: string;
    extensions?: Array<{ name: string; path: string }>;
  }
): Promise<{ agent: Agent; error?: string }> {
  const { model, repoCwd, definition, parent, worktreePath: reuseWorktree, extensions } = options;

  if (!hasBwrap()) {
    return { agent: null as any, error: "bwrap is not installed. Install bubblewrap to use agent sandboxing." };
  }

  let worktreePath: string;
  if (reuseWorktree) {
    worktreePath = reuseWorktree;
  } else {
    try {
      worktreePath = await createWorktree(id, repoCwd);
    } catch (err: any) {
      return { agent: null as any, error: `Failed to create worktree: ${err.message}` };
    }
  }

  const commsDir = path.join(worktreePath, ".pi", "comms");
  fs.mkdirSync(commsDir, { recursive: true });
  fs.mkdirSync(path.join(commsDir, "requests"), { recursive: true });
  fs.mkdirSync(path.join(commsDir, "responses"), { recursive: true });

  let promptInsideBwrap: string | null = null;
  let delegatePromptInsideBwrap: string | null = null;
  if (definition?.systemPrompt?.trim()) {
    const filledPrompt = definition.systemPrompt
      .replace(/\{\{name\}\}/g, id)
      .replace(/\{\{type\}\}/g, definition.name);
    const promptDir = path.join(worktreePath, ".pi", "prompts");
    fs.mkdirSync(promptDir, { recursive: true });
    const promptFile = path.join(promptDir, `${id}.md`);
    fs.writeFileSync(promptFile, filledPrompt, { encoding: "utf-8", mode: 0o600 });
    promptInsideBwrap = `/tmp/workspace/.pi/prompts/${id}.md`;

    let delegateInstructions = [
      "",
      "---",
      "",
      "## Delegation",
      "",
      "You have access to a `delegate` tool. Use it to route work to sibling agents when:",
      "- The task is better suited to another agent's specialty",
      "- You want a second opinion or review",
      "- The task can be parallelized",
      "",
      "To delegate, call the `delegate` tool with:",
      "- `target`: name of the sibling agent",
      "- `task`: clear instructions for what they should do",
      "",
      "You may delegate MULTIPLE times in a single turn. For example:",
      "1. Delegate 'find all auth-related code' to scout",
      "2. Review scout's findings",
      "3. Delegate 'check src/login.js for SQL injection' to scout",
      "4. Synthesize both responses into your final answer",
      "",
      "Wait for each delegate response before making your next move.",
      "",
      "If you are the root orchestrator and a task would benefit from focused research, parallel implementation, or specialized review, consider creating a sub-agent using the create_sub_agent tool. Always provide a clear reason.",
      "",
    ].join("\n");

    // List sibling agents that share this worktree so this agent knows who it can delegate to
    const siblingList: string[] = [];
    for (const [otherId, otherAgent] of agents.entries()) {
      if (otherAgent.worktreePath === worktreePath && otherId !== id) {
        const typeLabel = otherAgent.definition?.name ? ` (${otherAgent.definition.name})` : "";
        siblingList.push(`- ${otherId}${typeLabel}`);
      }
    }
    if (siblingList.length > 0) {
      delegateInstructions += [
        "",
        "### Available Agents",
        "",
        "You can delegate to the following agents in your team:",
        ...siblingList,
        "",
        "If you need to reach your parent agent, use their name as the `target`.",
        "",
      ].join("\n");
    }

    const delegatePromptFile = path.join(promptDir, `${id}-delegate.md`);
    fs.writeFileSync(delegatePromptFile, delegateInstructions, { encoding: "utf-8", mode: 0o600 });
    delegatePromptInsideBwrap = `/tmp/workspace/.pi/prompts/${id}-delegate.md`;
  }

  const effectiveModel = definition?.model || model;
  const effectiveTools = definition?.tools ? [...definition.tools] : [];
  if (!effectiveTools.includes("delegate")) {
    effectiveTools.push("delegate");
  }

  const piArgs = ["--mode", "rpc", "--no-session"];
  if (effectiveModel) piArgs.push("--model", effectiveModel);
  // Only restrict tools when no extensions are loaded. Extensions may register
  // their own tools (e.g. web_search) that wouldn't be in the whitelist.
  if (effectiveTools.length > 0 && (!extensions || extensions.length === 0)) {
    piArgs.push("--tools", effectiveTools.join(","));
  }
  if (promptInsideBwrap) piArgs.push("--system-prompt", promptInsideBwrap);
  if (delegatePromptInsideBwrap) piArgs.push("--append-system-prompt", delegatePromptInsideBwrap);
  if (definition?.skills) {
    piArgs.push("--no-skills");
    for (const skillPath of definition.skills) {
      piArgs.push("--skill", skillPath);
    }
  }

  const extDir = path.join(worktreePath, ".pi", "extensions");
  fs.mkdirSync(extDir, { recursive: true });

  // Always copy delegate-agent.ts into worktree
  let delegateInsideBwrap: string | null = null;
  try {
    const delegateSource = path.join(__dirname, "..", "delegate-agent.ts");
    if (fs.existsSync(delegateSource)) {
      const delegateDest = path.join(extDir, "delegate-agent.ts");
      fs.copyFileSync(delegateSource, delegateDest);
      delegateInsideBwrap = "/tmp/workspace/.pi/extensions/delegate-agent.ts";
    }
  } catch {
    /* ignore copy failures */
  }

  // User-selected extensions: pass original absolute paths.
  // ~/.pi/agent is already bind-mounted into bwrap, so these resolve correctly.
  const extraExtPaths: string[] = [];
  if (extensions && extensions.length > 0) {
    for (const ext of extensions) {
      if (fs.existsSync(ext.path)) {
        extraExtPaths.push(ext.path);
        log("spawn", `Extension '${ext.name}' will be loaded from host path`, { path: ext.path });
      } else {
        log("spawn", `Extension '${ext.name}' path not found`, { path: ext.path });
      }
    }
  }

  // Build --extension flags
  if (delegateInsideBwrap || extraExtPaths.length > 0) {
    piArgs.push("--no-extensions");
    if (delegateInsideBwrap) {
      piArgs.push("--extension", delegateInsideBwrap);
    }
    for (const p of extraExtPaths) {
      piArgs.push("--extension", p);
    }
  }

  const piInvocation = getPiInvocation(piArgs);

  const piAgentDir = path.join(os.homedir(), ".pi", "agent");
  const agentBindArgs = fs.existsSync(piAgentDir)
    ? ["--bind", piAgentDir, piAgentDir]
    : [];

  const bwrapArgs = [
    "--ro-bind", "/", "/",
    "--tmpfs", "/tmp",
    "--dev", "/dev",
    "--bind", worktreePath, "/tmp/workspace",
    "--chdir", "/tmp/workspace",
    "--share-net",
    "--setenv", "HOME", os.homedir(),
    ...agentBindArgs,
    piInvocation.command,
    ...piInvocation.args,
  ];

  log("spawn", `Starting agent '${id}' in bwrap`, { worktree: worktreePath, bwrap: `bwrap ${bwrapArgs.join(" ")}` });

  const proc = spawn("bwrap", bwrapArgs, {
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
    events: [],
    buffer: "",
    definition,
    worktreePath,
    parent,
    children: [],
    _rpcRequests: new Map(),
  };

  const flush = () => {
    const lines = agent.buffer.split("\n");
    agent.buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const event = JSON.parse(line);
        if (event.type === "response" && event.id && agent._rpcRequests?.has(event.id)) {
          const pending = agent._rpcRequests.get(event.id)!;
          clearTimeout(pending.timer);
          agent._rpcRequests.delete(event.id);
          if (event.success) pending.resolve(event.data ?? true);
          else pending.reject(new Error(event.error || "RPC command failed"));
          continue;
        }
        agent.events.push({ ts: Date.now(), type: event.type || "unknown", event });
        if (agent.events.length > 500) agent.events.shift();
        if (event.type === "agent_start") {
          agent.status = "streaming";
          agent.accumulatedText = "";
          broadcast({ type: "agent-start", data: { name: agent.id } });
        } else if (event.type === "message_update") {
          const delta = event.assistantMessageEvent;
          if (delta?.type === "text_delta" && typeof delta.delta === "string") {
            agent.accumulatedText += delta.delta;
            broadcast({ type: "agent-delta", data: { name: agent.id, delta: delta.delta } });
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
          broadcast({ type: "agent-end", data: { name: agent.id, text: agent.accumulatedText } });
          if (agent._nextTurn) {
            agent._nextTurn.resolve();
            agent._nextTurn = undefined;
          }
        } else if (event.type === "tool_execution_start" && event.toolName === "delegate") {
          const toolCallId = event.toolCallId;
          const args = event.args || {};
          const target = args.target;
          const task = args.task;
          if (toolCallId && target && task) {
            log("delegate", `Agent '${id}' delegated to '${target}'`, { toolCallId });
            Promise.resolve().then(async () => {
              try {
                const reqFile = path.join(agent.worktreePath, ".pi", "comms", "requests", `${toolCallId}.json`);
                let retries = 0;
                while (!fs.existsSync(reqFile) && retries < 20) {
                  await new Promise((r) => setTimeout(r, 50));
                  retries++;
                }
                if (!fs.existsSync(reqFile)) {
                  log("delegate", `Request file not found for ${toolCallId}`);
                  return;
                }

                // Case-insensitive lookup + suggest alternatives on miss
                let targetAgent = agents.get(target);
                if (!targetAgent) {
                  for (const [name, a] of agents) {
                    if (name.toLowerCase() === target.toLowerCase()) {
                      targetAgent = a;
                      break;
                    }
                  }
                }
                if (!targetAgent) {
                  const available = Array.from(agents.keys()).join(", ") || "none";
                  const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                  fs.writeFileSync(
                    respFile,
                    `Error: Target agent '${target}' not found. Available agents: ${available}. Check spelling and try again.`,
                    "utf-8"
                  );
                  log("delegate", `Target agent '${target}' not found. Available: ${available}`);
                  return;
                }

                await sendToAgent(targetAgent, task, 300_000);
                const result = targetAgent.accumulatedText || "(no response)";

                const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                fs.writeFileSync(respFile, result, "utf-8");
                log("delegate", `Routed ${toolCallId} to '${target}', result written (${result.length} chars)`);
              } catch (err: any) {
                log("delegate", `Routing error for ${toolCallId}: ${err.message}`);
                const respFile = path.join(agent.worktreePath, ".pi", "comms", "responses", `${toolCallId}.json`);
                fs.writeFileSync(respFile, `Error: ${err.message}`, "utf-8");
              }
            });
          }
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

  const stderrLogPath = path.join(worktreePath, ".pi", "stderr.log");
  proc.stderr!.on("data", (data: Buffer) => {
    const text = data.toString();
    if (text.trim()) {
      log("rpc", `Agent '${id}' STDERR`, text.trim());
      try {
        fs.appendFileSync(stderrLogPath, text, "utf-8");
      } catch {
        /* ignore */
      }
    }
  });

  proc.on("close", (code) => {
    log("spawn", `Agent '${id}' process closed`, { code });
    agent.status = "exited";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' exited with code ${code}`));
      agent._nextTurn = undefined;
    }
  });

  proc.on("error", (err) => {
    log("spawn", `Agent '${id}' process error`, err.message);
    agent.status = "error";
    if (agent._nextTurn) {
      agent._nextTurn.reject(new Error(`Agent '${id}' process error: ${err.message}`));
      agent._nextTurn = undefined;
    }
  });

  return { agent };
}
