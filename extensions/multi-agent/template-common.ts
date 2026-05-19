import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverConfiguredOrchestratorLibraries } from "./orchestrator-library.js";

export interface TemplateDefinition {
  name: string;
  description: string;
  items: string[];
  applyToAll?: boolean;
  source: "project" | "orchestrator-library";
  scope?: string;
  filePath: string;
}

export interface TemplateKindConfig {
  dirName: string;
  itemField: string;
  libraryKind?: "skillTemplates" | "extensionTemplates";
}

function safeTemplateName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.includes("..");
}

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).map((s) => s.trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  return value.split(",").map((s) => s.trim()).filter(Boolean);
}

function parseApplyToAll(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return undefined;
  if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
  if (["false", "no", "0"].includes(value.toLowerCase())) return false;
  return undefined;
}

export function templateDir(cwd: string, config: TemplateKindConfig): string {
  return path.join(cwd, ".pi", config.dirName);
}

export function validateTemplateName(name: unknown): string | undefined {
  if (typeof name !== "string" || !name.trim()) return "name is required";
  if (!safeTemplateName(name)) return "name may only contain letters, numbers, dot, underscore, and dash";
  return undefined;
}

function readTemplateFile(filePath: string, config: TemplateKindConfig, source: TemplateDefinition["source"], scope?: string): TemplateDefinition | undefined {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf-8");
  } catch {
    return undefined;
  }
  const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
  const name = typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
  const description = typeof frontmatter.description === "string" ? frontmatter.description.trim() : "";
  if (!name || !description || validateTemplateName(name)) return undefined;
  return {
    name,
    description,
    items: parseList(frontmatter[config.itemField] ?? frontmatter.items),
    applyToAll: parseApplyToAll(frontmatter.applyToAll),
    source,
    scope,
    filePath,
  };
}

export function discoverTemplates(cwd: string, config: TemplateKindConfig): TemplateDefinition[] {
  const templates: TemplateDefinition[] = [];
  const dir = templateDir(cwd, config);
  if (fs.existsSync(dir)) {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      entries = [];
    }
    for (const entry of entries) {
      if (!entry.name.endsWith(".md")) continue;
      if (!entry.isFile() && !entry.isSymbolicLink()) continue;
      const template = readTemplateFile(path.join(dir, entry.name), config, "project");
      if (template) templates.push(template);
    }
  }

  if (config.libraryKind) {
    for (const resource of discoverConfiguredOrchestratorLibraries(cwd).resources.filter((resource) => resource.kind === config.libraryKind)) {
      const template = readTemplateFile(resource.filePath, config, "orchestrator-library", resource.libraryName);
      if (template) templates.push(template);
    }
  }

  const byName = new Map<string, TemplateDefinition>();
  for (const template of templates.sort((a, b) => a.name.localeCompare(b.name))) {
    if (!byName.has(template.name) || byName.get(template.name)?.source !== "orchestrator-library") byName.set(template.name, template);
  }
  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export function getTemplate(name: string, cwd: string, config: TemplateKindConfig): TemplateDefinition | undefined {
  return discoverTemplates(cwd, config).find((template) => template.name === name);
}

function targetTemplateDir(cwd: string, config: TemplateKindConfig): string {
  if (config.libraryKind) {
    const library = discoverConfiguredOrchestratorLibraries(cwd).libraries.find((candidate) => candidate.valid && candidate.manifest);
    if (library) return library.resourceDirs[config.libraryKind].resolvedPath;
  }
  return templateDir(cwd, config);
}

export function saveTemplate(
  template: Omit<TemplateDefinition, "source" | "filePath">,
  cwd: string,
  config: TemplateKindConfig
): { success: boolean; path?: string; error?: string } {
  const nameError = validateTemplateName(template.name);
  if (nameError) return { success: false, error: nameError };
  if (!template.description?.trim()) return { success: false, error: "description is required" };
  if (!Array.isArray(template.items)) return { success: false, error: `${config.itemField} must be an array` };

  try {
    const name = template.name.trim();
    const dir = targetTemplateDir(cwd, config);
    fs.mkdirSync(dir, { recursive: true });
    const filePath = path.join(dir, `${name}.md`);
    const uniqueItems = Array.from(new Set(template.items.map((item) => String(item).trim()).filter(Boolean)));
    const frontmatterLines = [
      `name: ${name}`,
      `description: ${template.description.trim()}`,
      `applyToAll: ${template.applyToAll ? "true" : "false"}`,
      `${config.itemField}: ${uniqueItems.join(", ")}`,
    ];
    const content = `---\n${frontmatterLines.join("\n")}\n---\n`;
    fs.writeFileSync(filePath, content, "utf-8");
    return { success: true, path: filePath };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

export function deleteTemplate(name: string, cwd: string, config: TemplateKindConfig): { success: boolean; error?: string } {
  const nameError = validateTemplateName(name);
  if (nameError) return { success: false, error: nameError };

  try {
    const template = getTemplate(name, cwd, config);
    const filePath = template?.filePath || path.join(templateDir(cwd, config), `${name}.md`);
    if (!fs.existsSync(filePath)) return { success: false, error: "template not found" };
    fs.rmSync(filePath);
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
