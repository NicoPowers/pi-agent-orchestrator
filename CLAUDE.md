<!-- mulch:start -->
## Project Expertise (Mulch)
<!-- mulch-onboard:v0.10.1:pi -->

This project uses [Mulch](https://github.com/jayminwest/mulch) v0.10.1 via the in-tree
`@os-eco/pi-mulch` pi-coding-agent extension. The extension auto-primes on `session_start`,
scope-loads relevant records on file reads/edits, registers `record_expertise` and
`query_expertise` custom tools, and surfaces an `ml learn` nudge widget on `agent_end`.

**Manual escape hatches** (rarely needed — the extension handles the rituals):

- `/ml:prime [domain]` — re-prime the conversation (optionally scoped to one domain).
- `ml record <domain> --type <type> --description "..."` — record an insight outside the
  `record_expertise` tool (e.g. from a shell prompt).
- `ml search "<query>"` — search records across domains.
- `ml status` / `ml doctor` — corpus health.

Configuration lives under `pi.*` in `.mulch/mulch.config.yaml`. Run `ml setup pi --check`
to verify the install state; `ml setup pi --remove` reverts to the standalone CLI snippet.

### Before You Finish

If you discovered conventions, patterns, decisions, or failures worth preserving during
this session, record them before closing:

```bash
ml learn                                                                    # see what files changed
ml record <domain> --type <convention|pattern|failure|decision|reference|guide> --description "..."
ml sync                                                                     # validate, stage, commit
```

Skip if no insight surfaced. Unrecorded learnings are lost; ritual filler records are also noise.
<!-- mulch:end -->

<!-- seeds:start -->
## Issue Tracking (Seeds)
<!-- seeds-onboard:v0.4.7 -->
<!-- seeds-onboard-schema:5:pi -->

This project uses [Seeds](https://github.com/jayminwest/seeds) v0.4.7 via the in-tree
`@os-eco/pi-seeds` pi-coding-agent extension. The extension auto-primes on `session_start`,
renders a `sd: <n> ready / <n> in-progress / <n> blocked` status widget, registers
`sd_create` / `sd_ready` / `sd_show` / `sd_update` / `sd_close` / `sd_dep` / `sd_search`
custom tools, expands `#sd-<id>` references on send, and ships `/sd`, `/sd:ready`,
`/sd:create`, `/sd:show`, `/sd:close`, `/sd:claim` slash commands.

**Manual escape hatches** (rarely needed — the extension handles the rituals):

- `sd ready` — Find unblocked work from the shell.
- `sd create --title "..."` / `sd close <id>` — Create or close from the shell.
- `sd sync` — Stage and commit `.seeds/` changes before `git push`.

Configuration lives under `pi.*` in `.seeds/config.yaml`. Run `sd setup pi --check` to verify
the install state; `sd setup pi --remove` reverts to the standalone CLI snippet.

### Before You Finish
1. Close completed issues: `sd close <id>`
2. File issues for remaining work: `sd create --title "..."`
3. Sync and push: `sd sync && git push`
<!-- seeds:end -->
