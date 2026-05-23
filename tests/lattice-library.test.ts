import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	ORCHESTRATOR_LIBRARY_SCHEMA,
	bootstrapLatticeLibrary,
	discoverConfiguredLatticeLibraries,
	discoverLatticeLibraryResources,
	readLatticeLibraries,
	readLatticeLibrary,
	readLatticeDisplaySettings,
	readLatticeLibrarySettings,
	updateLatticeDisplaySettings,
	updateLatticeLibraryEnabled,
	updateLatticeLibrarySettings,
} from "../extensions/multi-agent/lattice-library.js";

function withTempDir(prefix: string, fn: (dir: string) => void) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
	try {
		fn(dir);
	} finally {
		fs.rmSync(dir, { recursive: true, force: true });
	}
}

function writeManifest(dir: string, manifest: unknown) {
	fs.writeFileSync(
		path.join(dir, "lattice-library.json"),
		JSON.stringify(manifest, null, 2),
	);
}

describe("orchestrator library manifest", () => {
	it("loads a valid manifest and resolves configurable resource directories", () => {
		withTempDir("pio-library-valid-", (dir) => {
			fs.mkdirSync(path.join(dir, "orchestrator", "agents"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(dir, "orchestrator", "skill-templates"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(dir, "orchestrator", "extension-templates"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(dir, "pi", "skills"), { recursive: true });
			fs.mkdirSync(path.join(dir, "pi", "extensions"), { recursive: true });
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "team-ai",
				description: "Team resources",
				compatibility: { piLattice: ">=0.1.0" },
				resources: {
					agents: "orchestrator/agents",
					skillTemplates: "orchestrator/skill-templates",
					extensionTemplates: "orchestrator/extension-templates",
					skills: "pi/skills",
					extensions: "pi/extensions",
				},
			});

			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(true);
			expect(library.manifest?.name).toBe("team-ai");
			expect(library.resourceDirs.agents.resolvedPath).toBe(
				path.join(dir, "orchestrator", "agents"),
			);
			expect(library.resourceDirs.skills.exists).toBe(true);
			expect(
				library.diagnostics.filter(
					(diagnostic) => diagnostic.level === "error",
				),
			).toHaveLength(0);
		});
	});

	it("reports a missing manifest", () => {
		withTempDir("pio-library-missing-", (dir) => {
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("Missing lattice-library.json"),
				),
			).toBe(true);
		});
	});

	it("reports invalid JSON", () => {
		withTempDir("pio-library-invalid-json-", (dir) => {
			fs.writeFileSync(path.join(dir, "lattice-library.json"), "{ nope");
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("Invalid lattice-library.json"),
				),
			).toBe(true);
		});
	});

	it("reports missing required schema and name", () => {
		withTempDir("pio-library-missing-required-", (dir) => {
			writeManifest(dir, { resources: {} });
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("Unsupported Lattice Library schema"),
				),
			).toBe(true);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("manifest name is required"),
				),
			).toBe(true);
		});
	});

	it("treats missing resource directories as warnings", () => {
		withTempDir("pio-library-missing-dirs-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "personal-ai",
				resources: {
					agents: "agents",
					skillTemplates: "skill-templates",
					extensionTemplates: "extension-templates",
					skills: "skills",
					extensions: "extensions",
				},
			});
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(true);
			expect(
				library.diagnostics.filter(
					(diagnostic) => diagnostic.level === "warning",
				).length,
			).toBeGreaterThan(0);
			expect(
				library.diagnostics.filter(
					(diagnostic) => diagnostic.level === "error",
				),
			).toHaveLength(0);
		});
	});

	it("accepts compatible pi-lattice version ranges", () => {
		withTempDir("pio-library-compatible-version-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "compatible-version",
				compatibility: { piLattice: ">=0.1.0 <1.0.0" },
				resources: {},
			});
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(true);
			expect(
				library.diagnostics.filter(
					(diagnostic) => diagnostic.level === "error",
				),
			).toHaveLength(0);
		});
	});

	it("rejects libraries that require a newer pi-lattice version", () => {
		withTempDir("pio-library-newer-version-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "future-version",
				compatibility: { piLattice: ">=999.0.0" },
				resources: {},
			});
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some(
					(diagnostic) =>
						diagnostic.level === "error" &&
						diagnostic.message.includes(
							"requires pi-lattice >=999.0.0",
						),
				),
			).toBe(true);
		});
	});

	it("rejects non-string pi-lattice compatibility values", () => {
		withTempDir("pio-library-invalid-version-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "invalid-version",
				compatibility: { piLattice: 123 },
				resources: {},
			});
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes(
						"compatibility.piLattice must be a string",
					),
				),
			).toBe(true);
		});
	});

	it("rejects resource paths that escape the library root", () => {
		withTempDir("pio-library-escape-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "escape-test",
				resources: {
					agents: "../agents",
					skillTemplates: "skill-templates",
					extensionTemplates: "extension-templates",
					skills: "skills",
					extensions: "extensions",
				},
			});
			const library = readLatticeLibrary(dir);
			expect(library.valid).toBe(false);
			expect(
				library.diagnostics.some((diagnostic) =>
					diagnostic.message.includes("agents resource path must stay inside"),
				),
			).toBe(true);
		});
	});

	it("accepts multiple libraries with distinct manifest namespaces", () => {
		withTempDir("pio-library-set-", (dir) => {
			const one = path.join(dir, "one");
			const two = path.join(dir, "two");
			fs.mkdirSync(one, { recursive: true });
			fs.mkdirSync(two, { recursive: true });
			writeManifest(one, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "one",
				resources: {},
			});
			writeManifest(two, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "two",
				resources: {},
			});

			const set = readLatticeLibraries([one, two]);
			expect(set.valid).toBe(true);
			expect(set.libraries.map((library) => library.manifest?.name)).toEqual([
				"one",
				"two",
			]);
			expect(
				set.diagnostics.filter((diagnostic) => diagnostic.level === "error"),
			).toHaveLength(0);
		});
	});

	it("rejects duplicate manifest namespaces with both paths in the diagnostic", () => {
		withTempDir("pio-library-duplicates-", (dir) => {
			const one = path.join(dir, "one");
			const two = path.join(dir, "two");
			fs.mkdirSync(one, { recursive: true });
			fs.mkdirSync(two, { recursive: true });
			writeManifest(one, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "team",
				resources: {},
			});
			writeManifest(two, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "team",
				resources: {},
			});

			const set = readLatticeLibraries([one, two]);
			expect(set.valid).toBe(false);
			const duplicate = set.diagnostics.find((diagnostic) =>
				diagnostic.message.includes(
					"Duplicate Lattice Library namespace 'team'",
				),
			);
			expect(duplicate?.message).toContain(one);
			expect(duplicate?.message).toContain(two);
			expect(set.libraries[0].valid).toBe(true);
			expect(set.libraries[1].valid).toBe(false);
		});
	});
});

