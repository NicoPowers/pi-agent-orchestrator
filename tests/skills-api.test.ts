import { describe, it, expect } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

describe("skill discovery API", () => {
	it("returns discovery diagnostics for invalid skills", async () => {
		const { discoverSkillDiagnostics } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-skills-diagnostics-"),
		);
		try {
			const skillDir = path.join(tmpDir, ".pi", "skills", "bad");
			fs.mkdirSync(skillDir, { recursive: true });
			fs.writeFileSync(
				path.join(skillDir, "SKILL.md"),
				`---\nname: Bad Skill\ndescription: Bad name\n---\nBody.`,
				"utf-8",
			);
			const diagnostics = await discoverSkillDiagnostics(tmpDir);
			expect(diagnostics.length).toBeGreaterThan(0);
			expect(
				diagnostics.some((diagnostic) =>
					diagnostic.message.toLowerCase().includes("invalid"),
				),
			).toBe(true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("discovers Lattice Library skills", async () => {
		const { discoverSkills } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-library-skill-discovery-"),
		);
		try {
			const libraryRoot = path.join(tmpDir, "team-library");
			fs.mkdirSync(path.join(libraryRoot, "skills", "example-analysis"), {
				recursive: true,
			});
			fs.writeFileSync(
				path.join(libraryRoot, "lattice-library.json"),
				JSON.stringify({
					schema: LATTICE_LIBRARY_SCHEMA,
					name: "team",
					resources: {},
				}),
			);
			fs.writeFileSync(
				path.join(libraryRoot, "skills", "example-analysis", "SKILL.md"),
				"---\nname: example-analysis\ndescription: Example analysis\n---\n",
			);
			fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: { libraries: ["./team-library"] },
				}),
			);

			const skills = await discoverSkills(tmpDir);
			const skill = skills.find(
				(candidate) => candidate.name === "example-analysis",
			);
			expect(skill).toBeDefined();
			expect(skill?.source).toBe("lattice-library");
			expect(skill?.scope).toBe("team");
			expect(skill?.editable).toBe(true);
			expect(skill?.ref).toBe("team:skills/example-analysis/SKILL.md");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("detects package-provided skill paths", async () => {
		const { isPackageProvidedSkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		expect(
			isPackageProvidedSkill(
				"/home/ubuntu/.pi/agent/npm/node_modules/pi-web-access/skills/librarian/SKILL.md",
			),
		).toBe(true);
		expect(
			isPackageProvidedSkill(
				"/home/ubuntu/.bun/install/global/node_modules/some-package/skills/helper/SKILL.md",
			),
		).toBe(true);
		expect(isPackageProvidedSkill("/repo/.pi/skills/local/SKILL.md")).toBe(
			false,
		);
	});

	it("discovers project skills", async () => {
		const { discoverSkills } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-skills-api-"));
		try {
			const skillDir = path.join(tmpDir, ".pi", "skills", "demo");
			fs.mkdirSync(skillDir, { recursive: true });
			fs.writeFileSync(
				path.join(skillDir, "SKILL.md"),
				`---\nname: demo\ndescription: Demo skill\n---\nUse demo.`,
				"utf-8",
			);
			const skills = await discoverSkills(tmpDir);
			const demo = skills.find((skill) => skill.name === "demo");
			expect(demo?.description).toBe("Demo skill");
			expect(demo?.path).toEndWith(path.join("demo", "SKILL.md"));
			expect(demo?.id).toBeString();
			expect(demo?.baseDir).toEndWith("demo");
			expect(demo?.kind).toBe("directory");
			expect(demo?.editable).toBe(true);
			expect(demo?.packageProvided).toBe(false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("creates skills in the first configured Lattice Library by default", async () => {
		const { createSkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-create-library-skill-"),
		);
		try {
			const libraryRoot = path.join(tmpDir, "team-library");
			fs.mkdirSync(path.join(libraryRoot, "skills"), { recursive: true });
			fs.writeFileSync(
				path.join(libraryRoot, "lattice-library.json"),
				JSON.stringify({
					schema: LATTICE_LIBRARY_SCHEMA,
					name: "team",
					resources: { skills: "skills" },
				}),
			);
			fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: { libraries: ["./team-library"] },
				}),
			);

			const result = await createSkill(
				{ name: "Library Skill", description: "Library target" },
				tmpDir,
			);

			expect(result.success).toBe(true);
			expect(result.detail?.skill.source).toBe("lattice-library");
			expect(result.detail?.skill.scope).toBe("team");
			expect(
				fs.existsSync(
					path.join(libraryRoot, "skills", "library-skill", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(tmpDir, ".pi", "skills", "library-skill", "SKILL.md"),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("creates skills in an explicitly selected Lattice Library", async () => {
		const { createSkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-create-selected-library-skill-"),
		);
		try {
			for (const name of ["first", "second"]) {
				const libraryRoot = path.join(tmpDir, `${name}-library`);
				fs.mkdirSync(path.join(libraryRoot, "skills"), { recursive: true });
				fs.writeFileSync(
					path.join(libraryRoot, "lattice-library.json"),
					JSON.stringify({
						schema: LATTICE_LIBRARY_SCHEMA,
						name,
						resources: { skills: "skills" },
					}),
				);
			}
			fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: {
						libraries: ["./first-library", "./second-library"],
					},
				}),
			);

			const result = await createSkill(
				{
					targetLibrary: "second",
					name: "Selected Skill",
					description: "Selected target",
				},
				tmpDir,
			);

			expect(result.success).toBe(true);
			expect(result.detail?.skill.scope).toBe("second");
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						"second-library",
						"skills",
						"selected-skill",
						"SKILL.md",
					),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						"first-library",
						"skills",
						"selected-skill",
						"SKILL.md",
					),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("copies a skill directory into project scope with rewritten frontmatter", async () => {
		const { discoverSkills, copySkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-copy-skill-"));
		try {
			const skillDir = path.join(tmpDir, ".pi", "skills", "source-skill");
			fs.mkdirSync(path.join(skillDir, "references"), { recursive: true });
			fs.writeFileSync(
				path.join(skillDir, "SKILL.md"),
				`---\nname: source-skill\ndescription: Source skill\n---\n# Source\n\nUse [ref](references/ref.md).`,
				"utf-8",
			);
			fs.writeFileSync(
				path.join(skillDir, "references", "ref.md"),
				"# Ref\n",
				"utf-8",
			);
			const source = (await discoverSkills(tmpDir)).find(
				(skill) => skill.name === "source-skill",
			)!;

			const result = await copySkill(
				source.id,
				{
					scope: "project",
					name: "Derived Skill",
					description: "Derived copy",
				},
				tmpDir,
			);

			expect(result.success).toBe(true);
			expect(result.detail?.skill.name).toBe("derived-skill");
			const copiedSkillFile = path.join(
				tmpDir,
				".pi",
				"skills",
				"derived-skill",
				"SKILL.md",
			);
			expect(fs.readFileSync(copiedSkillFile, "utf-8")).toStartWith(
				`---\nname: derived-skill\ndescription: Derived copy\n---\n`,
			);
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						".pi",
						"skills",
						"derived-skill",
						"references",
						"ref.md",
					),
				),
			).toBe(true);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("copies a skill directory into an explicitly selected Lattice Library", async () => {
		const { discoverSkills, copySkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const { LATTICE_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-copy-skill-library-"),
		);
		try {
			const sourceDir = path.join(tmpDir, ".pi", "skills", "source-skill");
			fs.mkdirSync(sourceDir, { recursive: true });
			fs.writeFileSync(
				path.join(sourceDir, "SKILL.md"),
				`---\nname: source-skill\ndescription: Source skill\n---\n# Source\n`,
				"utf-8",
			);
			for (const name of ["first", "second"]) {
				const libraryRoot = path.join(tmpDir, `${name}-library`);
				fs.mkdirSync(path.join(libraryRoot, "skills"), { recursive: true });
				fs.writeFileSync(
					path.join(libraryRoot, "lattice-library.json"),
					JSON.stringify({
						schema: LATTICE_LIBRARY_SCHEMA,
						name,
						resources: { skills: "skills" },
					}),
				);
			}
			fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(tmpDir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: {
						libraries: ["./first-library", "./second-library"],
					},
				}),
			);
			const source = (await discoverSkills(tmpDir)).find(
				(skill) => skill.name === "source-skill",
			)!;

			const result = await copySkill(
				source.id,
				{
					targetLibrary: "second",
					name: "Library Copy",
					description: "Library copy",
				},
				tmpDir,
			);

			expect(result.success).toBe(true);
			expect(result.detail?.skill.scope).toBe("second");
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						"second-library",
						"skills",
						"library-copy",
						"SKILL.md",
					),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(
						tmpDir,
						"first-library",
						"skills",
						"library-copy",
						"SKILL.md",
					),
				),
			).toBe(false);
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("rejects skill copies that would collide with discovered skill names", async () => {
		const { discoverSkills, copySkill } = await import(
			"../extensions/multi-agent/skill-discovery.js"
		);
		const tmpDir = fs.mkdtempSync(
			path.join(os.tmpdir(), "pi-copy-skill-collision-"),
		);
		try {
			for (const name of ["source-skill", "existing-skill"]) {
				const skillDir = path.join(tmpDir, ".pi", "skills", name);
				fs.mkdirSync(skillDir, { recursive: true });
				fs.writeFileSync(
					path.join(skillDir, "SKILL.md"),
					`---\nname: ${name}\ndescription: ${name}\n---\n`,
					"utf-8",
				);
			}
			const source = (await discoverSkills(tmpDir)).find(
				(skill) => skill.name === "source-skill",
			)!;

			const result = await copySkill(
				source.id,
				{ scope: "project", name: "existing-skill", description: "Duplicate" },
				tmpDir,
			);

			expect(result.success).toBe(false);
			expect(result.status).toBe(409);
			expect(result.error).toContain("already exists");
		} finally {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
