# pi-agent-orchestrator — Roadmap

## Current Direction

Phases 1–6 are complete. The dashboard now has React/Tailwind UI, agent type editing, skill/extension templates, runtime tool reporting, and validated template/type forms.

The next major direction is a first-class **Skill Library**: a dashboard and agent-tool workflow for discovering, previewing, creating, and editing Pi skills across project, global, and package sources.

## Current Working Architecture

- Pi starts in normal mode.
- `/orchestrate` explicitly enables orchestration mode.
- Only when orchestration mode is enabled can the root Pi session create sub-agents through `create_sub_agent`.
- Agents run as `pi --mode rpc --no-session` inside `bwrap` sandboxes.
- Root agents get ephemeral `/tmp/pi-worktree-*` git worktrees.
- Child agents share the parent/root worktree.
- Dashboard uses REST + SSE; no WebSockets.
- Dashboard is served as static assets from `web/` by the multi-agent extension HTTP server.
- Skills are currently discovered through Pi's `DefaultResourceLoader` via `GET /api/skills`.

## Skill Library Design Principles

- Treat skills as first-class resources, not just names in templates.
- Prefer directory skills with `SKILL.md` over root `.md` skills for newly created skills.
- Support progressive disclosure:
  - discovery list shows name/description/source
  - `SKILL.md` acts as the index/workflow
  - related markdown, scripts, references, and assets live beside it
- Package skills are preview/read-only by default.
- Project/global skills may be editable only when they are inside approved skill roots.
- Never let dashboard endpoints become arbitrary file read/write APIs.
- Use path-derived opaque IDs for skills; do not rely on skill names as unique identifiers.
- Markdown preview must not execute or render unsafe HTML.
- Editing should use hash/mtime guards to prevent silent overwrite.
- Global skill edits must be visually called out because they affect every project.
- In user-facing UI/tool output, `global` means Pi's user/global skills directory (`~/.pi/agent/skills`) shared across repos. Pi resource metadata may call this scope `user`; display it as `global` for clarity.

## Pi Skill Rules To Respect

From Pi docs:

- Skills can be:
  - directory skills: `some-skill/SKILL.md`
  - direct root `.md` files in selected locations
- Skill locations include:
  - global `~/.pi/agent/skills/`
  - global `~/.agents/skills/`
  - project `.pi/skills/`
  - project/ancestor `.agents/skills/`
  - packages via `skills/` or `pi.skills`
  - settings and CLI-provided paths
- `SKILL.md` frontmatter requires:
  - `name`
  - `description`
- Skill names should be lowercase letters, numbers, hyphens only, max 64 chars, no leading/trailing hyphen, no consecutive hyphens.
- Skills may reference co-located files via relative paths from the skill directory:
  - `references/api.md`
  - `scripts/process.sh`
  - `assets/template.json`
- Skills may include executable scripts; the model may invoke them through normal tools such as `bash`, so skill content should be reviewed before use.

---

# Phase 7A — Read-only Skill Library

**Status:** Implemented.

## Goal

Add a dashboard tab for browsing all discovered skills and previewing each skill's `SKILL.md` content without allowing edits yet.

## Tracer Bullet Issues

### Issue 7A.1: Enhance skill discovery metadata

**Goal**: Return enough data from `/api/skills` to drive a real library UI.

**What to do:**
- Update `extensions/multi-agent/skill-discovery.ts` to include:
  - opaque `id` derived from canonical `filePath`
  - `name`
  - `description`
  - `filePath`
  - `baseDir`
  - `source`
  - `scope`
  - `kind`: `directory` or `file`
  - `editable`: initially computed but not used for writes yet
- Preserve existing fields used by template editor.
- Sort by name, then scope/source.

**Validation:**
- Existing skill template editor still lists discovered skills.
- `GET /api/skills` returns valid JSON when no skills exist.
- Project, global, and package skills are distinguishable in the response.

### Issue 7A.2: Add skill content endpoint

