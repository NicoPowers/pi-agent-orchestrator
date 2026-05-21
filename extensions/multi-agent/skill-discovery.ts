import {
	DefaultResourceLoader,
	getAgentDir,
	parseFrontmatter,
} from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface DiscoveredSkill {
	id: string;
	name: string;
	description?: string;
	path: string;
	filePath: string;
	baseDir: string;
	source?: string;
	scope?: string;
	kind: "directory" | "file";
	audience?: "spawned" | "orchestrator" | "all";
	editable: boolean;
	packageProvided?: boolean;
	ref?: string;
}

export interface SkillDetail {
	skill: DiscoveredSkill;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
	hash: string;
}

export interface SkillFileEntry {
	path: string;
	name: string;
	type: "file" | "directory";
	size?: number;
	markdown?: boolean;
	editable: boolean;
}

export interface SkillFileDetail {
	path: string;
	content: string;
	size: number;
	mtimeMs: number;
	hash: string;
	markdown: boolean;
	editable: boolean;
}

function canonicalPath(p: string): string {
	try {
		return fs.realpathSync(p);
	} catch {
		return path.resolve(p);
	}
}

function skillId(filePath: string): string {
	return crypto
		.createHash("sha256")
		.update(canonicalPath(filePath))
		.digest("base64url");
}

function contentHash(content: string): string {
	return crypto.createHash("sha256").update(content).digest("base64url");
}

function isSubPath(filePath: string, root: string): boolean {
	const relative = path.relative(canonicalPath(root), canonicalPath(filePath));
	return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function editableRoots(cwd: string): string[] {
	return [
		path.join(cwd, ".pi", "skills"),
		path.join(cwd, ".agents", "skills"),
		path.join(getAgentDir(), "skills"),
		path.join(os.homedir(), ".agents", "skills"),
	].filter((root) => fs.existsSync(root));
}

function isEditableSkill(filePath: string, cwd: string): boolean {
	return editableRoots(cwd).some((root) => isSubPath(filePath, root));
}

export function isPackageProvidedSkill(
	filePath: string,
	source?: string,
): boolean {
	const normalized = canonicalPath(filePath).replace(/\\/g, "/");
	const sourceValue = (source || "").toLowerCase();
	if (["package", "npm", "bun"].some((value) => sourceValue.includes(value)))
		return true;
	return (
		normalized.includes("/.pi/agent/npm/node_modules/") ||
		normalized.includes("/.bun/install/global/node_modules/") ||
		normalized.includes("/node_modules/")
	);
}

function compareSkills(a: DiscoveredSkill, b: DiscoveredSkill): number {
	return (
		a.name.localeCompare(b.name) ||
		(a.scope || "").localeCompare(b.scope || "") ||
		a.path.localeCompare(b.path)
	);
}

function skillAudience(filePath: string): DiscoveredSkill["audience"] {
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		const audience =
			typeof frontmatter.audience === "string"
				? frontmatter.audience.trim().toLowerCase()
				: "all";
		return audience === "spawned" ||
			audience === "orchestrator" ||
			audience === "all"
			? audience
			: "all";
	} catch {
		return "all";
	}
}

export function normalizeSkillName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 64)
		.replace(/-$/g, "");
}

export function validateSkillContent(content: string): string | undefined {
	const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
	const name = typeof frontmatter.name === "string" ? frontmatter.name : "";
	const description =
		typeof frontmatter.description === "string" ? frontmatter.description : "";
	if (!name.trim()) return "skill frontmatter name is required";
	if (
		!/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/.test(name) ||
		name.includes("--")
	)
		return "skill name must be lowercase letters, numbers, and single hyphens only";
	if (!description.trim()) return "skill frontmatter description is required";
	if (description.length > 1024)
		return "skill description must be at most 1024 characters";
	return undefined;
}

function resolveSkillFile(
	skill: DiscoveredSkill,
	relativePath: string,
): string | undefined {
	const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
	if (!normalized || normalized.split("/").includes("..")) return undefined;
	const target = path.resolve(skill.baseDir, normalized);
	const base = canonicalPath(skill.baseDir);
	const relative = path.relative(base, path.resolve(target));
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
		return undefined;
	return target;
}

function isTextFile(filePath: string): boolean {
	return /\.(md|txt|json|ya?ml|ts|tsx|js|jsx|sh|py|css|html)$/i.test(filePath);
}

