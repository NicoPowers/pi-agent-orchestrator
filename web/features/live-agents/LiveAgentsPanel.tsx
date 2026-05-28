import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentInfo, AgentTypeInfo } from "../../types.js";
import type {
	AgentState,
	LogLine,
	StatsEntry,
} from "../../shared/dashboard-types.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "../../components/ui/card.js";
import { Input } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

function shortPath(p?: string): string {
	if (!p) return "";
	return p.length > 42 ? "…" + p.slice(-39) : p;
}

function shortSessionId(id?: string): string {
	if (!id) return "";
	return id.length > 36 ? `${id.slice(0, 16)}…${id.slice(-16)}` : id;
}

function statusVariant(
	status: AgentInfo["status"],
): "default" | "success" | "destructive" | "outline" {
	if (status === "idle") return "success";
	if (status === "error" || status === "exited") return "destructive";
	if (status === "streaming") return "default";
	return "outline";
}

function spawnNameFor(typeName?: string): string {
	const base =
		(typeName || "agent")
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, "-")
			.replace(/^-+|-+$/g, "") || "agent";
	return `${base}-${Date.now().toString(36).slice(-5)}`;
}

function previewMarkdown(agent: AgentState): string {
	if (agent.text) return agent.text;
	if (agent.pendingSend) {
		return [
			`**You:** ${agent.pendingSend.message}`,
			"",
			"_waiting for response…_",
		].join("\n");
	}
	return "";
}

const LIVE_AGENT_CARD_CLASS = "min-h-[36rem]";

function isAgentSettingUp(agent: AgentState): boolean {
	return (
		!!agent.setupPending &&
		!agent.runtimeTools &&
		agent.status !== "error" &&
		agent.status !== "exited"
	);
}

function SkeletonLine({ className = "" }: { className?: string }) {
	return <div className={`animate-pulse rounded bg-muted/70 ${className}`} />;
}

function AgentSetupSkeleton({ name }: { name: string }) {
	return (
		<div className="space-y-4" aria-label={`${name} setup in progress`}>
			<div className="space-y-2">
				<div className="flex flex-wrap gap-2">
					<SkeletonLine className="h-4 w-28" />
					<SkeletonLine className="h-4 w-36" />
					<SkeletonLine className="h-4 w-24" />
				</div>
				<SkeletonLine className="h-4 w-48" />
			</div>
			<div className="rounded-md bg-background p-3">
				<SkeletonLine className="mb-3 h-4 w-40" />
				<SkeletonLine className="mb-2 h-3 w-full" />
				<SkeletonLine className="mb-2 h-3 w-5/6" />
				<SkeletonLine className="h-3 w-2/3" />
			</div>
			<div className="flex gap-2">
				<SkeletonLine className="h-9 flex-1" />
				<SkeletonLine className="h-9 w-16" />
				<SkeletonLine className="h-9 w-20" />
				<SkeletonLine className="h-9 w-14" />
			</div>
		</div>
	);
}

