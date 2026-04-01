import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";

const router = Router();

// ─── Export entire ServerLess database for migration ────────

router.get("/export", async (req: Request, res: Response) => {
  const workspaceId = req.auth!.workspaceId;

  const [
    users,
    workspaces,
    workspaceMembers,
    servers,
    agentTokens,
    containers,
    metrics,
    vaultGroups,
    credentials,
    healthChecks,
    pings,
    webhooks,
    domains,
    backups,
    backupSchedules,
    stacks,
  ] = await Promise.all([
    prisma.user.findMany({
      where: { memberships: { some: { workspaceId } } },
    }),
    prisma.workspace.findMany({ where: { id: workspaceId } }),
    prisma.workspaceMember.findMany({ where: { workspaceId } }),
    prisma.server.findMany({ where: { workspaceId } }),
    prisma.agentToken.findMany({
      where: { server: { workspaceId } },
    }),
    prisma.container.findMany({
      where: { server: { workspaceId } },
    }),
    prisma.metric.findMany({
      where: { server: { workspaceId } },
      orderBy: { collectedAt: "desc" },
      take: 10000, // last 10k metrics to avoid huge files
    }),
    prisma.vaultGroup.findMany({ where: { workspaceId } }),
    prisma.credential.findMany({
      where: { group: { workspaceId } },
    }),
    prisma.healthCheck.findMany({ where: { workspaceId } }),
    prisma.ping.findMany({
      where: { healthCheck: { workspaceId } },
      orderBy: { checkedAt: "desc" },
      take: 50000,
    }),
    prisma.webhook.findMany({ where: { workspaceId } }),
    prisma.domain.findMany({ where: { workspaceId } }),
    prisma.backup.findMany({ where: { workspaceId } }),
    prisma.backupSchedule.findMany({ where: { workspaceId } }),
    prisma.stack.findMany({ where: { workspaceId } }),
  ]);

  const payload = {
    version: "1.0",
    exportedAt: new Date().toISOString(),
    platform: "ServerLess",
    data: {
      users,
      workspaces,
      workspaceMembers,
      servers,
      agentTokens,
      containers,
      metrics,
      vaultGroups,
      credentials,
      healthChecks,
      pings,
      webhooks,
      domains,
      backups,
      backupSchedules,
      stacks,
    },
  };

  const json = JSON.stringify(payload, null, 2);
  const filename = `serverless-export-${new Date().toISOString().split("T")[0]}.json`;

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(json);
});

// ─── Import ServerLess database from export file ────────────

