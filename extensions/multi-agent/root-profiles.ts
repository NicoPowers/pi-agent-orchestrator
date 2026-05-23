import { getAgentDir, parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { resolveSkillPath } from "./definitions.js";
import { discoverConfiguredLatticeLibraries } from "./lattice-library.js";
import { resolveCapabilities } from "./capability-resolution.js";
import { resolveLatticeLibraryResourceRef } from "./lattice-library.js";
import type { AgentDefinition } from "./state.js";

export interface RootOrchestratorProfile {
	name: string;
	description: string;
	skills?: string[];
	skillTemplates?: string[];
	instructions: string;
	source: "user" | "project" | "package" | "lattice-library";
	scope?: string;
	filePath: string;
	readOnly?: boolean;
}

export interface RootOrchestratorProfileDetail {
	profile: RootOrchestratorProfile;
	content: string;
	frontmatter: Record<string, unknown>;
	body: string;
	mtimeMs: number;
	hash: string;
}

export interface SaveRootProfileInput {
	targetLibrary?: string;
	name: string;
	description: string;
	skills?: string[];
	skillTemplates?: string[];
	instructions?: string;
	expectedHash?: string;
}

export type RootProfileActivationChoice =
	| { action: "activate"; profile: RootOrchestratorProfile }
	| { action: "select"; profiles: RootOrchestratorProfile[] }
	| { action: "error"; error: string };

export interface ResolvedRootProfileCapabilities {
	skills: string[];
	errors: string[];
	skillConflicts: Array<{ name: string; paths: string[] }>;
}

function isDirectory(p: string): boolean {
	try {
		return fs.statSync(p).isDirectory();
	} catch {
		return false;
	}
}

function contentHash(content: string): string {
	return crypto.createHash("sha256").update(content).digest("base64url");
}

function safeProfileName(name: string): boolean {
	return /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) && !name.includes("..");
}

function yamlScalar(value: unknown): string {
	if (typeof value === "string")
		return /^[a-z0-9][a-z0-9 .,_/'!?():-]*$/i.test(value)
			? value
			: JSON.stringify(value);
	if (typeof value === "number" || typeof value === "boolean")
		return String(value);
	return JSON.stringify(value);
}

function serializeProfile(input: SaveRootProfileInput): string {
	const skills = Array.from(
		new Set(
			(input.skills || [])
				.map(String)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	);
	const skillTemplates = Array.from(
		new Set(
			(input.skillTemplates || [])
				.map(String)
				.map((s) => s.trim())
				.filter(Boolean),
		),
	);
	const frontmatterLines = [
		`name: ${yamlScalar(input.name.trim())}`,
		`description: ${yamlScalar(input.description.trim())}`,
		skills.length ? `skills: ${skills.join(", ")}` : undefined,
		skillTemplates.length
			? `skillTemplates: ${skillTemplates.join(", ")}`
			: undefined,
	].filter(Boolean) as string[];
	const instructions = input.instructions || "";
	return `---\n${frontmatterLines.join("\n")}\n---\n\n${instructions}${instructions.endsWith("\n") || !instructions ? "" : "\n"}`;
}

function packageProfilesDir(): string | undefined {
	try {
		const candidate = path.join(__dirname, "..", "..", "orchestrator-profiles");
		if (isDirectory(candidate)) return candidate;
	} catch {
		/* __dirname may not be available in some loaders */
	}
	const fallback = path.resolve(process.cwd(), "orchestrator-profiles");
	return isDirectory(fallback) ? fallback : undefined;
}

function projectProfilesDir(cwd: string): string | undefined {
	let currentDir = cwd;
	while (true) {
		const candidate = path.join(currentDir, ".pi", "orchestrator-profiles");
		if (isDirectory(candidate)) return candidate;
		const parentDir = path.dirname(currentDir);
		if (parentDir === currentDir) return undefined;
		currentDir = parentDir;
	}
}

function parseList(value: unknown): string[] | undefined {
	if (Array.isArray(value)) {
		const items = value
			.map(String)
			.map((s) => s.trim())
			.filter(Boolean);
		return items.length ? items : undefined;
	}
	if (typeof value !== "string") return undefined;
	const items = value
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	return items.length ? items : undefined;
}

function readProfileFile(
	filePath: string,
	source: RootOrchestratorProfile["source"],
	cwd: string,
	scope?: string,
): RootOrchestratorProfile | undefined {
	let content: string;
	try {
		content = fs.readFileSync(filePath, "utf-8");
	} catch {
		return undefined;
	}
	const { frontmatter, body } =
		parseFrontmatter<Record<string, unknown>>(content);
	const name =
		typeof frontmatter.name === "string" && frontmatter.name.trim()
			? frontmatter.name.trim()
			: path.basename(filePath, ".md");
	const description =
		typeof frontmatter.description === "string"
			? frontmatter.description.trim()
			: "Root profile";
	if (!safeProfileName(name)) return undefined;
	const baseDir = path.dirname(filePath);
	const skills = parseList(frontmatter.skills)?.map(
		(item) =>
			resolveLatticeLibraryResourceRef(item, cwd, "skills")?.filePath ||
			resolveSkillPath(item, baseDir, cwd),
	);
	const skillTemplates = parseList(frontmatter.skillTemplates);
	return {
		name,
		description,
		skills,
		skillTemplates,
		instructions: body.startsWith("\n") ? body.slice(1) : body,
		source,
		scope,
		filePath,
		readOnly: source === "package",
	};
}

function profileDetail(
	profile: RootOrchestratorProfile,
): RootOrchestratorProfileDetail | undefined {
	try {
		const content = fs.readFileSync(profile.filePath, "utf-8");
		const stat = fs.statSync(profile.filePath);
		const { frontmatter, body } =
			parseFrontmatter<Record<string, unknown>>(content);
		return {
			profile,
			content,
			frontmatter,
			body: body.startsWith("\n") ? body.slice(1) : body,
			mtimeMs: stat.mtimeMs,
			hash: contentHash(content),
		};
	} catch {
		return undefined;
	}
}

function loadProfilesFromDir(
	dir: string | undefined,
	source: RootOrchestratorProfile["source"],
	cwd: string,
	scope?: string,
): RootOrchestratorProfile[] {
	if (!dir || !isDirectory(dir)) return [];
	let entries: fs.Dirent[] = [];
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const profiles: RootOrchestratorProfile[] = [];
	for (const entry of entries) {
		if (!entry.name.endsWith(".md")) continue;
		if (!entry.isFile() && !entry.isSymbolicLink()) continue;
		const profile = readProfileFile(
			path.join(dir, entry.name),
			source,
			cwd,
			scope,
		);
		if (profile) profiles.push(profile);
	}
	return profiles;
}

function libraryProfilePathFromManifest(
	library: ReturnType<
		typeof discoverConfiguredLatticeLibraries
	>["libraries"][number],
): string | undefined {
	if (!library.valid || !library.manifest) return undefined;
	let rawResources: Record<string, unknown> = {};
	try {
		const parsed = JSON.parse(fs.readFileSync(library.manifestPath, "utf-8"));
		rawResources =
			parsed &&
			typeof parsed === "object" &&
			!Array.isArray(parsed) &&
			parsed.resources &&
			typeof parsed.resources === "object" &&
			!Array.isArray(parsed.resources)
				? (parsed.resources as Record<string, unknown>)
				: {};
	} catch {
		rawResources = {};
	}
	const rawValue = rawResources.orchestratorProfiles;
	const rawPath =
		typeof rawValue === "string" && rawValue.trim()
			? rawValue.trim()
			: "orchestrator-profiles";
	if (path.isAbsolute(rawPath)) return undefined;
	const resolved = path.resolve(library.root, rawPath);
	const relative = path.relative(library.root, resolved);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative))
		return undefined;
	return resolved;
}

