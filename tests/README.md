# Test Strategy

## Unit tests (automated)

Run with:
```bash
bun test
```

### `definitions.test.ts`
Tests agent definition discovery using temporary directories.
- User-level definitions from `~/.pi/agent/agents/`
- Project-level definitions from `./.pi/agents/`
- Override semantics (project > user > package)
- Frontmatter validation (skips entries missing required fields)

### `server.test.ts`
Tests infrastructure that will be used by the HTTP server.
- Port probing (`findPort`): sequential preferred ports, fallback to OS-assigned ephemeral
- SSE event formatting: validates `data: <json>\n\n` structure
- Skill Library create/copy/update/delete API paths

### `skills-api.test.ts`
Tests skill discovery and backend helpers.
- Discovery diagnostics for invalid skills
- Project and Lattice Library skill discovery
- Copying skill directories with rewritten frontmatter and collision guards

### `send.test.ts`
Tests `sendToAgent` behavior with a fake agent stream.
- Prompt RPC write format
- User history recording and accumulated text reset
- Concurrent send serialization
- Immediate rejection for exited agents

### `spawn-worktree.test.ts`
Tests spawn planning and git worktree behavior without launching a real Pi agent.
- Pure Pi RPC argument construction from agent definitions
- Tool restriction behavior when extensions can register runtime tools
- Direct child-process launch metadata with the worktree as `cwd`
- Real temporary git worktree creation/removal
- Orphaned worktree cleanup while preserving active worktrees

## Manual verification (required)

The following still require a full Pi runtime environment:

| Component | Manual test |
|---|---|
| `spawnAgent` process launch | `/spawn lead self coder` inside a git repo and verify the child reaches idle/streaming states |
| Worktree boundary | Verify files written by a spawned Pi agent only appear in its worktree |
| `delegate` routing | Spawn lead + scout, have lead delegate to scout |
| `agent_send` async end-to-end | `agent_send("lead", "long task")` then chat with orchestrator |
| Worktree cleanup on process/session exit | Check `/tmp/pi-worktree-*` after `/kill` and session exit |
| HTTP server | `curl` endpoints after Issue 7 implementation |
| SSE stream | Connect browser to `/events` and watch real-time updates |

## Future test additions

- Mock `spawn` to exercise `spawnAgent` process event wiring without launching a real Pi child process
- HTTP integration tests with a lightweight in-memory server
