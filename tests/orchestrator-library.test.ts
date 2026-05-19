import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ORCHESTRATOR_LIBRARY_SCHEMA, bootstrapOrchestratorLibrary, discoverConfiguredOrchestratorLibraries, discoverOrchestratorLibraryResources, readOrchestratorLibraries, readOrchestratorLibrary, readOrchestratorLibrarySettings, updateOrchestratorLibrarySettings } from "../extensions/multi-agent/orchestrator-library.js";

function withTempDir(prefix: string, fn: (dir: string) => void) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function writeManifest(dir: string, manifest: unknown) {
  fs.writeFileSync(path.join(dir, "orchestrator-library.json"), JSON.stringify(manifest, null, 2));
}

describe("orchestrator library manifest", () => {
  it("loads a valid manifest and resolves configurable resource directories", () => {
    withTempDir("pio-library-valid-", (dir) => {
      fs.mkdirSync(path.join(dir, "orchestrator", "agents"), { recursive: true });
      fs.mkdirSync(path.join(dir, "orchestrator", "skill-templates"), { recursive: true });
      fs.mkdirSync(path.join(dir, "orchestrator", "extension-templates"), { recursive: true });
      fs.mkdirSync(path.join(dir, "pi", "skills"), { recursive: true });
      fs.mkdirSync(path.join(dir, "pi", "extensions"), { recursive: true });
      writeManifest(dir, {
        schema: ORCHESTRATOR_LIBRARY_SCHEMA,
        name: "team-ai",
        description: "Team resources",
        compatibility: { piAgentOrchestrator: ">=0.3.0" },
        resources: {
          agents: "orchestrator/agents",
          skillTemplates: "orchestrator/skill-templates",
          extensionTemplates: "orchestrator/extension-templates",
          skills: "pi/skills",
          extensions: "pi/extensions",
        },
      });

      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(true);
      expect(library.manifest?.name).toBe("team-ai");
      expect(library.resourceDirs.agents.resolvedPath).toBe(path.join(dir, "orchestrator", "agents"));
      expect(library.resourceDirs.skills.exists).toBe(true);
      expect(library.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
    });
  });

  it("reports a missing manifest", () => {
    withTempDir("pio-library-missing-", (dir) => {
      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(false);
      expect(library.diagnostics.some((diagnostic) => diagnostic.message.includes("Missing orchestrator-library.json"))).toBe(true);
    });
  });

  it("reports invalid JSON", () => {
    withTempDir("pio-library-invalid-json-", (dir) => {
      fs.writeFileSync(path.join(dir, "orchestrator-library.json"), "{ nope");
      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(false);
      expect(library.diagnostics.some((diagnostic) => diagnostic.message.includes("Invalid orchestrator-library.json"))).toBe(true);
    });
  });

  it("reports missing required schema and name", () => {
    withTempDir("pio-library-missing-required-", (dir) => {
      writeManifest(dir, { resources: {} });
      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(false);
      expect(library.diagnostics.some((diagnostic) => diagnostic.message.includes("Unsupported orchestrator library schema"))).toBe(true);
      expect(library.diagnostics.some((diagnostic) => diagnostic.message.includes("manifest name is required"))).toBe(true);
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
      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(true);
      expect(library.diagnostics.filter((diagnostic) => diagnostic.level === "warning").length).toBeGreaterThan(0);
      expect(library.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
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
      const library = readOrchestratorLibrary(dir);
      expect(library.valid).toBe(false);
      expect(library.diagnostics.some((diagnostic) => diagnostic.message.includes("agents resource path must stay inside"))).toBe(true);
    });
  });

  it("accepts multiple libraries with distinct manifest namespaces", () => {
    withTempDir("pio-library-set-", (dir) => {
      const one = path.join(dir, "one");
      const two = path.join(dir, "two");
      fs.mkdirSync(one, { recursive: true });
      fs.mkdirSync(two, { recursive: true });
      writeManifest(one, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "one", resources: {} });
      writeManifest(two, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "two", resources: {} });

      const set = readOrchestratorLibraries([one, two]);
      expect(set.valid).toBe(true);
      expect(set.libraries.map((library) => library.manifest?.name)).toEqual(["one", "two"]);
      expect(set.diagnostics.filter((diagnostic) => diagnostic.level === "error")).toHaveLength(0);
    });
  });

  it("rejects duplicate manifest namespaces with both paths in the diagnostic", () => {
    withTempDir("pio-library-duplicates-", (dir) => {
      const one = path.join(dir, "one");
      const two = path.join(dir, "two");
      fs.mkdirSync(one, { recursive: true });
      fs.mkdirSync(two, { recursive: true });
      writeManifest(one, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: {} });
      writeManifest(two, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: {} });

      const set = readOrchestratorLibraries([one, two]);
      expect(set.valid).toBe(false);
      const duplicate = set.diagnostics.find((diagnostic) => diagnostic.message.includes("Duplicate Orchestrator Library namespace 'team'"));
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
      fs.mkdirSync(path.join(dir, "skills", "example-analysis"), { recursive: true });
      fs.mkdirSync(path.join(dir, "extensions", "example-extension"), { recursive: true });
      writeManifest(dir, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team-ai", resources: {} });
      fs.writeFileSync(path.join(dir, "agents", "reviewer.md"), "---\nname: reviewer\ndescription: Reviews code\n---\n");
      fs.writeFileSync(path.join(dir, "skill-templates", "core.md"), "---\nname: core\ndescription: Core skills\nskills: skills/example-analysis\n---\n");
      fs.writeFileSync(path.join(dir, "extension-templates", "web.md"), "---\nname: web\ndescription: Web tools\nextensions: extensions/example-extension\n---\n");
      fs.writeFileSync(path.join(dir, "skills", "example-analysis", "SKILL.md"), "---\nname: example-analysis\ndescription: Analyze things\n---\n");
      fs.writeFileSync(path.join(dir, "extensions", "example-extension", "index.ts"), "export default function () {}\n");

      const discovery = discoverOrchestratorLibraryResources(dir);
      expect(discovery.library.valid).toBe(true);
      expect(discovery.resources.map((resource) => `${resource.kind}:${resource.name}`).sort()).toEqual([
        "agents:reviewer",
        "extensionTemplates:web",
        "extensions:example-extension",
        "skillTemplates:core",
        "skills:example-analysis",
      ]);
      expect(discovery.resources.every((resource) => resource.libraryName === "team-ai")).toBe(true);
      expect(discovery.resources.every((resource) => resource.editable && !resource.readOnly)).toBe(true);
    });
  });

  it("returns warnings but no resources when resource directories are missing", () => {
    withTempDir("pio-library-discovery-missing-", (dir) => {
      writeManifest(dir, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "empty-library", resources: {} });
      const discovery = discoverOrchestratorLibraryResources(dir);
      expect(discovery.library.valid).toBe(true);
      expect(discovery.resources).toHaveLength(0);
      expect(discovery.diagnostics.some((diagnostic) => diagnostic.level === "warning" && diagnostic.message.includes("directory does not exist"))).toBe(true);
    });
  });
});

