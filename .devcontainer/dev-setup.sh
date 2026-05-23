#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="/workspaces/pi-lattice"
cd "$WORKSPACE"

echo "==> Installing JavaScript dependencies and bundled Pi packages"
bun install

echo "==> Building dashboard assets served by the Pi Lattice extension"
bun run build

echo "==> Registering this checkout as the local pi-lattice package"
pi install "$WORKSPACE"

cat <<'MSG'

Devcontainer setup complete.

Start Pi from this container with:
  pi

Then enable the orchestrator with:
  /orchestrate
  /dashboard

This is a local-path Pi package install. Edits in this checkout are the installed package;
use /reload or restart Pi after extension changes, and run `bun run build` after dashboard changes.
MSG
