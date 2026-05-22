import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import { agents, pendingTasks, log, LOG_FILE } from "./state.js";
import {
	discoverDefinitions,
	getDefinition,
	isSpawnableAgentDefinition,
	nonSpawnableAgentReason,
} from "./definitions.js";
import { discoverExtensions } from "./ext-discovery.js";
import { spawnAgent } from "./spawn.js";
import { sendToAgent } from "./send.js";
import { removeWorktree, cleanupOrphanedWorktrees } from "./worktree.js";
import { startServer, broadcast } from "./server.js";
import { resolveCapabilities } from "./capability-resolution.js";
import {
	logRuntimeToolConflicts,
	readRuntimeToolSnapshot,
} from "./runtime-tools.js";
import {
	chooseRootProfileActivation,
	discoverRootProfiles,
	resolveRootProfileCapabilities,
	type RootOrchestratorProfile,
} from "./root-profiles.js";

let serverHandle: { url: string; stop: () => void } | undefined;
let orchestrationMode = false;
let activeRootProfileName: string | undefined;
let activeRootProfile: RootOrchestratorProfile | undefined;
let currentRootModel: string | undefined;
const ORCHESTRATION_STATE_ENTRY = "pi-orchestrator-root-profile";

function displaySkillScope(scope?: string): string {
	if (scope === "user") return "global";
	return scope || "unknown";
}

function modelPattern(model: any): string | undefined {
	if (!model) return undefined;
	const provider =
		typeof model.provider === "string" ? model.provider.trim() : "";
	const id = typeof model.id === "string" ? model.id.trim() : "";
	if (provider && id) return `${provider}/${id}`;
	return id || undefined;
}

function serializeAgentForDashboard(agent: import("./state.js").Agent) {
	agent.runtimeTools = readRuntimeToolSnapshot(agent.worktreePath);
	logRuntimeToolConflicts(agent.id, agent.runtimeTools);
	return {
		name: agent.id,
		status: agent.status,
		definition: agent.definition?.name,
		parent: agent.parent,
		children: agent.children,
		turns: Math.floor(agent.history.length / 2),
		worktree: agent.worktreePath,
		runtimeTools: agent.runtimeTools,
	};
}

function restoreOrchestrationState(ctx: any) {
	const entries = ctx.sessionManager.getEntries?.() || [];
	const state = [...entries]
		.reverse()
		.find(
			(entry: any) =>
				entry.type === "custom" &&
				entry.customType === ORCHESTRATION_STATE_ENTRY,
		)?.data;
	orchestrationMode = !!state?.enabled;
	activeRootProfileName =
		orchestrationMode && typeof state?.profile === "string"
			? state.profile
			: undefined;
	activeRootProfile = activeRootProfileName
		? discoverRootProfiles(ctx.cwd).find(
				(profile) => profile.name === activeRootProfileName,
			)
		: undefined;
	if (orchestrationMode && !activeRootProfile) {
		const fallback =
			discoverRootProfiles(ctx.cwd).find(
				(profile) => profile.name === "default",
			) || discoverRootProfiles(ctx.cwd)[0];
		activeRootProfile = fallback;
		activeRootProfileName = fallback?.name;
	}
}

