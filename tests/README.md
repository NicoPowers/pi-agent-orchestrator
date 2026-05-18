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

## Manual verification (required)

The following cannot be tested without a full Pi + bwrap environment:

| Component | Manual test |
|---|---|
| `spawnAgent` | `/spawn lead self coder` inside a git repo |
| `sendToAgent` | `/ask lead "create hello.txt"` |
| `bwrap` isolation | Verify files written only in worktree |
| `delegate` routing | Spawn lead + scout, have lead delegate to scout |
| `agent_send` async | `agent_send("lead", "long task")` then chat with orchestrator |
| Worktree cleanup | Check `/tmp/pi-worktree-*` after `/kill` and session exit |
| HTTP server | `curl` endpoints after Issue 7 implementation |
| SSE stream | Connect browser to `/events` and watch real-time updates |

## Future test additions

- Mock `spawn` to test `spawnAgent` without real bwrap
- Mock filesystem to test `createWorktree`/`removeWorktree`
- HTTP integration tests with a lightweight in-memory server
