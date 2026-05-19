import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

function writeProfile(filePath: string, frontmatter: Record<string, string>, body = "Instructions.") {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const lines = Object.entries(frontmatter).map(([key, value]) => `${key}: ${value}`);
  fs.writeFileSync(filePath, `---\n${lines.join("\n")}\n---\n\n${body}\n`, "utf-8");
}

describe("root orchestrator profiles", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-root-profile-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("always discovers the built-in default profile", async () => {
    const { discoverRootProfiles } = await import("../extensions/multi-agent/root-profiles.js");

    const profiles = discoverRootProfiles(tmpDir);

    expect(profiles.map((profile) => profile.name)).toContain("default");
    const profile = profiles.find((candidate) => candidate.name === "default");
    expect(profile?.source).toBe("package");
    expect(profile?.readOnly).toBe(true);
    expect(profile?.instructions).toContain("root orchestrator");
  });

  it("discovers Orchestrator Library profiles from manifest-configured directories", async () => {
    const { discoverRootProfiles } = await import("../extensions/multi-agent/root-profiles.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/orchestrator-library.js");
    const libraryRoot = path.join(tmpDir, "team-library");
    fs.mkdirSync(path.join(libraryRoot, "profiles"), { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, "orchestrator-library.json"), JSON.stringify({
      schema: ORCHESTRATOR_LIBRARY_SCHEMA,
      name: "team",
      resources: { orchestratorProfiles: "profiles" },
    }));
    writeProfile(path.join(libraryRoot, "profiles", "planning.md"), {
      name: "planning",
      description: "Planning profile",
      skillTemplates: "root-planning",
    }, "Plan before delegating.");
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./team-library"] } }));

    const profiles = discoverRootProfiles(tmpDir);

    expect(profiles.find((profile) => profile.name === "planning")).toMatchObject({
      name: "planning",
      source: "orchestrator-library",
      scope: "team",
      skillTemplates: ["root-planning"],
      instructions: "Plan before delegating.",
    });
  });

  it("resolves profile skills and rejects spawned-only profile capabilities for the orchestrator", async () => {
    const { resolveRootProfileCapabilities } = await import("../extensions/multi-agent/root-profiles.js");
    const { saveSkillTemplate } = await import("../extensions/multi-agent/skill-templates.js");
    const rootSkill = path.join(tmpDir, "skills", "root");
    const spawnedSkill = path.join(tmpDir, "skills", "spawned");
    fs.mkdirSync(rootSkill, { recursive: true });
    fs.mkdirSync(spawnedSkill, { recursive: true });
    fs.writeFileSync(path.join(rootSkill, "SKILL.md"), "---\nname: root-only\ndescription: Root only\naudience: orchestrator\n---\n");
    fs.writeFileSync(path.join(spawnedSkill, "SKILL.md"), "---\nname: spawned-only\ndescription: Spawned only\naudience: spawned\n---\n");
    saveSkillTemplate({ name: "root-template", description: "Root", items: [rootSkill], audience: "orchestrator" }, tmpDir);

    const result = resolveRootProfileCapabilities({
      cwd: tmpDir,
      profile: {
        name: "root",
        description: "Root",
        skills: [spawnedSkill],
        skillTemplates: ["root-template"],
        instructions: "",
        source: "project",
        filePath: path.join(tmpDir, "profile.md"),
      },
    });

    expect(result.skills).toEqual([spawnedSkill, rootSkill]);
    expect(result.errors.some((error) => error.includes("Skill 'spawned-only' is only available to spawned agents"))).toBe(true);
  });

  it("chooses root profile activation target according to argument and profile count", async () => {
    const { chooseRootProfileActivation } = await import("../extensions/multi-agent/root-profiles.js");
    const defaultProfile = { name: "default", description: "Default", instructions: "", source: "package" as const, filePath: "default.md" };
    const planningProfile = { name: "planning", description: "Planning", instructions: "", source: "project" as const, filePath: "planning.md" };

    expect(chooseRootProfileActivation("planning", [defaultProfile, planningProfile])).toEqual({ action: "activate", profile: planningProfile });
    expect(chooseRootProfileActivation("", [defaultProfile])).toEqual({ action: "activate", profile: defaultProfile });
    expect(chooseRootProfileActivation("", [defaultProfile, planningProfile])).toEqual({ action: "select", profiles: [defaultProfile, planningProfile] });
    expect(chooseRootProfileActivation("missing", [defaultProfile])).toMatchObject({ action: "error" });
  });

  it("creates, edits, and deletes editable Orchestrator Library profiles with hash guards", async () => {
    const { saveRootProfile, getRootProfileDetail, deleteRootProfile } = await import("../extensions/multi-agent/root-profiles.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/orchestrator-library.js");
    const libraryRoot = path.join(tmpDir, "team-library");
    fs.mkdirSync(libraryRoot, { recursive: true });
    fs.writeFileSync(path.join(libraryRoot, "orchestrator-library.json"), JSON.stringify({
      schema: ORCHESTRATOR_LIBRARY_SCHEMA,
      name: "team",
      resources: { orchestratorProfiles: "profiles" },
    }));
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piAgentOrchestrator: { libraries: ["./team-library"] } }));

    const created = saveRootProfile({
      targetLibrary: "team",
      name: "planning",
      description: "Planning profile",
      skillTemplates: ["root-planning"],
      instructions: "Plan before delegating.",
    }, tmpDir);

    expect(created.success).toBe(true);
    expect(created.path).toBe(path.join(libraryRoot, "profiles", "planning.md"));
    let detail = getRootProfileDetail("planning", tmpDir);
    expect(detail?.profile).toMatchObject({ source: "orchestrator-library", scope: "team", readOnly: false });
    expect(detail?.frontmatter.skillTemplates).toBe("root-planning");
    expect(detail?.body).toBe("Plan before delegating.");

    const stale = saveRootProfile({
      name: "planning",
      description: "Planning profile",
      instructions: "Updated.",
      expectedHash: "stale",
    }, tmpDir);
    expect(stale.success).toBe(false);
    expect(stale.status).toBe(409);

    const updated = saveRootProfile({
      name: "planning",
      description: "Updated planning profile",
      skills: ["team:skills/root/SKILL.md"],
      instructions: "Updated.",
      expectedHash: detail!.hash,
    }, tmpDir);
    expect(updated.success).toBe(true);
    detail = getRootProfileDetail("planning", tmpDir);
    expect(detail?.profile.description).toBe("Updated planning profile");
    expect(detail?.content).toContain("skills: team:skills/root/SKILL.md");
    expect(detail?.body).toBe("Updated.");

    const deleted = deleteRootProfile("planning", tmpDir);
    expect(deleted.success).toBe(true);
    expect(getRootProfileDetail("planning", tmpDir)).toBeUndefined();
  });

  it("prevents editing or deleting package root profiles", async () => {
    const { getRootProfileDetail, saveRootProfile, deleteRootProfile } = await import("../extensions/multi-agent/root-profiles.js");

    const detail = getRootProfileDetail("default", tmpDir);
    expect(detail?.profile.readOnly).toBe(true);

    const updated = saveRootProfile({ name: "default", description: "Changed", instructions: "nope", expectedHash: detail?.hash }, tmpDir);
    expect(updated.success).toBe(false);
    expect(updated.status).toBe(403);

    const deleted = deleteRootProfile("default", tmpDir);
    expect(deleted.success).toBe(false);
    expect(deleted.status).toBe(403);
  });
});
