import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSkillPath } from "./definitions.js";
import { discoverSkillTemplates } from "./skill-templates.js";
import { discoverExtensionTemplates } from "./extension-templates.js";
import { resolveLatticeLibraryResourceRef } from "./lattice-library.js";
import type { AgentDefinition } from "./state.js";
import type { TemplateAudience, TemplateAutoApply } from "./template-common.js";

export type CapabilityTarget = "spawned" | "orchestrator";

export interface ExtensionRef {
  name: string;
  path: string;
  scope?: string;
}

export interface ResolvedCapabilities {
  skills?: string[];
  extensions: ExtensionRef[];
  missingExtensionTemplates: string[];
  missingExtensions: string[];
  skillConflicts: Array<{ name: string; paths: string[] }>;
  errors: string[];
}

function uniqueStrings(items: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const value = item?.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function resolveSkillRef(item: string, templateFilePath: string, cwd: string): string {
  const libraryResource = resolveLatticeLibraryResourceRef(item, cwd, "skills");
  if (libraryResource) return libraryResource.filePath;
  return resolveSkillPath(item, path.dirname(templateFilePath), cwd);
}

function skillFilePath(skillPath: string): string {
  try {
    return fs.statSync(skillPath).isDirectory() ? path.join(skillPath, "SKILL.md") : skillPath;
  } catch {
    return skillPath;
  }
}

function skillFrontmatter(skillPath: string): Record<string, unknown> | undefined {
  try {
    const content = fs.readFileSync(skillFilePath(skillPath), "utf-8");
    return parseFrontmatter<Record<string, unknown>>(content).frontmatter;
  } catch {
    return undefined;
  }
}

function skillRuntimeName(skillPath: string): string | undefined {
  const frontmatter = skillFrontmatter(skillPath);
  return typeof frontmatter?.name === "string" ? frontmatter.name.trim() : undefined;
}

function parseSkillAudience(skillPath: string): TemplateAudience {
  const value = skillFrontmatter(skillPath)?.audience;
  if (typeof value !== "string") return "all";
  const normalized = value.trim().toLowerCase();
  if (normalized === "spawned" || normalized === "orchestrator" || normalized === "all") return normalized;
  return "all";
}

function audienceAllows(target: CapabilityTarget, audience: TemplateAudience): boolean {
  return audience === "all" || audience === target;
}

function audienceErrorLabel(audience: TemplateAudience): string {
  if (audience === "orchestrator") return "only available to the orchestrator";
  if (audience === "spawned") return "only available to spawned agents";
  return "not available to this target";
}

function autoAppliesToTarget(autoApply: TemplateAutoApply, target: CapabilityTarget): boolean {
  if (autoApply === "all") return true;
  if (autoApply === "spawned") return target === "spawned";
  return false;
}

function findSkillConflicts(skillPaths: string[]): Array<{ name: string; paths: string[] }> {
  const byName = new Map<string, string[]>();
  for (const skillPath of skillPaths) {
    const name = skillRuntimeName(skillPath);
    if (!name) continue;
    byName.set(name, [...(byName.get(name) || []), skillPath]);
  }
  return Array.from(byName.entries())
    .filter(([, paths]) => paths.length > 1)
    .map(([name, paths]) => ({ name, paths }));
}

function uniqueExtensions(items: ExtensionRef[]): ExtensionRef[] {
  const seen = new Set<string>();
  const result: ExtensionRef[] = [];
  for (const item of items) {
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    result.push(item);
  }
  return result;
}

export function resolveCapabilities(options: {
  cwd: string;
  definition?: AgentDefinition;
  requestedExtensions?: string[];
  availableExtensions: ExtensionRef[];
  target?: CapabilityTarget;
}): ResolvedCapabilities {
  const { cwd, definition, requestedExtensions = [], availableExtensions, target = "spawned" } = options;
  const skillTemplates = discoverSkillTemplates(cwd);
  const extensionTemplates = discoverExtensionTemplates(cwd);
  const errors: string[] = [];

  const selectedSkillTemplateNames = new Set(definition?.skillTemplates || []);
  const selectedExtensionTemplateNames = new Set(definition?.extensionTemplates || []);

  const missingExtensionTemplates = [...selectedExtensionTemplateNames]
    .filter((name) => !extensionTemplates.some((template) => template.name === name));

  const skillTemplateItems = skillTemplates
    .filter((template) => autoAppliesToTarget(template.autoApply, target) || selectedSkillTemplateNames.has(template.name))
    .flatMap((template) => {
      if (template.validationErrors.length) {
        errors.push(...template.validationErrors.map((error) => `Skill template '${template.name}' is invalid: ${error}`));
        return [];
      }
      if (!audienceAllows(target, template.audience)) {
        errors.push(`Skill template '${template.name}' is ${audienceErrorLabel(template.audience)}`);
        return [];
      }
      return template.items.map((item) => resolveSkillRef(item, template.filePath, cwd));
    });

  const directSkills = (definition?.skills || []).map((item) => resolveLatticeLibraryResourceRef(item, cwd, "skills")?.filePath || item);
  const skills = uniqueStrings([...directSkills, ...skillTemplateItems]);
  for (const skillPath of skills) {
    const audience = parseSkillAudience(skillPath);
    if (!audienceAllows(target, audience)) {
      const name = skillRuntimeName(skillPath) || path.basename(skillPath);
      errors.push(`Skill '${name}' is ${audienceErrorLabel(audience)}: ${skillPath}`);
    }
  }

  if (target === "orchestrator" && (requestedExtensions.length || selectedExtensionTemplateNames.size)) {
    errors.push("Extension templates and requested extensions are only available to spawned agents");
  }

  const extensionNames = target === "spawned" ? uniqueStrings([
    ...requestedExtensions,
    ...extensionTemplates
      .filter((template) => autoAppliesToTarget(template.autoApply, "spawned") || selectedExtensionTemplateNames.has(template.name))
      .flatMap((template) => {
        if (template.validationErrors.length) {
          errors.push(...template.validationErrors.map((error) => `Extension template '${template.name}' is invalid: ${error}`));
          return [];
        }
        if (!audienceAllows("spawned", template.audience)) {
          errors.push(`Extension template '${template.name}' is ${audienceErrorLabel(template.audience)}`);
          return [];
        }
        return template.items;
      }),
  ]) : [];

  const resolvedExtensions: ExtensionRef[] = [];
  const missingExtensions: string[] = [];
  for (const name of extensionNames) {
    const extension = availableExtensions.find((candidate) => candidate.name === name);
    if (extension) resolvedExtensions.push(extension);
    else missingExtensions.push(name);
  }

  return {
    skills: skills.length ? skills : undefined,
    extensions: uniqueExtensions(resolvedExtensions),
    missingExtensionTemplates,
    missingExtensions,
    skillConflicts: findSkillConflicts(skills),
    errors,
  };
}
