import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export const LATTICE_LIBRARY_MANIFEST = "lattice-library.json";
export const LATTICE_LIBRARY_SCHEMA = "pi-lattice-library/v1";
export const ORCHESTRATOR_LIBRARY_MANIFEST = "orchestrator-library.json";
export const ORCHESTRATOR_LIBRARY_SCHEMA = "pi-orchestrator-library/v1";

function readPackageVersion(): string {
	try {
		const root = path.resolve(
			path.dirname(fileURLToPath(import.meta.url)),
			"..",
			"..",
		);
		const raw = JSON.parse(
			fs.readFileSync(path.join(root, "package.json"), "utf-8"),
		);
		return typeof raw.version === "string" && raw.version.trim()
			? raw.version.trim()
			: "0.0.0";
	} catch {
		return "0.0.0";
	}
}

export const PI_LATTICE_VERSION = readPackageVersion();
export const PI_AGENT_ORCHESTRATOR_VERSION = PI_LATTICE_VERSION;

export type LatticeResourceKind =
	| "agents"
	| "skillTemplates"
	| "extensionTemplates"
	| "skills"
	| "extensions";

export interface LatticeLibraryManifest {
	schema: string;
	name: string;
	description?: string;
	compatibility?: {
		piLattice?: string;
		piAgentOrchestrator?: string;
		[key: string]: unknown;
	};
	resources: Record<LatticeResourceKind, string>;
}

export interface ResolvedLatticeResourceDir {
	kind: LatticeResourceKind;
	rawPath: string;
	resolvedPath: string;
	exists: boolean;
}

export interface LatticeLibraryDiagnostic {
	level: "error" | "warning";
	message: string;
	path?: string;
}

export type LatticeLibrarySource = "repo" | "external-mounted";

export interface LatticeLibraryInfo {
	root: string;
	manifestPath: string;
	manifest?: LatticeLibraryManifest;
	resourceDirs: Record<LatticeResourceKind, ResolvedLatticeResourceDir>;
	diagnostics: LatticeLibraryDiagnostic[];
	valid: boolean;
	source?: LatticeLibrarySource;
	enabled?: boolean;
	disabledKey?: string;
}

export interface LatticeLibrarySet {
	libraries: LatticeLibraryInfo[];
	diagnostics: LatticeLibraryDiagnostic[];
	valid: boolean;
}

export type LatticeLibrarySettingsScope = "global" | "project";

export interface ConfiguredLatticeLibrary {
	path: string;
	scope: LatticeLibrarySettingsScope;
	editable?: boolean;
}

export interface LatticeLibraryScopeSettings {
	scope: LatticeLibrarySettingsScope;
	settingsPath: string;
	exists: boolean;
	libraries: ConfiguredLatticeLibrary[];
	parseError?: string;
	readError?: string;
}

export interface LatticeLibrarySettingsPayload {
	global: LatticeLibraryScopeSettings;
	project: LatticeLibraryScopeSettings;
	libraries: ConfiguredLatticeLibrary[];
}

export interface LatticeLibrarySettingsPaths {
	globalSettingsPath?: string;
	projectSettingsPath?: string;
}

export interface DiscoveredLatticeResource {
	id: string;
	kind: LatticeResourceKind;
	name: string;
	description?: string;
	libraryName: string;
	libraryPath: string;
	filePath: string;
	relativePath: string;
	editable: boolean;
	readOnly: boolean;
	diagnostics: LatticeLibraryDiagnostic[];
}

export interface LatticeLibraryDiscovery {
	library: LatticeLibraryInfo;
	resources: DiscoveredLatticeResource[];
	diagnostics: LatticeLibraryDiagnostic[];
}

export interface LatticeDisplaySettings {
	showPackageExamples: boolean;
	settingsPath: string;
	exists: boolean;
	parseError?: string;
	readError?: string;
}

export interface LatticeLibrariesDiscovery {
	libraries: LatticeLibraryInfo[];
	resources: DiscoveredLatticeResource[];
	diagnostics: LatticeLibraryDiagnostic[];
	valid: boolean;
	settings: LatticeDisplaySettings;
}

export interface BootstrapLatticeLibraryResult {
	success: boolean;
	status?: number;
	error?: string;
	scope?: LatticeLibrarySettingsScope;
	library?: LatticeLibraryInfo;
	settings?: LatticeLibrarySettingsPayload;
}

const resourceDefaults: Record<LatticeResourceKind, string> = {
	agents: "agents",
	skillTemplates: "skill-templates",
	extensionTemplates: "extension-templates",
	skills: "skills",
	extensions: "extensions",
};

const manifestResourceKeys: Array<[LatticeResourceKind, string]> = [
	["agents", "agents"],
	["skillTemplates", "skillTemplates"],
	["extensionTemplates", "extensionTemplates"],
	["skills", "skills"],
	["extensions", "extensions"],
];

function isObject(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object" && !Array.isArray(value);
}

function globalSettingsPath(): string {
	return path.join(os.homedir(), ".pi", "agent", "settings.json");
}

function projectSettingsPath(repoCwd: string): string {
	return path.join(repoCwd, ".pi", "settings.json");
}

