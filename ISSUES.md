# pi-agent-orchestrator — Development Roadmap

## Architecture Overview

Multi-agent orchestration extension for Pi. The orchestrator (broker LLM in your interactive Pi session) spawns specialized sub-agents, each running in an isolated `bwrap` sandbox with a shared git worktree per issue.

### Key Concepts

- **Root agent**: `parent: "self"`. Gets its own `git worktree`.
- **Sub-agent**: `parent: "<some-agent>"`. Shares the parent's worktree (same bwrap `/workspace`).
- **Broker extension**: TypeScript extension in the orchestrator's Pi session. Holds all agent pipes, routes messages.
- **Async messaging**: `agent_send` returns immediately. Results delivered to orchestrator via `sendUserMessage({deliverAs: "steer"})`.
- **Delegation chain**: Sub-agents call a `delegate` tool. Broker extension routes through parent chain.

---

## Completed

### Issue 1: Bwrap + Shared Worktree Per Root Agent ✅

**Status**: Implemented, committed, tested and fixed.

**What works:**
- `agent_spawn` creates root agents with `git worktree add <path> HEAD`
- Sub-agents reuse parent's worktree
- Every agent spawned inside `bwrap`:
  ```
  bwrap --ro-bind / / --tmpfs /tmp --bind <worktree> /tmp/workspace --chdir /tmp/workspace --share-net pi --mode rpc ...
  ```
- Prompts written into worktree at `/tmp/workspace/.pi/prompts/<name>.md`
- Comms directory created: `/tmp/workspace/.pi/comms/{requests,responses}/`
- Orphaned worktree cleanup on startup (`cleanupOrphanedWorktrees`)
- Worktree removal on `agent_kill` (root) and `session_shutdown`
- Serialized worktree creation with mutex (`worktreeLock`)
- `hasBwrap()` detection using `spawnSync("which", ["bwrap"])`

**Bugs fixed:**
- `spawn.sync` → `spawnSync` (Node API difference)
- `bwrap: Can't mkdir /workspace: Read-only file system` — changed sandbox mount from `/workspace` to `/tmp/workspace` so bwrap can create the mount point inside the writable `/tmp` tmpfs
- `/spawn` command now validates the agent actually stayed alive after spawn (was falsely reporting success when the process exited immediately)
- Added writable bind for `~/.pi/agent` so child pi processes can create lock files

**Test command:**
```
# Must be run inside a git repo (not ~/.pi/)
/spawn lead self coder
/ask lead "Create a file called hello.txt with 'hello world'"
```

**Verify:**
```bash
# Check worktree exists
ls -la /tmp/pi-worktree-lead-*

# Check file was created inside bwrap
cat /tmp/pi-worktree-lead-*/hello.txt
```

---

## Completed

### Issue 2: Async `agent_send` ✅

**Status**: Implemented and tested.

**What changed:**
- `agent_send` tool now returns immediately with `"Queued task for 'lead'. Result will be delivered when the agent completes."`
- Background `Promise.resolve().then(...)` fires `sendToAgent` asynchronously
- When the agent responds, the extension calls:
  ```ts
  pi.sendUserMessage(`[${name}] ${result}`, { deliverAs: "steer" })
  ```
- Orchestrator receives the result as a new steering message after its current turn finishes
- Pending tasks are tracked in a `Map<string, PendingTask>` for observability
- `/ask` command stays blocking (user-facing direct interaction)

**Tested:**
```
agent_send("lead", "write async-test.txt with 'async works' and cat it")
→ Returns immediately: "Queued task for 'lead'..."
→ User can chat with orchestrator while lead works
→ [lead] result delivered as steering message when complete
```

---

## Pending Issues

---

### Issue 3: Per-Agent `delegate` Extension ✅

**Status**: Implemented and tested.

**What changed:**
- Created `extensions/delegate-agent.ts` — registers a `delegate` tool inside each sub-agent
- Tool writes request to `/tmp/workspace/.pi/comms/requests/<toolCallId>.json`
- Polls for response at `/tmp/workspace/.pi/comms/responses/<toolCallId>.json`
- Returns response text when broker writes the result file

