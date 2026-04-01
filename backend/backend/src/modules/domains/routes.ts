import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";
import { z } from "zod";

const router = Router();

// ─── SSH helpers ────────────────────────────────────────────

function sshExec(server: any, cmd: string, timeout = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const timer = setTimeout(() => { ssh.end(); reject(new Error("SSH timeout")); }, timeout);
    ssh.on("ready", () => {
      ssh.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); ssh.end(); return reject(err); }
        let out = "";
        stream.on("data", (d: Buffer) => { out += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { out += d.toString(); });
        stream.on("close", () => { clearTimeout(timer); ssh.end(); resolve(out.trim()); });
      });
    });
    ssh.on("error", (err) => { clearTimeout(timer); reject(err); });
    const cfg: any = { host: server.host, port: server.port, username: server.username, readyTimeout: 10000 };
    if (server.authType === "key" && server.privateKey) cfg.privateKey = server.privateKey;
    else cfg.password = server.password;
    ssh.connect(cfg);
  });
}

function sshWriteFile(server: any, path: string, content: string) {
  const b64 = Buffer.from(content).toString("base64");
  return sshExec(server, `printf '%s' '${b64}' | base64 -d > "${path}"`);
}

// ─── Traefik status on a server ─────────────────────────────

router.get("/traefik-status/:serverId", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    const out = await sshExec(server, [
      'INSTALLED=false; RUNNING=false; VERSION=""',
      'docker inspect obb-traefik --format "{{.State.Status}}" 2>/dev/null && RUNNING=true || true',
      'docker inspect obb-traefik --format "{{.Config.Image}}" 2>/dev/null || true',
      'test -f /opt/obb-traefik/docker-compose.yml && INSTALLED=true || true',
      'echo "---"',
      'docker ps --format "{{.Names}}|{{.Status}}" 2>/dev/null | grep traefik || echo "not-running"',
    ].join("; "));

    const lines = out.split("\n").map(l => l.trim()).filter(Boolean);
    const installed = out.includes("obb-traefik") || out.includes("/opt/obb-traefik");
    const statusLine = lines.find(l => l.includes("obb-traefik|")) || "";
    const running = statusLine.includes("Up");
    const image = lines.find(l => l.includes("traefik:")) || "";

    res.json({ installed, running, image, raw: statusLine });
  } catch (err: any) {
    res.json({ installed: false, running: false, error: err.message });
  }
});

// ─── Install Traefik on server ──────────────────────────────

