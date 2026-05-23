# Pi Lattice

Multi-agent orchestration extension for [Pi](https://pi.dev).

> **Status:** this package is in heavy development and is not recommended for general use yet. APIs, dashboard flows, and storage conventions are still changing quickly.

`pi-lattice` lets an interactive Pi session become an explicit **orchestrator**. When you enable orchestration mode, Pi gets tools for creating isolated sub-agents, delegating work to them, inspecting progress, and managing the whole team from a browser dashboard.

## Core ideas

### Explicit orchestration mode

Orchestration is opt-in. Use `/orchestrate` to activate a root profile and `/orchestrate off` to return to normal single-agent Pi behavior. The package always ships a built-in `default` root profile; if additional profiles exist and no profile name is provided, `/orchestrate` asks which profile to activate.

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

Definitions can reference direct skills, skill templates, and extension templates. New and edited definitions should generally live in a **Lattice Library** rather than in this package.

### Lattice Libraries are the primary resource model

A Lattice Library is a user- or team-owned folder that contains version-controlled orchestration resources:

- root profiles for `/orchestrate`
- agent definitions
- skill templates
- extension templates
- curated skills
- curated extensions

Libraries are configured through `piLattice.libraries` in Pi settings and discovered by the dashboard. Legacy `piLattice.libraries` settings are still read for compatibility. Libraries are the preferred place to create and share orchestrator-managed resources.

A starter library contains a `lattice-library.json` manifest like:

```json
{
  "schema": "pi-lattice-library/v1",
  "name": "team-ai",
  "description": "Team orchestration resources",
  "resources": {
    "agents": "agents",
    "orchestratorProfiles": "orchestrator-profiles",
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

Native Pi skill/extension source paths still exist as an advanced escape hatch, but the dashboard intentionally de-emphasizes them in favor of Lattice Libraries.

### Root profiles

Root profiles are markdown files that configure the interactive `/orchestrate` session. A profile can provide root-only instructions plus direct skills or skill templates. Profiles do not load arbitrary extensions into the root Pi shell.

```markdown
---
name: planning
description: Planning-heavy root profile
skillTemplates: root-planning
---

Clarify goals, decompose work, and coordinate spawned agents deliberately.
```

`/orchestrate planning` activates a named profile. Plain `/orchestrate` activates the only available profile automatically, or asks the user to select when multiple profiles exist.

### Skills and templates

Skills are Pi instruction bundles. The Skill Library dashboard can browse discovered skills, preview markdown, inspect metadata, edit editable skills, copy package/global skills into an editable scope, and show when a skill came from an installed package.

Skill templates and extension templates are reusable bundles assigned to agent types. Templates separate eligibility from automatic application:

- `audience: spawned | orchestrator | all` controls where a skill template may be used.
- `autoApply: none | spawned | all` controls whether a skill template is manual-only, added to every spawned child agent, or added everywhere including the root orchestrator.
- Extension templates are spawned-agent capabilities only; they support `autoApply: none | spawned` and cannot target the root orchestrator.

When a new agent is spawned, the orchestrator resolves direct `skills:`, selected `skillTemplates:`, all-spawned skill templates, directly requested extensions, selected `extensionTemplates:`, and all-spawned extension templates. Existing running agents are unchanged when templates are edited; template resolution applies to newly spawned agents.

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
- list, preview, copy, create, edit, and delete Root Profiles where allowed
- browse Lattice Libraries and package example visibility
- bootstrap/register Lattice Libraries from an explicit path
- browse, preview, edit, copy, create, and delete skills where allowed
- label package-provided skills separately from project/global/library skills
- create/edit/delete skill and extension templates
- assign templates from the Agent Type editor
- discover extensions from native paths, packages, and Lattice Libraries
- smoke-test extension templates and inspect runtime tool diagnostics
- access native Pi skill/extension paths only as an advanced settings escape hatch

The dashboard is a static React + TypeScript + Tailwind bundle served by the extension HTTP server; no runtime dashboard dev server is required.

## Terminal commands

```text
/orchestrate [profile|off|status]             Enable orchestration mode with a root profile
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

For reproducible local development, prefer the checked-in Docker/devcontainer baseline. It keeps Pi config/cache/auth in a named Docker volume and treats container paths as runtime truth for spawned agents and Lattice Libraries. See [Containerized orchestration runtime](docs/container-runtime.md).

### Devcontainer: work on this package live

Open this repository in a devcontainer-compatible editor and choose **Reopen in Container**. The devcontainer runs `.devcontainer/dev-setup.sh`, which:

1. runs `bun install` in this checkout,
2. builds the dashboard assets with `bun run build`, and
3. registers this checkout as the Pi package with `pi install /workspaces/pi-lattice`.

That final command is a local-path package install. Pi loads the orchestrator extension, skills, and bundled package resources from the mounted checkout, not from a copied npm cache. As you edit files in the repo, you are editing the installed package. Use `/reload` or restart Pi after extension/package manifest changes; run `bun run build` after dashboard changes.

After the devcontainer finishes setup:

```bash
pi
```

Then inside Pi:

```text
/orchestrate
/dashboard
```

The dashboard is forwarded on port `18765`.

The devcontainer also initializes and forwards a WSL-side SSH agent through a
stable socket so Git SSH access works inside the container. Unencrypted default
keys are added automatically; passphrase-protected keys need to be added once
from WSL. See [Containerized orchestration runtime](docs/container-runtime.md)
for the exact socket path and verification command.

### Package install: use the published/bundled package

For normal use outside this repository, install the package source directly:

```bash
# From npm, once published
pi install npm:pi-lattice

# From git
pi install git:github.com/NicoPowers/pi-lattice

# From a local checkout
pi install /path/to/pi-lattice
```

The package manifest exposes Pi Lattice plus the Pi helper packages this repo currently uses: `@os-eco/mulch-cli`, `@os-eco/seeds-cli`, `context-mode`, `pi-lens`, and `pi-web-access`. Those packages are listed in `dependencies` and `bundledDependencies`, and their Pi extensions/skills are surfaced through this package's `pi` manifest so users do not need to install them one by one.

### Validation

```bash
bun run check
```

`bun run check` runs TypeScript checking, builds the dashboard bundle, and runs the test suite.

## Requirements

- **Docker or a devcontainer-compatible environment** — recommended for the containerized orchestration runtime
- **Git repository** — root spawned agents get isolated git worktrees
- **Bun** — used for development, tests, and dashboard builds

## Containerized runtime direction

The project is moving to a simpler trusted-local model: run Pi inside one Docker/devcontainer environment, then launch spawned agents as normal child Pi RPC processes inside that same container. The container is the outer reproducible boundary; per-agent isolation should come from git worktrees and role-specific tool allowlists, not nested containers or bwrap sandboxes.

## License

MIT
