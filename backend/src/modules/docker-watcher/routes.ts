import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";

const router = Router();

// ─── HELPERS ────────────────────────────────────────────────

function sshExec(server: any, cmd: string, timeoutMs = 30000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ssh = new SSHClient();
    const timer = setTimeout(() => { ssh.end(); reject(new Error("SSH timeout")); }, timeoutMs);

    ssh.on("ready", () => {
      ssh.exec(cmd, (err, stream) => {
        if (err) { clearTimeout(timer); ssh.end(); return reject(err); }
        let out = "";
        let errOut = "";
        stream.on("data", (d: Buffer) => { out += d.toString(); });
        stream.stderr.on("data", (d: Buffer) => { errOut += d.toString(); });
        stream.on("close", (code: number) => {
          clearTimeout(timer);
          ssh.end();
          if (code !== 0 && !out.trim()) return reject(new Error(errOut.trim() || `Exit code ${code}`));
          resolve(out.trim());
        });
      });
    });

    ssh.on("error", (err) => { clearTimeout(timer); reject(err); });

    const config: any = {
      host: server.host, port: server.port, username: server.username, readyTimeout: 10000,
    };
    if (server.authType === "key" && server.privateKey) config.privateKey = server.privateKey;
    else config.password = server.password;
    ssh.connect(config);
  });
}

async function getServer(serverId: string, workspaceId: string) {
  const server = await prisma.server.findFirst({
    where: { id: serverId, workspaceId },
  });
  if (!server) throw new Error("Server not found");
  return server;
}

function parseMem(s: string): number {
  s = s.trim();
  if (s.endsWith("GiB")) return parseFloat(s) * 1024;
  if (s.endsWith("MiB")) return parseFloat(s);
  if (s.endsWith("KiB")) return parseFloat(s) / 1024;
  return 0;
}

// ─── LIST CONTAINERS ────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const servers = await prisma.server.findMany({
    where: { workspaceId: req.auth!.workspaceId, hasDocker: true },
    select: { id: true },
  });
  const containers = await prisma.container.findMany({
    where: { serverId: { in: servers.map(s => s.id) } },
    include: { server: { select: { id: true, name: true, host: true } } },
    orderBy: { name: "asc" },
  });
  res.json(containers);
});

// ─── SCAN (SSH docker ps) ───────────────────────────────────

