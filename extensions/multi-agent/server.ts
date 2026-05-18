import * as http from "node:http";
import * as path from "node:path";
import * as fs from "node:fs";
import { type Agent, agents, log } from "./state.js";

// ── Types ──

export interface ServerDeps {
  repoCwd: string;
  spawnAgent: (id: string, options: any) => Promise<{ agent: Agent; error?: string }>;
  sendToAgent: (agent: Agent, message: string, timeoutMs: number) => Promise<void>;
  removeWorktree: (worktreePath: string) => Promise<void>;
  discoverDefinitions: (cwd: string) => Array<{ name: string; description: string; model?: string; tools?: string[]; source: string }>;
  getDefinition: (name: string, cwd: string) => { name: string; description: string; model?: string; tools?: string[]; skills?: string[]; systemPrompt: string; source: string; filePath: string } | undefined;
  discoverExtensions: (cwd: string) => Array<{ name: string; path: string; scope: string }>;
}

interface ServerHandle {
  url: string;
  stop: () => void;
}

// ── SSE state ──

const sseClients = new Set<http.ServerResponse>();

export function broadcast(event: { type: string; data: any }) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  const toRemove: http.ServerResponse[] = [];
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch {
      toRemove.push(res);
    }
  }
  for (const res of toRemove) {
    sseClients.delete(res);
  }
}

// ── Helpers ──

function serializeAgent(agent: Agent) {
  return {
    name: agent.id,
    status: agent.status,
    definition: agent.definition?.name,
    parent: agent.parent,
    children: agent.children,
    turns: Math.floor(agent.history.length / 2),
    worktree: agent.worktreePath,
  };
}

function jsonResponse(data: any, status = 200): { status: number; body: string; headers: Record<string, string> } {
  return {
    status,
    body: JSON.stringify(data),
    headers: { "Content-Type": "application/json" },
  };
}

function errorResponse(message: string, status = 400) {
  return jsonResponse({ error: message }, status);
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function send(res: http.ServerResponse, { status, body, headers }: ReturnType<typeof jsonResponse>) {
  res.writeHead(status, { ...headers, ...corsHeaders() });
  res.end(body);
}

// ── Port probing ──

function tryPort(port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(port, () => {
      server.close(() => resolve(port));
    });
  });
}

export async function findPort(preferred = [18765, 18766, 18767]): Promise<number> {
  for (const port of preferred) {
    try {
      return await tryPort(port);
    } catch {
      /* try next */
    }
  }
  return 0; // let OS assign
}

// ── Body parsing ──

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk.toString(); });
    req.on("end", () => resolve(body));
  });
}

// ── Server startup ──

