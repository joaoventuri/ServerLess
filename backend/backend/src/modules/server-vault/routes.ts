import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";
import { z } from "zod";

const router = Router();

const serverSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  host: z.string().min(1),
  port: z.number().int().default(22),
  username: z.string().min(1),
  authType: z.enum(["password", "key"]).default("password"),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  hasDocker: z.boolean().default(false),
});

// List servers
router.get("/", async (req: Request, res: Response) => {
  const servers = await prisma.server.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    select: {
      id: true, name: true, description: true, host: true, port: true,
      username: true, authType: true, hasDocker: true, isOnline: true,
      lastSeenAt: true, createdAt: true,
    },
    orderBy: { createdAt: "desc" },
  });
  res.json(servers);
});

// Get single server
router.get("/:id", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
    include: { agentToken: true },
  });
  if (!server) return res.status(404).json({ error: "Not found" });
  res.json(server);
});

// Create server
router.post("/", async (req: Request, res: Response) => {
  const data = serverSchema.parse(req.body);
  const server = await prisma.server.create({
    data: { ...data, workspaceId: req.auth!.workspaceId },
  });
  res.status(201).json(server);
});

// Update server
router.put("/:id", async (req: Request, res: Response) => {
  const data = serverSchema.partial().parse(req.body);
  const server = await prisma.server.updateMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
    data,
  });
  if (server.count === 0) return res.status(404).json({ error: "Not found" });
  res.json({ success: true });
});

// Delete server
router.delete("/:id", async (req: Request, res: Response) => {
  await prisma.server.deleteMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  res.json({ success: true });
});

// Generate agent token
router.post("/:id/agent-token", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Not found" });

  const agentToken = await prisma.agentToken.upsert({
    where: { serverId: server.id },
    create: { serverId: server.id },
    update: { token: crypto.randomUUID(), isActive: true },
  });

  const installScript = `curl -sL http://localhost:3001/agent/install.sh | bash -s -- --token=${agentToken.token} --api=http://localhost:3001`;
  res.json({ token: agentToken.token, installScript });
});

export default router;