export function AgentsPanel({
	agents,
	stats: _stats,
	agentTypes = [],
	loadingAgents = false,
	onInspect,
	onAgentKilled,
	onAgentSpawned,
	onAgentSpawnFailed,
	pushLog,
}: {
	agents: Record<string, AgentState>;
	stats: Record<string, StatsEntry>;
	agentTypes?: AgentTypeInfo[];
	loadingAgents?: boolean;
	onInspect: (name: string) => void;
	onAgentKilled?: (name: string) => void;
	onAgentSpawned?: (agent: AgentState) => void;
	onAgentSpawnFailed?: (name: string) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const entries = Object.entries(agents);
	const showLoadingAgents = loadingAgents && entries.length === 0;
	const spawnableTypes = agentTypes.filter(
		(type) => type.agentClass !== "orchestrator",
	);
	return (
		<Card className="min-h-[70vh]">
			<CardHeader>
				<CardTitle>Active Agents</CardTitle>
			</CardHeader>
			<CardContent>
				<div
					className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3"
					data-testid="live-agent-grid"
				>
					<SpawnAgentForm
						agentTypes={spawnableTypes}
						onAgentSpawned={onAgentSpawned}
						onAgentSpawnFailed={onAgentSpawnFailed}
						pushLog={pushLog}
					/>
					{showLoadingAgents && <LiveAgentsLoadingCard />}
					{entries.map(([name, agent]) => (
						<AgentCard
							key={name}
							name={name}
							agent={agent}
							onInspect={onInspect}
							onAgentKilled={onAgentKilled}
							pushLog={pushLog}
						/>
					))}
				</div>
			</CardContent>
		</Card>
	);
}

function LiveAgentsLoadingCard() {
	return (
		<div
			className={`${LIVE_AGENT_CARD_CLASS} rounded-md border border-border bg-card/40 p-3`}
			data-live-agent-card="true"
			data-testid="live-agents-loading-card"
			aria-label="Restoring live agents"
		>
			<div className="flex h-full min-h-48 flex-col justify-center gap-4">
				<div>
					<div className="text-sm font-semibold">Restoring live agents…</div>
					<div className="mt-1 text-xs text-muted-foreground">
						Loading active agent state and recent preview history.
					</div>
				</div>
				<div className="space-y-2 rounded-md bg-background p-3">
					<SkeletonLine className="h-4 w-44" />
					<SkeletonLine className="h-3 w-full" />
					<SkeletonLine className="h-3 w-5/6" />
				</div>
			</div>
		</div>
	);
}

function SpawnAgentForm({
	agentTypes,
	onAgentSpawned,
	onAgentSpawnFailed,
	pushLog,
}: {
	agentTypes: AgentTypeInfo[];
	onAgentSpawned?: (agent: AgentState) => void;
	onAgentSpawnFailed?: (name: string) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const firstTypeName = agentTypes[0]?.name || "";
	const [selectedType, setSelectedType] = useState(firstTypeName);
	const [name, setName] = useState(spawnNameFor(firstTypeName));
	const [model, setModel] = useState("");
	const [issueId, setIssueId] = useState("");
	const [busy, setBusy] = useState(false);
	const [expanded, setExpanded] = useState(false);

	useEffect(() => {
		if (selectedType || !firstTypeName) return;
		setSelectedType(firstTypeName);
		setName((current) => current || spawnNameFor(firstTypeName));
	}, [firstTypeName, selectedType]);

	const resetDraft = () => {
		setName(spawnNameFor(selectedType));
		setModel("");
		setIssueId("");
		setExpanded(false);
	};

	const spawn = async () => {
		const spawnName = name.trim();
		if (!spawnName) {
			pushLog("Agent name is required", "error");
			return;
		}
		const requestedModel = model.trim();
		const requestedIssueId = issueId.trim();
		setBusy(true);
		onAgentSpawned?.({
			name: spawnName,
			status: "queued",
			definition: selectedType || undefined,
			model: requestedModel || undefined,
			parent: undefined,
			children: [],
			turns: 0,
			worktree: "",
			issueId: requestedIssueId || undefined,
			setupPending: true,
			setupStartedAt: Date.now(),
		});
		try {
			const body = {
				name: spawnName,
				parent: "self",
				type: selectedType || undefined,
				model: requestedModel || undefined,
				issueId: requestedIssueId || undefined,
			};
			const res = await fetch("/api/spawn", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(body),
			});
			if (!res.ok) throw new Error(await res.text());
			const agent = (await res.json()) as AgentInfo;
			onAgentSpawned?.({
				...agent,
				setupPending: !agent.runtimeTools,
				setupStartedAt: Date.now(),
			});
			pushLog(`Spawned ${agent.name}`, "success");
			setName(spawnNameFor(selectedType || agent.definition));
			setModel("");
			setIssueId("");
			setExpanded(false);
		} catch (e: any) {
			onAgentSpawnFailed?.(spawnName);
			pushLog(`Spawn failed: ${e.message}`, "error");
		} finally {
			setBusy(false);
		}
	};

	return (
		<div
			className={`${LIVE_AGENT_CARD_CLASS} rounded-md border border-dashed border-border bg-card/40 p-3`}
			data-live-agent-card="true"
			data-testid="spawn-agent-draft-card"
			aria-label="Add Agent"
		>
			{!expanded ? (
				<div className="flex h-full min-h-48 flex-col items-center justify-center gap-3 text-center">
					<div>
						<div className="text-sm font-semibold">Add Agent</div>
						<div className="mt-1 text-xs text-muted-foreground">
							Create a persistent live agent in this grid.
						</div>
					</div>
					<Button onClick={() => setExpanded(true)}>+ Add Agent</Button>
				</div>
			) : (
				<>
					<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
						<div>
							<div className="text-sm font-semibold">Add Agent</div>
							<div className="text-xs text-muted-foreground">
								Creates a live agent that stays inspectable until you kill it.
							</div>
						</div>
						<div className="flex gap-2">
							<Button variant="secondary" onClick={resetDraft} disabled={busy}>
								Cancel
							</Button>
							<Button onClick={spawn} disabled={busy || !name.trim()}>
								{busy ? "Spawning…" : "Spawn Agent"}
							</Button>
						</div>
					</div>
					<div className="grid gap-2 md:grid-cols-3">
						<Input
							value={name}
							onInput={(e) => setName(e.currentTarget.value)}
							onChange={(e) => setName(e.target.value)}
							placeholder="Agent name"
						/>
						<Select
							value={selectedType}
							onChange={(e) => {
								setSelectedType(e.target.value);
								if (!name.trim()) setName(spawnNameFor(e.target.value));
							}}
							aria-label="Agent type"
						>
							<option value="">No type / default</option>
							{agentTypes.map((type) => (
								<option key={type.name} value={type.name}>
									{type.name}
								</option>
							))}
						</Select>
						<Input
							value={model}
							onInput={(e) => setModel(e.currentTarget.value)}
							onChange={(e) => setModel(e.target.value)}
							placeholder="Optional model override"
						/>
					</div>
					<Input
						className="mt-2"
						value={issueId}
						onInput={(e) => setIssueId(e.currentTarget.value)}
						onChange={(e) => setIssueId(e.target.value)}
						placeholder="Optional Seeds issue id for handoff artifacts"
					/>
				</>
			)}
		</div>
	);
}

function AgentCard({
	name,
	agent,
	onInspect,
	onAgentKilled,
	pushLog,
}: {
	name: string;
	agent: AgentState;
	onInspect: (name: string) => void;
	onAgentKilled?: (name: string) => void;
	pushLog: (text: string, level?: LogLine["level"]) => void;
}) {
	const [message, setMessage] = useState("");
	const [localPendingMessage, setLocalPendingMessage] = useState("");
	const [killPending, setKillPending] = useState(false);
	const setupPending = isAgentSettingUp(agent);
	const removing = killPending || !!agent.removalPending;
	const stuck = !!agent.turnDiagnostics?.stuck;
	const interactionsDisabled = setupPending || removing;
	const preview = previewMarkdown(
		localPendingMessage && !agent.text
			? {
					...agent,
					pendingSend: agent.pendingSend || {
						message: localPendingMessage,
						startedAt: Date.now(),
						timeoutMs: 300_000,
						status: "queued",
					},
				}
			: agent,
	);
	const send = async () => {
		if (interactionsDisabled || !message.trim()) return;
		const body = message.trim();
		setMessage("");
		setLocalPendingMessage(body);
		try {
			const res = await fetch(`/api/agents/${encodeURIComponent(name)}/send`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ message: body }),
			});
			if (!res.ok) throw new Error(String(res.status));
			pushLog(`Queued message for ${name}`);
		} catch (e: any) {
			setLocalPendingMessage("");
			pushLog(`Send to ${name} failed: ${e.message}`, "error");
		}
	};
	useEffect(() => {
		if (agent.text || agent.status === "idle" || agent.status === "error") {
			setLocalPendingMessage("");
		}
	}, [agent.status, agent.text]);
	const kill = async () => {
		if (removing) return;
		setKillPending(true);
		try {
			const res = await fetch(`/api/agents/${encodeURIComponent(name)}/kill`, {
				method: "POST",
			});
			if (!res.ok) throw new Error(String(res.status));
			onAgentKilled?.(name);
			pushLog(`Killed ${name}`, "warn");
		} catch (e: any) {
			setKillPending(false);
			pushLog(`Kill ${name} failed: ${e.message}`, "error");
		}
	};
	const copyPath = async () => {
		try {
			await navigator.clipboard.writeText(agent.worktree || "");
			pushLog(`Copied worktree path for ${name}`, "success");
		} catch {
			pushLog(`Worktree path: ${agent.worktree}`);
		}
	};
	const copyArtifactPath = async () => {
		try {
			await navigator.clipboard.writeText(agent.artifactPath || "");
			pushLog(`Copied artifact path for ${name}`, "success");
		} catch {
			pushLog(`Artifact path: ${agent.artifactPath}`);
		}
	};
	const copyNativeSession = async () => {
		const nativeSession = agent.nativeSession;
		const value = nativeSession?.sessionFile || nativeSession?.sessionId || "";
		try {
			await navigator.clipboard.writeText(value);
			pushLog(`Copied Pi session metadata for ${name}`, "success");
		} catch {
			pushLog(`Pi session: ${value || "unknown"}`);
		}
	};
	return (
		<Card
			className={`${LIVE_AGENT_CARD_CLASS} transition-all duration-1000 ease-out ${
				removing
					? "pointer-events-none translate-y-2 scale-[0.98] border-muted opacity-0"
					: setupPending
						? "border-primary/40 bg-card/70 opacity-100"
						: stuck
							? "border-amber-400/60 bg-amber-400/10 opacity-100"
							: agent.status === "streaming"
								? "border-primary/50 opacity-100"
								: "opacity-100"
			}`}
			aria-busy={setupPending || removing}
			aria-disabled={interactionsDisabled}
			data-live-agent-card="true"
		>
			<CardHeader className="border-b border-border">
				<div className="flex items-center justify-between gap-3">
					<CardTitle>{name}</CardTitle>
					<div className="flex items-center gap-2">
						{removing && <Badge variant="outline">closing</Badge>}
						{setupPending && !removing && (
							<Badge variant="outline">setting up</Badge>
						)}
						{stuck && !removing && <Badge variant="warning">stuck</Badge>}
						<Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
					</div>
				</div>
				{(setupPending || removing || stuck) && (
					<div className="pt-2 text-xs text-muted-foreground">
						{removing
							? "Shutting down agent. Card will close shortly."
							: setupPending
								? "Extracting runtime tools. Messaging disabled until setup completes."
								: agent.turnDiagnostics?.reasons.join("; ") ||
									"Pending turn appears stuck."}
					</div>
				)}
			</CardHeader>
			<CardContent className="space-y-3 pt-4">
				{setupPending ? (
					<AgentSetupSkeleton name={name} />
				) : (
					<>
						<div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
							<span>
								{agent.definition ? `type: ${agent.definition}` : "no type"}
							</span>
							<span>model: {agent.model || "default"}</span>
							<span>{agent.parent ? `parent: ${agent.parent}` : "root"}</span>
							<span>turns: {agent.turns || 0}</span>
							{agent.worktree && (
								<>
									<span title={agent.worktree}>
										worktree: {shortPath(agent.worktree)}
									</span>
									<Button
										variant="secondary"
										className="px-2 py-1 text-xs"
										onClick={copyPath}
										disabled={interactionsDisabled}
									>
										Copy Path
									</Button>
								</>
							)}
							{agent.issueId && (
								<Badge variant="outline">issue: {agent.issueId}</Badge>
							)}
							{agent.nativeSession?.sessionId && (
								<>
									<span
										title={
											agent.nativeSession.sessionFile ||
											agent.nativeSession.sessionId
										}
									>
										Pi session: {shortSessionId(agent.nativeSession.sessionId)}
									</span>
									<Button
										variant="secondary"
										className="px-2 py-1 text-xs"
										onClick={copyNativeSession}
										disabled={interactionsDisabled}
									>
										Copy Session
									</Button>
								</>
							)}
							{agent.artifactPath && (
								<>
									<span title={agent.artifactPath}>
										artifacts: {shortPath(agent.artifactPath)}
									</span>
									<Button
										variant="secondary"
										className="px-2 py-1 text-xs"
										onClick={copyArtifactPath}
										disabled={interactionsDisabled}
									>
										Copy Artifacts
									</Button>
								</>
							)}
							<span
								title={
									agent.runtimeTools?.active
										.map((tool) => tool.name)
										.join(", ") || "No runtime tool snapshot reported yet"
								}
							>
								tools:{" "}
								{agent.runtimeTools
									? `${agent.runtimeTools.active.length} active / ${agent.runtimeTools.all.length} total`
									: "unknown"}
							</span>
							{!!agent.runtimeTools?.conflicts?.length && (
								<Badge
									variant="warning"
									title={agent.runtimeTools.conflicts
										.map(
											(conflict) =>
												`${conflict.name}: ${conflict.count} registrations (${conflict.sources.join(", ") || "unknown sources"})`,
										)
										.join("\n")}
								>
									tool conflicts: {agent.runtimeTools.conflicts.length}
								</Badge>
							)}
						</div>
						<div
							className="prose prose-invert h-72 max-w-none overflow-auto rounded-md bg-background p-3 text-sm leading-6"
							data-testid="agent-preview-pane"
						>
							{preview ? (
								<ReactMarkdown remarkPlugins={[remarkGfm]}>
									{preview}
								</ReactMarkdown>
							) : null}
						</div>
						<div className="flex gap-2">
							<Input
								value={message}
								onChange={(e) => setMessage(e.target.value)}
								onKeyDown={(e) => {
									if (e.key === "Enter") send();
								}}
								placeholder="Message…"
								disabled={interactionsDisabled}
							/>
							<Button
								onClick={send}
								disabled={interactionsDisabled || !message.trim()}
							>
								Send
							</Button>
							<Button
								variant="secondary"
								onClick={() => onInspect(name)}
								disabled={interactionsDisabled}
							>
								Inspect
							</Button>
							<Button
								variant="destructive"
								onClick={kill}
								disabled={interactionsDisabled}
							>
								{removing ? "Killing…" : "Kill"}
							</Button>
						</div>
					</>
				)}
			</CardContent>
		</Card>
	);
}