function settingsPathFor(
	scope: LatticeLibrarySettingsScope,
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): string {
	if (scope === "global")
		return paths.globalSettingsPath || globalSettingsPath();
	return paths.projectSettingsPath || projectSettingsPath(repoCwd);
}

function readSettingsFile(filePath: string): {
	exists: boolean;
	settings: Record<string, unknown>;
	parseError?: string;
	readError?: string;
} {
	if (!fs.existsSync(filePath)) return { exists: false, settings: {} };
	let raw = "";
	try {
		raw = fs.readFileSync(filePath, "utf-8");
	} catch (err: any) {
		return {
			exists: true,
			settings: {},
			readError: err?.message || String(err),
		};
	}
	if (!raw.trim()) return { exists: true, settings: {} };
	try {
		const parsed = JSON.parse(raw);
		if (!isObject(parsed))
			return {
				exists: true,
				settings: {},
				parseError: "settings.json must contain a JSON object",
			};
		return { exists: true, settings: parsed };
	} catch (err: any) {
		return {
			exists: true,
			settings: {},
			parseError: err?.message || String(err),
		};
	}
}

function expandTilde(input: string): string {
	if (input === "~") return os.homedir();
	if (input.startsWith("~/")) return path.join(os.homedir(), input.slice(2));
	return input;
}

function resolveConfiguredLibraryPath(
	library: ConfiguredLatticeLibrary,
	repoCwd: string,
): string {
	const expanded = expandTilde(library.path);
	if (path.isAbsolute(expanded)) return path.resolve(expanded);
	return path.resolve(repoCwd, expanded);
}

function appDataDir(repoCwd: string): string {
	return path.join(repoCwd, ".pi", "pi-lattice");
}

function legacyAppDataDir(repoCwd: string): string {
	return path.join(repoCwd, ".pi", "pi-agent-orchestrator");
}

function autoLibraryBuckets(repoCwd: string): Array<{
	source: LatticeLibrarySource;
	root: string;
}> {
	return [
		{ source: "repo", root: path.join(appDataDir(repoCwd), "libraries") },
		{
			source: "external-mounted",
			root: path.join(appDataDir(repoCwd), "external-libraries"),
		},
		{
			source: "repo",
			root: path.join(legacyAppDataDir(repoCwd), "libraries"),
		},
		{
			source: "external-mounted",
			root: path.join(legacyAppDataDir(repoCwd), "external-libraries"),
		},
	];
}

function libraryDisabledKey(root: string, repoCwd: string): string {
	const relative = path.relative(path.resolve(repoCwd), path.resolve(root));
	if (!relative.startsWith("..") && !path.isAbsolute(relative))
		return relative.replace(/\\/g, "/");
	return path.resolve(root).replace(/\\/g, "/");
}

function readDisabledLibraryKeys(
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): Set<string> {
	const read = readSettingsFile(settingsPathFor("project", repoCwd, paths));
	const value = getOrchestratorSettings(read.settings).disabledLibraries;
	return new Set(
		Array.isArray(value)
			? value.filter((item): item is string => typeof item === "string")
			: [],
	);
}

function discoverAutoLibraryRoots(repoCwd: string): Array<{
	root: string;
	source: LatticeLibrarySource;
	disabledKey: string;
}> {
	const roots: Array<{
		root: string;
		source: LatticeLibrarySource;
		disabledKey: string;
	}> = [];
	for (const bucket of autoLibraryBuckets(repoCwd)) {
		if (!fs.existsSync(bucket.root)) continue;
		const entries = fs
			.readdirSync(bucket.root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => path.join(bucket.root, entry.name))
			.filter((root) => findLibraryManifestPath(root) !== undefined)
			.sort((a, b) => a.localeCompare(b));
		for (const root of entries) {
			roots.push({
				root,
				source: bucket.source,
				disabledKey: libraryDisabledKey(root, repoCwd),
			});
		}
	}
	return roots;
}

function normalizeConfiguredLibraries(
	value: unknown,
	scope: LatticeLibrarySettingsScope,
): ConfiguredLatticeLibrary[] {
	if (!Array.isArray(value)) return [];
	const libraries: ConfiguredLatticeLibrary[] = [];
	for (const entry of value) {
		if (typeof entry === "string" && entry.trim()) {
			libraries.push({ path: entry.trim(), scope });
		} else if (
			isObject(entry) &&
			typeof entry.path === "string" &&
			entry.path.trim()
		) {
			libraries.push({
				path: entry.path.trim(),
				scope,
				editable:
					typeof entry.editable === "boolean" ? entry.editable : undefined,
			});
		}
	}
	return libraries;
}

function getOrchestratorSettings(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	if (isObject(settings.piLattice)) return settings.piLattice;
	return isObject(settings.piAgentOrchestrator)
		? settings.piAgentOrchestrator
		: {};
}

function setLatticeSettings(
	settings: Record<string, unknown>,
	value: Record<string, unknown>,
): Record<string, unknown> {
	const next: Record<string, unknown> = { ...settings, piLattice: value };
	delete next.piAgentOrchestrator;
	return next;
}

function findLibraryManifestPath(root: string): string | undefined {
	const preferred = path.join(root, LATTICE_LIBRARY_MANIFEST);
	if (fs.existsSync(preferred)) return preferred;
	const legacy = path.join(root, ORCHESTRATOR_LIBRARY_MANIFEST);
	if (fs.existsSync(legacy)) return legacy;
	return undefined;
}

