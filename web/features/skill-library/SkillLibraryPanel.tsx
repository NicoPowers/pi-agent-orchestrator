import { useCallback, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type {
	OrchestratorLibrariesInfo,
	SkillDetailInfo,
	SkillInfo,
} from "../../types.js";
import type { TemplateInfo } from "../agent-types/AgentTypesPanel.js";

type TemplateAudience = "spawned" | "orchestrator" | "all";
type TemplateAutoApply = "none" | "spawned" | "all";
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
import { Select } from "../../components/ui/select.js";

type SkillDiagnostic = { type: string; message: string; path?: string };
type SkillFileEntry = {
	path: string;
	name: string;
	type: "file" | "directory";
	size?: number;
	markdown?: boolean;
	editable: boolean;
};
type SkillFileDetail = {
	path: string;
	content: string;
	size: number;
	mtimeMs: number;
	hash: string;
	markdown: boolean;
	editable: boolean;
};

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
	children: React.ReactNode;
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
	children: React.ReactNode;
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

function ValidationSummary({
	errors,
	serverError,
}: {
	errors: string[];
	serverError?: string;
}) {
	if (!errors.length && !serverError) return null;
	return (
		<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
			{serverError && <div>{serverError}</div>}
			{!!errors.length && (
				<ul className="list-disc pl-5">
					{errors.map((error) => (
						<li key={error}>{error}</li>
					))}
				</ul>
			)}
		</div>
	);
}

function shortPath(p?: string): string {
	if (!p) return "";
	return p.length > 42 ? "…" + p.slice(-39) : p;
}

function templateAudience(template: TemplateInfo): TemplateAudience {
	return template.audience || "spawned";
}

function templateAutoApply(template: TemplateInfo): TemplateAutoApply {
	if (template.autoApply) return template.autoApply;
	return template.applyToAll ? "spawned" : "none";
}

function displayScopeLabel(scope?: string): string {
	if (scope === "user") return "global";
	return scope || "unknown";
}

function skillScopeLabel(skill: SkillInfo): string {
	return displayScopeLabel(skill.scope || skill.source);
}

function skillTemplateItemValue(skill: SkillInfo): string {
	return skill.ref || skill.name;
}

function SkillSourceBadges({ skill }: { skill: SkillInfo }) {
	return (
		<>
			{skill.packageProvided && <Badge variant="outline">package</Badge>}
			<Badge variant="outline">{skillScopeLabel(skill)}</Badge>
		</>
	);
}

function normalizeSkillName(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9-]+/g, "-")
		.replace(/-+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 64)
		.replace(/-$/g, "");
}