export async function startServer(deps: ServerDeps): Promise<ServerHandle> {
  const port = await findPort();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", `http://localhost:${port}`);

    // CORS preflight
    if (req.method === "OPTIONS") {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }

    // Static: dashboard
    const webDir = path.join(__dirname, "..", "..", "web");
    if (url.pathname === "/" || url.pathname === "/index.html") {
      const htmlPath = path.join(webDir, "index.html");
      if (fs.existsSync(htmlPath)) {
        res.writeHead(200, { "Content-Type": "text/html", ...corsHeaders() });
        fs.createReadStream(htmlPath).pipe(res);
        return;
      }
      send(res, errorResponse("Dashboard not found", 404));
      return;
    }
    if (url.pathname === "/dashboard.js") {
      const jsPath = path.join(webDir, "dashboard.js");
      if (fs.existsSync(jsPath)) {
        res.writeHead(200, { "Content-Type": "application/javascript", ...corsHeaders() });
        fs.createReadStream(jsPath).pipe(res);
        return;
      }
      send(res, errorResponse("Dashboard script not found", 404));
      return;
    }

    // SSE: live event stream
    if (url.pathname === "/events") {
      res.writeHead(200, {
        ...corsHeaders(),
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      sseClients.add(res);
      const initEvent = {
        type: "init",
        data: {
          agents: Object.fromEntries(
            Array.from(agents.entries()).map(([k, v]) => [k, serializeAgent(v)])
          ),
        },
      };
      res.write(`data: ${JSON.stringify(initEvent)}\n\n`);
      req.on("close", () => { sseClients.delete(res); });
      return;
    }

    // REST API

    // GET /api/agents
    if (url.pathname === "/api/agents" && req.method === "GET") {
      const list = Array.from(agents.entries()).map(([_, a]) => serializeAgent(a));
      send(res, jsonResponse(list));
      return;
    }

    // GET /api/extensions
    if (url.pathname === "/api/extensions" && req.method === "GET") {
      const exts = deps.discoverExtensions(deps.repoCwd);
      send(res, jsonResponse(
        exts.map((e) => ({ name: e.name, scope: e.scope }))
      ));
      return;
    }

    // GET /api/agent-types
    if (url.pathname === "/api/agent-types" && req.method === "GET") {
      const defs = deps.discoverDefinitions(deps.repoCwd);
      send(res, jsonResponse(
        defs.map((d) => ({
          name: d.name,
          description: d.description,
          model: d.model,
          tools: d.tools,
          source: d.source,
        }))
      ));
      return;
    }

    // POST /api/spawn
    if (url.pathname === "/api/spawn" && req.method === "POST") {
      let body: any;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, errorResponse("Invalid JSON body"));
        return;
      }
      const { name, parent, type, model, extensions: requestedExtensions } = body;

      if (!name || !parent) {
        send(res, errorResponse("Missing required fields: name, parent"));
        return;
      }
      if (agents.has(name)) {
        send(res, errorResponse(`Agent '${name}' already exists`, 409));
        return;
      }

      let definition = type ? deps.getDefinition(type, deps.repoCwd) : undefined;
      if (type && !definition) {
        send(res, errorResponse(`Agent type '${type}' not found`, 404));
        return;
      }

      let worktreePath: string | undefined;
      if (parent !== "self") {
        const parentAgent = agents.get(parent);
        if (!parentAgent) {
          send(res, errorResponse(`Parent agent '${parent}' not found`, 404));
          return;
        }
        worktreePath = parentAgent.worktreePath;
        parentAgent.children.push(name);
      }

      const allExts = deps.discoverExtensions(deps.repoCwd);
      const extensions = (requestedExtensions || [])
        .map((n: string) => allExts.find((e) => e.name === n))
        .filter(Boolean);

      const result = await deps.spawnAgent(name, {
        model,
        repoCwd: deps.repoCwd,
        definition,
        parent: parent === "self" ? undefined : parent,
        worktreePath,
        extensions,
      });

      if (result.error || !result.agent) {
        send(res, errorResponse(result.error || "Spawn failed", 500));
        return;
      }

      agents.set(name, result.agent);

      if (result.agent.status === "error" || result.agent.status === "exited") {
        agents.delete(name);
        await deps.removeWorktree(result.agent.worktreePath);
        send(res, errorResponse("Agent exited immediately after spawn", 500));
        return;
      }

      broadcast({ type: "agent-spawned", data: serializeAgent(result.agent) });
      log("server", `Dashboard spawned agent '${name}'`);

      send(res, jsonResponse(serializeAgent(result.agent), 201));
      return;
    }

    // POST /api/agents/:name/send
    const sendMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/send$/);
    if (sendMatch && req.method === "POST") {
      const name = decodeURIComponent(sendMatch[1]);
      let body: any;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        send(res, errorResponse("Invalid JSON body"));
        return;
      }
      const { message } = body;

      const agent = agents.get(name);
      if (!agent) {
        send(res, errorResponse(`Agent '${name}' not found`, 404));
        return;
      }
      if (!message) {
        send(res, errorResponse("Missing required field: message"));
        return;
      }

      Promise.resolve().then(async () => {
        try {
          broadcast({ type: "agent-start", data: { name } });
          await deps.sendToAgent(agent, message, 300_000);
          const result = agent.accumulatedText || "(agent returned empty response)";
          broadcast({ type: "agent-end", data: { name, text: result } });
          log("server", `Dashboard send to ${name} completed`);
        } catch (err: any) {
          broadcast({ type: "agent-error", data: { name, error: err.message } });
          log("server", `Dashboard send to ${name} failed: ${err.message}`);
        }
      });

      send(res, jsonResponse({ queued: true, agent: name }));
      return;
    }

    // POST /api/agents/:name/kill
    const killMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/kill$/);
    if (killMatch && req.method === "POST") {
      const name = decodeURIComponent(killMatch[1]);
      const agent = agents.get(name);
      if (!agent) {
        send(res, errorResponse(`Agent '${name}' not found`, 404));
        return;
      }

      for (const childId of agent.children) {
        const child = agents.get(childId);
        if (child && !child.proc.killed) child.proc.kill("SIGTERM");
      }
      if (!agent.proc.killed) agent.proc.kill("SIGTERM");

      setTimeout(() => {
        if (!agent.proc.killed) agent.proc.kill("SIGKILL");
      }, 3000);

      if (agent.parent) {
        const parent = agents.get(agent.parent);
        if (parent) parent.children = parent.children.filter((c) => c !== name);
      } else {
        await deps.removeWorktree(agent.worktreePath);
      }

      agents.delete(name);
      broadcast({ type: "agent-killed", data: { name } });
      log("server", `Dashboard killed agent '${name}'`);

      send(res, jsonResponse({ killed: true, name }));
      return;
    }

    send(res, errorResponse("Not found", 404));
  });

  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === "object" && addr ? addr.port : port;
      const url = `http://localhost:${actualPort}`;
      log("server", `HTTP server listening on ${url}`);

      resolve({
        url,
        stop: () => {
          server.close();
          for (const res of sseClients) {
            try { res.end(); } catch { /* ignore */ }
          }
          sseClients.clear();
        },
      });
    });

    server.once("error", reject);
  });
}
