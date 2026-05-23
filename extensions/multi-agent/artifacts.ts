import * as fs from "node:fs";
import * as path from "node:path";

export const ISSUE_ARTIFACT_ROOT_SEGMENTS = [
	".pi",
	"pi-lattice",
	"issues",
] as const;

export const ISSUE_ARTIFACT_FILENAMES = {
	issueContext: "issue-context.json",
	leadPlan: "lead-plan.json",
	leadSummary: "lead-summary.md",
	scoutPacket: "scouts/<agent-id>.packet.json",
	scoutDossier: "scouts/<agent-id>.dossier.json",
	researcherPacket: "researchers/<agent-id>.packet.json",
	researcherDossier: "researchers/<agent-id>.dossier.json",
	builderPacket: "builders/<agent-id>.packet.json",
	builderCompletion: "builders/<agent-id>.completion.json",
} as const;

export interface IssueArtifactFiles {
	issueContext: string;
	leadPlan: string;
	leadSummary: string;
	scoutsDir: string;
	researchersDir: string;
	buildersDir: string;
}

export interface IssueArtifactWorkspace {
	issueId: string;
	issuePath: string;
	files: IssueArtifactFiles;
}

export interface IssueArtifactMetadata {
	issueId?: string;
	artifactPath?: string;
	artifactFiles?: IssueArtifactFiles;
}

export type IssueArtifactAgentClass =
	| "lead"
	| "scout"
	| "implementer"
	| "reviewer"
	| "orchestrator";

function issueArtifactsRoot(repoCwd: string): string {
	return path.resolve(repoCwd, ...ISSUE_ARTIFACT_ROOT_SEGMENTS);
}

function isInsidePath(parentPath: string, candidatePath: string): boolean {
	const parent = path.resolve(parentPath);
	const candidate = path.resolve(candidatePath);
	return candidate === parent || candidate.startsWith(parent + path.sep);
}

function ensureInsideIssueArtifactsRoot(
	repoCwd: string,
	candidatePath: string,
): string {
	const root = issueArtifactsRoot(repoCwd);
	const resolved = path.resolve(candidatePath);
	if (!isInsidePath(root, resolved)) {
		throw new Error(`Issue artifact path escapes ${root}: ${candidatePath}`);
	}
	return resolved;
}

function filesForIssuePath(issuePath: string): IssueArtifactFiles {
	return {
		issueContext: path.join(issuePath, ISSUE_ARTIFACT_FILENAMES.issueContext),
		leadPlan: path.join(issuePath, ISSUE_ARTIFACT_FILENAMES.leadPlan),
		leadSummary: path.join(issuePath, ISSUE_ARTIFACT_FILENAMES.leadSummary),
		scoutsDir: path.join(issuePath, "scouts"),
		researchersDir: path.join(issuePath, "researchers"),
		buildersDir: path.join(issuePath, "builders"),
	};
}

function ensureIssueArtifactDirs(files: IssueArtifactFiles) {
	fs.mkdirSync(files.scoutsDir, { recursive: true });
	fs.mkdirSync(files.researchersDir, { recursive: true });
	fs.mkdirSync(files.buildersDir, { recursive: true });
}

export function sanitizeIssueIdForArtifactPath(issueId: string): string {
	const leaf =
		issueId
			.trim()
			.split(/[\\/]+/)
			.filter((segment) => segment && segment !== "." && segment !== "..")
			.pop() || "";
	const sanitized = leaf
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "")
		.slice(0, 120);
	if (!sanitized) {
		throw new Error("Issue id is required for issue handoff artifacts.");
	}
	return sanitized;
}

export function prepareIssueArtifactWorkspace(
	repoCwd: string,
	issueId: string,
): IssueArtifactWorkspace {
	const safeIssueId = sanitizeIssueIdForArtifactPath(issueId);
	const root = issueArtifactsRoot(repoCwd);
	const issuePath = ensureInsideIssueArtifactsRoot(
		repoCwd,
		path.join(root, safeIssueId),
	);
	const files = filesForIssuePath(issuePath);

	fs.mkdirSync(issuePath, { recursive: true });
	ensureIssueArtifactDirs(files);

	return {
		issueId: safeIssueId,
		issuePath,
		files,
	};
}

function artifactRelativePath(artifactPath: string, filePath: string): string {
	return path.relative(artifactPath, filePath).split(path.sep).join("/");
}

