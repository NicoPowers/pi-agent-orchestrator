import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("definition discovery", () => {
	let tmpDir: string;
	let originalHome: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
		originalHome = process.env.HOME || "";
		process.env.HOME = tmpDir;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("discovers project-level agent definitions", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
		fs.mkdirSync(projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectAgentsDir, "reviewer.md"),
			`---\nname: reviewer\ndescription: Test reviewer\n---\nReview code.`,
			"utf-8",
		);

		const defs = discoverDefinitions(tmpDir);
		const reviewer = defs.find((d) => d.name === "reviewer");
		expect(reviewer).toBeDefined();
		expect(reviewer!.description).toBe("Test reviewer");
		expect(reviewer!.source).toBe("project");
		expect(reviewer!.agentClass).toBe("reviewer");
	});

	it("discovers package definitions as read-only pio examples", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const defs = discoverDefinitions(tmpDir);
		const packageDefs = defs.filter((d) => d.source === "package");
		expect(packageDefs.length).toBeGreaterThan(0);
		expect(packageDefs.every((d) => d.name.startsWith("pio-example-"))).toBe(
			true,
		);
		expect(packageDefs.every((d) => d.readOnly && d.example)).toBe(true);
	});

	it("skips definitions missing required frontmatter", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const agentsDir = path.join(tmpDir, ".pi", "agent", "agents");
		fs.mkdirSync(agentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(agentsDir, "broken.md"),
			`---\nname: broken\n---\nNo description.`,
			"utf-8",
		);

		const defs = discoverDefinitions(tmpDir);
		// Package defs (coder, reviewer) still present; broken is skipped
		expect(defs.find((d) => d.name === "broken")).toBeUndefined();
	});

	it("parses template and isolation frontmatter fields", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
		fs.mkdirSync(projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectAgentsDir, "templated.md"),
			`---\nname: templated\ndescription: Uses templates\nclass: lead\ntools: none\nskills: none\nskillTemplates: common, frontend\nextensionTemplates: browser\nnoContextFiles: true\nisolated: true\ndelegate: false\n---\nPrompt.`,
			"utf-8",
		);

		const def = discoverDefinitions(tmpDir).find((d) => d.name === "templated");
		expect(def?.agentClass).toBe("lead");
		expect(def?.noTools).toBe(true);
		expect(def?.noSkills).toBe(true);
		expect(def?.skillTemplates).toEqual(["common", "frontend"]);
		expect(def?.extensionTemplates).toEqual(["browser"]);
		expect(def?.noContextFiles).toBe(true);
		expect(def?.isolated).toBe(true);
		expect(def?.delegate).toBe(false);
	});

	it("discovers Lattice Library agent definitions", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");

		const libraryRoot = path.join(tmpDir, "team-library");
		fs.mkdirSync(path.join(libraryRoot, "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(libraryRoot, "lattice-library.json"),
			JSON.stringify({
				schema: LATTICE_LIBRARY_SCHEMA,
				name: "team",
				resources: { agents: "agents" },
			}),
		);
		fs.writeFileSync(
			path.join(libraryRoot, "agents", "reviewer.md"),
			`---\nname: reviewer\ndescription: Library reviewer\nskillTemplates: core\n---\nReview from library.`,
			"utf-8",
		);
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "settings.json"),
			JSON.stringify({
				piLattice: { libraries: ["./team-library"] },
			}),
		);

		const reviewer = discoverDefinitions(tmpDir).find(
			(d) => d.name === "reviewer",
		);
		expect(reviewer?.description).toBe("Library reviewer");
		expect(reviewer?.filePath).toBe(
			path.join(libraryRoot, "agents", "reviewer.md"),
		);
		expect(reviewer?.skillTemplates).toEqual(["core"]);
	});

	it("marks orchestrator definitions as non-spawnable", async () => {
		const {
			discoverDefinitions,
			isSpawnableAgentDefinition,
			nonSpawnableAgentReason,
		} = await import("../extensions/multi-agent/definitions.js");

		const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
		fs.mkdirSync(projectAgentsDir, { recursive: true });
		fs.writeFileSync(
			path.join(projectAgentsDir, "root.md"),
			`---\nname: root-orchestrator\ndescription: Root only\nclass: orchestrator\n---\nRoot prompt.`,
			"utf-8",
		);

		const def = discoverDefinitions(tmpDir).find(
			(d) => d.name === "root-orchestrator",
		);
		expect(def?.agentClass).toBe("orchestrator");
		expect(isSpawnableAgentDefinition(def!)).toBe(false);
		expect(nonSpawnableAgentReason(def!)).toContain(
			"root /orchestrate session",
		);
	});

	it("project definitions override user definitions", async () => {
		const { discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const userDir = path.join(tmpDir, ".pi", "agent", "agents");
		const projectDir = path.join(tmpDir, ".pi", "agents");
		fs.mkdirSync(userDir, { recursive: true });
		fs.mkdirSync(projectDir, { recursive: true });

		fs.writeFileSync(
			path.join(userDir, "override.md"),
			`---\nname: override\ndescription: User version\n---\nUser prompt.`,
			"utf-8",
		);
		fs.writeFileSync(
			path.join(projectDir, "override.md"),
			`---\nname: override\ndescription: Project version\n---\nProject prompt.`,
			"utf-8",
		);

		const defs = discoverDefinitions(tmpDir);
		const override = defs.find((d) => d.name === "override");
		expect(override).toBeDefined();
		expect(override!.description).toBe("Project version");
		expect(override!.source).toBe("project");
	});
});

