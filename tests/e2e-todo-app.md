# E2E Test: Build a Todo App (Agentic Workflow)

## Goal
Verify the full agentic orchestration pipeline:
1. Orchestrator spawns a **lead** agent
2. Lead analyzes the task and autonomously spawns sub-agents (implementer, reviewer, etc.)
3. Sub-agents collaborate via delegation
4. Final deliverable: a working todo app in the project

## Setup

```bash
cd tests/fixtures/todo-project
pi
```

## Test Steps

### Step 1 — Start the orchestrator
```bash
cd tests/fixtures/todo-project
pi
```

The multi-agent extension auto-loads, but Pi starts in normal mode.

Enter orchestration mode:
```
/orchestrate
```

Verify:
```
/agents
```
Should show: `No active agents.`

### Step 2 — Task the orchestrator
Just ask naturally:
```
Build me a simple CLI todo app in this project. It should support add, list, complete, and delete tasks. Use a JSON file for storage. Write clean code with basic tests.
```

**Expected behavior:**
- Orchestrator analyzes the request
- Orchestrator decides it needs help
- Orchestrator calls `create_sub_agent` to spawn:
  - `implementer` (or `lead`) — to write the code
  - Possibly `researcher` — if it wants to check patterns first
  - Possibly `reviewer` — to check the result
- Orchestrator delegates work via `delegate` tool
- Sub-agents return results
- Orchestrator synthesizes and reports back to you

### Step 3 — Observe via dashboard
Open the dashboard:
```
/dashboard
```

Watch the hierarchy tree grow in real-time as the orchestrator spawns agents.

### Step 4 — Verify deliverable
After the orchestrator reports completion, check the project:

```bash
ls tests/fixtures/todo-project/
```

Expected files:
- `todo.py` (or similar) — main CLI
- `tasks.json` — data file
- `README.md` — updated
- Tests

Try running it:
```bash
python todo.py add "Buy milk"
python todo.py list
```

### Step 5 — Cleanup
```
/kill all
```

Or hit **🛑 Emergency Stop** in the dashboard.

## Success Criteria

| Check | Pass? |
|-------|-------|
| Lead spawned successfully | ☐ |
| Lead created at least 1 sub-agent autonomously | ☐ |
| Delegation worked (no deadlock) | ☐ |
| Files were written to worktree | ☐ |
| Code is runnable | ☐ |
| Dashboard showed hierarchy correctly | ☐ |
| Emergency stop works (optional test) | ☐ |

## Notes

- If the lead doesn't spawn sub-agents, check that:
  - The `create_sub_agent` tool is in its tool list
  - Its system prompt includes guidance on when to spawn
- If delegation hangs, check `/tmp/pi-multi-agent.log`
- The worktree path is logged on spawn — use it to inspect files
