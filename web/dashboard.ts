import type { AgentInfo, AgentTypeInfo, ExtensionInfo, ServerEvent } from "./types.js";

// ── DOM refs ──

const agentsEl = document.getElementById("agents") as HTMLDivElement;
const connDot = document.getElementById("conn-dot") as HTMLSpanElement;
const connText = document.getElementById("conn-text") as HTMLSpanElement;
const logEl = document.getElementById("global-log") as HTMLDivElement;

// Agent Types editor refs
const typesListEl = document.getElementById("types-list") as HTMLDivElement;
const newTypeBtn = document.getElementById("new-type-btn") as HTMLButtonElement;
const typeModal = document.getElementById("type-modal") as HTMLDivElement;
const typeForm = document.getElementById("type-form") as HTMLFormElement;
const typeNameInput = document.getElementById("type-name") as HTMLInputElement;
const typeDescInput = document.getElementById("type-desc") as HTMLInputElement;
const typeModelSelect = document.getElementById("type-model") as HTMLSelectElement;
const typePromptInput = document.getElementById("type-prompt") as HTMLTextAreaElement;
const typeSaveBtn = document.getElementById("type-save-btn") as HTMLButtonElement;
const typeCancelBtn = document.getElementById("type-cancel-btn") as HTMLButtonElement;
const inspectModal = document.getElementById("inspect-modal") as HTMLDivElement;
const inspectTitle = document.getElementById("inspect-title") as HTMLHeadingElement;
const inspectContent = document.getElementById("inspect-content") as HTMLPreElement;
const inspectCloseBtn = document.getElementById("inspect-close-btn") as HTMLButtonElement;

// ── State ──

let agents: Record<string, AgentInfo & { text?: string }> = {};
let hierarchyExpanded = new Set<string>();

// ── Helpers ──

function escapeHtml(t: string): string {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] ?? c));
}

function shortPath(p: string): string {
  if (!p) return "";
  return p.length > 42 ? "…" + p.slice(-39) : p;
}