function readLibraryScopeSettings(
	scope: LatticeLibrarySettingsScope,
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): LatticeLibraryScopeSettings {
	const settingsPath = settingsPathFor(scope, repoCwd, paths);
	const read = readSettingsFile(settingsPath);
	return {
		scope,
		settingsPath,
		exists: read.exists,
		libraries: normalizeConfiguredLibraries(
			getOrchestratorSettings(read.settings).libraries,
			scope,
		),
		parseError: read.parseError,
		readError: read.readError,
	};
}

export function validateLibraryName(name: unknown): string | undefined {
	if (typeof name !== "string" || !name.trim())
		return "manifest name is required";
	if (
		!/^[a-z0-9][a-z0-9._-]{0,62}[a-z0-9]$/.test(name.trim()) &&
		!/^[a-z0-9]$/.test(name.trim())
	) {
		return "manifest name must be 1-64 lowercase letters, numbers, dots, underscores, or dashes, with no leading/trailing punctuation";
	}
	return undefined;
}

type SemverTuple = [number, number, number];

function parseSemver(value: string): SemverTuple | undefined {
	const match = value
		.trim()
		.replace(/^v/i, "")
		.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
	if (!match) return undefined;
	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareSemver(a: SemverTuple, b: SemverTuple): number {
	for (let index = 0; index < 3; index++) {
		if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
	}
	return 0;
}

function incrementCaretUpperBound(version: SemverTuple): SemverTuple {
	const [major, minor, patch] = version;
	if (major > 0) return [major + 1, 0, 0];
	if (minor > 0) return [0, minor + 1, 0];
	return [0, 0, patch + 1];
}

function incrementTildeUpperBound(version: SemverTuple): SemverTuple {
	const [major, minor] = version;
	return [major, minor + 1, 0];
}

function satisfiesComparator(
	current: SemverTuple,
	comparator: string,
): boolean | undefined {
	const trimmed = comparator.trim();
	if (!trimmed || trimmed === "*" || trimmed.toLowerCase() === "x") return true;

	if (trimmed.startsWith("^")) {
		const version = parseSemver(trimmed.slice(1));
		if (!version) return undefined;
		return (
			compareSemver(current, version) >= 0 &&
			compareSemver(current, incrementCaretUpperBound(version)) < 0
		);
	}

	if (trimmed.startsWith("~")) {
		const version = parseSemver(trimmed.slice(1));
		if (!version) return undefined;
		return (
			compareSemver(current, version) >= 0 &&
			compareSemver(current, incrementTildeUpperBound(version)) < 0
		);
	}

	const match = trimmed.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
	if (!match) return undefined;
	const operator = match[1] || "=";
	const version = parseSemver(match[2]);
	if (!version) return undefined;
	const comparison = compareSemver(current, version);
	if (operator === ">=") return comparison >= 0;
	if (operator === "<=") return comparison <= 0;
	if (operator === ">") return comparison > 0;
	if (operator === "<") return comparison < 0;
	return comparison === 0;
}

function satisfiesVersionRange(
	currentVersion: string,
	range: string,
): boolean | undefined {
	const current = parseSemver(currentVersion);
	if (!current) return undefined;
	const comparators = range
		.replace(/,/g, " ")
		.split(/\s+/)
		.map((part) => part.trim())
		.filter(Boolean);
	if (!comparators.length) return undefined;
	for (const comparator of comparators) {
		const satisfied = satisfiesComparator(current, comparator);
		if (satisfied === undefined) return undefined;
		if (!satisfied) return false;
	}
	return true;
}

function validateCompatibility(
	compatibility: Record<string, unknown>,
	manifestPath: string,
): LatticeLibraryDiagnostic[] {
	const diagnostics: LatticeLibraryDiagnostic[] = [];
	const requirement =
		compatibility.piLattice ?? compatibility.piAgentOrchestrator;
	if (requirement === undefined) return diagnostics;
	if (typeof requirement !== "string" || !requirement.trim()) {
		diagnostics.push({
			level: "error",
			message:
				"manifest compatibility.piLattice must be a string version range when provided (legacy compatibility.piAgentOrchestrator is also supported)",
			path: manifestPath,
		});
		return diagnostics;
	}
	const range = requirement.trim();
	const satisfied = satisfiesVersionRange(PI_LATTICE_VERSION, range);
	if (satisfied === undefined) {
		diagnostics.push({
			level: "error",
			message: `Unsupported pi-lattice compatibility range '${range}'`,
			path: manifestPath,
		});
	} else if (!satisfied) {
		diagnostics.push({
			level: "error",
			message: `Lattice Library requires pi-lattice ${range}, but current version is ${PI_LATTICE_VERSION}`,
			path: manifestPath,
		});
	}
	return diagnostics;
}

function resolveResourceDir(
	root: string,
	kind: LatticeResourceKind,
	rawPath: string,
): { dir?: ResolvedLatticeResourceDir; error?: string } {
	const trimmed = rawPath.trim();
	if (!trimmed) return { error: `${kind} resource path is empty` };
	if (path.isAbsolute(trimmed))
		return {
			error: `${kind} resource path must be relative to the library root`,
		};
	const resolvedPath = path.resolve(root, trimmed);
	const relative = path.relative(root, resolvedPath);
	if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
		return { error: `${kind} resource path must stay inside the library root` };
	}
	return {
		dir: {
			kind,
			rawPath: trimmed,
			resolvedPath,
			exists:
				fs.existsSync(resolvedPath) && fs.statSync(resolvedPath).isDirectory(),
		},
	};
}