**Goal**: Load a selected skill's `SKILL.md` for preview.

**What to do:**
- Add `GET /api/skills/:id`.
- Resolve `id` only against discovered skills from the current repo cwd.
- Return:
  - skill metadata
  - raw markdown content
  - parsed frontmatter if easy/reliable
  - body if easy/reliable
  - `mtimeMs`
  - content hash
- Reject unknown IDs with 404.
- Do not accept arbitrary paths from clients.

**Validation:**
- Can fetch a discovered skill by ID.
- Cannot fetch a non-discovered local file by path.
- Package skill content can be previewed.

### Issue 7A.3: Add dashboard Skill Library tab

**Goal**: Create a read-only UI for discovered skills.

**What to do:**
- Add `Skill Library` tab in `web/app.tsx`.
- Add searchable/filterable skill list.
- Group or badge skills by source/scope:
  - project
  - global
  - package
  - settings/other
- Show empty state when no skills exist.
- Show selected skill details and path.

**Validation:**
- Dashboard loads without runtime errors.
- Skill list remains usable with many skills.
- Existing tabs still work.

### Issue 7A.4: Markdown preview for SKILL.md

**Goal**: Render selected skill markdown safely.

**What to do:**
- Add markdown preview dependency, likely `react-markdown` + `remark-gfm`.
- Render raw markdown in a styled preview panel.
- Do not enable unsafe HTML execution/rendering.
- Preserve code blocks and tables.
- Include a fallback raw-text view if preview rendering fails.

**Validation:**
- `SKILL.md` headings, lists, code blocks, and tables render well.
- Embedded HTML does not execute scripts.
- `bun run check` passes.

---

# Phase 7A.5 — Dashboard App Shell and Skill Library Layout Refresh

**Status:** Implemented.

## Goal

Refactor the dashboard layout so primary navigation lives in the header, tab/page content can use the full viewport, and the Skill Library has enough horizontal and vertical space for markdown preview. This should happen before Phase 7B so all future skill editing work builds on the right shell.

## Layout Direction

- Treat top-level sections as pages in an app shell, not as tabs inside a centered content card.
- Move primary navigation into the sticky header next to `Pi Orchestrator`.
- Let `<main>` use the available viewport width/height.
- Each page chooses its own layout:
  - Live Agents: full-width card/grid page.
  - Agent Types: full-width now, possible master/detail later.
  - Skill Library: persistent left browser + large right detail panel.
  - Templates: full-width now, possible master/detail later.
  - Hierarchy: full-width tree now, possible split detail later.
  - Event Log: full-width log viewer.
- Avoid forcing every page into a side nav. Use side panels only where the page naturally needs master/detail navigation.

## Tracer Bullet Issues

### Issue 7A.5.1: Move primary navigation into the header

**Goal**: Free vertical space and make the dashboard feel like an app shell.

**What to do:**
- Remove the top-level `TabsList` from inside `<main>`.
- Render primary section buttons/links in the header next to the dashboard title.
- Preserve existing active tab state and labels.
- Keep connection status and Emergency Stop on the right side.
- Make the header responsive:
  - wraps or scrolls horizontally on narrow widths
  - does not hide Emergency Stop

**Validation:**
- All existing sections are reachable from the header.
- Active section is visually obvious.
- Dashboard still works on narrower windows.
- Smoke test still passes.

### Issue 7A.5.2: Expand main content to use the viewport

**Goal**: Stop constraining page content to a centered, cramped max-width container.

**What to do:**
- Replace the centered `max-w-screen-2xl` tab container with a full-width app content area.
- Use a height model that lets pages fill available space below the sticky header.
- Keep reasonable padding/gutters.
- Avoid nested scroll traps where possible; page-specific panels can scroll internally when useful.

**Validation:**
- Skill Library preview has substantially more room.
- Live Agents grid can use wide screens.
- Event Log and Hierarchy remain readable.
- No horizontal body overflow at common desktop sizes.