function agentArtifactRelativePath(template: string, agentId: string): string {
	return template.replace("<agent-id>", agentId).split(path.sep).join("/");
}

export function renderIssueArtifactInstructions(options: {
	agentId: string;
	agentClass?: IssueArtifactAgentClass;
	issueId: string;
	artifactPath: string;
	artifactFiles: IssueArtifactFiles;
}): string {
	const issueContext = artifactRelativePath(
		options.artifactPath,
		options.artifactFiles.issueContext,
	);
	const leadPlan = artifactRelativePath(
		options.artifactPath,
		options.artifactFiles.leadPlan,
	);
	const leadSummary = artifactRelativePath(
		options.artifactPath,
		options.artifactFiles.leadSummary,
	);
	const scoutDossier = agentArtifactRelativePath(
		ISSUE_ARTIFACT_FILENAMES.scoutDossier,
		options.agentId,
	);
	const researcherDossier = agentArtifactRelativePath(
		ISSUE_ARTIFACT_FILENAMES.researcherDossier,
		options.agentId,
	);
	const builderCompletion = agentArtifactRelativePath(
		ISSUE_ARTIFACT_FILENAMES.builderCompletion,
		options.agentId,
	);

	const lines = [
		"",
		"---",
		"",
		"## Issue Handoff Artifacts",
		"",
		`Issue: ${options.issueId}`,
		`Artifact workspace: ${options.artifactPath}`,
		"",
		"Use this workspace for operational handoff context only. These files are not Seeds tracker state and are not Mulch durable knowledge unless the root orchestrator later promotes selected outcomes.",
		"",
		"Shared files:",
		`- Issue context packet: ${issueContext}`,
		`- Lead plan: ${leadPlan}`,
		`- Lead/root summary: ${leadSummary}`,
		"",
	];

	switch (options.agentClass) {
		case "lead":
			lines.push(
				"Lead role:",
				`- Prepare or update ${leadPlan} with the issue plan, specialist work requests, and read-order hints.`,
				`- Write ${leadSummary} as the concise summary the root orchestrator receives summaries only from; do not dump raw scout/builder context into the root response.`,
				"- Request scouts/researchers/builders with focused scopes and point them at the relevant artifact files.",
			);
			break;
		case "scout":
			lines.push(
				"Scout/research role:",
				`- Write a concise Area Dossier to ${scoutDossier} before finishing when you investigate code.`,
				`- If acting as a broader researcher, use ${researcherDossier} for web/repo research findings.`,
				"- Include evidence: files read, exact symbols/modules, risks, unknowns, and recommended builder packet material.",
			);
			break;
		case "implementer":
			lines.push(
				"Builder role:",
				"- Consume the prepared handoff before mutating files: issue context, lead plan, and any relevant scout/researcher dossiers.",
				`- Write a completion report to ${builderCompletion} with changed files, validation run, remaining risks, and promotion candidates.`,
			);
			break;
		case "reviewer":
			lines.push(
				"Reviewer role:",
				"- Review the prepared handoff plus changed files, then report concise findings for lead/root synthesis.",
				"- Prefer summaries and exact evidence references over copying raw context.",
			);
			break;
		default:
			lines.push(
				"Agent role:",
				"- Keep handoff notes concise and write role-appropriate findings under this issue artifact workspace when useful.",
			);
	}

	return `${lines.join("\n")}\n`;
}

export function resolveIssueArtifactMetadata(options: {
	repoCwd: string;
	issueId?: string;
	parentIssueId?: string;
	parentArtifactPath?: string;
}): IssueArtifactMetadata {
	if (options.issueId?.trim()) {
		const workspace = prepareIssueArtifactWorkspace(
			options.repoCwd,
			options.issueId,
		);
		return {
			issueId: workspace.issueId,
			artifactPath: workspace.issuePath,
			artifactFiles: workspace.files,
		};
	}

	if (options.parentIssueId && options.parentArtifactPath) {
		const artifactPath = ensureInsideIssueArtifactsRoot(
			options.repoCwd,
			options.parentArtifactPath,
		);
		const files = filesForIssuePath(artifactPath);
		fs.mkdirSync(artifactPath, { recursive: true });
		ensureIssueArtifactDirs(files);
		return {
			issueId: sanitizeIssueIdForArtifactPath(options.parentIssueId),
			artifactPath,
			artifactFiles: files,
		};
	}

	return {};
}