### Issue 4: Broker Extension Routes `delegate` Requests ✅

**Status**: Implemented and tested.

**What changed:**
- Broker extension monitors JSONL stdout for `tool_execution_start` with `toolName: "delegate"`
- Reads request file from shared worktree, looks up target agent in `agents` map
- Calls `sendToAgent(targetAgent, task)` and writes result back to responses file
- Original agent's `delegate` tool unblocks and continues with the routed result

**Spawn integration:**
- `delegate-agent.ts` copied into worktree `.pi/extensions/` before each spawn
- Sub-agents launched with `--no-extensions --extension /tmp/workspace/.pi/extensions/delegate-agent.ts`
- `package.json` changed to only auto-load `multi-agent.ts` (prevents delegate loading in orchestrator)

**Tested:**
```
/spawn lead self coder
/spawn scout lead coder
/ask lead "Delegate to scout to list all files, then summarize"
→ Lead calls delegate("scout", "list all files...")
→ Broker routes to scout
→ Scout responds with file list
→ Lead gets result back and summarizes
```

---

### Issue 5: End-to-End MVP ✅

**Goal**: Orchestrator → Lead → Scout → Lead → Orchestrator works end-to-end.

**Status**: Tested successfully.

**Test scenario**:
```
# 1. Spawn agents
/spawn lead self coder
/spawn scout lead reviewer

# 2. Send async task to lead
agent_send("lead", "Find auth bugs. Use @scout if needed.")
  → Returns immediately: "Queued task for 'lead'..."

# 3. [Background] Lead delegates multiple times
Lead calls delegate("scout", "Find all auth-related code")
  → Broker routes to Scout
  → Scout responds with findings
  → Broker writes response, Lead continues
Lead calls delegate("scout", "Check src/login.js for SQL injection")
  → Same cycle...
Lead gives final: "Found 2 issues. Details: ..."

# 4. Result delivered to Orchestrator
→ [lead] Found 2 issues. Details: ...
```

**Tested:**
```
agent_send("lead", "I want to improve this codebase. Have scout review the project structure and identify any issues, then implement whatever fixes scout recommends.")
→ Returns immediately
→ Lead delegates to scout
→ Scout returns 11KB review with 23 findings
→ Lead synthesizes findings and proposes fixes
→ [lead] result delivered as steering message
```

**Verified:**
- ✅ Lead delegated to scout successfully
- ✅ Scout (reviewer type) performed read-only review with `security-checklist` skill
- ✅ Broker routed 11KB response back to lead
- ✅ Lead synthesized findings into final answer
- ✅ Async result delivered back to orchestrator via steering message

**Issue found & fixed:**
- While agents were working, TUI input was occasionally dropped
- Root cause: spinner refreshed every 120ms, flooding TUI with UI events
- Fix: increased interval to 500ms + added content hashing to skip redundant updates

---

## Architectural Decisions Log

| Decision | Rationale |
|----------|-----------|
| One worktree per root agent | All sub-agents share filesystem. Scout writes analysis.md, Lead reads it. No text-snippet relay needed. |
| Separate bwrap per agent | Full context isolation. Broker can kill any agent directly. TUI visibility. |
| `--ro-bind / /` + `--tmpfs /tmp` | Simple, robust. Agents can read host FS but can't write outside worktree. |
| Broker extension as message router | Broker LLM is unburdened. All relay happens in TypeScript. Full logging. |
| `agent_send` async, `delegate` blocking | Orchestrator stays interactive. Sub-agents complete their reasoning in one turn. |
| `"self"` for root parent | Explicit. No magic defaults. |

---

## Known Limitations / Future Work

- **No team support yet**: Deferred in favor of parent-child hierarchy
- **No health checking**: `agent_status` shows status but no staleness detection
- **No logs inspection**: Communication logs not yet written to disk
- **No PR/push**: Agents are read-write-local only
- **WSL not tested**: Bwrap requires WSL2 (Linux kernel)

---

## Pending Issues (Web Dashboard Pivot)

### Issue 5.5: Refactor into Multi-File Extension

