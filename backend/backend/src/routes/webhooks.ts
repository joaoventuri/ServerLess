import { Router, Request, Response } from "express";
import { prisma } from "../config/db";
import { z } from "zod";

const router = Router();

const webhookSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
  events: z.array(z.string()).min(1),
  isActive: z.boolean().default(true),
});

router.get("/", async (req: Request, res: Response) => {
  const webhooks = await prisma.webhook.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json(webhooks);
});

router.post("/", async (req: Request, res: Response) => {
  const data = webhookSchema.parse(req.body);
  const webhook = await prisma.webhook.create({
    data: { ...data, workspaceId: req.auth!.workspaceId },
  });
  res.status(201).json(webhook);
});

router.put("/:id", async (req: Request, res: Response) => {
  const data = webhookSchema.partial().parse(req.body);
  await prisma.webhook.updateMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
    data,
  });
  res.json({ success: true });
});

router.delete("/:id", async (req: Request, res: Response) => {
  await prisma.webhook.deleteMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  res.json({ success: true });
});

export default router;
