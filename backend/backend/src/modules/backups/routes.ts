import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";
import { z } from "zod";
import { backupQueue, startBackupWorker } from "./worker";

const router = Router();

// ─── SSH helper ─────────────────────────────────────────────

function sshExec(server: any, cmd: string, timeout = 6000000000): Promise<string> {
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

// Stream file from one server to another via backend relay
function sshStreamTransfer(src: any, dst: any, remotePath: string, destPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const sshSrc = new SSHClient();
    const sshDst = new SSHClient();
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      sshSrc.end();
      sshDst.end();
      err ? reject(err) : resolve();
    };

    sshDst.on("ready", () => {
      sshDst.exec(`cat > "${destPath}"`, (err, writeStream) => {
        if (err) return finish(err);

        sshSrc.on("ready", () => {
          sshSrc.exec(`cat "${remotePath}"`, (err2, readStream) => {
            if (err2) return finish(err2);
            readStream.pipe(writeStream);
            readStream.on("error", finish);
            writeStream.on("error", finish);
            writeStream.on("close", () => finish());
          });
        });
        sshSrc.on("error", finish);
        const srcCfg: any = { host: src.host, port: src.port, username: src.username, readyTimeout: 10000 };
        if (src.authType === "key" && src.privateKey) srcCfg.privateKey = src.privateKey;
        else srcCfg.password = src.password;
        sshSrc.connect(srcCfg);
      });
    });
    sshDst.on("error", finish);
    const dstCfg: any = { host: dst.host, port: dst.port, username: dst.username, readyTimeout: 10000 };
    if (dst.authType === "key" && dst.privateKey) dstCfg.privateKey = dst.privateKey;
    else dstCfg.password = dst.password;
    sshDst.connect(dstCfg);
  });
}

// ─── Generate docker-compose.yml from container inspect ─────

function generateCompose(c: any): string {
  const lines: string[] = [];
  lines.push("services:");
  lines.push(`  ${c.name}:`);
  lines.push(`    image: ${c.image}`);
  lines.push(`    container_name: ${c.name}`);

  if (c.restartPolicy && c.restartPolicy !== "no") {
    lines.push(`    restart: ${c.restartPolicy}`);
  }

  // Ports
  const portEntries = Object.entries(c.ports || {});
  if (portEntries.length > 0) {
    lines.push("    ports:");
    for (const [containerPort, hostPorts] of portEntries) {
      for (const hp of (hostPorts as string[])) {
        lines.push(`      - "${hp}:${containerPort.split("/")[0]}"`);
      }
    }
  }

  // Environment
  if (c.env && c.env.length > 0) {
    lines.push("    environment:");
    for (const e of c.env) {
      // Use list format to preserve special chars
      lines.push(`      - ${e}`);
    }
  }

  // Volumes
  const allVols: string[] = [];
  for (const v of c.volumes || []) {
    allVols.push(`${v.name}:${v.destination}`);
  }
  for (const b of c.binds || []) {
    allVols.push(b);
  }
  if (allVols.length > 0) {
    lines.push("    volumes:");
    for (const v of allVols) {
      lines.push(`      - ${v}`);
    }
  }

  // Command
  if (c.cmd && Array.isArray(c.cmd) && c.cmd.length > 0) {
    const cmdStr = c.cmd.join(" ");
    if (!cmdStr.includes("docker-entrypoint")) {
      lines.push(`    command: ${cmdStr}`);
    }
  }

  // Entrypoint
  if (c.entrypoint && Array.isArray(c.entrypoint) && c.entrypoint.length > 0) {
    const ep = c.entrypoint.join(" ");
    if (!ep.includes("docker-entrypoint")) {
      lines.push(`    entrypoint: [${c.entrypoint.map((e: string) => `"${e}"`).join(", ")}]`);
    }
  }

  // Working dir
  if (c.workingDir) {
    lines.push(`    working_dir: ${c.workingDir}`);
  }

  // Networks
  const customNets = (c.networks || []).filter((n: string) => !["bridge", "host", "none"].includes(n));
  if (customNets.length > 0) {
    lines.push("    networks:");
    for (const n of customNets) {
      lines.push(`      - ${n}`);
    }
  }

  // Top-level volumes
  const namedVols = (c.volumes || []).filter((v: any) => !v.name.startsWith("/") && !v.name.startsWith("."));
  if (namedVols.length > 0) {
    lines.push("");
    lines.push("volumes:");
    for (const v of namedVols) {
      lines.push(`  ${v.name}:`);
    }
  }

  // Top-level networks
  if (customNets.length > 0) {
    lines.push("");
    lines.push("networks:");
    for (const n of customNets) {
      lines.push(`  ${n}:`);
      lines.push(`    external: true`);
    }
  }

  return lines.join("\n");
}

