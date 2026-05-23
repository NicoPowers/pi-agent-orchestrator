import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

describe("extension metadata discovery", () => {
  let tmpDir: string;
  let originalHome: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-test-"));
    originalHome = process.env.HOME || "";
    process.env.HOME = tmpDir;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("reads optional source-comment metadata without executing extensions", async () => {
    const { discoverExtensions } = await import("../extensions/multi-agent/ext-discovery.js");
    const extDir = path.join(tmpDir, ".pi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(
      path.join(extDir, "browser.ts"),
      `// pi-orchestrator: { "description": "Browser helpers", "expectedTools": ["open_page", "click", "click"] }\nthrow new Error("must not execute");`,
      "utf-8"
    );

    const extension = discoverExtensions(tmpDir).find((ext) => ext.name === "browser");
    expect(extension).toBeDefined();
    expect(extension).toMatchObject({
      name: "browser",
      scope: "project",
      description: "Browser helpers",
      expectedTools: ["open_page", "click"],
      metadataStatus: "provided",
      metadataSource: "source-comment",
    });
  });

  it("marks missing metadata as unknown", async () => {
    const { discoverExtensions } = await import("../extensions/multi-agent/ext-discovery.js");
    const extDir = path.join(tmpDir, ".pi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "plain.ts"), `export default function () {}`, "utf-8");

    const [extension] = discoverExtensions(tmpDir);
    expect(extension.metadataStatus).toBe("unknown");
    expect(extension.expectedTools).toBeUndefined();
  });

  it("marks invalid metadata as invalid without failing discovery", async () => {
    const { discoverExtensions } = await import("../extensions/multi-agent/ext-discovery.js");
    const extDir = path.join(tmpDir, ".pi", "extensions");
    fs.mkdirSync(extDir, { recursive: true });
    fs.writeFileSync(path.join(extDir, "broken.ts"), `// pi-orchestrator: { bad json }\n`, "utf-8");

    const [extension] = discoverExtensions(tmpDir);
    expect(extension.name).toBe("broken");
    expect(extension.metadataStatus).toBe("invalid");
    expect(extension.metadataSource).toBe("source-comment");
  });

  it("includes Lattice Library extensions after native and npm sources", async () => {
    const { discoverExtensions } = await import("../extensions/multi-agent/ext-discovery.js");
    const { ORCHESTRATOR_LIBRARY_SCHEMA } = await import("../extensions/multi-agent/lattice-library.js");
    const libraryDir = path.join(tmpDir, "team-library");
    const extensionDir = path.join(libraryDir, "extensions", "browser-tools");
    fs.mkdirSync(extensionDir, { recursive: true });
    fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), JSON.stringify({ piLattice: { libraries: [libraryDir] } }), "utf-8");
    fs.writeFileSync(path.join(libraryDir, "lattice-library.json"), JSON.stringify({ schema: ORCHESTRATOR_LIBRARY_SCHEMA, name: "team", resources: { agents: "agents", skillTemplates: "skill-templates", extensionTemplates: "extension-templates", skills: "skills", extensions: "extensions" } }), "utf-8");
    fs.writeFileSync(path.join(extensionDir, "index.ts"), `// pi-orchestrator: { "description": "Team browser tools" }\nexport default function () {}`, "utf-8");

    const extension = discoverExtensions(tmpDir).find((ext) => ext.name === "extensions/browser-tools");
    expect(extension).toMatchObject({
      name: "extensions/browser-tools",
      scope: "library",
      description: "Team browser tools",
      metadataStatus: "provided",
    });
    expect(extension?.path).toBe(path.join(extensionDir, "index.ts"));
  });
});
