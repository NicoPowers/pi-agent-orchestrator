import { StrictMode, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { AgentInfo, AgentTypeInfo, ExtensionInfo, ExtensionTemplateSmokeTestResult, ModelInfo, OrchestratorLibrariesInfo, ResourcePathValidation, ResourceScopeSettings, ResourceSettingsInfo, ServerEvent, SkillDetailInfo, SkillInfo } from "./types.js";
import { Badge } from "./components/ui/badge.js";
import { Button } from "./components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "./components/ui/card.js";
import { Dialog } from "./components/ui/dialog.js";
import { Input, Textarea } from "./components/ui/input.js";
import { Select } from "./components/ui/select.js";

type AgentState = AgentInfo & { text?: string };
type LogLine = { id: number; text: string; level: "info" | "success" | "warn" | "error" };
type Tab = "agents" | "types" | "skills" | "orchestratorLibraries" | "resourceSettings" | "skillTemplates" | "extensionTemplates" | "hierarchy" | "log";
type TemplateInfo = { name: string; description: string; items: string[]; applyToAll?: boolean; source: string; filePath: string };
type SkillDiagnostic = { type: string; message: string; path?: string };
type SkillFileEntry = { path: string; name: string; type: "file" | "directory"; size?: number; markdown?: boolean; editable: boolean };
type SkillFileDetail = { path: string; content: string; size: number; mtimeMs: number; hash: string; markdown: boolean; editable: boolean };

type StatsEntry = { error?: string; stats?: any; state?: any };

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "agents", label: "Live Agents" },
  { id: "types", label: "Agent Types" },
  { id: "skills", label: "Skill Library" },
  { id: "orchestratorLibraries", label: "Orchestrator Libraries" },
  { id: "resourceSettings", label: "Skill & Extension Paths" },
  { id: "skillTemplates", label: "Skill Templates" },
  { id: "extensionTemplates", label: "Extension Templates" },
  { id: "hierarchy", label: "Hierarchy" },
  { id: "log", label: "Event Log" },
];

function shortPath(p?: string): string {
  if (!p) return "";
  return p.length > 42 ? "…" + p.slice(-39) : p;
}

function formatCompactNumber(n: number | undefined): string {
  if (typeof n !== "number" || !Number.isFinite(n)) return "—";
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1) + "K";
  return String(n);
}

function statusVariant(status: AgentInfo["status"]): "default" | "success" | "destructive" | "outline" {
  if (status === "idle") return "success";
  if (status === "error" || status === "exited") return "destructive";
  if (status === "streaming") return "default";
  return "outline";
}

function App() {
  const [activeTab, setActiveTab] = useState<Tab>("agents");
  const [connected, setConnected] = useState(false);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [agentStats, setAgentStats] = useState<Record<string, StatsEntry>>({});
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [types, setTypes] = useState<AgentTypeInfo[]>([]);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [skillTemplates, setSkillTemplates] = useState<TemplateInfo[]>([]);
  const [extensionTemplates, setExtensionTemplates] = useState<TemplateInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [skillDiagnostics, setSkillDiagnostics] = useState<SkillDiagnostic[]>([]);
  const [extensions, setExtensions] = useState<ExtensionInfo[]>([]);
  const [editingTemplate, setEditingTemplate] = useState<{ kind: "skill" | "extension"; template?: TemplateInfo } | null>(null);
  const [editingType, setEditingType] = useState<AgentTypeInfo | null | undefined>(undefined);
  const [inspectAgentName, setInspectAgentName] = useState<string | null>(null);
  const [inspectText, setInspectText] = useState("Loading…");

  const pushLog = useCallback((text: string, level: LogLine["level"] = "info") => {
    setLogs((prev) => [{ id: Date.now() + Math.random(), level, text: `${new Date().toLocaleTimeString()}  ${text}` }, ...prev].slice(0, 100));
  }, []);

  const refreshTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/agent-types");
      if (!res.ok) throw new Error(await res.text());
      setTypes(await res.json());
    } catch (e: any) {
      pushLog(`Failed to load agent types: ${e.message}`, "error");
    }
  }, [pushLog]);

  const refreshModels = useCallback(async () => {
    try {
      const res = await fetch("/api/models");
      if (!res.ok) return;
      const raw = await res.json();
      setModels(raw.map((m: string | ModelInfo) => typeof m === "string" ? { provider: "", id: m, context: "", maxOut: "", thinking: false, images: false } : m));
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

  const refreshTemplates = useCallback(async () => {
    try {
      const [skillTemplatesRes, extsRes, availableExtsRes, skillsRes] = await Promise.all([
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
    }
  }, [pushLog]);

  const handleEvent = useCallback((ev: ServerEvent) => {
    switch (ev.type) {
      case "init":
        setAgents(Object.fromEntries(Object.entries(ev.data.agents || {}).map(([k, v]) => [k, { ...v }])));
        pushLog(`Synced ${Object.keys(ev.data.agents || {}).length} agents`);
        break;
      case "agent-spawned":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...prev[ev.data.name], ...ev.data } }));
        pushLog(`Agent ${ev.data.name} spawned (${ev.data.parent || "root"})`, "success");
        break;
      case "agent-killed":
        setAgents((prev) => {
          const next = { ...prev };
          delete next[ev.data.name];
          return next;
        });
        pushLog(`Agent ${ev.data.name} killed`, "warn");
        break;
      case "agent-delta":
        setAgents((prev) => {
          const current = prev[ev.data.name] || { name: ev.data.name, status: "idle", turns: 0, children: [], worktree: "" };
          return { ...prev, [ev.data.name]: { ...current, text: (current.text || "") + ev.data.delta } };
        });
        break;
      case "agent-start":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "streaming" } }));
        break;
      case "agent-end":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "idle", text: ev.data.text } }));
        break;
      case "agent-error":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "error" } }));
        pushLog(`Agent ${ev.data.name} error: ${ev.data.error}`, "error");
        break;
      case "agent-exit":
        setAgents((prev) => ({ ...prev, [ev.data.name]: { ...(prev[ev.data.name] || { name: ev.data.name, turns: 0, children: [], worktree: "" }), status: "exited" } }));
        pushLog(`Agent ${ev.data.name} exited (code ${ev.data.code ?? "?"})`, "warn");
        break;
      case "delegate":
        pushLog(`${ev.data.from} → ${ev.data.to} | ${ev.data.task.slice(0, 60)}`);
        break;
    }
  }, [pushLog]);

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
    refreshModels();
    refreshTemplates();
    refreshStats();
    const interval = setInterval(refreshStats, 5_000);
    return () => clearInterval(interval);
  }, [refreshModels, refreshStats, refreshTemplates, refreshTypes]);

  const emergencyStop = async () => {
    if (!confirm("Emergency Stop: Kill all agents and clean up worktrees?")) return;
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
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/events`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setInspectText(formatInspectData(data));
    } catch (e: any) {
      setInspectText(`Inspect failed: ${e.message}`);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/85 px-4 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-3">
            <h1 className="whitespace-nowrap text-xl font-semibold tracking-tight">🧠 Pi Orchestrator</h1>
            <nav className="flex min-w-0 flex-1 gap-1 overflow-x-auto rounded-md border border-border bg-card/50 p-1" aria-label="Dashboard sections">
              {tabs.map((tab) => <button key={tab.id} type="button" className={`whitespace-nowrap rounded px-3 py-1.5 text-sm font-medium transition ${activeTab === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`} onClick={() => setActiveTab(tab.id)}>{tab.label}</button>)}
            </nav>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            <span className="flex items-center gap-2 text-sm text-muted-foreground"><span className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-muted-foreground"}`} /> {connected ? "Connected" : "Disconnected"}</span>
            <Button variant="destructive" onClick={emergencyStop}>🛑 Emergency Stop</Button>
          </div>
        </div>
      </header>

      <main className="flex-1 overflow-hidden p-4">
        {activeTab === "agents" && <AgentsPanel agents={agents} stats={agentStats} onInspect={inspect} pushLog={pushLog} />}
        {activeTab === "types" && <PageFrame mode="centered"><AgentTypesPanel types={types} onNew={() => setEditingType(null)} onEdit={(type) => setEditingType(type)} large /></PageFrame>}
        {activeTab === "skills" && <SkillLibraryPanel skills={skills} diagnostics={skillDiagnostics} skillTemplates={skillTemplates} onEditTemplate={(template) => setEditingTemplate({ kind: "skill", template })} onChanged={refreshTemplates} />}
        {activeTab === "orchestratorLibraries" && <PageFrame mode="wide"><OrchestratorLibrariesPanel pushLog={pushLog} onDisplaySettingsChanged={refreshTypes} /></PageFrame>}
        {activeTab === "resourceSettings" && <PageFrame mode="wide"><ResourceSettingsPanel onSaved={refreshTemplates} pushLog={pushLog} /></PageFrame>}
        {activeTab === "skillTemplates" && <PageFrame mode="centered"><TemplatesPanel kind="skill" templates={skillTemplates} onNew={() => setEditingTemplate({ kind: "skill" })} onEdit={(template) => setEditingTemplate({ kind: "skill", template })} onDeleted={refreshTemplates} pushLog={pushLog} /></PageFrame>}
        {activeTab === "extensionTemplates" && <PageFrame mode="centered"><TemplatesPanel kind="extension" templates={extensionTemplates} onNew={() => setEditingTemplate({ kind: "extension" })} onEdit={(template) => setEditingTemplate({ kind: "extension", template })} onDeleted={refreshTemplates} pushLog={pushLog} /></PageFrame>}
        {activeTab === "hierarchy" && <PageFrame mode="wide"><HierarchyPanel agents={agents} /></PageFrame>}
        {activeTab === "log" && <PageFrame mode="wide"><EventLog logs={logs} /></PageFrame>}
      </main>

      <TypeEditorDialog open={editingType !== undefined} typeDef={editingType ?? undefined} models={models} skillTemplates={skillTemplates} extensionTemplates={extensionTemplates} onClose={() => setEditingType(undefined)} onSaved={() => { setEditingType(undefined); refreshTypes(); pushLog("Saved agent type", "success"); }} />
      <TemplateEditorDialog open={!!editingTemplate} kind={editingTemplate?.kind || "skill"} template={editingTemplate?.template} availableSkills={skills} availableExtensions={extensions} onClose={() => setEditingTemplate(null)} onSaved={() => { setEditingTemplate(null); refreshTemplates(); pushLog("Saved template", "success"); }} />
      <Dialog open={!!inspectAgentName} title={`Inspect ${inspectAgentName || "Agent"}`} onOpenChange={() => setInspectAgentName(null)} className="max-w-5xl">
        <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 text-sm leading-6">{inspectText}</pre>
      </Dialog>
    </div>
  );
}

