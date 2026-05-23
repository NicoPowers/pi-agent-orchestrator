import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
	AgentTypeInfo,
	ExtensionInfo,
	ModelInfo,
	RootProfileInfo,
	ServerEvent,
	SkillInfo,
} from "./types.js";
import type {
	AgentState,
	LogLine,
	StatsEntry,
} from "./shared/dashboard-types.js";
import {
	AgentsPanel,
	HierarchyPanel,
} from "./features/live-agents/LiveAgentsPanel.js";
import { InspectTimeline as InspectTimelinePanel } from "./features/live-agents/InspectTimeline.js";
import { LatticeLibrariesPanel } from "./features/lattice-libraries/LatticeLibrariesPanel.js";
import {
	AgentTypesPanel,
	AgentTypeTestDialog,
	TypeEditorDialog,
} from "./features/agent-types/AgentTypesPanel.js";
import type { TemplateInfo } from "./features/agent-types/AgentTypesPanel.js";
import { SkillLibraryPanel } from "./features/skill-library/SkillLibraryPanel.js";
import {
	TemplatesPanel,
	TemplateEditorDialog,
} from "./features/templates/TemplatesPanel.js";
import { RootOrchestratorProfilesPanel } from "./features/root-orchestrator-profiles/RootOrchestratorProfilesPanel.js";
import { RoadmapPanel } from "./features/roadmap/RoadmapPanel.js";
import { Button } from "./components/ui/button.js";
import {
	Card,
	CardContent,
	CardHeader,
	CardTitle,
} from "./components/ui/card.js";
import { Dialog } from "./components/ui/dialog.js";

type Tab =
	| "agents"
	| "roadmap"
	| "types"
	| "rootProfiles"
	| "skills"
	| "latticeLibraries"
	| "skillTemplates"
	| "extensionTemplates"
	| "hierarchy"
	| "log";
type SkillDiagnostic = { type: string; message: string; path?: string };

const tabs: Array<{ id: Tab; label: string }> = [
	{ id: "agents", label: "Live Agents" },
	{ id: "roadmap", label: "Roadmap" },
	{ id: "types", label: "Agent Types" },
	{ id: "rootProfiles", label: "Root Profiles" },
	{ id: "skills", label: "Skill Library" },
	{ id: "latticeLibraries", label: "Lattice Libraries" },
	{ id: "skillTemplates", label: "Skill Templates" },
	{ id: "extensionTemplates", label: "Extension Templates" },
	{ id: "hierarchy", label: "Hierarchy" },
	{ id: "log", label: "Event Log" },
];

function mergeAgentState(
	previous: AgentState | undefined,
	next: AgentState,
): AgentState {
	const merged = { ...previous, ...next };
	const status = merged.status;
	const setupPending =
		next.setupPending ??
		(!!previous?.setupPending &&
			!merged.runtimeTools &&
			status !== "error" &&
			status !== "exited");
	const removalPending = next.removalPending ?? previous?.removalPending;
	return {
		...merged,
		setupPending: removalPending ? false : setupPending,
		removalPending,
		removalStartedAt: next.removalStartedAt ?? previous?.removalStartedAt,
	};
}