function rootProfileSystemPrompt(profile: RootOrchestratorProfile): string {
	return [
		`Active root orchestrator profile: ${profile.name}`,
		profile.description
			? `Profile description: ${profile.description}`
			: undefined,
		profile.instructions.trim()
			? `Profile instructions:\n${profile.instructions.trim()}`
			: undefined,
	]
		.filter(Boolean)
		.join("\n\n");
}

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
				currentModel: () => currentRootModel,
			});
			log("server", `Dashboard listening at ${serverHandle.url}`);
		} catch (err: any) {
			log("server", `Failed to start dashboard server: ${err.message}`);
			console.error(`[multi-agent] Dashboard server failed: ${err.message}`);
		}
	}

	pi.on("session_start", async (_event, ctx) => {
		currentRootModel = modelPattern((ctx as any).model) || currentRootModel;
		restoreOrchestrationState(ctx);
		if (serverHandle) {
			serverHandle.stop();
			serverHandle = undefined;
		}
		await ensureServer(ctx.cwd);
		if (orchestrationMode && activeRootProfileName)
			ctx.ui.setStatus(
				"orchestrator",
				`orchestrator: ${activeRootProfileName}`,
			);
		else ctx.ui.setStatus("orchestrator", "");
	});

	pi.on("model_select", async (event) => {
		currentRootModel = modelPattern((event as any).model);
		log("model", "Root model selected", {
			model: currentRootModel,
			source: (event as any).source,
		});
	});

	pi.on("resources_discover", async (_event, ctx) => {
		if (!orchestrationMode || !activeRootProfile) return;
		const capabilities = resolveRootProfileCapabilities({
			cwd: ctx.cwd,
			profile: activeRootProfile,
		});
		if (capabilities.errors.length || capabilities.skillConflicts.length) {
			const errors = [
				...capabilities.errors,
				...capabilities.skillConflicts.map(
					(conflict) =>
						`Conflicting runtime skill name '${conflict.name}': ${conflict.paths.join(", ")}`,
				),
			];
			log(
				"profiles",
				`Active root profile '${activeRootProfile.name}' has invalid capabilities`,
				errors,
			);
			ctx.ui.notify(
				`Root profile '${activeRootProfile.name}' has invalid capabilities:\n${errors.join("\n")}`,
				"error",
			);
			return;
		}
		return capabilities.skills.length
			? { skillPaths: capabilities.skills }
			: undefined;
	});

	pi.on("before_agent_start", async (event, _ctx) => {
		if (!orchestrationMode || !activeRootProfile) return;
		return {
			systemPrompt: `${event.systemPrompt}\n\n${rootProfileSystemPrompt(activeRootProfile)}`,
		};
	});

	pi.on("session_shutdown", async () => {
		log(
			"lifecycle",
			"session_shutdown -> killing all child agents and removing worktrees",
		);
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
		description:
			"List available agent definitions discovered from ~/.pi/agent/agents and .pi/agents.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const defs = discoverDefinitions(ctx.cwd).filter(
				isSpawnableAgentDefinition,
			);
			const lines = defs.map((d) => {
				const skills = d.skills ? ` [skills: ${d.skills.length}]` : "";
				const tools = d.tools ? ` [tools: ${d.tools.join(",")}]` : "";
				const agentClass = d.agentClass ? ` [class: ${d.agentClass}]` : "";
				return `- ${d.name} (${d.source}): ${d.description}${agentClass}${tools}${skills}`;
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
				details: {
					definitions: defs.map((d) => ({
						name: d.name,
						source: d.source,
						description: d.description,
					})),
				},
			};
		},
	});

	pi.registerTool({
		name: "skill_list",
		label: "List Skills",
		description:
			"List discovered Pi skills with source, editability, and file metadata.",
		parameters: Type.Object({
			scope: Type.Optional(
				Type.String({
					description:
						"Optional scope/source filter, e.g. project, global, package",
				}),
			),
			editableOnly: Type.Optional(
				Type.Boolean({
					description: "Only return skills editable by this project/dashboard",
				}),
			),
			search: Type.Optional(
				Type.String({
					description: "Optional search text for name, description, or path",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { discoverSkills } = await import("./skill-discovery.js");
			const q = params.search?.trim().toLowerCase();
			const skills = (await discoverSkills(ctx.cwd)).filter((skill) => {
				if (params.editableOnly && !skill.editable) return false;
				if (
					params.scope &&
					skill.scope !== params.scope &&
					skill.source !== params.scope
				)
					return false;
				if (!q) return true;
				return [
					skill.name,
					skill.description,
					skill.path,
					skill.source,
					skill.scope,
				].some((value) => (value || "").toLowerCase().includes(q));
			});
			const lines = skills.map(
				(skill) =>
					`- ${skill.name} [${displaySkillScope(skill.scope || skill.source)}${skill.editable ? ", editable" : ", read-only"}] ${skill.description || ""}`,
			);
			return {
				content: [
					{
						type: "text",
						text: lines.length
							? `Discovered skills:\n${lines.join("\n")}`
							: "No matching skills found.",
					},
				],
				details: { skills },
			};
		},
	});

	pi.registerTool({
		name: "skill_read",
		label: "Read Skill",
		description:
			"Read full SKILL.md content for a discovered skill by id, or by unambiguous exact name.",
		parameters: Type.Object({
			id: Type.Optional(
				Type.String({ description: "Skill id from skill_list" }),
			),
			name: Type.Optional(
				Type.String({
					description: "Exact skill name, only allowed when unambiguous",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { discoverSkills, getSkillDetail } = await import(
				"./skill-discovery.js"
			);
			let id = params.id;
			if (!id && params.name) {
				const matches = (await discoverSkills(ctx.cwd)).filter(
					(skill) => skill.name === params.name,
				);
				if (matches.length !== 1) {
					return {
						content: [
							{
								type: "text",
								text: matches.length
									? `Skill name '${params.name}' is ambiguous. Use one of these ids: ${matches.map((skill) => skill.id).join(", ")}`
									: `Skill '${params.name}' not found.`,
							},
						],
						isError: true,
						details: { matches },
					};
				}
				id = matches[0].id;
			}
			if (!id)
				return {
					content: [{ type: "text", text: "Provide either id or name." }],
					isError: true,
					details: {},
				};
			const detail = await getSkillDetail(id, ctx.cwd);
			if (!detail)
				return {
					content: [{ type: "text", text: `Skill '${id}' not found.` }],
					isError: true,
					details: {},
				};
			return {
				content: [{ type: "text", text: detail.content }],
				details: { detail },
			};
		},
	});

	pi.registerTool({
		name: "skill_create",
		label: "Create Skill",
		description:
			"Create a project or global directory-style Pi skill scaffold.",
		parameters: Type.Object({
			scope: Type.Optional(
				Type.String({ description: "project or global. Defaults to project." }),
			),
			name: Type.String({
				description:
					"Skill name. Will be normalized to lowercase-hyphen format.",
			}),
			description: Type.String({
				description: "Skill description used by Pi to decide when to load it.",
			}),
			body: Type.Optional(
				Type.String({
					description: "Optional markdown body after frontmatter.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { createSkill } = await import("./skill-discovery.js");
			const result = await createSkill(
				{
					scope: params.scope === "global" ? "global" : "project",
					name: params.name,
					description: params.description,
					body: params.body,
				},
				ctx.cwd,
			);
			if (!result.success || !result.detail)
				return {
					content: [
						{ type: "text", text: result.error || "Failed to create skill." },
					],
					isError: true,
					details: result,
				};
			return {
				content: [
					{
						type: "text",
						text: `Created ${displaySkillScope(result.detail.skill.scope || result.detail.skill.source || "project")} skill '${result.detail.skill.name}' at ${result.detail.skill.path}.`,
					},
				],
				details: { skill: result.detail.skill, detail: result.detail },
			};
		},
	});

	pi.registerTool({
		name: "skill_update",
		label: "Update Skill",
		description:
			"Update an editable skill using full replacement SKILL.md content and an expected hash from skill_read.",
		parameters: Type.Object({
			id: Type.String({
				description: "Skill id from skill_list or skill_read",
			}),
			content: Type.String({
				description: "Full replacement SKILL.md content including frontmatter",
			}),
			expectedHash: Type.Optional(
				Type.String({
					description: "Expected current content hash from skill_read",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { updateSkill } = await import("./skill-discovery.js");
			const result = await updateSkill(
				params.id,
				{ content: params.content, expectedHash: params.expectedHash },
				ctx.cwd,
			);
			if (!result.success || !result.detail)
				return {
					content: [
						{ type: "text", text: result.error || "Failed to update skill." },
					],
					isError: true,
					details: result,
				};
			return {
				content: [
					{
						type: "text",
						text: `Updated skill '${result.detail.skill.name}'.`,
					},
				],
				details: { detail: result.detail },
			};
		},
	});

	pi.registerTool({
		name: "resource_settings_read",
		label: "Read Resource Settings",
		description:
			"Read Pi global/project skills and extensions source path settings.",
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const { readResourceSettings } = await import("./resource-settings.js");
			const settings = readResourceSettings(ctx.cwd);
			const lines = [settings.global, settings.project].map((scope) =>
				[
					`${scope.label}: ${scope.settingsPath}${scope.exists ? "" : " (not created yet)"}`,
					`  skills: ${scope.skills.length ? scope.skills.join(", ") : "—"}`,
					`  extensions: ${scope.extensions.length ? scope.extensions.join(", ") : "—"}`,
					scope.parseError ? `  parse error: ${scope.parseError}` : undefined,
				]
					.filter(Boolean)
					.join("\n"),
			);
			return {
				content: [{ type: "text", text: lines.join("\n\n") }],
				details: settings,
			};
		},
	});

	pi.registerTool({
		name: "resource_settings_update",
		label: "Update Resource Settings",
		description:
			"Update one Pi settings scope's skills/extensions source paths while preserving unrelated settings. Warn before adding extension paths.",
		parameters: Type.Object({
			scope: Type.String({ description: "global or project" }),
			skills: Type.Optional(
				Type.Array(Type.String(), {
					description: "Replacement skills source paths for this scope",
				}),
			),
			extensions: Type.Optional(
				Type.Array(Type.String(), {
					description:
						"Replacement extension source paths for this scope. Use only trusted paths.",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const { updateResourceSettings } = await import("./resource-settings.js");
			const result = updateResourceSettings(
				{
					scope:
						params.scope === "global"
							? "global"
							: params.scope === "project"
								? "project"
								: (params.scope as any),
					skills: params.skills,
					extensions: params.extensions,
				},
				ctx.cwd,
			);
			if (!result.success || !result.settings)
				return {
					content: [
						{
							type: "text",
							text: result.error || "Failed to update resource settings.",
						},
					],
					isError: true,
					details: result,
				};
			const extensionWarning = params.extensions
				? "\nWarning: extensions execute code with full system permissions; only use trusted paths."
				: "";
			return {
				content: [
					{
						type: "text",
						text: `Updated ${params.scope} Pi resource settings. Changes may require Pi reload/restart for all sessions to see them.${extensionWarning}`,
					},
				],
				details: result.settings,
			};
		},
	});

	pi.registerTool({
		name: "agent_spawn",
		label: "Spawn Agent",
		description: [
			"Spawn a named sub-agent as a persistent Pi RPC child process in a git worktree.",
			"Root agents (parent='self') get a new git worktree. Sub-agents share their parent's worktree.",
		].join(" "),
		parameters: Type.Object({
			name: Type.String({
				description: "Unique instance name, e.g. 'lead' or 'scout_1'",
			}),
			type: Type.Optional(
				Type.String({ description: "Agent definition name, e.g. 'coder'" }),
			),
			model: Type.Optional(
				Type.String({ description: "Override model pattern" }),
			),
			parent: Type.String({
				description: "Parent agent name, or 'self' for root agents",
			}),
			extensions: Type.Optional(
				Type.Array(Type.String(), {
					description: "Extension names to load in the agent",
				}),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			log("tool", `agent_spawn called`, {
				name: params.name,
				type: params.type,
				parent: params.parent,
			});

			if (agents.has(params.name)) {
				return {
					content: [
						{ type: "text", text: `Agent '${params.name}' already exists.` },
					],
					isError: true,
					details: {},
				};
			}

			const definition = params.type
				? getDefinition(params.type, ctx.cwd)
				: undefined;
			if (params.type && !definition) {
				const available =
					discoverDefinitions(ctx.cwd)
						.filter(isSpawnableAgentDefinition)
						.map((d) => d.name)
						.join(", ") || "none";
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
			if (definition && !isSpawnableAgentDefinition(definition)) {
				return {
					content: [
						{
							type: "text",
							text:
								nonSpawnableAgentReason(definition) ||
								`Agent type '${definition.name}' is not spawnable.`,
						},
					],
					isError: true,
					details: { definition },
				};
			}

			let worktreePath: string | undefined;
			if (params.parent !== "self") {
				const parentAgent = agents.get(params.parent);
				if (!parentAgent) {
					return {
						content: [
							{
								type: "text",
								text: `Parent agent '${params.parent}' not found.`,
							},
						],
						isError: true,
						details: {},
					};
				}
				worktreePath = parentAgent.worktreePath;
				parentAgent.children.push(params.name);
			}

			const allExts = discoverExtensions(ctx.cwd);
			const capabilities = resolveCapabilities({
				cwd: ctx.cwd,
				definition,
				requestedExtensions: params.extensions || [],
				availableExtensions: allExts,
			});
			if (capabilities.errors.length) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot spawn agent with invalid capabilities:\n${capabilities.errors.map((error) => `- ${error}`).join("\n")}`,
						},
					],
					isError: true,
					details: { errors: capabilities.errors },
				};
			}
			if (capabilities.skillConflicts.length) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot spawn agent with conflicting runtime skill names:\n${capabilities.skillConflicts.map((conflict) => `- ${conflict.name}: ${conflict.paths.join(", ")}`).join("\n")}`,
						},
					],
					isError: true,
					details: { skillConflicts: capabilities.skillConflicts },
				};
			}
			const resolvedDefinition = definition
				? { ...definition, skills: capabilities.skills }
				: undefined;

			const result = await spawnAgent(params.name, {
				model: params.model,
				repoCwd: ctx.cwd,
				definition: resolvedDefinition,
				parent: params.parent === "self" ? undefined : params.parent,
				worktreePath,
				extensions: capabilities.extensions,
			});

			if (result.error || !result.agent) {
				return {
					content: [
						{ type: "text", text: result.error || "Unknown spawn error" },
					],
					isError: true,
					details: {},
				};
			}

			agents.set(params.name, result.agent);
			broadcast({
				type: "agent-spawned",
				data: serializeAgentForDashboard(result.agent),
			});
			await new Promise((r) => setTimeout(r, 1000));

			if (result.agent.status === "error" || result.agent.status === "exited") {
				agents.delete(params.name);
				await removeWorktree(result.agent.worktreePath);
				return {
					content: [
						{
							type: "text",
							text: `Failed to spawn agent '${params.name}'. Check logs.`,
						},
					],
					isError: true,
					details: {},
				};
			}

			const defInfo = definition ? ` (type: ${definition.name})` : "";
			const parentInfo =
				params.parent === "self" ? "root" : `child of ${params.parent}`;
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
						? {
								name: definition.name,
								class: definition.agentClass,
								model: definition.model,
								tools: definition.tools,
							}
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
						{
							type: "text",
							text: `Agent '${params.name}' not found. Use agent_status to list agents.`,
						},
					],
					isError: true,
					details: {},
				};
			}

			const taskId = `${params.name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
			pendingTasks.set(taskId, {
				name: params.name,
				message: params.message,
				startTime: Date.now(),
			});

			Promise.resolve().then(async () => {
				try {
					await sendToAgent(
						agent,
						params.message,
						(params.timeout_seconds || 300) * 1000,
					);
					const result =
						agent.accumulatedText || "(agent returned empty response)";
					log("tool", `agent_send async result`, {
						name: params.name,
						length: result.length,
					});
					pi.sendUserMessage(`[${params.name}] ${result}`, {
						deliverAs: "steer",
					});
				} catch (err: any) {
					log("tool", `agent_send async error`, {
						name: params.name,
						error: err.message,
					});
					pi.sendUserMessage(`[${params.name}] Error: ${err.message}`, {
						deliverAs: "steer",
					});
				} finally {
					pendingTasks.delete(taskId);
				}
			});

			return {
				content: [
					{
						type: "text",
						text: `Queued task for '${params.name}'. Result will be delivered when the agent completes.`,
					},
				],
				details: { queued: true, agent: params.name, taskId },
			};
		},
	});

	pi.registerTool({
		name: "agent_steer",
		label: "Steer Agent",
		description:
			"Send a steering message to an active agent mid-turn. Use this if an agent appears stuck or needs course correction.",
		parameters: Type.Object({
			name: Type.String({ description: "Agent instance name" }),
			message: Type.String({
				description: "Steering instruction to send immediately",
			}),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const agent = agents.get(params.name);
			if (!agent) {
				return {
					content: [
						{ type: "text", text: `Agent '${params.name}' not found.` },
					],
					isError: true,
					details: {},
				};
			}
			agent.stdin.write(
				JSON.stringify({ type: "steer", message: params.message }) + "\n",
			);
			log("steer", `Steered agent '${params.name}'`, {
				message: params.message,
			});
			return {
				content: [{ type: "text", text: `Steered '${params.name}'.` }],
				details: { name: params.name },
			};
		},
	});

	pi.registerTool({
		name: "agent_status",
		label: "Agent Status",
		description:
			"Check the status of all spawned agents or one specific agent.",
		parameters: Type.Object({
			name: Type.Optional(
				Type.String({ description: "Optional agent instance name" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			if (params.name) {
				const agent = agents.get(params.name);
				if (!agent)
					return {
						content: [
							{ type: "text", text: `Agent '${params.name}' not found.` },
						],
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
					{
						type: "text",
						text: list.length
							? JSON.stringify(list, null, 2)
							: "No active agents.",
					},
				],
				details: { agents: list },
			};
		},
	});

	// Orchestrator-only: create sub-agents with explicit reasoning
	pi.registerTool({
		name: "create_sub_agent",
		label: "Create Sub-Agent",
		description:
			"Create a new sub-agent. Provide a clear reason. Only the orchestrator should call this.",
		parameters: Type.Object({
			name: Type.String({
				description: "Unique agent name (e.g. researcher, implementer)",
			}),
			type: Type.String({ description: "Agent definition type" }),
			reason: Type.String({ description: "Why this sub-agent is needed" }),
			model: Type.Optional(
				Type.String({ description: "Optional model override" }),
			),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			log("tool", "create_sub_agent called", {
				name: params.name,
				type: params.type,
				reason: params.reason,
				orchestrationMode,
			});

			if (!orchestrationMode) {
				return {
					content: [
						{
							type: "text",
							text: "Orchestration mode is not enabled. Ask the user to run /orchestrate before creating sub-agents.",
						},
					],
					isError: true,
					details: { orchestrationMode },
				};
			}

			const definition = getDefinition(params.type, ctx.cwd);
			if (!definition) {
				return {
					content: [
						{ type: "text", text: `Agent type '${params.type}' not found.` },
					],
					isError: true,
					details: {},
				};
			}
			if (!isSpawnableAgentDefinition(definition)) {
				return {
					content: [
						{
							type: "text",
							text:
								nonSpawnableAgentReason(definition) ||
								`Agent type '${definition.name}' is not spawnable.`,
						},
					],
					isError: true,
					details: { definition },
				};
			}

			const capabilities = resolveCapabilities({
				cwd: ctx.cwd,
				definition,
				availableExtensions: discoverExtensions(ctx.cwd),
			});
			if (capabilities.errors.length) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot create sub-agent with invalid capabilities:\n${capabilities.errors.map((error) => `- ${error}`).join("\n")}`,
						},
					],
					isError: true,
					details: { errors: capabilities.errors },
				};
			}
			if (capabilities.skillConflicts.length) {
				return {
					content: [
						{
							type: "text",
							text: `Cannot create sub-agent with conflicting runtime skill names:\n${capabilities.skillConflicts.map((conflict) => `- ${conflict.name}: ${conflict.paths.join(", ")}`).join("\n")}`,
						},
					],
					isError: true,
					details: { skillConflicts: capabilities.skillConflicts },
				};
			}
			const resolvedDefinition = { ...definition, skills: capabilities.skills };

			const result = await spawnAgent(params.name, {
				model: params.model,
				repoCwd: ctx.cwd,
				definition: resolvedDefinition,
				parent: undefined,
				extensions: capabilities.extensions,
			});

			if (result.error || !result.agent) {
				return {
					content: [
						{
							type: "text",
							text: result.error || "Failed to create sub-agent",
						},
					],
					isError: true,
					details: {},
				};
			}

			agents.set(params.name, result.agent);
			broadcast({
				type: "agent-spawned",
				data: serializeAgentForDashboard(result.agent),
			});
			log(
				"spawn",
				`Orchestrator created '${params.name}' (type: ${params.type}) - ${params.reason}`,
			);

			return {
				content: [
					{
						type: "text",
						text: `Created sub-agent '${params.name}' (type: ${params.type}). Reason: ${params.reason}.`,
					},
				],
				details: {
					name: params.name,
					type: params.type,
					reason: params.reason,
				},
			};
		},
	});

	pi.registerTool({
		name: "agent_kill",
		label: "Kill Agent",
		description:
			"Terminate an agent and its children, removing their worktree if root.",
		parameters: Type.Object({
			name: Type.String({ description: "Agent instance name" }),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const agent = agents.get(params.name);
			if (!agent)
				return {
					content: [
						{ type: "text", text: `Agent '${params.name}' not found.` },
					],
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

	pi.registerCommand("orchestrate", {
		description:
			"Enable orchestration mode with a root profile. Usage: /orchestrate [profile|off|status]",
		getArgumentCompletions: (prefix: string) => {
			const profiles = discoverRootProfiles(process.cwd());
			const fixed = ["off", "status"];
			const items = [...fixed, ...profiles.map((profile) => profile.name)]
				.filter((value) => value.startsWith(prefix))
				.map((value) => ({ value, label: value }));
			return items.length ? items : null;
		},
		handler: async (arg, ctx) => {
			const raw = (arg || "").trim();
			const mode = raw.toLowerCase();
			if (mode === "off" || mode === "false" || mode === "disable") {
				orchestrationMode = false;
				activeRootProfileName = undefined;
				activeRootProfile = undefined;
				pi.appendEntry(ORCHESTRATION_STATE_ENTRY, {
					enabled: false,
					timestamp: Date.now(),
				});
				log("mode", "orchestration mode disabled");
				ctx.ui.setStatus("orchestrator", "");
				ctx.ui.notify(
					"Orchestration mode disabled. Normal Pi mode active. Reloading root session resources…",
					"info",
				);
				await ctx.reload();
				return;
			}
			if (mode === "status") {
				ctx.ui.notify(
					`Orchestration mode is ${orchestrationMode ? "enabled" : "disabled"}${activeRootProfileName ? ` (profile: ${activeRootProfileName})` : ""}.`,
					"info",
				);
				return;
			}

			const profiles = discoverRootProfiles(ctx.cwd);
			let choice = chooseRootProfileActivation(raw, profiles);
			if (choice.action === "error") {
				ctx.ui.notify(choice.error, "error");
				return;
			}
			if (choice.action === "select") {
				const selected = await ctx.ui.select(
					"Select root orchestrator profile",
					choice.profiles.map((profile) => profile.name),
				);
				if (!selected) {
					ctx.ui.notify(
						"Orchestration profile selection cancelled.",
						"warning",
					);
					return;
				}
				choice = chooseRootProfileActivation(selected, profiles);
				if (choice.action !== "activate") {
					ctx.ui.notify(
						choice.action === "error"
							? choice.error
							: "No orchestrator profile selected.",
						"error",
					);
					return;
				}
			}

			const profile = choice.profile;
			const capabilities = resolveRootProfileCapabilities({
				cwd: ctx.cwd,
				profile,
			});
			if (capabilities.errors.length || capabilities.skillConflicts.length) {
				const errors = [
					...capabilities.errors,
					...capabilities.skillConflicts.map(
						(conflict) =>
							`Conflicting runtime skill name '${conflict.name}': ${conflict.paths.join(", ")}`,
					),
				];
				ctx.ui.notify(
					`Cannot activate root profile '${profile.name}':\n${errors.join("\n")}`,
					"error",
				);
				return;
			}

			orchestrationMode = true;
			activeRootProfileName = profile.name;
			activeRootProfile = profile;
			pi.appendEntry(ORCHESTRATION_STATE_ENTRY, {
				enabled: true,
				profile: profile.name,
				timestamp: Date.now(),
			});
			log("mode", "orchestration mode enabled", { profile: profile.name });
			ctx.ui.setStatus("orchestrator", `orchestrator: ${profile.name}`);
			ctx.ui.notify(
				[
					`Orchestration mode enabled with root profile '${profile.name}'.`,
					"Profile skills and instructions will be loaded by reloading the root session resources.",
					"Use /orchestrate off to return to normal Pi mode.",
				].join("\n"),
				"info",
			);
			await ctx.reload();
			return;
		},
	});

	pi.registerCommand("agent-types", {
		description: "List available agent definitions",
		handler: async (_args, ctx) => {
			const defs = discoverDefinitions(ctx.cwd);
			const lines = defs.map(
				(d) => `- ${d.name} (${d.source}): ${d.description}`,
			);
			ctx.ui.notify(
				defs.length ? lines.join("\n") : "No agent definitions found.",
				"info",
			);
		},
	});

	pi.registerCommand("spawn", {
		description:
			"Spawn a named agent. Usage: /spawn <name> <parent|'self'> [type|model]",
		handler: async (args, ctx) => {
			const parts = args.trim().split(/\s+/);
			const name = parts[0];
			const parent = parts[1];
			const typeOrModel = parts[2];

			if (!name || !parent) {
				ctx.ui.notify(
					"Usage: /spawn <name> <parent|'self'> [type|model]",
					"error",
				);
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
				ctx.ui.notify(
					`Agent '${name}' exited immediately after spawn. Check logs.`,
					"error",
				);
				return;
			}

			const defInfo = definition ? ` (type: ${definition.name})` : "";
			ctx.ui.notify(
				`Spawned agent '${name}'${defInfo} (parent: ${parent}).`,
				"info",
			);
		},
	});

	pi.registerCommand("ask", {
		description:
			"Send a message to an agent and show its reply. Usage: /ask <name> <message>",
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

	pi.registerCommand("worktrees", {
		description: "List active agent worktrees and VS Code open commands.",
		handler: async (_args, ctx) => {
			if (agents.size === 0) {
				ctx.ui.notify("No active agent worktrees.", "info");
				return;
			}
			const lines = Array.from(agents.entries()).map(([name, agent]) => {
				return [
					`${name}: ${agent.worktreePath}`,
					`  VS Code: code ${agent.worktreePath}`,
				].join("\n");
			});
			ctx.ui.notify(lines.join("\n\n"), "info");
		},
	});

	pi.registerCommand("kill", {
		description: "Kill a spawned agent. Usage: /kill <name> or /kill all",
		handler: async (name, ctx) => {
			if (name === "all") {
				let count = 0;
				for (const [id, agent] of agents) {
					if (!agent.proc.killed) {
						try {
							agent.proc.kill("SIGTERM");
						} catch (err: any) {
							log("lifecycle", `Failed to kill agent '${id}': ${err.message}`);
						}
					}
					if (!agent.parent) {
						await removeWorktree(agent.worktreePath);
					}
					count++;
				}
				agents.clear();
				ctx.ui.notify(
					`Killed all ${count} agents and cleaned worktrees.`,
					"info",
				);
				return;
			}

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
			// Try to open browser; missing desktop openers should not crash Pi.
			const { spawn } = await import("node:child_process");
			const platform = process.platform;
			const command =
				platform === "win32"
					? { cmd: "cmd", args: ["/c", "start", "", serverHandle.url] }
					: { cmd: platform === "darwin" ? "open" : "xdg-open", args: [serverHandle.url] };
			try {
				const opener = spawn(command.cmd, command.args, { detached: true, stdio: "ignore" });
				opener.on("error", () => {
					/* ignore open failures */
				});
				opener.unref();
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
				const all = fs
					.readFileSync(LOG_FILE, "utf-8")
					.split("\n")
					.filter(Boolean);
				const recent = all.slice(-lines).join("\n");
				ctx.ui.notify(recent || "No logs yet.", "info");
			} catch {
				ctx.ui.notify("Log file not found.", "error");
			}
		},
	});
}
