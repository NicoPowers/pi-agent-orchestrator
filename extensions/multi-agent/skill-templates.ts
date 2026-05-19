import {
  deleteTemplate,
  discoverTemplates,
  getTemplate,
  saveTemplate,
  type TemplateDefinition,
} from "./template-common.js";

const config = { dirName: "skill-templates", itemField: "skills", libraryKind: "skillTemplates" as const };

export type SkillTemplate = TemplateDefinition;

export function discoverSkillTemplates(cwd: string): SkillTemplate[] {
  return discoverTemplates(cwd, config);
}

export function getSkillTemplate(name: string, cwd: string): SkillTemplate | undefined {
  return getTemplate(name, cwd, config);
}

export function saveSkillTemplate(
  template: Omit<SkillTemplate, "source" | "filePath">,
  cwd: string
): { success: boolean; path?: string; error?: string } {
  return saveTemplate(template, cwd, config);
}

export function deleteSkillTemplate(name: string, cwd: string): { success: boolean; error?: string } {
  return deleteTemplate(name, cwd, config);
}
