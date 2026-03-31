"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import {
  Layers, Rocket, Search, Play, Square, RotateCw, Trash2, Loader2,
  CheckCircle2, AlertCircle, ExternalLink, Plus, FileText, ChevronRight,
  Pencil, Save, X, Archive,
} from "lucide-react";

interface StackItem {
  id: string; name: string; description?: string; templateSlug?: string;
  compose: string; status: string; error?: string; containerNames: string[];
  serverId: string; createdAt: string;
}
interface Template {
  slug: string; name: string; description: string; icon: string;
  category: string; tags: string[]; website: string; compose: string;
}
interface ServerItem { id: string; name: string; host: string }

type Tab = "my-stacks" | "marketplace" | "create";

export default function StacksPage() {
  const [tab, setTab] = useState<Tab>("my-stacks");
  const [servers, setServers] = useState<ServerItem[]>([]);

  useEffect(() => { api<ServerItem[]>("/servers").then(setServers).catch(() => {}); }, []);

  const tabs = [
    { key: "my-stacks" as Tab, label: "My Stacks", icon: Layers },
    { key: "marketplace" as Tab, label: "Marketplace", icon: Rocket },
    { key: "create" as Tab, label: "Create Stack", icon: Plus },
  ];

  // State to pre-fill create tab from marketplace
  const [prefill, setPrefill] = useState<Template | null>(null);

  const deployTemplate = (t: Template) => {
    setPrefill(t);
    setTab("create");
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">Stacks</h1>
        <p className="text-sm text-muted-foreground mt-1">Deploy complete application stacks from the marketplace or create your own</p>
      </div>

      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
            }`}>
            <t.icon className="h-4 w-4" />{t.label}
          </button>
        ))}
      </div>

      {tab === "my-stacks" && <MyStacksTab servers={servers} />}
      {tab === "marketplace" && <MarketplaceTab onDeploy={deployTemplate} />}
      {tab === "create" && <CreateTab servers={servers} prefill={prefill} onCreated={() => { setPrefill(null); setTab("my-stacks"); }} />}
    </div>
  );
}

// ─── My Stacks ──────────────────────────────────────────────

function MyStacksTab({ servers }: { servers: ServerItem[] }) {
  const [stacks, setStacks] = useState<StackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCompose, setEditCompose] = useState("");
  const [logsId, setLogsId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");
  const [logsLoading, setLogsLoading] = useState(false);

  const load = () => api<StackItem[]>("/stacks").then(setStacks).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); const iv = setInterval(load, 8000); return () => clearInterval(iv); }, []);

  const doAction = async (id: string, action: string) => {
    setActing(`${id}-${action}`);
    try {
      if (action === "delete") {
        if (!confirm("Delete this stack? Containers will be stopped and removed (volumes are kept).")) return;
        await api(`/stacks/${id}`, { method: "DELETE" });
      } else {
        await api(`/stacks/${id}/${action}`, { method: "POST" });
      }
      setToast({ type: "success", message: `${action} — success` });
      setTimeout(load, 1500);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setActing(null);
    setTimeout(() => setToast(null), 5000);
  };

  const viewLogs = async (id: string) => {
    if (logsId === id) { setLogsId(null); return; }
    setLogsId(id);
    setLogs("Loading...");
    setLogsLoading(true);
    try {
      const d = await api(`/stacks/${id}/logs?tail=200`);
      setLogs(d.logs || "No logs available");
    } catch (err: any) { setLogs(`Error: ${err.message}`); }
    setLogsLoading(false);
  };

  const refreshLogs = async () => {
    if (!logsId) return;
    setLogsLoading(true);
    try {
      const d = await api(`/stacks/${logsId}/logs?tail=200`);
      setLogs(d.logs || "No logs available");
    } catch (err: any) { setLogs(`Error: ${err.message}`); }
    setLogsLoading(false);
  };

  const saveEdit = async (id: string) => {
    setActing(`${id}-save`);
    try {
      await api(`/stacks/${id}`, { method: "PUT", body: { compose: editCompose } });
      setToast({ type: "success", message: "Stack updated and redeploying..." });
      setEditId(null);
      setTimeout(load, 2000);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setActing(null);
    setTimeout(() => setToast(null), 5000);
  };

  const serverName = (sid: string) => servers.find(s => s.id === sid)?.name || sid.slice(0, 8);

  const statusColor = (s: string) => {
    if (s === "running") return "success" as const;
    if (s === "error") return "destructive" as const;
    if (s === "deploying") return "warning" as const;
    return "secondary" as const;
  };

  return (
    <>
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {!loading && stacks.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Layers className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2">No stacks deployed yet.</p>
            <p className="text-xs">Go to <strong>Marketplace</strong> to deploy a pre-configured app, or <strong>Create Stack</strong> for custom compose.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {stacks.map(s => {
          const busy = acting?.startsWith(s.id);
          const isEditing = editId === s.id;

          return (
            <Card key={s.id} className={`border-border/50 ${isEditing ? "border-primary/20" : ""}`}>
              <CardContent className="p-0">
                {/* Header */}
                <div className="flex items-center justify-between p-4">
                  <div className="flex items-center gap-4 min-w-0">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/5 border border-border text-lg">
                      {s.templateSlug ? "📦" : "🔧"}
                    </div>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">{s.name}</span>
                        <Badge variant={statusColor(s.status)} className="text-[10px]">{s.status}</Badge>
                        {s.templateSlug && <Badge variant="secondary" className="text-[10px]">{s.templateSlug}</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {serverName(s.serverId)} — {s.containerNames.length} service(s): {s.containerNames.join(", ")}
                      </div>
                      {s.error && <p className="text-xs text-red-400 mt-1">{s.error}</p>}
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {s.status === "running" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy}
                        onClick={() => doAction(s.id, "stop")} title="Stop"><Square className="h-3.5 w-3.5" /></Button>
                    )}
                    {(s.status === "stopped" || s.status === "error") && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400" disabled={busy}
                        onClick={() => doAction(s.id, "start")} title="Start"><Play className="h-3.5 w-3.5" /></Button>
                    )}
                    {s.status === "deploying" && <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => viewLogs(s.id)} title="Logs">
                      <FileText className={`h-3.5 w-3.5 ${logsId === s.id ? "text-primary" : ""}`} />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy}
                      onClick={() => { setEditId(isEditing ? null : s.id); setEditCompose(s.compose); setLogsId(null); }} title="Edit Compose">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={busy}
                      onClick={() => doAction(s.id, "delete")} title="Delete"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>

                {/* Logs panel */}
                {logsId === s.id && (
                  <div className="border-t border-border p-4 bg-[#0c0c0c]">
                    <div className="flex items-center justify-between mb-2">
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-2">
                        <FileText className="h-3 w-3" /> Stack Logs
                      </label>
                      <div className="flex gap-2">
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={refreshLogs} disabled={logsLoading}>
                          {logsLoading ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RotateCw className="h-3 w-3 mr-1" />}
                          Refresh
                        </Button>
                        <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setLogsId(null)}>Close</Button>
                      </div>
                    </div>
                    <pre className="bg-black rounded-lg p-4 text-xs font-mono text-green-400 overflow-auto max-h-[400px] whitespace-pre-wrap">
                      {logs}
                    </pre>
                  </div>
                )}

                {/* Edit compose */}
                {isEditing && (
                  <div className="border-t border-border p-4 bg-[#0c0c0c]">
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">docker-compose.yml</label>
                    <textarea
                      className="mt-1 w-full rounded-md border border-border bg-black px-4 py-3 text-xs font-mono text-green-400 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                      style={{ minHeight: "300px" }}
                      value={editCompose}
                      onChange={e => setEditCompose(e.target.value)}
                      spellCheck={false}
                    />
                    <div className="flex gap-2 mt-3">
                      <Button className="flex-1" onClick={() => saveEdit(s.id)} disabled={busy}>
                        {busy ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                        Save & Redeploy
                      </Button>
                      <Button variant="outline" onClick={() => setEditId(null)}>Cancel</Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </>
  );
}

// ─── Marketplace ────────────────────────────────────────────

function MarketplaceTab({ onDeploy }: { onDeploy: (t: Template) => void }) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [categories, setCategories] = useState<any[]>([]);
  const [activeCategory, setActiveCategory] = useState("");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<any[]>("/stacks/categories").then(setCategories).catch(() => {});
    loadTemplates();
  }, []);

  const loadTemplates = (category = "", q = "") => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (q) params.set("q", q);
    api<Template[]>(`/stacks/templates?${params}`).then(setTemplates).catch(() => {}).finally(() => setLoading(false));
  };

  const selectCategory = (cat: string) => {
    setActiveCategory(cat);
    setSearch("");
    loadTemplates(cat);
  };

  const doSearch = () => {
    setActiveCategory("");
    loadTemplates("", search);
  };

  return (
    <div>
      {/* Search + Category filter */}
      <div className="flex gap-2 mb-6">
        <select
          className="rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring shrink-0 w-40"
          value={activeCategory}
          onChange={e => selectCategory(e.target.value)}
        >
          {categories.map((c: any) => (
            <option key={c.key} value={c.key}>{c.icon} {c.label}</option>
          ))}
        </select>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search apps..." value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === "Enter" && doSearch()} />
        </div>
        <Button onClick={doSearch} disabled={loading}>Search</Button>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin" /></div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {templates.map(t => (
            <Card key={t.slug} className="border-border/50 hover:border-primary/20 transition-colors">
              <CardContent className="p-4 flex flex-col h-full">
                <div className="flex items-start gap-3 mb-2">
                  <span className="text-2xl">{t.icon}</span>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{t.name}</div>
                    <Badge variant="secondary" className="text-[9px] mt-0.5">{t.category}</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground mb-3 flex-1 line-clamp-2">{t.description}</p>
                <div className="flex flex-wrap gap-1 mb-3">
                  {t.tags.slice(0, 4).map(tag => (
                    <span key={tag} className="text-[9px] px-1.5 py-0.5 rounded bg-secondary font-mono">{tag}</span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => onDeploy(t)}>
                    <Rocket className="h-3 w-3 mr-1.5" /> Deploy
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => window.open(t.website, "_blank")}>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Create Stack ───────────────────────────────────────────

function CreateTab({ servers, prefill, onCreated }: {
  servers: ServerItem[]; prefill: Template | null; onCreated: () => void;
}) {
  const [name, setName] = useState(prefill?.name || "");
  const [serverId, setServerId] = useState("");
  const [compose, setCompose] = useState(prefill?.compose || "");
  const [deploying, setDeploying] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    if (prefill) {
      setName(prefill.name);
      setCompose(prefill.compose);
    }
  }, [prefill]);

  const deploy = async () => {
    setDeploying(true);
    try {
      await api("/stacks/deploy", {
        method: "POST",
        body: { name, serverId, compose, templateSlug: prefill?.slug, description: prefill?.description },
      });
      setToast({ type: "success", message: `"${name}" is deploying...` });
      setTimeout(onCreated, 2000);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setDeploying(false);
  };

  return (
    <div className="max-w-3xl">
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {prefill && (
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3">
          <span className="text-2xl">{prefill.icon}</span>
          <div>
            <div className="font-medium text-sm text-primary">{prefill.name}</div>
            <div className="text-xs text-muted-foreground">{prefill.description}</div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Stack Name</label>
            <Input className="mt-1" value={name} onChange={e => setName(e.target.value)}
              placeholder="my-stack" />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server</label>
            <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={serverId} onChange={e => setServerId(e.target.value)}>
              <option value="">Select server...</option>
              {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">docker-compose.yml</label>
          <textarea
            className="mt-1 w-full rounded-md border border-border bg-black px-4 py-3 text-xs font-mono text-green-400 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
            style={{ minHeight: "400px" }}
            value={compose}
            onChange={e => setCompose(e.target.value)}
            placeholder="services:&#10;  app:&#10;    image: myapp:latest&#10;    ports:&#10;      - '3000:3000'"
            spellCheck={false}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {prefill
              ? "Pre-configured from marketplace. Edit env vars, ports or volumes as needed before deploying."
              : "Write your docker-compose.yml from scratch. All services will be deployed together as a stack."
            }
          </p>
        </div>

        <Button className="w-full" onClick={deploy} disabled={deploying || !name || !serverId || !compose.trim()}>
          {deploying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
          {deploying ? "Deploying Stack..." : "Deploy Stack"}
        </Button>
      </div>
    </div>
  );
}

// ─── Toast ──────────────────────────────────────────────────

function Toast({ toast, onClose }: { toast: { type: "success" | "error"; message: string }; onClose: () => void }) {
  return (
    <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
      toast.type === "success" ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"
    }`}>
      {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">&times;</button>
    </div>
  );
}
