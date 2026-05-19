import {
  deleteTemplate,
  discoverTemplates,
  getTemplate,
  saveTemplate,
  type TemplateDefinition,
} from "./template-common.js";

const config = { dirName: "extension-templates", itemField: "extensions", libraryKind: "extensionTemplates" as const };

export type ExtensionTemplate = TemplateDefinition;

export function discoverExtensionTemplates(cwd: string): ExtensionTemplate[] {
  return discoverTemplates(cwd, config);
}

export function getExtensionTemplate(name: string, cwd: string): ExtensionTemplate | undefined {
  return getTemplate(name, cwd, config);
}

export function saveExtensionTemplate(
  template: Omit<ExtensionTemplate, "source" | "filePath">,
  cwd: string
): { success: boolean; path?: string; error?: string } {
  return saveTemplate(template, cwd, config);
}

export function deleteExtensionTemplate(name: string, cwd: string): { success: boolean; error?: string } {
  return deleteTemplate(name, cwd, config);
}
