import { useEffect, useMemo, useState } from "react";
import type { RoadmapDependency, RoadmapOverview } from "../../types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import {
	bucketEpicTasks,
	buildRoadmapHierarchy,
	sortIssueViews,
	splitEpicGroups,
	type RoadmapEpicGroup,
	type RoadmapHierarchy,
	type RoadmapIssueView,
	type RoadmapTaskBuckets,
} from "./roadmap-view-model.js";

type EditableRoadmapStatus = "open" | "in_progress" | "closed";

interface RoadmapPanelProps {
	pushLog?: (
		text: string,
		level?: "info" | "success" | "warn" | "error",
	) => void;
}

export function RoadmapPanel({ pushLog }: RoadmapPanelProps) {
	const [overview, setOverview] = useState<RoadmapOverview | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [selectedIssueId, setSelectedIssueId] = useState<string | null>(null);
	const [detailBackIssueId, setDetailBackIssueId] = useState<string | null>(
		null,
	);

	const refresh = async () => {
		setLoading(true);
		setError("");
		try {
			const res = await fetch("/api/roadmap");
			if (!res.ok) throw new Error(await res.text());
			setOverview(await res.json());
		} catch (err: any) {
			const message = err?.message || "Failed to load roadmap";
			setError(message);
			pushLog?.(`Failed to load roadmap: ${message}`, "error");
		} finally {
			setLoading(false);
		}
	};

	const updateIssuePatch = async (
		issueId: string,
		patch: { status?: EditableRoadmapStatus; description?: string },
	) => {
		const res = await fetch(
			`/api/roadmap/issues/${encodeURIComponent(issueId)}`,
			{
				method: "PATCH",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(patch),
			},
		);
		if (!res.ok) throw new Error(await res.text());
		const nextOverview = (await res.json()) as RoadmapOverview;
		setOverview(nextOverview);
	};

	const updateIssueStatus = async (
		issueId: string,
		status: EditableRoadmapStatus,
	) => {
		await updateIssuePatch(issueId, { status });
		pushLog?.(
			`Updated Roadmap issue ${issueId} status to ${formatStatus(status)}`,
			"success",
		);
	};

	const updateIssueDescription = async (
		issueId: string,
		description: string,
	) => {
		await updateIssuePatch(issueId, { description });
		pushLog?.(`Updated Roadmap issue ${issueId} description`, "success");
	};

	useEffect(() => {
		refresh();
	}, []);

	const roadmapIssues = useMemo(
		() => (overview ? flattenHierarchy(buildRoadmapHierarchy(overview)) : []),
		[overview],
	);
	const selectedIssue = useMemo(
		() => roadmapIssues.find((issue) => issue.id === selectedIssueId),
		[roadmapIssues, selectedIssueId],
	);
	const detailBackIssue = useMemo(
		() => roadmapIssues.find((issue) => issue.id === detailBackIssueId),
		[roadmapIssues, detailBackIssueId],
	);
	const selectIssue = (id: string, backIssueId?: string) => {
		setSelectedIssueId(id);
		setDetailBackIssueId(backIssueId || null);
	};
	const closeIssue = () => {
		setSelectedIssueId(null);
		setDetailBackIssueId(null);
	};
	const backToIssue = () => {
		if (!detailBackIssueId) return;
		setSelectedIssueId(detailBackIssueId);
		setDetailBackIssueId(null);
	};

	return (
		<Card className="min-h-[70vh]">
			<CardHeader className="border-b border-border">
				<div className="flex flex-wrap items-start justify-between gap-3">
					<div>
						<CardTitle>Project Roadmap</CardTitle>
						<p className="mt-1 text-sm text-muted-foreground">
							Epic-first view of active project work. Open an issue to update
							its status.
						</p>
					</div>
					<Button
						variant="secondary"
						className="px-2 py-1 text-xs"
						onClick={refresh}
						disabled={loading}
					>
						Refresh
					</Button>
				</div>
			</CardHeader>
			<CardContent className="space-y-4 pt-4">
				{loading && (
					<div className="rounded-md border border-border bg-card/50 p-4 text-sm text-muted-foreground">
						Loading roadmap…
					</div>
				)}
				{!loading && error && (
					<div className="rounded-md border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
						{error}
					</div>
				)}
				{!loading && !error && overview && (
					<RoadmapSummary overview={overview} onSelectIssue={selectIssue} />
				)}
			</CardContent>
			{overview && (
				<IssueDetailDialog
					overview={overview}
					issue={selectedIssue}
					backIssue={detailBackIssue}
					onBack={backToIssue}
					onClose={closeIssue}
					onSelectIssue={selectIssue}
					onUpdateStatus={updateIssueStatus}
					pushLog={pushLog}
					onUpdateDescription={updateIssueDescription}
				/>
			)}
		</Card>
	);
}

