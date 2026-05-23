# Containerized orchestration runtime

This project is moving toward a trusted-local container runtime: Pi runs inside one Docker/devcontainer environment, and spawned agents run as normal child Pi RPC processes in that same container. The container is the outer reproducible boundary; do not add nested Docker containers or per-agent bwrap sandboxes for this runtime.

## Devcontainer quick start

1. Open this repository in a devcontainer-compatible editor.
2. Reopen in container.
3. The devcontainer runs `.devcontainer/dev-setup.sh` after creation.
4. Start Pi from the container terminal:

```bash
pi
```

Then enable orchestration inside Pi:

```text
/orchestrate
/dashboard
```

The setup script runs `bun install`, builds the dashboard assets, and registers `/workspaces/pi-lattice` as a local-path Pi package. That means Pi loads the orchestrator extension, skills, and bundled helper package resources from the mounted checkout. Edits to this repository are edits to the installed package; use `/reload` or restart Pi after extension/package manifest changes, and run `bun run build` after dashboard changes.

The devcontainer forwards the dashboard port `18765`.

The devcontainer also forwards a WSL-side SSH agent through a stable socket at
`/tmp/pi-lattice-ssh-agent.sock`. On container startup,
`.devcontainer/init-ssh-agent.sh` starts that agent if needed and attempts to add
the first non-passphrase-protected default key it finds:

- `~/.ssh/id_ed25519`
- `~/.ssh/id_rsa`
- `~/.ssh/id_ecdsa`

If the key is passphrase-protected, add it once from WSL with:

```bash
SSH_AUTH_SOCK=/tmp/pi-lattice-ssh-agent.sock ssh-add ~/.ssh/id_ed25519
```

Inside the container, verify forwarding with `ssh-add -l`.

## Running Pi in the container

From inside the container:

```bash
pi
```

The first Pi login/configuration writes under `/home/node/.pi`. The devcontainer maps that path to a named Docker volume (`pi-lattice-home`) so Pi config, cache, package installs, and auth survive container rebuilds.

## External Lattice Libraries

Runtime paths inside the container are the source of truth. Repo-local libraries belong under:

```text
.pi/pi-lattice/libraries/<library-name>/lattice-library.json
```

External team/user libraries should be bind-mounted before Pi starts under:

```text
.pi/pi-lattice/external-libraries/<library-name>/lattice-library.json
```

For example, add an extra devcontainer mount for a host checkout:

```json
"mounts": [
  "source=/absolute/host/team-lattice-library,target=${containerWorkspaceFolder}/.pi/pi-lattice/external-libraries/team,type=bind,consistency=cached"
]
```

External libraries are separately versioned repositories. This project ignores `.pi/pi-lattice/external-libraries/` so normal project status is not polluted by mounted library contents.

## Issue handoff artifacts

Operational handoff artifacts for spawned-agent continuity live under the app-owned project tree:

```text
.pi/pi-lattice/issues/<issue-id>/
  issue-context.json
  lead-plan.json
  lead-summary.md
  scouts/<agent-id>.packet.json
  scouts/<agent-id>.dossier.json
  researchers/<agent-id>.packet.json
  researchers/<agent-id>.dossier.json
  builders/<agent-id>.packet.json
  builders/<agent-id>.completion.json
```

These files are working-session context bundles for leads, scouts, researchers, and builders. They are distinct from Seeds issue state and Mulch durable knowledge: agents may use them to pass operational context, and the root orchestrator can later promote selected outcomes into Seeds or Mulch.

The current runtime standardizes the path skeleton, carries `issueId`/`artifactPath` metadata on spawned agents when an issue id is supplied, and injects lightweight role-specific artifact guidance into spawned agents. Full packet gates and required artifact submission belong to the later Orchestration Protocol Mode work.

## Notes

- Keep host paths out of library metadata; the dashboard and runtime should display container paths.
- The Dockerfile includes Bun, Node-compatible tooling, git, ripgrep, Python, and build essentials for this repository's tests/builds.
- Network hardening is intentionally deferred; this baseline is for a trusted local development environment.