function detailForSkill(skill: DiscoveredSkill): SkillDetail {
	const content = fs.readFileSync(skill.filePath, "utf-8");
	const stat = fs.statSync(skill.filePath);
	const { frontmatter, body } =
		parseFrontmatter<Record<string, unknown>>(content);
	return {
		skill,
		content,
		frontmatter,
		body,
		mtimeMs: stat.mtimeMs,
		hash: contentHash(content),
	};
}

async function loadSkills(cwd: string) {
	const loader = new DefaultResourceLoader({ cwd, agentDir: getAgentDir() });
	await loader.reload();
	return loader.getSkills();
}

const SKILL_DISCOVERY_CACHE_TTL_MS = 15_000;
const skillDiscoveryCache = new Map<
	string,
	{ expiresAt: number; promise: Promise<DiscoveredSkill[]> }
>();

export function invalidateSkillDiscoveryCache(cwd: string): void {
	skillDiscoveryCache.delete(canonicalPath(cwd));
}

export async function discoverSkillDiagnostics(
	cwd: string,
): Promise<Array<{ type: string; message: string; path?: string }>> {
	const { diagnostics } = await loadSkills(cwd);
	return diagnostics.map((diagnostic: any) => ({
		type: diagnostic.type,
		message: diagnostic.message,
		path: diagnostic.path,
	}));
}

async function discoverSkillsUncached(cwd: string): Promise<DiscoveredSkill[]> {
	const { skills } = await loadSkills(cwd);
	const discovered = skills.map((skill: any) => {
		const filePath = skill.filePath;
		const baseDir = skill.baseDir || path.dirname(filePath);
		const kind =
			path.basename(filePath).toLowerCase() === "skill.md"
				? "directory"
				: "file";
		const source = skill.sourceInfo?.source;
		return {
			id: skillId(filePath),
			name: skill.name,
			description: skill.description,
			path: filePath,
			filePath,
			baseDir,
			source,
			scope: skill.sourceInfo?.scope,
			kind,
			audience: skillAudience(filePath),
			editable: isEditableSkill(filePath, cwd),
			packageProvided: isPackageProvidedSkill(filePath, source),
		} satisfies DiscoveredSkill;
	});

	const { discoverConfiguredOrchestratorLibraries } = await import(
		"./orchestrator-library.js"
	);
	const librarySkills = discoverConfiguredOrchestratorLibraries(cwd)
		.resources.filter((resource) => resource.kind === "skills")
		.map((resource) => {
			const kind =
				path.basename(resource.filePath).toLowerCase() === "skill.md"
					? "directory"
					: "file";
			return {
				id: skillId(resource.filePath),
				name: resource.name,
				description: resource.description,
				path: resource.filePath,
				filePath: resource.filePath,
				baseDir:
					kind === "directory"
						? path.dirname(resource.filePath)
						: path.dirname(resource.filePath),
				source: "orchestrator-library",
				scope: resource.libraryName,
				kind,
				audience: skillAudience(resource.filePath),
				editable: resource.editable,
				packageProvided: false,
				ref: resource.id,
			} satisfies DiscoveredSkill;
		});

	const byFilePath = new Map<string, DiscoveredSkill>();
	for (const skill of [...discovered, ...librarySkills])
		byFilePath.set(canonicalPath(skill.filePath), skill);
	return Array.from(byFilePath.values()).sort(compareSkills);
}

export async function discoverSkills(cwd: string): Promise<DiscoveredSkill[]> {
	const key = canonicalPath(cwd);
	const now = Date.now();
	const cached = skillDiscoveryCache.get(key);
	if (cached && cached.expiresAt > now) return cached.promise;
	const promise = discoverSkillsUncached(cwd).catch((err) => {
		skillDiscoveryCache.delete(key);
		throw err;
	});
	skillDiscoveryCache.set(key, {
		expiresAt: now + SKILL_DISCOVERY_CACHE_TTL_MS,
		promise,
	});
	return promise;
}

export async function getSkillDetail(
	id: string,
	cwd: string,
): Promise<SkillDetail | undefined> {
	const skills = await discoverSkills(cwd);
	const skill = skills.find((candidate) => candidate.id === id);
	if (!skill) return undefined;
	return detailForSkill(skill);
}

function targetSkillRoot(
	scope: "project" | "global" | undefined,
	cwd: string,
): string {
	return scope === "global"
		? path.join(getAgentDir(), "skills")
		: path.join(cwd, ".pi", "skills");
}

