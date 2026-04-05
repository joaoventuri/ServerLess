import { Queue, Worker } from "bullmq";
import { redis } from "../../config/redis";
import { prisma } from "../../config/db";
import { Client as SSHClient } from "ssh2";

export const backupQueue = new Queue("backups", { connection: redis });

function sshExec(server: any, cmd: string, timeout = 120000): Promise<string> {
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

// ─── Compose generators (same as routes.ts) ────────────────

function generateCompose(c: any): string {
  const lines: string[] = [];
  lines.push("services:");
  lines.push(`  ${c.name}:`);
  lines.push(`    image: ${c.image}`);
  lines.push(`    container_name: ${c.name}`);
  if (c.restartPolicy && c.restartPolicy !== "no") lines.push(`    restart: ${c.restartPolicy}`);

  const portEntries = Object.entries(c.ports || {});
  if (portEntries.length > 0) {
    lines.push("    ports:");
    for (const [cp, hps] of portEntries) {
      for (const hp of (hps as string[])) lines.push(`      - "${hp}:${cp.split("/")[0]}"`);
    }
  }

  if (c.env?.length > 0) {
    lines.push("    environment:");
    for (const e of c.env) lines.push(`      - ${e}`);
  }

  const allVols: string[] = [];
  for (const v of c.volumes || []) allVols.push(`${v.name}:${v.destination}`);
  for (const b of c.binds || []) allVols.push(b);
  if (allVols.length > 0) {
    lines.push("    volumes:");
    for (const v of allVols) lines.push(`      - ${v}`);
  }

  if (c.cmd?.length > 0 && !c.cmd.join(" ").includes("docker-entrypoint")) {
    lines.push(`    command: ${c.cmd.join(" ")}`);
  }
  if (c.entrypoint?.length > 0 && !c.entrypoint.join(" ").includes("docker-entrypoint")) {
    lines.push(`    entrypoint: [${c.entrypoint.map((e: string) => `"${e}"`).join(", ")}]`);
  }
  if (c.workingDir) lines.push(`    working_dir: ${c.workingDir}`);

  const customNets = (c.networks || []).filter((n: string) => !["bridge", "host", "none"].includes(n));
  if (customNets.length > 0) {
    lines.push("    networks:");
    for (const n of customNets) lines.push(`      - ${n}`);
  }

  const namedVols = (c.volumes || []).filter((v: any) => !v.name.startsWith("/") && !v.name.startsWith("."));
  if (namedVols.length > 0) {
    lines.push("");
    lines.push("volumes:");
    for (const v of namedVols) lines.push(`  ${v.name}:`);
  }

  if (customNets.length > 0) {
    lines.push("");
    lines.push("networks:");
    for (const n of customNets) { lines.push(`  ${n}:`); lines.push(`    external: true`); }
  }

  return lines.join("\n");
}

function generateStackCompose(containers: any[], networks: string[]): string {
  const lines: string[] = ["services:"];

  for (const c of containers) {
    lines.push(`  ${c.name}:`);
    lines.push(`    image: ${c.image}`);
    lines.push(`    container_name: ${c.name}`);
    if (c.restartPolicy && c.restartPolicy !== "no") lines.push(`    restart: ${c.restartPolicy}`);

    const portEntries = Object.entries(c.ports || {});
    if (portEntries.length > 0) {
      lines.push("    ports:");
      for (const [cp, hps] of portEntries) {
        for (const hp of (hps as string[])) lines.push(`      - "${hp}:${cp.split("/")[0]}"`);
      }
    }
    if (c.env?.length > 0) {
      lines.push("    environment:");
      for (const e of c.env) lines.push(`      - ${e}`);
    }
    const allVols: string[] = [];
    for (const v of c.volumes || []) allVols.push(`${v.name}:${v.destination}`);
    for (const b of c.binds || []) allVols.push(b);
    if (allVols.length > 0) {
      lines.push("    volumes:");
      for (const v of allVols) lines.push(`      - ${v}`);
    }
    if (c.cmd?.length > 0 && !c.cmd.join(" ").includes("docker-entrypoint")) {
      lines.push(`    command: ${c.cmd.join(" ")}`);
    }
    if (c.entrypoint?.length > 0 && !c.entrypoint.join(" ").includes("docker-entrypoint")) {
      lines.push(`    entrypoint: [${c.entrypoint.map((e: string) => `"${e}"`).join(", ")}]`);
    }
    if (c.workingDir) lines.push(`    working_dir: ${c.workingDir}`);
    const customNets = (c.networks || []).filter((n: string) => !["bridge", "host", "none"].includes(n));
    if (customNets.length > 0) {
      lines.push("    networks:");
      for (const n of customNets) lines.push(`      - ${n}`);
    }
    lines.push("");
  }

  const allNamedVols = new Set<string>();
  for (const c of containers) {
    for (const v of c.volumes || []) {
      if (!v.name.startsWith("/") && !v.name.startsWith(".")) allNamedVols.add(v.name);
    }
  }
  if (allNamedVols.size > 0) {
    lines.push("volumes:");
    for (const v of allNamedVols) lines.push(`  ${v}:`);
    lines.push("");
  }

  if (networks.length > 0) {
    lines.push("networks:");
    for (const n of networks) { lines.push(`  ${n}:`); lines.push(`    external: true`); }
  }

  return lines.join("\n");
}

// ─── Worker ─────────────────────────────────────────────────

export function startBackupWorker() {
  const worker = new Worker(
    "backups",
    async (job) => {
      if (job.name !== "scheduled-backup") return;

      const { scheduleId } = job.data;
      const schedule = await prisma.backupSchedule.findUnique({ where: { id: scheduleId } });
      if (!schedule || !schedule.enabled) return;

      const server = await prisma.server.findUnique({ where: { id: schedule.serverId } });
      if (!server) return;

      console.log(`[Backup] Running scheduled backup "${schedule.name}" on ${server.name}`);

      const backupId = crypto.randomUUID();
      const outputFile = `/opt/obb-backups/${backupId}.opsbigbro`;
      const backupDir = `/opt/obb-backups/${backupId}`;

      try {
        await sshExec(server, `mkdir -p ${backupDir}/volumes ${backupDir}/compose`);

        const manifest: any = {
          version: "2.0",
          createdAt: new Date().toISOString(),
          source: { server: server.name, host: server.host },
          containers: [],
          networks: [],
        };

        for (const name of schedule.containerIds) {
          const inspect = await sshExec(server, `docker inspect ${name} 2>&1`);
          let cd: any;
          try { cd = JSON.parse(inspect)[0]; } catch { continue; }

          const config = cd.Config || {};
          const hc = cd.HostConfig || {};
          const ns = cd.NetworkSettings || {};

          const cm: any = {
            name: cd.Name?.replace(/^\//, "") || name,
            image: config.Image,
            env: config.Env || [],
            cmd: config.Cmd,
            entrypoint: config.Entrypoint,
            workingDir: config.WorkingDir,
            labels: config.Labels || {},
            ports: {},
            volumes: [],
            binds: hc.Binds || [],
            restartPolicy: hc.RestartPolicy?.Name || "no",
            networkMode: hc.NetworkMode || "bridge",
            networks: Object.keys(ns.Networks || {}),
          };

          const pb = hc.PortBindings || {};
          for (const [cp, binds] of Object.entries(pb)) {
            if (Array.isArray(binds) && binds.length > 0) {
              cm.ports[cp] = (binds as any[]).map(b => b.HostPort);
            }
          }

          for (const mount of cd.Mounts || []) {
            if (mount.Type === "volume" && mount.Name) {
              const vol = { name: mount.Name, destination: mount.Destination, driver: mount.Driver || "local", type: "volume" as const, tarName: mount.Name };
              cm.volumes.push(vol);
              await sshExec(server,
                `docker run --rm -v ${mount.Name}:/data -v ${backupDir}/volumes:/backup alpine tar cf /backup/${mount.Name}.tar -C /data .`,
                0000000);
            } else if (mount.Type === "bind" && mount.Source) {
              const safeName = mount.Source.replace(/\//g, "___");
              const vol = { name: mount.Source, destination: mount.Destination, type: "bind" as const, tarName: safeName };
              cm.volumes.push(vol);
              await sshExec(server,
                `test -d "${mount.Source}" && tar cf "${backupDir}/volumes/${safeName}.tar" -C "${mount.Source}" . 2>&1 || echo "SKIP"`,
                300000000);
            }
          }

          // Deduplicate binds
          const capturedBinds = new Set(cm.volumes.filter((v: any) => v.type === "bind").map((v: any) => `${v.name}:${v.destination}`));
          cm.binds = (cm.binds || []).filter((b: string) => !capturedBinds.has(b));

          // Tar remaining raw binds
          for (const bind of cm.binds) {
            const parts = bind.split(":");
            if (parts.length >= 2) {
              const hostPath = parts[0];
              const safeName = hostPath.replace(/\//g, "___");
              await sshExec(server,
                `test -d "${hostPath}" && tar cf "${backupDir}/volumes/${safeName}.tar" -C "${hostPath}" . 2>&1 || echo "SKIP"`,
                300000000);
            }
          }

          // Try to grab original compose
          let originalCompose = "";
          const composeLabels = cm.labels || {};
          const composeWd = composeLabels["com.docker.compose.project.working_dir"];
          if (composeWd) {
            try {
              originalCompose = await sshExec(server, `cat "${composeWd}/docker-compose.yml" 2>/dev/null || cat "${composeWd}/compose.yml" 2>/dev/null || true`);
              if (originalCompose.includes("No such file")) originalCompose = "";
            } catch { /* ignore */ }
          }
          if (!originalCompose) {
            try {
              originalCompose = await sshExec(server, `cat "/opt/obb-compose/${name}/docker-compose.yml" 2>/dev/null || true`);
              if (originalCompose.includes("No such file")) originalCompose = "";
            } catch { /* ignore */ }
          }

          cm.originalCompose = originalCompose || null;
          cm.generatedCompose = generateCompose(cm);

          // Write per-container compose
          await sshExec(server, `mkdir -p "${backupDir}/compose/${cm.name}"`);
          const composeContent = originalCompose || cm.generatedCompose;
          const b64 = Buffer.from(composeContent).toString("base64");
          await sshExec(server, `printf '%s' '${b64}' | base64 -d > "${backupDir}/compose/${cm.name}/docker-compose.yml"`);

          manifest.containers.push(cm);
        }

        const networkSet = new Set<string>();
        for (const c of manifest.containers) {
          for (const n of c.networks) {
            if (!["bridge", "host", "none"].includes(n)) networkSet.add(n);
          }
        }
        manifest.networks = Array.from(networkSet);

        // Stack compose
        const stackCompose = generateStackCompose(manifest.containers, manifest.networks);
        manifest.stackCompose = stackCompose;
        const stackB64 = Buffer.from(stackCompose).toString("base64");
        await sshExec(server, `printf '%s' '${stackB64}' | base64 -d > "${backupDir}/compose/stack-compose.yml"`);

        // Manifest via base64
        const manifestB64 = Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64");
        await sshExec(server, `printf '%s' '${manifestB64}' | base64 -d > "${backupDir}/manifest.json"`);

        // Pack
        await sshExec(server, `cd ${backupDir} && tar czf ${outputFile} manifest.json compose/ volumes/`, 300000);
        const sizeOut = await sshExec(server, `du -sm ${outputFile} | awk '{print $1}'`);
        await sshExec(server, `rm -rf ${backupDir}`);

        await prisma.backup.create({
          data: {
            id: backupId,
            name: `${schedule.name} — ${new Date().toISOString().split("T")[0]}`,
            type: schedule.containerIds.length > 1 ? "stack" : "single",
            containerIds: schedule.containerIds,
            serverId: server.id,
            serverName: server.name,
            status: "completed",
            fileName: outputFile,
            fileSizeMb: parseFloat(sizeOut) || 0,
            metadata: JSON.stringify(manifest),
            completedAt: new Date(),
            workspaceId: schedule.workspaceId,
          },
        });

        await prisma.backupSchedule.update({
          where: { id: scheduleId },
          data: { lastRunAt: new Date() },
        });

        // Retention cleanup
        const oldBackups = await prisma.backup.findMany({
          where: {
            workspaceId: schedule.workspaceId,
            serverId: server.id,
            containerIds: { equals: schedule.containerIds },
            status: "completed",
          },
          orderBy: { createdAt: "desc" },
          skip: schedule.keepLast,
        });

        for (const old of oldBackups) {
          if (old.fileName) {
            await sshExec(server, `rm -f "${old.fileName}"`).catch(() => {});
          }
          await prisma.backup.delete({ where: { id: old.id } });
        }

        console.log(`[Backup] Completed "${schedule.name}" — ${manifest.containers.length} container(s), ${sizeOut}MB`);
      } catch (err: any) {
        console.error(`[Backup] Failed "${schedule.name}":`, err.message);
        await prisma.backup.create({
          data: {
            id: backupId,
            name: `${schedule.name} — ${new Date().toISOString().split("T")[0]}`,
            type: "single",
            containerIds: schedule.containerIds,
            serverId: server.id,
            serverName: server.name,
            status: "failed",
            error: err.message,
            workspaceId: schedule.workspaceId,
          },
        });
        await sshExec(server, `rm -rf ${backupDir} ${outputFile}`).catch(() => {});
      }
    },
    { connection: redis, concurrency: 2 }
  );

  worker.on("failed", (job, err) => {
    console.error(`[Backup] Job ${job?.id} failed:`, err.message);
  });

  return worker;
}
