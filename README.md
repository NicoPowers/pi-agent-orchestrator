# pi-agent-orchestrator

Multi-agent orchestration extension for [Pi](https://pi.dev).

When you explicitly enter orchestration mode with `/orchestrate`, your interactive Pi session becomes the **orchestrator**. You define agent types and prompts via the dashboard; the orchestrator decides when to spawn specialists (researcher, implementer, reviewer, etc.) and routes work to them.

Key features:
- Explicit orchestration mode (`/orchestrate`, `/orchestrate off`)
- Orchestrator-driven spawning (`create_sub_agent` tool)
- Real models from your Pi environment (`pi --list-models`)
- Agent Type Library editor in the dashboard
- Emergency Stop for safety
- bwrap isolation + shared git worktrees
- No TUI modifications — terminal stays clean

## Architecture

The extension runs inside your interactive Pi session. It spawns child `pi --mode rpc` processes, each sandboxed with `bwrap` inside a dedicated git worktree. A headless HTTP server provides a REST API and SSE event stream for the web dashboard. The terminal stays 100% vanilla Pi — no widgets, no spinners, no panel flooding.

```
┌─────────────────────────────┐
│  Terminal: vanilla Pi       │
│  You chat with orchestrator │
└─────────────┬───────────────┘
              │ tools: agent_spawn, agent_send...
              ▼
┌─────────────────────────────┐
│  Extension (multi-agent/)   │
│  - Spawns bwrap'd agents    │
│  - HTTP server + SSE        │
│  - Delegation routing       │
└─────────────┬───────────────┘
              │ HTTP + SSE
              ▼
┌─────────────────────────────┐
│  Browser: localhost:18765   │
│  - Agent cards + terminals  │
│  - Spawn / send / kill      │
│  - Live event log           │
└─────────────────────────────┘
```

## Features

- **Typed agent definitions** via YAML frontmatter markdown files
- **Process isolation** — each agent runs in its own `bwrap` sandbox with a git worktree
- **Skill scoping** — agents load only the skills they need
- **Async delegation** — `agent_send` returns immediately; results delivered as steering messages
- **Real-time web dashboard** — manage agents via browser without touching the TUI
- **No TUI modifications** — terminal stays responsive; dashboard is optional

## Project Structure

```
pi-agent-orchestrator/
├── package.json                    # Pi manifest + devDependencies
├── extensions/
│   ├── multi-agent/                # Extension entry point (directory-based)
│   │   ├── index.ts                # Registers tools, commands, session hooks
│   │   ├── state.ts                # Shared types, agents Map, file logging
│   │   ├── definitions.ts          # Agent definition discovery from .md files
│   │   ├── worktree.ts             # Git worktree create/remove/cleanup
│   │   ├── spawn.ts                # spawnAgent(), bwrap invocation, delegate routing
│   │   └── send.ts                 # sendToAgent() blocking RPC helper
│   └── delegate-agent.ts           # `delegate` tool loaded inside each sub-agent
├── skills/
│   ├── tdd/SKILL.md
│   └── security-checklist/SKILL.md
├── agents/
│   ├── coder.md
│   └── reviewer.md
├── .pi/
│   ├── skill-templates/            # Optional project-local skill template files
│   └── extension-templates/        # Optional project-local extension template files
├── web/
│   ├── index.html                  # Static React dashboard shell
│   ├── app.tsx                     # React dashboard entrypoint
│   ├── tailwind.css                # Tailwind input
│   └── components/ui/              # Local shadcn-style UI primitives
└── tests/
    ├── definitions.test.ts         # Unit tests for agent discovery
    ├── server.test.ts              # Unit tests for port probing + SSE
    └── README.md                   # Test strategy & manual verification checklist
```

### Module Reference

| File | Responsibility |
|---|---|
| `index.ts` | Extension factory. Registers 4 tools + 5 slash commands. Starts HTTP server (Issue 7). |
| `state.ts` | `Agent` and `AgentDefinition` interfaces. Shared `agents` Map, `pendingTasks` Map, `log()` helper. |
| `definitions.ts` | Discovers `.md` agent definitions from `~/.pi/agent/agents/`, `.pi/agents/`, and package `agents/`. Parses YAML frontmatter via `parseFrontmatter`. Resolves skill paths. |
| `worktree.ts` | `createWorktree()`, `removeWorktree()`, `cleanupOrphanedWorktrees()`. Serializes git worktree ops with a mutex. |
| `spawn.ts` | `spawnAgent()`: writes prompts into worktree, copies `delegate-agent.ts`, builds `bwrap` command, launches `pi --mode rpc`, parses JSONL stdout, routes `delegate` tool calls between agents. |
| `send.ts` | `sendToAgent()`: queues messages, writes JSON to agent stdin, awaits `agent_end` event with timeout. |
| `delegate-agent.ts` | Loaded inside each sub-agent. Registers a `delegate` tool that writes request files and polls for broker responses. |

## Agent Types

| Agent | Purpose | Tools | Skills |
|-------|---------|-------|--------|
| `coder` | Write and edit code | read, bash, edit, write, grep, find, ls | tdd |
| `reviewer` | Review code for bugs/security | read, grep, find, ls | security-checklist |

## Usage

### Terminal Commands

```
/spawn <name> <parent|'self'> [type|model]    Spawn a named agent instance
/ask <name> <message>                         Send a message and show reply
/agents                                        List active agents
/kill <name>                                   Terminate an agent
/agent-types                                   List available definitions
/dashboard                                     Print dashboard URL & open browser
```

### Tools (broker LLM)

```
agent_spawn(name="my_coder", type="coder", parent="self")
agent_send(name="my_coder", message="Write a hello function")
agent_status(name="my_coder")
agent_kill(name="my_coder")
agent_types()
```

### Template Backend

Project-local template files can be stored under:

```text
.pi/skill-templates/*.md
.pi/extension-templates/*.md
```

They use markdown frontmatter:

```markdown
---
name: common
description: Common skills for most agents
applyToAll: true
skills: tdd, security-checklist
---
```

Extension templates use `extensions:` instead of `skills:`. Phase 2 only adds backend storage and CRUD APIs; template resolution is applied to newly spawned agents in a later phase.

Extensions may optionally advertise static, best-effort metadata without being executed. Add a source comment near the top of an extension file:

```ts
// pi-orchestrator: { "description": "Browser helpers", "expectedTools": ["open_page", "click"] }
```

Missing or invalid extension metadata is tolerated and reported as `metadataStatus: "unknown"` or `"invalid"`; it is advisory only.

REST endpoints:

```text
GET    /api/skill-templates
POST   /api/skill-templates
GET    /api/skill-templates/:name
DELETE /api/skill-templates/:name

GET    /api/extension-templates
POST   /api/extension-templates
GET    /api/extension-templates/:name
DELETE /api/extension-templates/:name
```

### Web Dashboard

When Pi starts, the extension prints a URL like:

```
🌐 Dashboard: http://localhost:18765
```

Open it in any browser. You can:
- **View** active agents and live assistant output streamed via SSE
- **Inspect** lifecycle/tool events with text deltas coalesced into readable blocks
- **Send** messages to any agent
- **Kill** agents and their children
- **Copy** agent worktree paths
- **Monitor** hierarchy, context/token usage, and cost stats
- **Create/edit** Agent Type Library definitions
- **Watch** the global event log (spawns, kills, delegations)
- **Emergency Stop** all agents and clear dashboard state

The dashboard is a static React + TypeScript + Tailwind bundle served by the extension HTTP server; no runtime dev server or framework is required.

## Customizing Agents

Override any agent type by creating a markdown file in `~/.pi/agent/agents/` or `.pi/agents/`:

```markdown
---
name: coder
description: My custom coder
model: claude-sonnet-4
tools: read, bash, edit, write
skills: tdd, my-custom-skill
---

You are {{name}}, a {{type}} agent. ...
```

User and project definitions override the package defaults.

## Installation

```bash
# From git
pi install git:github.com/yourname/pi-agent-orchestrator

# From local path (for development)
pi install /path/to/pi-agent-orchestrator
```

### Development

```bash
# Install dependencies (for tests)
bun install

# Run typecheck, build, and tests
bun run check

# Or run unit tests only
bun test

# Test inside a git repo (not ~/.pi/)
cd ~/my-project
pi
/reload
/spawn lead self coder
```

## Requirements

- **Linux** (or WSL2) — `bwrap` (bubblewrap) is required for agent sandboxing
- **Git repo** — spawn commands must be run inside a git repository
- **Bun** — used by Pi for TypeScript execution; tests run with `bun:test`

## Why bwrap, not Docker?

We evaluated Docker sandboxes but stuck with `bwrap` because:
- Single static binary, no daemon, no root required
- No image builds or volume mount complexity
- Already working and tested end-to-end
- Users don't need a Docker subscription or `sbx` CLI

The whole Pi session can still be wrapped in a container if you prefer — the extension itself is container-agnostic.

## License

MIT
