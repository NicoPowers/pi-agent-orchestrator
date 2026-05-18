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

    try {
      (window as any).event = undefined;
      Object.assign(globalThis, {
        window,
        document: window.document,
        navigator: window.navigator,
        EventSource: FakeEventSource,
        fetch: async (input: RequestInfo | URL) => {
          const url = String(input);
          if (url.includes("/api/agent-types")) return Response.json([]);
          if (url.includes("/api/models")) return Response.json([]);
          if (url.includes("/api/agent-stats")) return Response.json({});
          return Response.json({});
        },
        confirm: () => true,
      });

      await import(pathToFileURL(path.resolve("web/app.js")).href + `?t=${Date.now()}`);
      await window.happyDOM.waitUntilComplete();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(window.document.getElementById("root")?.textContent).toContain("Pi Orchestrator");
      expect(errors).toEqual([]);
    } finally {
      console.error = originalConsoleError;
      Object.assign(globalThis, previous);
      window.close();
    }
  });
});
