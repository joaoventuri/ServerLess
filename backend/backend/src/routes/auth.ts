import { Router, Request, Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { prisma } from "../config/db";
import { env } from "../config/env";
import { z } from "zod";
import { authMiddleware } from "../middleware/auth";

const router = Router();

const registerSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(6),
  workspaceName: z.string().min(1).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string(),
  workspaceId: z.string().uuid().optional(),
});

router.post("/register", async (req: Request, res: Response) => {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  if (existing) return res.status(409).json({ error: "Email already in use" });

  const hash = await bcrypt.hash(data.password, 10);
  const user = await prisma.user.create({
    data: { name: data.name, email: data.email, password: hash },
  });

  // Create default workspace
  const wsName = data.workspaceName || `${data.name}'s Workspace`;
  const slug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const workspace = await prisma.workspace.create({
    data: {
      name: wsName,
      slug: slug + "-" + user.id.slice(0, 4),
      members: { create: { userId: user.id, role: "owner" } },
    },
  });

  const token = jwt.sign({ userId: user.id, workspaceId: workspace.id }, env.JWT_SECRET, { expiresIn: "7d" });

  res.status(201).json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug },
  });
});

router.post("/login", async (req: Request, res: Response) => {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({
    where: { email: data.email },
    include: { memberships: { include: { workspace: true } } },
  });
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const valid = await bcrypt.compare(data.password, user.password);
  if (!valid) return res.status(401).json({ error: "Invalid credentials" });

  // Pick workspace
  let workspaceId = data.workspaceId;
  if (!workspaceId && user.memberships.length > 0) {
    workspaceId = user.memberships[0].workspaceId;
  }
  if (!workspaceId) return res.status(400).json({ error: "No workspace found" });

  const token = jwt.sign({ userId: user.id, workspaceId }, env.JWT_SECRET, { expiresIn: "7d" });

  res.json({
    token,
    user: { id: user.id, name: user.name, email: user.email },
    workspaces: user.memberships.map(m => ({
      id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role,
    })),
    currentWorkspace: workspaceId,
  });
});

router.get("/me", authMiddleware, async (req: Request, res: Response) => {
  const user = await prisma.user.findUnique({
    where: { id: req.auth!.userId },
    include: { memberships: { include: { workspace: true } } },
  });
  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    user: { id: user.id, name: user.name, email: user.email },
    workspaces: user.memberships.map(m => ({
      id: m.workspace.id, name: m.workspace.name, slug: m.workspace.slug, role: m.role,
    })),
    currentWorkspace: req.auth!.workspaceId,
  });
});

export default router;
