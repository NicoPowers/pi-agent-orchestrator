# pi-agent-orchestrator — Current Vision & Roadmap

## Current Goal

Build a lightweight, orchestrator-driven multi-agent system inside Pi.

- The **orchestrator** (the root Pi interactive session running this extension) is the only agent allowed to create sub-agents.
- Child agents can request help, but the request is routed back to the orchestrator, which decides whether to spawn, what type, which model, and why.
- The **dashboard** is a supporting tool, not the driver:
  - Agent Type Library editor (prompts, skills, extensions, model assignment)
  - Simple collapsible hierarchy view for monitoring
  - Emergency stop button for when things go off the rails
- Models are discovered dynamically from the user’s actual Pi environment (`pi --list-models`).
- A small set of canonical agent types ship with good defaults; users can edit or add more.
- Everything stays simple, bwrap-isolated, and deeply integrated with Pi.

## How It Works (High Level)

- Root agent gets its own git worktree + bwrap sandbox.
- Sub-agents share the parent’s worktree (same `/tmp/workspace` inside bwrap).
- All agents run `pi --mode rpc --no-session` inside their sandbox.
- Communication uses JSONL over stdout/stdin + a shared `comms/` directory for `delegate` tool.
- The orchestrator exposes a `create_sub_agent` tool that only it can call.
- Dashboard talks to the extension via REST + SSE on ports 18765–18767 (or ephemeral).
- All output is logged; live terminal is hidden by default behind expand/collapse.

---

## Tracer Bullet Issues

### Issue 1: Model Discovery Endpoint

**Goal**: Expose the models the user actually has access to so the dashboard can offer real choices when editing agent types.

**What to do:**
- Add a helper that runs `pi --list-models` (or equivalent) and parses the output.
- Expose `GET /api/models` returning a simple list of model ids/names.
- Cache the result for the lifetime of the session (no need to re-query constantly).
- Update the dashboard’s agent-type editor to use this list for the “Model” dropdown.

**Why first**: It’s small, independent, and unlocks the type editor work.

**Test:**
```bash
curl http://localhost:18765/api/models
```
Should return something like:
```json
["anthropic/claude-3-5-sonnet-20241022", "openai/gpt-4o", "github-copilot/claude-3-5-sonnet", ...]
```

---

### Issue 2: Agent Type Library Editor

**Goal**: Replace the old manual spawn form with a clean editor for agent types.

**What to do:**
- Remove the spawn form (name, parent, type, model, extensions) from the dashboard.
- Add a new “Agent Types” section that lists all discovered `.md` definitions.
- Clicking a type opens a simple editor:
  - Prompt body (textarea)
  - Skills (multi-select or comma list)
  - Extensions (checkboxes from `/api/extensions`)
  - Model (dropdown from `/api/models`)
- “Save” writes the changes back to the `.md` file (frontmatter + body).
- “New Type” creates a fresh `.md` with sensible defaults.
- Protect the root orchestrator type from deletion (or at least warn strongly).

**Test:**
- Edit an existing type, change its model and add an extension, save.
- Create a new type called “researcher”.
- Verify the `.md` files are updated on disk.

---

### Issue 3: `create_sub_agent` Tool (Orchestrator Only)

**Goal**: Give the orchestrator the ability to spawn sub-agents programmatically.

**What to do:**
- Add a new tool `create_sub_agent` that only the root orchestrator can call.
- Parameters: `name`, `type`, `reason`, optional `model`, optional `extensions`.
- Internally re-uses the existing `spawnAgent` logic.
- Records who requested it and why (for logging/audit).
- Child agents are **not** allowed to call this tool (enforce at the tool level).

**Test:**
- In the terminal, ask the orchestrator to create a researcher sub-agent for a specific task.
- Verify the agent appears in `/api/agents` and in the dashboard tree.

---

### Issue 4: Update Orchestrator System Prompt

**Goal**: Teach the orchestrator when and how to create sub-agents.

**What to do:**
- Update the root agent’s prompt (or the delegate instructions) to include guidance like:
  > “If a task would benefit from focused research, parallel implementation, or specialized review, consider creating a sub-agent using the `create_sub_agent` tool. Always provide a clear reason.”
- Make sure the new `create_sub_agent` tool is available in the orchestrator’s tool list.
- Keep the existing `delegate` tool for routing work after agents exist.

**Test:**
- Give the orchestrator a multi-step task and observe whether it chooses to create a sub-agent.

---

### Issue 5: Collapsible Agent Hierarchy View

**Goal**: Simple monitoring tree in the dashboard without flooding it with live output.

**What to do:**
- Add a “Live Agents” or “Hierarchy” panel.
- Show parent → child relationships as a tree or indented list.
- Each node shows: name, type, status, model.
- No live terminal output by default.
- Add a small “Inspect” / expand button that reveals the accumulated text for that agent (read-only).
- All output continues to be written to log files for later inspection by the orchestrator.

**Test:**
- Spawn a small tree via the orchestrator.
- Open the dashboard and verify the hierarchy is visible and collapsible.

---

### Issue 6: Emergency Stop Button

**Goal**: Give the human a reliable way to shut everything down when things go wrong.

**What to do:**
- Add a prominent “Emergency Stop” button in the dashboard.
- Endpoint: `POST /api/emergency-stop`
- Behavior:
  1. Kill every running agent process
  2. Remove all worktrees
  3. Clear in-memory state
  4. Optionally restart the HTTP server cleanly
- Also expose a terminal command `/emergency-stop` as a backup.

**Test:**
- Start several agents.
- Click Emergency Stop.
- Verify no processes remain, no worktrees left under `/tmp/pi-worktree-*`, and the dashboard shows an empty state.

---

### Issue 7: Seed Canonical Agent Types

**Goal**: Ship a small set of useful starter types so users have good examples.

**What to do:**
- Create `agents/researcher.md`, `agents/implementer.md`, `agents/reviewer.md`, `agents/tester.md` (or similar) with solid prompts, appropriate tools, and sensible default models.
- Make sure these are discovered alongside any user-created types.
- Document in the type editor that these are examples and can be edited or deleted.

**Test:**
- Fresh install shows the canonical types in the library.
- Using one of them via the orchestrator works end-to-end.

---

### Issue 8: Protect Root Orchestrator Type

**Goal**: Prevent accidental deletion of the root orchestrator definition.

**What to do:**
- In the type library editor, disable the delete button (or show a strong warning) for any type named “orchestrator” or marked as `root: true`.
- The orchestrator instance itself (the one running the Pi shell) should never be killable from the dashboard either.

**Test:**
- Attempt to delete the orchestrator type → blocked or warned.
- Attempt to kill the root agent from the dashboard → blocked.

---

### Issue 9: Polish, Logging & Documentation

**Goal**: Make sure the system is pleasant to use and well documented.

**What to do:**
- Ensure all new flows have clear log messages.
- Update `README.md` with the new vision and basic usage.
- Add a short “How to get started” section that shows the orchestrator creating its first sub-agent.
- Verify no dead code or old spawn-form references remain.

**Test:**
- Run through a full session: start Pi, open dashboard, let orchestrator create a researcher, inspect via dashboard, emergency stop.

---

## How to Resume

1. `cd` into a git repository (not `~/.pi/`)
2. Start `pi`
3. `/reload`
4. The orchestrator is now ready to create sub-agents when needed
5. Open the dashboard (`/dashboard`) to manage agent types or hit Emergency Stop if required

Let’s keep this file focused and actionable. When an issue is done, we can mark it complete and move on.