### Issue 7A.5.3: Convert Skill Library to master/detail page layout

**Goal**: Make the skill browser and preview area feel purpose-built instead of squeezed into generic cards.

**What to do:**
- Use a two-pane layout:
  - left pane: search, source filter, skill list
  - right pane: selected skill detail
- Keep the left pane at a stable width, around 320–420px.
- Let the right pane fill remaining space.
- Let both panes use most of the viewport height.
- Keep selected skill state and API loading behavior.

**Validation:**
- Selecting skills remains fast and obvious.
- Skill list can scroll independently.
- Detail panel has enough room for long markdown documents.

### Issue 7A.5.4: Make preview the primary Skill Library detail view

**Goal**: Avoid splitting read-only mode into two cramped columns.

**What to do:**
- In read-only Skill Library mode, show rendered markdown preview as the default full-width detail content.
- Move raw markdown behind a lightweight view toggle, such as:
  - `Preview`
  - `Raw`
  - `Metadata`
- Keep raw markdown available for inspection.
- Keep metadata/path/source badges visible above the content.

**Validation:**
- Long `SKILL.md` files are comfortable to read.
- Raw markdown remains accessible.
- Markdown tables/code blocks remain readable.

### Issue 7A.5.5: Preserve current page behavior during shell refactor

**Goal**: Avoid regressing non-skill pages while changing the app frame.

**What to do:**
- Keep existing Live Agents, Agent Types, Templates, Hierarchy, and Event Log behavior unchanged except for available space.
- Do not add new backend APIs in this phase.
- Do not start Phase 7B editing behavior yet.
- Keep existing dialog behavior for type/template editing.

**Validation:**
- Agent cards still send/inspect/kill.
- Agent type dialog still opens/saves.
- Skill/extension template dialogs still open/save/delete.
- Hierarchy and log still render.
- `bun run check` passes.

---

# Phase 7B — Create and Edit SKILL.md Files

**Status:** Implemented.

## Goal

Allow users to create and edit project/global skills safely from the dashboard, limited to approved skill roots and only editing the main `SKILL.md` file for now.

## Tracer Bullet Issues

### Issue 7B.1: Editable-root classification

**Goal**: Decide which skills can be edited.

**What to do:**
- Classify skills as editable only if their `filePath` is under:
  - project `.pi/skills/`
  - project `.agents/skills/` if discovered for current repo
  - global `~/.pi/agent/skills/`
  - global `~/.agents/skills/`
- Mark package, settings-external, and CLI-provided skills read-only unless they fall under approved roots.
- Use canonical resolved paths to prevent symlink/path traversal surprises.

**Validation:**
- Package skills display read-only.
- Project `.pi/skills/*/SKILL.md` displays editable.
- Global skills display editable with a warning badge.

### Issue 7B.2: Create skill endpoint

**Goal**: Create a new directory-style skill scaffold.

**What to do:**
- Add `POST /api/skills`.
- Payload:
  - `scope`: `project` or `global`
  - `name`
  - `description`
  - optional initial markdown body
- Normalize/validate skill name according to Pi skill rules.
- Create directory:
  - project: `.pi/skills/<name>/SKILL.md`
  - global: `~/.pi/agent/skills/<name>/SKILL.md`
- Default generated file:
  - frontmatter with name/description
  - heading
  - usage section
  - references section placeholder
- Refuse overwrite unless explicitly supported later.

**Validation:**
- Creating `my skill` previews/saves as `my-skill`.
- Missing name/description returns 400.
- Duplicate skill path returns conflict.
- Newly created skill appears after refresh.

### Issue 7B.3: Save SKILL.md endpoint

**Goal**: Save edits to existing editable `SKILL.md` files safely.

**What to do:**
- Add `PUT /api/skills/:id`.
- Payload:
  - `content`
  - `expectedHash` or `expectedMtimeMs`
