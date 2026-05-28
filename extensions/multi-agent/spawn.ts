import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import {
	appendAgentEvent,
	type Agent,
	type AgentDefinition,
	agents,
	log,
} from "./state.js";
import {
	isSpawnableAgentDefinition,
	nonSpawnableAgentReason,
} from "./definitions.js";
import { createWorktree } from "./worktree.js";
import { markAgentInputError, sendToAgent } from "./send.js";
import { broadcast } from "./server.js";
import {
	renderIssueArtifactInstructions,
	resolveIssueArtifactMetadata,
} from "./artifacts.js";
import {
	defaultObservabilitySessionId,
	prepareAgentDebugArtifacts,
	persistAgentDebugSnapshot,
} from "./debug-artifacts.js";

export function handleAgentProcessClose(
	agent: Agent,
	code: number | null,
	signal?: NodeJS.Signals | null,
): Error {
	agent.status = "exited";
	agent.pendingSend = undefined;
	appendAgentEvent(agent, "agent_exit", { code, signal: signal || undefined });
	if (agent.observability) {
		persistAgentDebugSnapshot(agent, {
			repoCwd: path.resolve(agent.observability.rootPath, "..", "..", ".."),
		});
	}
	const reason = signal ? `signal ${signal}` : `code ${code}`;
	const err = new Error(`Agent '${agent.id}' exited with ${reason}`);
	if (agent._nextTurn) {
		agent._nextTurn.reject(err);
		agent._nextTurn = undefined;
	}
	if (agent._rpcRequests) {
		for (const pending of agent._rpcRequests.values()) {
			clearTimeout(pending.timer);
			pending.reject(err);
		}
		agent._rpcRequests.clear();
	}
	if (agent.dashboardVisible !== false) {
		broadcast({ type: "agent-exit", data: { name: agent.id, code, signal } });
	}
	return err;
}

export function getPiInvocation(args: string[]): {
	command: string;
	args: string[];
} {
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

const LATTICE_SESSION_RUN_ID = `run-${defaultObservabilitySessionId()}`;

function sanitizeSessionIdPart(
	value: string | undefined,
	fallback: string,
): string {
	const sanitized = (value || fallback)
		.trim()
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "")
		.slice(0, 80)
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "");
	return sanitized || fallback;
}

export function buildAgentSessionId(options: {
	agentId: string;
	runId?: string;
}): string {
	return [
		"pi-lattice",
		sanitizeSessionIdPart(options.runId || LATTICE_SESSION_RUN_ID, "run"),
		sanitizeSessionIdPart(options.agentId, "agent"),
	].join(".");
}