router.post("/scan", async (req: Request, res: Response) => {
  const servers = await prisma.server.findMany({
    where: { workspaceId: req.auth!.workspaceId, hasDocker: true },
  });
  if (servers.length === 0) return res.json({ scanned: 0, containers: 0, data: [] });

  let total = 0;
  const errors: string[] = [];

  for (const server of servers) {
    try {
      // Check if docker is installed
      const dockerCheck = await sshExec(server, `command -v docker 2>/dev/null || echo "__NOT_FOUND__"`).catch(() => "__NOT_FOUND__");
      if (dockerCheck.includes("__NOT_FOUND__")) {
        errors.push(`${server.name}: Docker is not installed on this server`);
        // Auto-disable docker flag
        await prisma.server.update({ where: { id: server.id }, data: { hasDocker: false } });
        continue;
      }

      // Check if docker daemon is running
      const daemonCheck = await sshExec(server, `docker info --format "{{.ServerVersion}}" 2>&1`).catch((e: any) => e.message || "");
      if (daemonCheck.includes("Cannot connect") || daemonCheck.includes("permission denied") || daemonCheck.includes("Is the docker daemon running")) {
        const reason = daemonCheck.includes("permission denied")
          ? "Permission denied — add user to docker group"
          : "Docker daemon is not running";
        errors.push(`${server.name}: ${reason}`);
        continue;
      }

      const psOut = await sshExec(server,
        `docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}|{{.Ports}}" 2>/dev/null`);
      const statsOut = await sshExec(server,
        `docker stats --no-stream --format "{{.ID}}|{{.CPUPerc}}|{{.MemUsage}}" 2>/dev/null`).catch(() => "");

      const statsMap = new Map<string, { cpu: number; ramUsage: number; ramLimit: number }>();
      for (const line of statsOut.split("\n")) {
        if (!line.trim()) continue;
        const [id, cpuStr, memStr] = line.split("|");
        if (!id) continue;
        const memParts = (memStr || "").split("/");
        statsMap.set(id.trim(), {
          cpu: parseFloat((cpuStr || "0").replace("%", "")) || 0,
          ramUsage: memParts[0] ? parseMem(memParts[0]) : 0,
          ramLimit: memParts[1] ? parseMem(memParts[1]) : 0,
        });
      }

      const containerIds: string[] = [];
      for (const line of psOut.split("\n")) {
        if (!line.trim()) continue;
        const [id, name, image, statusStr] = line.split("|");
        if (!id) continue;
        const cid = id.trim();
        containerIds.push(cid);

        let status = "running";
        const sl = (statusStr || "").toLowerCase();
        if (sl.includes("exited")) status = "exited";
        else if (sl.includes("paused")) status = "paused";
        else if (sl.includes("created")) status = "created";
        else if (sl.includes("restarting")) status = "restarting";

        const stats = statsMap.get(cid) || { cpu: 0, ramUsage: 0, ramLimit: 0 };

        await prisma.container.upsert({
          where: { serverId_containerId: { serverId: server.id, containerId: cid } },
          create: {
            serverId: server.id, containerId: cid, name: (name || "").trim(),
            image: (image || "").trim(), status,
            cpuPercent: stats.cpu, ramUsageMb: stats.ramUsage, ramLimitMb: stats.ramLimit,
          },
          update: {
            name: (name || "").trim(), image: (image || "").trim(), status,
            cpuPercent: stats.cpu, ramUsageMb: stats.ramUsage, ramLimitMb: stats.ramLimit,
            lastUpdatedAt: new Date(),
          },
        });
        total++;
      }

      // Remove stale
      if (containerIds.length > 0) {
        await prisma.container.deleteMany({
          where: { serverId: server.id, containerId: { notIn: containerIds } },
        });
      } else {
        await prisma.container.deleteMany({ where: { serverId: server.id } });
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      let friendly = msg;
      if (msg.includes("Exit code 127")) friendly = "Docker is not installed on this server";
      else if (msg.includes("Exit code 1") && msg.includes("permission")) friendly = "Permission denied — add user to docker group";
      else if (msg.includes("ECONNREFUSED")) friendly = "Connection refused — server unreachable";
      else if (msg.includes("ETIMEDOUT")) friendly = "Connection timed out";
      else if (msg.includes("authentication")) friendly = "SSH authentication failed";
      errors.push(`${server.name}: ${friendly}`);
    }
  }

  const all = await prisma.container.findMany({
    where: { serverId: { in: servers.map(s => s.id) } },
    include: { server: { select: { id: true, name: true, host: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ scanned: servers.length, containers: total, errors: errors.length ? errors : undefined, data: all });
});

// ─── CONTAINER ACTIONS ──────────────────────────────────────

router.post("/action", async (req: Request, res: Response) => {
  const { serverId, containerId, action } = req.body;
  const valid = ["start", "stop", "pause", "unpause", "restart", "remove"];
  if (!valid.includes(action)) return res.status(400).json({ error: `Invalid action. Use: ${valid.join(", ")}` });

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);
    const dockerCmd = action === "remove" ? `docker rm -f ${containerId}` : `docker ${action} ${containerId}`;
    const output = await sshExec(server, dockerCmd);

    if (action === "remove") {
      await prisma.container.deleteMany({ where: { serverId, containerId } });
    } else {
      // Rescan to update status in DB
      await quickRescan(server);
    }

    res.json({ success: true, output });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Generate docker-compose.yml from inspect data ──────────

function generateComposeFromInspect(c: {
  name: string; image: string; ports: any[]; env: any[];
  volumes: any[]; networks: string[]; restartPolicy: string;
  cmd: any; workingDir: string; labels: any;
}): string {
  const lines: string[] = [];
  lines.push("services:");
  lines.push(`  ${c.name}:`);
  lines.push(`    image: ${c.image}`);
  lines.push(`    container_name: ${c.name}`);

  if (c.restartPolicy && c.restartPolicy !== "no") {
    lines.push(`    restart: ${c.restartPolicy}`);
  }

  // Ports
  if (c.ports.length > 0) {
    lines.push("    ports:");
    for (const p of c.ports) {
      lines.push(`      - "${p.host}:${p.container}"`);
    }
  }

  // Environment
  if (c.env.length > 0) {
    lines.push("    environment:");
    for (const e of c.env) {
      // Escape values with special chars
      const val = e.value.includes(" ") || e.value.includes("#") || e.value.includes(":")
        ? `"${e.value.replace(/"/g, '\\"')}"`
        : e.value;
      lines.push(`      ${e.key}: ${val}`);
    }
  }

  // Volumes
  if (c.volumes.length > 0) {
    lines.push("    volumes:");
    for (const v of c.volumes) {
      lines.push(`      - ${v.name}:${v.destination}`);
    }
  }

  // Command
  if (c.cmd && Array.isArray(c.cmd) && c.cmd.length > 0) {
    const cmdStr = c.cmd.join(" ");
    // Skip default entrypoint commands
    if (!cmdStr.includes("docker-entrypoint")) {
      lines.push(`    command: ${cmdStr}`);
    }
  }

  // Working dir
  if (c.workingDir) {
    lines.push(`    working_dir: ${c.workingDir}`);
  }

  // Networks (non-default)
  const customNetworks = c.networks.filter(n => !["bridge", "host", "none"].includes(n));
  if (customNetworks.length > 0) {
    lines.push("    networks:");
    for (const n of customNetworks) {
      lines.push(`      - ${n}`);
    }
  }

  // Top-level volumes
  const namedVolumes = c.volumes.filter(v => v.type === "volume" || (!v.name.startsWith("/") && !v.name.startsWith(".")));
  if (namedVolumes.length > 0) {
    lines.push("");
    lines.push("volumes:");
    for (const v of namedVolumes) {
      lines.push(`  ${v.name}:`);
    }
  }

  // Top-level networks
  if (customNetworks.length > 0) {
    lines.push("");
    lines.push("networks:");
    for (const n of customNetworks) {
      lines.push(`  ${n}:`);
      lines.push(`    external: true`);
    }
  }

  return lines.join("\n");
}

// ─── CONTAINER INSPECT (full config) ────────────────────────

router.get("/inspect/:serverId/:containerName", async (req: Request, res: Response) => {
  const { serverId, containerName } = req.params;

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);

    // Full docker inspect
    const raw = await sshExec(server, `docker inspect ${containerName} 2>&1`);
    let data: any;
    try { data = JSON.parse(raw)[0]; } catch { return res.status(404).json({ error: "Container not found" }); }

    const config = data.Config || {};
    const hc = data.HostConfig || {};
    const ns = data.NetworkSettings || {};

    // Build port list
    const ports: { host: string; container: string; protocol: string }[] = [];
    for (const [cp, binds] of Object.entries(hc.PortBindings || {})) {
      const [port, proto] = cp.split("/");
      for (const b of (binds as any[]) || []) {
        ports.push({ host: b.HostPort, container: port, protocol: proto || "tcp" });
      }
    }

    // Build env list (filter builtins)
    const builtins = new Set(["PATH", "HOME", "HOSTNAME"]);
    const env: { key: string; value: string; builtin: boolean }[] = [];
    for (const e of config.Env || []) {
      const eq = e.indexOf("=");
      const key = eq > 0 ? e.slice(0, eq) : e;
      const value = eq > 0 ? e.slice(eq + 1) : "";
      env.push({ key, value, builtin: builtins.has(key) });
    }

    // Volumes
    const volumes: { name: string; destination: string; type: string }[] = [];
    for (const m of data.Mounts || []) {
      volumes.push({ name: m.Name || m.Source, destination: m.Destination, type: m.Type });
    }

    // Networks
    const networks = Object.keys(ns.Networks || {});

    const labels = config.Labels || {};
    const containerName = data.Name?.replace(/^\//, "") || containerName;
    const restartPolicy = hc.RestartPolicy?.Name || "no";

    // Try to find original docker-compose file
    let originalCompose = "";
    const composeProject = labels["com.docker.compose.project.working_dir"];
    const composeFile = labels["com.docker.compose.project.config_files"];
    if (composeProject || composeFile) {
      const path = composeFile || `${composeProject}/docker-compose.yml`;
      originalCompose = await sshExec(server, `cat "${path}" 2>/dev/null || cat "${composeProject}/docker-compose.yaml" 2>/dev/null || cat "${composeProject}/compose.yml" 2>/dev/null || echo ""`).catch(() => "");
    }

    // Always generate a compose from inspect data
    const generatedCompose = generateComposeFromInspect({
      name: containerName,
      image: config.Image,
      ports,
      env: env.filter(e => !e.builtin),
      volumes,
      networks,
      restartPolicy,
      cmd: config.Cmd,
      workingDir: config.WorkingDir,
      labels,
    });

    res.json({
      name: containerName,
      image: config.Image,
      status: data.State?.Status || "unknown",
      ports,
      env,
      volumes,
      networks,
      restartPolicy,
      cmd: config.Cmd,
      entrypoint: config.Entrypoint,
      workingDir: config.WorkingDir,
      labels,
      compose: generatedCompose,
      originalCompose: originalCompose || null,
      hasOriginalCompose: !!originalCompose,
      created: data.Created,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CONTAINER UPDATE (edit config + redeploy) ──────────────

router.post("/update/:serverId/:containerName", async (req: Request, res: Response) => {
  const { serverId, containerName } = req.params;
  const { image, ports, env, volumes, restartPolicy, networks, cmd, compose } = req.body;

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);

    // Delete old container record from DB (new one will have different ID)
    await prisma.container.deleteMany({ where: { serverId, name: containerName } });

    // If compose provided, write and deploy via compose
    if (compose && compose.trim()) {
      const composeDir = `/opt/obb-compose/${containerName}`;
      await sshExec(server, `mkdir -p "${composeDir}"`);
      await sshExec(server, `cat > "${composeDir}/docker-compose.yml" << 'CEOF'\n${compose}\nCEOF`);
      // --remove-orphans but NEVER -v (preserve volumes/data)
      await sshExec(server, `cd "${composeDir}" && docker compose down --remove-orphans 2>/dev/null; docker compose up -d 2>&1`, 120000);
      // Re-scan to pick up new containers
      await quickRescan(server);
      return res.json({ success: true, method: "compose", message: "Deployed via docker-compose" });
    }

    // Manual rebuild: stop old, recreate with new config
    // Get current image if not provided
    const currentImage = image || (await sshExec(server,
      `docker inspect ${containerName} --format '{{.Config.Image}}' 2>/dev/null`));

    // Stop and remove old
    await sshExec(server, `docker stop ${containerName} 2>/dev/null; docker rm ${containerName} 2>/dev/null`);

    // Pull latest
    await sshExec(server, `docker pull ${currentImage} 2>&1`, 120000);

    // Build run command
    let runCmd = `docker run -d --name "${containerName}"`;
    runCmd += ` --restart=${restartPolicy || "unless-stopped"}`;

    // Network
    if (networks?.length > 0) {
      const primary = networks.find((n: string) => !["bridge", "host", "none"].includes(n)) || networks[0];
      if (primary && primary !== "bridge") runCmd += ` --network=${primary}`;
    }

    // Ports
    for (const p of ports || []) {
      if (p.host && p.container) {
        runCmd += ` -p ${p.host}:${p.container}/${p.protocol || "tcp"}`;
      }
    }

    // Env
    for (const e of env || []) {
      if (e.key && !e.builtin) {
        const val = e.value.replace(/"/g, '\\"');
        runCmd += ` -e "${e.key}=${val}"`;
      }
    }

    // Volumes
    for (const v of volumes || []) {
      if (v.name && v.destination) {
        runCmd += ` -v "${v.name}:${v.destination}"`;
      }
    }

    runCmd += ` ${currentImage}`;
    if (cmd) runCmd += ` ${cmd}`;

    const output = await sshExec(server, runCmd + " 2>&1");

    // Connect to additional networks
    if (networks?.length > 1) {
      for (const net of networks.slice(1)) {
        if (!["bridge", "host", "none"].includes(net)) {
          await sshExec(server, `docker network connect ${net} ${containerName} 2>/dev/null || true`);
        }
      }
    }

    // Re-scan to pick up new container in DB
    await quickRescan(server);

    res.json({ success: true, method: "manual", containerId: output.trim().slice(0, 12) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Quick rescan single server ─────────────────────────────

async function quickRescan(server: any) {
  try {
    const psOut = await sshExec(server, `docker ps -a --format "{{.ID}}|{{.Names}}|{{.Image}}|{{.Status}}" 2>/dev/null`);
    for (const line of psOut.split("\n")) {
      if (!line.trim()) continue;
      const [id, name, image, statusStr] = line.split("|");
      if (!id) continue;
      const cid = id.trim();
      let status = "running";
      const sl = (statusStr || "").toLowerCase();
      if (sl.includes("exited")) status = "exited";
      else if (sl.includes("paused")) status = "paused";
      else if (sl.includes("created")) status = "created";

      await prisma.container.upsert({
        where: { serverId_containerId: { serverId: server.id, containerId: cid } },
        create: { serverId: server.id, containerId: cid, name: (name || "").trim(), image: (image || "").trim(), status },
        update: { name: (name || "").trim(), image: (image || "").trim(), status, lastUpdatedAt: new Date() },
      });
    }
  } catch { /* silent */ }
}

// ─── CONTAINER LOGS ─────────────────────────────────────────

router.get("/logs/:serverId/:containerId", async (req: Request, res: Response) => {
  const { serverId, containerId } = req.params;
  const tail = parseInt(req.query.tail as string) || 100;

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);
    const logs = await sshExec(server, `docker logs --tail ${tail} ${containerId} 2>&1`, 15000);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DEPLOY CONTAINER ───────────────────────────────────────

router.post("/deploy", async (req: Request, res: Response) => {
  const {
    serverId, image, name, ports, envVars, volumes, restart, command,
    registryUrl, registryUser, registryPass, network,
  } = req.body;

  if (!serverId || !image) return res.status(400).json({ error: "serverId and image are required" });

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);

    // Registry login if auth provided
    if (registryUser && registryPass) {
      const registry = registryUrl || "https://index.docker.io/v1/";
      await sshExec(server,
        `echo "${registryPass}" | docker login ${registry} -u "${registryUser}" --password-stdin 2>&1`);
    }

    // Pull image
    const pullOut = await sshExec(server, `docker pull ${image} 2>&1`, 120000);

    // Build docker run command
    let cmd = "docker run -d";
    if (name) cmd += ` --name "${name}"`;
    if (restart) cmd += ` --restart=${restart}`;
    if (network) cmd += ` --network=${network}`;

    // Ports: [{host: "8080", container: "80", protocol: "tcp"}]
    const validPorts = (ports || []).filter((p: any) => p.host && p.container);
    if (validPorts.length > 0) {
      for (const p of validPorts) {
        const proto = p.protocol || "tcp";
        cmd += ` -p ${p.host}:${p.container}/${proto}`;
      }
    } else {
      // Publish all exposed ports from Dockerfile automatically
      cmd += " -P";
    }

    // Env vars: [{key: "FOO", value: "bar"}]
    if (envVars && Array.isArray(envVars)) {
      for (const e of envVars) {
        if (e.key) cmd += ` -e "${e.key}=${e.value || ""}"`;
      }
    }

    // Volumes: [{host: "/data", container: "/app/data"}]
    if (volumes && Array.isArray(volumes)) {
      for (const v of volumes) {
        if (v.host && v.container) cmd += ` -v "${v.host}:${v.container}"`;
      }
    }

    cmd += ` ${image}`;
    if (command) cmd += ` ${command}`;

    const runOut = await sshExec(server, cmd + " 2>&1");

    res.json({ success: true, containerId: runOut.trim().slice(0, 12), pullOutput: pullOut, image });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REDEPLOY (remove old + deploy new) ─────────────────────

router.post("/redeploy", async (req: Request, res: Response) => {
  const { serverId, containerId } = req.body;
  if (!serverId || !containerId) return res.status(400).json({ error: "serverId and containerId required" });

  try {
    const server = await getServer(serverId, req.auth!.workspaceId);

    // Get current container info
    const info = await sshExec(server,
      `docker inspect ${containerId} --format '{{.Config.Image}}|{{.Name}}|{{json .HostConfig.PortBindings}}|{{json .Config.Env}}|{{json .HostConfig.Binds}}|{{.HostConfig.RestartPolicy.Name}}|{{.HostConfig.NetworkMode}}' 2>&1`);

    const [image, rawName] = info.split("|");
    const containerName = (rawName || "").replace(/^\//, "");

    // Pull latest
    await sshExec(server, `docker pull ${image} 2>&1`, 120000);

    // Stop and remove old
    await sshExec(server, `docker stop ${containerId} 2>/dev/null; docker rm ${containerId} 2>/dev/null`).catch(() => {});

    // Rebuild the same container using inspect data
    const inspectJson = await sshExec(server, `docker inspect ${containerId} 2>/dev/null`).catch(() => "");

    // Simpler approach: re-run with same image and name
    let cmd = `docker run -d`;
    if (containerName) cmd += ` --name "${containerName}"`;
    cmd += ` ${image}`;

    const newId = await sshExec(server, cmd + " 2>&1");

    await prisma.container.deleteMany({ where: { serverId, containerId } });

    res.json({ success: true, oldId: containerId, newId: newId.trim().slice(0, 12), image });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DOCKER NETWORKS ────────────────────────────────────────

router.get("/networks/:serverId", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.serverId, req.auth!.workspaceId);
    const out = await sshExec(server, `docker network ls --format "{{.Name}}" 2>/dev/null`);
    res.json(out.split("\n").filter(Boolean));
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── DOCKER IMAGES ON SERVER ────────────────────────────────

router.get("/images/:serverId", async (req: Request, res: Response) => {
  try {
    const server = await getServer(req.params.serverId, req.auth!.workspaceId);
    const out = await sshExec(server,
      `docker images --format "{{.Repository}}:{{.Tag}}|{{.Size}}|{{.ID}}|{{.CreatedSince}}" 2>/dev/null`);
    const images = out.split("\n").filter(Boolean).map(line => {
      const [repoTag, size, id, created] = line.split("|");
      return { repoTag, size, id: (id || "").slice(0, 12), created };
    });
    res.json(images);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REGISTRY SEARCH ────────────────────────────────────────

router.get("/registry/search", async (req: Request, res: Response) => {
  const query = req.query.q as string;
  const source = (req.query.source as string) || "dockerhub";
  const page = parseInt(req.query.page as string) || 1;
  if (!query) return res.status(400).json({ error: "q parameter required" });

  try {
    if (source === "dockerhub") {
      const resp = await fetch(
        `https://hub.docker.com/v2/search/repositories/?query=${encodeURIComponent(query)}&page=${page}&page_size=25`
      );
      const data = await resp.json();
      const results = (data.results || []).map((r: any) => ({
        name: r.repo_name,
        description: r.short_description || "",
        stars: r.star_count || 0,
        official: r.is_official || false,
        pulls: r.pull_count || 0,
        source: "dockerhub",
      }));
      res.json({ results, total: data.count || 0, page });
    } else if (source === "ghcr") {
      const resp = await fetch(
        `https://api.github.com/search/repositories?q=${encodeURIComponent(query)}+topic:docker&per_page=25&page=${page}`,
        { headers: { Accept: "application/vnd.github.v3+json", "User-Agent": "OpsBigBro" } }
      );
      const data = await resp.json();
      const results = (data.items || []).map((r: any) => ({
        name: `ghcr.io/${r.full_name}`,
        description: r.description || "",
        stars: r.stargazers_count || 0,
        official: false,
        pulls: 0,
        source: "ghcr",
        homepage: r.html_url,
      }));
      res.json({ results, total: data.total_count || 0, page });
    } else {
      res.status(400).json({ error: "source must be dockerhub or ghcr" });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── BROWSE POPULAR / CATEGORIES (Docker Hub) ───────────────

router.get("/registry/browse", async (req: Request, res: Response) => {
  const category = (req.query.category as string) || "";
  const page = parseInt(req.query.page as string) || 1;

  try {
    // Docker Hub extension API for browsing
    let url: string;
    if (category) {
      url = `https://hub.docker.com/v2/search/repositories/?query=&page=${page}&page_size=25&categories=${encodeURIComponent(category)}`;
    } else {
      // Trending / most popular
      url = `https://hub.docker.com/v2/repositories/library/?page=${page}&page_size=50&ordering=-pull_count`;
    }

    const resp = await fetch(url);
    const data = await resp.json();

    if (data.results) {
      const results = data.results.map((r: any) => ({
        name: r.repo_name || r.name || "",
        namespace: r.namespace || "library",
        description: r.short_description || r.description || "",
        stars: r.star_count || 0,
        official: r.is_official ?? (r.namespace === "library"),
        pulls: r.pull_count || 0,
        lastUpdated: r.last_updated || "",
        source: "dockerhub",
      })).sort((a: any, b: any) => b.pulls - a.pulls);
      res.json({ results, total: data.count || results.length, page });
    } else {
      res.json({ results: [], total: 0, page });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── IMAGE DETAIL (Docker Hub) ──────────────────────────────

router.get("/registry/detail/:name", async (req: Request, res: Response) => {
  const name = req.params.name;
  const ns = name.includes("/") ? name : `library/${name}`;

  try {
    const [repoResp, readmeResp] = await Promise.all([
      fetch(`https://hub.docker.com/v2/repositories/${ns}/`),
      fetch(`https://hub.docker.com/v2/repositories/${ns}/dockerfile/`).catch(() => null),
    ]);
    const repo = await repoResp.json();
    const dockerfile = readmeResp ? await readmeResp.json().catch(() => null) : null;

    res.json({
      name: repo.name,
      namespace: repo.namespace,
      fullName: `${repo.namespace}/${repo.name}`,
      description: repo.description || repo.short_description || "",
      stars: repo.star_count || 0,
      pulls: repo.pull_count || 0,
      lastUpdated: repo.last_updated || "",
      official: repo.namespace === "library",
      dockerfile: dockerfile?.contents || null,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── REGISTRY IMAGE TAGS ────────────────────────────────────

router.get("/registry/tags", async (req: Request, res: Response) => {
  const image = req.query.image as string;
  if (!image) return res.status(400).json({ error: "image parameter required" });

  try {
    // Docker Hub
    const parts = image.includes("/") ? image : `library/${image}`;
    // Get token
    const tokenResp = await fetch(`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${parts}:pull`);
    const tokenData = await tokenResp.json();
    const token = tokenData.token;

    const tagsResp = await fetch(`https://registry-1.docker.io/v2/${parts}/tags/list`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const tagsData = await tagsResp.json();
    const tags = (tagsData.tags || []).slice(0, 50);
    res.json(tags);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── INSPECT IMAGE CONFIG (ports, env, volumes) ─────────────

router.get("/registry/inspect", async (req: Request, res: Response) => {
  let image = req.query.image as string;
  if (!image) return res.status(400).json({ error: "image parameter required" });

  // Parse image:tag
  let tag = "latest";
  if (image.includes(":")) {
    const parts = image.split(":");
    tag = parts.pop()!;
    image = parts.join(":");
  }
  const repo = image.includes("/") ? image : `library/${image}`;

  try {
    // Get auth token
    const tokenResp = await fetch(
      `https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`
    );
    const { token } = await tokenResp.json();

    // Get manifest (fat manifest or v2)
    const manifestResp = await fetch(
      `https://registry-1.docker.io/v2/${repo}/manifests/${tag}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
        },
      }
    );
    let manifestData = await manifestResp.json();

    // If it's a manifest list (multi-arch), pick amd64/linux
    if (manifestData.manifests) {
      const amd64 = manifestData.manifests.find(
        (m: any) => m.platform?.architecture === "amd64" && m.platform?.os === "linux"
      ) || manifestData.manifests[0];
      if (amd64) {
        const innerResp = await fetch(
          `https://registry-1.docker.io/v2/${repo}/manifests/${amd64.digest}`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/vnd.docker.distribution.manifest.v2+json, application/vnd.oci.image.manifest.v1+json",
            },
          }
        );
        manifestData = await innerResp.json();
      }
    }

    // Get config blob
    const configDigest = manifestData.config?.digest;
    if (!configDigest) return res.json({ ports: [], env: [], volumes: [] });

    const configResp = await fetch(
      `https://registry-1.docker.io/v2/${repo}/blobs/${configDigest}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const configData = await configResp.json();
    const cfg = configData.config || configData.container_config || {};

    // Extract exposed ports: {"80/tcp": {}, "443/tcp": {}}
    const ports: { container: string; protocol: string }[] = [];
    if (cfg.ExposedPorts) {
      for (const key of Object.keys(cfg.ExposedPorts)) {
        const [port, proto] = key.split("/");
        ports.push({ container: port, protocol: proto || "tcp" });
      }
    }

    // Extract env vars: ["PATH=/usr/bin", "NGINX_VERSION=1.25"]
    const env: { key: string; value: string; builtin: boolean }[] = [];
    const builtinKeys = new Set(["PATH", "HOME", "HOSTNAME"]);
    if (cfg.Env && Array.isArray(cfg.Env)) {
      for (const e of cfg.Env) {
        const eqIdx = e.indexOf("=");
        const key = eqIdx > 0 ? e.slice(0, eqIdx) : e;
        const value = eqIdx > 0 ? e.slice(eqIdx + 1) : "";
        env.push({ key, value, builtin: builtinKeys.has(key) });
      }
    }

    // Extract volumes: {"/var/lib/mysql": {}}
    const volumes: string[] = [];
    if (cfg.Volumes) {
      for (const key of Object.keys(cfg.Volumes)) {
        volumes.push(key);
      }
    }

    // Cmd and Entrypoint
    const cmd = cfg.Cmd || [];
    const entrypoint = cfg.Entrypoint || [];

    res.json({ ports, env, volumes, cmd, entrypoint, workingDir: cfg.WorkingDir || "" });
  } catch (err: any) {
    res.status(500).json({ error: err.message, ports: [], env: [], volumes: [] });
  }
});

export default router;