// Generate a combined stack compose for all containers
function generateStackCompose(containers: any[], networks: string[]): string {
  const lines: string[] = [];
  lines.push("services:");

  for (const c of containers) {
    lines.push(`  ${c.name}:`);
    lines.push(`    image: ${c.image}`);
    lines.push(`    container_name: ${c.name}`);

    if (c.restartPolicy && c.restartPolicy !== "no") {
      lines.push(`    restart: ${c.restartPolicy}`);
    }

    const portEntries = Object.entries(c.ports || {});
    if (portEntries.length > 0) {
      lines.push("    ports:");
      for (const [containerPort, hostPorts] of portEntries) {
        for (const hp of (hostPorts as string[])) {
          lines.push(`      - "${hp}:${containerPort.split("/")[0]}"`);
        }
      }
    }

    if (c.env && c.env.length > 0) {
      lines.push("    environment:");
      for (const e of c.env) {
        lines.push(`      - ${e}`);
      }
    }

    const allVols: string[] = [];
    for (const v of c.volumes || []) {
      allVols.push(`${v.name}:${v.destination}`);
    }
    for (const b of c.binds || []) {
      allVols.push(b);
    }
    if (allVols.length > 0) {
      lines.push("    volumes:");
      for (const v of allVols) {
        lines.push(`      - ${v}`);
      }
    }

    if (c.cmd && Array.isArray(c.cmd) && c.cmd.length > 0) {
      const cmdStr = c.cmd.join(" ");
      if (!cmdStr.includes("docker-entrypoint")) {
        lines.push(`    command: ${cmdStr}`);
      }
    }

    if (c.entrypoint && Array.isArray(c.entrypoint) && c.entrypoint.length > 0) {
      const ep = c.entrypoint.join(" ");
      if (!ep.includes("docker-entrypoint")) {
        lines.push(`    entrypoint: [${c.entrypoint.map((e: string) => `"${e}"`).join(", ")}]`);
      }
    }

    if (c.workingDir) {
      lines.push(`    working_dir: ${c.workingDir}`);
    }

    const customNets = (c.networks || []).filter((n: string) => !["bridge", "host", "none"].includes(n));
    if (customNets.length > 0) {
      lines.push("    networks:");
      for (const n of customNets) {
        lines.push(`      - ${n}`);
      }
    }

    lines.push(""); // blank line between services
  }

  // Top-level volumes
  const allNamedVols = new Set<string>();
  for (const c of containers) {
    for (const v of c.volumes || []) {
      if (!v.name.startsWith("/") && !v.name.startsWith(".")) {
        allNamedVols.add(v.name);
      }
    }
  }
  if (allNamedVols.size > 0) {
    lines.push("volumes:");
    for (const v of allNamedVols) {
      lines.push(`  ${v}:`);
    }
    lines.push("");
  }

  // Top-level networks
  if (networks.length > 0) {
    lines.push("networks:");
    for (const n of networks) {
      lines.push(`  ${n}:`);
      lines.push(`    external: true`);
    }
  }

  return lines.join("\n");
}

// ─── Inspect a container and return structured data ─────────