export function HierarchyPanel({
	agents,
}: {
	agents: Record<string, AgentState>;
}) {
	const [expanded, setExpanded] = useState<Set<string>>(new Set());
	const childrenByParent = useMemo(() => {
		const map = new Map<string, string[]>();
		for (const agent of Object.values(agents)) {
			if (!agent.parent) continue;
			map.set(agent.parent, [...(map.get(agent.parent) || []), agent.name]);
		}
		return map;
	}, [agents]);
	const roots = Object.values(agents).filter(
		(a) => !a.parent || !agents[a.parent],
	);
	const renderNode = (agent: AgentState, depth = 0): React.ReactNode => {
		const children = Array.from(
			new Set([
				...(agent.children || []),
				...(childrenByParent.get(agent.name) || []),
			]),
		).filter((name) => agents[name]);
		const hasChildren = children.length > 0;
		const isExpanded = expanded.has(agent.name);
		return (
			<div key={agent.name}>
				<button
					className="w-full py-1 text-left text-sm"
					style={{ paddingLeft: depth * 16 }}
					onClick={() =>
						hasChildren &&
						setExpanded((prev) => {
							const next = new Set(prev);
							next.has(agent.name)
								? next.delete(agent.name)
								: next.add(agent.name);
							return next;
						})
					}
				>
					{hasChildren ? (isExpanded ? "▼ " : "▶ ") : "  "}
					<strong>{agent.name}</strong>{" "}
					<span className="text-xs text-muted-foreground">
						[{agent.definition || "custom"}]
					</span>{" "}
					<Badge variant={statusVariant(agent.status)}>{agent.status}</Badge>
				</button>
				{isExpanded &&
					children.map((child) => renderNode(agents[child], depth + 1))}
			</div>
		);
	};
	return (
		<Card className="min-h-[70vh]">
			<CardHeader>
				<CardTitle>Hierarchy</CardTitle>
			</CardHeader>
			<CardContent>
				{roots.length ? (
					roots.map((root) => renderNode(root))
				) : (
					<div className="text-sm text-muted-foreground">No agents yet.</div>
				)}
			</CardContent>
		</Card>
	);
}
