import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("template backend", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-template-test-"));
	});

	afterEach(() => {
		fs.rmSync(tmpDir, { recursive: true, force: true });
	});

	it("saves and discovers project skill templates with audience and auto-apply metadata", async () => {
		const { saveSkillTemplate, discoverSkillTemplates } = await import(
			"../extensions/multi-agent/skill-templates.js"
		);

		const result = saveSkillTemplate(
			{
				name: "frontend",
				description: "Frontend skills",
				items: ["react", "tailwind", "react"],
				audience: "all",
				autoApply: "spawned",
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(
			path.join(tmpDir, ".pi", "skill-templates", "frontend.md"),
		);

		const templates = discoverSkillTemplates(tmpDir);
		expect(templates).toHaveLength(1);
		expect(templates[0]).toMatchObject({
			name: "frontend",
			description: "Frontend skills",
			items: ["react", "tailwind"],
			audience: "all",
			autoApply: "spawned",
			applyToAll: true,
			source: "project",
		});
	});

	it("saves and discovers templates in the first auto-discovered Lattice Library", async () => {
		const { saveSkillTemplate, discoverSkillTemplates } = await import(
			"../extensions/multi-agent/skill-templates.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const libraryRoot = path.join(
			tmpDir,
			".pi",
			"pi-lattice",
			"libraries",
			"team-library",
		);
		fs.mkdirSync(path.join(libraryRoot, "skill-templates"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(libraryRoot, "lattice-library.json"),
			JSON.stringify({
				schema: LATTICE_LIBRARY_SCHEMA,
				name: "team",
				resources: { skillTemplates: "skill-templates" },
			}),
		);

		const result = saveSkillTemplate(
			{
				name: "core",
				description: "Core skills",
				items: ["team:skills/core/SKILL.md"],
				applyToAll: false,
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(
			path.join(libraryRoot, "skill-templates", "core.md"),
		);
		const templates = discoverSkillTemplates(tmpDir);
		expect(templates[0]).toMatchObject({
			name: "core",
			source: "lattice-library",
			scope: "team",
		});
	});

	it("saves templates to project scope when explicitly requested even if libraries are configured", async () => {
		const { saveSkillTemplate, discoverSkillTemplates } = await import(
			"../extensions/multi-agent/skill-templates.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const libraryRoot = path.join(
			tmpDir,
			".pi",
			"pi-lattice",
			"libraries",
			"team-library",
		);
		fs.mkdirSync(path.join(libraryRoot, "skill-templates"), {
			recursive: true,
		});
		fs.writeFileSync(
			path.join(libraryRoot, "lattice-library.json"),
			JSON.stringify({
				schema: LATTICE_LIBRARY_SCHEMA,
				name: "team",
				resources: { skillTemplates: "skill-templates" },
			}),
		);

		const result = saveSkillTemplate(
			{
				name: "project-core",
				description: "Project skills",
				items: [],
				targetScope: "project",
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(
			path.join(tmpDir, ".pi", "skill-templates", "project-core.md"),
		);
		expect(discoverSkillTemplates(tmpDir)[0]).toMatchObject({
			name: "project-core",
			source: "project",
		});
	});

	it("saves templates to an explicitly selected Lattice Library", async () => {
		const { saveExtensionTemplate, discoverExtensionTemplates } = await import(
			"../extensions/multi-agent/extension-templates.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		for (const name of ["first", "second"]) {
			const libraryRoot = path.join(
				tmpDir,
				".pi",
				"pi-lattice",
				"libraries",
				`${name}-library`,
			);
			fs.mkdirSync(path.join(libraryRoot, "extension-templates"), {
				recursive: true,
			});
			fs.writeFileSync(
				path.join(libraryRoot, "lattice-library.json"),
				JSON.stringify({
					schema: LATTICE_LIBRARY_SCHEMA,
					name,
					resources: { extensionTemplates: "extension-templates" },
				}),
			);
		}
		const result = saveExtensionTemplate(
			{
				name: "browser-tools",
				description: "Browser tools",
				items: ["web"],
				targetLibrary: "second",
			},
			tmpDir,
		);

		expect(result.success).toBe(true);
		expect(result.path).toBe(
			path.join(
				tmpDir,
				".pi",
				"pi-lattice",
				"libraries",
				"second-library",
				"extension-templates",
				"browser-tools.md",
			),
		);
		expect(discoverExtensionTemplates(tmpDir)[0]).toMatchObject({
			name: "browser-tools",
			source: "lattice-library",
			scope: "second",
		});
		expect(
			fs.existsSync(
				path.join(
					tmpDir,
					".pi",
					"pi-lattice",
					"libraries",
					"first-library",
					"extension-templates",
					"browser-tools.md",
				),
			),
		).toBe(false);
	});

	it("saves, loads, and deletes spawned-only extension templates", async () => {
		const {
			saveExtensionTemplate,
			getExtensionTemplate,
			deleteExtensionTemplate,
			discoverExtensionTemplates,
		} = await import("../extensions/multi-agent/extension-templates.js");

		const saved = saveExtensionTemplate(
			{
				name: "web-tools",
				description: "Web extensions",
				items: ["browser", "fetcher"],
				audience: "spawned",
				autoApply: "none",
			},
			tmpDir,
		);
		expect(saved.success).toBe(true);

		const loaded = getExtensionTemplate("web-tools", tmpDir);
		expect(loaded?.items).toEqual(["browser", "fetcher"]);
		expect(loaded?.audience).toBe("spawned");
		expect(loaded?.autoApply).toBe("none");
		expect(loaded?.applyToAll).toBe(false);

		const deleted = deleteExtensionTemplate("web-tools", tmpDir);
		expect(deleted.success).toBe(true);
		expect(discoverExtensionTemplates(tmpDir)).toHaveLength(0);
	});

	it("rejects unsafe template names", async () => {
		const { saveSkillTemplate } = await import(
			"../extensions/multi-agent/skill-templates.js"
		);

		const result = saveSkillTemplate(
			{
				name: "../escape",
				description: "Bad",
				items: [],
			},
			tmpDir,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain("name may only contain");
		expect(fs.existsSync(path.join(tmpDir, ".pi", "escape.md"))).toBe(false);
	});

	it("rejects impossible skill template audience and auto-apply combinations", async () => {
		const { saveSkillTemplate } = await import(
			"../extensions/multi-agent/skill-templates.js"
		);

		const result = saveSkillTemplate(
			{
				name: "root-only",
				description: "Root only",
				items: ["orchestrator-planning"],
				audience: "orchestrator",
				autoApply: "spawned",
			},
			tmpDir,
		);

		expect(result.success).toBe(false);
		expect(result.error).toContain(
			"autoApply: spawned requires audience spawned or all",
		);
	});

	it("rejects orchestrator or all-audience extension templates", async () => {
		const { saveExtensionTemplate } = await import(
			"../extensions/multi-agent/extension-templates.js"
		);

		const orchestratorResult = saveExtensionTemplate(
			{
				name: "root-exts",
				description: "Root extensions",
				items: ["dangerous-root-extension"],
				audience: "orchestrator",
				autoApply: "none",
			},
			tmpDir,
		);
		const allResult = saveExtensionTemplate(
			{
				name: "all-exts",
				description: "All extensions",
				items: ["logger"],
				audience: "spawned",
				autoApply: "all",
			},
			tmpDir,
		);

		expect(orchestratorResult.success).toBe(false);
		expect(orchestratorResult.error).toContain(
			"extension templates are only available to spawned agents",
		);
		expect(allResult.success).toBe(false);
		expect(allResult.error).toContain(
			"extension templates cannot auto-apply to the orchestrator",
		);
	});
});