async function inspectContainer(server: any, name: string) {
  const inspect = await sshExec(server, `docker inspect ${name} 2>&1`);
  let containerData: any;
  try {
    containerData = JSON.parse(inspect)[0];
  } catch {
    throw new Error(`Container "${name}" not found or inspect failed`);
  }

  const config = containerData.Config || {};
  const hostConfig = containerData.HostConfig || {};
  const networkSettings = containerData.NetworkSettings || {};

  const result: any = {
    name: containerData.Name?.replace(/^\//, "") || name,
    image: config.Image,
    env: config.Env || [],
    cmd: config.Cmd,
    entrypoint: config.Entrypoint,
    workingDir: config.WorkingDir,
    labels: config.Labels || {},
    ports: {},
    volumes: [],
    binds: hostConfig.Binds || [],
    restartPolicy: hostConfig.RestartPolicy?.Name || "no",
    networkMode: hostConfig.NetworkMode || "bridge",
    networks: Object.keys(networkSettings.Networks || {}),
  };

  // Port mappings
  const portBindings = hostConfig.PortBindings || {};
  for (const [containerPort, bindings] of Object.entries(portBindings)) {
    if (Array.isArray(bindings) && bindings.length > 0) {
      result.ports[containerPort] = (bindings as any[]).map(b => b.HostPort);
    }
  }

  // Mounts — both named volumes and bind mounts
  for (const mount of containerData.Mounts || []) {
    if (mount.Type === "volume" && mount.Name) {
      result.volumes.push({
        name: mount.Name,
        destination: mount.Destination,
        driver: mount.Driver || "local",
        type: "volume",
      });
    } else if (mount.Type === "bind" && mount.Source) {
      result.volumes.push({
        name: mount.Source,          // host path e.g. /opt/app/data
        destination: mount.Destination, // container path e.g. /data
        type: "bind",
      });
    }
  }

  // Deduplicate: remove from binds[] anything already captured in volumes[]
  const capturedBinds = new Set(result.volumes.filter((v: any) => v.type === "bind").map((v: any) => `${v.name}:${v.destination}`));
  result.binds = (result.binds || []).filter((b: string) => !capturedBinds.has(b));

  return result;
}

// ─── List backups ───────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const backups = await prisma.backup.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json(backups);
});

// ─── Create backup (export) — Snapshot v2 ───────────────────
//
// .opsbigbro v2 archive structure:
//   /manifest.json                      → metadata, full container configs
//   /compose/<container>/docker-compose.yml → per-container compose, ready to deploy
//   /compose/stack-compose.yml          → combined all-in-one compose
//   /volumes/<name>.tar                 → each volume tarball with actual data
//
// Everything packed into a single .tar.gz renamed to .opsbigbro

const exportSchema = z.object({
  name: z.string().min(1),
  serverId: z.string().uuid(),
  containerNames: z.array(z.string()).min(1),
  type: z.enum(["single", "stack"]).default("single"),
});

router.post("/export", async (req: Request, res: Response) => {
  const data = exportSchema.parse(req.body);

  const server = await prisma.server.findFirst({
    where: { id: data.serverId, workspaceId: req.auth!.workspaceId, hasDocker: true },
  });
  if (!server) return res.status(404).json({ error: "Server not found or Docker not enabled" });

  const backup = await prisma.backup.create({
    data: {
      name: data.name,
      type: data.type,
      containerIds: data.containerNames,
      serverId: server.id,
      serverName: server.name,
      status: "running",
      workspaceId: req.auth!.workspaceId,
    },
  });

  // Run backup in background
  runExport(backup.id, server, data.containerNames).catch(async (err) => {
    await prisma.backup.update({
      where: { id: backup.id },
      data: { status: "failed", error: err.message },
    });
  });

  res.status(201).json(backup);
});

