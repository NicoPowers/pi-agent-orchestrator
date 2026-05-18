import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { type AgentDefinition } from "./state.js";

function isDirectory(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function findProjectAgentsDir(cwd: string): string | null {
  let currentDir = cwd;
  while (true) {
    const candidate = path.join(currentDir, ".pi", "agents");
    if (isDirectory(candidate)) return candidate;
    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) return null;
    currentDir = parentDir;
  }
}

function getPackageAgentsDir(): string | null {
  try {
    const extDir = __dirname;
    const candidate = path.join(extDir, "..", "..", "agents");
    if (isDirectory(candidate)) return candidate;
  } catch {
    /* __dirname may not be available in some loaders */
  }
  return null;
}

function resolveSkillPath(raw: string, agentFileDir: string, cwd: string): string {
  if (path.isAbsolute(raw)) return raw;
  const relativeToAgent = path.resolve(agentFileDir, raw);
  if (fs.existsSync(relativeToAgent)) return relativeToAgent;
  const relativeToCwd = path.resolve(cwd, raw);
  if (fs.existsSync(relativeToCwd)) return relativeToCwd;
  const globalSkill = path.join(getAgentDir(), "skills", raw);
  if (fs.existsSync(globalSkill)) return globalSkill;
  const globalSkillAlt = path.join(os.homedir(), ".agents", "skills", raw);
  if (fs.existsSync(globalSkillAlt)) return globalSkillAlt;
  const projectSkill = path.join(cwd, ".pi", "skills", raw);
  if (fs.existsSync(projectSkill)) return projectSkill;
  const projectSkillAlt = path.join(cwd, ".agents", "skills", raw);
  if (fs.existsSync(projectSkillAlt)) return projectSkillAlt;
  return relativeToCwd;
}

function loadDefinitionsFromDir(dir: string, source: "user" | "project" | "package", cwd: string): AgentDefinition[] {
  const defs: AgentDefinition[] = [];
  if (!fs.existsSync(dir)) return defs;

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return defs;
  }

  for (const entry of entries) {
    if (!entry.name.endsWith(".md")) continue;
    if (!entry.isFile() && !entry.isSymbolicLink()) continue;

    const filePath = path.join(dir, entry.name);
    let content: string;
    try {
      content = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    if (!frontmatter.name || !frontmatter.description) continue;

    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const skills = frontmatter.skills
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => resolveSkillPath(s, dir, cwd));

    defs.push({
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model,
      tools: tools && tools.length > 0 ? tools : undefined,
      skills: skills && skills.length > 0 ? skills : undefined,
      systemPrompt: body,
      source,
      filePath,
    });
  }

  return defs;
}

export function discoverDefinitions(cwd: string): AgentDefinition[] {
  const userDir = path.join(getAgentDir(), "agents");
  const projectDir = findProjectAgentsDir(cwd);
  const packageDir = getPackageAgentsDir();

  const userDefs = loadDefinitionsFromDir(userDir, "user", cwd);
  const projectDefs = projectDir ? loadDefinitionsFromDir(projectDir, "project", cwd) : [];
  const packageDefs = packageDir ? loadDefinitionsFromDir(packageDir, "package", cwd) : [];

  const map = new Map<string, AgentDefinition>();
  for (const d of packageDefs) map.set(d.name, d);
  for (const d of userDefs) map.set(d.name, d);
  for (const d of projectDefs) map.set(d.name, d);

  return Array.from(map.values());
}

export function getDefinition(name: string, cwd: string): AgentDefinition | undefined {
  return discoverDefinitions(cwd).find((d) => d.name === name);
}
