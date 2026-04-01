import { WebSocketServer, WebSocket } from "ws";
import { Server as HttpServer } from "http";
import { Client as SSHClient } from "ssh2";
import jwt from "jsonwebtoken";
import { env } from "../../config/env";
import { prisma } from "../../config/db";
import { AuthPayload } from "../../middleware/auth";

function formatSshError(err: any, host: string, port: number): string {
  const msg = err.message || String(err);
  if (msg.includes("ECONNREFUSED")) {
    return `Connection refused by ${host}:${port}. Verify SSH is running on that port.`;
  }
  if (msg.includes("ETIMEDOUT") || msg.includes("Timed out")) {
    return `Connection to ${host}:${port} timed out. Check firewall or host address.`;
  }
  if (msg.includes("ENOTFOUND")) {
    return `Host "${host}" not found. Check the hostname or IP.`;
  }
  if (msg.includes("Authentication") || msg.includes("auth")) {
    return `Authentication failed for ${host}:${port}. Check credentials.`;
  }
  return `SSH error (${host}:${port}): ${msg}`;
}

export function setupTerminalWs(server: HttpServer) {
  const wss = new WebSocketServer({ noServer: true });

  // Exported so index.ts can route upgrades
  (setupTerminalWs as any)._wss = wss;

  wss.on("connection", async (ws: WebSocket, req) => {
    console.log(`[WS Terminal] New connection from ${req.headers.origin || "unknown"}`);
    try {
      const url = new URL(req.url!, `http://${req.headers.host}`);
      const token = url.searchParams.get("token");
      const serverId = url.searchParams.get("serverId");

      if (!token || !serverId) {
        console.log("[WS Terminal] Missing token or serverId");
        ws.close(4001, "Missing token or serverId");
        return;
      }

      let payload: AuthPayload;
      try {
        payload = jwt.verify(token, env.JWT_SECRET) as AuthPayload;
      } catch {
        ws.close(4001, "Invalid token");
        return;
      }

      const serverRecord = await prisma.server.findFirst({
        where: { id: serverId, workspaceId: payload.workspaceId },
      });
      if (!serverRecord) {
        ws.close(4004, "Server not found");
        return;
      }

      const ssh = new SSHClient();
      console.log(`[WS Terminal] Connecting SSH to ${serverRecord.host}:${serverRecord.port} as ${serverRecord.username}`);

      ssh.on("ready", () => {
        console.log(`[WS Terminal] SSH ready for ${serverRecord.host}`);
        ssh.shell({ term: "xterm-256color", cols: 120, rows: 30 }, (err, stream) => {
          if (err) { ws.close(4500, "Shell error"); return; }

          stream.on("data", (data: Buffer) => {
            if (ws.readyState === WebSocket.OPEN) ws.send(data);
          });
          stream.on("close", () => ws.close());

          ws.on("message", (msg: Buffer) => {
            try {
              const parsed = JSON.parse(msg.toString());
              if (parsed.type === "resize" && parsed.cols && parsed.rows) {
                stream.setWindow(parsed.rows, parsed.cols, 0, 0);
                return;
              }
            } catch { /* not JSON, treat as input */ }
            stream.write(msg);
          });

          ws.on("close", () => { stream.close(); ssh.end(); });
        });
      });

      ssh.on("error", (err) => {
        console.log(`[WS Terminal] SSH error for ${serverRecord.host}: ${err.message}`);
        const msg = formatSshError(err, serverRecord.host, serverRecord.port);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(`\r\n\x1b[31mError: ${msg}\x1b[0m\r\n`);
        }
        ws.close(4500, msg.slice(0, 120));
      });

      const connectConfig: any = {
        host: serverRecord.host,
        port: serverRecord.port,
        username: serverRecord.username,
        readyTimeout: 10000,
        keepaliveInterval: 5000,
      };

      if (serverRecord.authType === "key" && serverRecord.privateKey) {
        connectConfig.privateKey = serverRecord.privateKey;
      } else {
        connectConfig.password = serverRecord.password;
      }

      ssh.connect(connectConfig);
    } catch (err: any) {
      ws.close(4500, err.message);
    }
  });
}