describe("orchestrator library resource discovery", () => {
	it("discovers one resource per category from a valid library", () => {
		withTempDir("pio-library-discovery-", (dir) => {
			fs.mkdirSync(path.join(dir, "agents"), { recursive: true });
			fs.mkdirSync(path.join(dir, "skill-templates"), { recursive: true });
			fs.mkdirSync(path.join(dir, "extension-templates"), { recursive: true });
			fs.mkdirSync(path.join(dir, "skills", "example-analysis"), {
				recursive: true,
			});
			fs.mkdirSync(path.join(dir, "extensions", "example-extension"), {
				recursive: true,
			});
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "team-ai",
				resources: {},
			});
			fs.writeFileSync(
				path.join(dir, "agents", "reviewer.md"),
				"---\nname: reviewer\ndescription: Reviews code\n---\n",
			);
			fs.writeFileSync(
				path.join(dir, "skill-templates", "core.md"),
				"---\nname: core\ndescription: Core skills\nskills: skills/example-analysis\n---\n",
			);
			fs.writeFileSync(
				path.join(dir, "extension-templates", "web.md"),
				"---\nname: web\ndescription: Web tools\nextensions: extensions/example-extension\n---\n",
			);
			fs.writeFileSync(
				path.join(dir, "skills", "example-analysis", "SKILL.md"),
				"---\nname: example-analysis\ndescription: Analyze things\n---\n",
			);
			fs.writeFileSync(
				path.join(dir, "extensions", "example-extension", "index.ts"),
				"export default function () {}\n",
			);

			const discovery = discoverLatticeLibraryResources(dir);
			expect(discovery.library.valid).toBe(true);
			expect(
				discovery.resources
					.map((resource) => `${resource.kind}:${resource.name}`)
					.sort(),
			).toEqual([
				"agents:reviewer",
				"extensionTemplates:web",
				"extensions:example-extension",
				"skillTemplates:core",
				"skills:example-analysis",
			]);
			expect(
				discovery.resources.every(
					(resource) => resource.libraryName === "team-ai",
				),
			).toBe(true);
			expect(
				discovery.resources.every(
					(resource) => resource.editable && !resource.readOnly,
				),
			).toBe(true);
		});
	});

	it("returns warnings but no resources when resource directories are missing", () => {
		withTempDir("pio-library-discovery-missing-", (dir) => {
			writeManifest(dir, {
				schema: ORCHESTRATOR_LIBRARY_SCHEMA,
				name: "empty-library",
				resources: {},
			});
			const discovery = discoverLatticeLibraryResources(dir);
			expect(discovery.library.valid).toBe(true);
			expect(discovery.resources).toHaveLength(0);
			expect(
				discovery.diagnostics.some(
					(diagnostic) =>
						diagnostic.level === "warning" &&
						diagnostic.message.includes("directory does not exist"),
				),
			).toBe(true);
		});
	});
});