describe("definition saving", () => {
	let tmpDir: string;
	let originalHome: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-test-"));
		originalHome = process.env.HOME || "";
		process.env.HOME = tmpDir;
	});

	afterEach(() => {
		process.env.HOME = originalHome;
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* ignore */
		}
	});

	it("saves a new agent definition to the first configured Lattice Library", async () => {
		const { saveAgentDefinition, discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");

		const libraryRoot = path.join(tmpDir, "team-library");
		fs.mkdirSync(path.join(libraryRoot, "agents"), { recursive: true });
		fs.writeFileSync(
			path.join(libraryRoot, "lattice-library.json"),
			JSON.stringify({
				schema: LATTICE_LIBRARY_SCHEMA,
				name: "team",
				resources: { agents: "agents" },
			}),
		);
		fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
		fs.writeFileSync(
			path.join(tmpDir, ".pi", "settings.json"),
			JSON.stringify({
				piLattice: { libraries: ["./team-library"] },
			}),
		);

		const result = saveAgentDefinition(
			{
				name: "library-agent",
				description: "Library agent",
				agentClass: "lead",
				systemPrompt: "Prompt.",
				source: "project",
				filePath: "",
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(
			path.join(libraryRoot, "agents", "library-agent.md"),
		);
		const saved = discoverDefinitions(tmpDir).find(
			(d) => d.name === "library-agent",
		);
		expect(saved?.filePath).toBe(result.path);
		expect(saved?.agentClass).toBe("lead");
	});

	it("saves a new agent definition to project agents dir", async () => {
		const { saveAgentDefinition, discoverDefinitions } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const result = saveAgentDefinition(
			{
				name: "test-researcher",
				description: "A test researcher agent",
				agentClass: "scout",
				model: "kimi-k2.6",
				tools: ["read", "grep"],
				skills: [],
				systemPrompt: "You are a helpful researcher.",
				source: "project",
				filePath: "",
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBeDefined();

		// Verify it can be discovered
		const defs = discoverDefinitions(tmpDir);
		const saved = defs.find((d) => d.name === "test-researcher");
		expect(saved).toBeDefined();
		expect(saved!.description).toBe("A test researcher agent");
		expect(saved!.agentClass).toBe("scout");
		expect(saved!.model).toBe("kimi-k2.6");
	});

	it("rejects saving orchestrator as a spawnable agent definition", async () => {
		const { saveAgentDefinition } = await import(
			"../extensions/multi-agent/definitions.js"
		);

		const result = saveAgentDefinition(
			{
				name: "root-orchestrator",
				description: "Root profile",
				agentClass: "orchestrator",
				systemPrompt: "Root only.",
				source: "project",
				filePath: "",
			},
			tmpDir,
		);

		expect(result.success).toBe(false);
		expect(result.status).toBe(403);
		expect(result.error).toContain("root /orchestrate session");
	});
});
