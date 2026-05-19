import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { ExtensionInfo, ExtensionTemplateSmokeTestResult, SkillInfo } from "../../types.js";
import type { LogLine } from "../../shared/dashboard-types.js";
import type { TemplateInfo } from "../agent-types/AgentTypesPanel.js";
import { Badge } from "../../components/ui/badge.js";
import { Button } from "../../components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card.js";
import { Dialog } from "../../components/ui/dialog.js";
import { Input, Textarea } from "../../components/ui/input.js";
import { Select } from "../../components/ui/select.js";

type TemplateAudience = "spawned" | "orchestrator" | "all";
type TemplateAutoApply = "none" | "spawned" | "all";

function templateAudience(template: TemplateInfo): TemplateAudience {
  return template.audience || "spawned";
}

function templateAutoApply(template: TemplateInfo): TemplateAutoApply {
  if (template.autoApply) return template.autoApply;
  return template.applyToAll ? "spawned" : "none";
}

function audienceLabel(audience: TemplateAudience): string {
  if (audience === "orchestrator") return "orchestrator";
  if (audience === "all") return "spawned + orchestrator";
  return "spawned agents";
}

function autoApplyLabel(autoApply: TemplateAutoApply): string {
  if (autoApply === "all") return "auto: everywhere";
  if (autoApply === "spawned") return "auto: all spawned";
  return "manual";
}

function isSpawnedTemplate(template: TemplateInfo): boolean {
  const audience = templateAudience(template);
  return audience === "spawned" || audience === "all";
}

function skillTemplateItemValue(skill: SkillInfo): string {
  return skill.ref || skill.name;
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

function FieldLabel({ children, required, optional }: { children: ReactNode; required?: boolean; optional?: boolean }) {
  return <label className="block text-xs uppercase tracking-wide text-muted-foreground">{children} {required && <span className="text-destructive">*</span>}{optional && <span className="normal-case text-muted-foreground/70">(optional)</span>}</label>;
}

function FormMessage({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "error" | "success" }) {
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

export function TemplatesPanel({ kind, templates, onNew, onEdit, onDeleted, pushLog }: { kind: "skill" | "extension"; templates: TemplateInfo[]; onNew: () => void; onEdit: (template: TemplateInfo) => void; onDeleted: () => void; pushLog: (text: string, level?: LogLine["level"]) => void }) {
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
            <div className="min-w-0"><div className="flex flex-wrap items-center gap-2 text-sm font-semibold">{template.name}<Badge variant="outline">{audienceLabel(templateAudience(template))}</Badge><Badge variant={templateAutoApply(template) === "none" ? "outline" : "default"}>{autoApplyLabel(templateAutoApply(template))}</Badge>{!!template.validationErrors?.length && <Badge variant="destructive">invalid</Badge>}{result && <Badge variant={result.success ? "success" : "destructive"}>{result.success ? "smoke passed" : "smoke failed"}</Badge>}</div><div className="mt-1 line-clamp-3 text-xs text-muted-foreground">{template.description}</div></div>
            <div className="flex shrink-0 gap-2"><Button variant="secondary" className="px-2 py-1 text-xs" onClick={() => onEdit(template)}>Edit</Button>{kind === "extension" && <Button variant="secondary" className="px-2 py-1 text-xs" disabled={loading} onClick={() => smokeTest(template.name)}>{loading ? "Testing…" : "Smoke Test"}</Button>}<Button variant="destructive" className="px-2 py-1 text-xs" onClick={() => deleteTemplate(template.name)}>Delete</Button></div>
          </div>
          <div className="mt-3 flex flex-wrap gap-1">{template.items.length ? template.items.map((item) => <Badge key={item} variant="outline">{item}</Badge>) : <span className="text-xs text-muted-foreground">No items.</span>}</div>
          {!!template.validationErrors?.length && <div className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{template.validationErrors.join("; ")}</div>}
          {result && <div className="mt-3 space-y-2 rounded-md border border-border bg-background/60 p-2 text-xs">
            <div className="font-medium">Runtime diagnostics</div>
            {result.smokeAgent && <div className="text-muted-foreground">Agent: {result.smokeAgent.id} ({result.smokeAgent.definition}) · model: {result.smokeAgent.model || "default selection"}{result.smokeAgent.worktree ? ` · ${result.smokeAgent.worktree}` : ""}</div>}
            <ul className="space-y-1">{result.diagnostics.map((diagnostic, index) => <li key={index} className={diagnostic.level === "error" ? "text-destructive" : diagnostic.level === "warning" ? "text-amber-300" : "text-muted-foreground"}>{diagnostic.level}: {diagnostic.message}</li>)}</ul>
            {result.runtimeTools && <div className="text-muted-foreground">Tools: {result.runtimeTools.active.map((tool) => tool.name).join(", ") || "none reported"}</div>}
            {result.stderrTail && <details><summary className="cursor-pointer text-muted-foreground">stderr tail</summary><pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap rounded bg-muted p-2 text-muted-foreground">{result.stderrTail}</pre></details>}
          </div>}
        </div>;
      })}
    </div>}
  </CardContent></Card>;
}

