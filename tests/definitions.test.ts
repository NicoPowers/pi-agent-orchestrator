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
    const { discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(projectAgentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectAgentsDir, "reviewer.md"),
      `---\nname: reviewer\ndescription: Test reviewer\n---\nReview code.`,
      "utf-8"
    );

    const defs = discoverDefinitions(tmpDir);
    const reviewer = defs.find((d) => d.name === "reviewer");
    expect(reviewer).toBeDefined();
    expect(reviewer!.description).toBe("Test reviewer");
    expect(reviewer!.source).toBe("project");
  });

  it("discovers package definitions as read-only pio examples", async () => {
    const { discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const defs = discoverDefinitions(tmpDir);
    const packageDefs = defs.filter((d) => d.source === "package");
    expect(packageDefs.length).toBeGreaterThan(0);
    expect(packageDefs.every((d) => d.name.startsWith("pio-example-"))).toBe(true);
    expect(packageDefs.every((d) => d.readOnly && d.example)).toBe(true);
  });

  it("skips definitions missing required frontmatter", async () => {
    const { discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const agentsDir = path.join(tmpDir, ".pi", "agent", "agents");
    fs.mkdirSync(agentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(agentsDir, "broken.md"),
      `---\nname: broken\n---\nNo description.`,
      "utf-8"
    );

    const defs = discoverDefinitions(tmpDir);
    // Package defs (coder, reviewer) still present; broken is skipped
    expect(defs.find((d) => d.name === "broken")).toBeUndefined();
  });

  it("parses template frontmatter fields", async () => {
    const { discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const projectAgentsDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(projectAgentsDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectAgentsDir, "templated.md"),
      `---\nname: templated\ndescription: Uses templates\nskillTemplates: common, frontend\nextensionTemplates: browser\n---\nPrompt.`,
      "utf-8"
    );

    const def = discoverDefinitions(tmpDir).find((d) => d.name === "templated");
    expect(def?.skillTemplates).toEqual(["common", "frontend"]);
    expect(def?.extensionTemplates).toEqual(["browser"]);
  });

  it("project definitions override user definitions", async () => {
    const { discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const userDir = path.join(tmpDir, ".pi", "agent", "agents");
    const projectDir = path.join(tmpDir, ".pi", "agents");
    fs.mkdirSync(userDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });

    fs.writeFileSync(
      path.join(userDir, "override.md"),
      `---\nname: override\ndescription: User version\n---\nUser prompt.`,
      "utf-8"
    );
    fs.writeFileSync(
      path.join(projectDir, "override.md"),
      `---\nname: override\ndescription: Project version\n---\nProject prompt.`,
      "utf-8"
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

  it("saves a new agent definition to project agents dir", async () => {
    const { saveAgentDefinition, discoverDefinitions } = await import("../extensions/multi-agent/definitions.js");

    const result = saveAgentDefinition(
      {
        name: "test-researcher",
        description: "A test researcher agent",
        model: "kimi-k2.6",
        tools: ["read", "grep"],
        skills: [],
        systemPrompt: "You are a helpful researcher.",
        source: "project",
        filePath: "",
      },
      tmpDir
    );

    expect(result.success).toBe(true);
    expect(result.path).toBeDefined();

    // Verify it can be discovered
    const defs = discoverDefinitions(tmpDir);
    const saved = defs.find((d) => d.name === "test-researcher");
    expect(saved).toBeDefined();
    expect(saved!.description).toBe("A test researcher agent");
    expect(saved!.model).toBe("kimi-k2.6");
  });
});