function PageFrame({ mode, children }: { mode: "centered" | "wide"; children: React.ReactNode }) {
  const className = mode === "centered" ? "mx-auto w-full max-w-5xl" : "mx-auto w-full max-w-7xl";
  return <div className={className}>{children}</div>;
}

function AgentsPanel({ agents, stats, onInspect, pushLog }: { agents: Record<string, AgentState>; stats: Record<string, StatsEntry>; onInspect: (name: string) => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const entries = Object.entries(agents);
  return (
    <Card className="min-h-[70vh]">
      <CardHeader><CardTitle>Active Agents</CardTitle></CardHeader>
      <CardContent>
        {!entries.length ? <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No agents running.</div> :
          <div className="grid gap-4 xl:grid-cols-2 2xl:grid-cols-3">
            {entries.map(([name, agent]) => <AgentCard key={name} name={name} agent={agent} stats={stats[name]} onInspect={onInspect} pushLog={pushLog} />)}
          </div>}
      </CardContent>
    </Card>
  );
}

function AgentCard({ name, agent, stats, onInspect, pushLog }: { name: string; agent: AgentState; stats?: StatsEntry; onInspect: (name: string) => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const [message, setMessage] = useState("");
  const send = async () => {
    if (!message.trim()) return;
    const body = message.trim();
    setMessage("");
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: body }) });
      if (!res.ok) throw new Error(String(res.status));
      pushLog(`Queued message for ${name}`);
    } catch (e: any) {
      pushLog(`Send to ${name} failed: ${e.message}`, "error");
    }
  };
  const kill = async () => {
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(name)}/kill`, { method: "POST" });
      if (!res.ok) throw new Error(String(res.status));
    } catch (e: any) {
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
  return (
    <Card className={agent.status === "streaming" ? "border-primary/50" : ""}>
      <CardHeader className="border-b border-border">
        <div className="flex items-center justify-between gap-3"><CardTitle>{name}</CardTitle><Badge variant={statusVariant(agent.status)}>{agent.status}</Badge></div>
      </CardHeader>
      <CardContent className="space-y-3 pt-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
          <span>{agent.definition ? `type: ${agent.definition}` : "no type"}</span>
          <span>{agent.parent ? `parent: ${agent.parent}` : "root"}</span>
          <span>turns: {agent.turns || 0}</span>
          <Stats stats={stats} />
          {agent.worktree && <><span title={agent.worktree}>worktree: {shortPath(agent.worktree)}</span><Button variant="secondary" className="px-2 py-1 text-xs" onClick={copyPath}>Copy Path</Button></>}
          <span title={agent.runtimeTools?.active.map((tool) => tool.name).join(", ") || "No runtime tool snapshot reported yet"}>tools: {agent.runtimeTools ? `${agent.runtimeTools.active.length} active / ${agent.runtimeTools.all.length} total` : "unknown"}</span>
          {!!agent.runtimeTools?.conflicts?.length && <Badge variant="warning" title={agent.runtimeTools.conflicts.map((conflict) => `${conflict.name}: ${conflict.count} registrations (${conflict.sources.join(", ") || "unknown sources"})`).join("\n")}>tool conflicts: {agent.runtimeTools.conflicts.length}</Badge>}
        </div>
        <pre className="max-h-72 min-h-28 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-3 font-mono text-xs leading-6">{agent.text || ""}</pre>
        <div className="flex gap-2">
          <Input value={message} onChange={(e) => setMessage(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") send(); }} placeholder="Message…" />
          <Button onClick={send}>Send</Button>
          <Button variant="secondary" onClick={() => onInspect(name)}>Inspect</Button>
          <Button variant="destructive" onClick={kill}>Kill</Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Stats({ stats }: { stats?: StatsEntry }) {
  if (!stats || stats.error) return <><span>ctx: —</span><span>cost: —</span></>;
  const s = stats.stats || {};
  const state = stats.state || {};
  const context = s.contextUsage || {};
  const used = context.tokens ?? context.current ?? s.tokens?.total;
  const max = context.contextWindow ?? context.max ?? state.model?.contextWindow;
  const pct = used && max ? Math.round((used / max) * 100) : undefined;
  const cost = typeof s.cost === "number" ? `$${s.cost.toFixed(4)}` : "—";
  const tokenText = used && max ? `${formatCompactNumber(used)} / ${formatCompactNumber(max)}` : formatCompactNumber(s.tokens?.total);
  return <><span>ctx: {pct !== undefined ? `${pct}% ` : ""}{tokenText}</span><span>cost: {cost}</span></>;
}

function AgentTypesPanel({ types, onNew, onEdit, large }: { types: AgentTypeInfo[]; onNew: () => void; onEdit: (type: AgentTypeInfo) => void; large?: boolean }) {
  return (
    <Card className={large ? "min-h-[70vh]" : ""}>
      <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>Agent Types</CardTitle><Button variant="secondary" className="px-2 py-1 text-xs" onClick={onNew}>+ New Type</Button></div></CardHeader>
      <CardContent className="pt-4">
        {!types.length ? <p className="text-sm text-muted-foreground">No agent types found.</p> : <div className="grid gap-3 md:grid-cols-2">
          {types.map((type) => (
            <div key={type.name} className="rounded-md border border-border p-3">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="truncate text-sm font-semibold">{type.name}</div><div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{type.description}</div></div><Button variant="secondary" className="shrink-0 px-2 py-1 text-xs" onClick={() => onEdit(type)}>Edit</Button></div>
            </div>
          ))}
        </div>}
      </CardContent>
    </Card>
  );
}

function HierarchyPanel({ agents }: { agents: Record<string, AgentState> }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const childrenByParent = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of Object.values(agents)) {
      if (!agent.parent) continue;
      map.set(agent.parent, [...(map.get(agent.parent) || []), agent.name]);
    }
    return map;
  }, [agents]);
  const roots = Object.values(agents).filter((a) => !a.parent || !agents[a.parent]);
  const renderNode = (agent: AgentState, depth = 0): React.ReactNode => {
    const children = Array.from(new Set([...(agent.children || []), ...(childrenByParent.get(agent.name) || [])])).filter((name) => agents[name]);
    const hasChildren = children.length > 0;
    const isExpanded = expanded.has(agent.name);
    return <div key={agent.name}><button className="w-full py-1 text-left text-sm" style={{ paddingLeft: depth * 16 }} onClick={() => hasChildren && setExpanded((prev) => { const next = new Set(prev); next.has(agent.name) ? next.delete(agent.name) : next.add(agent.name); return next; })}>{hasChildren ? (isExpanded ? "▼ " : "▶ ") : "  "}<strong>{agent.name}</strong> <span className="text-xs text-muted-foreground">[{agent.definition || "custom"}]</span> <Badge variant={statusVariant(agent.status)}>{agent.status}</Badge></button>{isExpanded && children.map((child) => renderNode(agents[child], depth + 1))}</div>;
  };
  return <Card className="min-h-[70vh]"><CardHeader><CardTitle>Hierarchy</CardTitle></CardHeader><CardContent>{roots.length ? roots.map((root) => renderNode(root)) : <div className="text-sm text-muted-foreground">No agents yet.</div>}</CardContent></Card>;
}

function EventLog({ logs }: { logs: LogLine[] }) {
  return <Card className="min-h-[70vh]"><CardHeader><CardTitle>Event Log</CardTitle></CardHeader><CardContent className="max-h-[70vh] space-y-1 overflow-auto font-mono text-xs text-muted-foreground">{logs.length ? logs.map((line) => <div key={line.id} className={`border-l-2 pl-2 ${line.level === "error" ? "border-destructive" : line.level === "success" ? "border-emerald-400" : line.level === "warn" ? "border-amber-400" : "border-primary"}`}>{line.text}</div>) : "Waiting for events…"}</CardContent></Card>;
}


function OrchestratorLibrariesPanel({ pushLog, onDisplaySettingsChanged }: { pushLog: (text: string, level?: LogLine["level"]) => void; onDisplaySettingsChanged: () => void }) {
  const [data, setData] = useState<OrchestratorLibrariesInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingScope, setSavingScope] = useState<"global" | "project" | null>(null);
  const [savingDisplay, setSavingDisplay] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/orchestrator-libraries");
      if (!res.ok) throw new Error(await res.text());
      setData(await res.json() as OrchestratorLibrariesInfo);
    } catch (e: any) {
      setError(e.message || "Failed to load Orchestrator Libraries");
      pushLog(`Failed to load Orchestrator Libraries: ${e.message}`, "error");
    } finally {
      setLoading(false);
    }
  }, [pushLog]);

  useEffect(() => { load(); }, [load]);

  const moveLibrary = async (root: string, direction: -1 | 1) => {
    if (!data) return;
    const library = data.libraries.find((candidate) => candidate.root === root);
    if (!library) return;
    const scope = root.includes("/.pi/") ? "project" : "global";
    const scoped = data.libraries.filter((candidate) => (candidate.root.includes("/.pi/") ? "project" : "global") === scope);
    const index = scoped.findIndex((candidate) => candidate.root === root);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= scoped.length) return;
    const reordered = [...scoped];
    [reordered[index], reordered[nextIndex]] = [reordered[nextIndex], reordered[index]];
    setSavingScope(scope);
    try {
      const res = await fetch("/api/orchestrator-libraries/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, libraries: reordered.map((item) => item.root) }) });
      if (!res.ok) throw new Error(await res.text());
      pushLog(`Reordered ${scope} Orchestrator Libraries`, "success");
      await load();
    } catch (e: any) {
      setError(e.message || "Failed to reorder Orchestrator Libraries");
      pushLog(`Failed to reorder Orchestrator Libraries: ${e.message}`, "error");
    } finally {
      setSavingScope(null);
    }
  };

  const setShowPackageExamples = async (showPackageExamples: boolean) => {
    setSavingDisplay(true);
    setError("");
    try {
      const res = await fetch("/api/orchestrator-libraries/display-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ showPackageExamples }) });
      if (!res.ok) throw new Error(await responseErrorText(res));
      pushLog(`${showPackageExamples ? "Showing" : "Hiding"} package example resources`, "success");
      await load();
      onDisplaySettingsChanged();
    } catch (e: any) {
      setError(e.message || "Failed to update display settings");
      pushLog(`Failed to update display settings: ${e.message}`, "error");
    } finally {
      setSavingDisplay(false);
    }
  };

  const counts = useMemo(() => {
    const result: Record<string, Record<string, number>> = {};
    for (const resource of data?.resources || []) {
      result[resource.libraryName] ||= {};
      result[resource.libraryName][resource.kind] = (result[resource.libraryName][resource.kind] || 0) + 1;
    }
    return result;
  }, [data]);

  return <div className="space-y-4">
    <Card>
      <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>Orchestrator Libraries</CardTitle><Button variant="secondary" onClick={load} disabled={loading}>Refresh</Button></div></CardHeader>
      <CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
        <p>Orchestrator Libraries are user-owned, version-controlled folders for agent types, skill templates, extension templates, and curated skills/extensions.</p>
        <p>Configure libraries under <code>piAgentOrchestrator.libraries</code> in global or project settings. Libraries are loaded top to bottom within each scope; earlier libraries influence defaults and diagnostics.</p>
        {loading && !data && <div className="space-y-3 pt-1">
          <div className="rounded-md border border-border bg-background/60 p-3"><div className="mb-2 h-4 w-48 animate-pulse rounded bg-muted" /><div className="h-3 w-full max-w-2xl animate-pulse rounded bg-muted/70" /><div className="mt-2 h-3 w-3/4 max-w-xl animate-pulse rounded bg-muted/70" /></div>
          <div className="rounded-md border border-dashed border-border p-6"><div className="mx-auto mb-2 h-4 w-64 animate-pulse rounded bg-muted" /><div className="mx-auto h-3 w-80 max-w-full animate-pulse rounded bg-muted/70" /></div>
        </div>}
        {data?.settings && <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-background/60 p-3">
          <div><div className="font-medium text-foreground">Package example resources</div><div className="text-xs">Read-only package examples are useful for onboarding, but can be hidden once your own libraries are configured. Stored in project settings: <code>piAgentOrchestrator.showPackageExamples</code>.</div></div>
          <label className="flex shrink-0 items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={data.settings.showPackageExamples} disabled={savingDisplay} onChange={(e) => setShowPackageExamples(e.target.checked)} /> Show package examples</label>
        </div>}
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">{error}</div>}
        {data && !data.libraries.length && <div className="rounded-md border border-dashed border-border p-6 text-center"><div className="font-medium text-foreground">No Orchestrator Library configured yet.</div><div className="mt-1">Set up a library to version-control your agent types and templates.</div></div>}
      </CardContent>
    </Card>
    {data?.diagnostics.length ? <Card><CardHeader><CardTitle>Diagnostics</CardTitle></CardHeader><CardContent className="space-y-2">{data.diagnostics.map((diagnostic, index) => <div key={index} className={`rounded-md border p-2 text-sm ${diagnostic.level === "error" ? "border-destructive/50 bg-destructive/10 text-destructive" : "border-amber-400/40 bg-amber-400/10 text-amber-200"}`}><strong>{diagnostic.level}:</strong> {diagnostic.message}{diagnostic.path ? <div className="mt-1 font-mono text-xs opacity-80">{diagnostic.path}</div> : null}</div>)}</CardContent></Card> : null}
    {data?.libraries.length ? <div className="grid gap-4 xl:grid-cols-2">
      {data.libraries.map((library) => {
        const name = library.manifest?.name || shortPath(library.root);
        const libraryCounts = counts[name] || {};
        const scope = library.root.includes("/.pi/") ? "project" : "global";
        const scoped = data.libraries.filter((candidate) => (candidate.root.includes("/.pi/") ? "project" : "global") === scope);
        const scopeIndex = scoped.findIndex((candidate) => candidate.root === library.root);
        return <Card key={library.root} className={!library.valid ? "border-destructive/50" : ""}>
          <CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><CardTitle>{name}</CardTitle><div className="mt-1 font-mono text-xs text-muted-foreground">{library.root}</div></div><div className="flex shrink-0 items-center gap-2"><Badge variant="outline">{scope}</Badge><Button variant="secondary" className="px-2 py-1 text-xs" disabled={scopeIndex <= 0 || savingScope === scope} onClick={() => moveLibrary(library.root, -1)}>↑</Button><Button variant="secondary" className="px-2 py-1 text-xs" disabled={scopeIndex < 0 || scopeIndex >= scoped.length - 1 || savingScope === scope} onClick={() => moveLibrary(library.root, 1)}>↓</Button><Badge variant={library.valid ? "success" : "destructive"}>{library.valid ? "valid" : "invalid"}</Badge></div></div></CardHeader>
          <CardContent className="space-y-3 pt-4 text-sm">
            {library.manifest?.description && <p className="text-muted-foreground">{library.manifest.description}</p>}
            <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground md:grid-cols-3">
              <div>Agents: {libraryCounts.agents || 0}</div>
              <div>Skill templates: {libraryCounts.skillTemplates || 0}</div>
              <div>Extension templates: {libraryCounts.extensionTemplates || 0}</div>
              <div>Skills: {libraryCounts.skills || 0}</div>
              <div>Extensions: {libraryCounts.extensions || 0}</div>
            </div>
            {library.diagnostics.length ? <div className="space-y-1">{library.diagnostics.map((diagnostic, index) => <div key={index} className="text-xs text-muted-foreground">{diagnostic.level}: {diagnostic.message}</div>)}</div> : null}
          </CardContent>
        </Card>;
      })}
    </div> : null}
  </div>;
}

function ResourceSettingsPanel({ onSaved, pushLog }: { onSaved: () => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const [settings, setSettings] = useState<ResourceSettingsInfo | null>(null);
  const [drafts, setDrafts] = useState<Record<"global" | "project", { skills: string[]; extensions: string[] }>>({ global: { skills: [], extensions: [] }, project: { skills: [], extensions: [] } });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<"global" | "project" | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/resource-settings");
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as ResourceSettingsInfo;
      setSettings(data);
      setDrafts({ global: { skills: data.global.skills, extensions: data.global.extensions }, project: { skills: data.project.skills, extensions: data.project.extensions } });
    } catch (e: any) {
      setError(e.message || "Failed to load skill and extension paths");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (scope: "global" | "project") => {
    const missing = [...drafts[scope].skills, ...drafts[scope].extensions].filter((value) => value.trim() && !value.trim().startsWith("!") && !/[*?\[\]{}]/.test(value)).filter((value) => {
      const current = settings?.[scope];
      const found = current?.validation.skills.concat(current.validation.extensions).find((item) => item.rawPath === value);
      return found?.exists === false;
    });
    if (missing.length && !confirm(`Some paths do not exist yet:\n${missing.join("\n")}\n\nSave anyway?`)) return;
    if (drafts[scope].extensions.length && !confirm("Extension source paths execute code with full system permissions. Save only trusted paths. Continue?")) return;
    setSaving(scope);
    setError("");
    try {
      const res = await fetch("/api/resource-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scope, ...drafts[scope] }) });
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json() as ResourceSettingsInfo;
      setSettings(data);
      setDrafts({ global: { skills: data.global.skills, extensions: data.global.extensions }, project: { skills: data.project.skills, extensions: data.project.extensions } });
      pushLog(`Saved ${scope} skill and extension paths. Reload/restart may be needed for all sessions.`, "success");
      onSaved();
    } catch (e: any) {
      setError(e.message || "Failed to save skill and extension paths");
      pushLog(`Failed to save skill and extension paths: ${e.message}`, "error");
    } finally {
      setSaving(null);
    }
  };

  const changed = (scope: "global" | "project") => JSON.stringify(drafts[scope]) !== JSON.stringify({ skills: settings?.[scope].skills || [], extensions: settings?.[scope].extensions || [] });

  return <div className="space-y-4">
    <Card>
      <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>Skill & Extension Paths</CardTitle><Button variant="secondary" onClick={load} disabled={loading}>Refresh</Button></div></CardHeader>
      <CardContent className="space-y-2 pt-4 text-sm text-muted-foreground">
        <p>Manage Pi's native <code>settings.json</code> resource arrays for <code>skills</code> and <code>extensions</code>. Global applies to all projects on this machine; project applies only to the current repository.</p>
        <p>Paths may be absolute, <code>~</code>-prefixed, relative, globs, or exclusions. Global relative paths resolve from <code>~/.pi/agent</code>; project relative paths resolve from <code>.pi</code>.</p>
        <p className="text-amber-300">Extensions execute code with full system permissions. Only configure extension paths you trust. Settings changes may require Pi reload/restart for all running sessions to see them.</p>
        {error && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-destructive">{error}</div>}
      </CardContent>
    </Card>
    {settings ? <div className="grid gap-4 xl:grid-cols-2">
      <ResourceScopePanel scope={settings.global} draft={drafts.global} onDraft={(draft) => setDrafts((prev) => ({ ...prev, global: draft }))} changed={changed("global")} saving={saving === "global"} onSave={() => save("global")} onReset={() => setDrafts((prev) => ({ ...prev, global: { skills: settings.global.skills, extensions: settings.global.extensions } }))} />
      <ResourceScopePanel scope={settings.project} draft={drafts.project} onDraft={(draft) => setDrafts((prev) => ({ ...prev, project: draft }))} changed={changed("project")} saving={saving === "project"} onSave={() => save("project")} onReset={() => setDrafts((prev) => ({ ...prev, project: { skills: settings.project.skills, extensions: settings.project.extensions } }))} />
    </div> : <Card><CardContent className="p-6 text-sm text-muted-foreground">{loading ? "Loading skill and extension paths…" : "No settings loaded."}</CardContent></Card>}
  </div>;
}

function ResourceScopePanel({ scope, draft, onDraft, changed, saving, onSave, onReset }: { scope: ResourceScopeSettings; draft: { skills: string[]; extensions: string[] }; onDraft: (draft: { skills: string[]; extensions: string[] }) => void; changed: boolean; saving: boolean; onSave: () => void; onReset: () => void }) {
  return <Card className="min-h-[60vh]">
    <CardHeader className="border-b border-border"><div className="flex items-start justify-between gap-3"><div><CardTitle>{scope.label}</CardTitle><div className="mt-1 text-xs text-muted-foreground" title={scope.settingsPath}>{scope.settingsPath}{scope.exists ? "" : " (will be created)"}</div></div>{changed && <Badge variant="default">Unsaved</Badge>}</div></CardHeader>
    <CardContent className="space-y-5 pt-4">
      {(scope.parseError || scope.readError) && <div className="rounded-md border border-destructive/50 bg-destructive/10 p-2 text-sm text-destructive">{scope.parseError || scope.readError}</div>}
      <ResourceListEditor title="Skill source paths" kind="skills" values={draft.skills} validation={scope.validation.skills} onChange={(skills) => onDraft({ ...draft, skills })} />
      <ResourceListEditor title="Extension source paths" kind="extensions" values={draft.extensions} validation={scope.validation.extensions} onChange={(extensions) => onDraft({ ...draft, extensions })} />
      <div className="flex gap-2 border-t border-border pt-4"><Button onClick={onSave} disabled={!changed || saving}>{saving ? "Saving…" : "Save changes"}</Button><Button variant="secondary" onClick={onReset} disabled={!changed || saving}>Reset</Button></div>
    </CardContent>
  </Card>;
}

function ResourceListEditor({ title, kind, values, validation, onChange }: { title: string; kind: "skills" | "extensions"; values: string[]; validation: ResourcePathValidation[]; onChange: (values: string[]) => void }) {
  const update = (index: number, value: string) => onChange(values.map((item, i) => i === index ? value : item));
  const remove = (index: number) => onChange(values.filter((_, i) => i !== index));
  return <div className="space-y-2">
    <div className="flex items-center justify-between gap-2"><div><h3 className="text-sm font-semibold">{title}</h3><p className="text-xs text-muted-foreground">{kind === "skills" ? "Markdown instruction sources; skills may reference scripts agents can invoke." : "Trusted local extension files/directories only."}</p></div><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onChange([...values, ""])}>+ Add path</Button></div>
    {!values.length ? <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">No {kind} paths configured.</div> : <div className="space-y-2">
      {values.map((value, index) => <ResourcePathRow key={index} value={value} validation={validation.find((item) => item.rawPath === value)} onChange={(next) => update(index, next)} onRemove={() => remove(index)} />)}
    </div>}
  </div>;
}

function ResourcePathRow({ value, validation, onChange, onRemove }: { value: string; validation?: ResourcePathValidation; onChange: (value: string) => void; onRemove: () => void }) {
  const variant = validation?.errors.length ? "destructive" : validation?.exists ? "success" : "outline";
  const label = validation ? validation.type === "glob" || validation.type === "exclusion" ? validation.type : validation.exists ? `${validation.type}${typeof validation.count === "number" ? ` · ${validation.count}` : ""}` : "missing" : "pending";
  return <div className="rounded-md border border-border p-2">
    <div className="flex gap-2"><Input value={value} onChange={(e) => onChange(e.target.value)} placeholder="e.g. ~/my-pi-skills or ../shared/extensions" /><Button variant="destructive" className="px-2 py-1 text-xs" onClick={onRemove}>Remove</Button></div>
    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground"><Badge variant={variant as any}>{label}</Badge>{validation?.resolvedPath && <span title={validation.resolvedPath}>{shortPath(validation.resolvedPath)}</span>}{validation?.warnings.map((warning, i) => <span key={i} className="text-amber-300">⚠ {warning}</span>)}{validation?.errors.map((err, i) => <span key={i} className="text-destructive">{err}</span>)}</div>
  </div>;
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

function normalizeSkillName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 64).replace(/-$/g, "");
}

function SkillLibraryPanel({ skills, diagnostics, skillTemplates, onEditTemplate, onChanged }: { skills: SkillInfo[]; diagnostics: SkillDiagnostic[]; skillTemplates: TemplateInfo[]; onEditTemplate: (template: TemplateInfo) => void; onChanged: () => void }) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [selectedId, setSelectedId] = useState<string | undefined>();
  const [detail, setDetail] = useState<SkillDetailInfo | null>(null);
  const [detailView, setDetailView] = useState<"preview" | "raw" | "metadata">("preview");
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
  const [orchestratorLibraries, setOrchestratorLibraries] = useState<OrchestratorLibrariesInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const scopes = useMemo(() => Array.from(new Set(skills.map(skillScopeLabel))).sort(), [skills]);
  const selectedSkill = useMemo(() => skills.find((skill) => skill.id === selectedId) || skills[0], [selectedId, skills]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (scope !== "all" && skillScopeLabel(skill) !== scope) return false;
      if (editableFilter === "editable" && !skill.editable) return false;
      if (editableFilter === "readonly" && skill.editable) return false;
      const itemValue = skillTemplateItemValue(skill);
      const referenced = skillTemplates.some((template) => template.items.includes(itemValue) || template.items.includes(skill.name));
      if (referenceFilter === "referenced" && !referenced) return false;
      if (referenceFilter === "unreferenced" && referenced) return false;
      if (!q) return true;
      return [skill.name, skill.description, skill.path, skill.source, skill.scope].some((value) => (value || "").toLowerCase().includes(q));
    });
  }, [editableFilter, query, referenceFilter, scope, skills, skillTemplates]);
  const templatesUsingSkill = useMemo(() => selectedSkill ? skillTemplates.filter((template) => template.items.includes(skillTemplateItemValue(selectedSkill)) || template.items.includes(selectedSkill.name)) : [], [selectedSkill, skillTemplates]);
  const templatesMissingSkill = useMemo(() => selectedSkill ? skillTemplates.filter((template) => !template.items.includes(skillTemplateItemValue(selectedSkill)) && !template.items.includes(selectedSkill.name)) : [], [selectedSkill, skillTemplates]);
  const detailMatchesSelected = !!selectedSkill?.id && detail?.skill.id === selectedSkill.id;

  useEffect(() => {
    let cancelled = false;
    fetch("/api/orchestrator-libraries")
      .then((res) => res.ok ? res.json() : undefined)
      .then((data) => { if (!cancelled && data) setOrchestratorLibraries(data as OrchestratorLibrariesInfo); })
      .catch(() => { if (!cancelled) setOrchestratorLibraries(null); });
    return () => { cancelled = true; };
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
      .then((data) => { if (!cancelled) { setDetail(data); setSelectedFile("SKILL.md"); setFileDetail(null); setEditContent(data.content || ""); setEditing(false); setSaveError(""); } })
      .catch((err) => { if (!cancelled) { setDetail(null); setError(err.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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
      .then((data) => { if (!cancelled) setTree(Array.isArray(data.files) ? data.files : []); })
      .catch(() => { if (!cancelled) setTree([]); });
    return () => { cancelled = true; };
  }, [selectedSkill?.id]);

  const openSkillFile = useCallback(async (relativePath: string) => {
    if (!selectedSkill?.id) return;
    if (relativePath === "SKILL.md") { setSelectedFile("SKILL.md"); setFileDetail(null); return; }
    setSaveError("");
    const res = await fetch(`/api/skills/${encodeURIComponent(selectedSkill.id)}/files?path=${encodeURIComponent(relativePath)}`);
    if (!res.ok) return setSaveError(await responseErrorText(res));
    const file = await res.json();
    setSelectedFile(file.path);
    setFileDetail(file);
    setEditing(false);
    setDetailView("preview");
  }, [selectedSkill?.id]);

  const saveEdit = async () => {
    if (!detail?.skill.id) return;
    setSaveError("");
    if (fileDetail) {
      const res = await fetch(`/api/skills/${encodeURIComponent(detail.skill.id)}/files?path=${encodeURIComponent(fileDetail.path)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editContent, expectedHash: fileDetail.hash }) });
      if (!res.ok) return setSaveError(await responseErrorText(res));
      const next = await res.json();
      setFileDetail(next);
      setEditContent(next.content || "");
      setEditing(false);
      return;
    }
    const res = await fetch(`/api/skills/${encodeURIComponent(detail.skill.id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: editContent, expectedHash: detail.hash }) });
    if (!res.ok) return setSaveError(await responseErrorText(res));
    const next = await res.json();
    setDetail(next);
    setEditContent(next.content || "");
    setEditing(false);
    onChanged();
  };
  const displayedContent = fileDetail?.content ?? detail?.content ?? "";
  const displayedBody = fileDetail ? fileDetail.content : (detail?.body || detail?.content || "");

  const deleteSelected = async () => {
    if (!detail?.skill.id || !detailMatchesSelected) return;
    if (!confirm(`Delete skill '${detail.skill.name}'? This removes ${detail.skill.kind === "directory" ? "the entire skill directory" : "the skill file"}.`)) return;
    setSaveError("");
    const res = await fetch(`/api/skills/${encodeURIComponent(detail.skill.id)}`, { method: "DELETE" });
    if (!res.ok) return setSaveError(await responseErrorText(res));
    setDetail(null);
    setEditing(false);
    setSelectedId(undefined);
    onChanged();
  };
  const addToTemplate = async () => {
    if (!selectedSkill || !addTemplateName) return;
    const template = skillTemplates.find((candidate) => candidate.name === addTemplateName);
    if (!template) return;
    setTemplateError("");
    const skills = Array.from(new Set([...template.items, skillTemplateItemValue(selectedSkill)]));
    const res = await fetch("/api/skill-templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: template.name, description: template.description, applyToAll: !!template.applyToAll, skills }) });
    if (!res.ok) return setTemplateError(await responseErrorText(res));
    setAddTemplateName("");
    onChanged();
  };

  return <div className="grid h-[calc(100vh-6.5rem)] min-h-[620px] gap-4 lg:grid-cols-[minmax(380px,460px)_1fr]">
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>Skill Library</CardTitle><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setCreating(true)}>+ New Skill</Button></div></CardHeader>
      <CardContent className="flex h-[calc(100%-4.5rem)] flex-col gap-3 pt-4">
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search skills…" />
        <div className="grid gap-2">
          <Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="all">All sources</option>{scopes.map((value) => <option key={value} value={value}>{value}</option>)}</Select>
          <Select value={editableFilter} onChange={(e) => setEditableFilter(e.target.value)}><option value="all">Editable + read-only</option><option value="editable">Editable only</option><option value="readonly">Read-only only</option></Select>
          <Select value={referenceFilter} onChange={(e) => setReferenceFilter(e.target.value)}><option value="all">All template usage</option><option value="referenced">In a template</option><option value="unreferenced">Not in templates</option></Select>
        </div>
        {!!diagnostics.length && <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-2 text-xs text-amber-200">{diagnostics.length} skill diagnostic{diagnostics.length === 1 ? "" : "s"}. Select Metadata or inspect invalid skill files for details.</div>}
        <div className="min-h-0 flex-1 space-y-2 overflow-auto pr-1">
          {!filtered.length ? <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">No skills found.</div> : filtered.map((skill) => {
            const active = skill.id === selectedSkill?.id;
            return <button key={skill.id || skill.path} className={`w-full rounded-md border p-3 text-left transition ${active ? "border-primary bg-primary/10" : "border-border hover:bg-white/5"}`} onClick={() => setSelectedId(skill.id)}>
              <div className="flex items-center justify-between gap-2"><span className="text-sm font-semibold">{skill.name}</span><div className="flex gap-1"><Badge variant="outline">{skillScopeLabel(skill)}</Badge>{skill.editable && <Badge variant="success">editable</Badge>}</div></div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">{skill.description || "No description."}</div>
              <div className="mt-2 truncate text-[11px] text-muted-foreground" title={skill.path}>{shortPath(skill.path)}</div>
            </button>;
          })}
        </div>
      </CardContent>
    </Card>
    <Card className="min-h-0 overflow-hidden">
      <CardHeader className="border-b border-border"><div className="flex flex-wrap items-center justify-between gap-3"><CardTitle>{selectedSkill?.name || "Select a skill"}</CardTitle>{selectedSkill && <div className="flex flex-wrap items-center gap-2">{!editing && <Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => setCopying(selectedSkill)}>Copy</Button>}{detailMatchesSelected && detail?.skill.editable && !editing && <><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => { setEditContent(fileDetail?.content ?? detail.content); setEditing(true); setDetailView("preview"); }}>Edit</Button><Button variant="destructive" className="px-2 py-1 text-xs" onClick={deleteSelected}>Delete</Button></>}{detailMatchesSelected && editing && <><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => { setEditing(false); setEditContent(fileDetail?.content ?? detail?.content ?? ""); setSaveError(""); }}>Cancel</Button><Button className="px-2 py-1 text-xs" onClick={saveEdit}>Save</Button></>}<div className="flex rounded-md border border-border bg-background p-1">{(["preview", "raw", "metadata"] as const).map((view) => <button key={view} type="button" className={`rounded px-3 py-1 text-xs font-semibold uppercase tracking-wide transition ${detailView === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`} onClick={() => setDetailView(view)}>{view === "preview" ? "Preview" : view === "raw" ? "Raw" : "Metadata"}</button>)}</div></div>}</div></CardHeader>
      <CardContent className="flex h-[calc(100%-4.5rem)] flex-col gap-3 pt-4">
        {!selectedSkill ? <div className="rounded-md border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No skills discovered.</div> : <>
          <div className="flex flex-wrap gap-2"><Badge variant="outline">{skillScopeLabel(selectedSkill)}</Badge><Badge variant="outline">{selectedSkill.kind || "skill"}</Badge>{selectedSkill.editable ? <Badge variant="success">editable</Badge> : <Badge variant="warning">read-only</Badge>}</div>
          <div className="break-all rounded-md border border-border bg-background p-2 font-mono text-xs text-muted-foreground">{selectedSkill.path}</div>
          <div className="rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Skill templates using this skill</div>{!!templatesMissingSkill.length && <div className="flex gap-2"><Select value={addTemplateName} onChange={(e) => setAddTemplateName(e.target.value)} className="py-1 text-xs"><option value="">Add to template…</option>{templatesMissingSkill.map((template) => <option key={template.name} value={template.name}>{template.name}</option>)}</Select><Button variant="secondary" className="px-2 py-1 text-xs" onClick={addToTemplate} disabled={!addTemplateName}>Add</Button></div>}</div>
            <div className="flex flex-wrap gap-1">{templatesUsingSkill.length ? templatesUsingSkill.map((template) => <button key={template.name} type="button" onClick={() => onEditTemplate(template)} title="Edit template" className="rounded-full"><Badge variant="default">{template.name}</Badge></button>) : <span className="text-xs text-muted-foreground">No skill templates include this skill yet.</span>}</div>
            {templateError && <div className="mt-2 text-xs text-destructive">{templateError}</div>}
          </div>
          {loading && <div className="text-sm text-muted-foreground">Loading preview…</div>}
          {error && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}
          {saveError && <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">{saveError}</div>}
          {loading && !detailMatchesSelected && <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[260px_1fr]">
            <div className="min-h-0 rounded-md border border-border bg-background p-2"><div className="mb-2 h-3 w-16 animate-pulse rounded bg-muted" /><div className="space-y-2">{[0, 1, 2, 3].map((idx) => <div key={idx} className="h-5 animate-pulse rounded bg-muted/70" />)}</div></div>
            <div className="min-h-0 rounded-md border border-border bg-background p-5"><div className="mb-4 h-6 w-48 animate-pulse rounded bg-muted" /><div className="space-y-3">{[0, 1, 2, 3, 4].map((idx) => <div key={idx} className="h-4 animate-pulse rounded bg-muted/70" />)}</div></div>
          </div>}
          {detailMatchesSelected && detail && <div className="grid min-h-0 flex-1 gap-3 xl:grid-cols-[260px_1fr]">
            <div className="min-h-0 overflow-auto rounded-md border border-border bg-background p-2">
              <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Files</div>
              {tree.length ? tree.map((file) => <button key={file.path} type="button" disabled={file.type === "directory"} className={`block w-full truncate rounded px-2 py-1 text-left text-xs ${selectedFile === file.path ? "bg-primary/15 text-primary" : file.type === "directory" ? "text-muted-foreground" : "text-muted-foreground hover:bg-white/5 hover:text-foreground"}`} style={{ paddingLeft: `${8 + Math.max(0, file.path.split("/").length - 1) * 12}px` }} onClick={() => file.type === "file" && openSkillFile(file.path)}>{file.type === "directory" ? "▾ " : file.markdown ? "◇ " : "• "}{file.name}</button>) : <div className="text-xs text-muted-foreground">No file tree available.</div>}
            </div>
            <div className="min-h-0 overflow-hidden">
              {editing ? <div className="grid h-full gap-3 xl:grid-cols-2"><Textarea className="h-full resize-none font-mono text-xs" value={editContent} onChange={(e) => setEditContent(e.target.value)} /><MarkdownPreview content={parseMarkdownBody(editContent)} /></div> : <>
                {detailView === "preview" && <MarkdownPreview content={displayedBody} basePath={selectedFile} onOpenRelative={openSkillFile} />}
                {detailView === "raw" && <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-xs leading-6">{displayedContent}</pre>}
                {detailView === "metadata" && <pre className="h-full overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-4 font-mono text-xs leading-6">{JSON.stringify({ skill: detail.skill, selectedFile, file: fileDetail, frontmatter: detail.frontmatter, diagnostics: diagnostics.filter((diagnostic) => diagnostic.path === detail.skill.path || diagnostic.path === detail.skill.filePath), mtimeMs: detail.mtimeMs, hash: detail.hash }, null, 2)}</pre>}
              </>}
            </div>
          </div>}
        </>}
      </CardContent>
    </Card>
    <CreateSkillDialog open={creating} libraries={orchestratorLibraries} onClose={() => setCreating(false)} onCreated={(created) => { setCreating(false); setSelectedId(created.skill.id); setDetail(created); setEditContent(created.content); onChanged(); }} />
    <CopySkillDialog source={copying} onClose={() => setCopying(null)} onCopied={(copied) => { setCopying(null); setSelectedId(copied.skill.id); setDetail(copied); setEditContent(copied.content); onChanged(); }} />
  </div>;
}

function parseMarkdownBody(content: string): string {
  const match = content.match(/^---\s*\n[\s\S]*?\n---\s*\n?/);
  return match ? content.slice(match[0].length) : content;
}

function CreateSkillDialog({ open, libraries, onClose, onCreated }: { open: boolean; libraries: OrchestratorLibrariesInfo | null; onClose: () => void; onCreated: (detail: SkillDetailInfo) => void }) {
  const libraryTargets = useMemo(() => (libraries?.libraries || []).filter((library) => library.valid && library.manifest?.name), [libraries]);
  const defaultTarget = libraryTargets[0]?.manifest?.name ? `library:${libraryTargets[0].manifest.name}` : "global";
  const [target, setTarget] = useState(defaultTarget);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [body, setBody] = useState("");
  const [scaffold, setScaffold] = useState("minimal");
  const [serverError, setServerError] = useState("");
  useEffect(() => { if (open) { setTarget(defaultTarget); setName(""); setDescription(""); setBody(""); setScaffold("minimal"); setServerError(""); } }, [defaultTarget, open]);
  const savedName = normalizeSkillName(name);
  const errors = [!savedName ? "Name is required." : undefined, !description.trim() ? "Description is required." : undefined].filter(Boolean) as string[];
  const create = async () => {
    setServerError("");
    if (errors.length) return;
    const payload = target.startsWith("library:")
      ? { targetLibrary: target.slice("library:".length), name: savedName, description: description.trim(), body: body.trim() || undefined, scaffold }
      : { scope: "global", name: savedName, description: description.trim(), body: body.trim() || undefined, scaffold };
    const res = await fetch("/api/skills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return setServerError(await responseErrorText(res));
    onCreated(await res.json());
  };
  return <Dialog open={open} title="New Skill" onOpenChange={onClose} className="max-w-3xl">
    <div className="space-y-3">
      <FieldLabel required>Target</FieldLabel><Select value={target} onChange={(e) => setTarget(e.target.value)}>{libraryTargets.map((library) => <option key={library.root} value={`library:${library.manifest!.name}`}>Orchestrator Library: {library.manifest!.name}</option>)}<option value="global">Global Pi skills (~/.pi/agent/skills)</option></Select>
      <FormMessage tone={libraryTargets.length ? "success" : "muted"}>{libraryTargets.length ? "New skills default to the first configured Orchestrator Library by load order." : "No Orchestrator Library is configured; new skills fall back to the global Pi skills folder."}</FormMessage>
      <FieldLabel required>Name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} />
      <FormMessage tone={savedName ? "success" : "muted"}>Will be saved as: <code className="rounded bg-muted px-1 py-0.5 text-foreground">{savedName || "—"}</code></FormMessage>
      <FieldLabel required>Description</FieldLabel><Input value={description} onChange={(e) => setDescription(e.target.value)} />
      <FieldLabel optional>Scaffold</FieldLabel><Select value={scaffold} onChange={(e) => setScaffold(e.target.value)}><option value="minimal">Minimal SKILL.md only</option><option value="rich">Rich directory with references/scripts/assets/examples</option></Select>
      <FieldLabel optional>Initial body</FieldLabel><Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} placeholder="# My Skill\n\n## Workflow\n\n1. ..." />
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={create} disabled={!!errors.length}>Create Skill</Button></div>
    </div>
  </Dialog>;
}

function CopySkillDialog({ source, onClose, onCopied }: { source: SkillInfo | null; onClose: () => void; onCopied: (detail: SkillDetailInfo) => void }) {
  const [scope, setScope] = useState("project");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [serverError, setServerError] = useState("");
  const open = !!source;
  useEffect(() => {
    if (source) {
      setScope("project");
      setName(`${source.name}-copy`);
      setDescription(source.description ? `${source.description} (derived copy)` : "Derived copy");
      setServerError("");
    }
  }, [source?.id, source?.name]);
  const savedName = normalizeSkillName(name);
  const errors = [
    !source?.id ? "Select a source skill." : undefined,
    !savedName ? "Name is required." : undefined,
    source && savedName === source.name ? "Choose a new skill name; duplicate names collide and Pi keeps the first discovered skill." : undefined,
    !description.trim() ? "Description is required." : undefined,
  ].filter(Boolean) as string[];
  const copy = async () => {
    if (!source?.id || errors.length) return;
    setServerError("");
    const res = await fetch(`/api/skills/${encodeURIComponent(source.id)}/copy`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scope, name: savedName, description: description.trim() }) });
    if (!res.ok) return setServerError(await responseErrorText(res));
    onCopied(await res.json());
  };
  return <Dialog open={open} title={source ? `Copy Skill: ${source.name}` : "Copy Skill"} onOpenChange={onClose} className="max-w-2xl">
    <div className="space-y-3">
      <div className="rounded-md border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-100">
        Copy creates a new editable skill directory and rewrites <code>SKILL.md</code> frontmatter. Do not reuse an existing skill name: duplicate names collide during Pi discovery and Pi keeps the first discovered skill.
      </div>
      {source && <div className="rounded-md border border-border bg-background p-2 text-xs text-muted-foreground"><div>Source: <span className="text-foreground">{source.name}</span> ({skillScopeLabel(source)})</div><div className="truncate" title={source.path}>{source.path}</div></div>}
      <FieldLabel required>Target scope</FieldLabel><Select value={scope} onChange={(e) => setScope(e.target.value)}><option value="project">Project (.pi/skills)</option><option value="global">Global / all repos (~/.pi/agent/skills)</option></Select>
      <FieldLabel required>New name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} />
      <FormMessage tone={savedName && savedName !== source?.name ? "success" : "muted"}>Will be saved as: <code className="rounded bg-muted px-1 py-0.5 text-foreground">{savedName || "—"}</code></FormMessage>
      <FieldLabel required>New description</FieldLabel><Input value={description} onChange={(e) => setDescription(e.target.value)} />
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={copy} disabled={!!errors.length}>Copy Skill</Button></div>
    </div>
  </Dialog>;
}

function resolveRelativeMarkdownLink(basePath: string, href?: string): string | undefined {
  if (!href || href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href)) return undefined;
  const clean = href.split("#")[0].split("?")[0];
  if (!clean.toLowerCase().endsWith(".md")) return undefined;
  const baseParts = basePath.includes("/") ? basePath.split("/").slice(0, -1) : [];
  const parts: string[] = [];
  for (const part of [...baseParts, ...clean.split("/")]) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function escapeXmlLikeBlocks(content: string): string {
  return content.replace(/^<([a-z][\w-]*)([^>]*)>$/gim, "`<$1$2>`").replace(/^<\/([a-z][\w-]*)>$/gim, "`</$1>`");
}

function MarkdownPreview({ content, basePath = "SKILL.md", onOpenRelative }: { content: string; basePath?: string; onOpenRelative?: (path: string) => void }) {
  return <div className="h-full overflow-auto rounded-md border border-border bg-background p-5 text-sm leading-6">
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={{
      h1: ({ children }) => <h1 className="mb-3 border-b border-border pb-2 text-2xl font-semibold">{children}</h1>,
      h2: ({ children }) => <h2 className="mb-2 mt-4 text-xl font-semibold">{children}</h2>,
      h3: ({ children }) => <h3 className="mb-2 mt-3 text-lg font-semibold">{children}</h3>,
      p: ({ children }) => <p className="mb-3 text-foreground/90">{children}</p>,
      a: ({ href, children }) => {
        const relative = resolveRelativeMarkdownLink(basePath, href);
        return <a href={href} target={relative ? undefined : "_blank"} rel={relative ? undefined : "noreferrer"} className="text-primary underline underline-offset-2" onClick={(e) => { if (relative && onOpenRelative) { e.preventDefault(); onOpenRelative(relative); } }}>{children}</a>;
      },
      ul: ({ children }) => <ul className="mb-3 list-disc pl-5">{children}</ul>,
      ol: ({ children }) => <ol className="mb-3 list-decimal pl-5">{children}</ol>,
      code: ({ children, className }) => className ? <code className={className}>{children}</code> : <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">{children}</code>,
      pre: ({ children }) => <pre className="mb-3 overflow-auto rounded-md bg-muted p-3 font-mono text-xs">{children}</pre>,
      blockquote: ({ children }) => <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground">{children}</blockquote>,
      table: ({ children }) => <div className="mb-3 overflow-auto"><table className="w-full border-collapse text-xs">{children}</table></div>,
      th: ({ children }) => <th className="border border-border px-2 py-1 text-left font-semibold">{children}</th>,
      td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
    }}>{escapeXmlLikeBlocks(content)}</ReactMarkdown>
  </div>;
}

function splitItems(text: string): string[] {
  return Array.from(new Set(text.split(/[\n,]/).map((item) => item.trim()).filter(Boolean)));
}

function toggleItemText(text: string, item: string): string {
  const items = splitItems(text);
  const next = items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  return next.join("\n");
}

function normalizeTemplateName(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-zA-Z0-9]+/, "")
    .replace(/[._-]+$/, "");
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

function FieldLabel({ children, required, optional }: { children: React.ReactNode; required?: boolean; optional?: boolean }) {
  return <label className="block text-xs uppercase tracking-wide text-muted-foreground">{children} {required && <span className="text-destructive">*</span>}{optional && <span className="normal-case text-muted-foreground/70">(optional)</span>}</label>;
}

function FormMessage({ children, tone = "muted" }: { children: React.ReactNode; tone?: "muted" | "error" | "success" }) {
  const className = tone === "error" ? "text-destructive" : tone === "success" ? "text-emerald-400" : "text-muted-foreground";
  return <p className={`text-xs ${className}`}>{children}</p>;
}

function ValidationSummary({ errors, serverError }: { errors: string[]; serverError?: string }) {
  if (!errors.length && !serverError) return null;
  return <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
    {serverError && <div>{serverError}</div>}
    {!!errors.length && <ul className="list-disc pl-5">{errors.map((error) => <li key={error}>{error}</li>)}</ul>}
  </div>;
}

function TemplatesPanel({ kind, templates, onNew, onEdit, onDeleted, pushLog }: { kind: "skill" | "extension"; templates: TemplateInfo[]; onNew: () => void; onEdit: (template: TemplateInfo) => void; onDeleted: () => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
  const label = kind === "skill" ? "Skill Templates" : "Extension Templates";
  const [smokeTests, setSmokeTests] = useState<Record<string, ExtensionTemplateSmokeTestResult | { loading: true }>>({});
  const deleteTemplate = async (name: string) => {
    if (!confirm(`Delete ${label.slice(0, -1).toLowerCase()} '${name}'?`)) return;
    const res = await fetch(`/api/${kind}-templates/${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!res.ok) return pushLog(`Delete failed: ${await res.text()}`, "error");
    pushLog(`Deleted template '${name}'`, "warn");
    onDeleted();
  };
  const smokeTest = async (name: string) => {
    setSmokeTests((prev) => ({ ...prev, [name]: { loading: true } }));
    try {
      const res = await fetch(`/api/extension-templates/${encodeURIComponent(name)}/smoke-test`, { method: "POST" });
      if (!res.ok) throw new Error(await responseErrorText(res));
      const result = await res.json() as ExtensionTemplateSmokeTestResult;
      setSmokeTests((prev) => ({ ...prev, [name]: result }));
      pushLog(`Smoke test ${result.success ? "passed" : "failed"} for extension template '${name}'`, result.success ? "success" : "error");
    } catch (e: any) {
      setSmokeTests((prev) => ({ ...prev, [name]: { success: false, template: name, extensions: [], missingExtensions: [], diagnostics: [{ level: "error", message: e.message }] } }));
      pushLog(`Smoke test failed for extension template '${name}': ${e.message}`, "error");
    }
  };
  return <Card className="min-h-[70vh]"><CardHeader className="border-b border-border"><div className="flex items-center justify-between gap-3"><CardTitle>{label}</CardTitle><Button variant="secondary" className="px-2 py-1 text-xs" onClick={onNew}>+ New {kind === "skill" ? "Skill" : "Extension"} Template</Button></div></CardHeader><CardContent className="pt-4">
    {!templates.length ? <p className="text-sm text-muted-foreground">No {label.toLowerCase()} found.</p> : <div className="grid gap-3 md:grid-cols-2">
      {templates.map((template) => {
        const smoke = smokeTests[template.name];
        const loading = !!smoke && "loading" in smoke;
        const result = smoke && !("loading" in smoke) ? smoke : undefined;
        return <div key={template.name} className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{template.name}{template.applyToAll && <Badge variant="default">apply to all</Badge>}{result && <Badge variant={result.success ? "success" : "destructive"}>{result.success ? "smoke passed" : "smoke failed"}</Badge>}</div><div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{template.description}</div></div>
            <div className="flex shrink-0 gap-2"><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onEdit(template)}>Edit</Button>{kind === "extension" && <Button variant="secondary" className="px-2 py-1 text-xs" disabled={loading} onClick={() => smokeTest(template.name)}>{loading ? "Testing…" : "Smoke Test"}</Button>}<Button variant="destructive" className="px-2 py-1 text-xs" onClick={() => deleteTemplate(template.name)}>Delete</Button></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">{template.items.length ? template.items.map((item) => <Badge key={item} variant="outline">{item}</Badge>) : <span className="text-xs text-muted-foreground">No items.</span>}</div>
          {result && <div className="mt-3 space-y-2 rounded-md border border-border bg-background/60 p-2 text-xs">
            <div className="font-medium">Runtime diagnostics</div>
            <ul className="space-y-1">{result.diagnostics.map((diagnostic, index) => <li key={index} className={diagnostic.level === "error" ? "text-destructive" : diagnostic.level === "warning" ? "text-amber-300" : "text-muted-foreground"}>{diagnostic.level}: {diagnostic.message}</li>)}</ul>
            {result.runtimeTools && <div className="text-muted-foreground">Tools: {result.runtimeTools.active.map((tool) => tool.name).join(", ") || "none reported"}</div>}
            {result.stderrTail && <details><summary className="cursor-pointer text-muted-foreground">stderr tail</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-muted-foreground">{result.stderrTail}</pre></details>}
          </div>}
        </div>;
      })}
    </div>}
  </CardContent></Card>;
}

