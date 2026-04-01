"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import {
  Archive, Download, Upload, Trash2, Plus, Loader2, CheckCircle2, AlertCircle,
  Clock, Server, Container, CalendarClock, Power, HardDrive, FileText, Network,
  ChevronRight, ChevronDown, Eye, Copy, Shield, Layers, Database, RefreshCw,
  Globe, Box, X,
} from "lucide-react";

interface BackupItem {
  id: string; name: string; type: string; status: string;
  containerIds: string[]; serverId: string; serverName: string;
  fileName?: string; fileSizeMb?: number; error?: string;
  metadata?: string; createdAt: string; completedAt?: string;
}

interface ScheduleItem {
  id: string; name: string; cron: string; containerIds: string[];
  serverId: string; enabled: boolean; keepLast: number; lastRunAt?: string;
}

interface ServerItem { id: string; name: string; host: string; hasDocker: boolean }
interface ContainerItem { id: string; containerId: string; name: string; server: { id: string; name: string } }

type Tab = "backups" | "schedules";

export default function BackupsPage() {
  const [tab, setTab] = useState<Tab>("backups");
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [containers, setContainers] = useState<ContainerItem[]>([]);

  useEffect(() => {
    api<ServerItem[]>("/servers").then(s => setServers(s.filter((x: any) => x.hasDocker))).catch(() => {});
    api<ContainerItem[]>("/containers").then(setContainers).catch(() => {});
  }, []);

  const tabs = [
    { key: "backups" as Tab, label: "Snapshots", icon: Shield },
    { key: "schedules" as Tab, label: "Schedules", icon: CalendarClock },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backups & Snapshots</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Full container snapshots — compose, env vars, volumes, networks — ready to restore anywhere
          </p>
        </div>
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

      {tab === "backups" && <BackupsTab servers={servers} containers={containers} />}
      {tab === "schedules" && <SchedulesTab servers={servers} containers={containers} />}
    </div>
  );
}

// ─── Backups Tab ────────────────────────────────────────────

