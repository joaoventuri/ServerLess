"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api";
import {
  Container, Cpu, MemoryStick, RefreshCw, Loader2, AlertCircle, CheckCircle2,
  Play, Square, Pause, RotateCw, Trash2, FileText, Search, Download,
  Plus, X, Rocket, Star, ChevronDown, Network, Settings2, Save, ChevronRight,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// ─── Types ──────────────────────────────────────────────────

interface ContainerItem {
  id: string; containerId: string; name: string; image: string;
  status: string; cpuPercent: number; ramUsageMb: number; ramLimitMb: number;
  server: { id: string; name: string; host: string };
}

interface ServerItem { id: string; name: string; host: string; isOnline: boolean }

interface RegistryResult {
  name: string; description: string; stars: number;
  official: boolean; pulls: number; source: string;
}

type Tab = "containers" | "deploy" | "registry";

// ─── Main Page ──────────────────────────────────────────────

export default function DockerPage() {
  const [tab, setTab] = useState<Tab>("containers");
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [deployImage, setDeployImage] = useState("");

  useEffect(() => {
    api<ServerItem[]>("/servers").then(s => setServers(s.filter(x => (x as any).hasDocker !== false))).catch(() => {});
  }, []);

  const tabs: { key: Tab; label: string; icon: any }[] = [
    { key: "containers", label: "Containers", icon: Container },
    { key: "deploy", label: "Deploy", icon: Rocket },
    { key: "registry", label: "Registry", icon: Search },
  ];

  const goToDeploy = (image: string) => { setDeployImage(image); setTab("deploy"); };

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Docker Manager</h1>
          <p className="text-sm text-muted-foreground mt-1">Deploy, manage and monitor containers across your servers</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 border-b border-border">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            <t.icon className="h-4 w-4" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === "containers" && <ContainersTab servers={servers} />}
      {tab === "deploy" && <DeployTab servers={servers} onDeployed={() => setTab("containers")} initialImage={deployImage} />}
      {tab === "registry" && <RegistryTab servers={servers} onDeploy={goToDeploy} />}
    </div>
  );
}

// ─── Containers Tab ─────────────────────────────────────────

interface InspectData {
  name: string; image: string; ports: any[]; env: any[]; volumes: any[];
  networks: string[]; restartPolicy: string; cmd: any; compose: string; labels: any;
}

