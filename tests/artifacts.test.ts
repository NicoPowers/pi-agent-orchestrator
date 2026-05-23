import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("issue handoff artifacts", () => {
	let repoDir: string;

	beforeEach(() => {
		repoDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-artifacts-repo-"));
	});

	afterEach(() => {
		fs.rmSync(repoDir, { recursive: true, force: true });
	});

	it("prepares an issue artifact workspace under the app-owned issues tree", async () => {
		const { prepareIssueArtifactWorkspace, ISSUE_ARTIFACT_FILENAMES } =
			await import("../extensions/multi-agent/artifacts.js");

		const workspace = prepareIssueArtifactWorkspace(
			repoDir,
			"../pi-lattice-1234/../../evil issue",
		);
		const expectedRoot = path.join(
			repoDir,
			".pi",
			"pi-lattice",
			"issues",
		);

		expect(workspace.issueId).toBe("evil-issue");
		expect(workspace.issuePath.startsWith(expectedRoot + path.sep)).toBe(true);
		expect(workspace.issuePath).toBe(path.join(expectedRoot, "evil-issue"));
		expect(fs.existsSync(path.join(workspace.issuePath, "scouts"))).toBe(true);
		expect(fs.existsSync(path.join(workspace.issuePath, "researchers"))).toBe(
			true,
		);
		expect(fs.existsSync(path.join(workspace.issuePath, "builders"))).toBe(
			true,
		);
		expect(workspace.files.issueContext).toBe(
			path.join(workspace.issuePath, ISSUE_ARTIFACT_FILENAMES.issueContext),
		);
		expect(workspace.files.leadPlan).toBe(
			path.join(workspace.issuePath, ISSUE_ARTIFACT_FILENAMES.leadPlan),
		);
	});

	it("derives child artifact metadata from a parent when no issue id is provided", async () => {
		const { resolveIssueArtifactMetadata, prepareIssueArtifactWorkspace } =
			await import("../extensions/multi-agent/artifacts.js");

		const parent = prepareIssueArtifactWorkspace(
			repoDir,
			"pi-lattice-f91c",
		);
		const childMetadata = resolveIssueArtifactMetadata({
			repoCwd: repoDir,
			parentIssueId: parent.issueId,
			parentArtifactPath: parent.issuePath,
		});

		expect(childMetadata).toEqual({
			issueId: "pi-lattice-f91c",
			artifactPath: parent.issuePath,
			artifactFiles: parent.files,
		});
	});

	it("renders role-specific artifact instructions for spawned agents", async () => {
		const { prepareIssueArtifactWorkspace, renderIssueArtifactInstructions } =
			await import("../extensions/multi-agent/artifacts.js");
		const workspace = prepareIssueArtifactWorkspace(
			repoDir,
			"pi-lattice-f91c",
		);

		const leadInstructions = renderIssueArtifactInstructions({
			agentId: "lead-f91c",
			agentClass: "lead",
			issueId: workspace.issueId,
			artifactPath: workspace.issuePath,
			artifactFiles: workspace.files,
		});
		expect(leadInstructions).toContain("lead-plan.json");
		expect(leadInstructions).toContain("lead-summary.md");
		expect(leadInstructions).toContain(
			"root orchestrator receives summaries only",
		);

		const scoutInstructions = renderIssueArtifactInstructions({
			agentId: "scout-f91c",
			agentClass: "scout",
			issueId: workspace.issueId,
			artifactPath: workspace.issuePath,
			artifactFiles: workspace.files,
		});
		expect(scoutInstructions).toContain("scouts/scout-f91c.dossier.json");
		expect(scoutInstructions).toContain("concise Area Dossier");

		const builderInstructions = renderIssueArtifactInstructions({
			agentId: "builder-f91c",
			agentClass: "implementer",
			issueId: workspace.issueId,
			artifactPath: workspace.issuePath,
			artifactFiles: workspace.files,
		});
		expect(builderInstructions).toContain(
			"builders/builder-f91c.completion.json",
		);
		expect(builderInstructions).toContain("prepared handoff");
	});
});