export function readLatticeLibrary(rootPath: string): LatticeLibraryInfo {
	const root = path.resolve(rootPath);
	const manifestPath =
		findLibraryManifestPath(root) ?? path.join(root, LATTICE_LIBRARY_MANIFEST);
	const diagnostics: LatticeLibraryDiagnostic[] = [];
	const resourceDirs = {} as Record<
		LatticeResourceKind,
		ResolvedLatticeResourceDir
	>;

	if (!fs.existsSync(manifestPath)) {
		diagnostics.push({
			level: "error",
			message: `Missing ${LATTICE_LIBRARY_MANIFEST} (legacy ${ORCHESTRATOR_LIBRARY_MANIFEST} is also supported)`,
			path: manifestPath,
		});
		for (const [kind] of manifestResourceKeys) {
			const resolved = resolveResourceDir(root, kind, resourceDefaults[kind]);
			if (resolved.dir) resourceDirs[kind] = resolved.dir;
		}
		return { root, manifestPath, resourceDirs, diagnostics, valid: false };
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
	} catch (err: any) {
		diagnostics.push({
			level: "error",
			message: `Invalid ${path.basename(manifestPath)}: ${err?.message || String(err)}`,
			path: manifestPath,
		});
		for (const [kind] of manifestResourceKeys) {
			const resolved = resolveResourceDir(root, kind, resourceDefaults[kind]);
			if (resolved.dir) resourceDirs[kind] = resolved.dir;
		}
		return { root, manifestPath, resourceDirs, diagnostics, valid: false };
	}

	if (!isObject(parsed)) {
		diagnostics.push({
			level: "error",
			message: `${path.basename(manifestPath)} must contain a JSON object`,
			path: manifestPath,
		});
		return { root, manifestPath, resourceDirs, diagnostics, valid: false };
	}

	const supportedSchemas = [
		LATTICE_LIBRARY_SCHEMA,
		ORCHESTRATOR_LIBRARY_SCHEMA,
	];
	if (!supportedSchemas.includes(String(parsed.schema || ""))) {
		diagnostics.push({
			level: "error",
			message: `Unsupported Lattice Library schema '${String(parsed.schema || "")}'. Expected '${LATTICE_LIBRARY_SCHEMA}'. Legacy '${ORCHESTRATOR_LIBRARY_SCHEMA}' is also supported.`,
			path: manifestPath,
		});
	}

	const nameError = validateLibraryName(parsed.name);
	if (nameError)
		diagnostics.push({
			level: "error",
			message: nameError,
			path: manifestPath,
		});

	if (
		parsed.description !== undefined &&
		typeof parsed.description !== "string"
	) {
		diagnostics.push({
			level: "error",
			message: "manifest description must be a string when provided",
			path: manifestPath,
		});
	}

	if (parsed.compatibility !== undefined && !isObject(parsed.compatibility)) {
		diagnostics.push({
			level: "error",
			message: "manifest compatibility must be an object when provided",
			path: manifestPath,
		});
	} else if (isObject(parsed.compatibility)) {
		diagnostics.push(
			...validateCompatibility(parsed.compatibility, manifestPath),
		);
	}

	const rawResources = isObject(parsed.resources) ? parsed.resources : {};
	if (!isObject(parsed.resources)) {
		diagnostics.push({
			level: "warning",
			message:
				"manifest resources object is missing; using default resource directories",
			path: manifestPath,
		});
	}

	const resources = {} as Record<LatticeResourceKind, string>;
	for (const [kind, manifestKey] of manifestResourceKeys) {
		const rawValue = rawResources[manifestKey];
		const rawPath =
			typeof rawValue === "string" && rawValue.trim()
				? rawValue
				: resourceDefaults[kind];
		if (rawValue === undefined) {
			diagnostics.push({
				level: "warning",
				message: `manifest resources.${manifestKey} is missing; using '${resourceDefaults[kind]}'`,
				path: manifestPath,
			});
		} else if (typeof rawValue !== "string") {
			diagnostics.push({
				level: "error",
				message: `manifest resources.${manifestKey} must be a string`,
				path: manifestPath,
			});
		}
		resources[kind] = rawPath;
		const resolved = resolveResourceDir(root, kind, rawPath);
		if (resolved.error) {
			diagnostics.push({
				level: "error",
				message: resolved.error,
				path: manifestPath,
			});
		} else if (resolved.dir) {
			resourceDirs[kind] = resolved.dir;
			if (!resolved.dir.exists) {
				diagnostics.push({
					level: "warning",
					message: `${kind} directory does not exist: ${resolved.dir.rawPath}`,
					path: resolved.dir.resolvedPath,
				});
			}
		}
	}

	const manifest: LatticeLibraryManifest | undefined =
		typeof parsed.name === "string" && typeof parsed.schema === "string"
			? {
					schema: parsed.schema,
					name: parsed.name.trim(),
					description:
						typeof parsed.description === "string"
							? parsed.description
							: undefined,
					compatibility: isObject(parsed.compatibility)
						? (parsed.compatibility as LatticeLibraryManifest["compatibility"])
						: undefined,
					resources,
				}
			: undefined;

	return {
		root,
		manifestPath,
		manifest,
		resourceDirs,
		diagnostics,
		valid: diagnostics.every((diagnostic) => diagnostic.level !== "error"),
	};
}

