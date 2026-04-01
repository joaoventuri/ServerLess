"use client";

import { useEffect, useState, useRef } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api } from "@/lib/api";
import {
  Plus, Terminal, Trash2, Code2, Copy, Server as ServerIcon,
  Plug, CheckCircle2, XCircle, Loader2, Pencil,
} from "lucide-react";

interface ServerItem {
  id: string; name: string; description?: string; host: string; port: number;
  username: string; authType: string; hasDocker: boolean; isOnline: boolean;
}

type FormData = {
  name: string; description: string; host: string; port: number; username: string;
  authType: "password" | "key"; password: string; privateKey: string; hasDocker: boolean;
};

const emptyForm: FormData = {
  name: "", description: "", host: "", port: 22, username: "root",
  authType: "password", password: "", privateKey: "", hasDocker: false,
};

export default function ServersPage() {
  const [servers, setServers] = useState<ServerItem[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [installScript, setInstallScript] = useState("");
  const [toast, setToast] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormData>({ ...emptyForm });
  const [editForm, setEditForm] = useState<FormData>({ ...emptyForm });

  const load = () => api<ServerItem[]>("/servers").then(setServers).catch(() => {});
  useEffect(() => { load(); }, []);

  const create = async () => {
    await api("/servers", { method: "POST", body: form });
    setCreateOpen(false);
    setForm({ ...emptyForm });
    load();
  };

  const openEdit = (s: ServerItem) => {
    setEditId(s.id);
    setEditForm({
      name: s.name, description: s.description || "", host: s.host, port: s.port,
      username: s.username, authType: s.authType as "password" | "key",
      password: "", privateKey: "", hasDocker: s.hasDocker,
    });
    setEditOpen(true);
  };

  const saveEdit = async () => {
    if (!editId) return;
    const body: Record<string, unknown> = {
      name: editForm.name, description: editForm.description,
      host: editForm.host, port: editForm.port,
      username: editForm.username, authType: editForm.authType,
      hasDocker: editForm.hasDocker,
    };
    if (editForm.authType === "password" && editForm.password) body.password = editForm.password;
    if (editForm.authType === "key" && editForm.privateKey) body.privateKey = editForm.privateKey;
    await api(`/servers/${editId}`, { method: "PUT", body });
    setEditOpen(false);
    setEditId(null);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this server?")) return;
    await api(`/servers/${id}`, { method: "DELETE" });
    load();
  };

  const generateToken = async (id: string) => {
    const data = await api(`/servers/${id}/agent-token`, { method: "POST" });
    setInstallScript(data.installScript);
  };

  const testConnection = async (id: string) => {
    setTestingId(id);
    setToast(null);
    try {
      const data = await api(`/servers/${id}/test`, { method: "POST" });
      setToast({ type: "success", message: data.message });
      load();
    } catch (err: any) {
      setToast({ type: "error", message: err.message });
    }
    setTestingId(null);
    setTimeout(() => setToast(null), 8000);
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Server Vault</h1>
          <p className="text-sm text-muted-foreground mt-1">Manage SSH connections and remote access</p>
        </div>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button><Plus className="h-4 w-4 mr-2" /> Add Server</Button>
          </DialogTrigger>
          <DialogContent className="max-w-md">
            <DialogHeader><DialogTitle>New Server</DialogTitle></DialogHeader>
            <ServerForm form={form} setForm={setForm} onSubmit={create} submitLabel="Create Server" />
          </DialogContent>
        </Dialog>
      </div>

      {/* Toast */}
      {toast && (
        <div className={`mb-4 flex items-center gap-3 rounded-lg border px-4 py-3 text-sm ${
          toast.type === "success"
            ? "border-green-500/30 bg-green-500/10 text-green-400"
            : "border-red-500/30 bg-red-500/10 text-red-400"
        }`}>
          {toast.type === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} className="ml-auto opacity-60 hover:opacity-100">&times;</button>
        </div>
      )}

      {/* Install script */}
      {installScript && (
        <Card className="mb-6 border-primary/20 neon-glow">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-primary">Agent Install Script</span>
              <Button size="sm" variant="ghost" onClick={() => navigator.clipboard.writeText(installScript)}>
                <Copy className="h-3 w-3 mr-1" /> Copy
              </Button>
            </div>
            <code className="block bg-black rounded p-3 text-xs font-mono text-green-400 break-all">{installScript}</code>
            <Button size="sm" variant="ghost" className="mt-2" onClick={() => setInstallScript("")}>Dismiss</Button>
          </CardContent>
        </Card>
      )}

      {/* Server list */}
      <div className="grid gap-3">
        {servers.length === 0 && (
          <Card className="border-dashed border-border/50">
            <CardContent className="p-8 text-center text-muted-foreground">
              <ServerIcon className="h-8 w-8 mx-auto mb-3 opacity-30" />
              <p>No servers yet. Add your first server to get started.</p>
            </CardContent>
          </Card>
        )}
        {servers.map((s) => (
          <Card key={s.id} className="border-border/50 hover:border-border transition-colors">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className={`h-2 w-2 rounded-full ${s.isOnline ? "bg-primary shadow-[0_0_6px_rgba(34,197,94,0.5)]" : "bg-muted-foreground"}`} />
                <div>
                  <div className="font-medium flex items-center gap-2">
                    {s.name}
                    {s.hasDocker && <Badge variant="secondary" className="text-[10px]">Docker</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground font-mono">{s.username}@{s.host}:{s.port}</div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => testConnection(s.id)} disabled={testingId === s.id} title="Test SSH Connection">
                  {testingId === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
                </Button>
                <Button size="sm" variant="outline" onClick={() => openEdit(s)} title="Edit Server">
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="outline" onClick={() => generateToken(s.id)} title="Generate Agent Token">
                  Agent
                </Button>
                <Button size="sm" variant="outline" onClick={() => { setActiveServerId(s.id); setTerminalOpen(true); }}>
                  <Terminal className="h-3.5 w-3.5 mr-1" /> Terminal
                </Button>
                <Button size="sm" variant="outline" onClick={() => window.open(`/ide?serverId=${s.id}`, "_blank")}>
                  <Code2 className="h-3.5 w-3.5" />
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(s.id)} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Edit Server</DialogTitle></DialogHeader>
          <ServerForm form={editForm} setForm={setEditForm} onSubmit={saveEdit} submitLabel="Save Changes" isEdit />
        </DialogContent>
      </Dialog>

      {/* Terminal */}
      {terminalOpen && activeServerId && (
        <TerminalDialog serverId={activeServerId} onClose={() => { setTerminalOpen(false); setActiveServerId(null); }} />
      )}
    </div>
  );
}

// ─── Shared server form ─────────────────────────────────────

function ServerForm({
  form, setForm, onSubmit, submitLabel, isEdit,
}: {
  form: FormData;
  setForm: (f: FormData) => void;
  onSubmit: () => void;
  submitLabel: string;
  isEdit?: boolean;
}) {
  return (
    <div className="space-y-3 mt-4">
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Name</label>
        <Input className="mt-1" value={form.name} onChange={(e: any) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="col-span-2">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Host</label>
          <Input className="mt-1" value={form.host} onChange={(e: any) => setForm({ ...form, host: e.target.value })} placeholder="192.168.1.1" />
        </div>
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Port</label>
          <Input className="mt-1" type="number" value={form.port} onChange={(e: any) => setForm({ ...form, port: parseInt(e.target.value) || 22 })} />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Username</label>
        <Input className="mt-1" value={form.username} onChange={(e: any) => setForm({ ...form, username: e.target.value })} />
      </div>
      <div>
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Auth Type</label>
        <div className="flex gap-2 mt-1">
          <Button size="sm" variant={form.authType === "password" ? "default" : "outline"} onClick={() => setForm({ ...form, authType: "password" })}>Password</Button>
          <Button size="sm" variant={form.authType === "key" ? "default" : "outline"} onClick={() => setForm({ ...form, authType: "key" })}>SSH Key</Button>
        </div>
      </div>
      {form.authType === "password" ? (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Password {isEdit && <span className="normal-case text-muted-foreground/60">(leave blank to keep current)</span>}
          </label>
          <Input className="mt-1" type="password" value={form.password} onChange={(e: any) => setForm({ ...form, password: e.target.value })} />
        </div>
      ) : (
        <div>
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Private Key {isEdit && <span className="normal-case text-muted-foreground/60">(leave blank to keep current)</span>}
          </label>
          <textarea
            className="mt-1 w-full rounded-md border border-border bg-card px-3 py-2 text-sm font-mono h-24 resize-none focus:outline-none focus:ring-1 focus:ring-ring"
            value={form.privateKey}
            onChange={(e) => setForm({ ...form, privateKey: e.target.value })}
            placeholder="-----BEGIN OPENSSH PRIVATE KEY-----"
          />
        </div>
      )}
      <div className="flex items-center gap-2">
        <input type="checkbox" id="hasDocker" checked={form.hasDocker} onChange={(e) => setForm({ ...form, hasDocker: e.target.checked })} className="accent-primary" />
        <label htmlFor="hasDocker" className="text-sm">This server runs Docker</label>
      </div>
      <Button className="w-full" onClick={onSubmit}>{submitLabel}</Button>
    </div>
  );
}

// ─── Terminal dialog (xterm.js with full addon stack) ───────

function TerminalDialog({ serverId, onClose }: { serverId: string; onClose: () => void }) {
  const termRef = useRef<HTMLDivElement>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let term: any = null;
    let fitAddon: any = null;
    let resizeHandler: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function init() {
      const { Terminal } = await import("@xterm/xterm");
      await import("@xterm/xterm/css/xterm.css");
      const { FitAddon } = await import("@xterm/addon-fit");

      if (!termRef.current) return;

      term = new Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cursorWidth: 2,
        cursorInactiveStyle: "outline",
        scrollback: 10000,
        smoothScrollDuration: 100,
        fastScrollSensitivity: 5,
        scrollOnUserInput: true,
        macOptionIsMeta: true,
        rightClickSelectsWord: true,
        altClickMovesCursor: true,
        convertEol: false,
        customGlyphs: true,
        drawBoldTextInBrightColors: true,
        minimumContrastRatio: 4.5,
        allowTransparency: true,
        theme: {
          background: "#0a0a0a",
          foreground: "#d4d4d4",
          cursor: "#22c55e",
          cursorAccent: "#0a0a0a",
          selectionBackground: "#22c55e40",
          selectionForeground: "#ffffff",
          selectionInactiveBackground: "#22c55e20",
          black: "#0a0a0a",
          red: "#ef4444",
          green: "#22c55e",
          yellow: "#eab308",
          blue: "#3b82f6",
          magenta: "#a855f7",
          cyan: "#06b6d4",
          white: "#d4d4d4",
          brightBlack: "#525252",
          brightRed: "#f87171",
          brightGreen: "#4ade80",
          brightYellow: "#facc15",
          brightBlue: "#60a5fa",
          brightMagenta: "#c084fc",
          brightCyan: "#22d3ee",
          brightWhite: "#fafafa",
          scrollbarSliderBackground: "#22c55e30",
          scrollbarSliderHoverBackground: "#22c55e50",
          scrollbarSliderActiveBackground: "#22c55e70",
        },
        fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Menlo', monospace",
        fontSize: 14,
        fontWeight: "400",
        fontWeightBold: "700",
        lineHeight: 1.2,
        letterSpacing: 0,
      });

      // Load addons
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // WebGL renderer for GPU-accelerated rendering
      try {
        const { WebglAddon } = await import("@xterm/addon-webgl");
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => { webgl.dispose(); });
        term.loadAddon(webgl);
      } catch {}

      // Clickable links
      try {
        const { WebLinksAddon } = await import("@xterm/addon-web-links");
        term.loadAddon(new WebLinksAddon());
      } catch {}

      // Unicode 11 support
      try {
        const { Unicode11Addon } = await import("@xterm/addon-unicode11");
        term.loadAddon(new Unicode11Addon());
        term.unicode.activeVersion = "11";
      } catch {}

      // Clipboard addon (OSC 52)
      try {
        const { ClipboardAddon } = await import("@xterm/addon-clipboard");
        term.loadAddon(new ClipboardAddon());
      } catch {}

      term.open(termRef.current);
      setTimeout(() => { try { fitAddon.fit(); } catch {} }, 50);

      // Clipboard: Ctrl+Shift+C = copy, Ctrl+V = paste
      term.attachCustomKeyEventHandler((e: KeyboardEvent) => {
        if (e.type !== "keydown") return true;

        // Ctrl+Shift+C → copy selection
        if (e.ctrlKey && e.shiftKey && e.key === "C") {
          const sel = term.getSelection();
          if (sel) navigator.clipboard.writeText(sel);
          return false;
        }

        // Ctrl+V → paste with bracket paste mode (so backspace works per-char)
        if (e.ctrlKey && (e.key === "v" || e.key === "V") && !e.shiftKey) {
          e.preventDefault();
          navigator.clipboard.readText().then((text: string) => {
            if (text && ws?.readyState === WebSocket.OPEN) {
              ws.send("\x1b[200~" + text + "\x1b[201~");
            }
          });
          return false;
        }

        return true;
      });

      // Connect WebSocket
      const token = localStorage.getItem("obb_token");
      const backendHost = window.location.hostname + ":3001";
      ws = new WebSocket(`ws://${backendHost}/ws/terminal?token=${token}&serverId=${serverId}`);
      ws.binaryType = "arraybuffer";

      term.write("\x1b[38;2;34;197;94m● Connecting...\x1b[0m\r\n");

      ws.onopen = () => {
        setConnected(true);
        const dims = fitAddon.proposeDimensions();
        if (dims) ws?.send(JSON.stringify({ type: "resize", cols: dims.cols, rows: dims.rows }));
      };

      ws.onmessage = (e: MessageEvent) => {
        if (e.data instanceof ArrayBuffer) {
          term.write(new Uint8Array(e.data));
        } else {
          term.write(e.data);
        }
      };

      ws.onerror = () => {
        term.write("\r\n\x1b[38;2;239;68;68m● Connection error\x1b[0m\r\n");
      };

      ws.onclose = (ev: CloseEvent) => {
        setConnected(false);
        const reason = ev.reason || (ev.code === 1006 ? "Connection lost" : `Disconnected (${ev.code})`);
        term.write(`\r\n\x1b[38;2;239;68;68m● ${reason}\x1b[0m\r\n`);
        term.write("\x1b[38;2;115;115;115mPress any key to reconnect or close the terminal.\x1b[0m\r\n");
      };

      // Send input to SSH
      term.onData((data: string) => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(data);
      });

      // Sync terminal size with SSH
      term.onResize(({ cols, rows }: { cols: number; rows: number }) => {
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "resize", cols, rows }));
        }
      });

      // Auto-resize on window resize + container resize
      resizeHandler = () => { try { fitAddon?.fit(); } catch {} };
      window.addEventListener("resize", resizeHandler);

      resizeObserver = new ResizeObserver(resizeHandler);
      resizeObserver.observe(termRef.current);

      term.focus();
    }

    init().catch(err => console.error("[Terminal] Init failed:", err));

    return () => {
      if (resizeHandler) window.removeEventListener("resize", resizeHandler);
      resizeObserver?.disconnect();
      ws?.close();
      term?.dispose();
    };
  }, [serverId]);

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 md:p-8">
      <div className="w-full max-w-6xl h-[85vh] bg-[#0a0a0a] border border-border rounded-lg overflow-hidden flex flex-col shadow-2xl shadow-black/50">
        {/* Title bar */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-[#111] shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <button onClick={onClose} className="w-3 h-3 rounded-full bg-red-500 hover:bg-red-400 transition-colors" title="Close" />
              <div className="w-3 h-3 rounded-full bg-yellow-500 opacity-50" />
              <div className={`w-3 h-3 rounded-full transition-colors ${connected ? "bg-green-500" : "bg-gray-600"}`} />
            </div>
            <div className="flex items-center gap-2 ml-2">
              <Terminal className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-mono text-muted-foreground">SSH Terminal</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground/50">
            <span>Ctrl+Shift+C: copy</span>
            <span>|</span>
            <span>Ctrl+V: paste</span>
            <span>|</span>
            <span>Ctrl+C: SIGINT</span>
          </div>
        </div>
        {/* Terminal */}
        <div ref={termRef} className="flex-1 min-h-0" />
      </div>
    </div>
  );
}
