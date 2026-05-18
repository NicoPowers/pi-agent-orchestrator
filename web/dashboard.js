// web/dashboard.ts
var agentsEl = document.getElementById("agents");
var parentSelect = document.getElementById("spawn-parent");
var typeSelect = document.getElementById("spawn-type");
var extContainer = document.getElementById("spawn-extensions");
var connDot = document.getElementById("conn-dot");
var connText = document.getElementById("conn-text");
var logEl = document.getElementById("global-log");
var agents = {};
function escapeHtml(t) {
  return t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c] ?? c);
}
function pushLog(text, level = "info") {
  const line = document.createElement("div");
  line.className = `log-line ${level}`;
  line.textContent = new Date().toLocaleTimeString() + "  " + text;
  logEl.prepend(line);
  if (logEl.children.length > 100)
    logEl.lastChild?.remove();
}
async function loadAgentTypes() {
  try {
    const res = await fetch("/api/agent-types");
    if (!res.ok) {
      pushLog("Failed to load agent types", "error");
      return;
    }
    const defs = await res.json();
    typeSelect.innerHTML = '<option value="">-- select type --</option>';
    for (const d of defs) {
      const opt = document.createElement("option");
      opt.value = d.name;
      opt.textContent = `${d.name} — ${d.description}`;
      typeSelect.appendChild(opt);
    }
    pushLog(`Loaded ${defs.length} agent types`);
  } catch (e) {
    pushLog("Error loading agent types: " + e.message, "error");
  }
}
async function loadExtensions() {
  try {
    const res = await fetch("/api/extensions");
    if (!res.ok) {
      extContainer.innerHTML = '<span style="color:var(--dim);font-size:0.75rem;">No extensions found.</span>';
      return;
    }
    const exts = await res.json();
    extContainer.innerHTML = "";
    if (!exts.length) {
      extContainer.innerHTML = '<span style="color:var(--dim);font-size:0.75rem;">No extensions available.</span>';
      return;
    }
    for (const e of exts) {
      const label = document.createElement("label");
      label.style.cssText = "display:flex;align-items:center;gap:0.5rem;cursor:pointer;";
      label.innerHTML = `<input type="checkbox" name="extension" value="${escapeHtml(e.name)}"> <span>${escapeHtml(e.name)} <span style="color:var(--dim);font-size:0.75rem;">(${escapeHtml(e.scope)})</span></span>`;
      extContainer.appendChild(label);
    }
    pushLog(`Loaded ${exts.length} extensions`);
  } catch (e) {
    extContainer.innerHTML = '<span style="color:var(--dim);font-size:0.75rem;">Failed to load extensions.</span>';
    pushLog("Error loading extensions: " + e.message, "error");
  }
}
function updateParentSelect() {
  const val = parentSelect.value;
  parentSelect.innerHTML = '<option value="self">self (root / orchestrator)</option>';
  for (const name of Object.keys(agents)) {
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    parentSelect.appendChild(opt);
  }
  if (val === "self" || agents[val])
    parentSelect.value = val;
}
function renderAgents() {
  if (!Object.keys(agents).length) {
    agentsEl.innerHTML = '<div class="empty">No agents running.</div>';
    updateParentSelect();
    return;
  }
  const existing = new Map;
  agentsEl.querySelectorAll(".agent").forEach((el) => {
    const name = el.querySelector(".agent-name")?.textContent;
    if (name) {
      const term = el.querySelector(".terminal");
      if (term)
        existing.set(name, term);
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
      </div>
      <div class="terminal" id="term-${name}"></div>
      <div class="agent-actions">
        <input id="msg-${name}" placeholder="Message…">
        <button id="btn-send-${name}">Send</button>
        <button id="btn-kill-${name}" class="danger">Kill</button>
      </div>
    `;
    const term = div.querySelector(".terminal");
    const existingTerm = existing.get(name);
    if (existingTerm) {
      term.textContent = existingTerm.textContent;
    } else {
      term.textContent = a.text ?? "";
    }
    const msgInput = div.querySelector(`#msg-${name}`);
    msgInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter")
        sendMessage(name);
    });
    div.querySelector(`#btn-send-${name}`)?.addEventListener("click", () => sendMessage(name));
    div.querySelector(`#btn-kill-${name}`)?.addEventListener("click", () => killAgent(name));
    agentsEl.appendChild(div);
  }
  updateParentSelect();
}
function updateAgent(name, patch) {
  if (!agents[name])
    agents[name] = { name, status: "idle", turns: 0, children: [], worktree: "" };
  Object.assign(agents[name], patch);
  let card = document.getElementById("agent-" + name);
  if (!card) {
    renderAgents();
    card = document.getElementById("agent-" + name);
  }
  if (!card)
    return;
  if (patch.status !== undefined) {
    const badge = card.querySelector(".badge");
    badge.className = "badge " + patch.status;
    badge.textContent = patch.status;
    card.className = "agent" + (patch.status === "streaming" ? " streaming" : "");
  }
  const term = card.querySelector(".terminal");
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
async function sendMessage(name) {
  const input = document.getElementById("msg-" + name);
  if (!input)
    return;
  const msg = input.value.trim();
  if (!msg)
    return;
  input.value = "";
  try {
    const res = await fetch("/api/agents/" + encodeURIComponent(name) + "/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: msg })
    });
    if (!res.ok)
      pushLog("Send to " + name + " failed: " + res.status, "error");
    else
      pushLog("Queued message for " + name);
  } catch (e) {
    pushLog("Send to " + name + " error: " + e.message, "error");
  }
}
async function killAgent(name) {
  try {
    const res = await fetch("/api/agents/" + encodeURIComponent(name) + "/kill", { method: "POST" });
    if (!res.ok)
      pushLog("Kill " + name + " failed: " + res.status, "error");
  } catch (e) {
    pushLog("Kill " + name + " error: " + e.message, "error");
  }
}
document.getElementById("spawn-form")?.addEventListener("submit", async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById("spawn-name");
  const modelInput = document.getElementById("spawn-model");
  const name = nameInput.value.trim();
  const parent = parentSelect.value;
  const type = typeSelect.value;
  const model = modelInput.value.trim();
  const extCheckboxes = document.querySelectorAll('input[name="extension"]:checked');
  const extensions = Array.from(extCheckboxes).map((cb) => cb.value);
  if (!type) {
    pushLog("Please select an agent type.", "warn");
    return;
  }
  try {
    const res = await fetch("/api/spawn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name,
        parent,
        type,
        model: model || undefined,
        extensions: extensions.length ? extensions : undefined
      })
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok)
      pushLog("Spawn failed: " + (body.error || res.statusText), "error");
    else
      pushLog("Spawned " + name + (extensions.length ? " with " + extensions.length + " ext" : ""));
  } catch (err) {
    pushLog("Spawn error: " + err.message, "error");
  }
  nameInput.value = "";
  modelInput.value = "";
  typeSelect.value = "";
  loadExtensions();
});
function setConnected(c) {
  connDot.className = "dot " + (c ? "connected" : "");
  connText.textContent = c ? "Connected" : "Disconnected";
}
function handleEvent(ev) {
  switch (ev.type) {
    case "init": {
      agents = {};
      for (const [k, v] of Object.entries(ev.data.agents || {}))
        agents[k] = { ...v };
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
    handleEvent(JSON.parse(e.data));
  };
}
useSSE();
loadAgentTypes();
loadExtensions();