async function runExport(backupId: string, server: any, containerNames: string[]) {
  const backupDir = `/opt/obb-backups/${backupId}`;
  const outputFile = `/opt/obb-backups/${backupId}.opsbigbro`;

  try {
    await sshExec(server, `mkdir -p ${backupDir}/volumes ${backupDir}/compose`);

    const manifest: any = {
      version: "2.0",
      createdAt: new Date().toISOString(),
      source: { server: server.name, host: server.host },
      containers: [],
      networks: [],
    };

    for (const name of containerNames) {
      const containerManifest = await inspectContainer(server, name);

      // Try to grab the original compose from server if it exists
      let originalCompose = "";
      const composeLabels = containerManifest.labels || {};
      const composeDir = composeLabels["com.docker.compose.project.working_dir"];
      if (composeDir) {
        try {
          originalCompose = await sshExec(server, `cat "${composeDir}/docker-compose.yml" 2>/dev/null || cat "${composeDir}/compose.yml" 2>/dev/null || true`);
          if (originalCompose.includes("No such file")) originalCompose = "";
        } catch { /* ignore */ }
      }
      // Also check obb-compose dir
      if (!originalCompose) {
        try {
          originalCompose = await sshExec(server, `cat "/opt/obb-compose/${name}/docker-compose.yml" 2>/dev/null || true`);
          if (originalCompose.includes("No such file")) originalCompose = "";
        } catch { /* ignore */ }
      }

      containerManifest.originalCompose = originalCompose || null;

      // Generate compose from inspect data
      const generatedCompose = generateCompose(containerManifest);
      containerManifest.generatedCompose = generatedCompose;

      // Write per-container compose to archive
      await sshExec(server, `mkdir -p "${backupDir}/compose/${name}"`);
      const composeContent = originalCompose || generatedCompose;
      const b64 = Buffer.from(composeContent).toString("base64");
      await sshExec(server, `printf '%s' '${b64}' | base64 -d > "${backupDir}/compose/${name}/docker-compose.yml"`);

      // Export volumes and bind mounts
      for (const vol of containerManifest.volumes) {
        // Sanitize name for tar filename (replace / with ___)
        const safeName = vol.type === "bind" ? vol.name.replace(/\//g, "___") : vol.name;

        if (vol.type === "bind") {
          // Bind mount: tar the host directory directly
          await sshExec(server,
            `test -d "${vol.name}" && tar cf "${backupDir}/volumes/${safeName}.tar" -C "${vol.name}" . 2>&1 || echo "SKIP: ${vol.name} not a directory"`,
            300000);
        } else {
          // Named volume: use alpine container to read volume data
          await sshExec(server,
            `docker run --rm -v ${vol.name}:/data -v ${backupDir}/volumes:/backup alpine tar cf /backup/${safeName}.tar -C /data . 2>&1`,
            300000);
        }
        vol.tarName = safeName; // store tar filename in manifest
      }

      // Also tar any remaining raw binds not captured in volumes
      for (const bind of containerManifest.binds || []) {
        const parts = bind.split(":");
        if (parts.length >= 2) {
          const hostPath = parts[0];
          const safeName = hostPath.replace(/\//g, "___");
          await sshExec(server,
            `test -d "${hostPath}" && tar cf "${backupDir}/volumes/${safeName}.tar" -C "${hostPath}" . 2>&1 || echo "SKIP: ${hostPath} not found"`,
            300000);
        }
      }

      manifest.containers.push(containerManifest);
    }

    // Discover shared networks
    const networkSet = new Set<string>();
    for (const c of manifest.containers) {
      for (const n of c.networks) {
        if (!["bridge", "host", "none"].includes(n)) networkSet.add(n);
      }
    }
    manifest.networks = Array.from(networkSet);

    // Generate combined stack compose
    const stackCompose = generateStackCompose(manifest.containers, manifest.networks);
    manifest.stackCompose = stackCompose;
    const stackB64 = Buffer.from(stackCompose).toString("base64");
    await sshExec(server, `printf '%s' '${stackB64}' | base64 -d > "${backupDir}/compose/stack-compose.yml"`);

    // Write manifest via base64 to preserve all characters
    const manifestB64 = Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64");
    await sshExec(server, `printf '%s' '${manifestB64}' | base64 -d > "${backupDir}/manifest.json"`);

    // Pack into .opsbigbro (tar.gz)
    await sshExec(server,
      `cd ${backupDir} && tar czf ${outputFile} manifest.json compose/ volumes/ 2>&1`,
      300000);

    // Get file size
    const sizeOut = await sshExec(server, `du -sm ${outputFile} | awk '{print $1}'`);
    const sizeMb = parseFloat(sizeOut) || 0;

    // Cleanup temp dir
    await sshExec(server, `rm -rf ${backupDir}`);

    // Count total volumes
    const totalVolumes = manifest.containers.reduce((a: number, c: any) => a + (c.volumes?.length || 0), 0);

    await prisma.backup.update({
      where: { id: backupId },
      data: {
        status: "completed",
        fileName: outputFile,
        fileSizeMb: sizeMb,
        metadata: JSON.stringify(manifest),
        completedAt: new Date(),
      },
    });
  } catch (err: any) {
    await sshExec(server, `rm -rf ${backupDir} ${outputFile}`).catch(() => {});
    throw err;
  }
}

// ─── Download backup ────────────────────────────────────────

router.get("/download/:id", async (req: Request, res: Response) => {
  const backup = await prisma.backup.findFirst({
    where: { id: req.params.id as string, workspaceId: req.auth!.workspaceId, status: "completed" },
  });
  if (!backup || !backup.fileName) return res.status(404).json({ error: "Backup not found" });

  const server = await prisma.server.findUnique({ where: { id: backup.serverId } });
  if (!server) return res.status(404).json({ error: "Source server not found" });

  const ssh = new SSHClient();
  ssh.on("ready", () => {
    ssh.exec(`cat "${backup.fileName}"`, (err, stream) => {
      if (err) { res.status(500).json({ error: err.message }); ssh.end(); return; }
      res.setHeader("Content-Type", "application/octet-stream");
      res.setHeader("Content-Disposition", `attachment; filename="${backup.name}.opsbigbro"`);
      if (backup.fileSizeMb) res.setHeader("Content-Length", String(Math.round(backup.fileSizeMb * 1024 * 1024)));
      stream.pipe(res);
      stream.on("close", () => ssh.end());
    });
  });
  ssh.on("error", (err) => res.status(500).json({ error: err.message }));
  const cfg: any = { host: server.host, port: server.port, username: server.username, readyTimeout: 10000 };
  if (server.authType === "key" && server.privateKey) cfg.privateKey = server.privateKey;
  else cfg.password = server.password;
  ssh.connect(cfg);
});

// ─── Import backup (restore) — Snapshot v2 ──────────────────
//
// Restore flow:
//   1. Transfer archive to target server (same or cross-server)
//   2. Extract archive
//   3. Create networks
//   4. Restore volumes from tar
//   5. Deploy via docker-compose (per-container or stack)

const importSchema = z.object({
  backupId: z.string().uuid(),
  targetServerId: z.string().uuid(),
  mode: z.enum(["stack", "individual"]).default("stack"),
});

router.post("/import", async (req: Request, res: Response) => {
  const { backupId, targetServerId, mode } = importSchema.parse(req.body);

  const backup = await prisma.backup.findFirst({
    where: { id: backupId, workspaceId: req.auth!.workspaceId, status: "completed" },
  });
  if (!backup || !backup.metadata) return res.status(404).json({ error: "Backup not found" });

  const sourceServer = await prisma.server.findUnique({ where: { id: backup.serverId } });
  const targetServer = await prisma.server.findFirst({
    where: { id: targetServerId, workspaceId: req.auth!.workspaceId, hasDocker: true },
  });
  if (!sourceServer) return res.status(404).json({ error: "Source server not found" });
  if (!targetServer) return res.status(404).json({ error: "Target server not found" });

  try {
    const manifest = JSON.parse(backup.metadata);
    const restoreDir = `/opt/obb-backups/restore-${backup.id}`;

    // Step 1: Transfer archive to target
    if (sourceServer.id === targetServer.id) {
      await sshExec(targetServer, `mkdir -p ${restoreDir} && cd ${restoreDir} && tar xzf ${backup.fileName}`, 300000000);
    } else {
      // Cross-server: stream through backend
      const remoteTmp = `/opt/obb-backups/${backup.id}.opsbigbro`;
      await sshExec(targetServer, `mkdir -p /opt/obb-backups`);
      await sshStreamTransfer(sourceServer, targetServer, backup.fileName!, remoteTmp);
      await sshExec(targetServer, `mkdir -p ${restoreDir} && cd ${restoreDir} && tar xzf ${remoteTmp}`, 300000000);
      await sshExec(targetServer, `rm -f ${remoteTmp}`);
    }

    // Step 2: Create networks
    for (const network of manifest.networks || []) {
      await sshExec(targetServer, `docker network create ${network} 2>/dev/null || true`);
    }

    // Step 3: Restore volumes and bind mounts
    for (const container of manifest.containers) {
      for (const vol of container.volumes || []) {
        const tarName = vol.tarName || (vol.type === "bind" ? vol.name.replace(/\//g, "___") : vol.name);
        const hasTar = await sshExec(targetServer, `test -f "${restoreDir}/volumes/${tarName}.tar" && echo YES || echo NO`);
        if (!hasTar.includes("YES")) continue;

        if (vol.type === "bind") {
          // Bind mount: create host directory and extract tar into it
          await sshExec(targetServer, `mkdir -p "${vol.name}"`);
          await sshExec(targetServer,
            `tar xf "${restoreDir}/volumes/${tarName}.tar" -C "${vol.name}" 2>&1`,
            3000000);
        } else {
          // Named volume: create volume and extract via alpine
          await sshExec(targetServer, `docker volume create ${vol.name} 2>/dev/null || true`);
          await sshExec(targetServer,
            `docker run --rm -v ${vol.name}:/data -v ${restoreDir}/volumes:/backup alpine sh -c "cd /data && tar xf /backup/${tarName}.tar" 2>&1`,
            3000000);
        }
      }

      // Also restore raw binds
      for (const bind of container.binds || []) {
        const parts = bind.split(":");
        if (parts.length >= 2) {
          const hostPath = parts[0];
          const safeName = hostPath.replace(/\//g, "___");
          const hasTar = await sshExec(targetServer, `test -f "${restoreDir}/volumes/${safeName}.tar" && echo YES || echo NO`);
          if (hasTar.includes("YES")) {
            await sshExec(targetServer, `mkdir -p "${hostPath}"`);
            await sshExec(targetServer,
              `tar xf "${restoreDir}/volumes/${safeName}.tar" -C "${hostPath}" 2>&1`,
              300000);
          }
        }
      }
    }

    // Step 4: Deploy via docker compose
    const cc = await sshExec(targetServer, `docker compose version 2>/dev/null && echo V2OK || true`).catch(() => "");
    const composeCmd = cc.includes("V2OK") ? "docker compose" : "docker-compose";

    const createdContainers: string[] = [];

    if (mode === "stack" && manifest.containers.length > 1) {
      // Stack mode: use combined stack-compose.yml
      const stackDir = `/opt/obb-compose/restore-${backup.id.slice(0, 8)}`;
      await sshExec(targetServer, `mkdir -p "${stackDir}"`);

      // Stop existing containers with same names
      for (const c of manifest.containers) {
        await sshExec(targetServer, `docker stop ${c.name} 2>/dev/null; docker rm ${c.name} 2>/dev/null || true`);
      }

      // Use stack compose from archive (or regenerate)
      const hasStackCompose = await sshExec(targetServer, `test -f "${restoreDir}/compose/stack-compose.yml" && echo YES || echo NO`);
      if (hasStackCompose.includes("YES")) {
        await sshExec(targetServer, `cp "${restoreDir}/compose/stack-compose.yml" "${stackDir}/docker-compose.yml"`);
      } else {
        // Regenerate from manifest
        const stackYaml = generateStackCompose(manifest.containers, manifest.networks);
        const b64 = Buffer.from(stackYaml).toString("base64");
        await sshExec(targetServer, `printf '%s' '${b64}' | base64 -d > "${stackDir}/docker-compose.yml"`);
      }

      await sshExec(targetServer,
        `cd "${stackDir}" && ${composeCmd} up -d 2>&1`, 300000);

      for (const c of manifest.containers) createdContainers.push(c.name);
    } else {
      // Individual mode: deploy each container separately via its own compose
      for (const c of manifest.containers) {
        const containerDir = `/opt/obb-compose/${c.name}`;
        await sshExec(targetServer, `mkdir -p "${containerDir}"`);

        // Stop existing
        await sshExec(targetServer, `docker stop ${c.name} 2>/dev/null; docker rm ${c.name} 2>/dev/null || true`);

        // Use per-container compose from archive
        const hasCompose = await sshExec(targetServer, `test -f "${restoreDir}/compose/${c.name}/docker-compose.yml" && echo YES || echo NO`);
        if (hasCompose.includes("YES")) {
          await sshExec(targetServer, `cp "${restoreDir}/compose/${c.name}/docker-compose.yml" "${containerDir}/docker-compose.yml"`);
        } else {
          // Fallback: generate from manifest
          const yaml = generateCompose(c);
          const b64 = Buffer.from(yaml).toString("base64");
          await sshExec(targetServer, `printf '%s' '${b64}' | base64 -d > "${containerDir}/docker-compose.yml"`);
        }

        await sshExec(targetServer,
          `cd "${containerDir}" && ${composeCmd} up -d 2>&1`, 120000);
        createdContainers.push(c.name);
      }
    }

    // Cleanup restore dir
    await sshExec(targetServer, `rm -rf ${restoreDir}`);

    // Count stats
    const totalVolumes = manifest.containers.reduce((a: number, c: any) => a + (c.volumes?.length || 0), 0);
    const totalEnvs = manifest.containers.reduce((a: number, c: any) => a + (c.env?.length || 0), 0);

    res.json({
      success: true,
      restored: createdContainers.length,
      containers: createdContainers,
      volumes: totalVolumes,
      envVars: totalEnvs,
      networks: manifest.networks?.length || 0,
      crossServer: sourceServer.id !== targetServer.id,
      message: `Restored ${createdContainers.length} container(s), ${totalVolumes} volume(s), ${manifest.networks?.length || 0} network(s) from "${backup.name}"`,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Get compose preview from backup ────────────────────────

router.get("/:id/compose", async (req: Request, res: Response) => {
  const backup = await prisma.backup.findFirst({
    where: { id: req.params.id as string, workspaceId: req.auth!.workspaceId, status: "completed" },
  });
  if (!backup || !backup.metadata) return res.status(404).json({ error: "Backup not found" });

  const manifest = JSON.parse(backup.metadata);
  const composes: Record<string, string> = {};

  for (const c of manifest.containers) {
    composes[c.name] = c.originalCompose || c.generatedCompose || generateCompose(c);
  }

  res.json({
    containers: composes,
    stack: manifest.stackCompose || generateStackCompose(manifest.containers, manifest.networks),
  });
});

// ─── Delete backup ──────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response) => {
  const backup = await prisma.backup.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!backup) return res.status(404).json({ error: "Not found" });

  if (backup.fileName) {
    try {
      const server = await prisma.server.findUnique({ where: { id: backup.serverId } });
      if (server) await sshExec(server, `rm -f "${backup.fileName}"`);
    } catch { /* ignore */ }
  }

  await prisma.backup.delete({ where: { id: backup.id } });
  res.json({ success: true });
});

// ─── Scheduled backups ──────────────────────────────────────

const scheduleSchema = z.object({
  name: z.string().min(1),
  cron: z.string().min(5),
  containerIds: z.array(z.string()).min(1),
  serverId: z.string().uuid(),
  keepLast: z.number().int().min(1).default(5),
});

router.get("/schedules", async (req: Request, res: Response) => {
  const schedules = await prisma.backupSchedule.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json(schedules);
});

router.post("/schedules", async (req: Request, res: Response) => {
  const data = scheduleSchema.parse(req.body);
  const schedule = await prisma.backupSchedule.create({
    data: { ...data, workspaceId: req.auth!.workspaceId },
  });

  await backupQueue.upsertJobScheduler(
    `backup-${schedule.id}`,
    { pattern: schedule.cron },
    { name: "scheduled-backup", data: { scheduleId: schedule.id } }
  );

  res.status(201).json(schedule);
});

router.delete("/schedules/:id", async (req: Request, res: Response) => {
  await backupQueue.removeJobScheduler(`backup-${req.params.id}`);
  await prisma.backupSchedule.deleteMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  res.json({ success: true });
});

router.put("/schedules/:id/toggle", async (req: Request, res: Response) => {
  const schedule = await prisma.backupSchedule.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!schedule) return res.status(404).json({ error: "Not found" });

  const newState = !schedule.enabled;
  await prisma.backupSchedule.update({ where: { id: schedule.id }, data: { enabled: newState } });

  if (newState) {
    await backupQueue.upsertJobScheduler(
      `backup-${schedule.id}`,
      { pattern: schedule.cron },
      { name: "scheduled-backup", data: { scheduleId: schedule.id } }
    );
  } else {
    await backupQueue.removeJobScheduler(`backup-${schedule.id}`);
  }

  res.json({ success: true, enabled: newState });
});

export default router;