- Resolve ID through discovery; reject non-editable skills.
- Validate frontmatter still has valid `name` and `description`.
- Reject stale writes when hash/mtime does not match.
- Return updated metadata/hash.

**Validation:**
- Editing project skill persists to disk.
- Editing package skill returns 403.
- Concurrent/stale edit returns 409.
- Invalid frontmatter returns 400 with useful error.

### Issue 7B.4: Dashboard editor with live preview

**Goal**: Let users edit `SKILL.md` with preview beside it.

**What to do:**
- Add edit mode for editable skills.
- Layout:
  - left: markdown textarea/editor
  - right: preview
- Show required frontmatter guidance.
- Disable save when content is invalid.
- Show unsaved changes indicator.
- Warn for global skill edits.

**Validation:**
- User can edit project/global skill and save.
- User sees server validation errors inline.
- User cannot edit read-only/package skill.
- Preview updates as markdown changes.

---

# Phase 7C — Agent Skill Management Tools

**Status:** Implemented.

## Goal

Let the root Pi agent bootstrap and maintain skills through extension tools, so the interactive shell can help users create/edit skills instead of requiring manual dashboard edits.

## Tracer Bullet Issues

### Issue 7C.1: `skill_list` tool

**Goal**: Expose discovered skills to the agent.

**What to do:**
- Register `skill_list` in `extensions/multi-agent/index.ts`.
- Return discovered skills with:
  - id
  - name
  - description
  - scope/source
  - editable
  - file path summary
- Support optional filters:
  - `scope`
  - `editableOnly`
  - search text

**Validation:**
- Agent can list skills in current project.
- Tool output is concise but includes details payload.

### Issue 7C.2: `skill_read` tool

**Goal**: Let the agent inspect full skill content.

**What to do:**
- Register `skill_read`.
- Accept `id` or exact `name` when unambiguous.
- Return `SKILL.md` content and metadata.
- If name is ambiguous, return candidates and ask for ID.

**Validation:**
- Agent can read project/global/package skills.
- Ambiguous names are handled safely.

### Issue 7C.3: `skill_create` tool

**Goal**: Let the agent create project/global skills.

**What to do:**
- Register `skill_create`.
- Accept:
  - scope
  - name
  - description
  - optional markdown body
- Reuse the same backend helpers as dashboard API.
- Prefer project scope by default unless user asks global.

**Validation:**
- Agent can create a project skill scaffold.
- Tool refuses invalid names/descriptions.
- Created skill appears in dashboard.

### Issue 7C.4: `skill_update` tool

**Goal**: Let the agent update editable skills safely.

**What to do:**
- Register `skill_update`.
- Require:
  - id
  - full replacement content
  - expected hash from `skill_read`
- Reject package/read-only skills.
- Validate frontmatter.

**Validation:**
- Agent can update a project skill after reading it.
- Stale hash returns a useful error.
- Package skill update is rejected.

---

# Phase 7D — Skill Library UX Integrations

**Status:** Implemented.

## Goal

Connect the Skill Library to templates and discovery diagnostics so it becomes useful in everyday orchestration workflows.

## Tracer Bullet Issues

### Issue 7D.1: Add skill to template shortcut

**Status:** Implemented.

**Goal**: Let users add a skill directly to a skill template from the library.

**What to do:**
- On skill detail panel, add `Add to Template` action.
- Let user choose existing skill template or create a new one.
- Save through existing skill template APIs.
- Preserve de-duplication.

**Validation:**
- Skill can be added to existing template.
- Duplicate addition does not duplicate item.
- Template editor reflects change after refresh.

### Issue 7D.2: Show templates using this skill

**Status:** Implemented.

**Goal**: Make relationships visible.

**What to do:**
- In skill detail view, show skill templates that include the selected skill name.
- Link/open template editor from this list.

**Validation:**
- A skill included in multiple templates shows all matches.
- Empty state is clear.

### Issue 7D.3: Surface Pi skill diagnostics

**Status:** Implemented.