function pushLog(text: string, level: "info" | "success" | "warn" | "error" = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${level}`;
  line.textContent = new Date().toLocaleTimeString() + "  " + text;
  logEl.prepend(line);
  if (logEl.children.length > 100) logEl.lastChild?.remove();
}

// ── Agent Types Editor ──

let currentEditingType: string | null = null;
let availableModels: string[] = [];

async function loadModelsForEditor() {
  try {
    const res = await fetch("/api/models");
    if (!res.ok) return;
    availableModels = await res.json();
  } catch {
    availableModels = [];
  }
}

async function loadAgentTypesForEditor() {
  try {
    const res = await fetch("/api/agent-types");
    if (!res.ok) {
      typesListEl.innerHTML = '<div style="color:var(--dim);font-size:0.75rem;">Failed to load types</div>';
      return;
    }
    const defs = (await res.json()) as AgentTypeInfo[];
    typesListEl.innerHTML = "";

    if (!defs.length) {
      typesListEl.innerHTML = '<div style="color:var(--dim);font-size:0.75rem;">No agent types found.</div>';
      return;
    }

    for (const d of defs) {
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:0.25rem 0;border-bottom:1px solid var(--border);";
      row.innerHTML = `
        <div>
          <div style="font-weight:600;">${escapeHtml(d.name)}</div>
          <div style="font-size:0.75rem;color:var(--dim);">${escapeHtml(d.description || "")}</div>
        </div>
        <button class="secondary" style="font-size:0.75rem;padding:0.25rem 0.5rem;" data-name="${escapeHtml(d.name)}">Edit</button>
      `;
      const editBtn = row.querySelector("button")!;
      editBtn.onclick = () => openTypeEditor(d);
      typesListEl.appendChild(row);
    }
  } catch (e: any) {
    typesListEl.innerHTML = '<div style="color:var(--error);font-size:0.75rem;">Error loading types</div>';
  }
}

function openTypeEditor(def?: AgentTypeInfo) {
  currentEditingType = def ? def.name : null;
  typeNameInput.value = def?.name || "";
  typeDescInput.value = def?.description || "";
  typePromptInput.value = ""; // We don't get the full prompt from the list API yet
  typeModelSelect.innerHTML = '<option value="">-- default --</option>';
  for (const m of availableModels) {
    const opt = document.createElement("option");
    opt.value = m;
    opt.textContent = m;
    if (def?.model === m) opt.selected = true;
    typeModelSelect.appendChild(opt);
  }
  typeModal.style.display = "flex";
  typeNameInput.focus();
  if (def) {
    typeNameInput.readOnly = true;
    if (def.name.toLowerCase() === "orchestrator") {
      const note = document.createElement("div");
      note.style.cssText = "color:var(--warning);font-size:0.75rem;margin-top:0.25rem;";
      note.textContent = "⚠️ The orchestrator type is protected.";
      typeNameInput.parentElement?.appendChild(note);
    }
  }
}

function closeTypeEditor() {
  // Remove any dynamically added warning notes
  const parent = typeNameInput.parentElement;
  if (parent) {
    const notes = parent.querySelectorAll("div");
    notes.forEach(n => n.remove());
  }

  typeModal.style.display = "none";
  currentEditingType = null;
  typeNameInput.readOnly = false;
}

async function saveType() {
  const payload: any = {
    name: typeNameInput.value.trim(),
    description: typeDescInput.value.trim(),
    model: typeModelSelect.value || undefined,
    prompt: typePromptInput.value.trim() || undefined,
  };
  if (!payload.name || !payload.description) {
    alert("Name and description are required");
    return;
  }

  try {
    const res = await fetch("/api/agent-types", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    pushLog(`Saved agent type '${payload.name}'`, "success");
    closeTypeEditor();
    await loadAgentTypesForEditor();
  } catch (e: any) {
    alert("Failed to save: " + e.message);
  }
}

// ── Render ──

function updateParentSelect() {
  // No longer used - kept for compatibility if needed elsewhere
}

function renderHierarchy() {
  const container = document.getElementById("hierarchy");
  if (!container) return;

  const childrenByParent = new Map<string, string[]>();
  for (const a of Object.values(agents)) {
    if (!a.parent) continue;
    const list = childrenByParent.get(a.parent) || [];
    list.push(a.name);
    childrenByParent.set(a.parent, list);
  }

  const roots = Object.values(agents).filter(a => !a.parent || !agents[a.parent]);
  if (!roots.length) {
    container.innerHTML = '<div style="color:var(--dim);font-size:0.75rem;">No agents yet.</div>';
    return;
  }

  let html = "";
  const renderNode = (agent: any, depth: number) => {
    const indent = "&nbsp;".repeat(depth * 3);
    const childNames = Array.from(new Set([...(agent.children || []), ...(childrenByParent.get(agent.name) || [])]));
    const isExpanded = hierarchyExpanded.has(agent.name);
    const hasChildren = childNames.length > 0;
    const expandIcon = hasChildren ? (isExpanded ? "▼ " : "▶ ") : "  ";

    html += `<div style="padding:2px 0;cursor:${hasChildren ? "pointer" : "default"};" data-name="${agent.name}">
      ${indent}${expandIcon}<strong>${agent.name}</strong> <span style="color:var(--dim);font-size:0.75rem;">[${agent.definition || "custom"}]</span>
      <span class="badge ${agent.status}">${agent.status}</span>
    </div>`;

    if (isExpanded && hasChildren) {
      for (const childName of childNames) {
        const child = agents[childName];
        if (child) renderNode(child, depth + 1);
      }
    }
  };

  for (const root of roots) renderNode(root, 0);
  container.innerHTML = html;

  // Attach click handlers for expand/collapse
  container.querySelectorAll("div[data-name]").forEach(el => {
    const name = el.getAttribute("data-name")!;
    const agent = agents[name];
    const hasChildren = !!agent && Object.values(agents).some(a => a.parent === name) || !!agent?.children?.length;
    if (hasChildren) {
      el.addEventListener("click", () => {
        if (hierarchyExpanded.has(name)) hierarchyExpanded.delete(name);
        else hierarchyExpanded.add(name);
        renderHierarchy();
      });
    }
  });
}

function renderAgents() {
  renderHierarchy();
  if (!Object.keys(agents).length) {
    agentsEl.innerHTML = '<div class="empty">No agents running.</div>';
    updateParentSelect();
    return;
  }

  // Preserve existing terminal text to avoid losing scroll position
  const existing = new Map<string, HTMLDivElement>();
  agentsEl.querySelectorAll(".agent").forEach((el) => {
    const name = el.querySelector(".agent-name")?.textContent;
    if (name) {
      const term = el.querySelector(".terminal") as HTMLDivElement | null;
      if (term) existing.set(name, term);
    }
  });

  agentsEl.innerHTML = "";
  for (const [name, a] of Object.entries(agents)) {
    const div = document.createElement("div");
    div.className = "agent" + (a.status === "streaming" ? " streaming" : "");
    div.id = "agent-" + name;
    div.innerHTML = `
      <div class="agent-header">
        <span class="agent-name">${escapeHtml(name)}</span>
        <span class="badge ${a.status}">${a.status}</span>
      </div>
      <div class="agent-meta">
        <span>${a.definition ? "type: " + escapeHtml(a.definition) : "no type"}</span>
        <span>${a.parent ? "parent: " + escapeHtml(a.parent) : "root"}</span>
        <span>turns: ${a.turns || 0}</span>
        <span title="${escapeHtml(a.worktree || "")}">worktree: ${escapeHtml(shortPath(a.worktree || ""))}</span>
        ${a.worktree ? `<button class="secondary" id="btn-copy-path-${name}" style="font-size:0.7rem;padding:0.125rem 0.375rem;">Copy Path</button>` : ""}
      </div>
      <div class="terminal" id="term-${name}"></div>
      <div class="agent-actions">
        <input id="msg-${name}" placeholder="Message…">
        <button id="btn-send-${name}">Send</button>
        <button id="btn-inspect-${name}" class="secondary">Inspect</button>
        <button id="btn-kill-${name}" class="danger">Kill</button>
      </div>
    `;

    const term = div.querySelector(".terminal") as HTMLDivElement;
    const existingTerm = existing.get(name);
    if (existingTerm) {
      term.textContent = existingTerm.textContent;
    } else {
      term.textContent = a.text ?? "";
    }

    const msgInput = div.querySelector(`#msg-${name}`) as HTMLInputElement;
    msgInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") sendMessage(name);
    });

    div.querySelector(`#btn-send-${name}`)?.addEventListener("click", () => sendMessage(name));
    div.querySelector(`#btn-inspect-${name}`)?.addEventListener("click", () => inspectAgent(name));
    div.querySelector(`#btn-kill-${name}`)?.addEventListener("click", () => killAgent(name));
    div.querySelector(`#btn-copy-path-${name}`)?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(a.worktree || "");
        pushLog(`Copied worktree path for ${name}`, "success");
      } catch {
        pushLog(`Worktree path: ${a.worktree}`, "info");
      }
    });

    agentsEl.appendChild(div);
  }
  updateParentSelect();
}

