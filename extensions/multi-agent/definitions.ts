import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { type AgentDefinition } from "./state.js";
import { discoverConfiguredOrchestratorLibraries } from "./orchestrator-library.js";

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

export function resolveSkillPath(raw: string, agentFileDir: string, cwd: string): string {
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

    const skillTemplates = frontmatter.skillTemplates
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    const extensionTemplates = frontmatter.extensionTemplates
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean);

    defs.push({
      name: frontmatter.name,
      description: frontmatter.description,
      model: frontmatter.model,
      thinking: (frontmatter.thinking as AgentDefinition["thinking"]) || undefined,
      tools: tools && tools.length > 0 ? tools : undefined,
      skills: skills && skills.length > 0 ? skills : undefined,
      skillTemplates: skillTemplates && skillTemplates.length > 0 ? skillTemplates : undefined,
      extensionTemplates: extensionTemplates && extensionTemplates.length > 0 ? extensionTemplates : undefined,
      systemPrompt: body,
      source,
      filePath,
      readOnly: source === "package",
      example: source === "package" && frontmatter.name.startsWith("pio-example-"),
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
  const libraryDefs = discoverConfiguredOrchestratorLibraries(cwd).resources
    .filter((resource) => resource.kind === "agents")
    .flatMap((resource) => loadDefinitionsFromDir(path.dirname(resource.filePath), "project", cwd).filter((definition) => definition.filePath === resource.filePath))
    .map((definition) => ({ ...definition, source: "project" as const, readOnly: false }));

  const map = new Map<string, AgentDefinition>();
  for (const d of packageDefs) map.set(d.name, d);
  for (const d of userDefs) map.set(d.name, d);
  for (const d of projectDefs) map.set(d.name, d);
  for (const d of libraryDefs) map.set(d.name, d);

  return Array.from(map.values());
}

export function getDefinition(name: string, cwd: string): AgentDefinition | undefined {
  return discoverDefinitions(cwd).find((d) => d.name === name);
}

/**
 * Saves (creates or updates) an agent definition as a .md file.
 * Prefers project-level .pi/agents/ when available, otherwise falls back to user agents dir.
 */
export function saveAgentDefinition(
  def: AgentDefinition,
  cwd: string
): { success: boolean; path?: string; error?: string } {
  try {
    const library = discoverConfiguredOrchestratorLibraries(cwd).libraries.find((candidate) => candidate.valid && candidate.manifest);
    const projectDir = findProjectAgentsDir(cwd);
    const targetDir = library ? library.resourceDirs.agents.resolvedPath : (projectDir || path.join(getAgentDir(), "agents"));

    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }

    const filePath = path.join(targetDir, `${def.name}.md`);

    const frontmatterLines = [
      `name: ${def.name}`,
      `description: ${def.description || ""}`,
    ];
    if (def.model) frontmatterLines.push(`model: ${def.model}`);
    if (def.thinking) frontmatterLines.push(`thinking: ${def.thinking}`);
    if (def.tools && def.tools.length > 0) frontmatterLines.push(`tools: ${def.tools.join(", ")}`);
    if (def.skills && def.skills.length > 0) frontmatterLines.push(`skills: ${def.skills.join(", ")}`);
    if (def.skillTemplates && def.skillTemplates.length > 0) frontmatterLines.push(`skillTemplates: ${def.skillTemplates.join(", ")}`);
    if (def.extensionTemplates && def.extensionTemplates.length > 0) frontmatterLines.push(`extensionTemplates: ${def.extensionTemplates.join(", ")}`);

    const frontmatter = `---\n${frontmatterLines.join("\n")}\n---`;
    const body = (def as any).prompt || def.systemPrompt || "";
    const content = `${frontmatter}\n\n${body}\n`;

    fs.writeFileSync(filePath, content, "utf-8");
    return { success: true, path: filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
