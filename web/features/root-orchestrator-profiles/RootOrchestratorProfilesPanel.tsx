import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
	LatticeLibrariesInfo,
	RootProfileDetailInfo,
	RootProfileInfo,
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
import { Select } from "../../components/ui/select.js";

function splitItems(text: string): string[] {
	return Array.from(
		new Set(
			text
				.split(/[\n,]/)
				.map((item) => item.trim())
				.filter(Boolean),
		),
	);
}

function sourceLabel(profile: RootProfileInfo): string {
	if (profile.source === "lattice-library")
		return `library: ${profile.scope || "unknown"}`;
	return profile.source;
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

function RootProfileEditorDialog({
	open,
	mode,
	sourceProfile,
	detail,
	onClose,
	onSaved,
}: {
	open: boolean;
	mode: "new" | "edit" | "copy";
	sourceProfile?: RootProfileInfo;
	detail?: RootProfileDetailInfo;
	onClose: () => void;
	onSaved: () => void;
}) {
	const [libraries, setLibraries] = useState<LatticeLibrariesInfo | null>(
		null,
	);
	const [targetLibrary, setTargetLibrary] = useState("");
	const [name, setName] = useState("");
	const [description, setDescription] = useState("");
	const [skillsText, setSkillsText] = useState("");
	const [skillTemplatesText, setSkillTemplatesText] = useState("");
	const [instructions, setInstructions] = useState("");
	const [serverError, setServerError] = useState("");

	useEffect(() => {
		if (!open) return;
		setServerError("");
		fetch("/api/lattice-libraries")
			.then((res) => (res.ok ? res.json() : null))
			.then((data) => setLibraries(data))
			.catch(() => setLibraries(null));
		const profile = detail?.profile || sourceProfile;
		setTargetLibrary(
			mode === "edit"
				? ""
				: profile?.source === "lattice-library"
					? profile.scope || ""
					: "",
		);
		setName(
			mode === "new"
				? ""
				: mode === "copy"
					? `${sourceProfile?.name || "profile"}-copy`
					: profile?.name || "",
		);
		setDescription(
			mode === "new"
				? ""
				: mode === "copy"
					? `${sourceProfile?.description || "Root orchestrator profile"} copy`
					: profile?.description || "",
		);
		setSkillsText(
			(detail?.profile.skills || sourceProfile?.skills || []).join("\n"),
		);
		setSkillTemplatesText(
			(
				detail?.profile.skillTemplates ||
				sourceProfile?.skillTemplates ||
				[]
			).join("\n"),
		);
		setInstructions(detail?.body || sourceProfile?.instructions || "");
	}, [open, mode, sourceProfile, detail]);

	const validLibraries = (libraries?.libraries || []).filter(
		(library) => library.valid && library.manifest,
	);
	const errors = [
		!name.trim() ? "Name is required." : undefined,
		!description.trim() ? "Description is required." : undefined,
		mode !== "edit" && !targetLibrary && validLibraries.length
			? "Choose an Lattice Library target."
			: undefined,
	].filter(Boolean) as string[];
	const profile = detail?.profile || sourceProfile;
	const initialTargetLibrary =
		mode === "edit"
			? ""
			: profile?.source === "lattice-library"
				? profile.scope || ""
				: "";
	const isDirty =
		targetLibrary !== initialTargetLibrary ||
		name !==
			(mode === "new"
				? ""
				: mode === "copy"
					? `${sourceProfile?.name || "profile"}-copy`
					: profile?.name || "") ||
		description !==
			(mode === "new"
				? ""
				: mode === "copy"
					? `${sourceProfile?.description || "Root orchestrator profile"} copy`
					: profile?.description || "") ||
		skillsText !==
			(detail?.profile.skills || sourceProfile?.skills || []).join("\n") ||
		skillTemplatesText !==
			(
				detail?.profile.skillTemplates ||
				sourceProfile?.skillTemplates ||
				[]
			).join("\n") ||
		instructions !== (detail?.body || sourceProfile?.instructions || "");
	const discardMessage = "Discard unsaved root profile changes?";
	const close = () => {
		if (!isDirty || confirm(discardMessage)) onClose();
	};

	const save = async () => {
		setServerError("");
		if (errors.length) return;
		const payload = {
			targetLibrary: targetLibrary || undefined,
			name: name.trim(),
			description: description.trim(),
			skills: splitItems(skillsText),
			skillTemplates: splitItems(skillTemplatesText),
			instructions,
			expectedHash: detail?.hash,
		};
		const url =
			mode === "copy" && sourceProfile
				? `/api/root-profiles/${encodeURIComponent(sourceProfile.name)}/copy`
				: "/api/root-profiles";
		const res = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		if (!res.ok) return setServerError(await responseErrorText(res));
		onSaved();
	};

	const title =
		mode === "new"
			? "New Root Orchestrator Profile"
			: mode === "copy"
				? `Copy ${sourceProfile?.name || "Profile"}`
				: `Edit ${detail?.profile.name || "Profile"}`;
	return (
		<Dialog
			open={open}
			title={title}
			onOpenChange={onClose}
			confirmOnClose={isDirty}
			confirmCloseMessage={discardMessage}
			className="max-w-4xl"
		>
			<div className="space-y-3">
				{mode !== "edit" && (
					<>
						<FieldLabel required>Target Lattice Library</FieldLabel>
						{validLibraries.length ? (
							<Select
								value={targetLibrary}
								onChange={(e) => setTargetLibrary(e.target.value)}
							>
								<option value="">-- choose library --</option>
								{validLibraries.map((library) => (
									<option
										key={library.manifest!.name}
										value={library.manifest!.name}
									>
										{library.manifest!.name} ({library.root})
									</option>
								))}
							</Select>
						) : (
							<div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
								No valid Lattice Libraries are configured. This profile
								will be saved to the project .pi/orchestrator-profiles fallback.
							</div>
						)}
					</>
				)}
				<FieldLabel required>Name</FieldLabel>
				<Input
					value={name}
					readOnly={mode === "edit"}
					onChange={(e) => setName(e.target.value)}
				/>
				<FieldLabel required>Description</FieldLabel>
				<Input
					value={description}
					onChange={(e) => setDescription(e.target.value)}
				/>
				<FieldLabel optional>Skills</FieldLabel>
				<Textarea
					rows={3}
					value={skillsText}
					onChange={(e) => setSkillsText(e.target.value)}
					placeholder="Skill names, paths, or library refs"
				/>
				<FieldLabel optional>Skill Templates</FieldLabel>
				<Textarea
					rows={3}
					value={skillTemplatesText}
					onChange={(e) => setSkillTemplatesText(e.target.value)}
					placeholder="Root-eligible skill template names"
				/>
				<FieldLabel optional>Root Instructions</FieldLabel>
				<Textarea
					rows={10}
					value={instructions}
					onChange={(e) => setInstructions(e.target.value)}
					placeholder="Instructions appended when /orchestrate activates this profile"
				/>
				<FormMessage>
					Root Orchestrator Profiles are root-only instructions/skills for
					/orchestrate. They are not Agent Types and do not load arbitrary
					extensions.
				</FormMessage>
				{(!!errors.length || serverError) && (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
						{serverError && <div>{serverError}</div>}
						<ul className="list-disc pl-5">
							{errors.map((error) => (
								<li key={error}>{error}</li>
							))}
						</ul>
					</div>
				)}
				<div className="flex justify-end gap-2">
					<Button variant="secondary" onClick={close}>
						Cancel
					</Button>
					<Button onClick={save} disabled={!!errors.length}>
						{mode === "copy" ? "Copy Profile" : "Save Profile"}
					</Button>
				</div>
			</div>
		</Dialog>
	);
}

export function RootOrchestratorProfilesPanel({
	profiles,
	onChanged,
	pushLog,
}: {
	profiles: RootProfileInfo[];
	onChanged: () => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const [selectedName, setSelectedName] = useState<string>(
		profiles[0]?.name || "",
	);
	const [detail, setDetail] = useState<RootProfileDetailInfo | undefined>();
	const [dialog, setDialog] = useState<{
		mode: "new" | "edit" | "copy";
		profile?: RootProfileInfo;
	} | null>(null);
	const selected =
		profiles.find((profile) => profile.name === selectedName) || profiles[0];

	useEffect(() => {
		if (!selectedName && profiles[0]) setSelectedName(profiles[0].name);
	}, [profiles, selectedName]);

	useEffect(() => {
		let cancelled = false;
		if (!selected?.name) {
			setDetail(undefined);
			return;
		}
		setDetail(undefined);
		fetch(`/api/root-profiles/${encodeURIComponent(selected.name)}`)
			.then(async (res) => {
				if (!res.ok) throw new Error(await responseErrorText(res));
				return res.json();
			})
			.then((data) => {
				if (!cancelled) setDetail(data);
			})
			.catch((e) => {
				if (!cancelled)
					pushLog(
						`Failed to load root profile '${selected.name}': ${e.message}`,
						"error",
					);
			});
		return () => {
			cancelled = true;
		};
	}, [selected?.name, pushLog]);

	const deleteProfile = async (profile: RootProfileInfo) => {
		if (!confirm(`Delete Root Orchestrator Profile '${profile.name}'?`)) return;
		const res = await fetch(
			`/api/root-profiles/${encodeURIComponent(profile.name)}`,
			{ method: "DELETE" },
		);
		if (!res.ok)
			return pushLog(`Delete failed: ${await responseErrorText(res)}`, "error");
		pushLog(`Deleted Root Orchestrator Profile '${profile.name}'`, "warn");
		setSelectedName("");
		onChanged();
	};

	const sorted = [...profiles].sort((a, b) =>
		a.readOnly === b.readOnly
			? a.name.localeCompare(b.name)
			: a.readOnly
				? 1
				: -1,
	);
	return (
		<div className="grid min-h-[70vh] gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
			<Card>
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<CardTitle>Root Orchestrator Profiles</CardTitle>
						<Button
							variant="secondary"
							className="px-2 py-1 text-xs"
							onClick={() => setDialog({ mode: "new" })}
						>
							+ New Profile
						</Button>
					</div>
				</CardHeader>
				<CardContent className="space-y-3 pt-4">
					<FormMessage>
						Profiles configure the interactive root /orchestrate session with
						instructions and root-eligible skills. They are not spawnable Agent
						Types.
					</FormMessage>
					{!sorted.length ? (
						<p className="text-sm text-muted-foreground">
							No root profiles found.
						</p>
					) : (
						sorted.map((profile) => (
							<button
								key={`${profile.source}:${profile.scope || ""}:${profile.name}`}
								className={`w-full rounded-md border p-3 text-left transition ${selected?.name === profile.name ? "border-primary bg-primary/10" : "border-border hover:border-primary/50"}`}
								onClick={() => setSelectedName(profile.name)}
							>
								<div className="flex items-center justify-between gap-2">
									<span className="truncate text-sm font-semibold">
										{profile.name}
									</span>
									<div className="flex shrink-0 gap-1">
										<Badge variant="outline">{sourceLabel(profile)}</Badge>
										{profile.readOnly && (
											<Badge variant="outline">read-only</Badge>
										)}
									</div>
								</div>
								<div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
									{profile.description}
								</div>
							</button>
						))
					)}
				</CardContent>
			</Card>
			<Card>
				<CardHeader className="border-b border-border">
					<div className="flex items-center justify-between gap-3">
						<CardTitle>{selected?.name || "Select a profile"}</CardTitle>
						{selected && (
							<div className="flex gap-2">
								<Button
									variant="secondary"
									className="px-2 py-1 text-xs"
									onClick={() => setDialog({ mode: "copy", profile: selected })}
								>
									Copy
								</Button>
								<Button
									variant="secondary"
									className="px-2 py-1 text-xs"
									disabled={selected.readOnly || !detail}
									onClick={() => setDialog({ mode: "edit", profile: selected })}
								>
									Edit
								</Button>
								<Button
									variant="destructive"
									className="px-2 py-1 text-xs"
									disabled={selected.readOnly}
									onClick={() => deleteProfile(selected)}
								>
									Delete
								</Button>
							</div>
						)}
					</div>
				</CardHeader>
				<CardContent className="space-y-4 pt-4">
					{!selected ? (
						<p className="text-sm text-muted-foreground">
							Select a Root Orchestrator Profile.
						</p>
					) : (
						<>
							<div className="flex flex-wrap gap-2">
								<Badge variant="outline">{sourceLabel(selected)}</Badge>
								{selected.readOnly ? (
									<Badge variant="outline">read-only</Badge>
								) : (
									<Badge variant="success">editable</Badge>
								)}
								<Badge variant="outline">
									skills: {selected.skills?.length || 0}
								</Badge>
								<Badge variant="outline">
									skill templates: {selected.skillTemplates?.length || 0}
								</Badge>
							</div>
							<p className="text-sm text-muted-foreground">
								{selected.description}
							</p>
							<div className="rounded-md border border-border bg-background/60 p-3 text-xs text-muted-foreground">
								<div>
									<span className="font-medium text-foreground">Path:</span>{" "}
									{selected.filePath}
								</div>
								<div>
									<span className="font-medium text-foreground">
										/orchestrate:
									</span>{" "}
									running without an argument auto-activates the only profile,
									but prompts for selection when multiple profiles exist.
								</div>
							</div>
							<div className="grid gap-3 md:grid-cols-2">
								<div>
									<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
										Skills
									</div>
									<div className="flex flex-wrap gap-1">
										{selected.skills?.length ? (
											selected.skills.map((skill) => (
												<Badge key={skill} variant="outline">
													{skill}
												</Badge>
											))
										) : (
											<span className="text-xs text-muted-foreground">
												No direct skills.
											</span>
										)}
									</div>
								</div>
								<div>
									<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
										Skill Templates
									</div>
									<div className="flex flex-wrap gap-1">
										{selected.skillTemplates?.length ? (
											selected.skillTemplates.map((template) => (
												<Badge key={template} variant="outline">
													{template}
												</Badge>
											))
										) : (
											<span className="text-xs text-muted-foreground">
												No skill templates.
											</span>
										)}
									</div>
								</div>
							</div>
							<div>
								<div className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">
									Instructions
								</div>
								<pre className="max-h-[45vh] overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-3 text-sm leading-6">
									{detail?.body ?? selected.instructions ?? "Loading…"}
								</pre>
							</div>
						</>
					)}
				</CardContent>
			</Card>
			<RootProfileEditorDialog
				open={!!dialog}
				mode={dialog?.mode || "new"}
				sourceProfile={dialog?.profile}
				detail={dialog?.mode === "edit" ? detail : undefined}
				onClose={() => setDialog(null)}
				onSaved={() => {
					setDialog(null);
					onChanged();
					pushLog("Saved Root Orchestrator Profile", "success");
				}}
			/>
		</div>
	);
}
