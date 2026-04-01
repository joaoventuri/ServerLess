import { Router, Request, Response } from "express";
import { prisma } from "../../config/db";
import { z } from "zod";

const router = Router();

// ─── VAULT GROUPS ───────────────────────────────────────────

router.get("/groups", async (req: Request, res: Response) => {
  const groups = await prisma.vaultGroup.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    include: { _count: { select: { credentials: true } } },
    orderBy: { name: "asc" },
  });
  res.json(groups);
});

router.post("/groups", async (req: Request, res: Response) => {
  const { name, icon } = z.object({ name: z.string().min(1), icon: z.string().optional() }).parse(req.body);
  const group = await prisma.vaultGroup.create({
    data: { name, icon, workspaceId: req.auth!.workspaceId },
  });
  res.status(201).json(group);
});

router.delete("/groups/:id", async (req: Request, res: Response) => {
  await prisma.vaultGroup.deleteMany({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  res.json({ success: true });
});

// ─── CREDENTIALS ────────────────────────────────────────────

const credentialSchema = z.object({
  title: z.string().min(1),
  login: z.string().min(1),
  url: z.string().optional(),
  isOtp: z.boolean().default(false),
  password: z.string().optional(),
  otpSecret: z.string().optional(),
  notes: z.string().optional(),
  groupId: z.string().uuid(),
});

router.get("/credentials", async (req: Request, res: Response) => {
  const groupId = req.query.groupId as string | undefined;
  const where: any = {};
  if (groupId) {
    where.groupId = groupId;
  }
  // ensure group belongs to workspace
  const groups = await prisma.vaultGroup.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    select: { id: true },
  });
  const groupIds = groups.map(g => g.id);
  where.groupId = groupId ? groupId : { in: groupIds };
  if (groupId && !groupIds.includes(groupId)) {
    return res.status(403).json({ error: "Access denied" });
  }

  const credentials = await prisma.credential.findMany({
    where,
    orderBy: { createdAt: "desc" },
  });
  res.json(credentials);
});

router.post("/credentials", async (req: Request, res: Response) => {
  const data = credentialSchema.parse(req.body);
  // verify group ownership
  const group = await prisma.vaultGroup.findFirst({
    where: { id: data.groupId, workspaceId: req.auth!.workspaceId },
  });
  if (!group) return res.status(404).json({ error: "Group not found" });

  const credential = await prisma.credential.create({ data });
  res.status(201).json(credential);
});

router.put("/credentials/:id", async (req: Request, res: Response) => {
  const data = credentialSchema.partial().parse(req.body);
  const credential = await prisma.credential.update({
    where: { id: req.params.id },
    data,
  });
  res.json(credential);
});

router.delete("/credentials/:id", async (req: Request, res: Response) => {
  await prisma.credential.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

export default router;