function libraryProfileDirs(
	cwd: string,
): Array<{ dir: string; scope: string }> {
	const dirs: Array<{ dir: string; scope: string }> = [];
	for (const library of discoverConfiguredLatticeLibraries(cwd).libraries) {
		if (!library.valid || !library.manifest) continue;
		const dir = libraryProfilePathFromManifest(library);
		if (dir && isDirectory(dir))
			dirs.push({ dir, scope: library.manifest.name });
	}
	return dirs;
}

function resolveProfileSaveTarget(
	cwd: string,
	targetLibrary?: string,
): {
	dir: string;
	source: RootOrchestratorProfile["source"];
	scope?: string;
	error?: string;
	status?: number;
} {
	const libraries = discoverConfiguredLatticeLibraries(cwd).libraries.filter(
		(library) => library.valid && library.manifest,
	);
	if (targetLibrary) {
		const library = libraries.find(
			(candidate) =>
				candidate.manifest?.name === targetLibrary ||
				candidate.root === targetLibrary,
		);
		if (!library?.manifest)
			return {
				dir: "",
				source: "project",
				error: `Lattice Library '${targetLibrary}' not found`,
				status: 404,
			};
		const dir = libraryProfilePathFromManifest(library);
		if (!dir)
			return {
				dir: "",
				source: "lattice-library",
				error: `Lattice Library '${targetLibrary}' has an invalid orchestratorProfiles resource path`,
				status: 400,
			};
		return { dir, source: "lattice-library", scope: library.manifest.name };
	}
	const library = libraries[0];
	if (library?.manifest) {
		const dir = libraryProfilePathFromManifest(library);
		if (dir)
			return { dir, source: "lattice-library", scope: library.manifest.name };
	}
	return {
		dir: path.join(cwd, ".pi", "orchestrator-profiles"),
		source: "project",
	};
}

export function discoverRootProfiles(cwd: string): RootOrchestratorProfile[] {
	const profiles = [
		...loadProfilesFromDir(packageProfilesDir(), "package", cwd),
		...loadProfilesFromDir(
			path.join(getAgentDir(), "orchestrator-profiles"),
			"user",
			cwd,
		),
		...loadProfilesFromDir(projectProfilesDir(cwd), "project", cwd),
		...libraryProfileDirs(cwd).flatMap((entry) =>
			loadProfilesFromDir(entry.dir, "lattice-library", cwd, entry.scope),
		),
	];

	const byName = new Map<string, RootOrchestratorProfile>();
	for (const profile of profiles) byName.set(profile.name, profile);
	return Array.from(byName.values()).sort((a, b) =>
		a.name.localeCompare(b.name),
	);
}