**Goal**: Show validation/discovery warnings from Pi's loader.

**What to do:**
- Include skill diagnostics in `/api/skills` response or a sibling endpoint.
- Show warnings in Skill Library.
- Attach path/name-specific diagnostics to skill rows when possible.

**Validation:**
- Invalid skill names/descriptions show warnings.
- Missing description skills are discoverable as diagnostics even if not loaded.

### Issue 7D.4: Improve search/filter ergonomics

**Status:** Implemented.

**Goal**: Make the library scale to many skills.

**What to do:**
- Search by name, description, path, source.
- Filters:
  - source/scope
  - editable/read-only
  - referenced by template / unreferenced
- Optional sorting:
  - name
  - source
  - recently modified

**Validation:**
- Search/filter state is predictable.
- Large lists remain responsive.

---

# Phase 7E — Directory Skill File Tree and Linked Markdown

**Status:** Implemented.

## Goal

Support rich directory skills where `SKILL.md` references co-located markdown, scripts, assets, and examples. This phase happens after 7D.

## Tracer Bullet Issues

### Issue 7E.1: Skill directory tree endpoint

**Status:** Implemented.

**Goal**: Browse files inside a directory-style skill.

**What to do:**
- Add `GET /api/skills/:id/tree`.
- Only expose files under the skill `baseDir`.
- Return relative paths, file types, sizes, and editability.
- Exclude dangerous/noisy directories by default:
  - `.git`
  - `node_modules`
  - large binary blobs
- Include limits for max files and max file size.

**Validation:**
- Directory skill shows `SKILL.md`, `references/*`, `scripts/*`, `assets/*`.
- Path traversal attempts fail.
- Huge trees are capped gracefully.

### Issue 7E.2: Read file within skill directory

**Status:** Implemented.

**Goal**: Preview supporting markdown and inspect scripts/assets.

**What to do:**
- Add `GET /api/skills/:id/files/:relativePath` or query-based equivalent.
- Resolve only within `baseDir`.
- Return text content for safe text files.
- Return metadata/download-disabled message for binary files.
- Support markdown preview for `.md` files.

**Validation:**
- Can read `references/api.md` from selected skill.
- Cannot read `../../package.json`.
- Binary file is not dumped into UI.

### Issue 7E.3: Linked markdown navigation

**Status:** Implemented.

**Goal**: Make relative links in previews navigate inside the skill library.

**What to do:**
- Intercept markdown links that point to relative `.md` files.
- Resolve them against the current file's directory inside `baseDir`.
- Open target markdown in the preview/editor panel.
- External links open normally in a new tab.
- Broken links show a clear error.

**Validation:**
- Link from `SKILL.md` to `references/foo.md` opens in the dashboard.
- Nested relative links work.
- External URLs are not routed through file API.

### Issue 7E.4: Create rich directory skill scaffold

**Status:** Implemented.

**Goal**: Make new skills ready for multi-file context.

**What to do:**
- Update create skill flow to optionally scaffold:
  - `SKILL.md`
  - `references/README.md`
  - `scripts/README.md`
  - `assets/README.md`
  - `examples/README.md`
- `SKILL.md` should include relative links to these files.
- Let user choose minimal vs rich scaffold.

**Validation:**
- Rich scaffold creates co-located markdown folders.
- Links in generated `SKILL.md` work in preview.
- Agent can read linked files via normal `read` tool paths.

### Issue 7E.5: Edit supporting markdown files

**Status:** Implemented.

**Goal**: Allow editing of co-located markdown docs, not just `SKILL.md`.

**What to do:**
- Allow save for editable text files under editable skill roots.
- Restrict writes to safe text extensions first:
  - `.md`
  - `.txt`
  - `.json`
  - `.yaml`
  - `.yml`
- Use hash guard for every save.
- Keep package skills read-only.

**Validation:**
- Project skill `references/foo.md` can be edited.
- Package skill support files remain read-only.
- Stale edit returns 409.

