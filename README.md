# pi-agent-orchestrator

Multi-agent orchestration extension for [Pi](https://pi.dev). Spawn specialized sub-agents with isolated context windows, custom prompts, and targeted skills.

## Features

- **Typed agent definitions** via YAML frontmatter markdown files
- **Isolated context windows** — each agent runs in its own `pi --mode rpc` process
- **Skill scoping** — agents load only the skills they need
- **Themed TUI panel** — live LED status and spinner below the editor
- **Agent relay** — broker LLM routes messages between agents

## Agent Types

| Agent | Purpose | Tools | Skills |
|-------|---------|-------|--------|
| `coder` | Write and edit code | read, bash, edit, write, grep, find, ls | tdd |
| `reviewer` | Review code for bugs/security | read, grep, find, ls | security-checklist |

## Usage

### Commands

```
/spawn <name> [type|model]    Spawn a named agent instance
/ask <name> <message>         Send a message and show reply
/agents                        List active agents
/kill <name>                   Terminate an agent
/agent-types                   List available definitions
```

### Tools (broker LLM)

```
agent_spawn(name="my_coder", type="coder")
agent_send(name="my_coder", message="Write a hello function")
agent_status(name="my_coder")
agent_kill(name="my_coder")
```

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

## Project Structure

```
pi-agent-orchestrator/
├── package.json          # Pi manifest
├── extensions/
│   └── multi-agent.ts    # Extension entry point
├── skills/
│   ├── tdd/SKILL.md
│   └── security-checklist/SKILL.md
└── agents/
    ├── coder.md
    └── reviewer.md
```

## License

MIT
