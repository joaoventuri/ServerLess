import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";
import { z } from "zod";
import { STACK_TEMPLATES, STACK_CATEGORIES } from "./templates";

const router = Router();

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

// ─── Marketplace templates ──────────────────────────────────

router.get("/templates", (_req: Request, res: Response) => {
  const category = _req.query.category as string;
  const search = (_req.query.q as string || "").toLowerCase();
  let results = STACK_TEMPLATES;
  if (category) results = results.filter(t => t.category === category);
  if (search) results = results.filter(t =>
    t.name.toLowerCase().includes(search) ||
    t.description.toLowerCase().includes(search) ||
    t.tags.some(tag => tag.includes(search))
  );
  res.json(results);
});

router.get("/templates/:slug", (req: Request, res: Response) => {
  const t = STACK_TEMPLATES.find(t => t.slug === req.params.slug);
  if (!t) return res.status(404).json({ error: "Template not found" });
  res.json(t);
});

router.get("/categories", (_req: Request, res: Response) => {
  res.json(STACK_CATEGORIES);
});

// ─── My Stacks CRUD ─────────────────────────────────────────

router.get("/", async (req: Request, res: Response) => {
  const stacks = await prisma.stack.findMany({
    where: { workspaceId: req.auth!.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  res.json(stacks);
});

router.get("/:id", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });
  res.json(stack);
});

// ─── Deploy stack ───────────────────────────────────────────

const deploySchema = z.object({
  name: z.string().min(1),
  serverId: z.string().uuid(),
  compose: z.string().min(10),
  templateSlug: z.string().optional(),
  description: z.string().optional(),
});

router.post("/deploy", async (req: Request, res: Response) => {
  const data = deploySchema.parse(req.body);

  const server = await prisma.server.findFirst({
    where: { id: data.serverId, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  // Extract container/service names from compose
  const serviceNames = extractServiceNames(data.compose);

  // Create stack record
  const stack = await prisma.stack.create({
    data: {
      name: data.name,
      description: data.description,
      templateSlug: data.templateSlug,
      compose: data.compose,
      status: "deploying",
      containerNames: serviceNames,
      serverId: server.id,
      workspaceId: req.auth!.workspaceId,
    },
  });

  // Deploy in background
  deployStack(stack.id, server, data.name, data.compose).catch(async (err) => {
    await prisma.stack.update({
      where: { id: stack.id },
      data: { status: "error", error: err.message },
    });
  });

  res.status(201).json(stack);
});

async function deployStack(stackId: string, server: any, name: string, compose: string) {
  const stackDir = `/opt/obb-stacks/${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  try {
    await sshExec(server, `mkdir -p "${stackDir}"`);

    // Write compose file — use base64 to avoid escaping issues
    const b64 = Buffer.from(compose).toString("base64");
    await sshExec(server, `echo "${b64}" | base64 -d > "${stackDir}/docker-compose.yml"`);

    // Deploy
    const output = await sshExec(server,
      `cd "${stackDir}" && docker compose pull 2>&1 && docker compose up -d 2>&1`,
      300000 // 5 min for large stacks
    );

    console.log(`[Stack] Deployed "${name}": ${output.slice(-200)}`);

    // Wait for containers to start, then get names (retry a few times)
    let containerNames: string[] = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const ps = await sshExec(server,
        `cd "${stackDir}" && docker compose ps --format "{{.Name}}" 2>/dev/null`).catch(() => "");
      containerNames = ps.split("\n").filter(Boolean);
      if (containerNames.length > 0) break;
    }

    // Fallback: parse service names from compose if ps failed
    if (containerNames.length === 0) {
      containerNames = extractServiceNames(compose);
    }

    console.log(`[Stack] "${name}" containers: ${containerNames.join(", ")}`);

    await prisma.stack.update({
      where: { id: stackId },
      data: { status: "running", containerNames, error: null },
    });
  } catch (err: any) {
    console.error(`[Stack] Deploy failed "${name}":`, err.message);
    throw err;
  }
}

// ─── Update stack (edit compose + redeploy) ─────────────────

router.put("/:id", async (req: Request, res: Response) => {
  const { compose, name, description } = req.body;
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  await prisma.stack.update({
    where: { id: stack.id },
    data: {
      compose: compose || stack.compose,
      name: name || stack.name,
      description: description !== undefined ? description : stack.description,
      status: "deploying",
      error: null,
    },
  });

  // Redeploy
  deployStack(stack.id, server, stack.name, compose || stack.compose).catch(async (err) => {
    await prisma.stack.update({
      where: { id: stack.id },
      data: { status: "error", error: err.message },
    });
  });

  res.json({ success: true });
});

// ─── Stop stack ─────────────────────────────────────────────

router.post("/:id/stop", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const stackDir = `/opt/obb-stacks/${stack.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  await sshExec(server, `cd "${stackDir}" && docker compose stop 2>&1`);
  await prisma.stack.update({ where: { id: stack.id }, data: { status: "stopped" } });
  res.json({ success: true });
});

// ─── Start stack ────────────────────────────────────────────

router.post("/:id/start", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const stackDir = `/opt/obb-stacks/${stack.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  await sshExec(server, `cd "${stackDir}" && docker compose up -d 2>&1`);
  await prisma.stack.update({ where: { id: stack.id }, data: { status: "running" } });
  res.json({ success: true });
});

// ─── Delete stack ───────────────────────────────────────────

router.delete("/:id", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (server) {
    const stackDir = `/opt/obb-stacks/${stack.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    // Stop and remove containers but KEEP volumes
    await sshExec(server, `cd "${stackDir}" && docker compose down --remove-orphans 2>/dev/null; rm -rf "${stackDir}"`).catch(() => {});
  }

  await prisma.stack.delete({ where: { id: stack.id } });
  res.json({ success: true });
});

// ─── Stack status (refresh container states) ────────────────

router.get("/:id/status", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const stackDir = `/opt/obb-stacks/${stack.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;
  const ps = await sshExec(server,
    `cd "${stackDir}" && docker compose ps --format "{{.Name}}|{{.Status}}|{{.Image}}" 2>/dev/null`).catch(() => "");

  const containers = ps.split("\n").filter(Boolean).map(line => {
    const [name, status, image] = line.split("|");
    return { name, status, image };
  });

  res.json({ containers, total: containers.length });
});

// ─── Stack logs ─────────────────────────────────────────────

router.get("/:id/logs", async (req: Request, res: Response) => {
  const stack = await prisma.stack.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!stack) return res.status(404).json({ error: "Stack not found" });

  const server = await prisma.server.findUnique({ where: { id: stack.serverId } });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const tail = parseInt(req.query.tail as string) || 150;
  const stackDir = `/opt/obb-stacks/${stack.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  try {
    const logs = await sshExec(server,
      `cd "${stackDir}" && docker compose logs --tail ${tail} --no-color 2>&1`, 15000);
    res.json({ logs });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper ─────────────────────────────────────────────────

function extractServiceNames(compose: string): string[] {
  const names: string[] = [];
  const lines = compose.split("\n");
  let inServices = false;

  for (const line of lines) {
    // Detect "services:" at top level (no leading spaces)
    if (line.match(/^services:\s*$/)) { inServices = true; continue; }
    if (inServices) {
      // Service name: exactly 2 spaces (or 1 tab) + word + colon
      const match = line.match(/^[ \t]{1,4}([\w][\w.-]*):\s*$/);
      if (match) names.push(match[1]);
      // Stop at next top-level key (no indent)
      if (line.match(/^[a-z]/) && !line.match(/^\s/)) inServices = false;
    }
  }
  return names;
}

export default router;