export function buildPiArgs(options: {
	model?: string;
	definition?: AgentDefinition;
	agentId?: string;
	sessionRunId?: string;
	promptPath: string | null;
	delegatePromptPath: string | null;
	artifactPromptPath?: string | null;
	runtimeToolsExtensionPath?: string | null;
	delegateExtensionPath: string | null;
	extraExtPaths: string[];
}): string[] {
	const {
		model,
		definition,
		agentId,
		sessionRunId,
		promptPath,
		delegatePromptPath,
		artifactPromptPath,
		runtimeToolsExtensionPath,
		delegateExtensionPath,
		extraExtPaths,
	} = options;
	const effectiveModel = definition?.model || model;
	const effectiveThinking = definition?.thinking;
	const effectiveTools = definition?.tools ? [...definition.tools] : [];
	const disableTools = !!definition?.noTools;
	const disableSkills =
		!!definition?.noSkills || !!definition?.isolated || !!definition?.skills;
	const disableExtensions =
		!!definition?.noExtensions || !!definition?.isolated;
	const disableContextFiles =
		!!definition?.noContextFiles || !!definition?.isolated;

	const agentSessionId = buildAgentSessionId({
		agentId: agentId || definition?.name || "agent",
		runId: sessionRunId,
	});
	const piArgs = ["--mode", "rpc", "--session-id", agentSessionId];
	if (effectiveModel) piArgs.push("--model", effectiveModel);
	if (effectiveThinking) piArgs.push("--thinking", effectiveThinking);
	if (disableTools) piArgs.push("--no-tools");
	if (effectiveTools.length > 0) {
		piArgs.push("--tools", effectiveTools.join(","));
	}
	if (promptPath) piArgs.push("--system-prompt", promptPath);
	if (delegatePromptPath)
		piArgs.push("--append-system-prompt", delegatePromptPath);
	if (artifactPromptPath)
		piArgs.push("--append-system-prompt", artifactPromptPath);
	if (disableContextFiles) piArgs.push("--no-context-files");
	if (disableSkills) {
		piArgs.push("--no-skills");
		for (const skillPath of definition?.skills || []) {
			piArgs.push("--skill", skillPath);
		}
	}

	if (
		runtimeToolsExtensionPath ||
		delegateExtensionPath ||
		extraExtPaths.length > 0 ||
		disableExtensions
	) {
		piArgs.push("--no-extensions");
		if (runtimeToolsExtensionPath) {
			piArgs.push("--extension", runtimeToolsExtensionPath);
		}
		if (delegateExtensionPath) {
			piArgs.push("--extension", delegateExtensionPath);
		}
		for (const p of extraExtPaths) {
			piArgs.push("--extension", p);
		}
	}

	return piArgs;
}

export function buildProcessLaunch(options: {
	worktreePath: string;
	piInvocation: { command: string; args: string[] };
}): { command: string; args: string[]; cwd: string } {
	return {
		command: options.piInvocation.command,
		args: options.piInvocation.args,
		cwd: options.worktreePath,
	};
}

export function bundledProviderExtensionPaths(options: {
	model?: string;
	repoCwd: string;
}): string[] {
	const model = options.model?.trim().toLowerCase() || "";
	const paths: string[] = [];
	if (model.startsWith("cursor/")) {
		paths.push(
			path.join(
				options.repoCwd,
				"node_modules",
				"pi-cursor-sdk",
				"src",
				"index.ts",
			),
		);
	}
	return paths.filter((candidate) => fs.existsSync(candidate));
}