router.post("/traefik-install/:serverId", async (req: Request, res: Response) => {
  const { email } = req.body;
  const server = await prisma.server.findFirst({
    where: { id: req.params.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    const acmeEmail = email || "admin@serverless.app";

    // Detect compose command
    const ccCheck = await sshExec(server, 'docker compose version 2>/dev/null && echo V2 || docker-compose version 2>/dev/null && echo V1 || echo NONE');
    const cc = ccCheck.includes("V2") ? "docker compose" : ccCheck.includes("V1") ? "docker-compose" : null;
    if (!cc) return res.status(400).json({ error: "docker-compose not found on this server" });

    const compose = `services:
  traefik:
    image: traefik:v3.4
    restart: unless-stopped
    container_name: obb-traefik
    command:
      - "--providers.file.directory=/etc/traefik/dynamic"
      - "--providers.file.watch=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=${acmeEmail}"
      - "--certificatesresolvers.letsencrypt.acme.storage=/letsencrypt/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock:ro
      - traefik_letsencrypt:/letsencrypt
      - ./traefik-dynamic:/etc/traefik/dynamic
    networks:
      - obb-proxy

networks:
  obb-proxy:
    name: obb-proxy

volumes:
  traefik_letsencrypt:
`;
    await sshExec(server, 'mkdir -p /opt/obb-traefik/traefik-dynamic');
    await sshWriteFile(server, "/opt/obb-traefik/docker-compose.yml", compose);
    await sshExec(server, 'docker network create obb-proxy 2>/dev/null || true');

    // Write empty routes if none exist
    await sshExec(server, 'test -f /opt/obb-traefik/traefik-dynamic/routes.yml || echo "{}" > /opt/obb-traefik/traefik-dynamic/routes.yml');

    const out = await sshExec(server, `cd /opt/obb-traefik && ${cc} pull 2>&1 && ${cc} up -d 2>&1`, 120000);
    res.json({ success: true, output: out });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Restart Traefik ────────────────────────────────────────

router.post("/traefik-restart/:serverId", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    await sshExec(server, 'docker restart obb-traefik 2>&1');
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Traefik logs ───────────────────────────────────────────

router.get("/traefik-logs/:serverId", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    const logs = await sshExec(server, 'docker logs --tail 50 obb-traefik 2>&1');
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CRUD Domains ───────────────────────────────────────────

const domainSchema = z.object({
  domain: z.string().min(3),
  containerName: z.string().min(1),
  containerPort: z.number().int().default(80),
  ssl: z.boolean().default(true),
  serverId: z.string().uuid(),
});

router.get("/", async (req: Request, res: Response) => {
  const domains = await prisma.domain.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    include: { server: { select: { id: true, name: true, host: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json(domains);
});

router.post("/", async (req: Request, res: Response) => {
  const data = domainSchema.parse(req.body);
  const server = await prisma.server.findFirst({
    where: { id: data.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const domain = await prisma.domain.create({
    data: { ...data, workspaceId: req.auth!.workspaceId },
  });

  // Auto-sync routes after adding
  await syncRoutes(server, req.auth!.workspaceId).catch(() => {});

  res.status(201).json(domain);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const domain = await prisma.domain.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!domain) return res.status(404).json({ error: "Not found" });

  const server = await prisma.server.findUnique({ where: { id: domain.serverId } });
  await prisma.domain.delete({ where: { id: domain.id } });

  if (server) await syncRoutes(server, req.auth!.workspaceId).catch(() => {});
  res.json({ success: true });
});

router.put("/:id/toggle", async (req: Request, res: Response) => {
  const domain = await prisma.domain.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!domain) return res.status(404).json({ error: "Not found" });

  await prisma.domain.update({ where: { id: domain.id }, data: { enabled: !domain.enabled } });
  const server = await prisma.server.findUnique({ where: { id: domain.serverId } });
  if (server) await syncRoutes(server, req.auth!.workspaceId).catch(() => {});
  res.json({ success: true, enabled: !domain.enabled });
});

// ─── Sync routes to Traefik (auto-called on CRUD) ──────────

async function syncRoutes(server: any, workspaceId: string) {
  const domains = await prisma.domain.findMany({
    where: { serverId: server.id, workspaceId, enabled: true },
  });

  // Generate Traefik dynamic config
  const routers: string[] = [];
  const services: string[] = [];

  for (const d of domains) {
    const id = d.domain.replace(/[^a-zA-Z0-9]/g, "-");

    // Always add HTTP router
    routers.push(`    ${id}-http:
      rule: "Host(\`${d.domain}\`)"
      service: "${id}"
      entryPoints:
        - web`);

    // HTTPS router with SSL
    if (d.ssl) {
      routers.push(`    ${id}-https:
      rule: "Host(\`${d.domain}\`)"
      service: "${id}"
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt`);
    }

    services.push(`    ${id}:
      loadBalancer:
        servers:
          - url: "http://${d.containerName}:${d.containerPort}"`);
  }

  const yaml = domains.length > 0
    ? `http:\n  routers:\n${routers.join("\n")}\n  services:\n${services.join("\n")}\n`
    : "{}";

  // Write config + connect containers to network + restart Traefik
  await sshWriteFile(server, "/opt/obb-traefik/traefik-dynamic/routes.yml", yaml);

  for (const d of domains) {
    await sshExec(server, `docker network connect obb-proxy ${d.containerName} 2>/dev/null || true`);
  }

  // Traefik watches the file, but restart to be safe
  await sshExec(server, 'docker restart obb-traefik 2>/dev/null || true');
}

// Manual sync endpoint
router.post("/sync/:serverId", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  try {
    await syncRoutes(server, req.auth!.workspaceId);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Domain health check / diagnostics ──────────────────────

router.post("/check/:id", async (req: Request, res: Response) => {
  const domain = await prisma.domain.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!domain) return res.status(404).json({ error: "Not found" });

  const server = await prisma.server.findUnique({ where: { id: domain.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const checks: { name: string; status: "ok" | "warn" | "fail"; message: string }[] = [];

  try {
    // 1. Traefik running?
    const traefikStatus = await sshExec(server, 'docker inspect obb-traefik --format "{{.State.Status}}" 2>/dev/null || echo "missing"');
    if (traefikStatus.includes("running")) {
      checks.push({ name: "Traefik", status: "ok", message: "Running" });
    } else {
      checks.push({ name: "Traefik", status: "fail", message: `Not running (${traefikStatus}). Click Install/Restart Traefik.` });
    }

    // 2. Container exists and running?
    const containerStatus = await sshExec(server, `docker inspect ${domain.containerName} --format "{{.State.Status}}" 2>/dev/null || echo "missing"`);
    if (containerStatus.includes("running")) {
      checks.push({ name: "Container", status: "ok", message: `${domain.containerName} is running` });
    } else {
      checks.push({ name: "Container", status: "fail", message: `${domain.containerName} is ${containerStatus}` });
    }

    // 3. Container on obb-proxy network?
    const networks = await sshExec(server, `docker inspect ${domain.containerName} --format "{{json .NetworkSettings.Networks}}" 2>/dev/null || echo "{}"`);
    if (networks.includes("obb-proxy")) {
      checks.push({ name: "Network", status: "ok", message: "Container is on obb-proxy network" });
    } else {
      checks.push({ name: "Network", status: "fail", message: "Container is NOT on obb-proxy network. Will auto-fix on sync." });
    }

    // 4. Internal connectivity (Traefik → container)
    const internal = await sshExec(server,
      `docker exec obb-traefik sh -c "wget -qO- --timeout=3 http://${domain.containerName}:${domain.containerPort}/ 2>&1 | head -1" 2>&1 || echo "UNREACHABLE"`);
    if (internal.includes("UNREACHABLE") || internal.includes("bad address")) {
      checks.push({ name: "Internal", status: "fail", message: `Traefik cannot reach ${domain.containerName}:${domain.containerPort}` });
    } else {
      checks.push({ name: "Internal", status: "ok", message: `Traefik can reach ${domain.containerName}:${domain.containerPort}` });
    }

    // 5. DNS resolves to this server?
    // Check DNS using multiple methods
    const dns = await sshExec(server,
      `dig +short ${domain.domain} 2>/dev/null | head -1 || getent hosts ${domain.domain} 2>/dev/null | awk '{print $1}' || nslookup ${domain.domain} 2>/dev/null | grep -A1 "Name:" | grep Address | awk '{print $2}' || curl -s --max-time 3 -o /dev/null -w "%{remote_ip}" http://${domain.domain} 2>/dev/null`);
    const resolvedIp = dns.trim().split("\n").pop()?.trim() || "";
    if (resolvedIp && resolvedIp.match(/^\d+\.\d+\.\d+\.\d+$/)) {
      if (resolvedIp === server.host) {
        checks.push({ name: "DNS", status: "ok", message: `${domain.domain} → ${resolvedIp}` });
      } else {
        checks.push({ name: "DNS", status: "warn", message: `${domain.domain} → ${resolvedIp} (server is ${server.host})` });
      }
    } else {
      // DNS check failed but HTTP works = DNS is fine, tool just couldn't resolve
      checks.push({ name: "DNS", status: "warn", message: `Could not verify DNS from server. If the domain loads in browser, DNS is correct.` });
    }

    // 6. HTTP accessible from outside?
    const httpCheck = await sshExec(server,
      `curl -s -o /dev/null -w "%{http_code}" -H "Host: ${domain.domain}" --max-time 5 http://localhost 2>&1`);
    if (httpCheck === "200" || httpCheck === "301" || httpCheck === "302") {
      checks.push({ name: "HTTP", status: "ok", message: `HTTP returns ${httpCheck}` });
    } else {
      checks.push({ name: "HTTP", status: "fail", message: `HTTP returns ${httpCheck}. Check Traefik routes.` });
    }

    // 7. SSL certificate?
    if (domain.ssl) {
      const sslCheck = await sshExec(server,
        `curl -s -o /dev/null -w "%{http_code}" --max-time 5 https://${domain.domain} 2>&1 || echo "0"`);
      if (sslCheck === "200" || sslCheck === "301" || sslCheck === "302") {
        checks.push({ name: "SSL", status: "ok", message: "HTTPS working" });
      } else {
        const sslErr = await sshExec(server,
          `curl -sv --max-time 5 https://${domain.domain} 2>&1 | grep -i "ssl\\|certificate\\|error" | head -3`);
        checks.push({ name: "SSL", status: "warn", message: `HTTPS returns ${sslCheck}. Certificate may still be issuing (wait 1-2 min). ${sslErr.slice(0, 100)}` });
      }
    }
  } catch (err: any) {
    checks.push({ name: "Error", status: "fail", message: err.message });
  }

  res.json({ domain: domain.domain, checks });
});

export default router;
