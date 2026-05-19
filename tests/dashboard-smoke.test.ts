import { describe, it, expect } from "bun:test";
import { Window } from "happy-dom";
import * as path from "node:path";
import { pathToFileURL } from "node:url";

describe("dashboard bundle smoke test", () => {
  it("loads the built dashboard without console/runtime errors", async () => {
    const window = new Window({ url: "http://localhost/dashboard" });
    window.document.body.innerHTML = '<div id="root"></div>';

    const errors: unknown[] = [];
    const originalConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      errors.push(args);
      originalConsoleError(...args);
    };

    class FakeEventSource extends window.EventTarget {
      url: string;
      onopen: ((event: Event) => void) | null = null;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;

      constructor(url: string) {
        super();
        this.url = url;
        queueMicrotask(() => {
          this.onopen?.(new window.Event("open") as unknown as Event);
          this.onmessage?.(new window.MessageEvent("message", {
            data: JSON.stringify({ type: "init", data: { agents: {} } }),
          }) as unknown as MessageEvent);
        });
      }

      close() {}
    }

    const previous = {
      window: globalThis.window,
      document: globalThis.document,
      navigator: globalThis.navigator,
      EventSource: globalThis.EventSource,
      fetch: globalThis.fetch,
      confirm: globalThis.confirm,
    };
    const bootstrapRequests: any[] = [];

    try {
      (window as any).event = undefined;
      (window as any).SyntaxError = SyntaxError;
      Object.assign(globalThis, {
        window,
        document: window.document,
        navigator: window.navigator,
        EventSource: FakeEventSource,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes("/api/agent-types")) return Response.json([]);
          if (url.includes("/api/root-profiles/default")) return Response.json({ profile: { name: "default", description: "Default root profile", instructions: "Coordinate spawned agents.", source: "package", filePath: "/pkg/orchestrator-profiles/default.md", readOnly: true }, content: "---\nname: default\ndescription: Default root profile\n---\n\nCoordinate spawned agents.", frontmatter: { name: "default", description: "Default root profile" }, body: "Coordinate spawned agents.", mtimeMs: 1, hash: "hash" });
          if (url.includes("/api/root-profiles")) return Response.json([{ name: "default", description: "Default root profile", instructions: "Coordinate spawned agents.", source: "package", filePath: "/pkg/orchestrator-profiles/default.md", readOnly: true }]);
          if (url.includes("/api/models")) return Response.json([]);
          if (url.includes("/api/agent-stats")) return Response.json({});
          if (url.includes("/api/skill-templates")) return Response.json([]);
          if (url.includes("/api/extension-templates")) return Response.json([]);
          if (url.includes("/api/extensions")) return Response.json([]);
          if (url.includes("/api/orchestrator-libraries/bootstrap") && init?.method === "POST") {
            bootstrapRequests.push(JSON.parse(String(init.body || "{}")));
            return Response.json({ success: true, scope: "project", library: { root: "/tmp/repo/.pi/orchestrator-library", manifestPath: "/tmp/repo/.pi/orchestrator-library/orchestrator-library.json", manifest: { schema: "pio.orchestrator-library.v1", name: "team-ai", description: "Team library", resources: {} }, diagnostics: [], valid: true } });
          }
          if (url.includes("/api/orchestrator-libraries")) return Response.json({ libraries: [], resources: [], diagnostics: [], valid: true, settings: { showPackageExamples: true, settingsPath: "/tmp/.pi/settings.json", exists: false } });
          if (url.endsWith("/api/skills/demo-id")) return Response.json({ skill: { id: "demo-id", name: "demo", description: "Demo skill", path: "/tmp/demo/SKILL.md", scope: "project", kind: "directory", editable: true, packageProvided: false }, content: "---\nname: demo\ndescription: Demo skill\n---\n# Demo Skill\n\nSkill body.", frontmatter: { name: "demo", description: "Demo skill" }, body: "# Demo Skill\n\nSkill body.", mtimeMs: 1, hash: "hash" });
          if (url.endsWith("/api/skills/librarian-id")) return new Promise((resolve) => setTimeout(() => resolve(Response.json({ skill: { id: "librarian-id", name: "librarian", description: "Package skill", path: "/home/ubuntu/.pi/agent/npm/node_modules/pi-web-access/skills/librarian/SKILL.md", scope: "global", kind: "directory", editable: false, packageProvided: true }, content: "---\nname: librarian\ndescription: Package skill\n---\n# Librarian", frontmatter: { name: "librarian", description: "Package skill" }, body: "# Librarian", mtimeMs: 1, hash: "package-hash" })), 75));
          if (url.endsWith("/api/skills")) return Response.json([{ id: "demo-id", name: "demo", description: "Demo skill", path: "/tmp/demo/SKILL.md", scope: "project", kind: "directory", editable: true, packageProvided: false }, { id: "librarian-id", name: "librarian", description: "Package skill", path: "/home/ubuntu/.pi/agent/npm/node_modules/pi-web-access/skills/librarian/SKILL.md", scope: "global", kind: "directory", editable: false, packageProvided: true }]);
          return Response.json({});
        },
        confirm: () => true,
      });

      await import(pathToFileURL(path.resolve("web/app.js")).href + `?t=${Date.now()}`);
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(window.document.getElementById("root")?.textContent).toContain("Pi Orchestrator");
      expect(window.document.getElementById("root")?.textContent).toContain("No agents running.");
      const hierarchyNav = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Hierarchy"));
      hierarchyNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(window.document.getElementById("root")?.textContent).toContain("No agents yet.");

      const rootProfilesNav = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Root Profiles"));
      rootProfilesNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const rootProfilesText = window.document.getElementById("root")?.textContent || "";
      expect(rootProfilesText).toContain("Root Orchestrator Profiles");
      expect(rootProfilesText).toContain("not spawnable Agent Types");
      expect(rootProfilesText).toContain("read-only");

      const skillNav = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Skill Library"));
      skillNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const text = window.document.getElementById("root")?.textContent || "";
      expect(text).toContain("Demo Skill");
      expect(text).toContain("Preview");
      expect(text).toContain("Raw");
      expect(text).toContain("Metadata");
      expect(text).toContain("package");
      expect(text).not.toContain("Skill & Extension Paths");

      const librarianSkillButton = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("librarian") && button.textContent?.includes("Package skill"));
      librarianSkillButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 10));
      const loadingSkillText = window.document.getElementById("root")?.textContent || "";
      expect(loadingSkillText).toContain("Loading skill actions");
      expect(loadingSkillText).not.toContain("Delete");

      const libraryNav = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Orchestrator Libraries"));
      libraryNav?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const libraryText = window.document.getElementById("root")?.textContent || "";
      expect(libraryText).toContain("Click here to scaffold your first Orchestrator Library");
      expect(libraryText).not.toContain("Target path");
      expect(libraryText).not.toContain("Create library");

      const scaffoldButton = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Click here to scaffold your first Orchestrator Library"));
      scaffoldButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const modalText = window.document.getElementById("root")?.textContent || "";
      expect(modalText).toContain("inside this repo uses project settings; outside this repo uses global settings");
      expect(modalText).toContain("Target path");
      expect(modalText).toContain("Library name");
      expect(modalText).toContain("Create library");

      const targetInput = Array.from(window.document.getElementsByTagName("input")).find((input) => input.getAttribute("placeholder") === "./.pi/orchestrator-library");
      const nameInput = Array.from(window.document.getElementsByTagName("input")).find((input) => input.getAttribute("placeholder") === "team-ai");
      const descriptionInput = Array.from(window.document.getElementsByTagName("textarea")).find((input) => input.getAttribute("placeholder") === "Shared team orchestrator resources.");
      expect(targetInput?.value).toBe("./.pi/orchestrator-library");
      expect(nameInput).toBeTruthy();
      expect(descriptionInput).toBeTruthy();
      const createButton = Array.from(window.document.getElementsByTagName("button")).find((button) => button.textContent?.includes("Create library"));
      createButton?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(bootstrapRequests).toEqual([{ targetPath: "./.pi/orchestrator-library" }]);
      expect(text).not.toContain("name: demodescription:");
      expect(errors).toEqual([]);
    } finally {
      console.error = originalConsoleError;
      Object.assign(globalThis, previous);
      window.close();
    }
  });
});