describe("orchestrator library bootstrap", () => {
	it("creates a starter library scaffold and registers in project settings for in-repo paths", () => {
		withTempDir("pio-bootstrap-project-", (dir) => {
			const result = bootstrapLatticeLibrary(
				{ targetPath: "./.pi/lattice-library", name: "project-ai" },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(result.success).toBe(true);
			expect(result.scope).toBe("project");
			const root = path.join(dir, ".pi", "lattice-library");
			expect(fs.existsSync(path.join(root, "lattice-library.json"))).toBe(
				true,
			);
			expect(
				fs.existsSync(path.join(root, "agents", "example-researcher.md")),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(root, "skill-templates", "example-core-skills.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(root, "extension-templates", "example-web-tools.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(root, "skills", "example-analysis", "SKILL.md"),
				),
			).toBe(true);
			expect(
				fs.existsSync(
					path.join(root, "extensions", "example-extension", "index.ts"),
				),
			).toBe(true);
			expect(readLatticeLibrary(root).valid).toBe(true);
			const settings = readLatticeLibrarySettings(dir, {
				globalSettingsPath: path.join(dir, "global-settings.json"),
			});
			expect(settings.project.libraries.map((library) => library.path)).toEqual(
				[".pi/lattice-library"],
			);
		});
	});

	it("registers outside-repo bootstrap paths in global settings", () => {
		withTempDir("pio-bootstrap-global-repo-", (repo) => {
			withTempDir("pio-bootstrap-global-target-", (parent) => {
				const target = path.join(parent, "team-ai");
				const globalSettingsPath = path.join(repo, "global-settings.json");
				const result = bootstrapLatticeLibrary(
					{ targetPath: target, name: "team-ai" },
					repo,
					{ globalSettingsPath },
				);
				expect(result.success).toBe(true);
				expect(result.scope).toBe("global");
				const settings = readLatticeLibrarySettings(repo, {
					globalSettingsPath,
				});
				expect(
					settings.global.libraries.map((library) => library.path),
				).toEqual([target]);
			});
		});
	});

	it("refuses to overwrite non-empty incompatible directories", () => {
		withTempDir("pio-bootstrap-refuse-", (dir) => {
			const target = path.join(dir, "not-empty");
			fs.mkdirSync(target, { recursive: true });
			fs.writeFileSync(path.join(target, "file.txt"), "content");
			const result = bootstrapLatticeLibrary(
				{ targetPath: target, name: "bad" },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(result.success).toBe(false);
			expect(result.status).toBe(409);
			expect(result.error).toContain("not empty");
		});
	});
});

describe("configured orchestrator library discovery", () => {
	function createLibrary(root: string, name: string, agentName: string) {
		fs.mkdirSync(path.join(root, "agents"), { recursive: true });
		writeManifest(root, {
			schema: ORCHESTRATOR_LIBRARY_SCHEMA,
			name,
			resources: {},
		});
		fs.writeFileSync(
			path.join(root, "agents", `${agentName}.md`),
			`---\nname: ${agentName}\ndescription: ${agentName}\n---\n`,
		);
	}

	it("discovers repo-local then external mounted libraries from bounded manifest locations", () => {
		withTempDir("pio-auto-discovery-", (dir) => {
			const repoOne = path.join(
				dir,
				".pi",
				"pi-lattice",
				"libraries",
				"repo-one",
			);
			const externalOne = path.join(
				dir,
				".pi",
				"pi-lattice",
				"external-libraries",
				"external-one",
			);
			createLibrary(repoOne, "repo-one", "agent-a");
			createLibrary(externalOne, "external-one", "agent-b");

			const discovery = discoverConfiguredLatticeLibraries(dir, {
				globalSettingsPath: path.join(dir, "global-settings.json"),
			});
			expect(discovery.valid).toBe(true);
			expect(
				discovery.libraries.map(
					(library) => `${library.source}:${library.manifest?.name}`,
				),
			).toEqual(["repo:repo-one", "external-mounted:external-one"]);
			expect(
				discovery.libraries.every((library) => library.enabled === true),
			).toBe(true);
			expect(
				discovery.resources
					.filter((resource) => resource.kind === "agents")
					.map((resource) => resource.name),
			).toEqual(["agent-a", "agent-b"]);
		});
	});

	it("keeps disabled auto-discovered libraries visible but excludes their resources", () => {
		withTempDir("pio-auto-disabled-", (dir) => {
			const enabledRoot = path.join(
				dir,
				".pi",
				"pi-lattice",
				"libraries",
				"enabled",
			);
			const disabledRoot = path.join(
				dir,
				".pi",
				"pi-lattice",
				"external-libraries",
				"disabled",
			);
			createLibrary(enabledRoot, "enabled", "agent-a");
			createLibrary(disabledRoot, "disabled", "agent-b");
			fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(dir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: {
						disabledLibraries: [
							".pi/pi-lattice/external-libraries/disabled",
						],
					},
				}),
			);

			const discovery = discoverConfiguredLatticeLibraries(dir, {
				globalSettingsPath: path.join(dir, "global-settings.json"),
			});
			expect(
				discovery.libraries.map(
					(library) => `${library.manifest?.name}:${library.enabled}`,
				),
			).toEqual(["enabled:true", "disabled:false"]);
			expect(discovery.resources.map((resource) => resource.name)).toEqual([
				"agent-a",
			]);
			expect(discovery.valid).toBe(true);
		});
	});

	it("persists enable and disable actions in project settings", () => {
		withTempDir("pio-auto-toggle-", (dir) => {
			const root = path.join(
				dir,
				".pi",
				"pi-lattice",
				"libraries",
				"toggle-me",
			);
			createLibrary(root, "toggle-me", "agent-a");

			const disabled = updateLatticeLibraryEnabled(
				{ root, enabled: false },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(disabled.success).toBe(true);
			expect(disabled.discovery?.libraries[0].enabled).toBe(false);
			expect(disabled.discovery?.resources).toHaveLength(0);

			const enabled = updateLatticeLibraryEnabled(
				{ root, enabled: true },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(enabled.success).toBe(true);
			expect(enabled.discovery?.libraries[0].enabled).toBe(true);
			expect(
				enabled.discovery?.resources.map((resource) => resource.name),
			).toEqual(["agent-a"]);
		});
	});

	it("reports duplicate namespace diagnostics from enabled auto-discovered libraries", () => {
		withTempDir("pio-auto-duplicates-", (dir) => {
			const one = path.join(
				dir,
				".pi",
				"pi-lattice",
				"libraries",
				"one",
			);
			const two = path.join(
				dir,
				".pi",
				"pi-lattice",
				"external-libraries",
				"two",
			);
			createLibrary(one, "team", "agent-a");
			createLibrary(two, "team", "agent-b");

			const discovery = discoverConfiguredLatticeLibraries(dir, {
				globalSettingsPath: path.join(dir, "global-settings.json"),
			});
			expect(discovery.valid).toBe(false);
			expect(
				discovery.diagnostics.some((diagnostic) =>
					diagnostic.message.includes(
						"Duplicate Lattice Library namespace 'team'",
					),
				),
			).toBe(true);
			expect(discovery.resources.map((resource) => resource.name)).toEqual([
				"agent-a",
			]);
		});
	});
});

describe("orchestrator display settings", () => {
	it("defaults to showing package examples and stores the toggle in project settings", () => {
		withTempDir("pio-display-settings-", (dir) => {
			const settingsPath = path.join(dir, ".pi", "settings.json");
			expect(
				readLatticeDisplaySettings(dir, {
					globalSettingsPath: path.join(dir, "global-settings.json"),
				}).showPackageExamples,
			).toBe(true);

			const result = updateLatticeDisplaySettings(
				{ showPackageExamples: false },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(result.success).toBe(true);
			expect(result.settings?.showPackageExamples).toBe(false);
			expect(
				readLatticeDisplaySettings(dir, {
					globalSettingsPath: path.join(dir, "global-settings.json"),
				}).showPackageExamples,
			).toBe(false);
			const raw = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
			expect(raw.piLattice.showPackageExamples).toBe(false);
		});
	});
});

describe("orchestrator library settings", () => {
	it("reads empty global and project settings", () => {
		withTempDir("pio-library-settings-empty-", (dir) => {
			const settings = readLatticeLibrarySettings(dir, {
				globalSettingsPath: path.join(dir, "global-settings.json"),
			});
			expect(settings.global.libraries).toEqual([]);
			expect(settings.project.libraries).toEqual([]);
			expect(settings.libraries).toEqual([]);
		});
	});

	it("reads global and project libraries in order", () => {
		withTempDir("pio-library-settings-read-", (dir) => {
			const globalSettingsPath = path.join(dir, "global-settings.json");
			fs.writeFileSync(
				globalSettingsPath,
				JSON.stringify({
					piLattice: {
						libraries: ["~/personal", { path: "~/team", editable: true }],
					},
				}),
			);
			fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(dir, ".pi", "settings.json"),
				JSON.stringify({
					piLattice: { libraries: ["./.pi/lattice-library"] },
				}),
			);

			const settings = readLatticeLibrarySettings(dir, {
				globalSettingsPath,
			});
			expect(settings.global.libraries.map((library) => library.path)).toEqual([
				"~/personal",
				"~/team",
			]);
			expect(settings.global.libraries[1].editable).toBe(true);
			expect(settings.project.libraries.map((library) => library.path)).toEqual(
				["./.pi/lattice-library"],
			);
			expect(
				settings.libraries.map((library) => `${library.scope}:${library.path}`),
			).toEqual([
				"global:~/personal",
				"global:~/team",
				"project:./.pi/lattice-library",
			]);
		});
	});

	it("writes project libraries without clobbering unrelated settings", () => {
		withTempDir("pio-library-settings-project-", (dir) => {
			fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
			fs.writeFileSync(
				path.join(dir, ".pi", "settings.json"),
				JSON.stringify(
					{
						packages: ["pkg"],
						skills: ["skills"],
						piLattice: { theme: "dark" },
					},
					null,
					2,
				),
			);

			const result = updateLatticeLibrarySettings(
				{ scope: "project", libraries: ["./.pi/lattice-library"] },
				dir,
				{ globalSettingsPath: path.join(dir, "global-settings.json") },
			);
			expect(result.success).toBe(true);
			const raw = JSON.parse(
				fs.readFileSync(path.join(dir, ".pi", "settings.json"), "utf-8"),
			);
			expect(raw.packages).toEqual(["pkg"]);
			expect(raw.skills).toEqual(["skills"]);
			expect(raw.piLattice.theme).toBe("dark");
			expect(raw.piLattice.libraries).toEqual([
				{ path: "./.pi/lattice-library" },
			]);
		});
	});

	it("writes global libraries", () => {
		withTempDir("pio-library-settings-global-", (dir) => {
			const globalSettingsPath = path.join(
				dir,
				"home",
				".pi",
				"agent",
				"settings.json",
			);
			const result = updateLatticeLibrarySettings(
				{ scope: "global", libraries: [{ path: "~/team", editable: true }] },
				dir,
				{ globalSettingsPath },
			);
			expect(result.success).toBe(true);
			const raw = JSON.parse(fs.readFileSync(globalSettingsPath, "utf-8"));
			expect(raw.piLattice.libraries).toEqual([
				{ path: "~/team", editable: true },
			]);
			expect(result.settings?.global.libraries[0]).toMatchObject({
				scope: "global",
				path: "~/team",
				editable: true,
			});
		});
	});
});