### Issue 7E.6: Optional script visibility and safety warnings

**Status:** Implemented. Scripts are visible/previewable as text when small and no run action is exposed.

**Goal**: Make bundled scripts inspectable without encouraging blind execution.

**What to do:**
- Show scripts in file tree with warning icon/badge.
- Preview script text when small enough.
- Add warning copy: scripts can be invoked by agents through normal tools.
- Do not add a dashboard `Run script` button in this phase.

**Validation:**
- `scripts/process.sh` is visible and previewable.
- UI clearly communicates execution risk.
- No browser endpoint executes scripts.

---

# Phase 7G — Resource Source Settings UI

**Status:** Implemented.

## Goal

Let users manage machine-wide and project-local Pi resource source paths from the dashboard, using Pi's native `settings.json` files instead of a Pi Orchestrator-specific config. This supports personal skills/extensions repositories cloned elsewhere on disk and shared across projects on the same machine.

## Design Direction

- Use Pi's existing settings files as the source of truth:
  - global: `~/.pi/agent/settings.json`
  - project: `.pi/settings.json`
- Manage these Pi settings keys:
  - `skills`: local skill file paths or directories
  - `extensions`: local extension file paths or directories
- Do not invent a separate orchestrator config for resource paths.
- Show clear scope labels:
  - Global / all projects on this machine
  - Project / current repository only
- Paths may be absolute or use `~`.
- Validate paths before saving when possible, but allow advanced users to keep not-yet-created paths only with an explicit warning/confirmation.
- Extensions deserve stronger warnings than skills because extensions execute code with full system permissions.
- Resource source changes may require Pi session reload/restart before every running process sees them.

## Pi Settings Behavior To Surface

From Pi docs:

- `~/.pi/agent/settings.json` applies globally across projects.
- `.pi/settings.json` applies to the current project and overrides/merges with global settings.
- Resource paths in global settings resolve relative to `~/.pi/agent` unless absolute or `~`-prefixed.
- Resource paths in project settings resolve relative to `.pi` unless absolute or `~`-prefixed.
- `skills` and `extensions` arrays support paths, directories, globs, exclusions, and exact include/exclude prefixes.

## Tracer Bullet Issues

### Issue 7G.1: Settings file read API

**Status:** Implemented.

**Goal**: Load global and project Pi settings relevant to resource sources.

**What to do:**
- Add backend endpoint, e.g. `GET /api/resource-settings`.
- Read:
  - `~/.pi/agent/settings.json`
  - `<repo>/.pi/settings.json`
- Return only the relevant fields initially:
  - global `skills`, `extensions`
  - project `skills`, `extensions`
  - file paths for each settings file
  - whether each file exists
  - parse/read errors, if any
- Preserve unknown settings in files; do not drop unrelated keys.

**Validation:**
- Empty/missing settings files return empty arrays and no crash.
- Existing unrelated settings are not modified by read path.
- Invalid JSON returns a useful error payload.

### Issue 7G.2: Settings file update API

**Status:** Implemented.

**Goal**: Save resource source arrays without clobbering unrelated Pi settings.

**What to do:**
- Add backend endpoint, e.g. `PUT /api/resource-settings`.
- Support updating one scope at a time:
  - `scope: "global" | "project"`
  - `skills?: string[]`
  - `extensions?: string[]`
- Read existing settings JSON, update only provided keys, and write back pretty JSON.
- Create parent directory/file if needed.
- Preserve unrelated settings.
- Return updated settings payload.

**Validation:**
- Updating global skills preserves global model/theme settings.
- Updating project extensions preserves project settings.
- Missing settings file is created.
- Invalid scope returns 400.

### Issue 7G.3: Path validation and resource counts

**Status:** Implemented.

**Goal**: Help users understand whether a configured path works.

**What to do:**
- For each configured path, return validation metadata:
  - raw path
  - resolved path
  - exists
  - type: file/directory/missing/unknown
  - approximate discovered skill/extension count if practical
  - warnings/errors
