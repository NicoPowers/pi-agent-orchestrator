import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "./state.js";
import { agents } from "./state.js";

// Serialize git worktree operations
let worktreeLock = Promise.resolve();
const managedWorktrees = new Set<string>();
const managedWorktreeMarkerDir = path.join(os.tmpdir(), "pi-lattice-worktree-markers");
const managedWorktreeMarkerTtlMs = 24 * 60 * 60 * 1000;

function markerPathFor(worktreePath: string): string {
  return path.join(managedWorktreeMarkerDir, Buffer.from(worktreePath).toString("base64url"));
}

function markManagedWorktree(worktreePath: string) {
  managedWorktrees.add(worktreePath);
  try {
    fs.mkdirSync(managedWorktreeMarkerDir, { recursive: true });
    fs.writeFileSync(markerPathFor(worktreePath), JSON.stringify({ path: worktreePath, createdAt: Date.now() }), "utf-8");
  } catch {
    /* in-memory tracking still protects this process */
  }
}

function unmarkManagedWorktree(worktreePath: string) {
  managedWorktrees.delete(worktreePath);
  try {
    fs.rmSync(markerPathFor(worktreePath), { force: true });
  } catch {
    /* ignore */
  }
}

function hasFreshManagedWorktreeMarker(worktreePath: string): boolean {
  try {
    const markerPath = markerPathFor(worktreePath);
    const marker = fs.statSync(markerPath);
    if (Date.now() - marker.mtimeMs <= managedWorktreeMarkerTtlMs) return true;
    fs.rmSync(markerPath, { force: true });
  } catch {
    /* ignore */
  }
  return false;
}

export async function createWorktree(id: string, repoCwd: string): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), `pi-worktree-${id}-${Date.now()}`);
  const prev = worktreeLock;
  markManagedWorktree(worktreePath);

  worktreeLock = prev.then(async () => {
    log("worktree", `Creating worktree for '${id}'`, { path: worktreePath, repoCwd });
    return new Promise<void>((resolve, reject) => {
      const proc = spawn("git", ["worktree", "add", worktreePath, "HEAD"], {
        cwd: repoCwd,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout!.on("data", (d) => { stdout += d.toString(); });
      proc.stderr!.on("data", (d) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          unmarkManagedWorktree(worktreePath);
          reject(new Error(`git worktree add failed: ${stderr || stdout}`));
        }
      });
      proc.on("error", (err) => {
        unmarkManagedWorktree(worktreePath);
        reject(err);
      });
    });
  });

  await worktreeLock;
  return worktreePath;
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  log("worktree", `Removing worktree`, { path: worktreePath });
  unmarkManagedWorktree(worktreePath);
  return new Promise<void>((resolve) => {
    const proc = spawn("git", ["worktree", "remove", "--force", worktreePath], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    proc.on("close", () => {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve();
    });
    proc.on("error", () => {
      try {
        fs.rmSync(worktreePath, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      resolve();
    });
  });
}

export function cleanupOrphanedWorktrees() {
  const tmpDir = os.tmpdir();
  try {
    const entries = fs.readdirSync(tmpDir);
    for (const entry of entries) {
      if (entry.startsWith("pi-worktree-")) {
        const fullPath = path.join(tmpDir, entry);
        const isActive = managedWorktrees.has(fullPath) || hasFreshManagedWorktreeMarker(fullPath) || Array.from(agents.values()).some((a) => a.worktreePath === fullPath);
        if (!isActive) {
          log("worktree", `Cleaning up orphaned worktree`, { path: fullPath });
          try {
            fs.rmSync(fullPath, { recursive: true, force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
  } catch {
    /* ignore */
  }
}
