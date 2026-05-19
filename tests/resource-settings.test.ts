import { describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { readResourceSettings, updateResourceSettings } from "../extensions/multi-agent/resource-settings.js";

describe("resource settings", () => {
  it("reads missing project settings as empty arrays", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-resource-settings-missing-"));
    try {
      const settings = readResourceSettings(tmpDir);
      expect(settings.project.exists).toBe(false);
      expect(settings.project.skills).toEqual([]);
      expect(settings.project.extensions).toEqual([]);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("updates project resource arrays without clobbering unrelated settings", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-resource-settings-update-"));
    try {
      const piDir = path.join(tmpDir, ".pi");
      fs.mkdirSync(path.join(piDir, "skills", "local-skill"), { recursive: true });
      fs.writeFileSync(path.join(piDir, "skills", "local-skill", "SKILL.md"), "---\nname: local-skill\ndescription: Local skill\n---\n");
      fs.writeFileSync(path.join(piDir, "settings.json"), JSON.stringify({ model: "test-model", theme: "dark", skills: ["old"] }, null, 2));

      const result = updateResourceSettings({ scope: "project", skills: ["skills"], extensions: ["~/trusted-exts"] }, tmpDir);
      expect(result.success).toBe(true);
      const raw = JSON.parse(fs.readFileSync(path.join(piDir, "settings.json"), "utf-8"));
      expect(raw.model).toBe("test-model");
      expect(raw.theme).toBe("dark");
      expect(raw.skills).toEqual(["skills"]);
      expect(raw.extensions).toEqual(["~/trusted-exts"]);
      expect(result.settings?.project.validation.skills[0].exists).toBe(true);
      expect(result.settings?.project.validation.skills[0].count).toBe(1);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("reports invalid project JSON instead of crashing", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-resource-settings-invalid-"));
    try {
      fs.mkdirSync(path.join(tmpDir, ".pi"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, ".pi", "settings.json"), "{ nope");
      const settings = readResourceSettings(tmpDir);
      expect(settings.project.parseError).toBeTruthy();
      const result = updateResourceSettings({ scope: "project", skills: [] }, tmpDir);
      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
