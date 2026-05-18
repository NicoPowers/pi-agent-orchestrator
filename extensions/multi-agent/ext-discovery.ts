import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "./state.js";

export interface DiscoveredExtension {
  name: string;
  path: string;
  scope: "global" | "project";
}

function scanDir(dir: string, scope: "global" | "project"): DiscoveredExtension[] {
  const results: DiscoveredExtension[] = [];
  if (!fs.existsSync(dir)) return results;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;

    if (entry.isFile() && entry.name.endsWith(".ts")) {
      const name = entry.name.replace(/\.ts$/, "");
      // Skip the orchestrator extension itself to prevent recursive loading
      if (name === "multi-agent" || name === "index") continue;
      results.push({
        name,
        path: path.join(dir, entry.name),
        scope,
      });
    } else if (entry.isDirectory()) {
      const indexPath = path.join(dir, entry.name, "index.ts");
      if (fs.existsSync(indexPath)) {
        // Skip the orchestrator extension directory
        if (entry.name === "multi-agent") continue;
        results.push({
          name: entry.name,
          path: indexPath,
          scope,
        });
      }
    }
  }

  return results;
}

export function discoverExtensions(cwd: string): DiscoveredExtension[] {
  const globalDir = path.join(os.homedir(), ".pi", "agent", "extensions");
  const projectDir = path.join(cwd, ".pi", "extensions");

  const globalExts = scanDir(globalDir, "global");
  const projectExts = scanDir(projectDir, "project");

  // Deduplicate by name (project overrides global)
  const map = new Map<string, DiscoveredExtension>();
  for (const e of globalExts) map.set(e.name, e);
  for (const e of projectExts) map.set(e.name, e);

  return Array.from(map.values());
}

export function copyExtensionsToWorktree(
  extensions: DiscoveredExtension[],
  worktreePath: string
): string[] {
  const extDir = path.join(worktreePath, ".pi", "extensions");
  fs.mkdirSync(extDir, { recursive: true });

  const copied: string[] = [];
  for (const ext of extensions) {
    try {
      const destName = ext.name + ".ts";
      const dest = path.join(extDir, destName);
      fs.copyFileSync(ext.path, dest);
      copied.push(`/tmp/workspace/.pi/extensions/${destName}`);
      log("spawn", `Copied extension '${ext.name}' to worktree`, { path: dest });
    } catch (err: any) {
      log("spawn", `Failed to copy extension '${ext.name}': ${err.message}`);
    }
  }

  return copied;
}
