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

**Status**: Implemented.

**What changed:**
- Created `extensions/delegate-agent.ts` — registers a `delegate` tool inside each sub-agent
- Tool writes request to `/tmp/workspace/.pi/comms/requests/<toolCallId>.json`
- Polls for response at `/tmp/workspace/.pi/comms/responses/<toolCallId>.json`
- Returns response text when broker writes the result file

### Issue 4: Broker Extension Routes `delegate` Requests ✅

**Status**: Implemented.

**What changed:**
- Broker extension monitors JSONL stdout for `tool_execution_start` with `toolName: "delegate"`
- Reads request file from shared worktree, looks up target agent in `agents` map
- Calls `sendToAgent(targetAgent, task)` and writes result back to responses file
- Original agent's `delegate` tool unblocks and continues with the routed result

**Spawn integration:**
- `delegate-agent.ts` copied into worktree `.pi/extensions/` before each spawn
- Sub-agents launched with `--no-extensions --extension /tmp/workspace/.pi/extensions/delegate-agent.ts`
- `package.json` changed to only auto-load `multi-agent.ts` (prevents delegate loading in orchestrator)

---

### Issue 5: End-to-End MVP

**Goal**: Orchestrator → Lead → Scout → Lead → Orchestrator works end-to-end.

**Test scenario**:
```
Orchestrator: agent_spawn(name="lead", type="coder", parent="self")
Orchestrator: agent_spawn(name="scout", type="reviewer", parent="lead")
Orchestrator: agent_send("lead", "Find auth bugs. Use @scout if needed.")
  → Returns immediately (async)
  
  [Background]
  Lead calls delegate("scout", "Find all auth-related code")
    Broker routes to Scout
    Scout responds with findings
    Broker writes response, Lead continues
  Lead calls delegate("scout", "Check src/login.js for SQL injection")
    Same cycle...
  Lead gives final: "Found 2 issues. Details: ..."
  
  Broker delivers to Orchestrator:
  "[lead] Found 2 issues. Details: ..."
```

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
- **No per-agent extension loading**: `delegate-agent.ts` not yet created or loaded

---

## How to Resume

1. `cd` into a **git repository** (not `~/.pi/`)
2. Start `pi`
3. `/reload` to load the extension
4. Test Issue 1 with `/spawn lead self coder`
5. Continue with Issue 2 (async `agent_send`)

## Git History

```
abc9648 Initial commit: multi-agent orchestration extension
f887248 Fix skills: add YAML frontmatter with description field
9cef6a3 Issue 1: Bwrap + shared worktree per root agent
```