// RoadmapPanel stays source-agnostic: it renders and mutates RoadmapOverview through
// /api/roadmap. Provider-specific details belong on the server side so the backing
// store can change without renaming this feature.
function RoadmapSummary({
	overview,
	onSelectIssue,
}: {
	overview: RoadmapOverview;
	onSelectIssue: (id: string) => void;
}) {
	const hierarchy = useMemo(() => buildRoadmapHierarchy(overview), [overview]);
	const focusEpic = useMemo(() => findFocusEpic(hierarchy), [hierarchy]);
	const [expandedEpicIds, setExpandedEpicIds] = useState<Set<string>>(
		new Set(),
	);

	useEffect(() => {
		setExpandedEpicIds(focusEpic ? new Set([focusEpic.epic.id]) : new Set());
	}, [focusEpic?.epic.id]);

	const toggleEpic = (id: string) => {
		setExpandedEpicIds((prev) => {
			const next = new Set(prev);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return next;
		});
	};

	return (
		<div className="space-y-4">
			<div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
				<Badge variant="outline">{overview.counts.total} total</Badge>
				<Badge variant="default">
					{overview.counts.inProgress} in progress
				</Badge>
				<Badge variant="success">{overview.counts.nextUp} ready</Badge>
				<Badge variant="destructive">{overview.counts.blocked} blocked</Badge>
				<Badge variant="outline">{overview.counts.closed} closed</Badge>
				<span className="truncate">
					Source: {overview.source.exists ? "loaded" : "missing"} ·{" "}
					{overview.source.path}
				</span>
			</div>
			{focusEpic && (
				<FocusEpic
					group={focusEpic}
					onSelectIssue={onSelectIssue}
					onExpand={() => setExpandedEpicIds(new Set([focusEpic.epic.id]))}
				/>
			)}
			<RoadmapHierarchyView
				hierarchy={hierarchy}
				expandedEpicIds={expandedEpicIds}
				onToggleEpic={toggleEpic}
				onSelectIssue={onSelectIssue}
			/>
		</div>
	);
}

function FocusEpic({
	group,
	onSelectIssue,
	onExpand,
}: {
	group: RoadmapEpicGroup;
	onSelectIssue: (id: string) => void;
	onExpand: () => void;
}) {
	const activeCount = group.activeChildren.length;
	return (
		<div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="min-w-0">
					<div className="text-xs font-semibold uppercase tracking-wide text-primary">
						Focus epic
					</div>
					<button
						type="button"
						className="mt-1 text-left text-base font-semibold hover:text-primary"
						onClick={() => onSelectIssue(group.epic.id)}
					>
						{group.epic.title}
					</button>
					<div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
						<Badge variant={statusBadgeVariant(group.epic.status)}>
							{formatStatus(group.epic.status)}
						</Badge>
						<Badge variant="outline">{activeCount} active children</Badge>
						<Badge variant="outline">
							updated {formatDate(group.epic.updatedAt) || "unknown"}
						</Badge>
					</div>
				</div>
				<Button
					variant="secondary"
					className="px-2 py-1 text-xs"
					onClick={onExpand}
				>
					Follow epic
				</Button>
			</div>
		</div>
	);
}