export function buildProcessEnv(options: {
	model?: string;
	baseEnv?: NodeJS.ProcessEnv;
}): NodeJS.ProcessEnv {
	const env = { ...(options.baseEnv || process.env) };
	const model = options.model?.trim().toLowerCase() || "";
	if (model.startsWith("cursor/")) {
		env.PI_CURSOR_SETTING_SOURCES = "none";
	}
	return env;
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
		issueId?: string;
		dashboardVisible?: boolean;
	},
): Promise<{ agent: Agent; error?: string }> {
	const {
		model,
		repoCwd,
		definition,
		parent,
		worktreePath: reuseWorktree,
		extensions,
	} = options;
	const dashboardVisible = options.dashboardVisible !== false;
	let issueArtifactMetadata: ReturnType<typeof resolveIssueArtifactMetadata> =
		{};
	try {
		const parentAgent = parent ? agents.get(parent) : undefined;
		issueArtifactMetadata = resolveIssueArtifactMetadata({
			repoCwd,
			issueId: options.issueId,
			parentIssueId: parentAgent?.issueId,
			parentArtifactPath: parentAgent?.artifactPath,
		});
	} catch (err: any) {
		return {
			agent: null as any,
			error: `Failed to prepare issue handoff artifacts: ${err.message}`,
		};
	}

	if (definition && !isSpawnableAgentDefinition(definition)) {
		return {
			agent: null as any,
			error:
				nonSpawnableAgentReason(definition) ||
				`Agent type '${definition.name}' is not spawnable.`,
		};
	}

	let worktreePath: string;
	if (reuseWorktree) {
		worktreePath = reuseWorktree;
	} else {
		try {
			worktreePath = await createWorktree(id, repoCwd);
		} catch (err: any) {
			return {
				agent: null as any,
				error: `Failed to create worktree: ${err.message}`,
			};
		}
	}

	const commsDir = path.join(worktreePath, ".pi", "comms");
	fs.mkdirSync(commsDir, { recursive: true });
	fs.mkdirSync(path.join(commsDir, "requests"), { recursive: true });
	fs.mkdirSync(path.join(commsDir, "responses"), { recursive: true });

	const promptDir = path.join(worktreePath, ".pi", "prompts");
	let promptPath: string | null = null;
	let delegatePromptPath: string | null = null;
	let artifactPromptPath: string | null = null;
	const delegateEnabled = definition?.delegate ?? !definition?.isolated;
	if (definition?.systemPrompt?.trim()) {
		const filledPrompt = definition.systemPrompt
			.replace(/\{\{name\}\}/g, id)
			.replace(/\{\{type\}\}/g, definition.name);
		fs.mkdirSync(promptDir, { recursive: true });
		const promptFile = path.join(promptDir, `${id}.md`);
		fs.writeFileSync(promptFile, filledPrompt, {
			encoding: "utf-8",
			mode: 0o600,
		});
		promptPath = promptFile;

		if (delegateEnabled) {
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
					const typeLabel = otherAgent.definition?.name
						? ` (${otherAgent.definition.name})`
						: "";
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
			fs.writeFileSync(delegatePromptFile, delegateInstructions, {
				encoding: "utf-8",
				mode: 0o600,
			});
			delegatePromptPath = delegatePromptFile;
		}
	}

	if (
		issueArtifactMetadata.issueId &&
		issueArtifactMetadata.artifactPath &&
		issueArtifactMetadata.artifactFiles
	) {
		fs.mkdirSync(promptDir, { recursive: true });
		const artifactPromptFile = path.join(promptDir, `${id}-artifacts.md`);
		fs.writeFileSync(
			artifactPromptFile,
			renderIssueArtifactInstructions({
				agentId: id,
				agentClass: definition?.agentClass,
				issueId: issueArtifactMetadata.issueId,
				artifactPath: issueArtifactMetadata.artifactPath,
				artifactFiles: issueArtifactMetadata.artifactFiles,
			}),
			{ encoding: "utf-8", mode: 0o600 },
		);
		artifactPromptPath = artifactPromptFile;
	}

	const extDir = path.join(worktreePath, ".pi", "extensions");
	fs.mkdirSync(extDir, { recursive: true });

	// Always copy runtime-tools reporter so the dashboard can inspect active tools without adding a tool.
	let runtimeToolsExtensionPath: string | null = null;
	try {
		const runtimeToolsSource = path.join(
			__dirname,
			"..",
			"runtime-tools-reporter.ts",
		);
		if (fs.existsSync(runtimeToolsSource)) {
			const runtimeToolsDest = path.join(extDir, "runtime-tools-reporter.ts");
			fs.copyFileSync(runtimeToolsSource, runtimeToolsDest);
			runtimeToolsExtensionPath = runtimeToolsDest;
		}
	} catch {
		/* ignore copy failures */
	}

	// Copy delegate-agent.ts into worktree unless disabled for isolated/basic agents.
	let delegateExtensionPath: string | null = null;
	if (delegateEnabled) {
		try {
			const delegateSource = path.join(__dirname, "..", "delegate-agent.ts");
			if (fs.existsSync(delegateSource)) {
				const delegateDest = path.join(extDir, "delegate-agent.ts");
				fs.copyFileSync(delegateSource, delegateDest);
				delegateExtensionPath = delegateDest;
			}
		} catch {
			/* ignore copy failures */
		}
	}

	// User-selected extensions: pass their container-visible absolute paths through unchanged.
	const effectiveModel = definition?.model || model;
	const extraExtPaths: string[] = bundledProviderExtensionPaths({
		model: effectiveModel,
		repoCwd,
	});
	for (const extensionPath of extraExtPaths) {
		log("spawn", "Bundled provider extension will be loaded", {
			model: effectiveModel,
			path: extensionPath,
		});
	}
	if (extensions && extensions.length > 0) {
		for (const ext of extensions) {
			if (fs.existsSync(ext.path)) {
				extraExtPaths.push(ext.path);
				log("spawn", `Extension '${ext.name}' will be loaded from host path`, {
					path: ext.path,
				});
			} else {
				log("spawn", `Extension '${ext.name}' path not found`, {
					path: ext.path,
				});
			}
		}
	}

	const piArgs = buildPiArgs({
		model,
		definition,
		agentId: id,
		promptPath,
		delegatePromptPath,
		artifactPromptPath,
		runtimeToolsExtensionPath,
		delegateExtensionPath,
		extraExtPaths,
	});
	const piInvocation = getPiInvocation(piArgs);
	const launch = buildProcessLaunch({ worktreePath, piInvocation });

	const processEnv = buildProcessEnv({ model: effectiveModel });
	log("spawn", `Starting agent '${id}' as child process`, {
		worktree: worktreePath,
		command: launch.command,
		args: launch.args,
		cwd: launch.cwd,
		envOverrides: {
			PI_CURSOR_SETTING_SOURCES: processEnv.PI_CURSOR_SETTING_SOURCES,
		},
	});

	const proc = spawn(launch.command, launch.args, {
		stdio: ["pipe", "pipe", "pipe"],
		env: processEnv,
		cwd: launch.cwd,
	});
	const observability = prepareAgentDebugArtifacts({ repoCwd, agentId: id });

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
		model: effectiveModel,
		worktreePath,
		parent,
		children: [],
		issueId: issueArtifactMetadata.issueId,
		artifactPath: issueArtifactMetadata.artifactPath,
		artifactFiles: issueArtifactMetadata.artifactFiles,
		dashboardVisible,
		launch: {
			command: launch.command,
			args: launch.args,
			cwd: launch.cwd,
			pid: proc.pid,
			startedAt: Date.now(),
		},
		observability,
		_rpcRequests: new Map(),
	};
	persistAgentDebugSnapshot(agent, { repoCwd });

	const flush = () => {
		const lines = agent.buffer.split("\n");
		agent.buffer = lines.pop() || "";
		for (const line of lines) {
			if (!line.trim()) continue;
			try {
				const event = JSON.parse(line);
				if (
					event.type === "response" &&
					event.id &&
					agent._rpcRequests?.has(event.id)
				) {
					const pending = agent._rpcRequests.get(event.id)!;
					clearTimeout(pending.timer);
					agent._rpcRequests.delete(event.id);
					if (event.success) pending.resolve(event.data ?? true);
					else pending.reject(new Error(event.error || "RPC command failed"));
					continue;
				}
				agent.events.push({
					ts: Date.now(),
					type: event.type || "unknown",
					event,
				});
				if (agent.events.length > 500) agent.events.shift();
				if (event.type === "agent_start") {
					agent.status = "streaming";
					if (agent.pendingSend) agent.pendingSend.status = "streaming";
					agent.accumulatedText = "";
					persistAgentDebugSnapshot(agent, { repoCwd });
					if (agent.dashboardVisible !== false)
						broadcast({ type: "agent-start", data: { name: agent.id } });
				} else if (event.type === "message_update") {
					const delta = event.assistantMessageEvent;
					if (delta?.type === "text_delta" && typeof delta.delta === "string") {
						agent.accumulatedText += delta.delta;
						if (agent.dashboardVisible !== false)
							broadcast({
								type: "agent-delta",
								data: { name: agent.id, delta: delta.delta },
							});
					}
				} else if (event.type === "agent_end") {
					agent.status = "idle";
					agent.pendingSend = undefined;
					const msgs = event.messages || [];
					const lastAssistant = [...msgs]
						.reverse()
						.find((m: any) => m.role === "assistant");
					if (lastAssistant) {
						const text =
							lastAssistant.content
								?.filter((c: any) => c.type === "text")
								.map((c: any) => c.text)
								.join("") || "";
						if (text && !agent.accumulatedText) agent.accumulatedText = text;
					}
					agent.history.push({
						role: "assistant",
						text: agent.accumulatedText,
					});
					persistAgentDebugSnapshot(agent, { repoCwd });
					if (agent.dashboardVisible !== false)
						broadcast({
							type: "agent-end",
							data: { name: agent.id, text: agent.accumulatedText },
						});
					if (agent._nextTurn) {
						agent._nextTurn.resolve();
						agent._nextTurn = undefined;
					}
				} else if (
					event.type === "tool_execution_start" &&
					event.toolName === "delegate"
				) {
					const toolCallId = event.toolCallId;
					const args = event.args || {};
					const target = args.target;
					const task = args.task;
					if (toolCallId && target && task) {
						log("delegate", `Agent '${id}' delegated to '${target}'`, {
							toolCallId,
						});
						Promise.resolve().then(async () => {
							try {
								const reqFile = path.join(
									agent.worktreePath,
									".pi",
									"comms",
									"requests",
									`${toolCallId}.json`,
								);
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
									const available =
										Array.from(agents.keys()).join(", ") || "none";
									const respFile = path.join(
										agent.worktreePath,
										".pi",
										"comms",
										"responses",
										`${toolCallId}.json`,
									);
									fs.writeFileSync(
										respFile,
										`Error: Target agent '${target}' not found. Available agents: ${available}. Check spelling and try again.`,
										"utf-8",
									);
									log(
										"delegate",
										`Target agent '${target}' not found. Available: ${available}`,
									);
									return;
								}

								await sendToAgent(targetAgent, task, 300_000);
								const result = targetAgent.accumulatedText || "(no response)";

								const respFile = path.join(
									agent.worktreePath,
									".pi",
									"comms",
									"responses",
									`${toolCallId}.json`,
								);
								fs.writeFileSync(respFile, result, "utf-8");
								log(
									"delegate",
									`Routed ${toolCallId} to '${target}', result written (${result.length} chars)`,
								);
							} catch (err: any) {
								log(
									"delegate",
									`Routing error for ${toolCallId}: ${err.message}`,
								);
								const respFile = path.join(
									agent.worktreePath,
									".pi",
									"comms",
									"responses",
									`${toolCallId}.json`,
								);
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

	proc.stdin!.on("error", (err: any) => {
		markAgentInputError(agent, err);
	});

	const stderrLogPath = path.join(worktreePath, ".pi", "stderr.log");
	proc.stderr!.on("data", (data: Buffer) => {
		const text = data.toString();
		if (text.trim()) {
			const trimmed = text.trim();
			log("rpc", `Agent '${id}' STDERR`, trimmed);
			appendAgentEvent(agent, "stderr", {
				text: trimmed.length > 1_000 ? `${trimmed.slice(0, 999)}…` : trimmed,
				length: trimmed.length,
			});
			persistAgentDebugSnapshot(agent, { repoCwd, stderrTail: trimmed });
			try {
				fs.appendFileSync(stderrLogPath, text, "utf-8");
			} catch {
				/* ignore */
			}
		}
	});

	proc.on("close", (code, signal) => {
		log("spawn", `Agent '${id}' process closed`, { code, signal });
		handleAgentProcessClose(agent, code, signal);
	});

	proc.on("error", (err) => {
		log("spawn", `Agent '${id}' process error`, err.message);
		agent.status = "error";
		if (agent._nextTurn) {
			agent._nextTurn.reject(
				new Error(`Agent '${id}' process error: ${err.message}`),
			);
			agent._nextTurn = undefined;
		}
		if (agent._rpcRequests) {
			for (const pending of agent._rpcRequests.values()) {
				clearTimeout(pending.timer);
				pending.reject(
					new Error(`Agent '${id}' process error: ${err.message}`),
				);
			}
			agent._rpcRequests.clear();
		}
	});

	return { agent };
}