function relativeResourcePath(root: string, filePath: string): string {
	return path.relative(root, filePath).replace(/\\/g, "/");
}

function resourceId(libraryName: string, relativePath: string): string {
	return `${libraryName}:${relativePath}`;
}

function readMarkdownResource(
	kind: LatticeResourceKind,
	library: LatticeLibraryInfo,
	filePath: string,
): DiscoveredLatticeResource | undefined {
	if (!library.manifest) return undefined;
	try {
		const content = fs.readFileSync(filePath, "utf-8");
		const { frontmatter } = parseFrontmatter<Record<string, unknown>>(content);
		const name =
			typeof frontmatter.name === "string" && frontmatter.name.trim()
				? frontmatter.name.trim()
				: path.basename(filePath, ".md");
		const description =
			typeof frontmatter.description === "string"
				? frontmatter.description.trim()
				: undefined;
		const relativePath = relativeResourcePath(library.root, filePath);
		return {
			id: resourceId(library.manifest.name, relativePath),
			kind,
			name,
			description,
			libraryName: library.manifest.name,
			libraryPath: library.root,
			filePath,
			relativePath,
			editable: true,
			readOnly: false,
			diagnostics: [],
		};
	} catch (err: any) {
		return {
			id: resourceId(
				library.manifest.name,
				relativeResourcePath(library.root, filePath),
			),
			kind,
			name: path.basename(filePath, ".md"),
			libraryName: library.manifest.name,
			libraryPath: library.root,
			filePath,
			relativePath: relativeResourcePath(library.root, filePath),
			editable: false,
			readOnly: true,
			diagnostics: [
				{
					level: "error",
					message: `Failed to read ${kind} resource: ${err?.message || String(err)}`,
					path: filePath,
				},
			],
		};
	}
}