function App() {
	const [activeTab, setActiveTab] = useState<Tab>("agents");
	const [connected, setConnected] = useState(false);
	const [agents, setAgents] = useState<Record<string, AgentState>>({});
	const [agentStats, setAgentStats] = useState<Record<string, StatsEntry>>({});
	const [logs, setLogs] = useState<LogLine[]>([]);
	const [types, setTypes] = useState<AgentTypeInfo[]>([]);
	const [rootProfiles, setRootProfiles] = useState<RootProfileInfo[]>([]);
	const [models, setModels] = useState<ModelInfo[]>([]);
	const [skillTemplates, setSkillTemplates] = useState<TemplateInfo[]>([]);
	const [extensionTemplates, setExtensionTemplates] = useState<TemplateInfo[]>(
		[],
	);
	const [skills, setSkills] = useState<SkillInfo[]>([]);
	const [skillsLoading, setSkillsLoading] = useState(true);
	const [skillDiagnostics, setSkillDiagnostics] = useState<SkillDiagnostic[]>(
		[],
	);
	const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
	const [editingTemplate, setEditingTemplate] = useState<{
		kind: "skill" | "extension";
		template?: TemplateInfo;
	} | null>(null);
	const [editingType, setEditingType] = useState<
		AgentTypeInfo | null | undefined
	>(undefined);
	const [testingType, setTestingType] = useState<AgentTypeInfo | undefined>(
		undefined,
	);
	const [inspectAgentName, setInspectAgentName] = useState<string | null>(null);
	const [inspectText, setInspectText] = useState("Loading…");
	const [inspectData, setInspectData] = useState<any | null>(null);

	const pushLog = useCallback(
		(text: string, level: LogLine["level"] = "info") => {
			setLogs((prev) =>
				[
					{
						id: Date.now() + Math.random(),
						level,
						text: `${new Date().toLocaleTimeString()}  ${text}`,
					},
					...prev,
				].slice(0, 100),
			);
		},
		[],
	);

	const refreshTypes = useCallback(async () => {
		try {
			const res = await fetch("/api/agent-types");
			if (!res.ok) throw new Error(await res.text());
			setTypes(await res.json());
		} catch (e: any) {
			pushLog(`Failed to load agent types: ${e.message}`, "error");
		}
	}, [pushLog]);

	const refreshRootProfiles = useCallback(async () => {
		try {
			const res = await fetch("/api/root-profiles");
			if (!res.ok) throw new Error(await res.text());
			const data = await res.json();
			setRootProfiles(Array.isArray(data) ? data : []);
		} catch (e: any) {
			pushLog(`Failed to load root profiles: ${e.message}`, "error");
		}
	}, [pushLog]);

	const refreshModels = useCallback(async () => {
		try {
			const res = await fetch("/api/models");
			if (!res.ok) return;
			const raw = await res.json();
			setModels(
				raw.map((m: string | ModelInfo) =>
					typeof m === "string"
						? {
								provider: "",
								id: m,
								context: "",
								maxOut: "",
								thinking: false,
								images: false,
							}
						: m,
				),
			);
		} catch {
			setModels([]);
		}
	}, []);

	const refreshStats = useCallback(async () => {
		try {
			const res = await fetch("/api/agent-stats");
			if (res.ok) setAgentStats(await res.json());
		} catch {
			// stats are best-effort
		}
	}, []);

	const refreshAgents = useCallback(async () => {
		try {
			const res = await fetch("/api/agents");
			if (!res.ok) return;
			const raw = await res.json();
			const list = (Array.isArray(raw) ? raw : []) as AgentState[];
			setAgents((prev) => {
				const next = Object.fromEntries(
					list.map((agent) => [
						agent.name,
						mergeAgentState(prev[agent.name], agent),
					]),
				);
				for (const [name, agent] of Object.entries(prev)) {
					if (agent.removalPending && !next[name]) next[name] = agent;
				}
				return next;
			});
		} catch {
			// live agent refresh is best-effort; SSE remains primary
		}
	}, []);

	const scheduleAgentRemoval = useCallback((name: string) => {
		setAgents((prev) => {
			const current = prev[name];
			if (!current) return prev;
			return {
				...prev,
				[name]: {
					...current,
					setupPending: false,
					removalPending: true,
					removalStartedAt: Date.now(),
				},
			};
		});
		setTimeout(() => {
			setAgents((prev) => {
				if (!prev[name]?.removalPending) return prev;
				const next = { ...prev };
				delete next[name];
				return next;
			});
		}, 1200);
	}, []);

	const refreshTemplates = useCallback(async () => {
		setSkillsLoading(true);
		try {
			const [skillTemplatesRes, extsRes, availableExtsRes, skillsRes] =
				await Promise.all([
					fetch("/api/skill-templates"),
					fetch("/api/extension-templates"),
					fetch("/api/extensions"),
					fetch("/api/skills"),
				]);
			if (skillTemplatesRes.ok) {
				const data = await skillTemplatesRes.json();
				setSkillTemplates(Array.isArray(data) ? data : []);
			}
			if (extsRes.ok) {
				const data = await extsRes.json();
				setExtensionTemplates(Array.isArray(data) ? data : []);
			}
			if (availableExtsRes.ok) {
				const data = await availableExtsRes.json();
				setExtensions(Array.isArray(data) ? data : []);
			}
			if (skillsRes.ok) {
				const data = await skillsRes.json();
				setSkills(Array.isArray(data) ? data : []);
			}
			const diagnosticsRes = await fetch("/api/skill-diagnostics");
			if (diagnosticsRes.ok) {
				const data = await diagnosticsRes.json();
				setSkillDiagnostics(Array.isArray(data) ? data : []);
			}
		} catch (e: any) {
			pushLog(`Failed to load templates: ${e.message}`, "error");
		} finally {
			setSkillsLoading(false);
		}
	}, [pushLog]);

	const handleEvent = useCallback(
		(ev: ServerEvent) => {
			switch (ev.type) {
				case "init":
					setAgents((prev) =>
						Object.fromEntries(
							Object.entries(ev.data.agents || {}).map(([k, v]) => [
								k,
								mergeAgentState(prev[k], v as AgentState),
							]),
						),
					);
					pushLog(`Synced ${Object.keys(ev.data.agents || {}).length} agents`);
					break;
				case "agent-spawned":
					setAgents((prev) => ({
						...prev,
						[ev.data.name]: mergeAgentState(prev[ev.data.name], ev.data),
					}));
					pushLog(
						`Agent ${ev.data.name} spawned (${ev.data.parent || "root"})`,
						"success",
					);
					break;
				case "agent-killed":
					scheduleAgentRemoval(ev.data.name);
					pushLog(`Agent ${ev.data.name} killed`, "warn");
					break;
				case "agent-status":
					setAgents((prev) => ({
						...prev,
						[ev.data.name]: mergeAgentState(prev[ev.data.name], {
							...(prev[ev.data.name] || {
								name: ev.data.name,
								turns: 0,
								children: [],
								worktree: "",
							}),
							status: ev.data.status,
							pendingSend: ev.data.pendingSend,
							turnDiagnostics: ev.data.turnDiagnostics,
						}),
					}));
					break;
				case "agent-delta":
					setAgents((prev) => {
						const current = prev[ev.data.name] || {
							name: ev.data.name,
							status: "idle",
							turns: 0,
							children: [],
							worktree: "",
						};
						return {
							...prev,
							[ev.data.name]: {
								...current,
								text: (current.text || "") + ev.data.delta,
							},
						};
					});
					break;
				case "agent-start":
					setAgents((prev) => ({
						...prev,
						[ev.data.name]: mergeAgentState(prev[ev.data.name], {
							...(prev[ev.data.name] || {
								name: ev.data.name,
								turns: 0,
								children: [],
								worktree: "",
							}),
							status: "streaming",
						}),
					}));
					break;
				case "agent-end":
					setAgents((prev) => {
						const current = prev[ev.data.name] || {
							name: ev.data.name,
							turns: 0,
							children: [],
							worktree: "",
						};
						return {
							...prev,
							[ev.data.name]: mergeAgentState(current, {
								...current,
								status: "idle",
								turns: (current.turns || 0) + 1,
								text: ev.data.text,
							}),
						};
					});
					break;
				case "agent-error":
					setAgents((prev) => ({
						...prev,
						[ev.data.name]: mergeAgentState(prev[ev.data.name], {
							...(prev[ev.data.name] || {
								name: ev.data.name,
								turns: 0,
								children: [],
								worktree: "",
							}),
							status: "error",
						}),
					}));
					pushLog(`Agent ${ev.data.name} error: ${ev.data.error}`, "error");
					break;
				case "agent-exit":
					setAgents((prev) => ({
						...prev,
						[ev.data.name]: mergeAgentState(prev[ev.data.name], {
							...(prev[ev.data.name] || {
								name: ev.data.name,
								turns: 0,
								children: [],
								worktree: "",
							}),
							status: "exited",
						}),
					}));
					pushLog(
						`Agent ${ev.data.name} exited (code ${ev.data.code ?? "?"})`,
						"warn",
					);
					break;
				case "delegate":
					pushLog(
						`${ev.data.from} → ${ev.data.to} | ${ev.data.task.slice(0, 60)}`,
					);
					break;
			}
		},
		[pushLog, scheduleAgentRemoval],
	);

	useEffect(() => {
		let stopped = false;
		let es: EventSource | null = null;
		let retry: ReturnType<typeof setTimeout> | undefined;
		const connect = () => {
			if (stopped) return;
			es = new EventSource("/events");
			es.onopen = () => setConnected(true);
			es.onerror = () => {
				setConnected(false);
				es?.close();
				retry = setTimeout(connect, 2000);
			};
			es.onmessage = (e) => handleEvent(JSON.parse(e.data) as ServerEvent);
		};
		connect();
		return () => {
			stopped = true;
			es?.close();
			if (retry) clearTimeout(retry);
		};
	}, [handleEvent]);

	useEffect(() => {
		refreshTypes();
		refreshRootProfiles();
		refreshModels();
		refreshTemplates();
		refreshAgents();
		refreshStats();
		const statsInterval = setInterval(refreshStats, 5_000);
		const agentsInterval = setInterval(refreshAgents, 2_000);
		return () => {
			clearInterval(statsInterval);
			clearInterval(agentsInterval);
		};
	}, [
		refreshAgents,
		refreshModels,
		refreshRootProfiles,
		refreshStats,
		refreshTemplates,
		refreshTypes,
	]);

	useEffect(() => {
		if (
			activeTab === "skills" ||
			activeTab === "skillTemplates" ||
			activeTab === "extensionTemplates"
		) {
			refreshTemplates();
		}
		if (activeTab === "types") refreshTypes();
		if (activeTab === "rootProfiles") refreshRootProfiles();
	}, [activeTab, refreshRootProfiles, refreshTemplates, refreshTypes]);

	const emergencyStop = async () => {
		if (!confirm("Emergency Stop: Kill all agents and clean up worktrees?"))
			return;
		try {
			const res = await fetch("/api/emergency-stop", { method: "POST" });
			if (!res.ok) throw new Error(await res.text());
			setAgents({});
			setAgentStats({});
			pushLog("EMERGENCY STOP executed", "error");
		} catch (e: any) {
			pushLog(`Emergency stop failed: ${e.message}`, "error");
		}
	};

	const inspect = async (name: string) => {
		setInspectAgentName(name);
		setInspectText("Loading…");
		setInspectData(null);
		try {
			const [res, statsRes] = await Promise.all([
				fetch(`/api/agents/${encodeURIComponent(name)}/events`),
				fetch("/api/agent-stats"),
			]);
			if (!res.ok) throw new Error(await res.text());
			if (statsRes.ok) setAgentStats(await statsRes.json());
			const data = await res.json();
			setAgents((prev) => ({
				...prev,
				[name]: mergeAgentState(prev[name], data),
			}));
			setInspectData(data);
			setInspectText(formatInspectData(data));
		} catch (e: any) {
			setInspectData(null);
			setInspectText(`Inspect failed: ${e.message}`);
		}
	};

	return (
		<div className="flex min-h-screen flex-col bg-background text-foreground">
			<header className="sticky top-0 z-10 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
						<h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">
							⌬ Pi Lattice
						</h1>
						<nav
							className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-md border border-border bg-card/50 p-1"
							aria-label="Dashboard sections"
						>
							{tabs.map((tab) => (
								<button
									key={tab.id}
									type="button"
									className={`whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`}
									onClick={() => setActiveTab(tab.id)}
								>
									{tab.label}
								</button>
							))}
						</nav>
					</div>
					<div className="flex shrink-0 items-center gap-3">
						<span className="flex items-center gap-2 text-sm text-muted-foreground">
							<span
								className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-muted-foreground"}`}
							/>{" "}
							{connected ? "Connected" : "Disconnected"}
						</span>
						<Button variant="destructive" onClick={emergencyStop}>
							🛑 Emergency Stop
						</Button>
					</div>
				</div>
			</header>

			<main className="flex-1 overflow-hidden p-4">
				{activeTab === "agents" && (
					<AgentsPanel
						agents={agents}
						stats={agentStats}
						agentTypes={types}
						onInspect={inspect}
						onAgentSpawned={(agent) =>
							setAgents((prev) => ({
								...prev,
								[agent.name]: mergeAgentState(prev[agent.name], agent),
							}))
						}
						onAgentSpawnFailed={(name) =>
							setAgents((prev) => {
								const next = { ...prev };
								delete next[name];
								return next;
							})
						}
						onAgentKilled={scheduleAgentRemoval}
						pushLog={pushLog}
					/>
				)}
				{activeTab === "roadmap" && (
					<PageFrame mode="wide">
						<RoadmapPanel pushLog={pushLog} />
					</PageFrame>
				)}
				{activeTab === "types" && (
					<PageFrame mode="centered">
						<AgentTypesPanel
							types={types}
							onNew={() => setEditingType(null)}
							onEdit={(type) => setEditingType(type)}
							onTest={(type) => setTestingType(type)}
							large
						/>
					</PageFrame>
				)}
				{activeTab === "rootProfiles" && (
					<PageFrame mode="wide">
						<RootOrchestratorProfilesPanel
							profiles={rootProfiles}
							onChanged={refreshRootProfiles}
							pushLog={pushLog}
						/>
					</PageFrame>
				)}
				{activeTab === "skills" && (
					<SkillLibraryPanel
						skills={skills}
						loadingSkills={skillsLoading}
						diagnostics={skillDiagnostics}
						skillTemplates={skillTemplates}
						onEditTemplate={(template) =>
							setEditingTemplate({ kind: "skill", template })
						}
						onChanged={refreshTemplates}
					/>
				)}
				{activeTab === "latticeLibraries" && (
					<PageFrame mode="wide">
						<LatticeLibrariesPanel
							pushLog={pushLog}
							onDisplaySettingsChanged={() => {
								refreshTypes();
								refreshRootProfiles();
							}}
							onNativeSettingsSaved={() => {
								refreshTemplates();
								refreshTypes();
								refreshRootProfiles();
							}}
						/>
					</PageFrame>
				)}
				{activeTab === "skillTemplates" && (
					<PageFrame mode="centered">
						<TemplatesPanel
							kind="skill"
							templates={skillTemplates}
							onNew={() => setEditingTemplate({ kind: "skill" })}
							onEdit={(template) =>
								setEditingTemplate({ kind: "skill", template })
							}
							onDeleted={refreshTemplates}
							pushLog={pushLog}
						/>
					</PageFrame>
				)}
				{activeTab === "extensionTemplates" && (
					<PageFrame mode="centered">
						<TemplatesPanel
							kind="extension"
							templates={extensionTemplates}
							onNew={() => setEditingTemplate({ kind: "extension" })}
							onEdit={(template) =>
								setEditingTemplate({ kind: "extension", template })
							}
							onDeleted={refreshTemplates}
							pushLog={pushLog}
						/>
					</PageFrame>
				)}
				{activeTab === "hierarchy" && (
					<PageFrame mode="wide">
						<HierarchyPanel agents={agents} />
					</PageFrame>
				)}
				{activeTab === "log" && (
					<PageFrame mode="wide">
						<EventLog logs={logs} />
					</PageFrame>
				)}
			</main>

			<TypeEditorDialog
				open={editingType !== undefined}
				typeDef={editingType ?? undefined}
				models={models}
				skillTemplates={skillTemplates}
				extensionTemplates={extensionTemplates}
				onClose={() => setEditingType(undefined)}
				onSaved={() => {
					setEditingType(undefined);
					refreshTypes();
					pushLog("Saved agent type", "success");
				}}
			/>
			<AgentTypeTestDialog
				open={!!testingType}
				typeDef={testingType}
				onClose={() => setTestingType(undefined)}
				pushLog={pushLog}
			/>
			<TemplateEditorDialog
				open={!!editingTemplate}
				kind={editingTemplate?.kind || "skill"}
				template={editingTemplate?.template}
				availableSkills={skills}
				availableExtensions={extensions}
				onClose={() => setEditingTemplate(null)}
				onSaved={() => {
					setEditingTemplate(null);
					refreshTemplates();
					pushLog("Saved template", "success");
				}}
			/>
			<Dialog
				open={!!inspectAgentName}
				title={`Inspect ${inspectAgentName || "Agent"}`}
				onOpenChange={() => setInspectAgentName(null)}
				className="max-w-6xl"
			>
				{inspectData?.timeline ? (
					<InspectTimelinePanel
						timeline={inspectData.timeline}
						stats={inspectAgentName ? agentStats[inspectAgentName] : undefined}
					/>
				) : (
					<pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-sm leading-6">
						{inspectText}
					</pre>
				)}
			</Dialog>
		</div>
	);
}

