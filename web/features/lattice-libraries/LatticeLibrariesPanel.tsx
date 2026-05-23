import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import type {
	LatticeLibrariesInfo,
	ResourcePathValidation,
	ResourceScopeSettings,
	ResourceSettingsInfo,
} from "../../types.js";
import type { LogLine } from "../../shared/dashboard-types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import { Input, Textarea } from "../../components/ui/input.js";

function shortPath(p?: string): string {
	if (!p) return "";
	return p.length > 42 ? "…" + p.slice(-39) : p;
}

async function responseErrorText(res: Response): Promise<string> {
	const text = await res.text();
	try {
		const data = JSON.parse(text);
		return data?.error || text;
	} catch {
		return text;
	}
}

function FieldLabel({
	children,
	required,
	optional,
}: {
	children: ReactNode;
	required?: boolean;
	optional?: boolean;
}) {
	return (
		<label className="block text-xs uppercase tracking-wide text-muted-foreground">
			{children} {required && <span className="text-destructive">*</span>}
			{optional && (
				<span className="normal-case text-muted-foreground/70">(optional)</span>
			)}
		</label>
	);
}

function FormMessage({
	children,
	tone = "muted",
}: {
	children: ReactNode;
	tone?: "muted" | "error" | "success";
}) {
	const className =
		tone === "error"
			? "text-destructive"
			: tone === "success"
				? "text-emerald-400"
				: "text-muted-foreground";
	return <p className={`text-xs ${className}`}>{children}</p>;
}

function libraryFolderName(name: string): string {
	return name
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, "-")
		.replace(/^[._-]+|[._-]+$/g, "");
}

