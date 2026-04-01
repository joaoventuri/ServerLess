import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";
import { z } from "zod";
import { healthQueue } from "./worker";

const router = Router();

const healthCheckSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  interval: z.number().int().default(60),
  method: z.enum(["GET", "HEAD", "POST"]).default("GET"),
  expectedStatus: z.number().int().default(200),
  sslCheck: z.boolean().default(true),
});

router.get("/", async (req: Request, res: Response) => {
  const checks = await prisma.healthCheck.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json(checks);
});

router.get("/:id", async (req: Request, res: Response) => {
  const check = await prisma.healthCheck.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!check) return res.status(404).json({ error: "Not found" });
  res.json(check);
});

router.get("/:id/pings", async (req: Request, res: Response) => {
  const limit = parseInt(req.query.limit as string) || 100;
  const pings = await prisma.ping.findMany({
    where: { healthCheckId: req.params.id },
    orderBy: { checkedAt: "desc" },
    take: limit,
  });
  res.json(pings);
});

router.post("/", async (req: Request, res: Response) => {
  const data = healthCheckSchema.parse(req.body);
  const check = await prisma.healthCheck.create({
    data: { ...data, workspaceId: req.auth!.workspaceId },
  });

  // Schedule recurring job in BullMQ
  await healthQueue.upsertJobScheduler(
    `health-${check.id}`,
    { every: check.interval * 1000 },
    { name: "check", data: { healthCheckId: check.id } }
  );

  res.status(201).json(check);
});

router.delete("/:id", async (req: Request, res: Response) => {
  await healthQueue.removeJobScheduler(`health-${req.params.id}`);
  await prisma.healthCheck.deleteMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  res.json({ success: true });
});

export default router;
