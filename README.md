# pi-agent-orchestrator

Multi-agent orchestration extension for [Pi](https://pi.dev).

> **Status:** this package is in heavy development and is not recommended for general use yet. APIs, dashboard flows, and storage conventions are still changing quickly.

`pi-agent-orchestrator` lets an interactive Pi session become an explicit **orchestrator**. When you enable orchestration mode, Pi gets tools for creating isolated sub-agents, delegating work to them, inspecting progress, and managing the whole team from a browser dashboard.

## Core ideas

### Explicit orchestration mode

Orchestration is opt-in. Use `/orchestrate` to enable the orchestrator toolset and `/orchestrate off` to return to normal single-agent Pi behavior.

The dashboard does not replace the Pi terminal. The terminal stays vanilla Pi; the browser dashboard is a companion view for agents, libraries, skills, templates, logs, and diagnostics.

### Agent types are user-defined

Agent types are markdown definitions with YAML frontmatter plus prompt instructions. Package examples exist to demonstrate the shape, but users can create and edit as many agent types as they want.

Example:

```markdown
---
name: frontend-implementer
description: Implements focused frontend changes with tests
model: kimi-k2.6
tools: read, bash, edit, write, grep, find, ls
skillTemplates: common, frontend
extensionTemplates: browser-tools
---

You are {{name}}, a focused frontend implementation agent.

Make small, tested, reviewable changes. Ask for clarification when requirements are ambiguous.
```

Definitions can reference direct skills, skill templates, and extension templates. New and edited definitions should generally live in an **Orchestrator Library** rather than in this package.

### Orchestrator Libraries are the primary resource model

An Orchestrator Library is a user- or team-owned folder that contains version-controlled orchestration resources:

- agent definitions
- skill templates
- extension templates
- curated skills
- curated extensions

Libraries are configured through `piAgentOrchestrator.libraries` in Pi settings and discovered by the dashboard. They are the preferred place to create and share orchestrator-managed resources.

A starter library contains an `orchestrator-library.json` manifest like:

```json
{
  "schema": "pi-orchestrator-library/v1",
  "name": "team-ai",
  "description": "Team orchestration resources",
  "resources": {
    "agents": "agents",
    "skillTemplates": "skill-templates",
    "extensionTemplates": "extension-templates",
    "skills": "skills",
    "extensions": "extensions"
  }
}
```

Resource references use the library namespace, for example:

```text
team-ai:skills/example-analysis/SKILL.md
team-ai:extensions/browser-tools
```

Native Pi skill/extension source paths still exist as an advanced escape hatch, but the dashboard intentionally de-emphasizes them in favor of Orchestrator Libraries.

### Skills and templates

Skills are Pi instruction bundles. The Skill Library dashboard can browse discovered skills, preview markdown, inspect metadata, edit editable skills, copy package/global skills into an editable scope, and show when a skill came from an installed package.

Skill templates and extension templates are reusable bundles assigned to agent types. When a new agent is spawned, the orchestrator resolves:

- direct `skills:` from the agent definition
- selected `skillTemplates:`
- `applyToAll` skill templates
- directly requested extensions
- selected `extensionTemplates:`
- `applyToAll` extension templates

Existing running agents are unchanged when templates are edited; template resolution applies to newly spawned agents.

Extensions can optionally advertise static metadata without executing code:

```ts
// pi-orchestrator: { "description": "Browser helpers", "expectedTools": ["open_page", "click"] }
```

The dashboard can also smoke-test extension templates by spawning a temporary agent, reading its runtime tool snapshot, and reporting missing extensions or tool diagnostics.

## Dashboard

When Pi starts, the extension prints a URL like:

```text
🌐 Dashboard: http://localhost:18765
```

The dashboard can currently:

- view active agents and streamed assistant output
- send messages, steering instructions, and kill requests
- inspect recent agent lifecycle/tool events
- monitor hierarchy, worktrees, context/token usage, and cost stats
- emergency-stop all spawned agents
- create/edit agent type definitions
- browse Orchestrator Libraries and package example visibility
- bootstrap/register Orchestrator Libraries from an explicit path
- browse, preview, edit, copy, create, and delete skills where allowed
- label package-provided skills separately from project/global/library skills
- create/edit/delete skill and extension templates
- assign templates from the Agent Type editor
- discover extensions from native paths, packages, and Orchestrator Libraries
- smoke-test extension templates and inspect runtime tool diagnostics
- access native Pi skill/extension paths only as an advanced settings escape hatch

The dashboard is a static React + TypeScript + Tailwind bundle served by the extension HTTP server; no runtime dashboard dev server is required.

## Terminal commands

```text
/orchestrate [on|off|status]                  Enable/disable orchestration mode
/agent-types                                  List available agent definitions
/spawn <name> <parent|'self'> [type|model]    Spawn a named agent instance
/ask <name> <message>                         Send a message and show reply
/agents                                       List active agents
/worktrees                                    List active agent worktrees and VS Code commands
/kill <name|all>                              Terminate one agent or all agents
/dashboard                                    Print dashboard URL and open browser
/logs [lines=20]                              Show recent multi-agent logs
```

## Tools available to the orchestrator

Agent orchestration:

```text
agent_types()
agent_spawn(name, parent, type?, model?, extensions?)
create_sub_agent(name, type, reason, model?)
agent_send(name, message, timeout_seconds?)
agent_steer(name, message)
agent_status(name?)
agent_kill(name)
```

Skill management:

```text
skill_list(scope?, editableOnly?, search?)
skill_read(id?, name?)
skill_create(scope?, name, description, body?)
skill_update(id, content, expectedHash?)
```

Advanced native Pi resource settings:

```text
resource_settings_read()
resource_settings_update(scope, skills?, extensions?)
```

`create_sub_agent` is the main orchestration-mode tool. It requires a reason so the root orchestrator remains explicit about why a specialist is being created.

## Development install

This project is currently intended for development and experimentation.

```bash
# From git
pi install git:github.com/NicoPowers/pi-agent-orchestrator

# From local path
pi install /path/to/pi-agent-orchestrator
```

Typical development loop:

```bash
bun install
bun run check

# From a separate git repo where you want to test orchestration:
pi
/reload
/orchestrate
/dashboard
```

`bun run check` runs TypeScript checking, builds the dashboard bundle, and runs the test suite.

## Requirements

- **Linux or WSL2** — `bwrap`/bubblewrap is required for spawned-agent sandboxing
- **Git repository** — root spawned agents get isolated git worktrees
- **Bun** — used for development, tests, and dashboard builds

## Why bwrap, not Docker?

Spawned agents use `bwrap` because it provides lightweight process/filesystem isolation without a daemon, image build, or Docker-specific workflow. The whole Pi session can still run inside a container if you prefer; the extension itself is container-agnostic.

## License

MIT
