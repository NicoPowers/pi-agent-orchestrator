# pi-agent-orchestrator

Multi-agent orchestration extension for [Pi](https://pi.dev). Spawn specialized sub-agents with isolated context windows, custom prompts, and targeted skills. Manage your agent fleet from the terminal **or** a real-time web dashboard — no TUI modifications required.

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
├── web/
│   └── index.html                  # Dashboard UI (vanilla JS, no build step)
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

### Web Dashboard

When Pi starts, the extension prints a URL like:

```
🌐 Dashboard: http://localhost:18765
```

Open it in any browser. You can:
- **Spawn** agents with name, parent, type, and model override
- **View** live terminal output per agent (streamed via SSE)
- **Send** messages to any agent
- **Kill** agents and their children
- **Watch** the global event log (spawns, kills, delegations)

Dashboard actions are bidirectionally synced with the terminal — spawn an agent from the web UI and the orchestrator LLM receives a steer message so it knows the fleet changed.

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

# Run unit tests
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
