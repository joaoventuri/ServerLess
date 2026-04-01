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

// Detect docker compose v1 vs v2
async function getComposeCmd(server: any): Promise<string> {
  const v2 = await sshExec(server, `docker compose version 2>/dev/null && echo "V2OK"`).catch(() => "");
  if (v2.includes("V2OK")) return "docker compose";
  const v1 = await sshExec(server, `docker-compose version 2>/dev/null && echo "V1OK"`).catch(() => "");
  if (v1.includes("V1OK")) return "docker-compose";
  throw new Error("Neither 'docker compose' (v2) nor 'docker-compose' (v1) found. Install docker-compose first.");
}

// Write file to remote via SSH (handles special chars safely)
async function sshWriteFile(server: any, path: string, content: string) {
  const b64 = Buffer.from(content).toString("base64");
  // Split into chunks to avoid command line length limits
  const chunkSize = 4000;
  await sshExec(server, `rm -f "${path}"`);
  for (let i = 0; i < b64.length; i += chunkSize) {
    const chunk = b64.slice(i, i + chunkSize);
    await sshExec(server, `printf '%s' '${chunk}' >> "${path}.b64"`);
  }
  await sshExec(server, `base64 -d "${path}.b64" > "${path}" && rm -f "${path}.b64"`);
}

async function deployStack(stackId: string, server: any, name: string, compose: string) {
  const stackDir = `/opt/obb-stacks/${name.replace(/[^a-zA-Z0-9_-]/g, "_")}`;

  try {
    const composeCmd = await getComposeCmd(server);
    console.log(`[Stack] Using "${composeCmd}" on ${server.host}`);

    await sshExec(server, `mkdir -p "${stackDir}"`);

    // Write compose file safely
    await sshWriteFile(server, `${stackDir}/docker-compose.yml`, compose);

    // Verify file was written
    const check = await sshExec(server, `wc -c < "${stackDir}/docker-compose.yml"`);
    if (parseInt(check) < 10) throw new Error("Failed to write docker-compose.yml to server");

    // Deploy
    const output = await sshExec(server,
      `cd "${stackDir}" && ${composeCmd} pull 2>&1; ${composeCmd} up -d 2>&1`,
      300000
    );

    console.log(`[Stack] Deployed "${name}": ${output.slice(-300)}`);

    // Wait for containers to start
    let containerNames: string[] = [];
    for (let i = 0; i < 5; i++) {
      await new Promise(r => setTimeout(r, 3000));
      const ps = await sshExec(server,
        `cd "${stackDir}" && ${composeCmd} ps 2>/dev/null | awk 'NR>1{print $1}'`).catch(() => "");
      containerNames = ps.split("\n").filter(Boolean).filter(n => n !== "NAME" && n !== "---");
      if (containerNames.length > 0) break;
    }

    // Fallback: parse from compose
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
  const cc = await getComposeCmd(server);
  await sshExec(server, `cd "${stackDir}" && ${cc} stop 2>&1`);
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
  const cc = await getComposeCmd(server);
  await sshExec(server, `cd "${stackDir}" && ${cc} up -d 2>&1`);
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
    const cc = await getComposeCmd(server).catch(() => "docker-compose");
    await sshExec(server, `cd "${stackDir}" && ${cc} down --remove-orphans 2>/dev/null; rm -rf "${stackDir}"`).catch(() => {});
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
    `cd "${stackDir}" && (docker compose ps --format "{{.Name}}|{{.Status}}|{{.Image}}" 2>/dev/null || docker-compose ps 2>/dev/null | awk 'NR>1{print $1"|"$3"|"$2}')`).catch(() => "");

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
    // Use stored container names first, then try compose ps
    let names = stack.containerNames.filter(Boolean);

    if (names.length === 0) {
      const ps = await sshExec(server,
        `cd "${stackDir}" 2>/dev/null && (docker compose ps --format "{{.Name}}" 2>/dev/null || docker-compose ps 2>/dev/null | awk 'NR>1{print $1}') || echo ""`).catch(() => "");
      names = ps.split("\n").filter(n => n.trim() && !n.includes("No such file"));
    }

    if (names.length === 0) {
      return res.json({ logs: "No containers found for this stack. Try redeploying." });
    }

    // Get logs from each container individually
    let allLogs = "";
    for (const name of names) {
      if (!name.trim()) continue;
      const containerLogs = await sshExec(server,
        `docker logs --tail ${Math.floor(tail / Math.max(names.length, 1))} ${name} 2>&1`).catch(() => "");
      if (containerLogs) {
        allLogs += `\n━━━ ${name} ━━━\n${containerLogs}\n`;
      }
    }

    res.json({ logs: allLogs.trim() || "No logs available" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Helper ─────────────────────────────────────────────────

function extractServiceNames(compose: string): string[] {
  // Docker compose keys that are NOT service names
  const reserved = new Set([
    "image", "container_name", "restart", "ports", "environment", "volumes",
    "depends_on", "command", "entrypoint", "networks", "labels", "deploy",
    "healthcheck", "build", "cap_add", "cap_drop", "security_opt", "sysctls",
    "working_dir", "shm_size", "stdin_open", "tty", "logging", "extra_hosts",
    "ulimits", "test", "interval", "timeout", "retries", "condition",
    "driver", "external", "name",
  ]);

  const names: string[] = [];
  const lines = compose.split("\n");
  let inServices = false;
  let serviceIndent = -1;

  for (const line of lines) {
    const trimmed = line.trimEnd();
    if (!trimmed) continue;

    // Count leading spaces
    const indent = line.length - line.trimStart().length;

    // Detect "services:" at indent 0
    if (trimmed.match(/^services:\s*$/)) {
      inServices = true;
      serviceIndent = -1;
      continue;
    }

    // Stop at next top-level key
    if (inServices && indent === 0 && trimmed.match(/^\w/)) {
      inServices = false;
      continue;
    }

    if (inServices) {
      // First indented key after "services:" defines the service indent level
      if (serviceIndent === -1 && indent > 0 && trimmed.endsWith(":")) {
        serviceIndent = indent;
      }

      // Service names are at exactly the service indent level
      if (serviceIndent > 0 && indent === serviceIndent) {
        const match = trimmed.match(/^([\w][\w.-]*):\s*$/);
        if (match && !reserved.has(match[1])) {
          names.push(match[1]);
        }
      }
    }
  }
  return names;
}

export default router;
