# Pi Lattice

Pi Lattice helps a root Pi session coordinate spawned agents and user-owned orchestration resources through an explicit dashboard-backed workflow.

## Language

**Dashboard Shell**:
The browser UI frame that owns navigation, global session state, and cross-feature refresh wiring.
_Avoid_: Main app blob, UI root logic

**Live Agent**:
A currently running spawned Pi RPC agent tracked by the orchestrator session.
_Avoid_: Worker, child process when referring to the domain concept

**Agent Type**:
A spawnable markdown definition that describes how to launch a specialized agent.
_Avoid_: Agent profile, bot template

**Lead Agent**:
A spawned agent responsible for coordinating the work for a specific issue or task, including gathering context, requesting specialist help, preparing implementation handoffs, and synthesizing the result.
_Avoid_: Root orchestrator, lifecycle manager

**Issue Handoff Artifact**:
An operational context bundle created during issue execution so one agent can continue from another agent's findings, plan, or completion state.
_Avoid_: Durable project knowledge, tracker update

**Root Profile**:
A root-only markdown profile that configures the interactive `/orchestrate` session.
_Avoid_: Root Orchestrator Profile in user-facing copy, Agent Type, spawnable orchestrator

**Skill Library**:
The dashboard inventory for discovered skills and skill copy/edit workflows.
_Avoid_: Capability assignment UI

**Template**:
A reusable capability bundle that can reference skills or extensions for eligible agents or orchestrator sessions.
_Avoid_: Prompt template when referring to skill/extension templates

**Lattice Library**:
A user- or team-owned resource repository with a `lattice-library.json` manifest and namespaced orchestration resources.
_Avoid_: Orchestrator Library in user-facing copy, Lattice Library library, package resources, native Pi resource path

**Native Pi Resource Settings**:
The advanced raw Pi skill and extension path settings shown as an escape hatch inside Lattice Library management.
_Avoid_: Lattice Library resources

## Relationships

- The **Dashboard Shell** renders feature areas such as **Live Agents**, **Agent Types**, **Skill Library**, **Templates**, and **Lattice Libraries**.
- A **Lattice Library** can contain **Agent Types**, **Root Profiles**, **Templates**, skills, and extensions.
- **Native Pi Resource Settings** are visually managed inside **Lattice Libraries** but are not themselves **Lattice Library** resources.
- A **Root Profile** is not an **Agent Type** and must not be spawned as a **Live Agent**.
- A **Lead Agent** creates or curates **Issue Handoff Artifacts** for an issue, while the root orchestrator remains responsible for lifecycle oversight and final durable metadata promotion.

## Example dialogue

> **Dev:** "Should the **Skill Library** copy dialog let me target my team folder?"
> **Domain expert:** "Yes, if that folder is a configured **Lattice Library**; show it by manifest name and path so users know which resource repository will own the copied skill."

## Rename map

- Product/app/package: **Pi Lattice** / `pi-lattice`; avoid Pi Agent Orchestrator except legacy compatibility notes.
- User-owned resource repo: **Lattice Library**; avoid Orchestrator Library in user-facing copy. Legacy `orchestrator-library.json`, `pi-orchestrator-library/v1`, and `piAgentOrchestrator` remain accepted for compatibility only.
- Runtime role: **root orchestrator** remains valid descriptive role language for the interactive Pi session coordinating agents.
- Root `/orchestrate` configuration: **Root Profile** in dashboard/docs; internal APIs/types may keep `RootOrchestratorProfile` while compatibility work is active.
- Profile storage: keep `orchestratorProfiles` manifest key and `orchestrator-profiles/` directory for now as stable on-disk compatibility paths; user-facing copy should say Root Profiles.
- Protocol work: **Orchestration Protocol** remains valid for packet-gated handoff protocol, not product branding.

## Flagged ambiguities

- "Profile" has been used for both **Agent Type** and **Root Profile**; resolved: only root `/orchestrate` configuration is a **Root Profile**, while spawnable markdown definitions are **Agent Types**.
- "Resource settings" can mean **Lattice Library** manifest resources or **Native Pi Resource Settings**; resolved: native settings are an advanced escape hatch nested under library management but remain a separate concept.