export function SkillLibraryPanel({
	skills,
	loadingSkills = false,
	diagnostics,
	skillTemplates,
	onEditTemplate,
	onChanged,
}: {
	skills: SkillInfo[];
	loadingSkills?: boolean;
	diagnostics: SkillDiagnostic[];
	skillTemplates: TemplateInfo[];
	onEditTemplate: (template: TemplateInfo) => void;
	onChanged: () => void;
}) {
	const [query, setQuery] = useState("");
	const [scope, setScope] = useState("all");
	const [selectedId, setSelectedId] = useState<string | undefined>();
	const [detail, setDetail] = useState<SkillDetailInfo | null>(null);
	const [detailView, setDetailView] = useState<"preview" | "raw" | "metadata">(
		"preview",
	);
	const [tree, setTree] = useState<SkillFileEntry[]>([]);
	const [selectedFile, setSelectedFile] = useState("SKILL.md");
	const [fileDetail, setFileDetail] = useState<SkillFileDetail | null>(null);
	const [editing, setEditing] = useState(false);
	const [editContent, setEditContent] = useState("");
	const [saveError, setSaveError] = useState("");
	const [creating, setCreating] = useState(false);
	const [copying, setCopying] = useState<SkillInfo | null>(null);
	const [addTemplateName, setAddTemplateName] = useState("");
	const [templateError, setTemplateError] = useState("");
	const [editableFilter, setEditableFilter] = useState("all");
	const [referenceFilter, setReferenceFilter] = useState("all");
	const [orchestratorLibraries, setOrchestratorLibraries] =
		useState<OrchestratorLibrariesInfo | null>(null);
	const [loading, setLoading] = useState(false);
	const [error, setError] = useState("");
	const scopes = useMemo(
		() => Array.from(new Set(skills.map(skillScopeLabel))).sort(),
		[skills],
	);
	const selectedSkill = useMemo(
		() => skills.find((skill) => skill.id === selectedId) || skills[0],
		[selectedId, skills],
	);
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		return skills.filter((skill) => {
			if (scope !== "all" && skillScopeLabel(skill) !== scope) return false;
			if (editableFilter === "editable" && !skill.editable) return false;
			if (editableFilter === "readonly" && skill.editable) return false;
			const itemValue = skillTemplateItemValue(skill);
			const referenced = skillTemplates.some(
				(template) =>
					template.items.includes(itemValue) ||
					template.items.includes(skill.name),
			);
			if (referenceFilter === "referenced" && !referenced) return false;
			if (referenceFilter === "unreferenced" && referenced) return false;
			if (!q) return true;
			return [
				skill.name,
				skill.description,
				skill.path,
				skill.source,
				skill.scope,
			].some((value) => (value || "").toLowerCase().includes(q));
		});
	}, [editableFilter, query, referenceFilter, scope, skills, skillTemplates]);
	const templatesUsingSkill = useMemo(
		() =>
			selectedSkill
				? skillTemplates.filter(
						(template) =>
							template.items.includes(skillTemplateItemValue(selectedSkill)) ||
							template.items.includes(selectedSkill.name),
					)
				: [],
		[selectedSkill, skillTemplates],
	);
	const templatesMissingSkill = useMemo(
		() =>
			selectedSkill
				? skillTemplates.filter(
						(template) =>
							!template.items.includes(skillTemplateItemValue(selectedSkill)) &&
							!template.items.includes(selectedSkill.name),
					)
				: [],
		[selectedSkill, skillTemplates],
	);
	const detailMatchesSelected =
		!!selectedSkill?.id && detail?.skill.id === selectedSkill.id;
	const initialListLoading = loadingSkills && !skills.length;

	useEffect(() => {
		let cancelled = false;
		fetch("/api/orchestrator-libraries")
			.then((res) => (res.ok ? res.json() : undefined))
			.then((data) => {
				if (!cancelled && data)
					setOrchestratorLibraries(data as OrchestratorLibrariesInfo);
			})
			.catch(() => {
				if (!cancelled) setOrchestratorLibraries(null);
			});
		return () => {
			cancelled = true;
		};
	}, [skills.length]);

	useEffect(() => {
		setDetail(null);
		setTree([]);
		setSelectedFile("SKILL.md");
		setFileDetail(null);
		setEditContent("");
		setEditing(false);
		setSaveError("");
		if (!selectedSkill?.id) {
			setLoading(false);
			return;
		}
		let cancelled = false;
		setLoading(true);
		setError("");
		fetch(`/api/skills/${encodeURIComponent(selectedSkill.id)}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(await responseErrorText(res));
				return res.json();
			})
			.then((data) => {
				if (!cancelled) {
					setDetail(data);
					setSelectedFile("SKILL.md");
					setFileDetail(null);
					setEditContent(data.content || "");
					setEditing(false);
					setSaveError("");
				}
			})
			.catch((err) => {
				if (!cancelled) {
					setDetail(null);
					setError(err.message);
				}
			})
			.finally(() => {
				if (!cancelled) setLoading(false);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedSkill?.id]);

	useEffect(() => {
		if (selectedId && skills.some((skill) => skill.id === selectedId)) return;
		setSelectedId(skills[0]?.id);
	}, [selectedId, skills]);

	useEffect(() => {
		setTree([]);
		if (!selectedSkill?.id) return;
		let cancelled = false;
		fetch(`/api/skills/${encodeURIComponent(selectedSkill.id)}/tree`)
			.then(async (res) => {
				if (!res.ok) throw new Error(await responseErrorText(res));
				return res.json();
			})
			.then((data) => {
				if (!cancelled) setTree(Array.isArray(data.files) ? data.files : []);
			})
			.catch(() => {
				if (!cancelled) setTree([]);
			});
		return () => {
			cancelled = true;
		};
	}, [selectedSkill?.id]);

	const openSkillFile = useCallback(
		async (relativePath: string) => {
			if (!selectedSkill?.id) return;
			if (relativePath === "SKILL.md") {
				setSelectedFile("SKILL.md");
				setFileDetail(null);
				return;
			}
			setSaveError("");
			const res = await fetch(
				`/api/skills/${encodeURIComponent(selectedSkill.id)}/files?path=${encodeURIComponent(relativePath)}`,
			);
			if (!res.ok) return setSaveError(await responseErrorText(res));
			const file = await res.json();
			setSelectedFile(file.path);
			setFileDetail(file);
			setEditing(false);
			setDetailView("preview");
		},
		[selectedSkill?.id],
	);

	const saveEdit = async () => {
		if (!detail?.skill.id) return;
		setSaveError("");
		if (fileDetail) {
			const res = await fetch(
				`/api/skills/${encodeURIComponent(detail.skill.id)}/files?path=${encodeURIComponent(fileDetail.path)}`,
				{
					method: "PUT",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({
						content: editContent,
						expectedHash: fileDetail.hash,
					}),
				},
			);
			if (!res.ok) return setSaveError(await responseErrorText(res));
			const next = await res.json();
			setFileDetail(next);
			setEditContent(next.content || "");
			setEditing(false);
			return;
		}
		const res = await fetch(
			`/api/skills/${encodeURIComponent(detail.skill.id)}`,
			{
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					content: editContent,
					expectedHash: detail.hash,
				}),
			},
		);
		if (!res.ok) return setSaveError(await responseErrorText(res));
		const next = await res.json();
		setDetail(next);
		setEditContent(next.content || "");
		setEditing(false);
		onChanged();
	};
	const displayedContent = fileDetail?.content ?? detail?.content ?? "";
	const displayedBody = fileDetail
		? fileDetail.content
		: detail?.body || detail?.content || "";

	const deleteSelected = async () => {
		if (!detail?.skill.id || !detailMatchesSelected) return;
		if (
			!confirm(
				`Delete skill '${detail.skill.name}'? This removes ${detail.skill.kind === "directory" ? "the entire skill directory" : "the skill file"}.`,
			)
		)
			return;
		setSaveError("");
		const res = await fetch(
			`/api/skills/${encodeURIComponent(detail.skill.id)}`,
			{ method: "DELETE" },
		);
		if (!res.ok) return setSaveError(await responseErrorText(res));
		setDetail(null);
		setEditing(false);
		setSelectedId(undefined);
		onChanged();
	};
	const addToTemplate = async () => {
		if (!selectedSkill || !addTemplateName) return;
		const template = skillTemplates.find(
			(candidate) => candidate.name === addTemplateName,
		);
		if (!template) return;
		setTemplateError("");
		const skills = Array.from(
			new Set([...template.items, skillTemplateItemValue(selectedSkill)]),
		);
		const res = await fetch("/api/skill-templates", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				name: template.name,
				description: template.description,
				audience: templateAudience(template),
				autoApply: templateAutoApply(template),
				skills,
			}),
		});
		if (!res.ok) return setTemplateError(await responseErrorText(res));
		setAddTemplateName("");
		onChanged();
	};

	return (
		<div className="grid h-[calc(100vh-6.5rem)] min-h-[620px] gap-4 lg:grid-cols-[minmax(380px,460px)_1fr]">
			<Card className="min-h-0 overflow-hidden">
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<CardTitle>Skill Library</CardTitle>
						<Button
							variant="secondary"
							className="px-2 py-1 text-xs"
							onClick={() => setCreating(true)}
						>
							+ New Skill
						</Button>
					</div>
				</CardHeader>
				<CardContent className="flex h-[calc(100%-4.5rem)] flex-col gap-3 pt-4">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						placeholder="Search skills…"
					/>
					<div className="grid gap-2">
						<Select value={scope} onChange={(e) => setScope(e.target.value)}>
							<option value="all">All sources</option>
							{scopes.map((value) => (
								<option key={value} value={value}>
									{value}
								</option>
							))}
						</Select>
						<Select
							value={editableFilter}
							onChange={(e) => setEditableFilter(e.target.value)}
						>
							<option value="all">Editable + read-only</option>
							<option value="editable">Editable only</option>
							<option value="readonly">Read-only only</option>
						</Select>
						<Select
							value={referenceFilter}
							onChange={(e) => setReferenceFilter(e.target.value)}
						>
							<option value="all">All template usage</option>
							<option value="referenced">In a template</option>
							<option value="unreferenced">Not in templates</option>
						</Select>
					</div>
					{!!diagnostics.length && (
						<div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">
							{diagnostics.length} skill diagnostic
							{diagnostics.length === 1 ? "" : "s"}. Select Metadata or inspect
							invalid skill files for details.
						</div>
					)}
					<div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
						{initialListLoading ? (
							<SkillListSkeleton />
						) : !filtered.length ? (
							<div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
								No skills found.
							</div>
						) : (
							filtered.map((skill) => {
								const active = skill.id === selectedSkill?.id;
								return (
									<button
										key={skill.id || skill.path}
										className={`w-full rounded-md border p-3 text-left transition ${active ? "border-primary bg-primary/10" : "border-border hover:bg-white/5"}`}
										onClick={() => setSelectedId(skill.id)}
									>
										<div className="flex items-center justify-between gap-2">
											<span className="text-sm font-semibold">
												{skill.name}
											</span>
											<div className="flex gap-1">
												<SkillSourceBadges skill={skill} />
												{skill.editable && (
													<Badge variant="success">editable</Badge>
												)}
											</div>
										</div>
										<div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
											{skill.description || "No description."}
										</div>
										<div
											className="mt-2 truncate text-[11px] text-muted-foreground"
											title={skill.path}
										>
											{shortPath(skill.path)}
										</div>
									</button>
								);
							})
						)}
					</div>
				</CardContent>
			</Card>
			<Card className="min-h-0 overflow-hidden">
				<CardHeader className="border-b border-border">
					<div className="flex flex-wrap items-center justify-between gap-3">
						<CardTitle>{selectedSkill?.name || "Select a skill"}</CardTitle>
						{selectedSkill && (
							<div className="flex flex-wrap items-center gap-2">
								{!detailMatchesSelected ? (
									<SkillActionSkeleton />
								) : (
									<>
										{!editing && (
											<Button
												variant="secondary"
												className="px-2 py-1 text-xs"
												onClick={() => setCopying(detail.skill)}
											>
												Copy
											</Button>
										)}
										{detail.skill.editable && !editing && (
											<>
												<Button
													variant="secondary"
													className="px-2 py-1 text-xs"
													onClick={() => {
														setEditContent(
															fileDetail?.content ?? detail.content,
														);
														setEditing(true);
														setDetailView("preview");
													}}
												>
													Edit
												</Button>
												<Button
													variant="destructive"
													className="px-2 py-1 text-xs"
													onClick={deleteSelected}
												>
													Delete
												</Button>
											</>
										)}
										{editing && (
											<>
												<Button
													variant="secondary"
													className="px-2 py-1 text-xs"
													onClick={() => {
														setEditing(false);
														setEditContent(
															fileDetail?.content ?? detail?.content ?? "",
														);
														setSaveError("");
													}}
												>
													Cancel
												</Button>
												<Button
													className="px-2 py-1 text-xs"
													onClick={saveEdit}
												>
													Save
												</Button>
											</>
										)}
										<div className="flex rounded-md border border-border bg-background p-1">
											{(["preview", "raw", "metadata"] as const).map((view) => (
												<button
													key={view}
													type="button"
													className={`rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${detailView === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
													onClick={() => setDetailView(view)}
												>
													{view === "preview"
														? "Preview"
														: view === "raw"
															? "Raw"
															: "Metadata"}
												</button>
											))}
										</div>
									</>
								)}
							</div>
						)}
					</div>
				</CardHeader>
				<CardContent className="flex h-[calc(100%-4.5rem)] flex-col gap-3 pt-4">
					{!selectedSkill ? (
						initialListLoading ? (
							<SkillDetailSkeleton />
						) : (
							<div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
								No skills discovered.
							</div>
						)
					) : (
						<>
							<div className="flex flex-wrap gap-2">
								<SkillSourceBadges skill={selectedSkill} />
								<Badge variant="outline">{selectedSkill.kind || "skill"}</Badge>
								{selectedSkill.editable ? (
									<Badge variant="success">editable</Badge>
								) : (
									<Badge variant="warning">read-only</Badge>
								)}
							</div>
							<div className="break-all rounded-md border border-border bg-background p-2 font-mono text-xs text-muted-foreground">
								{selectedSkill.path}
							</div>
							<div className="rounded-md border border-border bg-background p-3">
								<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
									<div className="text-xs uppercase tracking-wide text-muted-foreground">
										Skill templates using this skill
									</div>
									{!!templatesMissingSkill.length && (
										<div className="flex gap-2">
											<Select
												value={addTemplateName}
												onChange={(e) => setAddTemplateName(e.target.value)}
												className="py-1 text-xs"
											>
												<option value="">Add to template…</option>
												{templatesMissingSkill.map((template) => (
													<option key={template.name} value={template.name}>
														{template.name}
													</option>
												))}
											</Select>
											<Button
												variant="secondary"
												className="px-2 py-1 text-xs"
												onClick={addToTemplate}
												disabled={!addTemplateName}
											>
												Add
											</Button>
										</div>
									)}
								</div>
								<div className="flex flex-wrap gap-1">
									{templatesUsingSkill.length ? (
										templatesUsingSkill.map((template) => (
											<button
												key={template.name}
												type="button"
												onClick={() => onEditTemplate(template)}
												title="Edit template"
												className="rounded-full"
											>
												<Badge variant="default">{template.name}</Badge>
											</button>
										))
									) : (
										<span className="text-xs text-muted-foreground">
											No skill templates include this skill yet.
										</span>
									)}
								</div>
								{templateError && (
									<div className="mt-2 text-xs text-destructive">
										{templateError}
									</div>
								)}
							</div>
							{loading && (
								<div className="text-sm text-muted-foreground">
									Loading preview…
								</div>
							)}
							{error && (
								<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
									{error}
								</div>
							)}
							{saveError && (
								<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
									{saveError}
								</div>
							)}
							{loading && !detailMatchesSelected && (
								<div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[260px_1fr]">
									<div className="min-h-0 rounded-md border border-border bg-background p-2">
										<div className="mb-2 h-3 w-16 animate-pulse rounded bg-muted" />
										<div className="space-y-2">
											{[0, 1, 2, 3].map((idx) => (
												<div
													key={idx}
													className="h-5 animate-pulse rounded bg-muted/70"
												/>
											))}
										</div>
									</div>
									<div className="min-h-0 rounded-md border border-border bg-background p-5">
										<div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted" />
										<div className="space-y-3">
											{[0, 1, 2, 3, 4].map((idx) => (
												<div
													key={idx}
													className="h-4 animate-pulse rounded bg-muted/70"
												/>
											))}
										</div>
									</div>
								</div>
							)}
							{detailMatchesSelected && detail && (
								<div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[260px_1fr]">
									<div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-2">
										<div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">
											Files
										</div>
										{tree.length ? (
											tree.map((file) => (
												<button
													key={file.path}
													type="button"
													disabled={file.type === "directory"}
													className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${selectedFile === file.path ? "bg-primary/15 text-primary" : file.type === "directory" ? "text-muted-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
													style={{
														paddingLeft: `${8 + Math.max(0, file.path.split("/").length - 1) * 12}px`,
													}}
													onClick={() =>
														file.type === "file" && openSkillFile(file.path)
													}
												>
													{file.type === "directory"
														? "▾ "
														: file.markdown
															? "◇ "
															: "• "}
													{file.name}
												</button>
											))
										) : (
											<div className="text-xs text-muted-foreground">
												No file tree available.
											</div>
										)}
									</div>
									<div className="min-h-0 overflow-hidden">
										{editing ? (
											<div className="grid h-full gap-3 xl:grid-cols-2">
												<Textarea
													className="h-full resize-none font-mono text-xs"
													value={editContent}
													onChange={(e) => setEditContent(e.target.value)}
												/>
												<MarkdownPreview
													content={parseMarkdownBody(editContent)}
												/>
											</div>
										) : (
											<>
												{detailView === "preview" && (
													<MarkdownPreview
														content={displayedBody}
														basePath={selectedFile}
														onOpenRelative={openSkillFile}
													/>
												)}
												{detailView === "raw" && (
													<pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-xs leading-6">
														{displayedContent}
													</pre>
												)}
												{detailView === "metadata" && (
													<pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-xs leading-6">
														{JSON.stringify(
															{
																skill: detail.skill,
																selectedFile,
																file: fileDetail,
																frontmatter: detail.frontmatter,
																diagnostics: diagnostics.filter(
																	(diagnostic) =>
																		diagnostic.path === detail.skill.path ||
																		diagnostic.path === detail.skill.filePath,
																),
																mtimeMs: detail.mtimeMs,
																hash: detail.hash,
															},
															null,
															2,
														)}
													</pre>
												)}
											</>
										)}
									</div>
								</div>
							)}
						</>
					)}
				</CardContent>
			</Card>
			<CreateSkillDialog
				open={creating}
				libraries={orchestratorLibraries}
				onClose={() => setCreating(false)}
				onCreated={(created) => {
					setCreating(false);
					setSelectedId(created.skill.id);
					setDetail(created);
					setEditContent(created.content);
					onChanged();
				}}
			/>
			<CopySkillDialog
				source={copying}
				onClose={() => setCopying(null)}
				onCopied={(copied) => {
					setCopying(null);
					setSelectedId(copied.skill.id);
					setDetail(copied);
					setEditContent(copied.content);
					onChanged();
				}}
			/>
		</div>
	);
}