export function LatticeLibrariesPanel({
	pushLog,
	onDisplaySettingsChanged,
	onNativeSettingsSaved,
}: {
	pushLog: (text: string, level?: LogLine["level"]) => void;
	onDisplaySettingsChanged: () => void;
	onNativeSettingsSaved: () => void;
}) {
	const [data, setData] = useState<LatticeLibrariesInfo | null>(null);
	const [loading, setLoading] = useState(false);
	const [togglingRoot, setTogglingRoot] = useState<string | null>(null);
	const [savingDisplay, setSavingDisplay] = useState(false);
	const [showNativeSettings, setShowNativeSettings] = useState(false);
	const [creatingLibrary, setCreatingLibrary] = useState(false);
	const [bootstrapName, setBootstrapName] = useState("");
	const [bootstrapDescription, setBootstrapDescription] = useState("");
	const [bootstrapSaving, setBootstrapSaving] = useState(false);
	const [bootstrapError, setBootstrapError] = useState("");
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/lattice-libraries");
			if (!res.ok) throw new Error(await res.text());
			setData((await res.json()) as LatticeLibrariesInfo);
		} catch (e: any) {
			setError(e.message || "Failed to load Lattice Libraries");
			pushLog(`Failed to load Lattice Libraries: ${e.message}`, "error");
		} finally {
			setLoading(false);
		}
	}, [pushLog]);

	useEffect(() => {
		load();
	}, [load]);

	const setLibraryEnabled = async (root: string, enabled: boolean) => {
		setTogglingRoot(root);
		setError("");
		try {
			const res = await fetch("/api/lattice-libraries/enabled", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ root, enabled }),
			});
			if (!res.ok) throw new Error(await responseErrorText(res));
			pushLog(
				`${enabled ? "Enabled" : "Disabled"} Lattice Library ${shortPath(root)}`,
				"success",
			);
			await load();
			onNativeSettingsSaved();
		} catch (e: any) {
			setError(e.message || "Failed to update Lattice Library state");
			pushLog(`Failed to update Lattice Library state: ${e.message}`, "error");
		} finally {
			setTogglingRoot(null);
		}
	};

	const setShowPackageExamples = async (showPackageExamples: boolean) => {
		setSavingDisplay(true);
		setError("");
		try {
			const res = await fetch("/api/lattice-libraries/display-settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ showPackageExamples }),
			});
			if (!res.ok) throw new Error(await responseErrorText(res));
			pushLog(
				`${showPackageExamples ? "Showing" : "Hiding"} package example resources`,
				"success",
			);
			await load();
			onDisplaySettingsChanged();
			onNativeSettingsSaved();
		} catch (e: any) {
			setError(e.message || "Failed to update display settings");
			pushLog(`Failed to update display settings: ${e.message}`, "error");
		} finally {
			setSavingDisplay(false);
		}
	};

	const bootstrapLibrary = async (event: FormEvent) => {
		event.preventDefault();
		setBootstrapError("");
		const folderName = libraryFolderName(bootstrapName) || "lattice-library";
		setBootstrapSaving(true);
		try {
			const res = await fetch("/api/lattice-libraries/bootstrap", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					targetPath: `./.pi/pi-lattice/libraries/${folderName}`,
					name: bootstrapName.trim() || undefined,
					description: bootstrapDescription.trim() || undefined,
				}),
			});
			if (!res.ok) throw new Error(await responseErrorText(res));
			const result = (await res.json()) as {
				scope?: "global" | "project";
				library?: { root: string; manifest?: { name: string } };
			};
			pushLog(
				`Created ${result.scope || "project"} Lattice Library${result.library?.manifest?.name ? ` '${result.library.manifest.name}'` : ""}${result.library?.root ? ` at ${result.library.root}` : ""}`,
				"success",
			);
			setCreatingLibrary(false);
			setBootstrapName("");
			setBootstrapDescription("");
			await load();
			onNativeSettingsSaved();
		} catch (e: any) {
			setBootstrapError(e.message || "Failed to create Lattice Library");
			pushLog(`Failed to create Lattice Library: ${e.message}`, "error");
		} finally {
			setBootstrapSaving(false);
		}
	};

	const openBootstrapDialog = () => {
		setBootstrapError("");
		setCreatingLibrary(true);
	};

	const counts = useMemo(() => {
		const result: Record<string, Record<string, number>> = {};
		for (const resource of data?.resources || []) {
			result[resource.libraryName] ||= {};
			result[resource.libraryName][resource.kind] =
				(result[resource.libraryName][resource.kind] || 0) + 1;
		}
		return result;
	}, [data]);
	const bootstrapDirty = !!bootstrapName || !!bootstrapDescription;
	const bootstrapDiscardMessage = "Discard unsaved library scaffold changes?";
	const closeBootstrapDialog = () => {
		if (bootstrapSaving) return;
		if (!bootstrapDirty || confirm(bootstrapDiscardMessage))
			setCreatingLibrary(false);
	};

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<CardTitle>Lattice Libraries</CardTitle>
						<div className="flex gap-2">
							<Button variant="secondary" onClick={openBootstrapDialog}>
								+ New Library
							</Button>
							<Button variant="secondary" onClick={load} disabled={loading}>
								Refresh
							</Button>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
					<p>
						Lattice Libraries are user-owned, version-controlled folders for
						agent types, skill templates, extension templates, and curated
						skills/extensions.
					</p>
					<p>
						Use libraries for orchestrator-managed agents, templates, skills,
						and extensions. Repo-local libraries are discovered from{" "}
						<code>.pi/pi-lattice/libraries/*</code>; external libraries must be
						mounted under <code>.pi/pi-lattice/external-libraries/*</code>{" "}
						before Pi starts.
					</p>
					{loading && !data && (
						<div className="space-y-3 pt-1">
							<div className="rounded-md border border-border bg-background/60 p-3">
								<div className="mb-2 h-4 w-48 animate-pulse rounded bg-muted" />
								<div className="h-3 w-full max-w-2xl animate-pulse rounded bg-muted/70" />
								<div className="mt-2 h-3 w-3/4 max-w-xl animate-pulse rounded bg-muted/70" />
							</div>
							<div className="rounded-md border border-dashed border-border p-6">
								<div className="mx-auto mb-2 h-4 w-64 animate-pulse rounded bg-muted" />
								<div className="mx-auto h-3 w-80 max-w-full animate-pulse rounded bg-muted/70" />
							</div>
						</div>
					)}
					{data?.settings && (
						<div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
							<div>
								<div className="font-medium text-foreground">
									Package example resources
								</div>
								<div className="text-xs">
									Read-only package examples are useful for onboarding, but can
									be hidden once your own libraries are configured. Stored in
									project settings: <code>piLattice.showPackageExamples</code>.
								</div>
							</div>
							<label className="flex shrink-0 items-center gap-2 text-sm text-foreground">
								<input
									type="checkbox"
									checked={data.settings.showPackageExamples}
									disabled={savingDisplay}
									onChange={(e) => setShowPackageExamples(e.target.checked)}
								/>{" "}
								Show package examples
							</label>
						</div>
					)}
					{error && (
						<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
							{error}
						</div>
					)}
					{data && !data.libraries.length && (
						<button
							type="button"
							className="w-full rounded-md border border-dashed border-border p-6 text-center transition hover:border-primary/70 hover:bg-primary/5"
							onClick={openBootstrapDialog}
						>
							<div className="font-medium text-foreground">
								Click here to scaffold your first Lattice Library
							</div>
							<div className="mt-1">
								Pi can create a starter library for your agent types, templates,
								root profiles, skills, and extensions instead of requiring
								manual settings edits.
							</div>
						</button>
					)}
				</CardContent>
			</Card>
			<Dialog
				open={creatingLibrary}
				title="Scaffold Lattice Library"
				onOpenChange={(open) => {
					if (!open && !bootstrapSaving) setCreatingLibrary(false);
				}}
				confirmOnClose={bootstrapDirty}
				confirmCloseMessage={bootstrapDiscardMessage}
				className="max-w-3xl"
			>
				<form className="space-y-3" onSubmit={bootstrapLibrary}>
					<p className="text-sm text-muted-foreground">
						New libraries are created in the repo-local auto-discovery folder:
						<code>.pi/pi-lattice/libraries/&lt;library-name&gt;</code>. External
						libraries must be bind-mounted before Pi starts.
					</p>
					{bootstrapError && (
						<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
							{bootstrapError}
						</div>
					)}
					<div className="space-y-1">
						<FieldLabel optional>Library name</FieldLabel>
						<Input
							value={bootstrapName}
							onChange={(e) => setBootstrapName(e.target.value)}
							placeholder="team-ai"
						/>
						<FormMessage>
							Used as the namespaced resource prefix and repo-local folder name;
							leave blank for lattice-library.
						</FormMessage>
					</div>
					<div className="space-y-1">
						<FieldLabel optional>Description</FieldLabel>
						<Textarea
							rows={3}
							value={bootstrapDescription}
							onChange={(e) => setBootstrapDescription(e.target.value)}
							placeholder="Shared team orchestrator resources."
						/>
					</div>
					<div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
						<Button type="submit" disabled={bootstrapSaving}>
							{bootstrapSaving ? "Creating…" : "Create library"}
						</Button>
						<Button
							type="button"
							variant="secondary"
							onClick={closeBootstrapDialog}
							disabled={bootstrapSaving}
						>
							Cancel
						</Button>
					</div>
				</form>
			</Dialog>
			{data?.diagnostics.length ? (
				<Card>
					<CardHeader>
						<CardTitle>Diagnostics</CardTitle>
					</CardHeader>
					<CardContent className="space-y-2">
						{data.diagnostics.map((diagnostic, index) => (
							<div
								key={index}
								className={`rounded-md border p-2 text-sm ${diagnostic.level === "error" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}
							>
								<strong>{diagnostic.level}:</strong> {diagnostic.message}
								{diagnostic.path ? (
									<div className="mt-1 font-mono text-xs opacity-80">
										{diagnostic.path}
									</div>
								) : null}
							</div>
						))}
					</CardContent>
				</Card>
			) : null}
			<Card>
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<div>
							<CardTitle>Advanced native Pi resource paths</CardTitle>
							<div className="mt-1 text-xs text-muted-foreground">
								Optional escape hatch for Pi's raw skills/extensions settings.
								Prefer Lattice Libraries for orchestrator resources.
							</div>
						</div>
						<Button
							variant="secondary"
							onClick={() => setShowNativeSettings((value) => !value)}
						>
							{showNativeSettings ? "Hide" : "Show"} native paths
						</Button>
					</div>
				</CardHeader>
				{showNativeSettings && (
					<CardContent className="pt-4">
						<ResourceSettingsPanel
							onSaved={onNativeSettingsSaved}
							pushLog={pushLog}
						/>
					</CardContent>
				)}
			</Card>
			{data?.libraries.length ? (
				<div className="grid gap-4 xl:grid-cols-2">
					{data.libraries.map((library) => {
						const name = library.manifest?.name || shortPath(library.root);
						const libraryCounts = counts[name] || {};
						const enabled = library.enabled !== false;
						return (
							<Card
								key={library.root}
								className={`${!library.valid ? "border-destructive/50" : ""} ${!enabled ? "opacity-70" : ""}`}
							>
								<CardHeader className="border-b border-border">
									<div className="flex items-start justify-between gap-3">
										<div>
											<CardTitle>{name}</CardTitle>
											<div className="mt-1 font-mono text-xs text-muted-foreground">
												{library.root}
											</div>
										</div>
										<div className="flex shrink-0 items-center gap-2">
											<Badge variant="outline">
												{library.source === "external-mounted"
													? "external-mounted"
													: "repo"}
											</Badge>
											<Badge variant={enabled ? "success" : "outline"}>
												{enabled ? "enabled" : "disabled"}
											</Badge>
											<Badge
												variant={library.valid ? "success" : "destructive"}
											>
												{library.valid ? "valid" : "invalid"}
											</Badge>
											<Button
												variant="secondary"
												className="px-2 py-1 text-xs"
												disabled={togglingRoot === library.root}
												onClick={() =>
													setLibraryEnabled(library.root, !enabled)
												}
											>
												{enabled ? "Disable" : "Enable"}
											</Button>
										</div>
									</div>
								</CardHeader>
								<CardContent className="space-y-3 pt-4 text-sm">
									{library.manifest?.description && (
										<p className="text-muted-foreground">
											{library.manifest.description}
										</p>
									)}
									<div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-3">
										<div>Agents: {libraryCounts.agents || 0}</div>
										<div>
											Skill templates: {libraryCounts.skillTemplates || 0}
										</div>
										<div>
											Extension templates:{" "}
											{libraryCounts.extensionTemplates || 0}
										</div>
										<div>Skills: {libraryCounts.skills || 0}</div>
										<div>Extensions: {libraryCounts.extensions || 0}</div>
									</div>
									{library.diagnostics.length ? (
										<div className="space-y-1">
											{library.diagnostics.map((diagnostic, index) => (
												<div
													key={index}
													className="text-xs text-muted-foreground"
												>
													{diagnostic.level}: {diagnostic.message}
												</div>
											))}
										</div>
									) : null}
								</CardContent>
							</Card>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function ResourceSettingsPanel({
	onSaved,
	pushLog,
}: {
	onSaved: () => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const [settings, setSettings] = useState<ResourceSettingsInfo | null>(null);
	const [drafts, setDrafts] = useState<
		Record<"global" | "project", { skills: string[]; extensions: string[] }>
	>({
		global: { skills: [], extensions: [] },
		project: { skills: [], extensions: [] },
	});
	const [loading, setLoading] = useState(false);
	const [saving, setSaving] = useState<"global" | "project" | null>(null);
	const [error, setError] = useState("");

	const load = useCallback(async () => {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/resource-settings");
			if (!res.ok) throw new Error(await res.text());
			const data = (await res.json()) as ResourceSettingsInfo;
			setSettings(data);
			setDrafts({
				global: {
					skills: data.global.skills,
					extensions: data.global.extensions,
				},
				project: {
					skills: data.project.skills,
					extensions: data.project.extensions,
				},
			});
		} catch (e: any) {
			setError(e.message || "Failed to load skill and extension paths");
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		load();
	}, [load]);

	const save = async (scope: "global" | "project") => {
		const missing = [...drafts[scope].skills, ...drafts[scope].extensions]
			.filter(
				(value) =>
					value.trim() &&
					!value.trim().startsWith("!") &&
					!/[*?[\]{}]/.test(value),
			)
			.filter((value) => {
				const current = settings?.[scope];
				const found = current?.validation.skills
					.concat(current.validation.extensions)
					.find((item) => item.rawPath === value);
				return found?.exists === false;
			});
		if (
			missing.length &&
			!confirm(
				`Some paths do not exist yet:\n${missing.join("\n")}\n\nSave anyway?`,
			)
		)
			return;
		if (
			drafts[scope].extensions.length &&
			!confirm(
				"Extension source paths execute code with full system permissions. Save only trusted paths. Continue?",
			)
		)
			return;
		setSaving(scope);
		setError("");
		try {
			const res = await fetch("/api/resource-settings", {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ scope, ...drafts[scope] }),
			});
			if (!res.ok) throw new Error(await res.text());
			const data = (await res.json()) as ResourceSettingsInfo;
			setSettings(data);
			setDrafts({
				global: {
					skills: data.global.skills,
					extensions: data.global.extensions,
				},
				project: {
					skills: data.project.skills,
					extensions: data.project.extensions,
				},
			});
			pushLog(
				`Saved ${scope} skill and extension paths. Reload/restart may be needed for all sessions.`,
				"success",
			);
			onSaved();
		} catch (e: any) {
			setError(e.message || "Failed to save skill and extension paths");
			pushLog(
				`Failed to save skill and extension paths: ${e.message}`,
				"error",
			);
		} finally {
			setSaving(null);
		}
	};

	const changed = (scope: "global" | "project") =>
		JSON.stringify(drafts[scope]) !==
		JSON.stringify({
			skills: settings?.[scope].skills || [],
			extensions: settings?.[scope].extensions || [],
		});

	return (
		<div className="space-y-4">
			<Card>
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<CardTitle>Advanced: Native Pi Skill & Extension Paths</CardTitle>
						<Button variant="secondary" onClick={load} disabled={loading}>
							Refresh
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
					<p>
						Advanced/native Pi settings only. Prefer Lattice Libraries for
						orchestrator-managed agents, templates, skills, and extensions; use
						these raw <code>settings.json</code> arrays only for native Pi
						resources that must be loaded outside a library.
					</p>
					<p>
						Paths may be absolute, <code>~</code>-prefixed, relative, globs, or
						exclusions. Global relative paths resolve from{" "}
						<code>~/.pi/agent</code>; project relative paths resolve from{" "}
						<code>.pi</code>.
					</p>
					<p className="text-amber-300">
						Extensions execute code with full system permissions. Only configure
						extension paths you trust. Settings changes may require Pi
						reload/restart for all running sessions to see them.
					</p>
					{error && (
						<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">
							{error}
						</div>
					)}
				</CardContent>
			</Card>
			{settings ? (
				<div className="grid gap-4 xl:grid-cols-2">
					<ResourceScopePanel
						scope={settings.global}
						draft={drafts.global}
						onDraft={(draft) =>
							setDrafts((prev) => ({ ...prev, global: draft }))
						}
						changed={changed("global")}
						saving={saving === "global"}
						onSave={() => save("global")}
						onReset={() =>
							setDrafts((prev) => ({
								...prev,
								global: {
									skills: settings.global.skills,
									extensions: settings.global.extensions,
								},
							}))
						}
					/>
					<ResourceScopePanel
						scope={settings.project}
						draft={drafts.project}
						onDraft={(draft) =>
							setDrafts((prev) => ({ ...prev, project: draft }))
						}
						changed={changed("project")}
						saving={saving === "project"}
						onSave={() => save("project")}
						onReset={() =>
							setDrafts((prev) => ({
								...prev,
								project: {
									skills: settings.project.skills,
									extensions: settings.project.extensions,
								},
							}))
						}
					/>
				</div>
			) : (
				<Card>
					<CardContent className="p-6 text-sm text-muted-foreground">
						{loading
							? "Loading skill and extension paths…"
							: "No settings loaded."}
					</CardContent>
				</Card>
			)}
		</div>
	);
}

function ResourceScopePanel({
	scope,
	draft,
	onDraft,
	changed,
	saving,
	onSave,
	onReset,
}: {
	scope: ResourceScopeSettings;
	draft: { skills: string[]; extensions: string[] };
	onDraft: (draft: { skills: string[]; extensions: string[] }) => void;
	changed: boolean;
	saving: boolean;
	onSave: () => void;
	onReset: () => void;
}) {
	return (
		<Card className="min-h-[60vh]">
			<CardHeader className="border-b border-border">
				<div className="flex items-start justify-between gap-3">
					<div>
						<CardTitle>{scope.label}</CardTitle>
						<div
							className="mt-1 text-xs text-muted-foreground"
							title={scope.settingsPath}
						>
							{scope.settingsPath}
							{scope.exists ? "" : " (will be created)"}
						</div>
					</div>
					{changed && <Badge variant="default">Unsaved</Badge>}
				</div>
			</CardHeader>
			<CardContent className="space-y-5 pt-4">
				{(scope.parseError || scope.readError) && (
					<div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">
						{scope.parseError || scope.readError}
					</div>
				)}
				<ResourceListEditor
					title="Skill source paths"
					kind="skills"
					values={draft.skills}
					validation={scope.validation.skills}
					onChange={(skills) => onDraft({ ...draft, skills })}
				/>
				<ResourceListEditor
					title="Extension source paths"
					kind="extensions"
					values={draft.extensions}
					validation={scope.validation.extensions}
					onChange={(extensions) => onDraft({ ...draft, extensions })}
				/>
				<div className="flex gap-2 border-t border-border pt-4">
					<Button onClick={onSave} disabled={!changed || saving}>
						{saving ? "Saving…" : "Save changes"}
					</Button>
					<Button
						variant="secondary"
						onClick={onReset}
						disabled={!changed || saving}
					>
						Reset
					</Button>
				</div>
			</CardContent>
		</Card>
	);
}

function ResourceListEditor({
	title,
	kind,
	values,
	validation,
	onChange,
}: {
	title: string;
	kind: "skills" | "extensions";
	values: string[];
	validation: ResourcePathValidation[];
	onChange: (values: string[]) => void;
}) {
	const update = (index: number, value: string) =>
		onChange(values.map((item, i) => (i === index ? value : item)));
	const remove = (index: number) =>
		onChange(values.filter((_, i) => i !== index));
	return (
		<div className="space-y-2">
			<div className="flex items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-semibold">{title}</h3>
					<p className="text-xs text-muted-foreground">
						{kind === "skills"
							? "Markdown instruction sources; skills may reference scripts agents can invoke."
							: "Trusted local extension files/directories only."}
					</p>
				</div>
				<Button
					variant="secondary"
					className="px-2 py-1 text-xs"
					onClick={() => onChange([...values, ""])}
				>
					+ Add path
				</Button>
			</div>
			{!values.length ? (
				<div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
					No {kind} paths configured.
				</div>
			) : (
				<div className="space-y-2">
					{values.map((value, index) => (
						<ResourcePathRow
							key={index}
							value={value}
							validation={validation.find((item) => item.rawPath === value)}
							onChange={(next) => update(index, next)}
							onRemove={() => remove(index)}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function ResourcePathRow({
	value,
	validation,
	onChange,
	onRemove,
}: {
	value: string;
	validation?: ResourcePathValidation;
	onChange: (value: string) => void;
	onRemove: () => void;
}) {
	const variant = validation?.errors.length
		? "destructive"
		: validation?.exists
			? "success"
			: "outline";
	const label = validation
		? validation.type === "glob" || validation.type === "exclusion"
			? validation.type
			: validation.exists
				? `${validation.type}${typeof validation.count === "number" ? ` · ${validation.count}` : ""}`
				: "missing"
		: "pending";
	return (
		<div className="rounded-md border border-border p-2">
			<div className="flex gap-2">
				<Input
					value={value}
					onChange={(e) => onChange(e.target.value)}
					placeholder="e.g. ~/my-pi-skills or ../shared/extensions"
				/>
				<Button
					variant="destructive"
					className="px-2 py-1 text-xs"
					onClick={onRemove}
				>
					Remove
				</Button>
			</div>
			<div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<Badge variant={variant as any}>{label}</Badge>
				{validation?.resolvedPath && (
					<span title={validation.resolvedPath}>
						{shortPath(validation.resolvedPath)}
					</span>
				)}
				{validation?.warnings.map((warning, i) => (
					<span key={i} className="text-amber-300">
						⚠ {warning}
					</span>
				))}
				{validation?.errors.map((err, i) => (
					<span key={i} className="text-destructive">
						{err}
					</span>
				))}
			</div>
		</div>
	);
}