export function getRootProfile(
	name: string,
	cwd: string,
): RootOrchestratorProfile | undefined {
	return discoverRootProfiles(cwd).find((profile) => profile.name === name);
}

export function getRootProfileDetail(
	name: string,
	cwd: string,
): RootOrchestratorProfileDetail | undefined {
	const profile = getRootProfile(name, cwd);
	return profile ? profileDetail(profile) : undefined;
}

export function saveRootProfile(
	input: SaveRootProfileInput,
	cwd: string,
): {
	success: boolean;
	path?: string;
	detail?: RootOrchestratorProfileDetail;
	error?: string;
	status?: number;
} {
	const name = (input.name || "").trim();
	if (!name) return { success: false, error: "name is required", status: 400 };
	if (!safeProfileName(name))
		return {
			success: false,
			error:
				"name may only contain letters, numbers, dot, underscore, and dash",
			status: 400,
		};
	if (!input.description?.trim())
		return { success: false, error: "description is required", status: 400 };

	const existing = getRootProfile(name, cwd);
	if (existing?.readOnly)
		return { success: false, error: "root profile is read-only", status: 403 };

	let filePath: string;
	if (existing) {
		const detail = profileDetail(existing);
		if (input.expectedHash && detail?.hash !== input.expectedHash)
			return {
				success: false,
				error: "profile changed on disk; reload before saving",
				status: 409,
			};
		filePath = existing.filePath;
	} else {
		const target = resolveProfileSaveTarget(cwd, input.targetLibrary);
		if (target.error)
			return {
				success: false,
				error: target.error,
				status: target.status || 400,
			};
		filePath = path.join(target.dir, `${name}.md`);
	}

	try {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		fs.writeFileSync(filePath, serializeProfile({ ...input, name }), "utf-8");
		return {
			success: true,
			path: filePath,
			detail: getRootProfileDetail(name, cwd),
		};
	} catch (err: any) {
		return { success: false, error: err.message, status: 500 };
	}
}

export function copyRootProfile(
	sourceName: string,
	input: Omit<
		SaveRootProfileInput,
		"instructions" | "skills" | "skillTemplates"
	>,
	cwd: string,
): {
	success: boolean;
	path?: string;
	detail?: RootOrchestratorProfileDetail;
	error?: string;
	status?: number;
} {
	const source = getRootProfileDetail(sourceName, cwd);
	if (!source)
		return { success: false, error: "profile not found", status: 404 };
	if (getRootProfile(input.name, cwd))
		return {
			success: false,
			error: `profile '${input.name}' already exists`,
			status: 409,
		};
	return saveRootProfile(
		{
			...input,
			description: input.description || `${source.profile.description} copy`,
			skills: source.profile.skills,
			skillTemplates: source.profile.skillTemplates,
			instructions: source.profile.instructions,
		},
		cwd,
	);
}

export function deleteRootProfile(
	name: string,
	cwd: string,
): { success: boolean; error?: string; status?: number } {
	if (!safeProfileName(name))
		return { success: false, error: "invalid profile name", status: 400 };
	const profile = getRootProfile(name, cwd);
	if (!profile)
		return { success: false, error: "profile not found", status: 404 };
	if (profile.readOnly)
		return { success: false, error: "root profile is read-only", status: 403 };
	try {
		fs.rmSync(profile.filePath);
		return { success: true };
	} catch (err: any) {
		return { success: false, error: err.message, status: 500 };
	}
}

export function chooseRootProfileActivation(
	arg: string | undefined,
	profiles: RootOrchestratorProfile[],
): RootProfileActivationChoice {
	const requested = (arg || "").trim();
	if (requested) {
		const profile = profiles.find((candidate) => candidate.name === requested);
		if (!profile)
			return {
				action: "error",
				error: `Root profile '${requested}' not found. Available: ${profiles.map((profile) => profile.name).join(", ") || "none"}`,
			};
		return { action: "activate", profile };
	}
	if (profiles.length === 1)
		return { action: "activate", profile: profiles[0] };
	return { action: "select", profiles };
}

export function resolveRootProfileCapabilities(options: {
	cwd: string;
	profile: RootOrchestratorProfile;
}): ResolvedRootProfileCapabilities {
	const definition: AgentDefinition = {
		name: options.profile.name,
		description: options.profile.description,
		skills: options.profile.skills,
		skillTemplates: options.profile.skillTemplates,
		systemPrompt: options.profile.instructions,
		source:
			options.profile.source === "package"
				? "package"
				: options.profile.source === "user"
					? "user"
					: "project",
		filePath: options.profile.filePath,
	};
	const result = resolveCapabilities({
		cwd: options.cwd,
		definition,
		availableExtensions: [],
		target: "orchestrator",
	});
	return {
		skills: result.skills || [],
		errors: result.errors,
		skillConflicts: result.skillConflicts,
	};
}