function SkillListSkeleton() {
	return (
		<div className="space-y-2" aria-label="Loading skills">
			{[0, 1, 2, 3, 4].map((idx) => (
				<div key={idx} className="rounded-md border border-border p-3">
					<div className="flex items-center justify-between gap-3">
						<div className="h-4 w-32 animate-pulse rounded bg-muted" />
						<div className="h-5 w-20 animate-pulse rounded-full bg-muted/70" />
					</div>
					<div className="mt-3 h-3 w-full animate-pulse rounded bg-muted/70" />
					<div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-muted/60" />
				</div>
			))}
		</div>
	);
}

function SkillDetailSkeleton() {
	return (
		<div
			className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[260px_1fr]"
			aria-label="Loading skill library"
		>
			<div className="min-h-0 rounded-md border border-border bg-background p-2">
				<div className="mb-2 h-3 w-16 animate-pulse rounded bg-muted" />
				<div className="space-y-2">
					{[0, 1, 2, 3].map((idx) => (
						<div key={idx} className="h-5 animate-pulse rounded bg-muted/70" />
					))}
				</div>
			</div>
			<div className="min-h-0 rounded-md border border-border bg-background p-5">
				<div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted" />
				<div className="space-y-3">
					{[0, 1, 2, 3, 4].map((idx) => (
						<div key={idx} className="h-4 animate-pulse rounded bg-muted/70" />
					))}
				</div>
			</div>
		</div>
	);
}