- Use Pi path resolution rules:
  - global relative paths relative to `~/.pi/agent`
  - project relative paths relative to `.pi`
  - `~` expansion
- For globs/exclusions, show best-effort validation rather than strict file stats.

**Validation:**
- Absolute path validates correctly.
- `~` path validates correctly.
- Relative global path resolves against `~/.pi/agent`.
- Relative project path resolves against `<repo>/.pi`.
- Missing path shows warning but does not crash.

### Issue 7G.4: Dashboard Resource Sources page

**Status:** Implemented.

**Goal**: Add a UI for managing Pi resource source settings.

**What to do:**
- Add a new dashboard section, e.g. `Resource Sources` or `Settings`.
- Show two panels:
  - Global / all projects
  - Project / current repo
- Each panel has editable lists for:
  - Skill source paths
  - Extension source paths
- Actions:
  - add path
  - remove path
  - save changes
  - reset unsaved changes
- Show validation badges next to each path.
- Show the underlying settings file path for transparency.

**Validation:**
- User can add/remove global skill source path.
- User can add/remove project extension source path.
- UI shows unsaved changes.
- Dashboard refreshes discovered skills/extensions after save.

### Issue 7G.5: Safety and clarity copy

**Status:** Implemented.

**Goal**: Make the resource model understandable and safe.

**What to do:**
- Add inline helper text/tooltips explaining:
  - global means all projects on this machine
  - project means current repository only
  - skills are markdown instructions and may include scripts agents can invoke
  - extensions execute code and should only come from trusted paths
  - settings changes may require reload/restart for all sessions to see them
- Link or quote the relevant Pi docs behavior in concise UI copy.

**Validation:**
- New users can understand where paths are saved.
- Extension source warning is visible before save.
- Global/project scope distinction is unambiguous.

### Issue 7G.6: Optional agent tools for resource settings

**Status:** Implemented.

**Goal**: Let the interactive agent inspect and modify resource source settings when asked.

**What to do:**
- Consider adding tools:
  - `resource_settings_read`
  - `resource_settings_update`
- Keep writes explicit and scoped.
- Require exact paths and preserve unrelated settings.
- Return clear warnings for extension paths.

**Validation:**
- Agent can report current global/project resource paths.
- Agent can add a skill source path when user asks.
- Agent warns before adding extension source paths.

---

# Phase 7F — Future Enhancements / Parking Lot

These are intentionally not part of 7A–7E unless explicitly pulled forward.

- Rename skills with reference updates.
- Copy/derive skills into project or global scope for customization.
  - Use case: copy a package-provided/read-only skill into `.pi/skills` or `~/.pi/agent/skills`, rename it, then tweak it.
  - Pi collision behavior from docs/source: skills are keyed by frontmatter `name`; name collisions warn and keep the first discovered skill. Default discovery order is global/user first, then project, then explicit paths/packages as loaded by the resource loader. If copying a skill for customization, give it a distinct `name`/description to avoid collision ambiguity. A copied skill with the same name may be ignored in favor of the earlier discovered skill.
  - Potential UI: `Copy Skill…` action with target scope and required new name; copy entire directory tree; rewrite frontmatter name/description.
  - Add a friendly warning in the copy dialog explaining that duplicate skill names collide and Pi keeps the first discovered skill, so copied/customized skills should usually get a new name.
- Template description clarity.
  - Current behavior: skill/extension template descriptions are dashboard metadata only. Capability resolution uses template `name`, `items`, and `applyToAll`; the template `description` is not injected into agent prompts and is not passed to child agents.
  - Keep using template descriptions for humans: list cards, editor context, and future search/filtering.
  - Add UI helper text so users do not assume template descriptions affect model behavior.
- Diff view before save.
- Skill usage telemetry: which agents loaded or used a skill.
- Skill validation autofix.
- Generate tests/examples for skill scripts.
