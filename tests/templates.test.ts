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

  it("saves and discovers project skill templates", async () => {
    const { saveSkillTemplate, discoverSkillTemplates } = await import("../extensions/multi-agent/skill-templates.js");

    const result = saveSkillTemplate({
      name: "frontend",
      description: "Frontend skills",
      items: ["react", "tailwind", "react"],
      applyToAll: true,
    }, tmpDir);

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(tmpDir, ".pi", "skill-templates", "frontend.md"));

    const templates = discoverSkillTemplates(tmpDir);
    expect(templates).toHaveLength(1);
    expect(templates[0]).toMatchObject({
      name: "frontend",
      description: "Frontend skills",
      items: ["react", "tailwind"],
      applyToAll: true,
      source: "project",
    });
  });

  it("saves and discovers templates in the first configured Orchestrator Library", async () => {
    const { saveSkillTemplate, discoverSkillTemplates } = await import("../extensions/multi-agent/skill-templates.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/orchestrator-library.js");
    const libraryRoot = path.join(tmpDir, "team-library");
    fs.mkdirSync(path.join(libraryRoot, "skill-templates"), { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, "orchestrator-library.json"), JSON.stringify({ schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: { skillTemplates: "skill-templates" } }));
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./team-library"] } }));

    const result = saveSkillTemplate({ name: "core", description: "Core skills", items: ["team:skills/core/SKILL.md"], applyToAll: false }, tmpDir);

    expect(result.success).toBe(true);
    expect(result.path).toBe(path.join(libraryRoot, "skill-templates", "core.md"));
    const templates = discoverSkillTemplates(tmpDir);
    expect(templates[0]).toMatchObject({ name: "core", source: "orchestrator-library", scope: "team" });
  });

  it("saves, loads, and deletes extension templates", async () => {
    const { saveExtensionTemplate, getExtensionTemplate, deleteExtensionTemplate, discoverExtensionTemplates } = await import("../extensions/multi-agent/extension-templates.js");

    const saved = saveExtensionTemplate({
      name: "web-tools",
      description: "Web extensions",
      items: ["browser", "fetcher"],
      applyToAll: false,
    }, tmpDir);
    expect(saved.success).toBe(true);

    const loaded = getExtensionTemplate("web-tools", tmpDir);
    expect(loaded?.items).toEqual(["browser", "fetcher"]);
    expect(loaded?.applyToAll).toBe(false);

    const deleted = deleteExtensionTemplate("web-tools", tmpDir);
    expect(deleted.success).toBe(true);
    expect(discoverExtensionTemplates(tmpDir)).toHaveLength(0);
  });

  it("rejects unsafe template names", async () => {
    const { saveSkillTemplate } = await import("../extensions/multi-agent/skill-templates.js");

    const result = saveSkillTemplate({
      name: "../escape",
      description: "Bad",
      items: [],
    }, tmpDir);

    expect(result.success).toBe(false);
    expect(result.error).toContain("name may only contain");
    expect(fs.existsSync(path.join(tmpDir, ".pi", "escape.md"))).toBe(false);
  });
});