function updateAgent(name: string, patch: Partial<AgentInfo & { delta?: string }>) {
  if (!agents[name]) agents[name] = { name, status: "idle", turns: 0, children: [], worktree: "" };
  Object.assign(agents[name], patch);

  let card = document.getElementById("agent-" + name);
  if (!card) {
    renderAgents();
    card = document.getElementById("agent-" + name);
  }
  if (!card) return;

  if (patch.status !== undefined) {
    const badge = card.querySelector(".badge") as HTMLSpanElement;
    badge.className = "badge " + patch.status;
    badge.textContent = patch.status;
    card.className = "agent" + (patch.status === "streaming" ? " streaming" : "");
  }

  const term = card.querySelector(".terminal") as HTMLDivElement;
  if (patch.delta !== undefined && term) {
    agents[name].text = (agents[name].text ?? "") + patch.delta;
    term.textContent = agents[name].text;
    term.scrollTop = term.scrollHeight;
  }
  if (patch.text !== undefined && term) {
    term.textContent = patch.text;
    term.scrollTop = term.scrollHeight;
  }
}

// ── Actions ──

async function sendMessage(name: string) {
  const input = document.getElementById("msg-" + name) as HTMLInputElement | null;
  if (!input) return;
  const msg = input.value.trim();
  if (!msg) return;
  input.value = "";
  try {
    const res = await fetch("/api/agents/" + encodeURIComponent(name) + "/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: msg }),
    });
    if (!res.ok) pushLog("Send to " + name + " failed: " + res.status, "error");
    else pushLog("Queued message for " + name);
  } catch (e: any) {
    pushLog("Send to " + name + " error: " + e.message, "error");
  }
}