router.post("/import", async (req: Request, res: Response) => {
  const { data, version } = req.body;

  if (!data || !version) {
    return res.status(400).json({ error: "Invalid export file" });
  }

  const stats = {
    users: 0,
    workspaces: 0,
    servers: 0,
    credentials: 0,
    healthChecks: 0,
    webhooks: 0,
    domains: 0,
    stacks: 0,
    backupSchedules: 0,
  };

  try {
    await prisma.$transaction(async (tx) => {
      // Wipe all existing data (order matters for FK constraints)
      await tx.ping.deleteMany();
      await tx.metric.deleteMany();
      await tx.container.deleteMany();
      await tx.agentToken.deleteMany();
      await tx.credential.deleteMany();
      await tx.vaultGroup.deleteMany();
      await tx.healthCheck.deleteMany();
      await tx.domain.deleteMany();
      await tx.backup.deleteMany();
      await tx.backupSchedule.deleteMany();
      await tx.stack.deleteMany();
      await tx.webhook.deleteMany();
      await tx.workspaceMember.deleteMany();
      await tx.server.deleteMany();
      await tx.workspace.deleteMany();
      await tx.user.deleteMany();

      // 1. Users
      for (const user of data.users || []) {
        await tx.user.create({ data: { ...user, createdAt: new Date(user.createdAt), updatedAt: new Date(user.updatedAt) } });
        stats.users++;
      }

      // 2. Workspaces
      for (const ws of data.workspaces || []) {
        await tx.workspace.create({ data: { ...ws, createdAt: new Date(ws.createdAt), updatedAt: new Date(ws.updatedAt) } });
        stats.workspaces++;
      }

      // 3. Workspace members
      for (const wm of data.workspaceMembers || []) {
        await tx.workspaceMember.create({ data: { ...wm, joinedAt: new Date(wm.joinedAt) } });
      }

      // 4. Servers
      for (const server of data.servers || []) {
        await tx.server.create({
          data: {
            ...server,
            lastSeenAt: server.lastSeenAt ? new Date(server.lastSeenAt) : null,
            createdAt: new Date(server.createdAt),
            updatedAt: new Date(server.updatedAt),
          },
        });
        stats.servers++;
      }

      // 5. Agent tokens
      for (const at of data.agentTokens || []) {
        await tx.agentToken.create({ data: { ...at, createdAt: new Date(at.createdAt) } });
      }

      // 6. Containers
      for (const c of data.containers || []) {
        await tx.container.create({
          data: { ...c, lastUpdatedAt: new Date(c.lastUpdatedAt), createdAt: new Date(c.createdAt) },
        });
      }

      // 7. Vault groups + credentials
      for (const vg of data.vaultGroups || []) {
        await tx.vaultGroup.create({
          data: { ...vg, createdAt: new Date(vg.createdAt), updatedAt: new Date(vg.updatedAt) },
        });
      }
      for (const cred of data.credentials || []) {
        await tx.credential.create({
          data: { ...cred, createdAt: new Date(cred.createdAt), updatedAt: new Date(cred.updatedAt) },
        });
        stats.credentials++;
      }

      // 8. Health checks + pings
      for (const hc of data.healthChecks || []) {
        await tx.healthCheck.create({
          data: {
            ...hc,
            sslExpiresAt: hc.sslExpiresAt ? new Date(hc.sslExpiresAt) : null,
            lastCheckedAt: hc.lastCheckedAt ? new Date(hc.lastCheckedAt) : null,
            createdAt: new Date(hc.createdAt),
            updatedAt: new Date(hc.updatedAt),
          },
        });
        stats.healthChecks++;
      }
      for (const ping of data.pings || []) {
        await tx.ping.create({ data: { ...ping, checkedAt: new Date(ping.checkedAt) } });
      }

      // 9. Webhooks
      for (const wh of data.webhooks || []) {
        await tx.webhook.create({
          data: { ...wh, createdAt: new Date(wh.createdAt), updatedAt: new Date(wh.updatedAt) },
        });
        stats.webhooks++;
      }

      // 10. Domains
      for (const d of data.domains || []) {
        await tx.domain.create({
          data: { ...d, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) },
        });
        stats.domains++;
      }

      // 11. Backups (metadata only)
      for (const b of data.backups || []) {
        await tx.backup.create({
          data: { ...b, createdAt: new Date(b.createdAt), completedAt: b.completedAt ? new Date(b.completedAt) : null },
        });
      }

      // 12. Backup schedules
      for (const bs of data.backupSchedules || []) {
        await tx.backupSchedule.create({
          data: {
            ...bs,
            lastRunAt: bs.lastRunAt ? new Date(bs.lastRunAt) : null,
            createdAt: new Date(bs.createdAt),
            updatedAt: new Date(bs.updatedAt),
          },
        });
        stats.backupSchedules++;
      }

      // 13. Stacks
      for (const s of data.stacks || []) {
        await tx.stack.create({
          data: { ...s, createdAt: new Date(s.createdAt), updatedAt: new Date(s.updatedAt) },
        });
        stats.stacks++;
      }

      // 14. Metrics (bulk)
      const newMetrics = (data.metrics || []).map((m: any) => ({ ...m, collectedAt: new Date(m.collectedAt) }));
      if (newMetrics.length > 0) {
        await tx.metric.createMany({ data: newMetrics, skipDuplicates: true });
      }
    });

    res.json({ success: true, stats });
  } catch (err: any) {
    console.error("[Platform Export] Import failed:", err.message);
    res.status(500).json({ error: `Import failed: ${err.message}` });
  }
});

export default router;
