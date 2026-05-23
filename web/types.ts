// Shared types between server and dashboard

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

export interface IssueArtifactFiles {
	issueContext: string;
	leadPlan: string;
	leadSummary: string;
	scoutsDir: string;
	researchersDir: string;
	buildersDir: string;
}

export type AgentStatus =
	| "idle"
	| "queued"
	| "writing"
	| "waiting"
	| "streaming"
	| "error"
	| "exited";

export interface PendingAgentSend {
	message: string;
	startedAt: number;
	timeoutMs: number;
	status: Extract<AgentStatus, "queued" | "writing" | "waiting" | "streaming">;
}

export interface AgentInfo {
	name: string;
	status: AgentStatus;
	definition?: string;
	parent?: string;
	children: string[];
	turns: number;
	worktree: string;
	issueId?: string;
	artifactPath?: string;
	artifactFiles?: IssueArtifactFiles;
	runtimeTools?: RuntimeToolSnapshot;
	pendingSend?: PendingAgentSend;
	text?: string;
}

export interface AgentTypeTestSession {
	id: string;
	agentType: string;
	status: "idle" | "streaming" | "error" | "exited";
	worktree: string;
	createdAt: number;
	runtimeTools?: RuntimeToolSnapshot;
	stderrTail?: string;
}

export interface AgentTypeInfo {
	name: string;
	description: string;
	agentClass?: "lead" | "scout" | "implementer" | "reviewer" | "orchestrator";
	model?: string;
	thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
	tools?: string[];
	skills?: string[];
	skillTemplates?: string[];
	extensionTemplates?: string[];
	prompt?: string;
	systemPrompt?: string;
	source: string;
	readOnly?: boolean;
	example?: boolean;
}

export interface ModelInfo {
	provider: string;
	id: string;
	pattern?: string;
	context: string;
	maxOut: string;
	thinking: boolean;
	images: boolean;
	thinkingLevels?: Array<
		"off" | "minimal" | "low" | "medium" | "high" | "xhigh"
	>;
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
	audience?: "spawned" | "orchestrator" | "all";
	editable?: boolean;
	packageProvided?: boolean;
	ref?: string;
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

export interface ExtensionTemplateSmokeTestResult {
	success: boolean;
	template: string;
	extensions: Array<{ name: string; path: string; scope?: string }>;
	missingExtensions: string[];
	runtimeTools?: RuntimeToolSnapshot;
	diagnostics: Array<{ level: "error" | "warning" | "info"; message: string }>;
	stderrTail?: string;
	smokeAgent?: {
		id: string;
		definition: string;
		model?: string;
		worktree?: string;
	};
}

export interface RootProfileInfo {
	name: string;
	description: string;
	skills?: string[];
	skillTemplates?: string[];
	instructions: string;
	source: "user" | "project" | "package" | "orchestrator-library";
	scope?: string;
	filePath: string;
	readOnly?: boolean;
}

export interface RootProfileDetailInfo {
	profile: RootProfileInfo;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
	hash: string;
}

export interface RoadmapIssue {
	id: string;
	title: string;
	type: string;
	status: string;
	priority: number;
	labels: string[];
	description: string;
	createdAt?: string;
	updatedAt?: string;
	closedAt?: string;
	closeReason?: string;
	blocks: string[];
	blockedBy: string[];
}

export interface RoadmapDependency {
	id: string;
	title?: string;
	status: string;
	type?: string;
	priority?: number;
}

export interface RoadmapOverview {
	source: { type: "seeds"; path: string; exists: boolean };
	generatedAt: string;
	issues: RoadmapIssue[];
	counts: {
		total: number;
		inProgress: number;
		ready: number;
		nextUp: number;
		blocked: number;
		backlog: number;
		closed: number;
	};
	groups: {
		inProgress: string[];
		ready: string[];
		nextUp: string[];
		blocked: string[];
		backlog: string[];
		closed: string[];
	};
	dependencyMap: {
		blockers: Record<string, RoadmapDependency[]>;
		unresolvedBlockers: Record<string, RoadmapDependency[]>;
		dependents: Record<string, RoadmapDependency[]>;
	};
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

export interface OrchestratorLibraryDiagnosticInfo {
	level: "error" | "warning";
	message: string;
	path?: string;
}

export interface OrchestratorLibraryInfo {
	root: string;
	manifestPath: string;
	manifest?: {
		schema: string;
		name: string;
		description?: string;
		compatibility?: Record<string, unknown>;
		resources: Record<string, string>;
	};
	diagnostics: OrchestratorLibraryDiagnosticInfo[];
	valid: boolean;
	source?: "repo" | "external-mounted";
	enabled?: boolean;
	disabledKey?: string;
}

export interface OrchestratorLibraryResourceInfo {
	id: string;
	kind:
		| "agents"
		| "skillTemplates"
		| "extensionTemplates"
		| "skills"
		| "extensions";
	name: string;
	description?: string;
	libraryName: string;
	libraryPath: string;
	filePath: string;
	relativePath: string;
	editable: boolean;
	readOnly: boolean;
	diagnostics: OrchestratorLibraryDiagnosticInfo[];
}

export interface OrchestratorDisplaySettingsInfo {
	showPackageExamples: boolean;
	settingsPath: string;
	exists: boolean;
	parseError?: string;
	readError?: string;
}

export interface OrchestratorLibrariesInfo {
	libraries: OrchestratorLibraryInfo[];
	resources: OrchestratorLibraryResourceInfo[];
	diagnostics: OrchestratorLibraryDiagnosticInfo[];
	valid: boolean;
	settings: OrchestratorDisplaySettingsInfo;
}

export type ServerEvent =
	| { type: "init"; data: { agents: Record<string, AgentInfo> } }
	| { type: "agent-spawned"; data: AgentInfo }
	| { type: "agent-killed"; data: { name: string } }
	| {
			type: "agent-status";
			data: {
				name: string;
				status: AgentStatus;
				pendingSend?: PendingAgentSend;
			};
		}
	| { type: "agent-start"; data: { name: string } }
	| { type: "agent-end"; data: { name: string; text: string } }
	| { type: "agent-error"; data: { name: string; error: string; phase?: string } }
	| {
			type: "agent-exit";
			data: {
				name: string;
				code?: number | null;
				signal?: string | null;
				reason?: string;
			};
		}
	| { type: "agent-delta"; data: { name: string; delta: string } }
	| { type: "delegate"; data: { from: string; to: string; task: string } };