function SkillActionSkeleton() {
	return (
		<div className="flex items-center gap-2" aria-label="Loading skill actions">
			<span className="text-xs text-muted-foreground">
				Loading skill actions…
			</span>
			<span className="h-7 w-16 animate-pulse rounded-md bg-muted" />
			<span className="h-7 w-14 animate-pulse rounded-md bg-muted" />
			<span className="h-7 w-20 animate-pulse rounded-md bg-muted" />
		</div>
	);
}

function parseMarkdownBody(content: string): string {
	const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
	return match ? content.slice(match[0].length) : content;
}

function CreateSkillDialog({
	open,
	libraries,
	onClose,
	onCreated,
}: {
	open: boolean;
	libraries: OrchestratorLibrariesInfo | null;
	onClose: () => void;
	onCreated: (detail: SkillDetailInfo) => void;
}) {
	const libraryTargets = useMemo(
		() =>
			(libraries?.libraries || []).filter(
				(library) => library.valid && library.manifest?.name,
			),
		[libraries],
	);
	const defaultTarget = libraryTargets[0]?.manifest?.name
		? `library:${libraryTargets[0].manifest.name}`
		: "global";
	const [target, setTarget] = useState(defaultTarget);
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [body, setBody] = useState("");
	const [scaffold, setScaffold] = useState("minimal");
	const [serverError, setServerError] = useState("");
	useEffect(() => {
		if (open) {
			setTarget(defaultTarget);
			setName("");
			setDescription("");
			setBody("");
			setScaffold("minimal");
			setServerError("");
		}
	}, [defaultTarget, open]);
	const savedName = normalizeSkillName(name);
	const errors = [
		!savedName ? "Name is required." : undefined,
		!description.trim() ? "Description is required." : undefined,
	].filter(Boolean) as string[];
	const create = async () => {
		setServerError("");
		if (errors.length) return;
		const payload = target.startsWith("library:")
			? {
					targetLibrary: target.slice("library:".length),
					name: savedName,
					description: description.trim(),
					body: body.trim() || undefined,
					scaffold,
				}
			: {
					scope: "global",
					name: savedName,
					description: description.trim(),
					body: body.trim() || undefined,
					scaffold,
				};
		const res = await fetch("/api/skills", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) return setServerError(await responseErrorText(res));
		onCreated(await res.json());
	};
	return (
		<Dialog
			open={open}
			title="New Skill"
			onOpenChange={onClose}
			className="max-w-3xl"
		>
			<div className="space-y-3">
				<FieldLabel required>Target</FieldLabel>
				<Select value={target} onChange={(e) => setTarget(e.target.value)}>
					{libraryTargets.map((library) => (
						<option
							key={library.root}
							value={`library:${library.manifest!.name}`}
						>
							Orchestrator Library: {library.manifest!.name}
						</option>
					))}
					<option value="global">Global Pi skills (~/.pi/agent/skills)</option>
				</Select>
				<FormMessage tone={libraryTargets.length ? "success" : "muted"}>
					{libraryTargets.length
						? "New skills default to the first configured Orchestrator Library by load order."
						: "No Orchestrator Library is configured; new skills fall back to the global Pi skills folder."}
				</FormMessage>
				<FieldLabel required>Name</FieldLabel>
				<Input value={name} onChange={(e) => setName(e.target.value)} />
				<FormMessage tone={savedName ? "success" : "muted"}>
					Will be saved as:{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-foreground">
						{savedName || "—"}
					</code>
				</FormMessage>
				<FieldLabel required>Description</FieldLabel>
				<Input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
				<FieldLabel optional>Scaffold</FieldLabel>
				<Select value={scaffold} onChange={(e) => setScaffold(e.target.value)}>
					<option value="minimal">Minimal SKILL.md only</option>
					<option value="rich">
						Rich directory with references/scripts/assets/examples
					</option>
				</Select>
				<FieldLabel optional>Initial body</FieldLabel>
				<Textarea
					rows={8}
					value={body}
					onChange={(e) => setBody(e.target.value)}
					placeholder="# My Skill\n\n## Workflow\n\n1. ..."
				/>
				<ValidationSummary errors={errors} serverError={serverError} />
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={create} disabled={!!errors.length}>
						Create Skill
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

function CopySkillDialog({
	source,
	onClose,
	onCopied,
}: {
	source: SkillInfo | null;
	onClose: () => void;
	onCopied: (detail: SkillDetailInfo) => void;
}) {
	const [scope, setScope] = useState("project");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [serverError, setServerError] = useState("");
	const open = !!source;
	useEffect(() => {
		if (source) {
			setScope("project");
			setName(`${source.name}-copy`);
			setDescription(
				source.description
					? `${source.description} (derived copy)`
					: "Derived copy",
			);
			setServerError("");
		}
	}, [source?.id, source?.name]);
	const savedName = normalizeSkillName(name);
	const errors = [
		!source?.id ? "Select a source skill." : undefined,
		!savedName ? "Name is required." : undefined,
		source && savedName === source.name
			? "Choose a new skill name; duplicate names collide and Pi keeps the first discovered skill."
			: undefined,
		!description.trim() ? "Description is required." : undefined,
	].filter(Boolean) as string[];
	const copy = async () => {
		if (!source?.id || errors.length) return;
		setServerError("");
		const res = await fetch(
			`/api/skills/${encodeURIComponent(source.id)}/copy`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					scope,
					name: savedName,
					description: description.trim(),
				}),
			},
		);
		if (!res.ok) return setServerError(await responseErrorText(res));
		onCopied(await res.json());
	};
	return (
		<Dialog
			open={open}
			title={source ? `Copy Skill: ${source.name}` : "Copy Skill"}
			onOpenChange={onClose}
			className="max-w-2xl"
		>
			<div className="space-y-3">
				<div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
					Copy creates a new editable skill directory and rewrites{" "}
					<code>SKILL.md</code> frontmatter. Do not reuse an existing skill
					name: duplicate names collide during Pi discovery and Pi keeps the
					first discovered skill.
				</div>
				{source && (
					<div className="rounded-md border border-border bg-background p-2 text-xs text-muted-foreground">
						<div>
							Source: <span className="text-foreground">{source.name}</span> (
							{skillScopeLabel(source)})
						</div>
						<div className="truncate" title={source.path}>
							{source.path}
						</div>
					</div>
				)}
				<FieldLabel required>Target scope</FieldLabel>
				<Select value={scope} onChange={(e) => setScope(e.target.value)}>
					<option value="project">Project (.pi/skills)</option>
					<option value="global">
						Global / all repos (~/.pi/agent/skills)
					</option>
				</Select>
				<FieldLabel required>New name</FieldLabel>
				<Input value={name} onChange={(e) => setName(e.target.value)} />
				<FormMessage
					tone={savedName && savedName !== source?.name ? "success" : "muted"}
				>
					Will be saved as:{" "}
					<code className="rounded bg-muted px-1 py-0.5 text-foreground">
						{savedName || "—"}
					</code>
				</FormMessage>
				<FieldLabel required>New description</FieldLabel>
				<Input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
				<ValidationSummary errors={errors} serverError={serverError} />
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button onClick={copy} disabled={!!errors.length}>
						Copy Skill
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

function resolveRelativeMarkdownLink(
	basePath: string,
	href?: string,
): string | undefined {
	if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href))
		return undefined;
	const clean = href.split("#")[0].split("?")[0];
	if (!clean.toLowerCase().endsWith(".md")) return undefined;
	const baseParts = basePath.includes("/")
		? basePath.split("/").slice(0, -1)
		: [];
	const parts: string[] = [];
	for (const part of [...baseParts, ...clean.split("/")]) {
		if (!part || part === ".") continue;
		if (part === "..") parts.pop();
		else parts.push(part);
	}
	return parts.join("/");
}

