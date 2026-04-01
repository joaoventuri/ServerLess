import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";
import { createProxyMiddleware } from "http-proxy-middleware";
import net from "net";

const router = Router();

// Track active tunnels: serverId -> { localPort, ssh, tcpServer }
const activeTunnels = new Map<string, { localPort: number; ssh: SSHClient; tcpServer: net.Server }>();

export function getActiveTunnel(serverId: string) {
  return activeTunnels.get(serverId);
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

function sshExec(ssh: SSHClient, cmd: string): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    ssh.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      stream.on("data", (d: Buffer) => { stdout += d.toString(); });
      stream.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      stream.on("close", () => resolve({ stdout: stdout.trim(), stderr: stderr.trim() }));
    });
  });
}

// Start IDE session
router.post("/start/:serverId", async (req: Request, res: Response) => {
  const { serverId } = req.params;

  if (activeTunnels.has(serverId)) {
    const { localPort } = activeTunnels.get(serverId)!;
    return res.json({ url: `/ide/proxy/${serverId}/`, localPort });
  }

  const server = await prisma.server.findFirst({
    where: { id: serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    const localPort = await findFreePort();
    const ssh = new SSHClient();

    await new Promise<void>((resolve, reject) => {
      ssh.on("ready", async () => {
        try {
          console.log(`[IDE] SSH connected to ${server.host}`);

          // 1. Diagnose
          const diag = await sshExec(ssh, 'which code-server 2>/dev/null && echo "HAS_CS" || echo "NO_CS"; which curl 2>/dev/null && echo "HAS_CURL" || echo "NO_CURL"');
          console.log(`[IDE] Diag: ${diag.stdout}`);

          const hasCs = diag.stdout.includes("HAS_CS");
          const hasCurl = diag.stdout.includes("HAS_CURL");

          // 2. Install if needed
          if (!hasCs) {
            if (!hasCurl) {
              return reject(new Error("code-server and curl are not installed on this server. SSH in and run: apt install curl -y"));
            }
            console.log(`[IDE] Installing code-server on ${server.host}...`);
            const install = await sshExec(ssh, 'curl -fsSL https://code-server.dev/install.sh | sh 2>&1');
            console.log(`[IDE] Install result: ${install.stdout.slice(-200)}`);
            if (install.stdout.includes("error") && !install.stdout.includes("code-server")) {
              return reject(new Error(`Failed to install code-server: ${install.stderr || install.stdout.slice(-300)}`));
            }
          }

          // 3. Kill old instances and start fresh
          await sshExec(ssh, 'pkill -f "code-server" 2>/dev/null; sleep 1');
          await sshExec(ssh, `nohup code-server --bind-addr 127.0.0.1:18080 --auth none --disable-telemetry > /tmp/code-server.log 2>&1 &`);

          // 4. Wait for code-server to be ready (up to 20s)
          let ready = false;
          for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            const check = await sshExec(ssh, 'curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18080 2>/dev/null || echo "0"');
            const code = check.stdout.trim();
            console.log(`[IDE] Health check ${i + 1}: HTTP ${code}`);
            if (code === "200" || code === "302") {
              ready = true;
              break;
            }
          }

          if (!ready) {
            const logs = await sshExec(ssh, 'cat /tmp/code-server.log 2>/dev/null | tail -10');
            return reject(new Error(`code-server did not start in time.\nLogs:\n${logs.stdout || logs.stderr || "No logs found"}`));
          }

          console.log(`[IDE] code-server ready on ${server.host}:18080. Tunnel -> localhost:${localPort}`);

          // 5. Create TCP tunnel
          const tcpServer = net.createServer((localSocket) => {
            ssh.forwardOut("127.0.0.1", 0, "127.0.0.1", 18080, (err, stream) => {
              if (err) { localSocket.destroy(); return; }
              localSocket.pipe(stream).pipe(localSocket);
            });
          });

          tcpServer.listen(localPort, "127.0.0.1", () => {
            activeTunnels.set(serverId, { localPort, ssh, tcpServer });
            resolve();
          });
        } catch (e) {
          reject(e);
        }
      });

      ssh.on("error", (err) => {
        reject(err);
      });

      const config: any = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 15000,
        keepaliveInterval: 5000,
      };
      if (server.authType === "key" && server.privateKey) {
        config.privateKey = server.privateKey;
      } else {
        config.password = server.password;
      }
      ssh.connect(config);
    });

    const { localPort: port } = activeTunnels.get(serverId)!;
    // Direct access to tunnel — no proxy needed, WS works natively
    res.json({ url: `http://localhost:${port}/`, localPort: port });
  } catch (err: any) {
    // Clean up on failure
    const tunnel = activeTunnels.get(serverId);
    if (tunnel) {
      tunnel.tcpServer.close();
      tunnel.ssh.end();
      activeTunnels.delete(serverId);
    }
    const msg = err.message || String(err);
    console.log(`[IDE] Error for ${server.host}: ${msg}`);
    res.status(502).json({ error: msg });
  }
});

// Stop IDE session
router.post("/stop/:serverId", async (req: Request, res: Response) => {
  const tunnel = activeTunnels.get(req.params.serverId);
  if (tunnel) {
    tunnel.tcpServer.close();
    tunnel.ssh.end();
    activeTunnels.delete(req.params.serverId);
  }
  res.json({ success: true });
});

// HTTP proxy middleware for IDE
export function ideProxyMiddleware(req: Request, res: Response) {
  const serverId = req.params.serverId;
  const tunnel = activeTunnels.get(serverId);

  if (!tunnel) {
    return res.status(404).send(errorPage(
      "No Active IDE Session",
      "Go back and click <strong>Launch IDE</strong> to start a session."
    ));
  }

  const proxy = createProxyMiddleware({
    target: `http://127.0.0.1:${tunnel.localPort}`,
    changeOrigin: true,
    ws: false, // WS handled separately via upgrade
    // No pathRewrite needed — code-server uses --base-path to expect the full path
    on: {
      error: (err, _req, res) => {
        (res as any).status?.(502).send?.(errorPage(
          "IDE Connection Failed",
          `code-server tunnel is not responding.<br><span style="color:#525252;font-size:11px">${err.message}</span>`
        ));
      },
    },
  });

  return proxy(req, res, () => {});
}


function errorPage(title: string, message: string) {
  return `<!DOCTYPE html>
<html><head><title>${title}</title></head>
<body style="background:#0a0a0a;color:#e5e5e5;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0">
  <div style="text-align:center;max-width:500px">
    <div style="width:48px;height:48px;border-radius:12px;background:rgba(239,68,68,0.1);display:flex;align-items:center;justify-content:center;margin:0 auto 16px">
      <svg width="24" height="24" fill="none" stroke="#ef4444" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
    </div>
    <h2 style="color:#ef4444;margin:0 0 8px">${title}</h2>
    <p style="color:#737373;margin:0;line-height:1.6">${message}</p>
  </div>
</body></html>`;
}

export default router;
