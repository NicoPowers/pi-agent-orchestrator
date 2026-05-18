import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { log } from "./state.js";

export interface ExtensionMetadata {
  description?: string;
  expectedTools?: string[];
  metadataStatus: "provided" | "unknown" | "invalid";
  metadataSource?: string;
}

export interface DiscoveredExtension extends ExtensionMetadata {
  name: string;
  path: string;
  scope: "global" | "project" | "npm";
}

function readPiManifest(packageJsonPath: string): { extensions?: string[] } | null {
  try {
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content);
    if (pkg.pi && typeof pkg.pi === "object") {
      return pkg.pi;
    }
    return null;
  } catch {
    return null;
  }
}

function isExtensionFile(name: string): boolean {
  return name.endsWith(".ts") || name.endsWith(".js");
}

function normalizeExpectedTools(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const tools = Array.from(new Set(value.map((tool) => String(tool).trim()).filter(Boolean)));
  return tools.length ? tools : undefined;
}

export function readExtensionMetadata(extPath: string): ExtensionMetadata {
  let source: string;
  try {
    source = fs.readFileSync(extPath, "utf-8").slice(0, 64_000);
  } catch {
    return { metadataStatus: "unknown" };
  }

  const match = source.match(/pi-orchestrator:\s*(\{[^\n]*\})/) || source.match(/pi-orchestrator:\s*(\{[\s\S]*?\})\s*\*\//);
  if (!match) return { metadataStatus: "unknown" };

  try {
    const raw = JSON.parse(match[1]);
    const description = typeof raw.description === "string" ? raw.description.trim() : undefined;
    const expectedTools = normalizeExpectedTools(raw.expectedTools ?? raw.tools);
    return {
      description: description || undefined,
      expectedTools,
      metadataStatus: "provided",
      metadataSource: "source-comment",
    };
  } catch {
    return { metadataStatus: "invalid", metadataSource: "source-comment" };
  }
}

function resolveExtensionEntries(dir: string): string[] | null {
  const packageJsonPath = path.join(dir, "package.json");
  if (fs.existsSync(packageJsonPath)) {
    const manifest = readPiManifest(packageJsonPath);
    if (manifest?.extensions?.length) {
      const entries: string[] = [];
      for (const extPath of manifest.extensions) {
        const resolved = path.resolve(dir, extPath);
        if (fs.existsSync(resolved)) {
          entries.push(resolved);
        }
      }
      if (entries.length > 0) {
        return entries;
      }
    }
  }
  const indexTs = path.join(dir, "index.ts");
  const indexJs = path.join(dir, "index.js");
  if (fs.existsSync(indexTs)) return [indexTs];
  if (fs.existsSync(indexJs)) return [indexJs];
  return null;
}

function discoverExtensionsInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const discovered: string[] = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if ((entry.isFile() || entry.isSymbolicLink()) && isExtensionFile(entry.name)) {
        discovered.push(entryPath);
        continue;
      }
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const subEntries = resolveExtensionEntries(entryPath);
        if (subEntries) {
          discovered.push(...subEntries);
        }
      }
    }
  } catch {
    return [];
  }
  return discovered;
}

function getNpmPackageExtensions(): DiscoveredExtension[] {
  const results: DiscoveredExtension[] = [];
  const npmDir = path.join(os.homedir(), ".pi", "agent", "npm", "node_modules");
  if (!fs.existsSync(npmDir)) return results;

  // Read settings.json to find explicitly installed packages
  const settingsPath = path.join(os.homedir(), ".pi", "agent", "settings.json");
  let installedPackages: string[] = [];
  try {
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
    installedPackages = (settings.packages || [])
      .filter((p: string) => p.startsWith("npm:"))
      .map((p: string) => p.replace("npm:", ""));
  } catch {
    /* ignore */
  }

  for (const pkgName of installedPackages) {
    const pkgDir = path.join(npmDir, pkgName);
    const entries = resolveExtensionEntries(pkgDir);
    if (!entries) continue;

    for (const extPath of entries) {
      const extName = path.basename(extPath).replace(/\.(ts|js)$/, "");
      results.push({
        name: `${pkgName}/${extName}`,
        path: extPath,
        scope: "npm",
        ...readExtensionMetadata(extPath),
      });
    }
  }

  return results;
}

export function discoverExtensions(cwd: string): DiscoveredExtension[] {
  // 1. Project-local
  const localDir = path.join(cwd, ".pi", "extensions");
  const localPaths = discoverExtensionsInDir(localDir);

  // 2. Global
  const globalDir = path.join(os.homedir(), ".pi", "agent", "extensions");
  const globalPaths = discoverExtensionsInDir(globalDir);

  // 3. NPM packages
  const npmExts = getNpmPackageExtensions();

  const map = new Map<string, DiscoveredExtension>();

  for (const p of globalPaths) {
    const name = path.basename(p).replace(/\.(ts|js)$/, "");
    if (name === "multi-agent" || name === "index") continue;
    map.set(name, { name, path: p, scope: "global", ...readExtensionMetadata(p) });
  }

  for (const p of localPaths) {
    const name = path.basename(p).replace(/\.(ts|js)$/, "");
    if (name === "multi-agent" || name === "index") continue;
    map.set(name, { name, path: p, scope: "project", ...readExtensionMetadata(p) });
  }

  for (const e of npmExts) {
    map.set(e.name, e);
  }

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
      const destName = ext.name.replace(/\//g, "-") + ".ts";
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
