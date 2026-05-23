import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { type Agent, type AgentDefinition, agents, log } from "./state.js";
import { rpcCommand, steerAgent, type AgentSendUpdate } from "./send.js";
import {
	logRuntimeToolConflicts,
	readRuntimeToolSnapshot,
} from "./runtime-tools.js";
import type { DraftAgentPromptOptions } from "./prompt-draft.js";

// ── Types ──

export interface ServerDeps {
	repoCwd: string;
	spawnAgent: (
		id: string,
		options: any,
	) => Promise<{ agent: Agent; error?: string }>;
	sendToAgent: (
		agent: Agent,
		message: string,
		timeoutMs: number,
		signal?: AbortSignal,
		onUpdate?: (update: AgentSendUpdate) => void,
	) => Promise<void>;
	removeWorktree: (worktreePath: string) => Promise<void>;
	discoverDefinitions: (cwd: string) => AgentDefinition[];
	getDefinition: (name: string, cwd: string) => AgentDefinition | undefined;
	discoverExtensions: (cwd: string) => Array<{
		name: string;
		path: string;
		scope: string;
		description?: string;
		expectedTools?: string[];
		metadataStatus?: string;
		metadataSource?: string;
	}>;
	currentModel?: () => string | undefined;
	draftAgentPrompt?: (options: DraftAgentPromptOptions) => Promise<string>;
}

interface ServerHandle {
	url: string;
	stop: () => void;
}

interface AgentTypeTestSession {
	id: string;
	agentType: string;
	agent: Agent;
	createdAt: number;
}

// ── SSE state ──

const sseClients = new Set<http.ServerResponse>();

export function broadcast(event: { type: string; data: any }) {
	const payload = `data: ${JSON.stringify(event)}\n\n`;
	const toRemove: http.ServerResponse[] = [];
	for (const res of sseClients) {
		try {
			res.write(payload);
		} catch {
			toRemove.push(res);
		}
	}
	for (const res of toRemove) {
		sseClients.delete(res);
	}
}

// ── Helpers ──

function serializeAgent(agent: Agent) {
	agent.runtimeTools = readRuntimeToolSnapshot(agent.worktreePath);
	logRuntimeToolConflicts(agent.id, agent.runtimeTools);
	return {
		name: agent.id,
		status: agent.status,
		definition: agent.definition?.name,
		model: agent.model || agent.definition?.model,
		parent: agent.parent,
		children: agent.children,
		turns: Math.floor(agent.history.length / 2),
		worktree: agent.worktreePath,
		issueId: agent.issueId,
		artifactPath: agent.artifactPath,
		artifactFiles: agent.artifactFiles,
		runtimeTools: agent.runtimeTools,
		pendingSend: agent.pendingSend,
	};
}

function jsonResponse(
	data: any,
	status = 200,
): { status: number; body: string; headers: Record<string, string> } {
	return {
		status,
		body: JSON.stringify(data),
		headers: { "Content-Type": "application/json" },
	};
}

function errorResponse(message: string, status = 400) {
	return jsonResponse({ error: message }, status);
}

function corsHeaders(): Record<string, string> {
	return {
		"Access-Control-Allow-Origin": "http://localhost:18765",
		"Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
		"Access-Control-Allow-Headers": "Content-Type",
	};
}

function send(
	res: http.ServerResponse,
	{ status, body, headers }: ReturnType<typeof jsonResponse>,
) {
	res.writeHead(status, { ...headers, ...corsHeaders() });
	res.end(body);
}

function contentTypeFor(filePath: string): string {
	if (filePath.endsWith(".html")) return "text/html";
	if (filePath.endsWith(".js")) return "application/javascript";
	if (filePath.endsWith(".css")) return "text/css";
	if (filePath.endsWith(".map")) return "application/json";
	return "application/octet-stream";
}

function sendStatic(res: http.ServerResponse, filePath: string): boolean {
	if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
	res.writeHead(200, {
		"Content-Type": contentTypeFor(filePath),
		...corsHeaders(),
	});
	fs.createReadStream(filePath).pipe(res);
	return true;
}

function readStderrTail(worktreePath: string): string | undefined {
	const filePath = path.join(worktreePath, ".pi", "stderr.log");
	try {
		if (!fs.existsSync(filePath)) return undefined;
		const text = fs.readFileSync(filePath, "utf-8").trim();
		return text ? text.slice(-4_000) : undefined;
	} catch {
		return undefined;
	}
}

function serializeAgentTypeTestSession(session: AgentTypeTestSession) {
	const runtimeTools = readRuntimeToolSnapshot(session.agent.worktreePath);
	logRuntimeToolConflicts(session.id, runtimeTools);
	return {
		id: session.id,
		agentType: session.agentType,
		status: session.agent.status,
		worktree: session.agent.worktreePath,
		createdAt: session.createdAt,
		runtimeTools,
		stderrTail: readStderrTail(session.agent.worktreePath),
	};
}

// ── Port probing ──

