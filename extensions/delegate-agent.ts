import { type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import * as fs from "node:fs";
import * as path from "node:path";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

const COMMS_DIR = "/tmp/workspace/.pi/comms";
const REQUESTS_DIR = path.join(COMMS_DIR, "requests");
const RESPONSES_DIR = path.join(COMMS_DIR, "responses");
const RUNTIME_TOOLS_FILE = path.join(COMMS_DIR, "runtime-tools.json");

function serializeTool(tool: any) {
  return {
    name: tool.name,
    description: tool.description,
    sourceInfo: tool.sourceInfo,
  };
}

function activeToolDetails(pi: ExtensionAPI) {
  const all = pi.getAllTools().map(serializeTool);
  const allByName = new Map(all.map((tool) => [tool.name, tool]));
  const active = pi.getActiveTools().map((name) => allByName.get(name) || { name });
  return { active, all };
}

function reportRuntimeTools(pi: ExtensionAPI) {
  try {
    fs.mkdirSync(COMMS_DIR, { recursive: true });
    const { active, all } = activeToolDetails(pi);
    const snapshot = {
      active,
      all,
      reportedAt: Date.now(),
      source: "child-agent",
    };
    fs.writeFileSync(RUNTIME_TOOLS_FILE, JSON.stringify(snapshot, null, 2), "utf-8");
  } catch {
    /* best-effort only */
  }
}

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    reportRuntimeTools(pi);
    setTimeout(() => reportRuntimeTools(pi), 250);
    setTimeout(() => reportRuntimeTools(pi), 1_000);
  });
  pi.on("agent_start", () => reportRuntimeTools(pi));
  pi.on("agent_end", () => reportRuntimeTools(pi));

  pi.registerTool({
    name: "delegate",
    label: "Delegate",
    description: [
      "Delegate a task to another agent via the broker extension.",
      "The broker routes the task and returns the response.",
    ].join(" "),
    parameters: Type.Object({
      target: Type.String({ description: "Name of the target agent to delegate to" }),
      task: Type.String({ description: "Task description to send to the target agent" }),
    }),
    async execute(toolCallId, params, signal) {
      const reqFile = path.join(REQUESTS_DIR, `${toolCallId}.json`);
      const respFile = path.join(RESPONSES_DIR, `${toolCallId}.json`);

      fs.mkdirSync(REQUESTS_DIR, { recursive: true });
      fs.mkdirSync(RESPONSES_DIR, { recursive: true });
      fs.writeFileSync(reqFile, JSON.stringify({ target: params.target, task: params.task }), "utf-8");

      // Poll for response from broker (max 60s wait between checks to avoid tight loop)
      let waited = 0;
      const maxWait = 300_000; // 5 minutes total timeout
      while (!fs.existsSync(respFile)) {
        if (signal?.aborted) {
          throw new Error("Delegate aborted");
        }
        if (waited >= maxWait) {
          throw new Error(`Delegate timeout: no response from broker after ${maxWait / 1000}s`);
        }
        await sleep(500);
        waited += 500;
      }

      const response = fs.readFileSync(respFile, "utf-8");

      // Clean up
      try { fs.unlinkSync(reqFile); } catch {}
      try { fs.unlinkSync(respFile); } catch {}

      return {
        content: [{ type: "text", text: response }],
        details: { target: params.target, task: params.task },
      };
    },
  });
}
