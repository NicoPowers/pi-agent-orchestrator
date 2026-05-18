import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "./state.js";
import { agents } from "./state.js";

// Serialize git worktree operations
let worktreeLock = Promise.resolve();

export async function createWorktree(id: string, repoCwd: string): Promise<string> {
  const worktreePath = path.join(os.tmpdir(), `pi-worktree-${id}-${Date.now()}`);
  const prev = worktreeLock;

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
          reject(new Error(`git worktree add failed: ${stderr || stdout}`));
        }
      });
      proc.on("error", (err) => reject(err));
    });
  });

  await worktreeLock;
  return worktreePath;
}

export async function removeWorktree(worktreePath: string): Promise<void> {
  log("worktree", `Removing worktree`, { path: worktreePath });
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
        const isActive = Array.from(agents.values()).some((a) => a.worktreePath === fullPath);
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