function discoverMarkdownResources(
	kind: LatticeResourceKind,
	library: LatticeLibraryInfo,
): DiscoveredLatticeResource[] {
	const dir = library.resourceDirs[kind];
	if (!dir?.exists) return [];
	return fs
		.readdirSync(dir.resolvedPath, { withFileTypes: true })
		.filter(
			(entry) =>
				(entry.isFile() || entry.isSymbolicLink()) &&
				entry.name.endsWith(".md"),
		)
		.map((entry) =>
			readMarkdownResource(
				kind,
				library,
				path.join(dir.resolvedPath, entry.name),
			),
		)
		.filter((resource): resource is DiscoveredLatticeResource => !!resource)
		.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverSkillResources(
	library: LatticeLibraryInfo,
): DiscoveredLatticeResource[] {
	const dir = library.resourceDirs.skills;
	if (!library.manifest || !dir?.exists) return [];
	const resources: DiscoveredLatticeResource[] = [];
	const addSkill = (skillFile: string) => {
		const resource = readMarkdownResource("skills", library, skillFile);
		if (resource) resources.push(resource);
	};
	for (const entry of fs.readdirSync(dir.resolvedPath, {
		withFileTypes: true,
	})) {
		const full = path.join(dir.resolvedPath, entry.name);
		if (entry.isDirectory() && fs.existsSync(path.join(full, "SKILL.md")))
			addSkill(path.join(full, "SKILL.md"));
		if (
			(entry.isFile() || entry.isSymbolicLink()) &&
			entry.name.endsWith(".md")
		)
			addSkill(full);
	}
	return resources.sort((a, b) => a.name.localeCompare(b.name));
}

function discoverExtensionResources(
	library: LatticeLibraryInfo,
): DiscoveredLatticeResource[] {
	const dir = library.resourceDirs.extensions;
	if (!library.manifest || !dir?.exists) return [];
	const resources: DiscoveredLatticeResource[] = [];
	for (const entry of fs.readdirSync(dir.resolvedPath, {
		withFileTypes: true,
	})) {
		const full = path.join(dir.resolvedPath, entry.name);
		let filePath: string | undefined;
		if (entry.isFile() && /\.(ts|js)$/.test(entry.name)) filePath = full;
		if (entry.isDirectory()) {
			const indexTs = path.join(full, "index.ts");
			const indexJs = path.join(full, "index.js");
			if (fs.existsSync(indexTs)) filePath = indexTs;
			else if (fs.existsSync(indexJs)) filePath = indexJs;
		}
		if (!filePath) continue;
		const relativePath = relativeResourcePath(library.root, filePath);
		resources.push({
			id: resourceId(library.manifest.name, relativePath),
			kind: "extensions",
			name: entry.isDirectory()
				? entry.name
				: path.basename(entry.name, path.extname(entry.name)),
			libraryName: library.manifest.name,
			libraryPath: library.root,
			filePath,
			relativePath,
			editable: true,
			readOnly: false,
			diagnostics: [],
		});
	}
	return resources.sort((a, b) => a.name.localeCompare(b.name));
}

export function discoverLatticeLibraryResources(
	rootPath: string,
): LatticeLibraryDiscovery {
	const library = readLatticeLibrary(rootPath);
	if (!library.valid || !library.manifest)
		return { library, resources: [], diagnostics: library.diagnostics };
	const resources = [
		...discoverMarkdownResources("agents", library),
		...discoverMarkdownResources("skillTemplates", library),
		...discoverMarkdownResources("extensionTemplates", library),
		...discoverSkillResources(library),
		...discoverExtensionResources(library),
	];
	const diagnostics = [
		...library.diagnostics,
		...resources.flatMap((resource) => resource.diagnostics),
	];
	return { library, resources, diagnostics };
}

export function readLatticeLibrarySettings(
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): LatticeLibrarySettingsPayload {
	const global = readLibraryScopeSettings("global", repoCwd, paths);
	const project = readLibraryScopeSettings("project", repoCwd, paths);
	return {
		global,
		project,
		libraries: [...global.libraries, ...project.libraries],
	};
}

export function readLatticeDisplaySettings(
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): LatticeDisplaySettings {
	const settingsPath = settingsPathFor("project", repoCwd, paths);
	const read = readSettingsFile(settingsPath);
	const orchestrator = getOrchestratorSettings(read.settings);
	return {
		showPackageExamples: orchestrator.showPackageExamples !== false,
		settingsPath,
		exists: read.exists,
		parseError: read.parseError,
		readError: read.readError,
	};
}

export function updateLatticeDisplaySettings(
	input: { showPackageExamples: boolean },
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): {
	success: boolean;
	status?: number;
	error?: string;
	settings?: LatticeDisplaySettings;
} {
	if (typeof input.showPackageExamples !== "boolean")
		return {
			success: false,
			status: 400,
			error: "showPackageExamples must be a boolean",
		};
	const settingsPath = settingsPathFor("project", repoCwd, paths);
	const read = readSettingsFile(settingsPath);
	if (read.parseError || read.readError)
		return {
			success: false,
			status: 400,
			error: `Cannot update ${settingsPath}: ${read.parseError || read.readError}`,
		};

	const existingOrchestratorSettings = getOrchestratorSettings(read.settings);
	const next = setLatticeSettings(read.settings, {
		...existingOrchestratorSettings,
		showPackageExamples: input.showPackageExamples,
	});

	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return {
		success: true,
		settings: readLatticeDisplaySettings(repoCwd, paths),
	};
}

export function updateLatticeLibraryEnabled(
	input: { root: string; enabled: boolean },
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): {
	success: boolean;
	status?: number;
	error?: string;
	discovery?: LatticeLibrariesDiscovery;
} {
	if (typeof input.root !== "string" || !input.root.trim())
		return { success: false, status: 400, error: "root is required" };
	if (typeof input.enabled !== "boolean")
		return { success: false, status: 400, error: "enabled must be a boolean" };

	const discovered = discoverAutoLibraryRoots(repoCwd);
	const requestedRoot = path.resolve(repoCwd, input.root.trim());
	const target = discovered.find(
		(library) =>
			path.resolve(library.root) === requestedRoot ||
			library.disabledKey === input.root.trim(),
	);
	if (!target)
		return {
			success: false,
			status: 404,
			error: "Lattice Library is not in an auto-discovered location",
		};

	const settingsPath = settingsPathFor("project", repoCwd, paths);
	const read = readSettingsFile(settingsPath);
	if (read.parseError || read.readError)
		return {
			success: false,
			status: 400,
			error: `Cannot update ${settingsPath}: ${read.parseError || read.readError}`,
		};

	const disabled = readDisabledLibraryKeys(repoCwd, paths);
	if (input.enabled) disabled.delete(target.disabledKey);
	else disabled.add(target.disabledKey);

	const existingOrchestratorSettings = getOrchestratorSettings(read.settings);
	const next = setLatticeSettings(read.settings, {
		...existingOrchestratorSettings,
		disabledLibraries: [...disabled].sort(),
	});

	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return {
		success: true,
		discovery: discoverConfiguredLatticeLibraries(repoCwd, paths),
	};
}

export function updateLatticeLibrarySettings(
	input: {
		scope: LatticeLibrarySettingsScope;
		libraries: Array<string | { path: string; editable?: boolean }>;
	},
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): {
	success: boolean;
	status?: number;
	error?: string;
	settings?: LatticeLibrarySettingsPayload;
} {
	if (input.scope !== "global" && input.scope !== "project")
		return {
			success: false,
			status: 400,
			error: "scope must be 'global' or 'project'",
		};
	if (!Array.isArray(input.libraries))
		return { success: false, status: 400, error: "libraries must be an array" };

	const settingsPath = settingsPathFor(input.scope, repoCwd, paths);
	const read = readSettingsFile(settingsPath);
	if (read.parseError || read.readError)
		return {
			success: false,
			status: 400,
			error: `Cannot update ${settingsPath}: ${read.parseError || read.readError}`,
		};

	const normalized = normalizeConfiguredLibraries(
		input.libraries,
		input.scope,
	).map((library) =>
		library.editable === undefined
			? { path: library.path }
			: { path: library.path, editable: library.editable },
	);
	if (normalized.length !== input.libraries.length)
		return {
			success: false,
			status: 400,
			error:
				"each library entry must be a path string or object with a path string",
		};

	const existingOrchestratorSettings = getOrchestratorSettings(read.settings);
	const next = setLatticeSettings(read.settings, {
		...existingOrchestratorSettings,
		libraries: normalized,
	});

	fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
	fs.writeFileSync(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf-8");
	return {
		success: true,
		settings: readLatticeLibrarySettings(repoCwd, paths),
	};
}

function isDirectoryEmpty(dir: string): boolean {
	return !fs.existsSync(dir) || fs.readdirSync(dir).length === 0;
}

function classifyBootstrapScope(
	targetPath: string,
	repoCwd: string,
): LatticeLibrarySettingsScope {
	const resolved = path.resolve(repoCwd, expandTilde(targetPath));
	const relative = path.relative(path.resolve(repoCwd), resolved);
	return !relative.startsWith("..") && !path.isAbsolute(relative)
		? "project"
		: "global";
}

function writeStarterFile(filePath: string, content: string) {
	fs.mkdirSync(path.dirname(filePath), { recursive: true });
	fs.writeFileSync(filePath, content, "utf-8");
}

export function bootstrapLatticeLibrary(
	input: { targetPath: string; name?: string; description?: string },
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): BootstrapLatticeLibraryResult {
	if (!input.targetPath?.trim())
		return { success: false, status: 400, error: "targetPath is required" };
	const targetPath = input.targetPath.trim();
	const resolvedTarget = path.resolve(repoCwd, expandTilde(targetPath));
	if (
		fs.existsSync(resolvedTarget) &&
		!fs.statSync(resolvedTarget).isDirectory()
	)
		return {
			success: false,
			status: 409,
			error: "target path exists and is not a directory",
		};
	if (
		!isDirectoryEmpty(resolvedTarget) &&
		!findLibraryManifestPath(resolvedTarget)
	) {
		return {
			success: false,
			status: 409,
			error:
				"target directory is not empty and does not contain a lattice-library.json manifest",
		};
	}
	if (findLibraryManifestPath(resolvedTarget))
		return {
			success: false,
			status: 409,
			error: "Lattice Library already exists at target path",
		};

	const defaultName =
		path
			.basename(resolvedTarget)
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, "-")
			.replace(/^[._-]+|[._-]+$/g, "") || "lattice-library";
	const name = input.name?.trim() || defaultName;
	const nameError = validateLibraryName(name);
	if (nameError) return { success: false, status: 400, error: nameError };

	fs.mkdirSync(resolvedTarget, { recursive: true });
	const manifest = {
		schema: LATTICE_LIBRARY_SCHEMA,
		name,
		description: input.description?.trim() || "User-owned Pi Lattice Library",
		compatibility: {
			piLattice: `>=${PI_LATTICE_VERSION}`,
		},
		resources: {
			...resourceDefaults,
			orchestratorProfiles: "orchestrator-profiles",
		},
	};
	writeStarterFile(
		path.join(resolvedTarget, LATTICE_LIBRARY_MANIFEST),
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	writeStarterFile(
		path.join(resolvedTarget, "README.md"),
		`# ${name}\n\nVersion-controlled Pi Lattice Library for root profiles, agent types, templates, skills, and extensions.\n`,
	);
	writeStarterFile(
		path.join(resolvedTarget, "orchestrator-profiles", "example-planner.md"),
		"---\nname: example-planner\ndescription: Example root profile for planning-heavy sessions.\nskillTemplates: example-root-skills\n---\n\nUse this profile when the root orchestrator should spend extra effort clarifying scope, decomposing work, and coordinating spawned agents.\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "agents", "example-researcher.md"),
		"---\nname: example-researcher\ndescription: Example researcher agent type for this Lattice Library.\ntools: read, bash\nskillTemplates: example-core-skills\nextensionTemplates: example-web-tools\n---\n\nYou are an example researcher agent. Use this file as a starting point for your own agent types.\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "skill-templates", "example-root-skills.md"),
		"---\nname: example-root-skills\ndescription: Example root orchestrator skill template referencing a library skill.\naudience: orchestrator\nautoApply: none\nskills: skills/example-analysis\n---\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "skill-templates", "example-core-skills.md"),
		"---\nname: example-core-skills\ndescription: Example skill template referencing a library skill.\naudience: spawned\nautoApply: none\nskills: skills/example-analysis\n---\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "extension-templates", "example-web-tools.md"),
		"---\nname: example-web-tools\ndescription: Example extension template referencing a library extension.\naudience: spawned\nautoApply: none\nextensions: extensions/example-extension\n---\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "skills", "example-analysis", "SKILL.md"),
		"---\nname: example-analysis\ndescription: Example analysis skill. Use when demonstrating Lattice Library skill structure.\n---\n\n# Example Analysis\n\nReplace this starter skill with your own workflow.\n",
	);
	writeStarterFile(
		path.join(resolvedTarget, "extensions", "example-extension", "index.ts"),
		"// Example Pi extension placeholder. Replace with a real extension before assigning it to agents.\nexport default function () {\n  // no-op example\n}\n",
	);

	const scope = classifyBootstrapScope(targetPath, repoCwd);
	const current = readLatticeLibrarySettings(repoCwd, paths)[scope].libraries;
	const storedPath =
		scope === "project"
			? path.relative(repoCwd, resolvedTarget).replace(/\\/g, "/") || "."
			: targetPath;
	const update = updateLatticeLibrarySettings(
		{
			scope,
			libraries: [
				...current.map((library) =>
					library.editable === undefined
						? library.path
						: { path: library.path, editable: library.editable },
				),
				storedPath,
			],
		},
		repoCwd,
		paths,
	);
	if (!update.success)
		return { success: false, status: update.status, error: update.error };
	return {
		success: true,
		scope,
		library: readLatticeLibrary(resolvedTarget),
		settings: update.settings,
	};
}

export function discoverConfiguredLatticeLibraries(
	repoCwd: string,
	paths: LatticeLibrarySettingsPaths = {},
): LatticeLibrariesDiscovery {
	const autoDiscovered = discoverAutoLibraryRoots(repoCwd);
	const seenRoots = new Set(
		autoDiscovered.map((library) => path.resolve(library.root)),
	);
	const legacyConfigured = readLatticeLibrarySettings(repoCwd, paths)
		.libraries.map((library) => resolveConfiguredLibraryPath(library, repoCwd))
		.filter((root) => {
			const key = path.resolve(root);
			if (seenRoots.has(key)) return false;
			seenRoots.add(key);
			return true;
		})
		.map((root) => ({
			root,
			source: "repo" as LatticeLibrarySource,
			disabledKey: libraryDisabledKey(root, repoCwd),
		}));
	const discovered = [...autoDiscovered, ...legacyConfigured];
	const disabledKeys = readDisabledLibraryKeys(repoCwd, paths);
	const enabled = discovered.filter(
		(library) => !disabledKeys.has(library.disabledKey),
	);
	const enabledSet = readLatticeLibraries(
		enabled.map((library) => library.root),
	);
	const enabledByRoot = new Map(
		enabledSet.libraries.map((library) => [
			path.resolve(library.root),
			library,
		]),
	);
	const libraries = discovered.map((entry) => {
		const enabledLibrary = enabledByRoot.get(path.resolve(entry.root));
		const library = enabledLibrary || readLatticeLibrary(entry.root);
		return {
			...library,
			source: entry.source,
			enabled: !disabledKeys.has(entry.disabledKey),
			disabledKey: entry.disabledKey,
		};
	});
	const resources: DiscoveredLatticeResource[] = [];
	const diagnostics = [...enabledSet.diagnostics];

	for (const library of libraries) {
		if (!library.enabled || !library.valid || !library.manifest) continue;
		const discovery = discoverLatticeLibraryResources(library.root);
		resources.push(...discovery.resources);
		diagnostics.push(
			...discovery.diagnostics.filter(
				(diagnostic) => !diagnostics.includes(diagnostic),
			),
		);
	}

	return {
		libraries,
		resources,
		diagnostics,
		valid:
			enabledSet.valid &&
			diagnostics.every((diagnostic) => diagnostic.level !== "error"),
		settings: readLatticeDisplaySettings(repoCwd, paths),
	};
}

export function resolveLatticeLibraryResourceRef(
	ref: string,
	repoCwd: string,
	kind?: LatticeResourceKind,
): DiscoveredLatticeResource | undefined {
	const trimmed = ref.trim();
	if (!trimmed.includes(":")) return undefined;
	const [libraryName, ...rest] = trimmed.split(":");
	const relative = rest.join(":");
	if (!libraryName || !relative) return undefined;
	const normalizedRelative = relative.replace(/\\/g, "/").replace(/^\/+/, "");
	return discoverConfiguredLatticeLibraries(repoCwd).resources.find(
		(resource) => {
			if (resource.libraryName !== libraryName) return false;
			if (kind && resource.kind !== kind) return false;
			return (
				resource.relativePath === normalizedRelative ||
				resource.relativePath === `${normalizedRelative}/SKILL.md` ||
				resource.relativePath === `${normalizedRelative}/index.ts` ||
				resource.relativePath === `${normalizedRelative}/index.js`
			);
		},
	);
}

export function readLatticeLibraries(rootPaths: string[]): LatticeLibrarySet {
	const libraries = rootPaths.map((rootPath) => readLatticeLibrary(rootPath));
	const diagnostics = libraries.flatMap((library) => library.diagnostics);
	const byName = new Map<string, LatticeLibraryInfo>();

	for (const library of libraries) {
		const name = library.manifest?.name;
		if (!name) continue;
		const existing = byName.get(name);
		if (!existing) {
			byName.set(name, library);
			continue;
		}
		const message = `Duplicate Lattice Library namespace '${name}' found at ${existing.root} and ${library.root}`;
		const duplicateDiagnostic: LatticeLibraryDiagnostic = {
			level: "error",
			message,
			path: library.manifestPath,
		};
		diagnostics.push(duplicateDiagnostic);
		library.diagnostics.push(duplicateDiagnostic);
		library.valid = false;
	}

	return {
		libraries,
		diagnostics,
		valid:
			libraries.every((library) => library.valid) &&
			diagnostics.every((diagnostic) => diagnostic.level !== "error"),
	};
}