function BackupsTab({ servers, containers }: { servers: ServerItem[]; containers: ContainerItem[] }) {
  const [backups, setBackups] = useState<BackupItem[]>([]);
  const [exportOpen, setExportOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState<string | null>(null);
  const [composePreview, setComposePreview] = useState<{ containers: Record<string, string>; stack: string } | null>(null);
  const [composeTab, setComposeTab] = useState<"stack" | string>("stack");
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [restoreMode, setRestoreMode] = useState<"stack" | "individual">("stack");

  const [exportForm, setExportForm] = useState({ name: "", serverId: "", containerNames: [] as string[], type: "single" as "single" | "stack" });
  const [importForm, setImportForm] = useState({ backupId: "", targetServerId: "" });

  const load = () => api<BackupItem[]>("/backups").then(setBackups).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      await api("/backups/export", { method: "POST", body: exportForm });
      setToast({ type: "success", message: "Snapshot started — capturing compose, env vars, volumes..." });
      setExportOpen(false);
      setExportForm({ name: "", serverId: "", containerNames: [], type: "single" });
      load();
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setExporting(false);
    setTimeout(() => setToast(null), 5000);
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const data = await api("/backups/import", { method: "POST", body: { ...importForm, mode: restoreMode } });
      setToast({ type: "success", message: data.message });
      setImportOpen(false);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setImporting(false);
    setTimeout(() => setToast(null), 8000);
  };

  const doDelete = async (id: string) => {
    if (!confirm("Delete this snapshot permanently?")) return;
    await api(`/backups/${id}`, { method: "DELETE" });
    load();
  };

  const doDownload = (id: string) => {
    const token = localStorage.getItem("obb_token");
    window.open(`/api/backups/download/${id}?token=${token}`, "_blank");
  };

  const openDetail = async (id: string) => {
    setDetailOpen(id);
    setComposePreview(null);
    setComposeTab("stack");
    try {
      const data = await api(`/backups/${id}/compose`);
      setComposePreview(data);
    } catch { /* ignore - old backup without compose */ }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setToast({ type: "success", message: "Copied to clipboard" });
    setTimeout(() => setToast(null), 2000);
  };

  const serverContainers = (sid: string) => containers.filter(c => c.server.id === sid);

  const toggleContainer = (name: string) => {
    setExportForm(f => ({
      ...f,
      containerNames: f.containerNames.includes(name)
        ? f.containerNames.filter(n => n !== name)
        : [...f.containerNames, name],
      type: f.containerNames.length >= 1 ? "stack" : "single",
    }));
  };

  const statusBadge = (s: string) => {
    if (s === "completed") return "success" as const;
    if (s === "failed") return "destructive" as const;
    if (s === "running") return "warning" as const;
    return "secondary" as const;
  };

  const fmtSize = (mb?: number | null) => {
    if (!mb) return "--";
    if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
    return mb.toFixed(1) + " MB";
  };

  const fmtDate = (d: string) => {
    const date = new Date(d);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    if (diffMin < 1) return "just now";
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffH = Math.floor(diffMin / 60);
    if (diffH < 24) return `${diffH}h ago`;
    const diffD = Math.floor(diffH / 24);
    if (diffD < 7) return `${diffD}d ago`;
    return date.toLocaleDateString();
  };

  const getManifest = (b: BackupItem) => {
    if (!b.metadata) return null;
    try { return JSON.parse(b.metadata); } catch { return null; }
  };

  const getStats = (manifest: any) => {
    if (!manifest) return { containers: 0, volumes: 0, envVars: 0, networks: 0, hasCompose: false };
    const containers = manifest.containers?.length || 0;
    const volumes = manifest.containers?.reduce((a: number, c: any) => a + (c.volumes?.length || 0), 0) || 0;
    const envVars = manifest.containers?.reduce((a: number, c: any) => a + (c.env?.length || 0), 0) || 0;
    const networks = manifest.networks?.length || 0;
    const hasCompose = manifest.containers?.some((c: any) => c.originalCompose || c.generatedCompose) || false;
    return { containers, volumes, envVars, networks, hasCompose };
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{backups.length} snapshot(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Restore
          </Button>
          <Button onClick={() => setExportOpen(true)}>
            <Shield className="h-4 w-4 mr-2" /> New Snapshot
          </Button>
        </div>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {!loading && backups.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Shield className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2 font-medium">No snapshots yet</p>
            <p className="text-xs mb-4">Create a snapshot to capture the full state of your containers — compose files, env vars, volumes, and networks — all in a single portable .opsbigbro file.</p>
            <Button size="sm" onClick={() => setExportOpen(true)}>
              <Shield className="h-3.5 w-3.5 mr-2" /> Create First Snapshot
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {backups.map(b => {
          const manifest = getManifest(b);
          const stats = getStats(manifest);
          const isOpen = detailOpen === b.id;

          return (
            <Card key={b.id} className={`border-border/50 transition-colors ${isOpen ? "border-primary/20" : ""}`}>
              <CardContent className="p-0">
                {/* Header */}
                <div className="flex items-center justify-between p-4">
                  <button className="flex items-center gap-4 min-w-0 text-left" onClick={() => isOpen ? setDetailOpen(null) : openDetail(b.id)}>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <Shield className={`h-5 w-5 shrink-0 ${b.status === "completed" ? "text-primary" : b.status === "failed" ? "text-red-400" : "text-yellow-400"}`} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm truncate">{b.name}</span>
                        <Badge variant={statusBadge(b.status)} className="text-[10px]">{b.status}</Badge>
                        <Badge variant="secondary" className="text-[10px]">v2</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
                        <span className="flex items-center gap-1"><Server className="h-3 w-3" />{b.serverName}</span>
                        <span className="flex items-center gap-1"><Container className="h-3 w-3" />{stats.containers}</span>
                        <span className="flex items-center gap-1"><Database className="h-3 w-3" />{stats.volumes} vol</span>
                        <span className="flex items-center gap-1"><FileText className="h-3 w-3" />{stats.envVars} env</span>
                        {stats.networks > 0 && <span className="flex items-center gap-1"><Network className="h-3 w-3" />{stats.networks} net</span>}
                        {b.fileSizeMb && <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{fmtSize(b.fileSizeMb)}</span>}
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{fmtDate(b.createdAt)}</span>
                      </div>
                      {b.error && <p className="text-xs text-red-400 mt-1">{b.error}</p>}
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {b.status === "completed" && (
                      <>
                        <Button size="sm" variant="outline" onClick={() => doDownload(b.id)} title="Download .opsbigbro">
                          <Download className="h-3.5 w-3.5 mr-1" /> Download
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => { setImportForm({ backupId: b.id, targetServerId: "" }); setImportOpen(true); }}>
                          <Upload className="h-3.5 w-3.5 mr-1" /> Restore
                        </Button>
                      </>
                    )}
                    {b.status === "running" && <Loader2 className="h-4 w-4 animate-spin text-yellow-400" />}
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => doDelete(b.id)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Expanded detail view */}
                {isOpen && b.status === "completed" && manifest && (
                  <div className="border-t border-border p-4 bg-[#0c0c0c] space-y-4">
                    {/* Stats bar */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <StatCard icon={Container} label="Containers" value={stats.containers} color="text-primary" />
                      <StatCard icon={Database} label="Volumes" value={`${stats.volumes} (${fmtSize(b.fileSizeMb)})`} color="text-blue-400" />
                      <StatCard icon={FileText} label="Env Vars" value={stats.envVars} color="text-yellow-400" />
                      <StatCard icon={Network} label="Networks" value={stats.networks} color="text-purple-400" />
                    </div>

                    {/* Containers breakdown */}
                    <div>
                      <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Container Snapshots</label>
                      <div className="space-y-2">
                        {(manifest.containers || []).map((c: any, ci: number) => (
                          <ContainerSnapshotCard key={ci} container={c} />
                        ))}
                      </div>
                    </div>

                    {/* Compose preview */}
                    {composePreview && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Docker Compose Files</label>
                        <div className="flex gap-1 mb-2 flex-wrap">
                          <button onClick={() => setComposeTab("stack")}
                            className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                              composeTab === "stack" ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"
                            }`}>
                            <Layers className="h-3 w-3 inline mr-1" />Stack (all-in-one)
                          </button>
                          {Object.keys(composePreview.containers).map(name => (
                            <button key={name} onClick={() => setComposeTab(name)}
                              className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${
                                composeTab === name ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"
                              }`}>
                              <Box className="h-3 w-3 inline mr-1" />{name}
                            </button>
                          ))}
                        </div>
                        <div className="relative">
                          <pre className="rounded-lg border border-border bg-black px-4 py-3 text-xs font-mono text-green-400 max-h-80 overflow-auto whitespace-pre">
                            {composeTab === "stack" ? composePreview.stack : composePreview.containers[composeTab] || ""}
                          </pre>
                          <Button size="sm" variant="ghost" className="absolute top-2 right-2 h-7 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => copyToClipboard(composeTab === "stack" ? composePreview.stack : composePreview.containers[composeTab] || "")}>
                            <Copy className="h-3 w-3 mr-1" /> Copy
                          </Button>
                        </div>
                        <p className="text-[10px] text-muted-foreground mt-1">
                          These compose files are embedded in the .opsbigbro archive — ready to deploy with <code className="text-primary/70">docker compose up -d</code>
                        </p>
                      </div>
                    )}

                    {/* Networks */}
                    {(manifest.networks || []).length > 0 && (
                      <div>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Networks</label>
                        <div className="flex gap-1.5 flex-wrap">
                          {manifest.networks.map((n: string, i: number) => (
                            <span key={i} className="px-2 py-1 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 text-xs font-mono flex items-center gap-1">
                              <Network className="h-3 w-3" />{n}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Metadata */}
                    <div className="text-[10px] text-muted-foreground flex items-center gap-4 pt-2 border-t border-border/50">
                      <span>Created: {new Date(b.createdAt).toLocaleString()}</span>
                      {b.completedAt && <span>Completed: {new Date(b.completedAt).toLocaleString()}</span>}
                      <span>Format: .opsbigbro v2.0</span>
                      <span>Source: {manifest.source?.server} ({manifest.source?.host})</span>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* ─── Export dialog ─── */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" /> Create Snapshot
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-xs text-primary/80">
              A snapshot captures <strong>everything</strong> — docker-compose.yml, environment variables, volume data (databases, uploads, configs), networks, and restart policies. The result is a single .opsbigbro file you can restore on any server.
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Snapshot Name</label>
              <Input className="mt-1" placeholder="e.g. prod-backup-march" value={exportForm.name}
                onChange={e => setExportForm({ ...exportForm, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Source Server</label>
              <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={exportForm.serverId} onChange={e => setExportForm({ ...exportForm, serverId: e.target.value, containerNames: [] })}>
                <option value="">Select server...</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {exportForm.serverId && (
              <div>
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Containers
                  </label>
                  {serverContainers(exportForm.serverId).length > 0 && (
                    <button className="text-[10px] text-primary hover:underline" onClick={() => {
                      const all = serverContainers(exportForm.serverId).map(c => c.name);
                      setExportForm(f => ({ ...f, containerNames: f.containerNames.length === all.length ? [] : all, type: all.length > 1 ? "stack" : "single" }));
                    }}>
                      {exportForm.containerNames.length === serverContainers(exportForm.serverId).length ? "Deselect all" : "Select all"}
                    </button>
                  )}
                </div>
                <div className="mt-2 space-y-1 max-h-48 overflow-y-auto">
                  {serverContainers(exportForm.serverId).length === 0 && (
                    <p className="text-xs text-muted-foreground">No containers found. Run a Docker scan first.</p>
                  )}
                  {serverContainers(exportForm.serverId).map(c => (
                    <button key={c.id} onClick={() => toggleContainer(c.name)}
                      className={`w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors ${
                        exportForm.containerNames.includes(c.name)
                          ? "bg-primary/10 text-primary border border-primary/20"
                          : "bg-secondary text-muted-foreground hover:text-foreground border border-transparent"
                      }`}>
                      <Container className="h-3.5 w-3.5" />
                      <span className="font-mono">{c.name}</span>
                      {exportForm.containerNames.includes(c.name) && <CheckCircle2 className="h-3.5 w-3.5 ml-auto" />}
                    </button>
                  ))}
                </div>
                {exportForm.containerNames.length > 1 && (
                  <p className="text-xs text-primary mt-2 flex items-center gap-1">
                    <Layers className="h-3 w-3" />
                    Stack snapshot — {exportForm.containerNames.length} containers will be captured together with a combined compose
                  </p>
                )}
              </div>
            )}

            {/* What will be captured */}
            {exportForm.containerNames.length > 0 && (
              <div className="rounded-lg border border-border bg-card/50 p-3">
                <p className="text-xs font-medium text-muted-foreground mb-2">This snapshot will capture:</p>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <span className="flex items-center gap-1.5 text-primary"><FileText className="h-3 w-3" /> docker-compose.yml</span>
                  <span className="flex items-center gap-1.5 text-yellow-400"><FileText className="h-3 w-3" /> Environment vars</span>
                  <span className="flex items-center gap-1.5 text-blue-400"><Database className="h-3 w-3" /> Volume data</span>
                  <span className="flex items-center gap-1.5 text-purple-400"><Network className="h-3 w-3" /> Networks</span>
                  <span className="flex items-center gap-1.5 text-green-400"><RefreshCw className="h-3 w-3" /> Restart policies</span>
                  <span className="flex items-center gap-1.5 text-orange-400"><Layers className="h-3 w-3" /> Port mappings</span>
                </div>
              </div>
            )}

            <Button className="w-full" onClick={doExport}
              disabled={exporting || !exportForm.name || !exportForm.serverId || exportForm.containerNames.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Shield className="h-4 w-4 mr-2" />}
              {exporting ? "Creating Snapshot..." : `Snapshot ${exportForm.containerNames.length} Container(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ─── Import/Restore dialog ─── */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5 text-primary" /> Restore Snapshot
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Select backup */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Snapshot</label>
              <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={importForm.backupId} onChange={e => setImportForm({ ...importForm, backupId: e.target.value })}>
                <option value="">Select snapshot...</option>
                {backups.filter(b => b.status === "completed").map(b => {
                  const s = getStats(getManifest(b));
                  return (
                    <option key={b.id} value={b.id}>
                      {b.name} — {s.containers} container(s), {s.volumes} vol, {fmtSize(b.fileSizeMb)}
                    </option>
                  );
                })}
              </select>
            </div>

            {/* Show backup contents */}
            {importForm.backupId && (() => {
              const backup = backups.find(b => b.id === importForm.backupId);
              if (!backup?.metadata) return null;
              let manifest: any;
              try { manifest = JSON.parse(backup.metadata); } catch { return null; }
              const stats = getStats(manifest);

              return (
                <>
                  {/* Snapshot overview card */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Shield className="h-6 w-6 text-primary" />
                      <div>
                        <div className="font-medium text-sm">{backup.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtSize(backup.fileSizeMb)} — {fmtDate(backup.createdAt)} — from {backup.serverName}
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                      <StatCard icon={Container} label="Containers" value={stats.containers} color="text-primary" />
                      <StatCard icon={Database} label="Volumes" value={stats.volumes} color="text-blue-400" />
                      <StatCard icon={FileText} label="Env Vars" value={stats.envVars} color="text-yellow-400" />
                      <StatCard icon={Network} label="Networks" value={stats.networks} color="text-purple-400" />
                    </div>
                  </div>

                  {/* Container details */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">What will be restored</label>
                    <div className="space-y-2">
                      {(manifest.containers || []).map((c: any, ci: number) => (
                        <ContainerSnapshotCard key={ci} container={c} />
                      ))}
                    </div>
                  </div>

                  {/* Restore mode */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Restore Mode</label>
                    <div className="flex gap-2">
                      <button onClick={() => setRestoreMode("stack")}
                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm border transition-colors ${
                          restoreMode === "stack" ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"
                        }`}>
                        <Layers className="h-4 w-4 inline mr-2" />
                        <span className="font-medium">Stack</span>
                        <p className="text-[10px] mt-0.5 opacity-70">Deploy all containers via a single docker-compose.yml</p>
                      </button>
                      <button onClick={() => setRestoreMode("individual")}
                        className={`flex-1 px-3 py-2.5 rounded-lg text-sm border transition-colors ${
                          restoreMode === "individual" ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"
                        }`}>
                        <Box className="h-4 w-4 inline mr-2" />
                        <span className="font-medium">Individual</span>
                        <p className="text-[10px] mt-0.5 opacity-70">Each container gets its own compose file</p>
                      </button>
                    </div>
                  </div>

                  {/* Target server */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Restore to Server</label>
                    <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={importForm.targetServerId} onChange={e => setImportForm({ ...importForm, targetServerId: e.target.value })}>
                      <option value="">Select server...</option>
                      {servers.map(s => (
                        <option key={s.id} value={s.id}>
                          {s.name} ({s.host}) {s.id === backup.serverId ? "(same server)" : ""}
                        </option>
                      ))}
                    </select>
                    {importForm.targetServerId && importForm.targetServerId !== backup.serverId && (
                      <p className="text-xs text-yellow-400 mt-1 flex items-center gap-1">
                        <Globe className="h-3 w-3" /> Cross-server restore — the backup will be streamed to the target server
                      </p>
                    )}
                  </div>

                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-xs text-primary/80">
                    <strong>Full snapshot restore:</strong> Containers will be deployed via <code>docker compose up -d</code> using the exact compose files captured during backup.
                    Volume data (databases, uploads, configs) will be restored from tar archives.
                    Networks will be recreated. Existing containers with the same names will be replaced.
                  </div>
                </>
              );
            })()}

            <Button className="w-full" onClick={doImport} disabled={importing || !importForm.backupId || !importForm.targetServerId}>
              {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {importing ? "Restoring Snapshot..." : "Restore Full Snapshot"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Container Snapshot Card ────────────────────────────────

function ContainerSnapshotCard({ container: c }: { container: any }) {
  const [expanded, setExpanded] = useState(false);
  const filteredEnv = (c.env || []).filter((e: string) =>
    !e.startsWith("PATH=") && !e.startsWith("HOME=") && !e.startsWith("HOSTNAME=") &&
    !e.startsWith("GOPATH=") && !e.startsWith("JAVA_HOME=") && !e.startsWith("LANG=") &&
    !e.startsWith("GPG_KEY=") && !e.startsWith("PYTHON_") && !e.startsWith("GOLANG_")
  );

  return (
    <div className="rounded-lg border border-border bg-[#111] overflow-hidden">
      <button className="w-full text-left px-3 py-2.5 flex items-center gap-3 hover:bg-card/50 transition-colors"
        onClick={() => setExpanded(!expanded)}>
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        <Container className="h-4 w-4 text-primary" />
        <span className="font-mono text-sm font-medium">{c.name}</span>
        <span className="text-[10px] text-muted-foreground font-mono">{c.image}</span>
        <div className="ml-auto flex items-center gap-2">
          {(c.volumes || []).length > 0 && <Badge variant="secondary" className="text-[10px]"><Database className="h-2.5 w-2.5 mr-0.5" />{c.volumes.length} vol</Badge>}
          {Object.keys(c.ports || {}).length > 0 && <Badge variant="secondary" className="text-[10px]">{Object.keys(c.ports).length} port(s)</Badge>}
          {filteredEnv.length > 0 && <Badge variant="secondary" className="text-[10px]">{filteredEnv.length} env</Badge>}
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border px-3 py-2.5 space-y-2">
          {/* Image + restart */}
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">Image: <span className="text-foreground font-mono">{c.image}</span></span>
            <span className="text-muted-foreground">Restart: <span className="text-foreground">{c.restartPolicy || "no"}</span></span>
          </div>

          {/* Ports */}
          {Object.keys(c.ports || {}).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Ports</span>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {Object.entries(c.ports || {}).map(([cp, hps]: [string, any]) =>
                  (hps as string[]).map((hp: string, pi: number) => (
                    <span key={`${cp}-${pi}`} className="px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-mono">{hp}:{cp}</span>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Env vars */}
          {filteredEnv.length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Environment ({filteredEnv.length})</span>
              <div className="mt-0.5 max-h-32 overflow-y-auto rounded bg-black/50 p-2">
                {filteredEnv.map((e: string, ei: number) => {
                  const eq = e.indexOf("=");
                  const k = eq > 0 ? e.slice(0, eq) : e;
                  const v = eq > 0 ? e.slice(eq + 1) : "";
                  return (
                    <div key={ei} className="text-[10px] font-mono py-0.5 flex gap-1">
                      <span className="text-yellow-400 shrink-0">{k}</span>
                      <span className="text-muted-foreground">=</span>
                      <span className="text-foreground/70 truncate">{v.length > 60 ? v.slice(0, 60) + "..." : v}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Volumes & Bind Mounts */}
          {(c.volumes || []).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Volumes & Mounts (data included in snapshot)</span>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {c.volumes.map((v: any, vi: number) => (
                  <span key={vi} className={`px-1.5 py-0.5 rounded text-[10px] font-mono flex items-center gap-1 ${
                    v.type === "bind"
                      ? "bg-orange-500/10 border border-orange-500/20 text-orange-400"
                      : "bg-blue-500/10 border border-blue-500/20 text-blue-400"
                  }`}>
                    <Database className="h-2.5 w-2.5" />
                    {v.name}:{v.destination}
                    <span className="text-[8px] opacity-60 ml-0.5">({v.type === "bind" ? "bind" : "vol"})</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Remaining raw binds (if any not captured in volumes) */}
          {(c.binds || []).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Additional Bind Mounts (data included)</span>
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {c.binds.map((b: string, bi: number) => (
                  <span key={bi} className="px-1.5 py-0.5 rounded bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[10px] font-mono flex items-center gap-1">
                    <HardDrive className="h-2.5 w-2.5" />{b}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Networks */}
          {(c.networks || []).filter((n: string) => !["bridge", "host", "none"].includes(n)).length > 0 && (
            <div>
              <span className="text-[10px] text-muted-foreground uppercase font-medium">Networks</span>
              <div className="flex gap-1 mt-0.5">
                {c.networks.filter((n: string) => !["bridge", "host", "none"].includes(n)).map((n: string, ni: number) => (
                  <span key={ni} className="px-1.5 py-0.5 rounded bg-purple-500/10 border border-purple-500/20 text-purple-400 text-[10px] font-mono flex items-center gap-1">
                    <Network className="h-2.5 w-2.5" />{n}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Compose indicator */}
          {(c.originalCompose || c.generatedCompose) && (
            <div className="flex items-center gap-1.5 text-[10px] text-green-400 pt-1">
              <CheckCircle2 className="h-3 w-3" />
              {c.originalCompose ? "Original docker-compose.yml captured" : "Compose generated from container config"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Stat Card ──────────────────────────────────────────────

function StatCard({ icon: Icon, label, value, color }: { icon: any; label: string; value: any; color: string }) {
  return (
    <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5 text-center">
      <Icon className={`h-4 w-4 mx-auto mb-1 ${color}`} />
      <div className="text-sm font-bold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

// ─── Schedules Tab ──────────────────────────────────────────

function SchedulesTab({ servers, containers }: { servers: ServerItem[]; containers: ContainerItem[] }) {
  const [schedules, setSchedules] = useState<ScheduleItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({ name: "", cron: "0 2 * * *", containerIds: [] as string[], serverId: "", keepLast: 5 });

  const load = () => api<ScheduleItem[]>("/backups/schedules").then(setSchedules).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    try {
      await api("/backups/schedules", { method: "POST", body: form });
      setOpen(false);
      setForm({ name: "", cron: "0 2 * * *", containerIds: [], serverId: "", keepLast: 5 });
      load();
    } catch (err: any) {
      setToast({ type: "error", message: err.message });
    }
  };

  const remove = async (id: string) => {
    await api(`/backups/schedules/${id}`, { method: "DELETE" });
    load();
  };

  const toggle = async (id: string) => {
    await api(`/backups/schedules/${id}/toggle`, { method: "PUT" });
    load();
  };

  const cronPresets = [
    { label: "Every 6h", value: "0 */6 * * *" },
    { label: "Daily 2am", value: "0 2 * * *" },
    { label: "Daily 4am", value: "0 4 * * *" },
    { label: "Weekly Sun", value: "0 3 * * 0" },
    { label: "Monthly 1st", value: "0 3 1 * *" },
  ];

  const serverContainers = (sid: string) => containers.filter(c => c.server.id === sid);

  const toggleContainer = (name: string) => {
    setForm(f => ({
      ...f,
      containerIds: f.containerIds.includes(name)
        ? f.containerIds.filter(n => n !== name)
        : [...f.containerIds, name],
    }));
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{schedules.length} schedule(s)</span>
        <Button onClick={() => setOpen(true)}>
          <CalendarClock className="h-4 w-4 mr-2" /> New Schedule
        </Button>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {schedules.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <CalendarClock className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2 font-medium">No backup schedules</p>
            <p className="text-xs">Create a schedule to automatically snapshot containers on a cron interval with automatic retention cleanup.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {schedules.map(s => (
          <Card key={s.id} className={`border-border/50 ${!s.enabled ? "opacity-50" : ""}`}>
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <CalendarClock className={`h-5 w-5 ${s.enabled ? "text-primary" : "text-muted-foreground"}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{s.name}</span>
                    <Badge variant="secondary" className="text-[10px] font-mono">{s.cron}</Badge>
                    <Badge variant="secondary" className="text-[10px]">Keep {s.keepLast}</Badge>
                    {!s.enabled && <Badge variant="secondary" className="text-[10px]">Paused</Badge>}
                  </div>
                  <div className="flex gap-1 mt-1">
                    {s.containerIds.map((c, i) => (
                      <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary font-mono">{c}</span>
                    ))}
                  </div>
                  {s.lastRunAt && <p className="text-xs text-muted-foreground mt-1">Last run: {new Date(s.lastRunAt).toLocaleString()}</p>}
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggle(s.id)} title={s.enabled ? "Pause" : "Enable"}>
                  <Power className={`h-3.5 w-3.5 ${s.enabled ? "text-green-400" : ""}`} />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(s.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Create schedule dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>New Backup Schedule</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <Input placeholder="Schedule name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server</label>
              <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={form.serverId} onChange={e => setForm({ ...form, serverId: e.target.value, containerIds: [] })}>
                <option value="">Select server...</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            {form.serverId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Containers</label>
                <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                  {serverContainers(form.serverId).map(c => (
                    <button key={c.id} onClick={() => toggleContainer(c.name)}
                      className={`w-full text-left px-3 py-1.5 rounded-md text-sm flex items-center gap-2 transition-colors ${
                        form.containerIds.includes(c.name) ? "bg-primary/10 text-primary border border-primary/20" : "bg-secondary text-muted-foreground border border-transparent"
                      }`}>
                      <Container className="h-3 w-3" /><span className="font-mono text-xs">{c.name}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Schedule (Cron)</label>
              <div className="flex gap-2 mt-1 flex-wrap">
                {cronPresets.map(p => (
                  <button key={p.value} onClick={() => setForm({ ...form, cron: p.value })}
                    className={`px-2 py-1 rounded text-xs border transition-colors ${
                      form.cron === p.value ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"
                    }`}>{p.label}</button>
                ))}
              </div>
              <Input className="mt-2 font-mono" value={form.cron} onChange={e => setForm({ ...form, cron: e.target.value })} />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Keep Last N Snapshots</label>
              <Input className="mt-1" type="number" min={1} value={form.keepLast}
                onChange={e => setForm({ ...form, keepLast: parseInt(e.target.value) || 5 })} />
            </div>
            <Button className="w-full" onClick={create}
              disabled={!form.name || !form.serverId || form.containerIds.length === 0}>
              <CalendarClock className="h-4 w-4 mr-2" /> Create Schedule
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