async function inspectAgent(name: string) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(name)}/events`);
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    inspectTitle.textContent = `Inspect ${name}`;
    const lines: string[] = [];
    lines.push(`status: ${data.status}`);
    lines.push(`worktree: ${data.worktree}`);
    lines.push("");
    lines.push("Recent events:");
    let textBuffer = "";
    let textStartTime = "";
    const flushTextBuffer = () => {
      const text = textBuffer.trim();
      if (text) {
        lines.push(`${textStartTime} assistant_text ${JSON.stringify(text.length > 500 ? text.slice(0, 500) + "…" : text)}`);
      }
      textBuffer = "";
      textStartTime = "";
    };

    for (const item of (data.events || []).slice(-180)) {
      const time = new Date(item.ts).toLocaleTimeString();
      const ev = item.event || {};
      if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
        if (!textStartTime) textStartTime = time;
        textBuffer += ev.assistantMessageEvent.delta || "";
        continue;
      }

      // Ignore generic message_update noise once text deltas are coalesced.
      if (ev.type === "message_update") continue;

      flushTextBuffer();
      if (ev.type === "tool_execution_start") {
        lines.push(`${time} tool_start ${ev.toolName || ""} ${JSON.stringify(ev.args || {}).slice(0, 220)}`);
      } else if (ev.type === "tool_execution_end") {
        lines.push(`${time} tool_end ${ev.toolName || ""}`);
      } else if (["agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end"].includes(ev.type)) {
        lines.push(`${time} ${ev.type}`);
      } else {
        lines.push(`${time} ${ev.type || item.type}`);
      }
    }
    flushTextBuffer();
    lines.push("");
    lines.push("Accumulated assistant text:");
    lines.push(data.accumulatedText || "(none)");
    inspectContent.textContent = lines.join("\n");
    inspectModal.style.display = "flex";
  } catch (e: any) {
    pushLog(`Inspect ${name} failed: ${e.message}`, "error");
  }
}

async function killAgent(name: string) {
  try {
    const res = await fetch("/api/agents/" + encodeURIComponent(name) + "/kill", { method: "POST" });
    if (!res.ok) pushLog("Kill " + name + " failed: " + res.status, "error");
  } catch (e: any) {
    pushLog("Kill " + name + " error: " + e.message, "error");
  }
}

// ── SSE ──

function setConnected(c: boolean) {
  connDot.className = "dot " + (c ? "connected" : "");
  connText.textContent = c ? "Connected" : "Disconnected";
}

function handleEvent(ev: ServerEvent) {
  switch (ev.type) {
    case "init": {
      agents = {};
      for (const [k, v] of Object.entries(ev.data.agents || {})) agents[k] = { ...v };
      renderAgents();
      pushLog("Synced " + Object.keys(agents).length + " agents");
      break;
    }
    case "agent-spawned": {
      updateAgent(ev.data.name, ev.data);
      pushLog("Agent " + ev.data.name + " spawned (" + (ev.data.parent || "root") + ")", "success");
      break;
    }
    case "agent-killed": {
      delete agents[ev.data.name];
      renderAgents();
      pushLog("Agent " + ev.data.name + " killed", "warn");
      break;
    }
    case "agent-delta": {
      updateAgent(ev.data.name, { delta: ev.data.delta });
      break;
    }
    case "agent-start": {
      updateAgent(ev.data.name, { status: "streaming" });
      break;
    }
    case "agent-end": {
      updateAgent(ev.data.name, { status: "idle", text: ev.data.text });
      break;
    }
    case "agent-exit": {
      updateAgent(ev.data.name, { status: "exited" });
      pushLog("Agent " + ev.data.name + " exited (code " + (ev.data.code ?? "?") + ")", "warn");
      break;
    }
    case "delegate": {
      pushLog(ev.data.from + " → " + ev.data.to + " | " + ev.data.task.slice(0, 60));
      break;
    }
  }
}

function useSSE() {
  const es = new EventSource("/events");
  es.onopen = () => setConnected(true);
  es.onerror = () => {
    setConnected(false);
    es.close();
    setTimeout(useSSE, 2000);
  };
  es.onmessage = (e) => {
    handleEvent(JSON.parse(e.data) as ServerEvent);
  };
}

// ── Boot ──

useSSE();
loadModelsForEditor();
loadAgentTypesForEditor();

// Wire up type editor buttons
if (newTypeBtn) newTypeBtn.addEventListener("click", () => openTypeEditor());
if (typeSaveBtn) typeSaveBtn.addEventListener("click", saveType);
if (typeCancelBtn) {
  typeCancelBtn.addEventListener("click", () => {
    closeTypeEditor();
  });
}
if (inspectCloseBtn) inspectCloseBtn.addEventListener("click", () => { inspectModal.style.display = "none"; });

// Emergency Stop
const emergencyBtn = document.getElementById("emergency-btn") as HTMLButtonElement;
if (emergencyBtn) {
  emergencyBtn.addEventListener("click", async () => {
    if (!confirm("Emergency Stop: Kill all agents and clean up worktrees?")) return;
    try {
      const res = await fetch("/api/emergency-stop", { method: "POST" });
      if (res.ok) {
        pushLog("EMERGENCY STOP executed", "error");
        agents = {};
        renderAgents();
        renderHierarchy();
      } else {
        pushLog("Emergency stop failed", "error");
      }
    } catch (e: any) {
      pushLog("Emergency stop error: " + e.message, "error");
    }
  });
}