describe("orchestrator library bootstrap", () => {
  it("creates a starter library scaffold and registers in project settings for in-repo paths", () => {
    withTempDir("pio-bootstrap-project-", (dir) => {
      const result = bootstrapOrchestratorLibrary({ targetPath: "./.pi/orchestrator-library", name: "project-ai" }, dir, { globalSettingsPath: path.join(dir, "global-settings.json") });
      expect(result.success).toBe(true);
      expect(result.scope).toBe("project");
      const root = path.join(dir, ".pi", "orchestrator-library");
      expect(fs.existsSync(path.join(root, "orchestrator-library.json"))).toBe(true);
      expect(fs.existsSync(path.join(root, "agents", "example-researcher.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "skill-templates", "example-core-skills.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "extension-templates", "example-web-tools.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "skills", "example-analysis", "SKILL.md"))).toBe(true);
      expect(fs.existsSync(path.join(root, "extensions", "example-extension", "index.ts"))).toBe(true);
      expect(readOrchestratorLibrary(root).valid).toBe(true);
      const settings = readOrchestratorLibrarySettings(dir, { globalSettingsPath: path.join(dir, "global-settings.json") });
      expect(settings.project.libraries.map((library) => library.path)).toEqual([".pi/orchestrator-library"]);
    });
  });

  it("registers outside-repo bootstrap paths in global settings", () => {
    withTempDir("pio-bootstrap-global-repo-", (repo) => {
      withTempDir("pio-bootstrap-global-target-", (parent) => {
        const target = path.join(parent, "team-ai");
        const globalSettingsPath = path.join(repo, "global-settings.json");
        const result = bootstrapOrchestratorLibrary({ targetPath: target, name: "team-ai" }, repo, { globalSettingsPath });
        expect(result.success).toBe(true);
        expect(result.scope).toBe("global");
        const settings = readOrchestratorLibrarySettings(repo, { globalSettingsPath });
        expect(settings.global.libraries.map((library) => library.path)).toEqual([target]);
      });
    });
  });

  it("refuses to overwrite non-empty incompatible directories", () => {
    withTempDir("pio-bootstrap-refuse-", (dir) => {
      const target = path.join(dir, "not-empty");
      fs.mkdirSync(target, { recursive: true });
      fs.writeFileSync(path.join(target, "file.txt"), "content");
      const result = bootstrapOrchestratorLibrary({ targetPath: target, name: "bad" }, dir, { globalSettingsPath: path.join(dir, "global-settings.json") });
      expect(result.success).toBe(false);
      expect(result.status).toBe(409);
      expect(result.error).toContain("not empty");
    });
  });
});

describe("configured orchestrator library discovery", () => {
  function createLibrary(root: string, name: string, agentName: string) {
    fs.mkdirSync(path.join(root, "agents"), { recursive: true });
    writeManifest(root, { schema: ORCHESTRATOR_LIBRARY_SCHEMA, name, resources: {} });
    fs.writeFileSync(path.join(root, "agents", `${agentName}.md`), `---\nname: ${agentName}\ndescription: ${agentName}\n---\n`);
  }

  it("discovers global then project libraries in configured order", () => {
    withTempDir("pio-configured-discovery-", (dir) => {
      const globalOne = path.join(dir, "global-one");
      const globalTwo = path.join(dir, "global-two");
      const projectOne = path.join(dir, "project-one");
      createLibrary(globalOne, "global-one", "agent-a");
      createLibrary(globalTwo, "global-two", "agent-b");
      createLibrary(projectOne, "project-one", "agent-c");
      const globalSettingsPath = path.join(dir, "global-settings.json");
      fs.writeFileSync(globalSettingsPath, JSON.stringify({ piAgentOrchestrator: { libraries: [globalOne, globalTwo] } }));
      fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./project-one"] } }));

      const discovery = discoverConfiguredOrchestratorLibraries(dir, { globalSettingsPath });
      expect(discovery.valid).toBe(true);
      expect(discovery.libraries.map((library) => library.manifest?.name)).toEqual(["global-one", "global-two", "project-one"]);
      expect(discovery.resources.filter((resource) => resource.kind === "agents").map((resource) => resource.name)).toEqual(["agent-a", "agent-b", "agent-c"]);
    });
  });

  it("reports duplicate namespace diagnostics from configured libraries", () => {
    withTempDir("pio-configured-duplicates-", (dir) => {
      const one = path.join(dir, "one");
      const two = path.join(dir, "two");
      createLibrary(one, "team", "agent-a");
      createLibrary(two, "team", "agent-b");
      const globalSettingsPath = path.join(dir, "global-settings.json");
      fs.writeFileSync(globalSettingsPath, JSON.stringify({ piAgentOrchestrator: { libraries: [one, two] } }));

      const discovery = discoverConfiguredOrchestratorLibraries(dir, { globalSettingsPath });
      expect(discovery.valid).toBe(false);
      expect(discovery.diagnostics.some((diagnostic) => diagnostic.message.includes("Duplicate Orchestrator Library namespace 'team'"))).toBe(true);
      expect(discovery.resources.map((resource) => resource.name)).toEqual(["agent-a"]);
    });
  });
});

describe("orchestrator library settings", () => {
  it("reads empty global and project settings", () => {
    withTempDir("pio-library-settings-empty-", (dir) => {
      const settings = readOrchestratorLibrarySettings(dir, { globalSettingsPath: path.join(dir, "global-settings.json") });
      expect(settings.global.libraries).toEqual([]);
      expect(settings.project.libraries).toEqual([]);
      expect(settings.libraries).toEqual([]);
    });
  });

  it("reads global and project libraries in order", () => {
    withTempDir("pio-library-settings-read-", (dir) => {
      const globalSettingsPath = path.join(dir, "global-settings.json");
      fs.writeFileSync(globalSettingsPath, JSON.stringify({ piAgentOrchestrator: { libraries: ["~/personal", { path: "~/team", editable: true }] } }));
      fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./.pi/orchestrator-library"] } }));

      const settings = readOrchestratorLibrarySettings(dir, { globalSettingsPath });
      expect(settings.global.libraries.map((library) => library.path)).toEqual(["~/personal", "~/team"]);
      expect(settings.global.libraries[1].editable).toBe(true);
      expect(settings.project.libraries.map((library) => library.path)).toEqual(["./.pi/orchestrator-library"]);
      expect(settings.libraries.map((library) => `${library.scope}:${library.path}`)).toEqual(["global:~/personal", "global:~/team", "project:./.pi/orchestrator-library"]);
    });
  });

  it("writes project libraries without clobbering unrelated settings", () => {
    withTempDir("pio-library-settings-project-", (dir) => {
      fs.mkdirSync(path.join(dir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(dir, ".pi", "settings.json"), JSON.stringify({ packages: ["pkg"], skills: ["skills"], piAgentOrchestrator: { theme: "dark" } }, null, 2));

      const result = updateOrchestratorLibrarySettings({ scope: "project", libraries: ["./.pi/orchestrator-library"] }, dir, { globalSettingsPath: path.join(dir, "global-settings.json") });
      expect(result.success).toBe(true);
      const raw = JSON.parse(fs.readFileSync(path.join(dir, ".pi", "settings.json"), "utf-8"));
      expect(raw.packages).toEqual(["pkg"]);
      expect(raw.skills).toEqual(["skills"]);
      expect(raw.piAgentOrchestrator.theme).toBe("dark");
      expect(raw.piAgentOrchestrator.libraries).toEqual([{ path: "./.pi/orchestrator-library" }]);
    });
  });

  it("writes global libraries", () => {
    withTempDir("pio-library-settings-global-", (dir) => {
      const globalSettingsPath = path.join(dir, "home", ".pi", "agent", "settings.json");
      const result = updateOrchestratorLibrarySettings({ scope: "global", libraries: [{ path: "~/team", editable: true }] }, dir, { globalSettingsPath });
      expect(result.success).toBe(true);
      const raw = JSON.parse(fs.readFileSync(globalSettingsPath, "utf-8"));
      expect(raw.piAgentOrchestrator.libraries).toEqual([{ path: "~/team", editable: true }]);
      expect(result.settings?.global.libraries[0]).toMatchObject({ scope: "global", path: "~/team", editable: true });
    });
  });
});
