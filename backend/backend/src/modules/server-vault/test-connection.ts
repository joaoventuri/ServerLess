import { Router, Request, Response } from "express";
import { Client as SSHClient } from "ssh2";
import { prisma } from "../../config/db";

const router = Router();

router.post("/:id/test", async (req: Request, res: Response) => {
  const server = await prisma.server.findFirst({
    where: { id: req.params.id, workspaceId: req.auth!.workspaceId },
  });
  if (!server) return res.status(404).json({ error: "Server not found" });

  const ssh = new SSHClient();
  const startTime = Date.now();

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        ssh.end();
        reject(new Error("ETIMEDOUT"));
      }, 10000);

      ssh.on("ready", () => {
        clearTimeout(timeout);
        ssh.end();
        resolve();
      });

      ssh.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });

      const config: any = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 10000,
      };
      if (server.authType === "key" && server.privateKey) {
        config.privateKey = server.privateKey;
      } else {
        config.password = server.password;
      }
      ssh.connect(config);
    });

    const elapsed = Date.now() - startTime;
    await prisma.server.update({
      where: { id: server.id },
      data: { isOnline: true, lastSeenAt: new Date() },
    });

    res.json({ success: true, latencyMs: elapsed, message: `Connected in ${elapsed}ms` });
  } catch (err: any) {
    const elapsed = Date.now() - startTime;
    const msg = err.message || String(err);

    let friendly: string;
    if (msg.includes("ECONNREFUSED")) {
      friendly = `Connection refused by ${server.host}:${server.port}. Verify SSH is running on that port.`;
    } else if (msg.includes("ETIMEDOUT") || msg.includes("Timed out")) {
      friendly = `Connection timed out after ${elapsed}ms. Check firewall rules or host address.`;
    } else if (msg.includes("ENOTFOUND")) {
      friendly = `Host "${server.host}" not found. Check the hostname or IP address.`;
    } else if (msg.includes("Authentication") || msg.includes("auth")) {
      friendly = `Authentication failed. Check username and password/key.`;
    } else {
      friendly = `Connection failed: ${msg}`;
    }

    await prisma.server.update({
      where: { id: server.id },
      data: { isOnline: false },
    });

    res.status(502).json({ success: false, latencyMs: elapsed, error: friendly });
  }
});

export default router;