function TemplateEditorDialog({ open, kind, template, availableSkills, availableExtensions, onClose, onSaved }: { open: boolean; kind: "skill" | "extension"; template?: TemplateInfo; availableSkills: SkillInfo[]; availableExtensions: ExtensionInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);
  const [itemsText, setItemsText] = useState("");
  const [serverError, setServerError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(template?.name || "");
    setDescription(template?.description || "");
    setApplyToAll(!!template?.applyToAll);
    setItemsText((template?.items || []).join("\n"));
    setServerError("");
  }, [open, template]);
  const field = kind === "skill" ? "skills" : "extensions";
  const savedName = template ? name.trim() : normalizeTemplateName(name);
  const templateLabel = kind === "skill" ? "skill" : "extension";
  const errors = [
    !savedName ? "Name is required." : undefined,
    !description.trim() ? "Description is required." : undefined,
  ].filter(Boolean) as string[];
  const save = async () => {
    setServerError("");
    if (errors.length) return;
    const payload = { name: savedName, description: description.trim(), applyToAll, [field]: splitItems(itemsText) };
    const res = await fetch(`/api/${kind}-templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return setServerError("Failed to save: " + await responseErrorText(res));
    onSaved();
  };
  const title = `${template ? "Edit" : "New"} ${kind === "skill" ? "Skill" : "Extension"} Template`;
  return <Dialog open={open} title={title} onOpenChange={onClose}>
    <div className="space-y-3">
      <FieldLabel required>Name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!template} aria-invalid={!savedName} className={!savedName ? "border-destructive/60" : undefined} />
      {!template && <FormMessage tone={savedName ? "success" : "muted"}>Will be saved as: <code className="rounded bg-muted px-1 py-0.5 text-foreground">{savedName || "—"}</code></FormMessage>}
      <FormMessage>Required. Spaces and unsupported characters are converted to dashes; saved names may contain letters, numbers, dot, underscore, and dash.</FormMessage>
      <FieldLabel required>Description</FieldLabel><Input value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!description.trim()} className={!description.trim() ? "border-destructive/60" : undefined} />
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={applyToAll} onChange={(e) => setApplyToAll(e.target.checked)} /> Apply to all newly spawned agents <span className="text-xs text-muted-foreground">(optional)</span></label>
      <FieldLabel optional>{kind === "skill" ? "Skills" : "Extensions"}</FieldLabel><Textarea rows={7} value={itemsText} onChange={(e) => setItemsText(e.target.value)} placeholder={`Optional ${templateLabel} names, comma or newline separated`} />
      <FormMessage>Optional. Leave empty to create a template shell and add {field} later.</FormMessage>
      {kind === "skill" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered skills</div><div className="flex flex-wrap gap-1">{availableSkills.length ? availableSkills.map((skill) => <button key={skill.id || skill.ref || skill.name} title={skill.ref ? `${skill.ref}\n${skill.description || skill.path}` : (skill.description || skill.path)} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${skillTemplateItemValue(skill)}`).join("\n"))}>{skill.name}{skill.ref ? ` (${skill.scope})` : ""}</button>) : <span className="text-xs text-muted-foreground">No skills discovered.</span>}</div></div>}
      {kind === "extension" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered extensions</div><div className="flex flex-wrap gap-1">{availableExtensions.length ? availableExtensions.map((ext) => <button key={ext.name} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${ext.name}`).join("\n"))}>{ext.name}</button>) : <span className="text-xs text-muted-foreground">No extensions discovered.</span>}</div></div>}
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!!errors.length}>Save Template</Button></div>
    </div>
  </Dialog>;
}

function TemplateChips({ templates, selectedText, emptyText, onToggle }: { templates: TemplateInfo[]; selectedText: string; emptyText: string; onToggle: (name: string) => void }) {
  const selected = new Set(splitItems(selectedText));
  return <div className="space-y-2"><div className="text-xs text-muted-foreground">Click to assign/unassign existing templates.</div><div className="flex flex-wrap gap-1">{templates.length ? templates.map((template) => {
    const active = selected.has(template.name);
    return <button key={template.name} type="button" title={template.description} className={`rounded-full border px-2 py-1 text-xs transition ${active ? "border-primary bg-primary/15 text-primary" : "border-border text-muted-foreground hover:text-foreground"}`} onClick={() => onToggle(template.name)}>{active ? "✓ " : ""}{template.name}</button>;
  }) : <span className="text-xs text-muted-foreground">{emptyText}</span>}</div></div>;
}

function TypeEditorDialog({ open, typeDef, models, skillTemplates, extensionTemplates, onClose, onSaved }: { open: boolean; typeDef?: AgentTypeInfo; models: ModelInfo[]; skillTemplates: TemplateInfo[]; extensionTemplates: TemplateInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [model, setModel] = useState("");
  const [thinking, setThinking] = useState("");
  const [skillTemplatesText, setSkillTemplatesText] = useState("");
  const [extensionTemplatesText, setExtensionTemplatesText] = useState("");
  const [prompt, setPrompt] = useState("");
  const [serverError, setServerError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(typeDef?.name || "");
    setDescription(typeDef?.description || "");
    setModel(typeDef?.model || "");
    setThinking(typeDef?.thinking || "medium");
    setSkillTemplatesText((typeDef?.skillTemplates || []).join("\n"));
    setExtensionTemplatesText((typeDef?.extensionTemplates || []).join("\n"));
    setPrompt("");
    setServerError("");
  }, [open, typeDef]);
  const selectedModel = models.find((m) => m.id === model);
  const levels = selectedModel?.thinkingLevels || ["off", "minimal", "low", "medium", "high", "xhigh"];
  const errors = [
    !name.trim() ? "Name is required." : undefined,
    !description.trim() ? "Description is required." : undefined,
  ].filter(Boolean) as string[];
  const save = async () => {
    setServerError("");
    if (errors.length) return;
    const payload = { name: name.trim(), description: description.trim(), model: model || undefined, thinking: selectedModel?.thinking ? thinking : undefined, skillTemplates: splitItems(skillTemplatesText), extensionTemplates: splitItems(extensionTemplatesText), prompt: prompt.trim() || undefined };
    const res = await fetch("/api/agent-types", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) return setServerError("Failed to save: " + await responseErrorText(res));
    onSaved();
  };
  return <Dialog open={open} title={typeDef ? `Edit ${typeDef.name}` : "New Agent Type"} onOpenChange={onClose}>
    <div className="space-y-3">
      <FieldLabel required>Name</FieldLabel><Input value={name} onChange={(e) => setName(e.target.value)} readOnly={!!typeDef} aria-invalid={!name.trim()} className={!name.trim() ? "border-destructive/60" : undefined} />
      <FieldLabel required>Description</FieldLabel><Input value={description} onChange={(e) => setDescription(e.target.value)} aria-invalid={!description.trim()} className={!description.trim() ? "border-destructive/60" : undefined} />
      <FieldLabel optional>Model</FieldLabel><Select value={model} onChange={(e) => setModel(e.target.value)}><option value="">-- default --</option>{models.map((m) => <option key={m.id} value={m.id}>{m.provider ? `${m.provider}/${m.id}` : m.id}</option>)}</Select>
      {selectedModel?.thinking && <><FieldLabel optional>Thinking Level</FieldLabel><Select value={thinking} onChange={(e) => setThinking(e.target.value)}>{levels.map((level) => <option key={level} value={level}>{level}</option>)}</Select></>}
      <FieldLabel optional>Skill Templates</FieldLabel><Textarea rows={3} value={skillTemplatesText} onChange={(e) => setSkillTemplatesText(e.target.value)} placeholder={skillTemplates.map((template) => template.name).join(", ") || "common, frontend"} />
      <TemplateChips templates={skillTemplates} selectedText={skillTemplatesText} emptyText="No skill templates defined yet." onToggle={(name) => setSkillTemplatesText((prev) => toggleItemText(prev, name))} />
      <FieldLabel optional>Extension Templates</FieldLabel><Textarea rows={3} value={extensionTemplatesText} onChange={(e) => setExtensionTemplatesText(e.target.value)} placeholder={extensionTemplates.map((template) => template.name).join(", ") || "browser-tools"} />
      <TemplateChips templates={extensionTemplates} selectedText={extensionTemplatesText} emptyText="No extension templates defined yet." onToggle={(name) => setExtensionTemplatesText((prev) => toggleItemText(prev, name))} />
      <FieldLabel optional>Prompt / Instructions</FieldLabel><Textarea rows={7} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!!errors.length}>Save Type</Button></div>
    </div>
  </Dialog>;
}

function formatInspectData(data: any): string {
  const lines: string[] = [`status: ${data.status}`, `worktree: ${data.worktree}`];
  if (data.runtimeTools) {
    lines.push(`runtime tools reported: ${new Date(data.runtimeTools.reportedAt).toLocaleString()}`);
    lines.push(`active tools: ${data.runtimeTools.active.map((tool: any) => tool.name).join(", ") || "(none)"}`);
    lines.push(`all tools: ${data.runtimeTools.all.map((tool: any) => tool.name).join(", ") || "(none)"}`);
    for (const conflict of data.runtimeTools.conflicts || []) {
      lines.push(`tool conflict: ${conflict.name} registered ${conflict.count} times${conflict.sources?.length ? ` by ${conflict.sources.join(", ")}` : ""}`);
    }
  } else {
    lines.push("runtime tools: unknown");
  }
  lines.push("", "Recent events:");
  let textBuffer = "";
  let textStartTime = "";
  const flush = () => {
    const text = textBuffer.trim();
    if (text) lines.push(`${textStartTime} assistant_text ${JSON.stringify(text.length > 500 ? text.slice(0, 500) + "…" : text)}`);
    textBuffer = "";
    textStartTime = "";
  };
  for (const item of (data.events || []).slice(-180)) {
    const time = new Date(item.ts).toLocaleTimeString();
    const ev = item.event || {};
    if (ev.type === "message_update" && ev.assistantMessageEvent?.type === "text_delta") {
      if (!textStartTime) textStartTime = time;
      textBuffer += ev.assistantMessageEvent.delta || "";
      continue;
    }
    if (ev.type === "message_update") continue;
    flush();
    if (ev.type === "tool_execution_start") lines.push(`${time} tool_start ${ev.toolName || ""} ${JSON.stringify(ev.args || {}).slice(0, 220)}`);
    else if (ev.type === "tool_execution_end") lines.push(`${time} tool_end ${ev.toolName || ""}`);
    else if (["agent_start", "turn_start", "message_start", "message_end", "turn_end", "agent_end"].includes(ev.type)) lines.push(`${time} ${ev.type}`);
    else lines.push(`${time} ${ev.type || item.type}`);
  }
  flush();
  lines.push("", "Accumulated assistant text:", data.accumulatedText || "(none)");
  return lines.join("\n");
}

createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
