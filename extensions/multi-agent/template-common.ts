import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as path from "node:path";
import { discoverConfiguredLatticeLibraries } from "./lattice-library.js";

export type TemplateAudience = "spawned" | "orchestrator" | "all";
export type TemplateAutoApply = "none" | "spawned" | "all";

export interface TemplateDefinition {
	name: string;
	description: string;
	items: string[];
	audience: TemplateAudience;
	autoApply: TemplateAutoApply;
	/** Legacy alias: true only when autoApply is "spawned". */
	applyToAll?: boolean;
	validationErrors: string[];
	source: "project" | "lattice-library";
	scope?: string;
	filePath: string;
}

export interface TemplateKindConfig {
	dirName: string;
	itemField: string;
	libraryKind?: "skillTemplates" | "extensionTemplates";
	supportsOrchestratorAudience?: boolean;
}

function safeTemplateName(name: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.includes("..");
}

function parseList(value: unknown): string[] {
	if (Array.isArray(value))
		return value
			.map(String)
			.map((s) => s.trim())
			.filter(Boolean);
	if (typeof value !== "string") return [];
	return value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

function parseApplyToAll(value: unknown): boolean | undefined {
	if (typeof value === "boolean") return value;
	if (typeof value !== "string") return undefined;
	if (["true", "yes", "1"].includes(value.toLowerCase())) return true;
	if (["false", "no", "0"].includes(value.toLowerCase())) return false;
	return undefined;
}

function parseAudience(value: unknown): TemplateAudience | undefined {
	if (typeof value !== "string") return undefined;
	const normalized = value.trim().toLowerCase();
	if (["spawned", "orchestrator", "all"].includes(normalized))
		return normalized as TemplateAudience;
	return undefined;
}

function parseAutoApply(
	value: unknown,
	legacyApplyToAll: boolean | undefined,
): TemplateAutoApply | undefined {
	if (typeof value === "string") {
		const normalized = value.trim().toLowerCase();
		if (["none", "manual", "specific"].includes(normalized)) return "none";
		if (["spawned", "all-spawned", "spawned-agents"].includes(normalized))
			return "spawned";
		if (["all", "everywhere"].includes(normalized)) return "all";
	}
	if (typeof value === "boolean") return value ? "spawned" : "none";
	if (legacyApplyToAll !== undefined)
		return legacyApplyToAll ? "spawned" : "none";
	return undefined;
}

export function defaultTemplateAudience(
	config: TemplateKindConfig,
): TemplateAudience {
	return config.supportsOrchestratorAudience ? "spawned" : "spawned";
}

export function defaultTemplateAutoApply(): TemplateAutoApply {
	return "none";
}

export function validateTemplateAudienceAutoApply(
	audience: TemplateAudience,
	autoApply: TemplateAutoApply,
	config: TemplateKindConfig,
): string[] {
	const errors: string[] = [];
	if (!config.supportsOrchestratorAudience && audience !== "spawned") {
		errors.push("extension templates are only available to spawned agents");
	}
	if (!config.supportsOrchestratorAudience && autoApply === "all") {
		errors.push("extension templates cannot auto-apply to the orchestrator");
	}
	if (autoApply === "spawned" && audience !== "spawned" && audience !== "all") {
		errors.push("autoApply: spawned requires audience spawned or all");
	}
	if (autoApply === "all" && audience !== "all") {
		errors.push("autoApply: all requires audience all");
	}
	return errors;
}

export function templateDir(cwd: string, config: TemplateKindConfig): string {
	return path.join(cwd, ".pi", config.dirName);
}

export function validateTemplateName(name: unknown): string | undefined {
	if (typeof name !== "string" || !name.trim()) return "name is required";
	if (!safeTemplateName(name))
		return "name may only contain letters, numbers, dot, underscore, and dash";
	return undefined;
}

function readTemplateFile(
	filePath: string,
	config: TemplateKindConfig,
	source: TemplateDefinition["source"],
	scope?: string,
): TemplateDefinition | undefined {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
	const name =
		typeof frontmatter.name === "string" ? frontmatter.name.trim() : "";
	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description.trim()
			: "";
	if (!name || !description || validateTemplateName(name)) return undefined;
	const legacyApplyToAll = parseApplyToAll(frontmatter.applyToAll);
	const audience =
		parseAudience(frontmatter.audience) || defaultTemplateAudience(config);
	const autoApply =
		parseAutoApply(frontmatter.autoApply, legacyApplyToAll) ||
		defaultTemplateAutoApply();
	return {
		name,
		description,
		items: parseList(frontmatter[config.itemField] ?? frontmatter.items),
		audience,
		autoApply,
		applyToAll: autoApply === "spawned",
		validationErrors: validateTemplateAudienceAutoApply(
			audience,
			autoApply,
			config,
		),
		source,
		scope,
		filePath,
	};
}

export function discoverTemplates(
	cwd: string,
	config: TemplateKindConfig,
): TemplateDefinition[] {
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
			const template = readTemplateFile(
				path.join(dir, entry.name),
				config,
				"project",
			);
			if (template) templates.push(template);
		}
	}

	if (config.libraryKind) {
		for (const resource of discoverConfiguredLatticeLibraries(
			cwd,
		).resources.filter((resource) => resource.kind === config.libraryKind)) {
			const template = readTemplateFile(
				resource.filePath,
				config,
				"lattice-library",
				resource.libraryName,
			);
			if (template) templates.push(template);
		}
	}

	const byName = new Map<string, TemplateDefinition>();
	for (const template of templates.sort((a, b) =>
		a.name.localeCompare(b.name),
	)) {
		if (
			!byName.has(template.name) ||
			byName.get(template.name)?.source !== "lattice-library"
		)
			byName.set(template.name, template);
	}
	return Array.from(byName.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export function getTemplate(
	name: string,
	cwd: string,
	config: TemplateKindConfig,
): TemplateDefinition | undefined {
	return discoverTemplates(cwd, config).find(
		(template) => template.name === name,
	);
}

function targetTemplateDir(
	cwd: string,
	config: TemplateKindConfig,
	targetLibrary?: string,
	targetScope?: "project",
): { dir: string; error?: string } {
	if (targetScope === "project") return { dir: templateDir(cwd, config) };
	if (config.libraryKind) {
		const libraries = discoverConfiguredLatticeLibraries(
			cwd,
		).libraries.filter((candidate) => candidate.valid && candidate.manifest);
		if (targetLibrary) {
			const library = libraries.find(
				(candidate) =>
					candidate.manifest?.name === targetLibrary ||
					candidate.root === targetLibrary,
			);
			if (!library?.manifest)
				return {
					dir: "",
					error: `Lattice Library '${targetLibrary}' not found`,
				};
			return { dir: library.resourceDirs[config.libraryKind].resolvedPath };
		}
		const library = libraries[0];
		if (library?.manifest)
			return { dir: library.resourceDirs[config.libraryKind].resolvedPath };
	}
	return { dir: templateDir(cwd, config) };
}

export function saveTemplate(
	template: Partial<
		Omit<TemplateDefinition, "source" | "filePath" | "validationErrors">
	> &
		Pick<TemplateDefinition, "name" | "description" | "items"> & {
			targetLibrary?: string;
			targetScope?: "project";
		},
	cwd: string,
	config: TemplateKindConfig,
): { success: boolean; path?: string; error?: string } {
	const nameError = validateTemplateName(template.name);
	if (nameError) return { success: false, error: nameError };
	if (!template.description?.trim())
		return { success: false, error: "description is required" };
	if (!Array.isArray(template.items))
		return { success: false, error: `${config.itemField} must be an array` };

	const audience = template.audience || defaultTemplateAudience(config);
	const autoApply =
		template.autoApply ||
		(template.applyToAll ? "spawned" : defaultTemplateAutoApply());
	const validationErrors = validateTemplateAudienceAutoApply(
		audience,
		autoApply,
		config,
	);
	if (validationErrors.length)
		return { success: false, error: validationErrors.join("; ") };

	try {
		const name = template.name.trim();
		const target = targetTemplateDir(
			cwd,
			config,
			template.targetLibrary,
			template.targetScope,
		);
		if (target.error) return { success: false, error: target.error };
		const dir = target.dir;
		fs.mkdirSync(dir, { recursive: true });
		const filePath = path.join(dir, `${name}.md`);
		const uniqueItems = Array.from(
			new Set(
				template.items.map((item) => String(item).trim()).filter(Boolean),
			),
		);
		const frontmatterLines = [
			`name: ${name}`,
			`description: ${template.description.trim()}`,
			`audience: ${audience}`,
			`autoApply: ${autoApply}`,
			`${config.itemField}: ${uniqueItems.join(", ")}`,
		];
		const content = `---\n${frontmatterLines.join("\n")}\n---\n`;
		fs.writeFileSync(filePath, content, "utf-8");
		return { success: true, path: filePath };
	} catch (err: any) {
		return { success: false, error: err.message };
	}
}

export function deleteTemplate(
	name: string,
	cwd: string,
	config: TemplateKindConfig,
): { success: boolean; error?: string } {
	const nameError = validateTemplateName(name);
	if (nameError) return { success: false, error: nameError };

	try {
		const template = getTemplate(name, cwd, config);
		const filePath =
			template?.filePath || path.join(templateDir(cwd, config), `${name}.md`);
		if (!fs.existsSync(filePath))
			return { success: false, error: "template not found" };
		fs.rmSync(filePath);
		return { success: true };
	} catch (err: any) {
		return { success: false, error: err.message };
	}
}
