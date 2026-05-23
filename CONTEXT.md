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

**Root Orchestrator Profile**:
A root-only markdown profile that configures the interactive `/orchestrate` session.
_Avoid_: Agent type, spawnable orchestrator

**Skill Library**:
The dashboard inventory for discovered skills and skill copy/edit workflows.
_Avoid_: Capability assignment UI

**Template**:
A reusable capability bundle that can reference skills or extensions for eligible agents or orchestrator sessions.
_Avoid_: Prompt template when referring to skill/extension templates

**Lattice Library**:
A user- or team-owned resource repository with an `lattice-library.json` manifest and namespaced orchestrator resources.
_Avoid_: Package resources, native Pi resource path

**Native Pi Resource Settings**:
The advanced raw Pi skill and extension path settings shown as an escape hatch inside Lattice Library management.
_Avoid_: Lattice Library resources

## Relationships

- The **Dashboard Shell** renders feature areas such as **Live Agents**, **Agent Types**, **Skill Library**, **Templates**, and **Lattice Libraries**.
- An **Lattice Library** can contain **Agent Types**, **Root Orchestrator Profiles**, **Templates**, skills, and extensions.
- **Native Pi Resource Settings** are visually managed inside **Lattice Libraries** but are not themselves **Lattice Library** resources.
- A **Root Orchestrator Profile** is not an **Agent Type** and must not be spawned as a **Live Agent**.
- A **Lead Agent** creates or curates **Issue Handoff Artifacts** for an issue, while the root orchestrator remains responsible for lifecycle oversight and final durable metadata promotion.

## Example dialogue

> **Dev:** "Should the **Skill Library** copy dialog let me target my team folder?"
> **Domain expert:** "Yes, if that folder is a configured **Lattice Library**; show it by manifest name and path so users know which resource repository will own the copied skill."

## Flagged ambiguities

- "Profile" has been used for both **Agent Type** and **Root Orchestrator Profile**; resolved: only root `/orchestrate` configuration is a **Root Orchestrator Profile**, while spawnable markdown definitions are **Agent Types**.
- "Resource settings" can mean **Lattice Library** manifest resources or **Native Pi Resource Settings**; resolved: native settings are an advanced escape hatch nested under library management but remain a separate concept.
