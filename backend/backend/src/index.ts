import express from "express";
import cors from "cors";
import http from "http";
import httpProxy from "http-proxy";
import { env } from "./config/env";
import { authMiddleware } from "./middleware/auth";
import { setupTerminalWs } from "./modules/web-terminal/handler";
import { startHealthWorker } from "./modules/webhealth/worker";
import { getActiveTunnel } from "./modules/cloud-ide/routes";

import authRoutes from "./routes/auth";
import webhookRoutes from "./routes/webhooks";
import serverVaultRoutes from "./modules/server-vault/routes";
import testConnectionRoutes from "./modules/server-vault/test-connection";
import accessHubRoutes from "./modules/access-hub/routes";
import webhealthRoutes from "./modules/webhealth/routes";
import telemetryRoutes from "./modules/telemetry/routes";
import dockerWatcherRoutes from "./modules/docker-watcher/routes";
import cloudIdeRoutes, { ideProxyMiddleware } from "./modules/cloud-ide/routes";
import domainRoutes from "./modules/domains/routes";
import backupRoutes from "./modules/backups/routes";
import stackRoutes from "./modules/stacks/routes";
import { startBackupWorker } from "./modules/backups/worker";

const app = express();
const server = http.createServer(app);

// Middleware
app.use(cors({ origin: env.FRONTEND_URL, credentials: true }));
app.use(express.json({ limit: "10mb" }));

// Public routes
app.use("/api/auth", authRoutes);

// Agent telemetry ingestion (token-based auth, not JWT)
app.post("/api/telemetry/ingest", telemetryRoutes);

// Protected routes
app.use("/api/servers", authMiddleware, serverVaultRoutes);
app.use("/api/servers", authMiddleware, testConnectionRoutes);
app.use("/api/vault", authMiddleware, accessHubRoutes);
app.use("/api/health-checks", authMiddleware, webhealthRoutes);
app.use("/api/telemetry", authMiddleware, telemetryRoutes);
app.use("/api/containers", authMiddleware, dockerWatcherRoutes);
app.use("/api/webhooks", authMiddleware, webhookRoutes);
app.use("/api/ide", authMiddleware, cloudIdeRoutes);
app.use("/api/domains", authMiddleware, domainRoutes);
app.use("/api/stacks", authMiddleware, stackRoutes);
// Backup download accepts ?token= query param (browser can't send Auth header on direct links)
app.use("/api/backups", (req, res, next) => {
  if (!req.headers.authorization && req.query.token) {
    req.headers.authorization = `Bearer ${req.query.token}`;
  }
  authMiddleware(req, res, next);
}, backupRoutes);

// IDE proxy (HTTP)
app.use("/ide/proxy/:serverId", ideProxyMiddleware);

// Health endpoint
app.get("/api/health", (_req, res) => res.json({ status: "ok", version: "0.1.0" }));

// ─── WebSocket / Upgrade routing (centralized) ─────────────

// Terminal WS
setupTerminalWs(server);
const terminalWss = (setupTerminalWs as any)._wss;

// IDE WS proxy
const ideWsProxy = httpProxy.createProxyServer({ ws: true });
ideWsProxy.on("error", (err) => console.log(`[IDE WS] error: ${err.message}`));

// Single upgrade handler that routes to the right place
server.on("upgrade", (req, socket, head) => {
  const url = req.url || "";
  console.log(`[Upgrade] ${url}`);

  if (url.startsWith("/ws/terminal")) {
    // Terminal WebSocket
    if (terminalWss) {
      terminalWss.handleUpgrade(req, socket, head, (ws: any) => {
        terminalWss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  } else if (url.startsWith("/ide/proxy/")) {
    // IDE code-server WebSocket
    const match = url.match(/^\/ide\/proxy\/([^/]+)/);
    if (!match) { socket.destroy(); return; }

    const tunnel = getActiveTunnel(match[1]);
    if (!tunnel) { socket.destroy(); return; }

    // Keep full path — code-server uses --base-path and expects it
    ideWsProxy.ws(req, socket, head, {
      target: `http://127.0.0.1:${tunnel.localPort}`,
      changeOrigin: true,
    });
  }
  // Other upgrades: ignore (don't destroy — may be handled elsewhere)
});

// Start workers
startHealthWorker();
startBackupWorker();

server.listen(env.PORT, () => {
  console.log(`[OBB] OpsBigBro backend running on http://localhost:${env.PORT}`);
});