function tryPort(port: number): Promise<number> {
	return new Promise((resolve, reject) => {
		const server = http.createServer();
		server.once("error", reject);
		server.listen(port, () => {
			server.close(() => resolve(port));
		});
	});
}

export async function findPort(
	preferred = [18765, 18766, 18767],
): Promise<number> {
	for (const port of preferred) {
		try {
			return await tryPort(port);
		} catch {
			/* try next */
		}
	}
	return 0; // let OS assign
}

// ── Body parsing ──

function readBody(req: http.IncomingMessage): Promise<string> {
	return new Promise((resolve) => {
		let body = "";
		req.on("data", (chunk) => {
			body += chunk.toString();
		});
		req.on("end", () => resolve(body));
	});
}

// ── Server startup ──

export async function startServer(deps: ServerDeps): Promise<ServerHandle> {
	const port = await findPort();
	const agentTypeTestSessions = new Map<string, AgentTypeTestSession>();
	const cleanupAgentTypeTestSession = async (session: AgentTypeTestSession) => {
		try {
			if (!session.agent.proc.killed) session.agent.proc.kill("SIGTERM");
		} catch {
			/* ignore */
		}
		await deps.removeWorktree(session.agent.worktreePath).catch(() => {});
		agentTypeTestSessions.delete(session.id);
	};

	const server = http.createServer(async (req, res) => {
		const url = new URL(req.url || "/", `http://localhost:${port}`);

		// CORS preflight
		if (req.method === "OPTIONS") {
			res.writeHead(204, corsHeaders());
			res.end();
			return;
		}

		// Static: dashboard
		const webDir = path.join(__dirname, "..", "..", "web");
		if (
			url.pathname === "/" ||
			url.pathname === "/dashboard" ||
			url.pathname === "/index.html"
		) {
			if (!sendStatic(res, path.join(webDir, "index.html")))
				send(res, errorResponse("Dashboard not found", 404));
			return;
		}
		if (["/app.js", "/app.css"].includes(url.pathname)) {
			const filePath = path.join(webDir, path.basename(url.pathname));
			if (!sendStatic(res, filePath))
				send(res, errorResponse("Dashboard asset not found", 404));
			return;
		}

		// SSE: live event stream
		if (url.pathname === "/events") {
			res.writeHead(200, {
				...corsHeaders(),
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			});
			sseClients.add(res);
			const initEvent = {
				type: "init",
				data: {
					agents: Object.fromEntries(
						Array.from(agents.entries()).map(([k, v]) => [
							k,
							serializeAgent(v),
						]),
					),
				},
			};
			res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
			req.on("close", () => {
				sseClients.delete(res);
			});
			return;
		}

		// REST API

		// GET /api/agent-stats
		if (url.pathname === "/api/agent-stats" && req.method === "GET") {
			const entries = await Promise.all(
				Array.from(agents.entries()).map(async ([name, agent]) => {
					try {
						const stats = await rpcCommand(
							agent,
							{ type: "get_session_stats" },
							5_000,
						);
						const state = await rpcCommand(
							agent,
							{ type: "get_state" },
							5_000,
						).catch(() => undefined);
						return [name, { stats, state }];
					} catch (err: any) {
						return [name, { error: err.message }];
					}
				}),
			);
			send(res, jsonResponse(Object.fromEntries(entries)));
			return;
		}

		// GET /api/agents
		if (url.pathname === "/api/agents" && req.method === "GET") {
			const list = Array.from(agents.entries()).map(([_, a]) =>
				serializeAgent(a),
			);
			send(res, jsonResponse(list));
			return;
		}

		// GET /api/roadmap
		if (url.pathname === "/api/roadmap" && req.method === "GET") {
			const { readRoadmapOverview } = await import("./roadmap.js");
			send(res, jsonResponse(readRoadmapOverview(deps.repoCwd)));
			return;
		}

		// Orchestrator Library API
		if (
			url.pathname === "/api/orchestrator-libraries" &&
			req.method === "GET"
		) {
			const { discoverConfiguredOrchestratorLibraries } = await import(
				"./orchestrator-library.js"
			);
			send(
				res,
				jsonResponse(discoverConfiguredOrchestratorLibraries(deps.repoCwd)),
			);
			return;
		}
		if (
			url.pathname === "/api/orchestrator-libraries/enabled" &&
			req.method === "PUT"
		) {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { updateOrchestratorLibraryEnabled } = await import(
				"./orchestrator-library.js"
			);
			const result = updateOrchestratorLibraryEnabled(
				{ root: body.root, enabled: body.enabled },
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.discovery));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to update Orchestrator Library state",
						result.status || 400,
					),
				);
			return;
		}
		if (
			url.pathname === "/api/orchestrator-libraries/display-settings" &&
			req.method === "PUT"
		) {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { updateOrchestratorDisplaySettings } = await import(
				"./orchestrator-library.js"
			);
			const result = updateOrchestratorDisplaySettings(
				{ showPackageExamples: body.showPackageExamples },
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.settings));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to update display settings",
						result.status || 400,
					),
				);
			return;
		}
		if (
			url.pathname === "/api/orchestrator-libraries/bootstrap" &&
			req.method === "POST"
		) {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { bootstrapOrchestratorLibrary } = await import(
				"./orchestrator-library.js"
			);
			const result = bootstrapOrchestratorLibrary(
				{
					targetPath: body.targetPath,
					name: body.name,
					description: body.description,
				},
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to bootstrap Orchestrator Library",
						result.status || 400,
					),
				);
			return;
		}

		// Resource source settings API
		if (url.pathname === "/api/resource-settings" && req.method === "GET") {
			const { readResourceSettings } = await import("./resource-settings.js");
			send(res, jsonResponse(readResourceSettings(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/resource-settings" && req.method === "PUT") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { updateResourceSettings } = await import("./resource-settings.js");
			const result = updateResourceSettings(
				{ scope: body.scope, skills: body.skills, extensions: body.extensions },
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.settings));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to update resource settings",
						result.status || 400,
					),
				);
			return;
		}

		// Skill library API
		if (url.pathname === "/api/skills" && req.method === "GET") {
			const { discoverSkills } = await import("./skill-discovery.js");
			send(res, jsonResponse(await discoverSkills(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/skill-diagnostics" && req.method === "GET") {
			const { discoverSkillDiagnostics } = await import("./skill-discovery.js");
			send(res, jsonResponse(await discoverSkillDiagnostics(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/skills" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { createSkill } = await import("./skill-discovery.js");
			const result = await createSkill(
				{
					scope: body.scope,
					targetLibrary: body.targetLibrary,
					name: body.name,
					description: body.description,
					body: body.body,
					scaffold: body.scaffold,
				},
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.detail));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to create skill",
						result.status || 400,
					),
				);
			return;
		}
		const skillCopyMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/copy$/);
		if (skillCopyMatch && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { copySkill } = await import("./skill-discovery.js");
			const result = await copySkill(
				decodeURIComponent(skillCopyMatch[1]),
				{
					scope: body.scope,
					targetLibrary: body.targetLibrary,
					name: body.name,
					description: body.description,
				},
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.detail));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to copy skill",
						result.status || 400,
					),
				);
			return;
		}
		const skillMatch = url.pathname.match(/^\/api\/skills\/([^/]+)$/);
		const skillTreeMatch = url.pathname.match(/^\/api\/skills\/([^/]+)\/tree$/);
		if (skillTreeMatch && req.method === "GET") {
			const { getSkillTree } = await import("./skill-discovery.js");
			const result = await getSkillTree(
				decodeURIComponent(skillTreeMatch[1]),
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse({ files: result.files }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to load skill tree",
						result.status || 400,
					),
				);
			return;
		}
		const skillFileMatch = url.pathname.match(
			/^\/api\/skills\/([^/]+)\/files$/,
		);
		if (skillFileMatch && req.method === "GET") {
			const { getSkillFile } = await import("./skill-discovery.js");
			const result = await getSkillFile(
				decodeURIComponent(skillFileMatch[1]),
				url.searchParams.get("path") || "",
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.file));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to load skill file",
						result.status || 400,
					),
				);
			return;
		}
		if (skillFileMatch && req.method === "PUT") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { updateSkillFile } = await import("./skill-discovery.js");
			const result = await updateSkillFile(
				decodeURIComponent(skillFileMatch[1]),
				url.searchParams.get("path") || "",
				{ content: body.content, expectedHash: body.expectedHash },
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.file));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to update skill file",
						result.status || 400,
					),
				);
			return;
		}
		if (skillMatch && req.method === "GET") {
			const { getSkillDetail } = await import("./skill-discovery.js");
			const detail = await getSkillDetail(
				decodeURIComponent(skillMatch[1]),
				deps.repoCwd,
			);
			if (detail) send(res, jsonResponse(detail));
			else send(res, errorResponse("Skill not found", 404));
			return;
		}
		if (skillMatch && req.method === "PUT") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { updateSkill } = await import("./skill-discovery.js");
			const result = await updateSkill(
				decodeURIComponent(skillMatch[1]),
				{ content: body.content, expectedHash: body.expectedHash },
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse(result.detail));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to update skill",
						result.status || 400,
					),
				);
			return;
		}
		if (skillMatch && req.method === "DELETE") {
			const { deleteSkill } = await import("./skill-discovery.js");
			const result = await deleteSkill(
				decodeURIComponent(skillMatch[1]),
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse({ success: true }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to delete skill",
						result.status || 400,
					),
				);
			return;
		}

		// GET /api/extensions
		if (url.pathname === "/api/extensions" && req.method === "GET") {
			const exts = deps.discoverExtensions(deps.repoCwd);
			send(
				res,
				jsonResponse(
					exts.map((e) => ({
						name: e.name,
						scope: e.scope,
						description: (e as any).description,
						expectedTools: (e as any).expectedTools,
						metadataStatus: (e as any).metadataStatus || "unknown",
						metadataSource: (e as any).metadataSource,
					})),
				),
			);
			return;
		}

		// Root Orchestrator Profile API
		if (url.pathname === "/api/root-profiles" && req.method === "GET") {
			const { discoverRootProfiles } = await import("./root-profiles.js");
			send(res, jsonResponse(discoverRootProfiles(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/root-profiles" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { saveRootProfile } = await import("./root-profiles.js");
			const result = saveRootProfile(
				{
					targetLibrary: body.targetLibrary,
					name: body.name,
					description: body.description,
					skills: body.skills || [],
					skillTemplates: body.skillTemplates || [],
					instructions: body.instructions || body.prompt || "",
					expectedHash: body.expectedHash,
				},
				deps.repoCwd,
			);
			if (result.success)
				send(
					res,
					jsonResponse({
						success: true,
						path: result.path,
						detail: result.detail,
					}),
				);
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to save root profile",
						result.status || 400,
					),
				);
			return;
		}
		const rootProfileCopyMatch = url.pathname.match(
			/^\/api\/root-profiles\/([^/]+)\/copy$/,
		);
		if (rootProfileCopyMatch && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { copyRootProfile } = await import("./root-profiles.js");
			const result = copyRootProfile(
				decodeURIComponent(rootProfileCopyMatch[1]),
				{
					targetLibrary: body.targetLibrary,
					name: body.name,
					description: body.description,
				},
				deps.repoCwd,
			);
			if (result.success)
				send(
					res,
					jsonResponse({
						success: true,
						path: result.path,
						detail: result.detail,
					}),
				);
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to copy root profile",
						result.status || 400,
					),
				);
			return;
		}
		const rootProfileMatch = url.pathname.match(
			/^\/api\/root-profiles\/([^/]+)$/,
		);
		if (rootProfileMatch && req.method === "GET") {
			const { getRootProfileDetail } = await import("./root-profiles.js");
			const detail = getRootProfileDetail(
				decodeURIComponent(rootProfileMatch[1]),
				deps.repoCwd,
			);
			if (detail) send(res, jsonResponse(detail));
			else send(res, errorResponse("Root profile not found", 404));
			return;
		}
		if (rootProfileMatch && req.method === "DELETE") {
			const { deleteRootProfile } = await import("./root-profiles.js");
			const result = deleteRootProfile(
				decodeURIComponent(rootProfileMatch[1]),
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse({ success: true }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to delete root profile",
						result.status || 400,
					),
				);
			return;
		}

		// GET /api/agent-types
		if (url.pathname === "/api/agent-types" && req.method === "GET") {
			const { readOrchestratorDisplaySettings } = await import(
				"./orchestrator-library.js"
			);
			const { isSpawnableAgentDefinition } = await import("./definitions.js");
			const displaySettings = readOrchestratorDisplaySettings(deps.repoCwd);
			const defs = deps
				.discoverDefinitions(deps.repoCwd)
				.filter(isSpawnableAgentDefinition)
				.filter(
					(d) =>
						displaySettings.showPackageExamples ||
						!(d.source === "package" && d.example),
				);
			send(
				res,
				jsonResponse(
					defs.map((d) => ({
						name: d.name,
						description: d.description,
						agentClass: d.agentClass,
						model: d.model,
						thinking: (d as any).thinking,
						tools: d.tools,
						noTools: d.noTools,
						skills: d.skills,
						noSkills: d.noSkills,
						skillTemplates: d.skillTemplates,
						extensionTemplates: d.extensionTemplates,
						noExtensions: d.noExtensions,
						noContextFiles: d.noContextFiles,
						isolated: d.isolated,
						delegate: d.delegate,
						prompt: d.systemPrompt,
						systemPrompt: d.systemPrompt,
						source: d.source,
					})),
				),
			);
			return;
		}

		// GET /api/models
		if (url.pathname === "/api/models" && req.method === "GET") {
			const { getAvailableModelInfos } = await import("./models.js");
			const models = getAvailableModelInfos();
			send(res, jsonResponse(models));
			return;
		}

		if (
			url.pathname === "/api/agent-types/draft-prompt" &&
			req.method === "POST"
		) {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			try {
				const { draftAgentPrompt } = await import("./prompt-draft.js");
				const draft = await (deps.draftAgentPrompt || draftAgentPrompt)({
					repoCwd: deps.repoCwd,
					name: typeof body.name === "string" ? body.name : undefined,
					description:
						typeof body.description === "string" ? body.description : undefined,
					agentClass: body.agentClass || body.class,
					model:
						typeof body.model === "string" ? body.model : deps.currentModel?.(),
					thinking:
						typeof body.thinking === "string" ? body.thinking : undefined,
					skillTemplates: Array.isArray(body.skillTemplates)
						? body.skillTemplates.filter(
								(value: any) => typeof value === "string",
							)
						: [],
					extensionTemplates: Array.isArray(body.extensionTemplates)
						? body.extensionTemplates.filter(
								(value: any) => typeof value === "string",
							)
						: [],
					existingPrompt:
						typeof body.existingPrompt === "string"
							? body.existingPrompt
							: undefined,
				});
				send(res, jsonResponse({ success: true, prompt: draft }));
			} catch (err: any) {
				send(
					res,
					jsonResponse(
						{ success: false, error: err?.message || String(err) },
						500,
					),
				);
			}
			return;
		}

		// POST /api/agent-types (save / update)
		if (url.pathname === "/api/agent-types" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			if (!body.name || !body.description) {
				send(res, errorResponse("name and description are required", 400));
				return;
			}
			const {
				normalizeAgentClass,
				saveAgentDefinition,
				isSpawnableAgentDefinition,
				nonSpawnableAgentReason,
			} = await import("./definitions.js");
			const agentClass = normalizeAgentClass(
				body.agentClass || body.class,
				body.name,
			);
			const candidate = {
				name: body.name,
				description: body.description,
				agentClass,
			} as any;
			if (!isSpawnableAgentDefinition(candidate)) {
				send(
					res,
					errorResponse(
						nonSpawnableAgentReason(candidate) || "Agent type is not spawnable",
						403,
					),
				);
				return;
			}
			const result = saveAgentDefinition(
				{
					name: body.name,
					description: body.description,
					agentClass,
					model: body.model,
					thinking: body.thinking,
					tools: body.tools,
					noTools: body.noTools,
					skills: body.skills,
					noSkills: body.noSkills,
					skillTemplates: body.skillTemplates,
					extensionTemplates: body.extensionTemplates,
					noExtensions: body.noExtensions,
					noContextFiles: body.noContextFiles,
					isolated: body.isolated,
					delegate: body.delegate,
					systemPrompt: body.prompt || body.systemPrompt || "",
					source: "project",
					filePath: "",
				},
				deps.repoCwd,
			);
			if (result.success) {
				send(res, jsonResponse({ success: true, path: result.path }));
			} else {
				send(
					res,
					errorResponse(result.error || "Failed to save", result.status || 500),
				);
			}
			return;
		}

		const agentTypeTestSessionMatch = url.pathname.match(
			/^\/api\/agent-types\/([^/]+)\/test-session$/,
		);
		if (agentTypeTestSessionMatch && req.method === "POST") {
			const typeName = decodeURIComponent(agentTypeTestSessionMatch[1]);
			const { isSpawnableAgentDefinition, nonSpawnableAgentReason } =
				await import("./definitions.js");
			const { resolveCapabilities } = await import(
				"./capability-resolution.js"
			);
			const definition = deps.getDefinition(typeName, deps.repoCwd);
			if (!definition) {
				const available =
					deps
						.discoverDefinitions(deps.repoCwd)
						.filter(isSpawnableAgentDefinition)
						.map((d) => d.name)
						.join(", ") || "none";
				send(
					res,
					errorResponse(
						`Agent type '${typeName}' not found. Available: ${available}`,
						404,
					),
				);
				return;
			}
			if (!isSpawnableAgentDefinition(definition)) {
				send(
					res,
					errorResponse(
						nonSpawnableAgentReason(definition) ||
							`Agent type '${definition.name}' is not spawnable`,
						403,
					),
				);
				return;
			}
			const capabilities = resolveCapabilities({
				cwd: deps.repoCwd,
				definition,
				availableExtensions: deps.discoverExtensions(deps.repoCwd),
			});
			if (capabilities.errors.length) {
				send(
					res,
					jsonResponse(
						{
							success: false,
							diagnostics: capabilities.errors.map((message) => ({
								level: "error",
								message,
							})),
						},
						400,
					),
				);
				return;
			}
			if (capabilities.skillConflicts.length) {
				send(
					res,
					jsonResponse(
						{
							success: false,
							skillConflicts: capabilities.skillConflicts,
							diagnostics: capabilities.skillConflicts.map((conflict) => ({
								level: "error",
								message: `Runtime skill name '${conflict.name}' is provided by multiple paths: ${conflict.paths.join(", ")}`,
							})),
						},
						400,
					),
				);
				return;
			}
			const sessionId = `agent-type-test-${typeName.replace(/[^a-zA-Z0-9_-]/g, "-")}-${Date.now()}`;
			const resolvedDefinition = { ...definition, skills: capabilities.skills };
			const result = await deps.spawnAgent(sessionId, {
				model: deps.currentModel?.(),
				repoCwd: deps.repoCwd,
				definition: resolvedDefinition,
				extensions: capabilities.extensions,
				dashboardVisible: false,
			});
			if (result.error || !result.agent) {
				send(
					res,
					jsonResponse(
						{
							success: false,
							diagnostics: [
								{
									level: "error",
									message:
										result.error || "Agent type test session failed to spawn.",
								},
							],
						},
						500,
					),
				);
				return;
			}
			const session: AgentTypeTestSession = {
				id: sessionId,
				agentType: definition.name,
				agent: result.agent,
				createdAt: Date.now(),
			};
			agentTypeTestSessions.set(sessionId, session);
			send(
				res,
				jsonResponse({
					success: true,
					session: serializeAgentTypeTestSession(session),
					diagnostics: [
						{
							level: "info",
							message: `Started disposable test session '${sessionId}' for agent type '${definition.name}'.`,
						},
					],
				}),
			);
			return;
		}

		const agentTypeTestSessionMessageMatch = url.pathname.match(
			/^\/api\/agent-type-test-sessions\/([^/]+)\/messages$/,
		);
		if (agentTypeTestSessionMessageMatch && req.method === "POST") {
			const sessionId = decodeURIComponent(agentTypeTestSessionMessageMatch[1]);
			const session = agentTypeTestSessions.get(sessionId);
			if (!session) {
				send(
					res,
					errorResponse(
						`Agent type test session '${sessionId}' not found`,
						404,
					),
				);
				return;
			}
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const message =
				typeof body.message === "string" ? body.message.trim() : "";
			if (!message) {
				send(res, errorResponse("message is required", 400));
				return;
			}
			try {
				await deps.sendToAgent(
					session.agent,
					message,
					(body.timeoutSeconds || 120) * 1000,
				);
				send(
					res,
					jsonResponse({
						success: true,
						response: session.agent.accumulatedText || "",
						session: serializeAgentTypeTestSession(session),
					}),
				);
			} catch (err: any) {
				send(
					res,
					jsonResponse(
						{
							success: false,
							error: err?.message || String(err),
							session: serializeAgentTypeTestSession(session),
						},
						500,
					),
				);
			}
			return;
		}

		const agentTypeTestSessionMatchById = url.pathname.match(
			/^\/api\/agent-type-test-sessions\/([^/]+)$/,
		);
		if (agentTypeTestSessionMatchById && req.method === "DELETE") {
			const sessionId = decodeURIComponent(agentTypeTestSessionMatchById[1]);
			const session = agentTypeTestSessions.get(sessionId);
			if (!session) {
				send(
					res,
					errorResponse(
						`Agent type test session '${sessionId}' not found`,
						404,
					),
				);
				return;
			}
			await cleanupAgentTypeTestSession(session);
			send(res, jsonResponse({ success: true }));
			return;
		}

		// Skill template CRUD
		if (url.pathname === "/api/skill-templates" && req.method === "GET") {
			const { discoverSkillTemplates } = await import("./skill-templates.js");
			send(res, jsonResponse(discoverSkillTemplates(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/skill-templates" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { saveSkillTemplate } = await import("./skill-templates.js");
			const result = saveSkillTemplate(
				{
					name: body.name,
					description: body.description,
					items: body.skills || body.items || [],
					audience: body.audience,
					autoApply: body.autoApply,
					applyToAll: !!body.applyToAll,
					targetLibrary: body.targetLibrary,
				},
				deps.repoCwd,
			);
			if (result.success)
				send(res, jsonResponse({ success: true, path: result.path }));
			else
				send(
					res,
					errorResponse(result.error || "Failed to save skill template", 400),
				);
			return;
		}
		const skillTemplateMatch = url.pathname.match(
			/^\/api\/skill-templates\/([^/]+)$/,
		);
		if (skillTemplateMatch && req.method === "GET") {
			const { getSkillTemplate } = await import("./skill-templates.js");
			const template = getSkillTemplate(
				decodeURIComponent(skillTemplateMatch[1]),
				deps.repoCwd,
			);
			if (template) send(res, jsonResponse(template));
			else send(res, errorResponse("Skill template not found", 404));
			return;
		}
		if (skillTemplateMatch && req.method === "DELETE") {
			const { deleteSkillTemplate } = await import("./skill-templates.js");
			const result = deleteSkillTemplate(
				decodeURIComponent(skillTemplateMatch[1]),
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse({ success: true }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to delete skill template",
						result.error === "template not found" ? 404 : 400,
					),
				);
			return;
		}

		// Extension template CRUD
		if (url.pathname === "/api/extension-templates" && req.method === "GET") {
			const { discoverExtensionTemplates } = await import(
				"./extension-templates.js"
			);
			send(res, jsonResponse(discoverExtensionTemplates(deps.repoCwd)));
			return;
		}
		if (url.pathname === "/api/extension-templates" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			const { saveExtensionTemplate } = await import(
				"./extension-templates.js"
			);
			const result = saveExtensionTemplate(
				{
					name: body.name,
					description: body.description,
					items: body.extensions || body.items || [],
					audience: body.audience,
					autoApply: body.autoApply,
					applyToAll: !!body.applyToAll,
					targetLibrary: body.targetLibrary,
				},
				deps.repoCwd,
			);
			if (result.success)
				send(res, jsonResponse({ success: true, path: result.path }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to save extension template",
						400,
					),
				);
			return;
		}
		const extensionTemplateMatch = url.pathname.match(
			/^\/api\/extension-templates\/([^/]+)$/,
		);
		if (extensionTemplateMatch && req.method === "GET") {
			const { getExtensionTemplate } = await import("./extension-templates.js");
			const template = getExtensionTemplate(
				decodeURIComponent(extensionTemplateMatch[1]),
				deps.repoCwd,
			);
			if (template) send(res, jsonResponse(template));
			else send(res, errorResponse("Extension template not found", 404));
			return;
		}
		const extensionTemplateSmokeTestMatch = url.pathname.match(
			/^\/api\/extension-templates\/([^/]+)\/smoke-test$/,
		);
		if (extensionTemplateSmokeTestMatch && req.method === "POST") {
			const { smokeTestExtensionTemplate } = await import(
				"./extension-smoke-test.js"
			);
			const result = await smokeTestExtensionTemplate(
				decodeURIComponent(extensionTemplateSmokeTestMatch[1]),
				deps,
			);
			if ("error" in result)
				send(res, errorResponse(result.error, result.status));
			else send(res, jsonResponse(result));
			return;
		}
		if (extensionTemplateMatch && req.method === "DELETE") {
			const { deleteExtensionTemplate } = await import(
				"./extension-templates.js"
			);
			const result = deleteExtensionTemplate(
				decodeURIComponent(extensionTemplateMatch[1]),
				deps.repoCwd,
			);
			if (result.success) send(res, jsonResponse({ success: true }));
			else
				send(
					res,
					errorResponse(
						result.error || "Failed to delete extension template",
						result.error === "template not found" ? 404 : 400,
					),
				);
			return;
		}

		// POST /api/spawn
		if (url.pathname === "/api/spawn" && req.method === "POST") {
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON body"));
				return;
			}
			const {
				name,
				parent,
				type,
				model,
				issueId,
				extensions: requestedExtensions,
			} = body;

			if (!name || !parent) {
				send(res, errorResponse("Missing required fields: name, parent"));
				return;
			}
			if (agents.has(name)) {
				send(res, errorResponse(`Agent '${name}' already exists`, 409));
				return;
			}

			const definition = type
				? deps.getDefinition(type, deps.repoCwd)
				: undefined;
			if (type && !definition) {
				send(res, errorResponse(`Agent type '${type}' not found`, 404));
				return;
			}
			if (definition) {
				const { isSpawnableAgentDefinition, nonSpawnableAgentReason } =
					await import("./definitions.js");
				if (!isSpawnableAgentDefinition(definition)) {
					send(
						res,
						errorResponse(
							nonSpawnableAgentReason(definition) ||
								`Agent type '${definition.name}' is not spawnable`,
							403,
						),
					);
					return;
				}
			}

			let worktreePath: string | undefined;
			if (parent !== "self") {
				const parentAgent = agents.get(parent);
				if (!parentAgent) {
					send(res, errorResponse(`Parent agent '${parent}' not found`, 404));
					return;
				}
				worktreePath = parentAgent.worktreePath;
				parentAgent.children.push(name);
			}

			const allExts = deps.discoverExtensions(deps.repoCwd);
			const { resolveCapabilities } = await import(
				"./capability-resolution.js"
			);
			const capabilities = resolveCapabilities({
				cwd: deps.repoCwd,
				definition,
				requestedExtensions: requestedExtensions || [],
				availableExtensions: allExts,
			});
			if (capabilities.errors.length) {
				send(
					res,
					errorResponse(
						`Cannot spawn agent with invalid capabilities: ${capabilities.errors.join("; ")}`,
						400,
					),
				);
				return;
			}
			if (capabilities.skillConflicts.length) {
				send(
					res,
					errorResponse(
						`Cannot spawn agent with conflicting runtime skill names: ${capabilities.skillConflicts.map((conflict) => conflict.name).join(", ")}`,
						400,
					),
				);
				return;
			}
			const resolvedDefinition = definition
				? { ...definition, skills: capabilities.skills }
				: undefined;

			const requestedModel =
				typeof model === "string" && model.trim()
					? model.trim()
					: deps.currentModel?.();
			const result = await deps.spawnAgent(name, {
				model: requestedModel,
				repoCwd: deps.repoCwd,
				definition: resolvedDefinition,
				parent: parent === "self" ? undefined : parent,
				worktreePath,
				extensions: capabilities.extensions,
				issueId,
			});

			if (result.error || !result.agent) {
				send(res, errorResponse(result.error || "Spawn failed", 500));
				return;
			}

			agents.set(name, result.agent);

			if (result.agent.status === "error" || result.agent.status === "exited") {
				agents.delete(name);
				await deps.removeWorktree(result.agent.worktreePath);
				send(res, errorResponse("Agent exited immediately after spawn", 500));
				return;
			}

			broadcast({ type: "agent-spawned", data: serializeAgent(result.agent) });
			log("server", `Dashboard spawned agent '${name}'`);

			send(res, jsonResponse(serializeAgent(result.agent), 201));
			return;
		}

		// GET /api/agents/:name/events
		const eventsMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/events$/);
		if (eventsMatch && req.method === "GET") {
			const name = decodeURIComponent(eventsMatch[1]);
			const agent = agents.get(name);
			if (!agent) {
				send(res, errorResponse("Agent not found", 404));
				return;
			}
			agent.runtimeTools = readRuntimeToolSnapshot(agent.worktreePath);
			logRuntimeToolConflicts(agent.id, agent.runtimeTools);
			send(
				res,
				jsonResponse({
					name,
					status: agent.status,
					model: agent.model || agent.definition?.model,
					worktree: agent.worktreePath,
					issueId: agent.issueId,
					artifactPath: agent.artifactPath,
					artifactFiles: agent.artifactFiles,
					runtimeTools: agent.runtimeTools,
					pendingSend: agent.pendingSend,
					stderrTail: readStderrTail(agent.worktreePath),
					history: agent.history,
					accumulatedText: agent.accumulatedText,
					events: agent.events,
				}),
			);
			return;
		}

		// POST /api/agents/:name/steer
		const steerMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/steer$/);
		if (steerMatch && req.method === "POST") {
			const name = decodeURIComponent(steerMatch[1]);
			const agent = agents.get(name);
			if (!agent) {
				send(res, errorResponse("Agent not found", 404));
				return;
			}
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON", 400));
				return;
			}
			if (!body.message) {
				send(res, errorResponse("message is required", 400));
				return;
			}
			try {
				await steerAgent(agent, body.message);
				send(res, jsonResponse({ success: true }));
			} catch (err: any) {
				send(
					res,
					jsonResponse(
						{ success: false, error: err?.message || String(err) },
						500,
					),
				);
			}
			return;
		}

		// POST /api/agents/:name/send
		const sendMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/send$/);
		if (sendMatch && req.method === "POST") {
			const name = decodeURIComponent(sendMatch[1]);
			let body: any;
			try {
				body = JSON.parse(await readBody(req));
			} catch {
				send(res, errorResponse("Invalid JSON body"));
				return;
			}
			const { message } = body;

			const agent = agents.get(name);
			if (!agent) {
				send(res, errorResponse(`Agent '${name}' not found`, 404));
				return;
			}
			if (!message) {
				send(res, errorResponse("Missing required field: message"));
				return;
			}

			Promise.resolve().then(async () => {
				try {
					await deps.sendToAgent(
						agent,
						message,
						300_000,
						undefined,
						(update) => {
							if (update.type === "status") {
								broadcast({
									type: "agent-status",
									data: {
										name,
										status: update.status,
										pendingSend: agent.pendingSend,
									},
								});
							} else {
								broadcast({
									type: "agent-error",
									data: { name, error: update.error, phase: update.phase },
								});
							}
						},
					);
					log("server", `Dashboard send to ${name} completed`);
				} catch (err: any) {
					broadcast({
						type: "agent-error",
						data: { name, error: err.message },
					});
					log("server", `Dashboard send to ${name} failed: ${err.message}`);
				}
			});

			send(res, jsonResponse({ queued: true, agent: name }));
			return;
		}

		// POST /api/emergency-stop
		if (url.pathname === "/api/emergency-stop" && req.method === "POST") {
			log("lifecycle", "EMERGENCY STOP triggered");
			// Kill all agents
			for (const [name, agent] of agents) {
				if (!agent.proc.killed) {
					try {
						agent.proc.kill("SIGTERM");
					} catch (err: any) {
						log(
							"lifecycle",
							`Failed to kill agent '${name}' during emergency stop: ${err.message}`,
						);
					}
				}
			}
			agents.clear();
			// Remove all worktrees
			try {
				const { execSync } = require("child_process");
				execSync("rm -rf /tmp/pi-worktree-*", { stdio: "ignore" });
			} catch (err: any) {
				log(
					"lifecycle",
					`Failed to remove temporary worktrees during emergency stop: ${err.message}`,
				);
			}
			broadcast({ type: "emergency-stop", data: {} });
			send(res, jsonResponse({ success: true }));
			return;
		}

		// POST /api/agents/:name/kill
		const killMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/kill$/);
		if (killMatch && req.method === "POST") {
			const name = decodeURIComponent(killMatch[1]);
			const agent = agents.get(name);
			if (!agent) {
				send(res, errorResponse(`Agent '${name}' not found`, 404));
				return;
			}

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
				if (parent) parent.children = parent.children.filter((c) => c !== name);
			} else {
				await deps.removeWorktree(agent.worktreePath);
			}

			broadcast({
				type: "agent-exit",
				data: { name, code: null, signal: "SIGTERM", reason: "killed" },
			});
			agents.delete(name);
			broadcast({ type: "agent-killed", data: { name } });
			log("server", `Dashboard killed agent '${name}'`);

			send(res, jsonResponse({ killed: true, name }));
			return;
		}

		send(res, errorResponse("Not found", 404));
	});

	return new Promise((resolve, reject) => {
		server.listen(port, () => {
			const addr = server.address();
			const actualPort = typeof addr === "object" && addr ? addr.port : port;
			const url = `http://localhost:${actualPort}`;
			log("server", `HTTP server listening on ${url}`);

			resolve({
				url,
				stop: () => {
					server.close();
					for (const session of agentTypeTestSessions.values()) {
						void cleanupAgentTypeTestSession(session);
					}
					for (const res of sseClients) {
						try {
							res.end();
						} catch {
							/* ignore */
						}
					}
					sseClients.clear();
				},
			});
		});

		server.once("error", reject);
	});
}