function RoadmapHierarchyView({
	hierarchy,
	expandedEpicIds,
	onToggleEpic,
	onSelectIssue,
}: {
	hierarchy: RoadmapHierarchy;
	expandedEpicIds: Set<string>;
	onToggleEpic: (id: string) => void;
	onSelectIssue: (id: string) => void;
}) {
	const { active, closed } = splitEpicGroups(hierarchy);
	return (
		<div className="space-y-3 rounded-md border border-border p-4">
			<div className="flex flex-wrap items-center justify-between gap-2">
				<div>
					<h3 className="text-sm font-semibold">Epic Roadmap</h3>
					<p className="mt-1 text-xs text-muted-foreground">
						Focus epic opens automatically; other active epics stay collapsed
						until needed.
					</p>
				</div>
				<div className="flex flex-wrap gap-1">
					<Badge variant="outline">{active.length} active epics</Badge>
					<Badge variant="outline">{closed.length} closed</Badge>
				</div>
			</div>
			{active.length ? (
				<div className="space-y-2">
					{active.map((group) => (
						<EpicRow
							key={group.epic.id}
							group={group}
							expanded={expandedEpicIds.has(group.epic.id)}
							onToggleEpic={onToggleEpic}
							onSelectIssue={onSelectIssue}
						/>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No active epics found in the roadmap source.
				</p>
			)}
			{!!closed.length && (
				<details className="border-t border-border pt-3">
					<summary className="cursor-pointer text-sm font-semibold">
						Closed epics <Badge variant="outline">{closed.length}</Badge>
					</summary>
					<div className="mt-2 space-y-2 opacity-75">
						{closed.map((group) => (
							<EpicRow
								key={group.epic.id}
								group={group}
								expanded={expandedEpicIds.has(group.epic.id)}
								onToggleEpic={onToggleEpic}
								onSelectIssue={onSelectIssue}
							/>
						))}
					</div>
				</details>
			)}
			<UngroupedIssues
				issues={hierarchy.ungrouped}
				onSelectIssue={onSelectIssue}
			/>
		</div>
	);
}

function EpicRow({
	group,
	expanded,
	onToggleEpic,
	onSelectIssue,
}: {
	group: RoadmapEpicGroup;
	expanded: boolean;
	onToggleEpic: (id: string) => void;
	onSelectIssue: (id: string) => void;
}) {
	const blockedCount = group.activeChildren.filter(
		(issue) => issue.unresolvedBlockers.length,
	).length;
	return (
		<div className="rounded-lg border border-border bg-background/40">
			<div className="flex flex-wrap items-center gap-3 p-3">
				<Button
					variant="secondary"
					className="px-2 py-1 text-xs"
					onClick={() => onToggleEpic(group.epic.id)}
				>
					{expanded ? "Collapse" : "Expand"}
				</Button>
				<button
					type="button"
					className="min-w-0 flex-1 text-left"
					onClick={() => onSelectIssue(group.epic.id)}
				>
					<div className="truncate text-sm font-semibold hover:text-primary">
						{group.epic.title}
					</div>
					<div className="mt-1 flex flex-wrap gap-2 text-xs text-muted-foreground">
						<span>{group.epic.id}</span>
						<Badge variant={statusBadgeVariant(group.epic.status)}>
							{formatStatus(group.epic.status)}
						</Badge>
						<Badge variant="outline">
							{group.activeChildren.length} active
						</Badge>
						<Badge variant="outline">
							{group.closedChildren.length} closed
						</Badge>
						{!!blockedCount && (
							<Badge variant="destructive">{blockedCount} blocked</Badge>
						)}
					</div>
				</button>
			</div>
			{expanded && (
				<div className="space-y-2 border-t border-border p-3">
					{group.activeChildren.length ? (
						group.activeChildren.map((issue) => (
							<IssueCard
								key={issue.id}
								issue={issue}
								onSelectIssue={onSelectIssue}
							/>
						))
					) : (
						<p className="text-xs text-muted-foreground">
							No active child issues.
						</p>
					)}
					{!!group.closedChildren.length && (
						<div className="space-y-2 opacity-70">
							{group.closedChildren.map((issue) => (
								<IssueCard
									key={issue.id}
									issue={issue}
									compact
									onSelectIssue={onSelectIssue}
								/>
							))}
						</div>
					)}
				</div>
			)}
		</div>
	);
}

function UngroupedIssues({
	issues,
	onSelectIssue,
}: {
	issues: RoadmapIssueView[];
	onSelectIssue: (id: string) => void;
}) {
	const active = sortIssueViews(
		issues.filter((issue) => issue.status !== "closed"),
	);
	const closed = sortIssueViews(
		issues.filter((issue) => issue.status === "closed"),
	);
	const total = active.length + closed.length;
	return (
		<details
			className="border-t border-border pt-3"
			open={total > 0 && active.length <= 3}
		>
			<summary className="cursor-pointer text-sm font-semibold">
				Ungrouped <Badge variant="outline">{total}</Badge>
			</summary>
			<div className="mt-2 space-y-2">
				{active.length ? (
					<div className="grid gap-2 md:grid-cols-2">
						{active.map((issue) => (
							<IssueCard
								key={issue.id}
								issue={issue}
								onSelectIssue={onSelectIssue}
							/>
						))}
					</div>
				) : (
					<p className="text-sm text-muted-foreground">
						No ungrouped active issues.
					</p>
				)}
				{!!closed.length && (
					<div className="grid gap-2 opacity-70 md:grid-cols-2">
						{closed.map((issue) => (
							<IssueCard
								key={issue.id}
								issue={issue}
								compact
								onSelectIssue={onSelectIssue}
							/>
						))}
					</div>
				)}
			</div>
		</details>
	);
}

function IssueCard({
	issue,
	compact,
	onSelectIssue,
}: {
	issue: RoadmapIssueView;
	compact?: boolean;
	onSelectIssue: (id: string) => void;
}) {
	const blockerText = issue.unresolvedBlockers.map(formatDependency).join(", ");
	return (
		<button
			type="button"
			className={`block w-full rounded border border-border/70 bg-card/40 text-left transition hover:border-primary/60 ${compact ? "p-2" : "p-3"} ${issue.status === "closed" ? "opacity-70" : ""}`}
			onClick={() => onSelectIssue(issue.id)}
		>
			<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
				<span>{issue.id}</span>
				<Badge variant={statusBadgeVariant(issue.status)}>
					{formatStatus(issue.status)}
				</Badge>
				<Badge variant="outline">P{issue.priority}</Badge>
				{!!issue.dependentCount && (
					<Badge variant="default">blocks {issue.dependentCount}</Badge>
				)}
			</div>
			<div
				className={`${compact ? "mt-1 text-sm" : "mt-2 text-sm"} font-medium`}
			>
				{issue.title}
			</div>
			{!!issue.unresolvedBlockers.length && (
				<div className="mt-2 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
					Blocked by {blockerText}
				</div>
			)}
		</button>
	);
}

function IssueDetailDialog({
	overview,
	issue,
	backIssue,
	onBack,
	onClose,
	onSelectIssue,
	onUpdateStatus,
	onUpdateDescription,
	pushLog,
}: {
	overview: RoadmapOverview;
	issue?: RoadmapIssueView;
	backIssue?: RoadmapIssueView;
	onBack: () => void;
	onClose: () => void;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	onUpdateStatus: (id: string, status: EditableRoadmapStatus) => Promise<void>;
	onUpdateDescription: (id: string, description: string) => Promise<void>;
	pushLog?: (
		text: string,
		level?: "info" | "success" | "warn" | "error",
	) => void;
}) {
	const [draftStatus, setDraftStatus] = useState<EditableRoadmapStatus>("open");
	const [statusSaving, setStatusSaving] = useState(false);
	const [statusError, setStatusError] = useState("");
	const [statusMessage, setStatusMessage] = useState("");
	const [descriptionEditing, setDescriptionEditing] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	const [descriptionSaving, setDescriptionSaving] = useState(false);
	const [descriptionError, setDescriptionError] = useState("");
	const [descriptionMessage, setDescriptionMessage] = useState("");
	const blockers = issue ? overview.dependencyMap.blockers[issue.id] || [] : [];
	const dependents = issue
		? overview.dependencyMap.dependents[issue.id] || []
		: [];
	const epicGroup = useMemo(() => {
		if (!issue || issue.type !== "epic") return undefined;
		return buildRoadmapHierarchy(overview).epics.find(
			(group) => group.epic.id === issue.id,
		);
	}, [overview, issue?.id, issue?.type]);
	const epicBuckets = epicGroup
		? bucketEpicTasks(epicGroup, overview)
		: undefined;
	const isEpic = issue?.type === "epic";
	const returnEpicId = backIssue?.id || (isEpic ? issue?.id : undefined);

	useEffect(() => {
		if (!issue) return;
		setDraftStatus(toEditableStatus(issue.status));
	}, [issue?.id, issue?.status]);

	useEffect(() => {
		if (!issue) return;
		setDraftDescription(issue.description || "");
		setDescriptionEditing(false);
	}, [issue?.id, issue?.description]);

	useEffect(() => {
		setStatusError("");
		setStatusMessage("");
		setDescriptionError("");
		setDescriptionMessage("");
	}, [issue?.id]);

	const descriptionDirty =
		!!issue && draftDescription !== (issue.description || "");

	const saveStatus = async () => {
		if (!issue || draftStatus === issue.status) return;
		setStatusSaving(true);
		setStatusError("");
		setStatusMessage("");
		try {
			await onUpdateStatus(issue.id, draftStatus);
			setStatusMessage(`Status updated to ${formatStatus(draftStatus)}`);
		} catch (err: any) {
			const message = err?.message || "Failed to update status";
			setDraftStatus(toEditableStatus(issue.status));
			setStatusError(`Failed to update status: ${message}`);
			pushLog?.(
				`Failed to update Roadmap issue ${issue.id}: ${message}`,
				"error",
			);
		} finally {
			setStatusSaving(false);
		}
	};

	const startDescriptionEdit = () => {
		if (!issue) return;
		setDraftDescription(issue.description || "");
		setDescriptionEditing(true);
		setDescriptionError("");
		setDescriptionMessage("");
	};

	const cancelDescriptionEdit = () => {
		setDraftDescription(issue?.description || "");
		setDescriptionEditing(false);
		setDescriptionError("");
	};

	const saveDescription = async () => {
		if (!issue) return;
		setDescriptionSaving(true);
		setDescriptionError("");
		setDescriptionMessage("");
		try {
			await onUpdateDescription(issue.id, draftDescription);
			setDescriptionEditing(false);
			setDescriptionMessage("Description updated");
		} catch (err: any) {
			const message = err?.message || "Failed to update description";
			setDescriptionError(`Failed to update description: ${message}`);
			pushLog?.(
				`Failed to update Roadmap issue ${issue.id} description: ${message}`,
				"error",
			);
		} finally {
			setDescriptionSaving(false);
		}
	};

	return (
		<Dialog
			open={!!issue}
			title={issue ? detailTitle(issue.type) : "Issue Details"}
			onOpenChange={onClose}
			className={isEpic ? "max-w-6xl" : "max-w-4xl"}
			confirmOnClose={descriptionDirty}
			confirmCloseMessage="Discard unsaved description changes?"
		>
			{issue && (
				<div className="space-y-4">
					<div>
						{backIssue && (
							<button
								type="button"
								aria-label="Back to epic"
								title="Back to epic"
								className="mb-3 text-2xl leading-none text-muted-foreground transition hover:text-primary"
								onClick={onBack}
							>
								←
							</button>
						)}
						<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
							<span>{issue.id}</span>
							<Badge variant={statusBadgeVariant(issue.status)}>
								{formatStatus(issue.status)}
							</Badge>
							<Badge variant="outline">P{issue.priority}</Badge>
							<Badge variant="outline">{issue.type}</Badge>
						</div>
						<h3 className="mt-2 text-xl font-semibold">{issue.title}</h3>
					</div>
					<div className="rounded border border-border bg-card/40 p-3">
						<div className="flex flex-wrap items-end gap-2">
							<label className="text-sm font-semibold">
								Status
								<select
									aria-label="Issue status"
									className="mt-1 block rounded border border-border bg-background px-2 py-1 text-sm font-normal"
									value={draftStatus}
									disabled={statusSaving}
									onChange={(event) => {
										setDraftStatus(event.target.value as EditableRoadmapStatus);
										setStatusError("");
										setStatusMessage("");
									}}
								>
									<option value="open">Open</option>
									<option value="in_progress">In progress</option>
									<option value="closed">Closed</option>
								</select>
							</label>
							<Button
								type="button"
								variant="secondary"
								className="px-2 py-1 text-xs"
								disabled={statusSaving || draftStatus === issue.status}
								onClick={saveStatus}
							>
								{statusSaving ? "Saving…" : "Save status"}
							</Button>
						</div>
						{statusMessage && (
							<p className="mt-2 text-sm text-primary">{statusMessage}</p>
						)}
						{statusError && (
							<p className="mt-2 text-sm text-destructive">{statusError}</p>
						)}
					</div>
					<div
						className={
							isEpic
								? "grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]"
								: "space-y-4"
						}
					>
						<div className="space-y-4">
							<div className="grid gap-3 md:grid-cols-2">
								<Meta label="Created" value={formatDate(issue.createdAt)} />
								<Meta label="Updated" value={formatDate(issue.updatedAt)} />
								{issue.closedAt && (
									<Meta label="Closed" value={formatDate(issue.closedAt)} />
								)}
								{issue.closeReason && (
									<Meta label="Close reason" value={issue.closeReason} />
								)}
							</div>
							{!!issue.labels.length && (
								<div>
									<h4 className="mb-2 text-sm font-semibold">Labels</h4>
									<div className="flex flex-wrap gap-1">
										{issue.labels.map((label) => (
											<Badge key={label} variant="outline">
												{label}
											</Badge>
										))}
									</div>
								</div>
							)}
							<div>
								<div className="mb-2 flex flex-wrap items-center justify-between gap-2">
									<h4 className="text-sm font-semibold">Description</h4>
									{descriptionEditing ? (
										<div className="flex flex-wrap gap-2">
											<Button
												type="button"
												variant="secondary"
												className="px-2 py-1 text-xs"
												disabled={descriptionSaving || !descriptionDirty}
												onClick={saveDescription}
											>
												{descriptionSaving ? "Saving…" : "Save description"}
											</Button>
											<Button
												type="button"
												variant="ghost"
												className="px-2 py-1 text-xs"
												disabled={descriptionSaving}
												onClick={cancelDescriptionEdit}
											>
												Cancel
											</Button>
										</div>
									) : (
										<Button
											type="button"
											variant="secondary"
											className="px-2 py-1 text-xs"
											onClick={startDescriptionEdit}
										>
											Edit description
										</Button>
									)}
								</div>
								{descriptionEditing ? (
									<textarea
										aria-label="Issue description"
										className="min-h-48 w-full rounded border border-border bg-background/50 p-3 text-sm text-muted-foreground"
										value={draftDescription}
										disabled={descriptionSaving}
										onInput={(event) => {
											setDraftDescription(event.currentTarget.value);
											setDescriptionError("");
											setDescriptionMessage("");
										}}
									/>
								) : (
									<div className="max-h-80 overflow-auto whitespace-pre-wrap rounded border border-border bg-background/50 p-3 text-sm text-muted-foreground">
										{issue.description || "No description."}
									</div>
								)}
								{descriptionMessage && (
									<p className="mt-2 text-sm text-primary">
										{descriptionMessage}
									</p>
								)}
								{descriptionError && (
									<p className="mt-2 text-sm text-destructive">
										{descriptionError}
									</p>
								)}
							</div>
							<DependencyList
								title="Blockers"
								dependencies={blockers}
								backIssueId={returnEpicId}
								onSelectIssue={onSelectIssue}
								onClose={onClose}
							/>
							<DependencyList
								title="Dependents"
								dependencies={dependents}
								backIssueId={returnEpicId}
								onSelectIssue={onSelectIssue}
								onClose={onClose}
							/>
						</div>
						{isEpic && epicBuckets && (
							<EpicTasksPanel
								buckets={epicBuckets}
								epicId={issue.id}
								onSelectIssue={onSelectIssue}
							/>
						)}
					</div>
				</div>
			)}
		</Dialog>
	);
}

function EpicTasksPanel({
	buckets,
	epicId,
	onSelectIssue,
}: {
	buckets: RoadmapTaskBuckets;
	epicId: string;
	onSelectIssue: (id: string, backIssueId?: string) => void;
}) {
	const total = Object.values(buckets).reduce(
		(sum, issues) => sum + issues.length,
		0,
	);
	const active = total - buckets.closed.length;
	return (
		<div className="rounded-lg border border-border bg-card/30 p-3">
			<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
				<div>
					<h4 className="text-sm font-semibold">Tasks in this epic</h4>
					<p className="mt-1 text-xs text-muted-foreground">
						Grouped by what is actionable next. Select a task to inspect
						details.
					</p>
				</div>
				<div className="flex flex-wrap gap-1">
					<Badge variant="outline">{active} active</Badge>
					<Badge variant="outline">{buckets.closed.length} closed</Badge>
				</div>
			</div>
			{total ? (
				<div className="max-h-[34rem] space-y-3 overflow-auto pr-1">
					<TaskBucketSection
						title="In progress"
						issues={buckets.inProgress}
						onSelectIssue={(id) => onSelectIssue(id, epicId)}
					/>
					<TaskBucketSection
						title="Ready"
						issues={buckets.ready}
						onSelectIssue={(id) => onSelectIssue(id, epicId)}
					/>
					<TaskBucketSection
						title="Blocked"
						issues={buckets.blocked}
						onSelectIssue={(id) => onSelectIssue(id, epicId)}
					/>
					<TaskBucketSection
						title="Backlog"
						issues={buckets.backlog}
						onSelectIssue={(id) => onSelectIssue(id, epicId)}
					/>
					{!!buckets.closed.length && (
						<TaskBucketSection
							title="Closed"
							issues={buckets.closed}
							onSelectIssue={(id) => onSelectIssue(id, epicId)}
							muted
						/>
					)}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">
					No tasks are currently associated with this epic.
				</p>
			)}
		</div>
	);
}

function TaskBucketSection({
	title,
	issues,
	muted,
	onSelectIssue,
}: {
	title: string;
	issues: RoadmapIssueView[];
	muted?: boolean;
	onSelectIssue: (id: string) => void;
}) {
	return (
		<section className={muted ? "opacity-70" : undefined}>
			<div className="mb-2 flex items-center gap-2">
				<h5 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
					{title}
				</h5>
				<Badge variant="outline">{issues.length}</Badge>
			</div>
			{issues.length ? (
				<div className="space-y-2">
					{issues.map((issue) => (
						<IssueCard
							key={issue.id}
							issue={issue}
							compact
							onSelectIssue={onSelectIssue}
						/>
					))}
				</div>
			) : (
				<p className="rounded border border-border/60 bg-background/30 p-2 text-xs text-muted-foreground">
					No {title.toLowerCase()} tasks.
				</p>
			)}
		</section>
	);
}

function DependencyList({
	title,
	dependencies,
	backIssueId,
	onSelectIssue,
	onClose,
}: {
	title: string;
	dependencies: RoadmapDependency[];
	backIssueId?: string;
	onSelectIssue: (id: string, backIssueId?: string) => void;
	onClose: () => void;
}) {
	return (
		<div>
			<h4 className="mb-2 text-sm font-semibold">{title}</h4>
			{dependencies.length ? (
				<div className="space-y-2">
					{dependencies.map((dependency) => (
						<button
							key={dependency.id}
							type="button"
							className="block w-full rounded border border-border bg-card/40 p-2 text-left text-sm hover:border-primary/60"
							onClick={() => {
								onSelectIssue(dependency.id, backIssueId);
								if (dependency.status === "unknown") onClose();
							}}
						>
							<div className="flex flex-wrap items-center gap-2">
								<span>{dependency.title || dependency.id}</span>
								<Badge variant={statusBadgeVariant(dependency.status)}>
									{formatStatus(dependency.status)}
								</Badge>
								{dependency.priority !== undefined && (
									<Badge variant="outline">P{dependency.priority}</Badge>
								)}
							</div>
							<div className="mt-1 text-xs text-muted-foreground">
								{dependency.id}
							</div>
						</button>
					))}
				</div>
			) : (
				<p className="text-sm text-muted-foreground">None.</p>
			)}
		</div>
	);
}

function Meta({ label, value }: { label: string; value?: string }) {
	if (!value) return null;
	return (
		<div className="rounded border border-border bg-card/40 p-2">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="mt-1 text-sm">{value}</div>
		</div>
	);
}

function findFocusEpic(
	hierarchy: RoadmapHierarchy,
): RoadmapEpicGroup | undefined {
	const activeGroups = hierarchy.epics.filter(
		(group) => group.epic.status !== "closed",
	);
	const candidates = activeGroups.length ? activeGroups : hierarchy.epics;
	return (
		candidates.find((group) => group.epic.status === "in_progress") ||
		[...candidates].sort((a, b) =>
			(b.epic.updatedAt ?? "").localeCompare(a.epic.updatedAt ?? ""),
		)[0]
	);
}

function flattenHierarchy(hierarchy: RoadmapHierarchy): RoadmapIssueView[] {
	return [
		...hierarchy.epics.flatMap((group) => [
			group.epic,
			...group.activeChildren,
			...group.closedChildren,
		]),
		...hierarchy.ungrouped,
	];
}

function detailTitle(type: string): string {
	if (type === "epic") return "Epic Details";
	return "Issue Details";
}

function formatDependency(dependency: RoadmapDependency): string {
	return `${dependency.title || dependency.id} (${dependency.status})`;
}

function formatStatus(status: string): string {
	return status.replace(/_/g, " ");
}

function toEditableStatus(status: string): EditableRoadmapStatus {
	if (status === "in_progress" || status === "closed") return status;
	return "open";
}

function formatDate(value?: string): string | undefined {
	return value ? new Date(value).toLocaleString() : undefined;
}

function statusBadgeVariant(
	status: string,
): "default" | "success" | "warning" | "destructive" | "outline" {
	if (status === "in_progress") return "default";
	if (status === "closed") return "outline";
	if (status === "unknown") return "destructive";
	return "warning";
}
