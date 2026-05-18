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
});