**Status**: ✅ Completed

**Goal**: Split `extensions/multi-agent.ts` into a directory-based extension with clear separation of concerns.

**Structure:**
```
extensions/
├── multi-agent/
│   ├── index.ts          # Entry point — tools, commands, session hooks
│   ├── state.ts          # Shared state: Agent, AgentDefinition, agents Map, log()
│   ├── definitions.ts    # Agent definition discovery (YAML frontmatter parsing)
│   ├── worktree.ts       # Git worktree ops + orphaned cleanup
│   ├── spawn.ts          # spawnAgent(), hasBwrap(), getPiInvocation()
│   └── send.ts           # sendToAgent() (blocking RPC helper)
├── delegate-agent.ts     # Unchanged
```

**What changed:**
- All modules use `.js` imports (ES module resolution for jiti/Bun)
- `package.json` entry point updated to `"./extensions/multi-agent/index.ts"`
- `delegate-agent.ts` copy path fixed: `path.join(__dirname, "..", "delegate-agent.ts")`
- `typebox` and `@earendil-works/pi-coding-agent` added as `devDependencies` for test compilation

---

### Issue 6: Strip TUI Widget Code

**Status**: ✅ Completed

**Goal**: Remove all TUI panel, spinner, and `setWidget`/`setStatus` calls from the extension.

**What changed:**
- Delete `refreshPanel()`, `clearPanel()`, `ensureSpinner()`, `stopSpinnerIfIdle()`, `agentPanelHash()`
- Delete `SPINNER_FRAMES`, `spinnerIndex`, `spinnerTimer`, `lastPanelHash`
- Remove all `ctx.ui.setWidget` / `ctx.ui.setStatus` calls from commands and tools
- Keep `ctx.ui.notify` for minimal text feedback on `/spawn`, `/kill`, etc.
- `currentCtx` retained only for `ctx.ui.notify` fallback

**Test:**
```
/spawn lead self coder
/ask lead "create hello.txt with 'hello world'"
```

**Verify:**
- No panel appears below the editor
- Terminal input stays responsive while agent streams
- `/agents` still prints text list via `notify`

---

### Issue 6.5: Test Scaffolding

**Status**: ✅ Completed

**Goal**: Add `bun:test` unit tests for refactored modules.

**Tests added:**
- `tests/definitions.test.ts` — project-level discovery, frontmatter validation, override semantics
- `tests/server.test.ts` — port probing (`findPort`), SSE event formatting
- `tests/README.md` — test strategy + manual verification checklist

**Run:** `bun test`

---

### Issue 7: HTTP REST API

**Status**: Not started

**Goal**: Add a headless HTTP server to the extension. REST endpoints only — no web UI yet.

**What changed:**
- On `session_start`, start HTTP server on a port from range `[18765, 18766, 18767]`, falling back to OS-assigned ephemeral
- Server logs its URL to the Pi console
- Endpoints:
  - `GET /api/agents` — list all agents JSON
  - `POST /api/spawn` — body `{ name, parent, type?, model? }`
  - `POST /api/agents/:name/send` — body `{ message }`
  - `POST /api/agents/:name/kill` — kill agent + children
  - `GET /api/agent-types` — list available definitions
- All endpoints reuse existing `spawnAgent`, `sendToAgent`, kill logic
- No static file serving yet

**Test:**
```bash
curl http://localhost:18765/api/agents
curl -X POST http://localhost:18765/api/spawn \
  -H "Content-Type: application/json" \
  -d '{"name":"lead","parent":"self","type":"coder"}'
curl http://localhost:18765/api/agents
curl -X POST http://localhost:18765/api/agents/lead/send \
  -d '{"message":"create hi.txt"}'
curl -X POST http://localhost:18765/api/agents/lead/kill
```

**Verify:**
- `curl` commands return correct JSON
- Agents spawn and kill correctly
- Existing `/spawn` and `/ask` terminal commands still work

---

### Issue 8: SSE Event Stream

**Status**: Not started

**Goal**: Add `GET /events` endpoint that pushes agent lifecycle updates to connected clients.