export function TemplateEditorDialog({ open, kind, template, availableSkills, availableExtensions, onClose, onSaved }: { open: boolean; kind: "skill" | "extension"; template?: TemplateInfo; availableSkills: SkillInfo[]; availableExtensions: ExtensionInfo[]; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [audience, setAudience] = useState<TemplateAudience>("spawned");
  const [autoApply, setAutoApply] = useState<TemplateAutoApply>("none");
  const [itemsText, setItemsText] = useState("");
  const [serverError, setServerError] = useState("");
  useEffect(() => {
    if (!open) return;
    setName(template?.name || "");
    setDescription(template?.description || "");
    setAudience(kind === "skill" ? templateAudience(template || { name: "", description: "", items: [], source: "", filePath: "" }) : "spawned");
    setAutoApply(kind === "skill" ? templateAutoApply(template || { name: "", description: "", items: [], source: "", filePath: "" }) : (templateAutoApply(template || { name: "", description: "", items: [], source: "", filePath: "" }) === "all" ? "spawned" : templateAutoApply(template || { name: "", description: "", items: [], source: "", filePath: "" })));
    setItemsText((template?.items || []).join("\n"));
    setServerError("");
  }, [open, template, kind]);
  const field = kind === "skill" ? "skills" : "extensions";
  const savedName = template ? name.trim() : normalizeTemplateName(name);
  const templateLabel = kind === "skill" ? "skill" : "extension";
  const setAudienceSafe = (next: TemplateAudience) => {
    setAudience(next);
    if (next === "orchestrator" && autoApply === "spawned") setAutoApply("none");
    if (next !== "all" && autoApply === "all") setAutoApply(next === "spawned" ? "spawned" : "none");
  };
  const setAutoApplySafe = (next: TemplateAutoApply) => {
    if (kind === "extension" && next === "all") return setAutoApply("spawned");
    if (next === "all") setAudience("all");
    if (next === "spawned" && audience === "orchestrator") setAudience("all");
    setAutoApply(next);
  };
  const errors = [
    !savedName ? "Name is required." : undefined,
    !description.trim() ? "Description is required." : undefined,
    kind === "extension" && audience !== "spawned" ? "Extension templates are only available to spawned agents." : undefined,
    kind === "extension" && autoApply === "all" ? "Extension templates cannot auto-apply to the orchestrator." : undefined,
    autoApply === "spawned" && audience === "orchestrator" ? "Apply to all spawned agents requires spawned or both audience." : undefined,
    autoApply === "all" && audience !== "all" ? "Apply everywhere requires both audience." : undefined,
  ].filter(Boolean) as string[];
  const save = async () => {
    setServerError("");
    if (errors.length) return;
    const payload = { name: savedName, description: description.trim(), audience: kind === "skill" ? audience : "spawned", autoApply, [field]: splitItems(itemsText) };
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
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <FieldLabel optional>Available to</FieldLabel>
          {kind === "skill" ? <Select value={audience} onChange={(e) => setAudienceSafe(e.target.value as TemplateAudience)}><option value="spawned">Spawned agents</option><option value="orchestrator">Orchestrator</option><option value="all">Spawned agents + orchestrator</option></Select> : <div className="rounded-md border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">Spawned agents only</div>}
        </div>
        <div className="space-y-1">
          <FieldLabel optional>Automatic application</FieldLabel>
          <Select value={autoApply} onChange={(e) => setAutoApplySafe(e.target.value as TemplateAutoApply)}><option value="none">Specific/manual assignment only</option><option value="spawned">Apply to all spawned agents</option>{kind === "skill" && <option value="all">Apply everywhere, including orchestrator</option>}</Select>
        </div>
      </div>
      <FormMessage>{kind === "skill" ? "Audience controls where the template may be used; automatic application controls whether it is applied without explicit assignment." : "Extension templates are spawned-agent capabilities only."}</FormMessage>
      <FieldLabel optional>{kind === "skill" ? "Skills" : "Extensions"}</FieldLabel><Textarea rows={7} value={itemsText} onChange={(e) => setItemsText(e.target.value)} placeholder={`Optional ${templateLabel} names, comma or newline separated`} />
      <FormMessage>Optional. Leave empty to create a template shell and add {field} later.</FormMessage>
      {kind === "skill" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered skills</div><div className="flex flex-wrap gap-1">{availableSkills.length ? availableSkills.map((skill) => <button key={skill.id || skill.ref || skill.name} title={skill.ref ? `${skill.ref}\n${skill.description || skill.path}` : (skill.description || skill.path)} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${skillTemplateItemValue(skill)}`).join("\n"))}>{skill.name}{skill.ref ? ` (${skill.scope})` : ""}</button>) : <span className="text-xs text-muted-foreground">No skills discovered.</span>}</div></div>}
      {kind === "extension" && <div className="space-y-2"><div className="text-xs uppercase tracking-wide text-muted-foreground">Discovered extensions</div><div className="flex flex-wrap gap-1">{availableExtensions.length ? availableExtensions.map((ext) => <button key={ext.name} className="rounded-full border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => setItemsText((prev) => splitItems(`${prev}\n${ext.name}`).join("\n"))}>{ext.name}</button>) : <span className="text-xs text-muted-foreground">No extensions discovered.</span>}</div></div>}
      <ValidationSummary errors={errors} serverError={serverError} />
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} disabled={!!errors.length}>Save Template</Button></div>
    </div>
  </Dialog>;
}
