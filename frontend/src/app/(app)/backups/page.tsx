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
  Clock, Server, Container, CalendarClock, Power, HardDrive,
} from "lucide-react";

interface BackupItem {
  id: string; name: string; type: string; status: string;
  containerIds: string[]; serverId: string; serverName: string;
  fileName?: string; fileSizeMb?: number; error?: string;
  createdAt: string; completedAt?: string;
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
    { key: "backups" as Tab, label: "Backups", icon: Archive },
    { key: "schedules" as Tab, label: "Schedules", icon: CalendarClock },
  ];

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backups</h1>
          <p className="text-sm text-muted-foreground mt-1">Export, import and schedule container backups (.opsbigbro format)</p>
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
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const [exportForm, setExportForm] = useState({ name: "", serverId: "", containerNames: [] as string[], type: "single" as "single" | "stack" });
  const [importForm, setImportForm] = useState({ backupId: "", targetServerId: "" });

  const load = () => api<BackupItem[]>("/backups").then(setBackups).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); const iv = setInterval(load, 5000); return () => clearInterval(iv); }, []);

  const doExport = async () => {
    setExporting(true);
    try {
      await api("/backups/export", { method: "POST", body: exportForm });
      setToast({ type: "success", message: "Backup started — it will run in the background" });
      setExportOpen(false);
      setExportForm({ name: "", serverId: "", containerNames: [], type: "single" });
      load();
    } catch (err: any) {
      setToast({ type: "error", message: err.message });
    }
    setExporting(false);
    setTimeout(() => setToast(null), 5000);
  };

  const doImport = async () => {
    setImporting(true);
    try {
      const data = await api("/backups/import", { method: "POST", body: importForm });
      setToast({ type: "success", message: data.message });
      setImportOpen(false);
    } catch (err: any) {
      setToast({ type: "error", message: err.message });
    }
    setImporting(false);
    setTimeout(() => setToast(null), 8000);
  };

  const doDelete = async (id: string) => {
    if (!confirm("Delete this backup permanently?")) return;
    await api(`/backups/${id}`, { method: "DELETE" });
    load();
  };

  const doDownload = (id: string, name: string) => {
    const token = localStorage.getItem("obb_token");
    window.open(`/api/backups/download/${id}?token=${token}`, "_blank");
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
    if (!mb) return "—";
    if (mb >= 1024) return (mb / 1024).toFixed(1) + " GB";
    return mb.toFixed(1) + " MB";
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{backups.length} backup(s)</span>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Restore
          </Button>
          <Button onClick={() => setExportOpen(true)}>
            <Archive className="h-4 w-4 mr-2" /> New Backup
          </Button>
        </div>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {!loading && backups.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Archive className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2">No backups yet.</p>
            <p className="text-xs">Create a backup to export container configs + volumes as a portable .opsbigbro file.</p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {backups.map(b => (
          <Card key={b.id} className="border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4 min-w-0">
                  <Archive className={`h-5 w-5 shrink-0 ${b.status === "completed" ? "text-primary" : b.status === "failed" ? "text-red-400" : "text-yellow-400"}`} />
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm truncate">{b.name}</span>
                      <Badge variant={statusBadge(b.status)} className="text-[10px]">{b.status}</Badge>
                      <Badge variant="secondary" className="text-[10px]">{b.type}</Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                      <span className="flex items-center gap-1"><Server className="h-3 w-3" />{b.serverName}</span>
                      <span className="flex items-center gap-1"><Container className="h-3 w-3" />{b.containerIds.length} container(s)</span>
                      {b.fileSizeMb && <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{fmtSize(b.fileSizeMb)}</span>}
                      <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{new Date(b.createdAt).toLocaleString()}</span>
                    </div>
                    {b.error && <p className="text-xs text-red-400 mt-1">{b.error}</p>}
                    <div className="flex gap-1 mt-1">
                      {b.containerIds.map((c, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary font-mono">{c}</span>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {b.status === "completed" && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => doDownload(b.id, b.name)} title="Download .opsbigbro">
                        <Download className="h-3.5 w-3.5 mr-1" /> Download
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setImportForm({ backupId: b.id, targetServerId: "" }); setImportOpen(true); }} title="Restore to server">
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
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Export dialog */}
      <Dialog open={exportOpen} onOpenChange={setExportOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>Create Backup</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Backup Name</label>
              <Input className="mt-1" placeholder="My App Backup" value={exportForm.name}
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
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Select Containers <span className="normal-case text-muted-foreground/60">(select multiple for stack backup)</span>
                </label>
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
                    </button>
                  ))}
                </div>
                {exportForm.containerNames.length > 1 && (
                  <p className="text-xs text-primary mt-2">Stack backup — {exportForm.containerNames.length} containers will be backed up together</p>
                )}
              </div>
            )}
            <Button className="w-full" onClick={doExport}
              disabled={exporting || !exportForm.name || !exportForm.serverId || exportForm.containerNames.length === 0}>
              {exporting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Archive className="h-4 w-4 mr-2" />}
              {exporting ? "Starting..." : `Backup ${exportForm.containerNames.length} Container(s)`}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Import dialog — full review form */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Restore Backup</DialogTitle></DialogHeader>
          <div className="space-y-4 mt-4">
            {/* Select backup */}
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Backup</label>
              <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={importForm.backupId} onChange={e => setImportForm({ ...importForm, backupId: e.target.value })}>
                <option value="">Select backup...</option>
                {backups.filter(b => b.status === "completed").map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.containerIds.join(", ")} ({fmtSize(b.fileSizeMb)})</option>
                ))}
              </select>
            </div>

            {/* Show backup contents */}
            {importForm.backupId && (() => {
              const backup = backups.find(b => b.id === importForm.backupId);
              if (!backup?.metadata) return null;
              let manifest: any;
              try { manifest = JSON.parse(backup.metadata); } catch { return null; }

              return (
                <>
                  {/* Backup info */}
                  <div className="rounded-lg border border-border bg-card/50 p-4">
                    <div className="flex items-center gap-3 mb-3">
                      <Archive className="h-5 w-5 text-primary" />
                      <div>
                        <div className="font-medium text-sm">{backup.name}</div>
                        <div className="text-xs text-muted-foreground">
                          {fmtSize(backup.fileSizeMb)} — {new Date(backup.createdAt).toLocaleString()} — from {backup.serverName}
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1"><Container className="h-3 w-3" />{manifest.containers?.length || 0} container(s)</span>
                      <span className="flex items-center gap-1"><HardDrive className="h-3 w-3" />{manifest.containers?.reduce((a: number, c: any) => a + (c.volumes?.length || 0), 0)} volume(s)</span>
                      {manifest.networks?.length > 0 && <span>{manifest.networks.length} network(s)</span>}
                    </div>
                  </div>

                  {/* Container details */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">What will be restored</label>
                    <div className="space-y-2">
                      {(manifest.containers || []).map((c: any, ci: number) => (
                        <div key={ci} className="rounded-lg border border-border bg-[#0c0c0c] p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <Container className="h-4 w-4 text-primary" />
                            <span className="font-mono text-sm font-medium">{c.name}</span>
                            <span className="text-[10px] text-muted-foreground">{c.image}</span>
                          </div>

                          {/* Ports */}
                          {Object.keys(c.ports || {}).length > 0 && (
                            <div className="mb-2">
                              <span className="text-[10px] text-muted-foreground uppercase">Ports</span>
                              <div className="flex gap-1 mt-0.5 flex-wrap">
                                {Object.entries(c.ports || {}).map(([cp, hps]: [string, any]) => (
                                  (hps as string[]).map((hp: string, pi: number) => (
                                    <span key={`${cp}-${pi}`} className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">{hp}:{cp}</span>
                                  ))
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Env vars */}
                          {(c.env || []).length > 0 && (
                            <div className="mb-2">
                              <span className="text-[10px] text-muted-foreground uppercase">Environment ({c.env.length})</span>
                              <div className="mt-0.5 max-h-24 overflow-y-auto">
                                {c.env.filter((e: string) => !e.startsWith("PATH=") && !e.startsWith("HOME=") && !e.startsWith("HOSTNAME=")).map((e: string, ei: number) => {
                                  const eq = e.indexOf("=");
                                  const k = eq > 0 ? e.slice(0, eq) : e;
                                  const v = eq > 0 ? e.slice(eq + 1) : "";
                                  return (
                                    <div key={ei} className="text-[10px] font-mono py-0.5 flex gap-1">
                                      <span className="text-primary">{k}</span>
                                      <span className="text-muted-foreground">=</span>
                                      <span className="text-foreground/70 truncate">{v.length > 50 ? v.slice(0, 50) + "..." : v}</span>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {/* Volumes */}
                          {(c.volumes || []).length > 0 && (
                            <div className="mb-2">
                              <span className="text-[10px] text-muted-foreground uppercase">Volumes (data included)</span>
                              <div className="flex gap-1 mt-0.5 flex-wrap">
                                {c.volumes.map((v: any, vi: number) => (
                                  <span key={vi} className="px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 text-[10px] font-mono flex items-center gap-1">
                                    <HardDrive className="h-2.5 w-2.5" />{v.name}:{v.destination}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Networks */}
                          {(c.networks || []).filter((n: string) => !["bridge","host","none"].includes(n)).length > 0 && (
                            <div>
                              <span className="text-[10px] text-muted-foreground uppercase">Networks</span>
                              <div className="flex gap-1 mt-0.5">
                                {c.networks.filter((n: string) => !["bridge","host","none"].includes(n)).map((n: string, ni: number) => (
                                  <span key={ni} className="px-1.5 py-0.5 rounded bg-secondary text-[10px] font-mono">{n}</span>
                                ))}
                              </div>
                            </div>
                          )}

                          <div className="text-[10px] text-muted-foreground mt-1">restart: {c.restartPolicy || "no"}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Target server */}
                  <div>
                    <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Restore to Server</label>
                    <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                      value={importForm.targetServerId} onChange={e => setImportForm({ ...importForm, targetServerId: e.target.value })}>
                      <option value="">Select server...</option>
                      {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
                    </select>
                  </div>

                  <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3 text-xs text-primary/80">
                    <strong>Full mirror restore:</strong> Containers will be recreated with the exact same image, ports, env vars, networks, and restart policy.
                    Volume data (databases, uploads, configs) will be restored from the backup tar archives. Existing containers with the same names will be replaced.
                  </div>
                </>
              );
            })()}

            <Button className="w-full" onClick={doImport} disabled={importing || !importForm.backupId || !importForm.targetServerId}>
              {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
              {importing ? "Restoring..." : "Restore Full Backup"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
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
            <p className="mb-2">No backup schedules.</p>
            <p className="text-xs">Create a schedule to automatically backup containers on a cron interval.</p>
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
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Keep Last N Backups</label>
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