function PageFrame({
	mode,
	children,
}: {
	mode: "centered" | "wide";
	children: React.ReactNode;
}) {
	const className =
		mode === "centered"
			? "mx-auto w-full max-w-5xl"
			: "mx-auto w-full max-w-7xl";
	return <div className={className}>{children}</div>;
}

function EventLog({ logs }: { logs: LogLine[] }) {
	return (
		<Card className="min-h-[70vh]">
			<CardHeader>
				<CardTitle>Event Log</CardTitle>
			</CardHeader>
			<CardContent className="max-h-[70vh] space-y-1 overflow-auto font-mono text-xs text-muted-foreground">
				{logs.length
					? logs.map((line) => (
							<div
								key={line.id}
								className={`border-l-2 pl-2 ${line.level === "error" ? "border-destructive" : line.level === "success" ? "border-emerald-400" : line.level === "warn" ? "border-amber-400" : "border-primary"}`}
							>
								{line.text}
							</div>
						))
					: "Waiting for events…"}
			</CardContent>
		</Card>
	);
}

function formatInspectData(data: any): string {
	const lines: string[] = [
		`status: ${data.status}`,
		`model: ${data.model || "default"}`,
		`worktree: ${data.worktree}`,
	];
	if (data.issueId) lines.push(`issue: ${data.issueId}`);
	if (data.artifactPath) lines.push(`artifacts: ${data.artifactPath}`);
	if (data.artifactFiles) {
		lines.push(
			`artifact files: ${Object.values(data.artifactFiles).filter(Boolean).join(", ")}`,
		);
	}
	if (data.runtimeTools) {
		lines.push(
			`runtime tools reported: ${new Date(data.runtimeTools.reportedAt).toLocaleString()}`,
		);
		lines.push(
			`active tools: ${data.runtimeTools.active.map((tool: any) => tool.name).join(", ") || "(none)"}`,
		);
		lines.push(
			`all tools: ${data.runtimeTools.all.map((tool: any) => tool.name).join(", ") || "(none)"}`,
		);
		for (const conflict of data.runtimeTools.conflicts || []) {
			lines.push(
				`tool conflict: ${conflict.name} registered ${conflict.count} times${conflict.sources?.length ? ` by ${conflict.sources.join(", ")}` : ""}`,
			);
		}
	} else {
		lines.push("runtime tools: unknown");
	}
	if (data.pendingSend) {
		lines.push(
			"",
			"Pending send:",
			`status: ${data.pendingSend.status}`,
			`started: ${new Date(data.pendingSend.startedAt).toLocaleString()}`,
			`timeout: ${data.pendingSend.timeoutMs}ms`,
			`message: ${JSON.stringify(data.pendingSend.message)}`,
		);
	}
	if (data.stderrTail) {
		lines.push("", "stderr tail:", data.stderrTail);
	}
	lines.push("", "Recent events:");
	let textBuffer = "";
	let textStartTime = "";
	const flush = () => {
		const text = textBuffer.trim();
		if (text)
			lines.push(
				`${textStartTime} assistant_text ${JSON.stringify(text.length > 500 ? text.slice(0, 500) + "…" : text)}`,
			);
		textBuffer = "";
		textStartTime = "";
	};
	for (const item of (data.events || []).slice(-180)) {
		const time = new Date(item.ts).toLocaleTimeString();
		const ev = item.event || {};
		if (
			ev.type === "message_update" &&
			ev.assistantMessageEvent?.type === "text_delta"
		) {
			if (!textStartTime) textStartTime = time;
			textBuffer += ev.assistantMessageEvent.delta || "";
			continue;
		}
		if (ev.type === "message_update") continue;
		flush();
		if (ev.type === "user_message")
			lines.push(`${time} user_message ${JSON.stringify(ev.message || "")}`);
		else if (ev.type === "steer_message")
			lines.push(`${time} steer_message ${JSON.stringify(ev.message || "")}`);
		else if (ev.type === "tool_execution_start")
			lines.push(
				`${time} tool_start ${ev.toolName || ""} ${JSON.stringify(ev.args || {}).slice(0, 220)}`,
			);
		else if (ev.type === "tool_execution_end")
			lines.push(`${time} tool_end ${ev.toolName || ""}`);
		else if (
			[
				"agent_start",
				"turn_start",
				"message_start",
				"message_end",
				"turn_end",
				"agent_end",
			].includes(ev.type)
		)
			lines.push(`${time} ${ev.type}`);
		else lines.push(`${time} ${ev.type || item.type}`);
	}
	flush();
	lines.push(
		"",
		"Accumulated assistant text:",
		data.accumulatedText || "(none)",
	);
	return lines.join("\n");
}

createRoot(document.getElementById("root")!).render(
	<StrictMode>
		<App />
	</StrictMode>,
);