function ContainersTab({ servers }: { servers: ServerItem[] }) {
  const [containers, setContainers] = useState<ContainerItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [logsOpen, setLogsOpen] = useState(false);
  const [logs, setLogs] = useState("");
  const [logsTitle, setLogsTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<InspectData | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editEnv, setEditEnv] = useState<any[]>([]);
  const [editPorts, setEditPorts] = useState<any[]>([]);
  const [editVolumes, setEditVolumes] = useState<any[]>([]);
  const [editRestart, setEditRestart] = useState("unless-stopped");
  const [editCompose, setEditCompose] = useState("");
  const [composeMode, setComposeMode] = useState(false);

  const load = () => api<ContainerItem[]>("/containers").then(setContainers).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); const iv = setInterval(load, 10000); return () => clearInterval(iv); }, []);

  const scan = async () => {
    setScanning(true); setToast(null);
    try {
      const data = await api("/containers/scan", { method: "POST" });
      setContainers(data.data || []);
      const msg = `Scanned ${data.scanned} server(s) — ${data.containers} container(s) found`;
      setToast({ type: data.errors?.length ? "error" : "success", message: data.errors?.length ? `${msg}. ${data.errors.join("; ")}` : msg });
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setScanning(false);
    setTimeout(() => setToast(null), 8000);
  };

  const doAction = async (serverId: string, containerId: string, act: string, name: string) => {
    if (act === "remove" && !confirm(`Remove container "${name}"?`)) return;
    setActing(`${containerId}-${act}`);
    try {
      await api("/containers/action", { method: "POST", body: { serverId, containerId, action: act } });
      setToast({ type: "success", message: `${act} "${name}" — success` });
      setTimeout(load, 1000);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setActing(null); setTimeout(() => setToast(null), 5000);
  };

  const viewLogs = async (serverId: string, containerId: string, name: string) => {
    setLogsTitle(name); setLogs("Loading..."); setLogsOpen(true);
    try { const d = await api(`/containers/logs/${serverId}/${containerId}?tail=200`); setLogs(d.logs || "No logs"); }
    catch (err: any) { setLogs(`Error: ${err.message}`); }
  };

  const toggleExpand = async (c: ContainerItem) => {
    if (expanded === c.containerId) { setExpanded(null); setInspectData(null); return; }
    setExpanded(c.containerId); setInspecting(true); setInspectData(null); setComposeMode(false);
    try {
      const data = await api<InspectData>(`/containers/inspect/${c.server.id}/${c.name}`);
      setInspectData(data);
      setEditEnv(data.env.filter((e: any) => !e.builtin));
      setEditPorts(data.ports.length > 0 ? data.ports : [{ host: "", container: "", protocol: "tcp" }]);
      setEditVolumes(data.volumes.length > 0 ? data.volumes : [{ name: "", destination: "" }]);
      setEditRestart(data.restartPolicy || "unless-stopped");
      setEditCompose(data.compose || "");
      if (data.compose) setComposeMode(true);
    } catch (err: any) { setToast({ type: "error", message: err.message }); setExpanded(null); }
    setInspecting(false);
  };

  const saveAndRedeploy = async (c: ContainerItem) => {
    if (!confirm(`This will stop "${c.name}" and recreate it with the new config. Continue?`)) return;
    setSaving(true);
    try {
      const body: any = {
        image: inspectData?.image,
        ports: editPorts.filter(p => p.host && p.container),
        env: editEnv.filter(e => e.key),
        volumes: editVolumes.filter(v => v.name && v.destination),
        restartPolicy: editRestart,
        networks: inspectData?.networks || [],
      };
      if (composeMode && editCompose.trim()) body.compose = editCompose;

      const data = await api(`/containers/update/${c.server.id}/${c.name}`, { method: "POST", body });
      setToast({ type: "success", message: data.method === "compose"
        ? `Deployed "${c.name}" via docker-compose`
        : `Redeployed "${c.name}" with new config — ID: ${data.containerId}` });
      setExpanded(null); setInspectData(null);
      setTimeout(load, 2000);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setSaving(false); setTimeout(() => setToast(null), 5000);
  };

  const statusBadge = (s: string) => {
    if (s === "running") return "success" as const;
    if (s === "exited") return "destructive" as const;
    if (s === "paused") return "warning" as const;
    return "secondary" as const;
  };

  return (
    <>
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm text-muted-foreground">{containers.length} container(s)</span>
        <Button size="sm" onClick={scan} disabled={scanning}>
          {scanning ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
          Scan Servers
        </Button>
      </div>

      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      {!loading && containers.length === 0 && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Container className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p className="mb-2">No containers found.</p>
            <Button variant="outline" size="sm" onClick={scan} disabled={scanning}>
              {scanning ? <Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5 mr-2" />}
              Scan Now
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {containers.map(c => {
          const busy = acting?.startsWith(c.containerId);
          const isOpen = expanded === c.containerId;
          return (
            <Card key={c.id} className={`border-border/50 transition-colors ${isOpen ? "border-primary/20" : ""}`}>
              <CardContent className="p-0">
                {/* Header row */}
                <div className="flex items-center justify-between p-4">
                  <button className="flex items-center gap-4 min-w-0 text-left" onClick={() => toggleExpand(c)}>
                    <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${isOpen ? "rotate-90" : ""}`} />
                    <Container className={`h-5 w-5 shrink-0 ${c.status === "running" ? "text-primary" : "text-muted-foreground"}`} />
                    <div className="min-w-0">
                      <div className="font-medium text-sm flex items-center gap-2">
                        <span className="truncate">{c.name}</span>
                        <Badge variant={statusBadge(c.status)} className="text-[10px] shrink-0">{c.status}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground font-mono truncate">{c.image} — {c.server.name}</div>
                    </div>
                  </button>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <div className="hidden md:flex items-center gap-4 mr-4 text-xs font-mono text-muted-foreground">
                      <span className="flex items-center gap-1"><Cpu className="h-3 w-3 text-primary" />{c.cpuPercent.toFixed(1)}%</span>
                      <span className="flex items-center gap-1"><MemoryStick className="h-3 w-3 text-blue-400" />{c.ramUsageMb.toFixed(0)}MB</span>
                    </div>
                    {c.status === "running" && (
                      <>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} onClick={() => doAction(c.server.id, c.containerId, "stop", c.name)} title="Stop"><Square className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7" disabled={busy} onClick={() => doAction(c.server.id, c.containerId, "restart", c.name)} title="Restart"><RotateCw className="h-3.5 w-3.5" /></Button>
                      </>
                    )}
                    {(c.status === "exited" || c.status === "created") && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400" disabled={busy} onClick={() => doAction(c.server.id, c.containerId, "start", c.name)} title="Start"><Play className="h-3.5 w-3.5" /></Button>
                    )}
                    {c.status === "paused" && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-green-400" disabled={busy} onClick={() => doAction(c.server.id, c.containerId, "unpause", c.name)} title="Unpause"><Play className="h-3.5 w-3.5" /></Button>
                    )}
                    <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => viewLogs(c.server.id, c.containerId, c.name)} title="Logs"><FileText className="h-3.5 w-3.5" /></Button>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground hover:text-destructive" disabled={busy} onClick={() => doAction(c.server.id, c.containerId, "remove", c.name)} title="Remove"><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </div>

                {/* Expanded editor */}
                {isOpen && (
                  <div className="border-t border-border p-4 bg-[#0c0c0c]">
                    {inspecting ? (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" /> Loading container config...
                      </div>
                    ) : inspectData ? (
                      <div className="space-y-4">
                        {/* Mode toggle */}
                        <div className="flex items-center gap-2">
                          <button onClick={() => setComposeMode(false)} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${!composeMode ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"}`}>
                            <Settings2 className="h-3 w-3 inline mr-1" />Fields
                          </button>
                          <button onClick={() => setComposeMode(true)} className={`px-3 py-1.5 rounded text-xs font-medium border transition-colors ${composeMode ? "bg-primary/10 text-primary border-primary/30" : "bg-secondary text-muted-foreground border-border"}`}>
                            <FileText className="h-3 w-3 inline mr-1" />Docker Compose
                          </button>
                          {inspectData.labels?.["com.docker.compose.project"] && (
                            <span className="text-[10px] text-muted-foreground ml-2">Compose project: {inspectData.labels["com.docker.compose.project"]}</span>
                          )}
                        </div>

                        {composeMode ? (
                          /* Docker Compose editor */
                          <div>
                            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">docker-compose.yml</label>
                            <textarea
                              className="mt-1 w-full rounded-md border border-border bg-black px-4 py-3 text-xs font-mono text-green-400 resize-y focus:outline-none focus:ring-1 focus:ring-ring"
                              style={{ minHeight: "300px" }}
                              value={editCompose}
                              onChange={e => setEditCompose(e.target.value)}
                              placeholder="Paste or edit your docker-compose.yml here..."
                              spellCheck={false}
                            />
                            <p className="text-[10px] text-muted-foreground mt-1">Edit and save to redeploy via <code>docker compose up -d</code></p>
                          </div>
                        ) : (
                          /* Field editor */
                          <>
                            {/* Image + Restart */}
                            <div className="grid grid-cols-2 gap-3">
                              <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Image</label>
                                <Input className="mt-1 font-mono text-xs" value={inspectData.image} readOnly />
                              </div>
                              <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Restart Policy</label>
                                <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
                                  value={editRestart} onChange={e => setEditRestart(e.target.value)}>
                                  <option value="no">No</option>
                                  <option value="always">Always</option>
                                  <option value="unless-stopped">Unless Stopped</option>
                                  <option value="on-failure">On Failure</option>
                                </select>
                              </div>
                            </div>

                            {/* Ports */}
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Ports</label>
                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditPorts([...editPorts, { host: "", container: "", protocol: "tcp" }])}>
                                  <Plus className="h-3 w-3 mr-1" />Add
                                </Button>
                              </div>
                              {editPorts.map((p, i) => (
                                <div key={i} className="flex gap-2 mt-1">
                                  <Input className="font-mono text-xs" placeholder="Host" value={p.host} onChange={e => { const n = [...editPorts]; n[i] = { ...n[i], host: e.target.value }; setEditPorts(n); }} />
                                  <span className="self-center text-muted-foreground text-xs">:</span>
                                  <Input className="font-mono text-xs" placeholder="Container" value={p.container} onChange={e => { const n = [...editPorts]; n[i] = { ...n[i], container: e.target.value }; setEditPorts(n); }} />
                                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditPorts(editPorts.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                                </div>
                              ))}
                            </div>

                            {/* Env vars */}
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Environment Variables</label>
                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditEnv([...editEnv, { key: "", value: "" }])}>
                                  <Plus className="h-3 w-3 mr-1" />Add
                                </Button>
                              </div>
                              {editEnv.map((e, i) => (
                                <div key={i} className="flex gap-2 mt-1">
                                  <Input className="font-mono text-xs w-1/3" placeholder="KEY" value={e.key} onChange={ev => { const n = [...editEnv]; n[i] = { ...n[i], key: ev.target.value }; setEditEnv(n); }} />
                                  <span className="self-center text-muted-foreground text-xs">=</span>
                                  <Input className="font-mono text-xs flex-1" placeholder="value" value={e.value} onChange={ev => { const n = [...editEnv]; n[i] = { ...n[i], value: ev.target.value }; setEditEnv(n); }} />
                                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditEnv(editEnv.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                                </div>
                              ))}
                            </div>

                            {/* Volumes */}
                            <div>
                              <div className="flex items-center justify-between">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volumes</label>
                                <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setEditVolumes([...editVolumes, { name: "", destination: "" }])}>
                                  <Plus className="h-3 w-3 mr-1" />Add
                                </Button>
                              </div>
                              {editVolumes.map((v, i) => (
                                <div key={i} className="flex gap-2 mt-1">
                                  <Input className="font-mono text-xs" placeholder="Volume/path" value={v.name} onChange={e => { const n = [...editVolumes]; n[i] = { ...n[i], name: e.target.value }; setEditVolumes(n); }} />
                                  <span className="self-center text-muted-foreground text-xs">:</span>
                                  <Input className="font-mono text-xs" placeholder="/container/path" value={v.destination} onChange={e => { const n = [...editVolumes]; n[i] = { ...n[i], destination: e.target.value }; setEditVolumes(n); }} />
                                  <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => setEditVolumes(editVolumes.filter((_, j) => j !== i))}><X className="h-3 w-3" /></Button>
                                </div>
                              ))}
                            </div>

                            {/* Networks */}
                            {inspectData.networks.length > 0 && (
                              <div>
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Networks</label>
                                <div className="flex gap-1.5 mt-1">
                                  {inspectData.networks.map(n => (
                                    <span key={n} className="px-2 py-0.5 rounded bg-secondary text-xs font-mono">{n}</span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {/* Save button */}
                        <div className="flex gap-2 pt-2 border-t border-border">
                          <Button className="flex-1" onClick={() => saveAndRedeploy(c)} disabled={saving}>
                            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
                            {saving ? "Deploying..." : composeMode ? "Deploy Compose" : "Save & Redeploy"}
                          </Button>
                          <Button variant="outline" onClick={() => { setExpanded(null); setInspectData(null); }}>Cancel</Button>
                        </div>
                      </div>
                    ) : null}
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Logs Dialog */}
      <Dialog open={logsOpen} onOpenChange={setLogsOpen}>
        <DialogContent className="max-w-3xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><FileText className="h-4 w-4" /> Logs — {logsTitle}</DialogTitle>
          </DialogHeader>
          <pre className="bg-black rounded-lg p-4 text-xs font-mono text-green-400 overflow-auto max-h-[60vh] whitespace-pre-wrap">{logs}</pre>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ─── Deploy Tab ─────────────────────────────────────────────

function DeployTab({ servers, onDeployed, initialImage }: { servers: ServerItem[]; onDeployed: () => void; initialImage?: string }) {
  const [form, setForm] = useState({
    serverId: "", image: initialImage || "", name: "", restart: "unless-stopped", command: "", network: "",
    registryUser: "", registryPass: "",
  });
  const [ports, setPorts] = useState([{ host: "", container: "", protocol: "tcp" }]);
  const [envVars, setEnvVars] = useState([{ key: "", value: "" }]);
  const [volumes, setVolumes] = useState([{ host: "", container: "" }]);
  const [deploying, setDeploying] = useState(false);
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [showAuth, setShowAuth] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [inspected, setInspected] = useState("");

  // Auto-inspect image metadata when image changes
  const inspectImage = async (image: string) => {
    if (!image || image === inspected || image.length < 2) return;
    setInspecting(true);
    try {
      const data = await api<any>(`/containers/registry/inspect?image=${encodeURIComponent(image)}`);
      setInspected(image);

      // Auto-fill ports
      if (data.ports?.length > 0) {
        setPorts(data.ports.map((p: any) => ({
          host: p.container, container: p.container, protocol: p.protocol || "tcp",
        })));
      }

      // Auto-fill env vars (exclude builtins like PATH, HOME)
      if (data.env?.length > 0) {
        const appEnvs = data.env.filter((e: any) => !e.builtin);
        if (appEnvs.length > 0) {
          setEnvVars(appEnvs.map((e: any) => ({ key: e.key, value: e.value })));
        }
      }

      // Auto-fill volumes
      if (data.volumes?.length > 0) {
        setVolumes(data.volumes.map((v: string) => ({ host: v, container: v })));
      }

      setToast({ type: "success", message: `Auto-detected: ${data.ports?.length || 0} ports, ${data.env?.filter((e: any) => !e.builtin).length || 0} env vars, ${data.volumes?.length || 0} volumes` });
      setTimeout(() => setToast(null), 4000);
    } catch {
      // Silent fail — user can still fill manually
    }
    setInspecting(false);
  };

  useEffect(() => {
    if (initialImage && initialImage !== inspected) {
      setForm(f => ({ ...f, image: initialImage }));
      inspectImage(initialImage);
    }
  }, [initialImage]);

  const deploy = async () => {
    if (!form.serverId || !form.image) return;
    setDeploying(true); setToast(null);
    try {
      const body = {
        ...form,
        ports: ports.filter(p => p.host && p.container),
        envVars: envVars.filter(e => e.key),
        volumes: volumes.filter(v => v.host && v.container),
      };
      const data = await api("/containers/deploy", { method: "POST", body });
      setToast({ type: "success", message: `Deployed "${form.image}" — Container ID: ${data.containerId}` });
      setTimeout(onDeployed, 2000);
    } catch (err: any) { setToast({ type: "error", message: err.message }); }
    setDeploying(false);
  };

  const addRow = (setter: Function, empty: any) => setter((prev: any[]) => [...prev, empty]);
  const removeRow = (setter: Function, idx: number) => setter((prev: any[]) => prev.filter((_: any, i: number) => i !== idx));
  const updateRow = (setter: Function, idx: number, field: string, value: string) =>
    setter((prev: any[]) => prev.map((r: any, i: number) => i === idx ? { ...r, [field]: value } : r));

  return (
    <div className="max-w-2xl">
      {toast && <Toast toast={toast} onClose={() => setToast(null)} />}

      <div className="space-y-4">
        {/* Server */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Target Server</label>
          <select
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
            value={form.serverId}
            onChange={e => setForm({ ...form, serverId: e.target.value })}
          >
            <option value="">Select server...</option>
            {servers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.host})</option>)}
          </select>
        </div>

        {/* Image */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Image</label>
          <div className="flex gap-2 mt-1">
            <Input className="font-mono flex-1" placeholder="nginx:latest, ghcr.io/org/app:v1.0" value={form.image}
              onChange={e => setForm({ ...form, image: e.target.value })} />
            <Button variant="outline" onClick={() => inspectImage(form.image)} disabled={inspecting || !form.image}
              title="Auto-detect ports, env vars and volumes from image">
              {inspecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground mt-1">
            Click the detect button or select from Registry — ports, env vars and volumes will be auto-filled
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Container Name</label>
            <Input className="mt-1" placeholder="my-app (optional)" value={form.name}
              onChange={e => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Restart Policy</label>
            <select className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
              value={form.restart} onChange={e => setForm({ ...form, restart: e.target.value })}>
              <option value="no">No</option>
              <option value="always">Always</option>
              <option value="unless-stopped">Unless Stopped</option>
              <option value="on-failure">On Failure</option>
            </select>
          </div>
        </div>

        {/* Ports */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Port Mapping</label>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => addRow(setPorts, { host: "", container: "", protocol: "tcp" })}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {ports.map((p, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <Input placeholder="Host port" value={p.host} onChange={e => updateRow(setPorts, i, "host", e.target.value)} className="font-mono" />
              <span className="self-center text-muted-foreground text-xs">:</span>
              <Input placeholder="Container port" value={p.container} onChange={e => updateRow(setPorts, i, "container", e.target.value)} className="font-mono" />
              <select className="w-20 rounded-md border border-border bg-card px-2 text-xs" value={p.protocol}
                onChange={e => updateRow(setPorts, i, "protocol", e.target.value)}>
                <option>tcp</option><option>udp</option>
              </select>
              {ports.length > 1 && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => removeRow(setPorts, i)}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Env vars */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Environment Variables</label>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => addRow(setEnvVars, { key: "", value: "" })}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {envVars.map((e, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <Input placeholder="KEY" value={e.key} onChange={ev => updateRow(setEnvVars, i, "key", ev.target.value)} className="font-mono" />
              <span className="self-center text-muted-foreground text-xs">=</span>
              <Input placeholder="value" value={e.value} onChange={ev => updateRow(setEnvVars, i, "value", ev.target.value)} className="font-mono" />
              {envVars.length > 1 && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => removeRow(setEnvVars, i)}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Volumes */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Volumes</label>
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => addRow(setVolumes, { host: "", container: "" })}>
              <Plus className="h-3 w-3 mr-1" /> Add
            </Button>
          </div>
          {volumes.map((v, i) => (
            <div key={i} className="flex gap-2 mb-1.5">
              <Input placeholder="/host/path" value={v.host} onChange={e => updateRow(setVolumes, i, "host", e.target.value)} className="font-mono" />
              <span className="self-center text-muted-foreground text-xs">:</span>
              <Input placeholder="/container/path" value={v.container} onChange={e => updateRow(setVolumes, i, "container", e.target.value)} className="font-mono" />
              {volumes.length > 1 && (
                <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={() => removeRow(setVolumes, i)}>
                  <X className="h-3 w-3" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {/* Command */}
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Command <span className="normal-case text-muted-foreground/60">(optional)</span></label>
          <Input className="mt-1 font-mono" placeholder="e.g. --config /etc/app.conf" value={form.command}
            onChange={e => setForm({ ...form, command: e.target.value })} />
        </div>

        {/* Registry auth toggle */}
        <div>
          <button onClick={() => setShowAuth(!showAuth)} className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors">
            <ChevronDown className={`h-3 w-3 transition-transform ${showAuth ? "rotate-180" : ""}`} />
            Private Registry Authentication
          </button>
          {showAuth && (
            <div className="grid grid-cols-2 gap-2 mt-2">
              <Input placeholder="Username" value={form.registryUser} onChange={e => setForm({ ...form, registryUser: e.target.value })} />
              <Input type="password" placeholder="Password / Token" value={form.registryPass} onChange={e => setForm({ ...form, registryPass: e.target.value })} />
            </div>
          )}
        </div>

        {/* Deploy button */}
        <Button className="w-full" onClick={deploy} disabled={deploying || !form.serverId || !form.image}>
          {deploying ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Rocket className="h-4 w-4 mr-2" />}
          {deploying ? "Deploying..." : "Deploy Container"}
        </Button>
      </div>
    </div>
  );
}

// ─── Registry Tab (App Store) ───────────────────────────────

function RegistryTab({ servers, onDeploy }: { servers: ServerItem[]; onDeploy: (image: string) => void }) {
  const [query, setQuery] = useState("");
  const [source, setSource] = useState<"dockerhub" | "ghcr">("dockerhub");
  const [results, setResults] = useState<RegistryResult[]>([]);
  const [popular, setPopular] = useState<RegistryResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [loadingPopular, setLoadingPopular] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [tagsFor, setTagsFor] = useState("");
  const [tagsLoading, setTagsLoading] = useState(false);
  const [activeCategory, setActiveCategory] = useState("");

  // Load popular on mount
  useEffect(() => {
    setLoadingPopular(true);
    api<any>("/containers/registry/browse")
      .then(d => setPopular(d.results || []))
      .catch(() => {})
      .finally(() => setLoadingPopular(false));
  }, []);

  const categories = [
    { key: "", label: "Popular", icon: "🔥" },
    { key: "database", label: "Databases", icon: "🗄️" },
    { key: "web", label: "Web Servers", icon: "🌐" },
    { key: "monitoring", label: "Monitoring", icon: "📊" },
    { key: "messaging", label: "Messaging", icon: "📨" },
    { key: "devtools", label: "Dev Tools", icon: "🛠️" },
  ];

  // Curated quick-search terms per category
  const categorySearch: Record<string, string> = {
    "": "",
    database: "database",
    web: "web server proxy",
    monitoring: "monitoring metrics",
    messaging: "message queue",
    devtools: "development tools",
  };

  const browseCategory = async (cat: string) => {
    setActiveCategory(cat);
    setQuery("");
    setResults([]);
    setTagsFor("");
    if (!cat) {
      // Show popular
      return;
    }
    setSearching(true);
    try {
      const searchTerm = categorySearch[cat] || cat;
      const d = await api<any>(`/containers/registry/search?q=${encodeURIComponent(searchTerm)}&source=dockerhub`);
      setResults(d.results || []);
    } catch { setResults([]); }
    setSearching(false);
  };

  const search = async () => {
    if (!query.trim()) return;
    setSearching(true); setTagsFor(""); setActiveCategory("__search");
    try {
      const d = await api<any>(`/containers/registry/search?q=${encodeURIComponent(query)}&source=${source}`);
      setResults(d.results || []);
    } catch { setResults([]); }
    setSearching(false);
  };

  const loadTags = async (image: string) => {
    if (tagsFor === image) { setTagsFor(""); return; }
    setTagsFor(image); setTagsLoading(true); setTags([]);
    try {
      const d = await api<string[]>(`/containers/registry/tags?image=${encodeURIComponent(image)}`);
      setTags(d);
    } catch { setTags([]); }
    setTagsLoading(false);
  };

  const fmt = (n: number) => {
    if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "K";
    return String(n);
  };

  const displayList = activeCategory === "" ? popular : results;
  const showGrid = activeCategory === "" || (activeCategory !== "__search" && results.length > 0);

  return (
    <div>
      {/* Search */}
      <div className="flex gap-2 mb-5">
        <div className="flex rounded-md border border-border overflow-hidden shrink-0">
          <button onClick={() => { setSource("dockerhub"); setActiveCategory(""); setResults([]); }}
            className={`px-3 py-2 text-xs font-medium transition-colors ${source === "dockerhub" ? "bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground"}`}>
            Docker Hub
          </button>
          <button onClick={() => { setSource("ghcr"); setActiveCategory("__search"); setResults([]); }}
            className={`px-3 py-2 text-xs font-medium border-l border-border transition-colors ${source === "ghcr" ? "bg-primary/10 text-primary" : "bg-card text-muted-foreground hover:text-foreground"}`}>
            GHCR
          </button>
        </div>
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-10" placeholder="Search images..." value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && search()} />
        </div>
        <Button onClick={search} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Search"}
        </Button>
      </div>

      {/* Categories (Docker Hub only) */}
      {source === "dockerhub" && (
        <div className="flex gap-2 mb-6 overflow-x-auto pb-1">
          {categories.map(c => (
            <button key={c.key} onClick={() => browseCategory(c.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${
                activeCategory === c.key
                  ? "bg-primary/10 text-primary border-primary/30"
                  : "bg-secondary border-border text-muted-foreground hover:text-foreground hover:bg-secondary/80"
              }`}>
              <span>{c.icon}</span> {c.label}
            </button>
          ))}
        </div>
      )}

      {/* Loading */}
      {(searching || loadingPopular) && displayList.length === 0 && (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading...
        </div>
      )}

      {/* Results grid */}
      {displayList.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {displayList.map((r, i) => (
            <Card key={i} className="border-border/50 hover:border-primary/20 transition-colors group">
              <CardContent className="p-4 flex flex-col h-full">
                {/* Header */}
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/5 border border-border text-lg">
                      {r.official ? "📦" : "🐳"}
                    </div>
                    <div className="min-w-0">
                      <div className="font-medium text-sm font-mono truncate">{r.name}</div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {r.official && <Badge variant="default" className="text-[9px] px-1.5 py-0">Official</Badge>}
                        {r.source === "ghcr" && <Badge variant="secondary" className="text-[9px] px-1.5 py-0">GHCR</Badge>}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Description */}
                <p className="text-xs text-muted-foreground line-clamp-2 mb-3 flex-1">
                  {r.description || "No description available"}
                </p>

                {/* Stats */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground mb-3">
                  {r.stars > 0 && <span className="flex items-center gap-1"><Star className="h-3 w-3 text-yellow-500" />{fmt(r.stars)}</span>}
                  {r.pulls > 0 && <span className="flex items-center gap-1"><Download className="h-3 w-3" />{fmt(r.pulls)}</span>}
                </div>

                {/* Actions */}
                <div className="flex gap-2">
                  <Button size="sm" className="flex-1" onClick={() => onDeploy(r.name)}>
                    <Rocket className="h-3 w-3 mr-1.5" /> Deploy
                  </Button>
                  {source === "dockerhub" && (
                    <Button size="sm" variant="outline" onClick={() => loadTags(r.name)}>
                      Tags
                    </Button>
                  )}
                </div>

                {/* Tags */}
                {tagsFor === r.name && (
                  <div className="mt-3 pt-3 border-t border-border">
                    {tagsLoading ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" /> Loading tags...
                      </div>
                    ) : tags.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {tags.slice(0, 20).map((tag, ti) => (
                          <button key={ti} onClick={() => onDeploy(`${r.name}:${tag}`)}
                            className="px-2 py-0.5 rounded text-[10px] font-mono bg-secondary hover:bg-primary/10 hover:text-primary transition-colors border border-border">
                            {tag}
                          </button>
                        ))}
                        {tags.length > 20 && <span className="text-[10px] text-muted-foreground self-center ml-1">+{tags.length - 20} more</span>}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No tags found</p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty search state */}
      {!searching && !loadingPopular && displayList.length === 0 && activeCategory === "__search" && (
        <Card className="border-dashed border-border/50">
          <CardContent className="p-8 text-center text-muted-foreground">
            <Search className="h-8 w-8 mx-auto mb-3 opacity-30" />
            <p>{query ? `No results for "${query}"` : "Type to search Docker Hub or GHCR"}</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Toast component ────────────────────────────────────────

function Toast({ toast, onClose }: { toast: { type: "success" | "error"; message: string }; onClose: () => void }) {
  return (
    <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
      toast.type === "success"
        ? "border-green-500/30 bg-green-500/10 text-green-400"
        : "border-red-500/30 bg-red-500/10 text-red-400"
    }`}>
      {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertCircle className="h-4 w-4 shrink-0" />}
      <span className="flex-1">{toast.message}</span>
      <button onClick={onClose} className="opacity-60 hover:opacity-100">&times;</button>
    </div>
  );
}
