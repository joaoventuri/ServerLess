import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";
import { z } from "zod";
import { dispatchWebhook } from "../../services/webhook";

const router = Router();

// ─── Agent ingestion endpoint (authenticated by agent token) ─
const metricSchema = z.object({
  token: z.string().uuid(),
  cpuPercent: z.number(),
  ramUsedMb: z.number(),
  ramTotalMb: z.number(),
  diskUsedGb: z.number(),
  diskTotalGb: z.number(),
  diskReadKb: z.number().default(0),
  diskWriteKb: z.number().default(0),
  netRxKb: z.number().default(0),
  netTxKb: z.number().default(0),
  containers: z.array(z.object({
    containerId: z.string(),
    name: z.string(),
    image: z.string(),
    status: z.string(),
    cpuPercent: z.number().default(0),
    ramUsageMb: z.number().default(0),
    ramLimitMb: z.number().default(0),
  })).optional(),
});

// Public endpoint — agent uses token auth, not JWT
router.post("/ingest", async (req: Request, res: Response) => {
  const data = metricSchema.parse(req.body);

  const agentToken = await prisma.agentToken.findUnique({
    where: { token: data.token },
    include: { server: true },
  });
  if (!agentToken || !agentToken.isActive) {
    return res.status(401).json({ error: "Invalid agent token" });
  }

  const server = agentToken.server;

  // Save metric
  await prisma.metric.create({
    data: {
      serverId: server.id,
      cpuPercent: data.cpuPercent,
      ramUsedMb: data.ramUsedMb,
      ramTotalMb: data.ramTotalMb,
      diskUsedGb: data.diskUsedGb,
      diskTotalGb: data.diskTotalGb,
      diskReadKb: data.diskReadKb,
      diskWriteKb: data.diskWriteKb,
      netRxKb: data.netRxKb,
      netTxKb: data.netTxKb,
    },
  });

  // Update server status
  await prisma.server.update({
    where: { id: server.id },
    data: { isOnline: true, lastSeenAt: new Date() },
  });

  // RAM alert: > 90%
  const ramPercent = (data.ramUsedMb / data.ramTotalMb) * 100;
  if (ramPercent > 90) {
    await dispatchWebhook(server.workspaceId, "metric.alert", {
      server: server.name, type: "ram", value: ramPercent.toFixed(1) + "%",
      message: `RAM usage at ${ramPercent.toFixed(1)}% on ${server.name}`,
    });
  }

  // Docker containers
  if (data.containers && server.hasDocker) {
    for (const c of data.containers) {
      await prisma.container.upsert({
        where: { serverId_containerId: { serverId: server.id, containerId: c.containerId } },
        create: { ...c, serverId: server.id },
        update: { ...c, lastUpdatedAt: new Date() },
      });

      if (c.status === "exited") {
        await dispatchWebhook(server.workspaceId, "container.exited", {
          server: server.name, container: c.name, image: c.image,
        });
      }
    }
  }

  res.json({ ok: true });
});

// ─── Dashboard endpoints (JWT protected, added in index.ts) ─

// Get metrics for a server
router.get("/servers/:serverId/metrics", async (req: Request, res: Response) => {
  const { serverId } = req.params;
  const hours = parseInt(req.query.hours as string) || 24;
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);

  const metrics = await prisma.metric.findMany({
    where: { serverId, collectedAt: { gte: since } },
    orderBy: { collectedAt: "asc" },
  });
  res.json(metrics);
});

// Get containers for a server
router.get("/servers/:serverId/containers", async (req: Request, res: Response) => {
  const containers = await prisma.container.findMany({
    where: { serverId: req.params.serverId },
    orderBy: { name: "asc" },
  });
  res.json(containers);
});

export default router;