function escapeXmlLikeBlocks(content: string): string {
	return content
		.replace(/^<([a-z][\w-]*)([^>]*)>$/gim, "`<$1$2>`")
		.replace(/^<\/([a-z][\w-]*)>$/gim, "`</$1>`");
}

function MarkdownPreview({
	content,
	basePath = "SKILL.md",
	onOpenRelative,
}: {
	content: string;
	basePath?: string;
	onOpenRelative?: (path: string) => void;
}) {
	return (
		<div className="h-full overflow-auto rounded-md border border-border bg-background p-5 text-sm leading-6">
			<ReactMarkdown
				remarkPlugins={[remarkGfm]}
				components={{
					h1: ({ children }) => (
						<h1 className="mb-3 border-b border-border pb-2 text-2xl font-semibold">
							{children}
						</h1>
					),
					h2: ({ children }) => (
						<h2 className="mb-2 mt-4 text-xl font-semibold">{children}</h2>
					),
					h3: ({ children }) => (
						<h3 className="mb-2 mt-3 text-lg font-semibold">{children}</h3>
					),
					p: ({ children }) => (
						<p className="mb-3 text-foreground/90">{children}</p>
					),
					a: ({ href, children }) => {
						const relative = resolveRelativeMarkdownLink(basePath, href);
						return (
							<a
								href={href}
								target={relative ? undefined : "_blank"}
								rel={relative ? undefined : "noreferrer"}
								className="text-primary underline underline-offset-2"
								onClick={(e) => {
									if (relative && onOpenRelative) {
										e.preventDefault();
										onOpenRelative(relative);
									}
								}}
							>
								{children}
							</a>
						);
					},
					ul: ({ children }) => (
						<ul className="mb-3 list-disc pl-5">{children}</ul>
					),
					ol: ({ children }) => (
						<ol className="mb-3 list-decimal pl-5">{children}</ol>
					),
					code: ({ children, className }) =>
						className ? (
							<code className={className}>{children}</code>
						) : (
							<code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">
								{children}
							</code>
						),
					pre: ({ children }) => (
						<pre className="mb-3 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">
							{children}
						</pre>
					),
					blockquote: ({ children }) => (
						<blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground">
							{children}
						</blockquote>
					),
					table: ({ children }) => (
						<div className="mb-3 overflow-auto">
							<table className="w-full border-collapse text-xs">
								{children}
							</table>
						</div>
					),
					th: ({ children }) => (
						<th className="border border-border px-2 py-1 text-left font-semibold">
							{children}
						</th>
					),
					td: ({ children }) => (
						<td className="border border-border px-2 py-1">{children}</td>
					),
				}}
			>
				{escapeXmlLikeBlocks(content)}
			</ReactMarkdown>
		</div>
	);
}