**What changed:**
- `GET /events` returns `text/event-stream`
- Maintain a `Set` of active SSE response objects
- Broadcast events on every agent state change:
  - `agent-spawned`, `agent-killed`
  - `agent-start`, `agent-end`, `agent-exit`
  - `agent-delta` (text delta from streaming agent)
  - `delegate` (routing note)
- Each event is a JSON-serialized SSE `data:` line
- Browser reconnects automatically via `EventSource` API

**Test:**
```bash
# Terminal 1
curl http://localhost:18765/events

# Terminal 2
curl -X POST http://localhost:18765/api/spawn \
  -d '{"name":"scout","parent":"self","type":"reviewer"}'
curl -X POST http://localhost:18765/api/agents/scout/kill
```

**Verify:**
- `curl` on `/events` receives JSON events in real time
- Events match the lifecycle actions performed in Terminal 2

---

### Issue 9: Web Dashboard

**Status**: Not started

**Goal**: Serve `web/index.html` and wire the dashboard to the REST API + SSE stream.

**What changed:**
- `GET /` serves `web/index.html` (single static file)
- Dashboard shows agent cards with: name, type, status, parent, turns
- Live terminal output per agent (accumulated text streamed via `agent-delta`)
- Spawn form: name, parent dropdown, type, model
- Per-agent actions: message input + send button, kill button
- Global event log sidebar
- Auto-reconnecting `EventSource` to `/events`
- Falls back to polling if SSE is unavailable

**Test:**
1. Open browser at `http://localhost:18765`
2. Spawn agent via dashboard form
3. Send message via agent card input
4. Watch live output appear in the card's terminal
5. Kill agent via button

**Verify:**
- All dashboard actions work end-to-end
- Terminal `/agents` shows the same state as the dashboard
- Killing an agent from the dashboard removes its card immediately

---

### Issue 10: Bidirectional Sync & Port Discovery

**Status**: Not started

**Goal**: Web actions notify the terminal orchestrator; dashboard URL is easy to discover.

**What changed:**
- When dashboard `POST /api/spawn` succeeds, broadcast to SSE **and** call `pi.sendUserMessage("[dashboard] Spawned agent 'X'", { deliverAs: "steer" })`
- Same for kill and send actions
- Add `/dashboard` slash command: prints URL to console, optionally opens browser via `xdg-open` / `open`
- Port probing: try `18765`, `18766`, `18767` sequentially; if all occupied, bind to `0` and log the OS-assigned port
- Store active port in extension state for `/dashboard` to report

**Test:**
```
/dashboard
# Browser opens (or URL printed)
# Spawn agent from dashboard
```

**Verify:**
- Terminal receives a steer message like `[dashboard] Spawned agent 'scout'`
- Orchestrator LLM sees the fleet change and can reference it
- `/dashboard` prints the correct current URL including the actual bound port

---

### Issue 11: Cleanup & Documentation

**Status**: Not started

**Goal**: Remove dead code, update docs, verify no TUI leakage remains.

**What changed:**
- Delete all dead TUI imports, variables, and helper functions
- Update `README.md`: remove TUI panel references, document REST API, `/dashboard` command, and web UI
- Update `ISSUES.md`: mark Issues 6–10 as completed
- Verify `package.json` is unchanged (extensions list stays the same)

**Test:**
```
/reload
/spawn lead self coder
agent_send("lead", "do a thing")
```

**Verify:**
- No runtime errors
- Dashboard works
- No TUI widgets appear in the terminal
- README accurately describes the new architecture

---

## How to Resume

1. `cd` into a **git repository** (not `~/.pi/`)
2. Start `pi`
3. `/reload` to load the extension
4. Spawn agents: `/spawn lead self coder`, `/spawn scout lead reviewer`
5. Test async delegation: `agent_send("lead", "Find auth bugs. Use @scout if needed.")`

## Git History

```
abc9648 Initial commit: multi-agent orchestration extension
f887248 Fix skills: add YAML frontmatter with description field
9cef6a3 Issue 1: Bwrap + shared worktree per root agent
```