async function resolveCreateSkillTarget(
	input: { scope?: "project" | "global"; targetLibrary?: string },
	cwd: string,
): Promise<{
	root: string;
	source?: string;
	scope?: string;
	error?: string;
	status?: number;
}> {
	const { discoverConfiguredOrchestratorLibraries } = await import(
		"./orchestrator-library.js"
	);
	const libraries = discoverConfiguredOrchestratorLibraries(
		cwd,
	).libraries.filter((library) => library.valid && library.manifest);
	if (input.targetLibrary) {
		const library = libraries.find(
			(candidate) =>
				candidate.manifest?.name === input.targetLibrary ||
				candidate.root === input.targetLibrary,
		);
		if (!library?.manifest)
			return {
				root: "",
				error: `Orchestrator Library '${input.targetLibrary}' not found`,
				status: 404,
			};
		return {
			root: library.resourceDirs.skills.resolvedPath,
			source: "orchestrator-library",
			scope: library.manifest.name,
		};
	}
	if (!input.scope && libraries[0]?.manifest) {
		return {
			root: libraries[0].resourceDirs.skills.resolvedPath,
			source: "orchestrator-library",
			scope: libraries[0].manifest.name,
		};
	}
	if (!input.scope)
		return { root: targetSkillRoot("global", cwd), scope: "global" };
	return { root: targetSkillRoot(input.scope, cwd), scope: input.scope };
}

function yamlScalar(value: unknown): string {
	if (typeof value === "string")
		return /^[a-z0-9][a-z0-9 .,_/'!?()-]*$/i.test(value)
			? value
			: JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}

function serializeFrontmatter(frontmatter: Record<string, unknown>): string {
	return Object.entries(frontmatter)
		.filter(([, value]) => value !== undefined)
		.map(([key, value]) => `${key}: ${yamlScalar(value)}`)
		.join("\n");
}

function copySkillTree(source: DiscoveredSkill, targetDir: string): void {
	fs.mkdirSync(targetDir, { recursive: true });
	if (source.kind === "directory") {
		fs.cpSync(source.baseDir, targetDir, {
			recursive: true,
			filter: (src) => {
				const name = path.basename(src);
				if ([".git", "node_modules"].includes(name)) return false;
				try {
					return !fs.lstatSync(src).isSymbolicLink();
				} catch {
					return false;
				}
			},
		});
	} else {
		fs.copyFileSync(source.filePath, path.join(targetDir, "SKILL.md"));
	}
}

export async function createSkill(
	input: {
		scope?: "project" | "global";
		targetLibrary?: string;
		name: string;
		description: string;
		body?: string;
		scaffold?: "minimal" | "rich";
	},
	cwd: string,
): Promise<{
	success: boolean;
	detail?: SkillDetail;
	error?: string;
	status?: number;
}> {
	const name = normalizeSkillName(input.name || "");
	if (!name) return { success: false, error: "name is required", status: 400 };
	if (!input.description?.trim())
		return { success: false, error: "description is required", status: 400 };
	if (input.description.length > 1024)
		return {
			success: false,
			error: "description must be at most 1024 characters",
			status: 400,
		};

	const target = await resolveCreateSkillTarget(input, cwd);
	if (target.error)
		return {
			success: false,
			error: target.error,
			status: target.status || 400,
		};
	const dir = path.join(target.root, name);
	const filePath = path.join(dir, "SKILL.md");
	if (fs.existsSync(filePath) || fs.existsSync(dir))
		return { success: false, error: "skill already exists", status: 409 };

	const title = name
		.split("-")
		.map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
		.join(" ");
	const body =
		input.body?.trim() ||
		(input.scaffold === "rich"
			? `# ${title}\n\n## When to use\n\nUse this skill when ...\n\n## Workflow\n\n1. ...\n\n## References\n\n- [Reference notes](references/README.md)\n- [Examples](examples/README.md)\n- [Scripts](scripts/README.md)\n- [Assets](assets/README.md)`
			: `# ${title}\n\n## When to use\n\nUse this skill when ...\n\n## Workflow\n\n1. ...`);
	const content = `---\nname: ${name}\ndescription: ${input.description.trim()}\n---\n\n${body}\n`;
	const validationError = validateSkillContent(content);
	if (validationError)
		return { success: false, error: validationError, status: 400 };

	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
	if (input.scaffold === "rich") {
		for (const child of ["references", "scripts", "assets", "examples"]) {
			const childDir = path.join(dir, child);
			fs.mkdirSync(childDir, { recursive: true });
			fs.writeFileSync(
				path.join(childDir, "README.md"),
				`# ${child[0].toUpperCase() + child.slice(1)}\n\nAdd ${child} for ${name} here.\n`,
				"utf-8",
			);
		}
	}
	invalidateSkillDiscoveryCache(cwd);
	const skills = await discoverSkills(cwd);
	const skill = skills.find(
		(candidate) =>
			canonicalPath(candidate.filePath) === canonicalPath(filePath),
	);
	if (!skill)
		return {
			success: false,
			error: "created skill was not discovered",
			status: 500,
		};
	return { success: true, detail: detailForSkill(skill) };
}

export async function copySkill(
	id: string,
	input: { scope?: "project" | "global"; name: string; description: string },
	cwd: string,
): Promise<{
	success: boolean;
	detail?: SkillDetail;
	error?: string;
	status?: number;
}> {
	const skills = await discoverSkills(cwd);
	const source = skills.find((candidate) => candidate.id === id);
	if (!source) return { success: false, error: "Skill not found", status: 404 };

	const name = normalizeSkillName(input.name || "");
	if (!name) return { success: false, error: "name is required", status: 400 };
	if (name === source.name)
		return {
			success: false,
			error: "new skill name must differ from the source skill name",
			status: 400,
		};
	if (!input.description?.trim())
		return { success: false, error: "description is required", status: 400 };
	if (input.description.length > 1024)
		return {
			success: false,
			error: "description must be at most 1024 characters",
			status: 400,
		};
	if (skills.some((candidate) => candidate.name === name)) {
		return {
			success: false,
			error: `skill name '${name}' already exists; duplicate skill names collide and Pi keeps the first discovered skill`,
			status: 409,
		};
	}

	const root = targetSkillRoot(input.scope, cwd);
	const dir = path.join(root, name);
	const filePath = path.join(dir, "SKILL.md");
	if (fs.existsSync(filePath) || fs.existsSync(dir))
		return { success: false, error: "skill already exists", status: 409 };

	try {
		copySkillTree(source, dir);
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter, body } =
			parseFrontmatter<Record<string, unknown>>(content);
		const nextFrontmatter = {
			...frontmatter,
			name,
			description: input.description.trim(),
		};
		const nextContent = `---\n${serializeFrontmatter(nextFrontmatter)}\n---\n${body.startsWith("\n") ? body : `\n${body}`}`;
		const validationError = validateSkillContent(nextContent);
		if (validationError) {
			fs.rmSync(dir, { recursive: true, force: true });
			return { success: false, error: validationError, status: 400 };
		}
		fs.writeFileSync(filePath, nextContent, "utf-8");
	} catch (err: any) {
		fs.rmSync(dir, { recursive: true, force: true });
		return {
			success: false,
			error: `failed to copy skill: ${err?.message || String(err)}`,
			status: 500,
		};
	}

	invalidateSkillDiscoveryCache(cwd);
	const nextSkill = (await discoverSkills(cwd)).find(
		(candidate) =>
			canonicalPath(candidate.filePath) === canonicalPath(filePath),
	);
	if (!nextSkill)
		return {
			success: false,
			error: "copied skill was not discovered",
			status: 500,
		};
	return { success: true, detail: detailForSkill(nextSkill) };
}

