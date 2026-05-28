import type { StatsEntry } from "../../shared/dashboard-types.js";
import { Button } from "../../components/ui/button.js";

function formatCompactNumber(n: number | undefined): string {
	if (typeof n !== "number" || !Number.isFinite(n)) return "—";
	if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
	if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
	return String(n);
}

function formatList(value: unknown): string {
	return Array.isArray(value) && value.length ? value.join(", ") : "—";
}

function formatCurrency(value: unknown): string {
	return typeof value === "number" && Number.isFinite(value)
		? `$${value.toFixed(4)}`
		: "—";
}

function formatDuration(ms: unknown): string {
	if (typeof ms !== "number" || !Number.isFinite(ms)) return "—";
	if (ms < 1000) return `${ms}ms`;
	const seconds = Math.round(ms / 1000);
	if (seconds < 60) return `${seconds}s`;
	return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function readContextAndCost(stats?: StatsEntry) {
	if (!stats || stats.error) {
		return {
			pct: undefined,
			used: undefined,
			max: undefined,
			input: undefined,
			output: undefined,
			total: undefined,
			cost: undefined,
			error: stats?.error,
		};
	}
	const s = stats.stats || {};
	const state = stats.state || {};
	const context = s.contextUsage || {};
	const tokens = s.tokens || {};
	const used = context.tokens ?? context.current ?? tokens.total;
	const max =
		context.contextWindow ?? context.max ?? state.model?.contextWindow;
	const pct = used && max ? Math.round((used / max) * 100) : undefined;
	return {
		pct,
		used,
		max,
		input: tokens.input ?? tokens.prompt ?? s.inputTokens,
		output: tokens.output ?? tokens.completion ?? s.outputTokens,
		total: tokens.total ?? used,
		cost: s.cost,
		error: undefined,
	};
}

export function InspectTimeline({
	timeline,
	stats,
}: {
	timeline: any;
	stats?: StatsEntry;
}) {
	const metadata = timeline.metadata || {};
	const definition = timeline.definition;
	const entries = Array.isArray(timeline.entries) ? timeline.entries : [];
	const diagnostics = metadata.turnDiagnostics;
	const usage = readContextAndCost(stats);
	const agentName = String(metadata.name || "");
	const copyText = async (text: string) => {
		await navigator.clipboard?.writeText(text);
	};
	const copyDiagnostics = () =>
		copyText(
			JSON.stringify(
				{
					metadata,
					diagnostics,
					stderrTail: timeline.stderrTail,
					entries,
				},
				null,
				2,
			),
		).catch(() => {});
	const sendPrompt = (kind: "send" | "steer") => {
		const message = globalThis.prompt?.(
			kind === "send" ? "Message agent" : "Steer agent",
		);
		if (!message || !agentName) return;
		fetch(`/api/agents/${encodeURIComponent(agentName)}/${kind}`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ message }),
		}).catch(() => {});
	};
	const killAgent = () => {
		if (!agentName) return;
		fetch(`/api/agents/${encodeURIComponent(agentName)}/kill`, {
			method: "POST",
		}).catch(() => {});
	};
	return (
		<div className="max-h-[72vh] space-y-4 overflow-auto pr-1 text-sm">
			<section className="grid gap-3 md:grid-cols-2">
				<InspectSection title="Agent">
					<InspectField label="status" value={metadata.status} />
					<InspectField label="model" value={metadata.model || "default"} />
					<InspectField label="worktree" value={metadata.worktree} />
					<InspectField label="parent" value={metadata.parent || "root"} />
					<InspectField
						label="children"
						value={formatList(metadata.children)}
					/>
					<InspectField label="turns" value={String(metadata.turns ?? 0)} />
				</InspectSection>
				<InspectSection title="Context & cost">
					<InspectField
						label="context"
						value={
							usage.used && usage.max
								? `${usage.pct}% (${formatCompactNumber(usage.used)} / ${formatCompactNumber(usage.max)})`
								: "—"
						}
					/>
					<InspectField
						label="input tokens"
						value={formatCompactNumber(usage.input)}
					/>
					<InspectField
						label="output tokens"
						value={formatCompactNumber(usage.output)}
					/>
					<InspectField
						label="total tokens"
						value={formatCompactNumber(usage.total)}
					/>
					<InspectField label="cost" value={formatCurrency(usage.cost)} />
					{usage.error && (
						<InspectField label="stats error" value={usage.error} />
					)}
				</InspectSection>
			</section>
			<InspectSection title="Pi session">
				<InspectField
					label="id"
					value={metadata.nativeSession?.sessionId || "—"}
				/>
				<InspectField
					label="file"
					value={metadata.nativeSession?.sessionFile || "—"}
				/>
				<InspectField
					label="name"
					value={metadata.nativeSession?.sessionName || "—"}
				/>
			</InspectSection>
			<InspectSection title="Handoff">
				<InspectField label="issue" value={metadata.issueId || "—"} />
				<InspectField label="artifacts" value={metadata.artifactPath || "—"} />
				<InspectField
					label="files"
					value={formatList(
						Object.values(metadata.artifactFiles || {}).filter(Boolean),
					)}
				/>
				<InspectField
					label="pending"
					value={
						metadata.pendingSend
							? `${metadata.pendingSend.status}: ${metadata.pendingSend.message}`
							: "—"
					}
				/>
			</InspectSection>
			{diagnostics && (
				<InspectSection title="Turn diagnostics">
					<div
						className={`mb-3 rounded-md border p-3 ${diagnostics.stuck ? "border-amber-400/60 bg-amber-400/10 text-amber-100" : "border-border bg-background text-muted-foreground"}`}
					>
						<div className="font-semibold">
							{diagnostics.stuck
								? "Stuck turn detected"
								: "Pending turn monitored"}
						</div>
						<div className="mt-1 text-xs">
							pending: {diagnostics.pendingStatus || "unknown"} · elapsed:{" "}
							{formatDuration(diagnostics.elapsedMs)} · threshold:{" "}
							{formatDuration(diagnostics.thresholdMs)}
						</div>
					</div>
					<InspectField
						label="reasons"
						value={formatList(diagnostics.reasons)}
					/>
					<InspectField
						label="likely causes"
						value={formatList(diagnostics.likelyCauses)}
					/>
					<InspectField
						label="actions"
						value={formatList(diagnostics.actions)}
					/>
					<div className="mt-3 flex flex-wrap gap-2">
						<Button variant="secondary" onClick={copyDiagnostics}>
							Copy Diagnostics
						</Button>
						<Button
							variant="secondary"
							onClick={() => copyText(String(metadata.worktree || ""))}
						>
							Copy Worktree Path
						</Button>
						<Button variant="secondary" onClick={() => sendPrompt("send")}>
							Retry / Send
						</Button>
						<Button variant="secondary" onClick={() => sendPrompt("steer")}>
							Steer
						</Button>
						<Button variant="destructive" onClick={killAgent}>
							Kill
						</Button>
					</div>
				</InspectSection>
			)}
			{definition && (
				<InspectSection title="Definition / spawn config">
					<div className="grid gap-2 md:grid-cols-2">
						<InspectField label="name" value={definition.name} />
						<InspectField label="class" value={definition.agentClass || "—"} />
						<InspectField label="source" value={definition.source} />
						<InspectField label="file" value={definition.filePath} />
						<InspectField
							label="thinking"
							value={definition.thinking || "default"}
						/>
						<InspectField
							label="tools"
							value={definition.noTools ? "none" : formatList(definition.tools)}
						/>
						<InspectField
							label="skills"
							value={
								definition.noSkills ? "none" : formatList(definition.skills)
							}
						/>
						<InspectField
							label="skill templates"
							value={formatList(definition.skillTemplates)}
						/>
						<InspectField
							label="extension templates"
							value={formatList(definition.extensionTemplates)}
						/>
						<InspectField
							label="extensions"
							value={definition.noExtensions ? "none" : "enabled"}
						/>
					</div>
					<details className="mt-3 rounded-md border border-border bg-background p-2">
						<summary className="cursor-pointer font-medium">
							System prompt preview ({definition.systemPromptLength || 0} chars
							{definition.systemPromptTruncated ? ", truncated" : ""})
						</summary>
						<pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
							{definition.systemPromptPreview || "(empty)"}
						</pre>
					</details>
				</InspectSection>
			)}
			<InspectSection title="Runtime tools">
				<InspectField
					label="reported"
					value={
						timeline.runtimeTools?.reportedAt
							? new Date(timeline.runtimeTools.reportedAt).toLocaleString()
							: "unknown"
					}
				/>
				<InspectField
					label="active"
					value={formatList(
						(timeline.runtimeTools?.active || []).map((tool: any) => tool.name),
					)}
				/>
				<InspectField
					label="all"
					value={formatList(
						(timeline.runtimeTools?.all || []).map((tool: any) => tool.name),
					)}
				/>
			</InspectSection>
			{timeline.stderrTail && (
				<InspectSection title="stderr tail">
					<pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 text-xs text-destructive">
						{timeline.stderrTail}
					</pre>
				</InspectSection>
			)}
			<InspectSection title={`Timeline (${entries.length})`}>
				<div className="space-y-2">
					{entries.length ? (
						entries.map((entry: any, index: number) => (
							<div
								key={`${entry.ts}-${index}`}
								className="rounded-md border border-border bg-background p-2"
							>
								<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
									<span>{new Date(entry.ts).toLocaleTimeString()}</span>
									<span className="rounded bg-muted px-2 py-0.5 font-mono text-foreground">
										{entry.type}
									</span>
									<span>{entry.label}</span>
									{entry.toolName && <span>tool: {entry.toolName}</span>}
									{entry.signal && <span>signal: {entry.signal}</span>}
								</div>
								{entry.text && (
									<pre className="mt-2 whitespace-pre-wrap break-words text-sm">
										{entry.text}
									</pre>
								)}
								{entry.error && (
									<div className="mt-2 text-destructive">{entry.error}</div>
								)}
								{entry.argsPreview && (
									<pre className="mt-2 whitespace-pre-wrap break-words text-xs text-muted-foreground">
										{entry.argsPreview}
									</pre>
								)}
							</div>
						))
					) : (
						<div className="text-muted-foreground">No events recorded.</div>
					)}
				</div>
			</InspectSection>
		</div>
	);
}

function InspectSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<section className="rounded-md border border-border bg-card/50 p-3">
			<h3 className="mb-2 font-semibold">{title}</h3>
			{children}
		</section>
	);
}

function InspectField({ label, value }: { label: string; value: unknown }) {
	return (
		<div className="grid gap-1 py-1 md:grid-cols-[8rem_1fr]">
			<div className="text-xs uppercase tracking-wide text-muted-foreground">
				{label}
			</div>
			<div className="break-words font-mono text-xs">
				{String(value || "—")}
			</div>
		</div>
	);
}
