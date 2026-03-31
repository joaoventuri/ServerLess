"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import {
  Globe, Plus, Trash2, Power, RefreshCw, Loader2, CheckCircle2, AlertCircle,
  ExternalLink, Shield, Container, FileText, Stethoscope, Download, XCircle,
  RotateCw, ChevronRight,
} from "lucide-react";

interface DomainItem {
  id: string; domain: string; containerName: string; containerPort: number;
  ssl: boolean; enabled: boolean; serverId: string;
  server: { id: string; name: string; host: string };
}
interface ServerItem { id: string; name: string; host: string }
interface ContainerOption { name: string; image: string; status: string }
interface TraefikStatus { installed: boolean; running: boolean; image?: string; error?: string }
interface Check { name: string; status: "ok" | "warn" | "fail"; message: string }

export default function DomainsPage() {
  const [domains, setDomains] = useState<DomainItem[]>([]);
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [form, setForm] = useState({ domain: "", containerName: "", containerPort: 80, ssl: true, serverId: "" });
  const [serverContainers, setServerContainers] = useState<ContainerOption[]>([]);
  const [loadingContainers, setLoadingContainers] = useState(false);

  // Traefik status per server
  const [traefikStatus, setTraefikStatus] = useState<Record<string, TraefikStatus>>({});
  const [traefikLoading, setTraefikLoading] = useState<string | null>(null);
  const [logsServerId, setLogsServerId] = useState<string | null>(null);
  const [logs, setLogs] = useState("");

  // Diagnostics
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checks, setChecks] = useState<Check[]>([]);
  const [checksFor, setChecksFor] = useState<string | null>(null);

  const load = () => api<DomainItem[]>("/domains").then(setDomains).catch(() => {});
  useEffect(() => {
    load();
    api<ServerItem[]>("/servers").then(setServers).catch(() => {});
  }, []);

  // Load Traefik status for servers that have domains
  useEffect(() => {
    const serverIds = [...new Set(domains.map(d => d.serverId))];
    serverIds.forEach(sid => {
      api<TraefikStatus>(`/domains/traefik-status/${sid}`).then(s => {
        setTraefikStatus(prev => ({ ...prev, [sid]: s }));
      }).catch(() => {});
    });
  }, [domains]);

  const selectServer = async (serverId: string) => {
    setForm({ ...form, serverId, containerName: "" });
    setServerContainers([]);
    if (!serverId) return;
    setLoadingContainers(true);
    try {
      const all = await api<any[]>("/containers");
      let fromServer = all.filter((c: any) => c.server?.id === serverId);
      if (fromServer.length === 0) {
        const scan = await api("/containers/scan", { method: "POST" });
        fromServer = (scan.data || []).filter((c: any) => c.server?.id === serverId);
      }
      setServerContainers(fromServer.map((c: any) => ({ name: c.name, image: c.image, status: c.status })));
    } catch {}
    setLoadingContainers(false);
  };

  const create = async () => {
    try {
      await api("/domains", { method: "POST", body: form });
      setOpen(false);
      setForm({ domain: "", containerName: "", containerPort: 80, ssl: true, serverId: "" });
      setServerContainers([]);
      setToast({ type: "success", message: "Domain added and routes synced" });
      load();
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setTimeout(() => setToast(null), 5000);
  };

  const remove = async (id: string) => {
    if (!confirm("Remove this domain route?")) return;
    await api(`/domains/${id}`, { method: "DELETE" });
    load();
  };

  const toggle = async (id: string) => {
    await api(`/domains/${id}/toggle`, { method: "PUT" });
    load();
  };

  // Traefik actions
  const installTraefik = async (serverId: string) => {
    setTraefikLoading(serverId);
    try {
      await api(`/domains/traefik-install/${serverId}`, { method: "POST", body: { email: "joaonventuri@gmail.com" } });
      setToast({ type: "success", message: "Traefik installed and running" });
      setTraefikStatus(prev => ({ ...prev, [serverId]: { installed: true, running: true } }));
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setTraefikLoading(null);
    setTimeout(() => setToast(null), 5000);
  };

  const restartTraefik = async (serverId: string) => {
    setTraefikLoading(serverId);
    try {
      await api(`/domains/traefik-restart/${serverId}`, { method: "POST" });
      setToast({ type: "success", message: "Traefik restarted" });
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setTraefikLoading(null);
    setTimeout(() => setToast(null), 3000);
  };

  const syncRoutes = async (serverId: string) => {
    setTraefikLoading(serverId);
    try {
      await api(`/domains/sync/${serverId}`, { method: "POST" });
      setToast({ type: "success", message: "Routes synced + Traefik restarted" });
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setTraefikLoading(null);
    setTimeout(() => setToast(null), 3000);
  };

  const viewLogs = async (serverId: string) => {
    if (logsServerId === serverId) { setLogsServerId(null); return; }
    setLogsServerId(serverId);
    setLogs("Loading...");
    try {
      const d = await api(`/domains/traefik-logs/${serverId}`);
      setLogs(d.logs || "No logs");
    } catch (err: any) { setLogs(`Error: ${err.message}`); }
  };

  const runCheck = async (domainId: string) => {
    if (checksFor === domainId) { setChecksFor(null); return; }
    setCheckingId(domainId);
    setChecksFor(domainId);
    setChecks([]);
    try {
      const d = await api(`/domains/check/${domainId}`, { method: "POST" });
      setChecks(d.checks || []);
    } catch (err: any) { setChecks([{ name: "Error", status: "fail", message: err.message }]); }
    setCheckingId(null);
  };

  // Group by server
  const serverIds = [...new Set(domains.map(d => d.serverId))];
  const grouped = serverIds.map(sid => ({
    server: servers.find(s => s.id === sid) || { id: sid, name: "Unknown", host: "" },
    domains: domains.filter(d => d.serverId === sid),
    traefik: traefikStatus[sid],
  }));

  const statusIcon = (s: string) => {
    if (s === "ok") return <CheckCircle2 className="h-3.5 w-3.5 text-green-400" />;
    if (s === "warn") return <AlertCircle className="h-3.5 w-3.5 text-yellow-400" />;
    return <XCircle className="h-3.5 w-3.5 text-red-400" />;
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Domains</h1>
          <p className="text-sm text-muted-foreground mt-1">Route domains to containers with automatic SSL via Traefik</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-2" /> Add Route</Button>
      </div>

      {toast && (
        <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${toast.type === "success" ? "border-green-500/30 bg-green-500/10 text-green-400" : "border-red-500/30 bg-red-500/10 text-red-400"}`}>
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-auto opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {domains.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Globe className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2">No domain routes configured.</p>
            <p className="text-xs">Add a route, then Traefik will be auto-installed to handle routing and SSL.</p>
          </CardContent>
        </Card>
      )}

      {/* Per-server sections */}
      {grouped.map(({ server, domains: serverDomains, traefik }) => (
        <div key={server.id} className="mb-8">
          {/* Server header + Traefik status */}
          <Card className="border-border/50 mb-3">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <Globe className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <span className="font-medium text-sm">{server.name}</span>
                    <span className="text-xs text-muted-foreground ml-2 font-mono">{server.host}</span>
                  </div>
                  {traefik?.running ? (
                    <Badge variant="success" className="text-[10px]">Traefik Running</Badge>
                  ) : traefik?.installed ? (
                    <Badge variant="warning" className="text-[10px]">Traefik Stopped</Badge>
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">No Traefik</Badge>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {!traefik?.installed ? (
                    <Button size="sm" onClick={() => installTraefik(server.id)} disabled={traefikLoading === server.id}>
                      {traefikLoading === server.id ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Download className="h-3.5 w-3.5 mr-1" />}
                      Install Traefik
                    </Button>
                  ) : (
                    <>
                      <Button size="sm" variant="outline" onClick={() => syncRoutes(server.id)} disabled={traefikLoading === server.id} title="Sync routes + restart">
                        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Sync
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => restartTraefik(server.id)} disabled={traefikLoading === server.id} title="Restart Traefik">
                        <RotateCw className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => viewLogs(server.id)} title="Traefik Logs">
                        <FileText className="h-3.5 w-3.5" />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Traefik logs inline */}
              {logsServerId === server.id && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-muted-foreground uppercase tracking-wider">Traefik Logs</span>
                    <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setLogsServerId(null)}>Close</Button>
                  </div>
                  <pre className="bg-black rounded-lg p-3 text-[10px] font-mono text-green-400 overflow-auto max-h-48 whitespace-pre-wrap">{logs}</pre>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Domain rows */}
          <div className="space-y-2 ml-4">
            {serverDomains.map(d => (
              <div key={d.id}>
                <Card className={`border-border/50 ${!d.enabled ? "opacity-50" : ""} ${checksFor === d.id ? "border-primary/20" : ""}`}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${checksFor === d.id ? "rotate-90" : ""}`} />
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-sm">{d.domain}</span>
                          {d.ssl && <Badge variant="success" className="text-[9px]"><Shield className="h-2.5 w-2.5 mr-0.5" />SSL</Badge>}
                          {!d.enabled && <Badge variant="secondary" className="text-[9px]">Off</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground font-mono mt-0.5">→ {d.containerName}:{d.containerPort}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => runCheck(d.id)} title="Health Check" disabled={checkingId === d.id}>
                        {checkingId === d.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Stethoscope className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => window.open(`http${d.ssl ? "s" : ""}://${d.domain}`, "_blank")} title="Open">
                        <ExternalLink className="h-3.5 w-3.5" />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => toggle(d.id)} title={d.enabled ? "Disable" : "Enable"}>
                        <Power className={`h-3.5 w-3.5 ${d.enabled ? "text-green-400" : ""}`} />
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => remove(d.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>

                {/* Diagnostics panel */}
                {checksFor === d.id && checks.length > 0 && (
                  <Card className="ml-6 mt-1 border-border/30 bg-[#0c0c0c]">
                    <CardContent className="p-3 space-y-1.5">
                      {checks.map((c, i) => (
                        <div key={i} className="flex items-center gap-2 text-xs">
                          {statusIcon(c.status)}
                          <span className="font-medium w-16 shrink-0">{c.name}</span>
                          <span className="text-muted-foreground">{c.message}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}

      {/* Add domain dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New Domain Route</DialogTitle></DialogHeader>
          <div className="space-y-3 mt-4">
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Server</label>
              <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                value={form.serverId} onChange={e => selectServer(e.target.value)}>
                <option value="">Select server...</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
              </select>
            </div>

            {form.serverId && (
              <div>
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Container</label>
                {loadingContainers ? (
                  <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin" /> Loading...</div>
                ) : serverContainers.length > 0 ? (
                  <div className="mt-2 space-y-1 max-h-36 overflow-y-auto">
                    {serverContainers.map(c => (
                      <button key={c.name} onClick={() => setForm({ ...form, containerName: c.name })}
                        className={`w-full text-left px-3 py-1.5 rounded-md text-sm flex items-center justify-between transition-colors ${form.containerName === c.name ? "bg-primary/10 text-primary border border-primary/20" : "bg-secondary text-muted-foreground border border-transparent"}`}>
                        <div className="flex items-center gap-2">
                          <Container className="h-3.5 w-3.5" />
                          <span className="font-mono">{c.name}</span>
                        </div>
                        <span className={`h-1.5 w-1.5 rounded-full ${c.status === "running" ? "bg-green-400" : "bg-gray-500"}`} />
                      </button>
                    ))}
                  </div>
                ) : <p className="mt-2 text-xs text-muted-foreground">No containers. Deploy one first.</p>}
              </div>
            )}

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Domain</label>
              <Input className="mt-1 font-mono" placeholder="app.example.com" value={form.domain}
                onChange={e => setForm({ ...form, domain: e.target.value })} />
            </div>

            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Container Port</label>
              <Input className="mt-1" type="number" value={form.containerPort}
                onChange={e => setForm({ ...form, containerPort: parseInt(e.target.value) || 80 })} />
              <p className="text-[10px] text-muted-foreground mt-1">The port the app listens on inside the container</p>
            </div>

            <div className="flex items-center gap-2">
              <input type="checkbox" id="ssl" checked={form.ssl} onChange={e => setForm({ ...form, ssl: e.target.checked })} className="accent-primary" />
              <label htmlFor="ssl" className="text-sm">Enable HTTPS (Let's Encrypt)</label>
            </div>

            <Button className="w-full" onClick={create} disabled={!form.domain || !form.containerName || !form.serverId}>
              Add Domain Route
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