export async function getSkillTree(
	id: string,
	cwd: string,
): Promise<{
	success: boolean;
	files?: SkillFileEntry[];
	error?: string;
	status?: number;
}> {
	const skill = (await discoverSkills(cwd)).find(
		(candidate) => candidate.id === id,
	);
	if (!skill) return { success: false, error: "Skill not found", status: 404 };
	if (skill.kind !== "directory")
		return {
			success: true,
			files: [
				{
					path: path.basename(skill.filePath),
					name: path.basename(skill.filePath),
					type: "file",
					size: fs.statSync(skill.filePath).size,
					markdown: true,
					editable: skill.editable,
				},
			],
		};
	const files: SkillFileEntry[] = [];
	const walk = (dir: string, prefix = "") => {
		for (const entry of fs
			.readdirSync(dir, { withFileTypes: true })
			.sort((a, b) => a.name.localeCompare(b.name))) {
			if ([".git", "node_modules"].includes(entry.name)) continue;
			const full = path.join(dir, entry.name);
			const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
			if (entry.isDirectory()) {
				files.push({
					path: rel,
					name: entry.name,
					type: "directory",
					editable: false,
				});
				if (files.length < 500) walk(full, rel);
			} else if (entry.isFile()) {
				const stat = fs.statSync(full);
				files.push({
					path: rel,
					name: entry.name,
					type: "file",
					size: stat.size,
					markdown: /\.md$/i.test(entry.name),
					editable: skill.editable && isTextFile(full),
				});
			}
			if (files.length >= 500) return;
		}
	};
	walk(skill.baseDir);
	return { success: true, files };
}

export async function getSkillFile(
	id: string,
	relativePath: string,
	cwd: string,
): Promise<{
	success: boolean;
	file?: SkillFileDetail;
	error?: string;
	status?: number;
}> {
	const skill = (await discoverSkills(cwd)).find(
		(candidate) => candidate.id === id,
	);
	if (!skill) return { success: false, error: "Skill not found", status: 404 };
	const target = resolveSkillFile(skill, relativePath);
	if (!target)
		return { success: false, error: "Invalid skill file path", status: 400 };
	if (!fs.existsSync(target) || !fs.statSync(target).isFile())
		return { success: false, error: "Skill file not found", status: 404 };
	const stat = fs.statSync(target);
	if (!isTextFile(target) || stat.size > 512_000)
		return {
			success: false,
			error: "Skill file is not previewable text",
			status: 415,
		};
	const content = fs.readFileSync(target, "utf-8");
	return {
		success: true,
		file: {
			path: relativePath.replace(/\\/g, "/").replace(/^\/+/, ""),
			content,
			size: stat.size,
			mtimeMs: stat.mtimeMs,
			hash: contentHash(content),
			markdown: /\.md$/i.test(target),
			editable: skill.editable && isTextFile(target),
		},
	};
}

export async function updateSkillFile(
	id: string,
	relativePath: string,
	input: { content: string; expectedHash?: string },
	cwd: string,
): Promise<{
	success: boolean;
	file?: SkillFileDetail;
	error?: string;
	status?: number;
}> {
	const skill = (await discoverSkills(cwd)).find(
		(candidate) => candidate.id === id,
	);
	if (!skill) return { success: false, error: "Skill not found", status: 404 };
	if (!skill.editable)
		return { success: false, error: "Skill is read-only", status: 403 };
	const target = resolveSkillFile(skill, relativePath);
	if (!target)
		return { success: false, error: "Invalid skill file path", status: 400 };
	if (!fs.existsSync(target) || !fs.statSync(target).isFile())
		return { success: false, error: "Skill file not found", status: 404 };
	if (!isTextFile(target))
		return {
			success: false,
			error: "Skill file is not editable text",
			status: 415,
		};
	const current = fs.readFileSync(target, "utf-8");
	if (input.expectedHash && input.expectedHash !== contentHash(current))
		return {
			success: false,
			error: "Skill file changed on disk; refresh before saving",
			status: 409,
		};
	fs.writeFileSync(target, input.content, "utf-8");
	invalidateSkillDiscoveryCache(cwd);
	return getSkillFile(id, relativePath, cwd);
}

export async function updateSkill(
	id: string,
	input: { content: string; expectedHash?: string },
	cwd: string,
): Promise<{
	success: boolean;
	detail?: SkillDetail;
	error?: string;
	status?: number;
}> {
	const skills = await discoverSkills(cwd);
	const skill = skills.find((candidate) => candidate.id === id);
	if (!skill) return { success: false, error: "Skill not found", status: 404 };
	if (!skill.editable)
		return { success: false, error: "Skill is read-only", status: 403 };
	if (typeof input.content !== "string")
		return { success: false, error: "content is required", status: 400 };
	const current = detailForSkill(skill);
	if (input.expectedHash && input.expectedHash !== current.hash)
		return {
			success: false,
			error: "Skill changed on disk; refresh before saving",
			status: 409,
		};
	const validationError = validateSkillContent(input.content);
	if (validationError)
		return { success: false, error: validationError, status: 400 };
	fs.writeFileSync(skill.filePath, input.content, "utf-8");
	invalidateSkillDiscoveryCache(cwd);
	return { success: true, detail: detailForSkill(skill) };
}

export async function deleteSkill(
	id: string,
	cwd: string,
): Promise<{ success: boolean; error?: string; status?: number }> {
	const skills = await discoverSkills(cwd);
	const skill = skills.find((candidate) => candidate.id === id);
	if (!skill) return { success: false, error: "Skill not found", status: 404 };
	if (!skill.editable)
		return { success: false, error: "Skill is read-only", status: 403 };
	if (skill.kind === "directory")
		fs.rmSync(skill.baseDir, { recursive: true, force: true });
	else fs.rmSync(skill.filePath, { force: true });
	invalidateSkillDiscoveryCache(cwd);
	return { success: true };
}
