import { Queue, Worker } from "bullmq";
import { redis } from "../../config/redis";
import { prisma } from "../../config/db";
import { dispatchWebhook } from "../../services/webhook";
import tls from "tls";

export const healthQueue = new Queue("health-checks", { connection: redis });

export function startHealthWorker() {
  const worker = new Worker(
    "health-checks",
    async (job) => {
      const { healthCheckId } = job.data;
      const check = await prisma.healthCheck.findUnique({ where: { id: healthCheckId } });
      if (!check) return;

      let statusCode: number | null = null;
      let responseTimeMs: number | null = null;
      let isUp = false;
      let error: string | null = null;

      const start = Date.now();
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const resp = await fetch(check.url, {
          method: check.method,
          signal: controller.signal,
          redirect: "follow",
        });
        clearTimeout(timeout);
        statusCode = resp.status;
        responseTimeMs = Date.now() - start;
        isUp = statusCode === check.expectedStatus;
      } catch (err: any) {
        error = err.message || "Request failed";
        responseTimeMs = Date.now() - start;
      }

      await prisma.ping.create({
        data: { healthCheckId, statusCode, responseTimeMs, isUp, error },
      });

      const wasUp = check.isUp;
      await prisma.healthCheck.update({
        where: { id: healthCheckId },
        data: { isUp, lastCheckedAt: new Date() },
      });

      // Status changed: dispatch webhook
      if (wasUp && !isUp) {
        await dispatchWebhook(check.workspaceId, "health.down", {
          name: check.name, url: check.url, statusCode, error,
        });
      } else if (!wasUp && isUp) {
        await dispatchWebhook(check.workspaceId, "health.up", {
          name: check.name, url: check.url, statusCode,
        });
      }

      // SSL check
      if (check.sslCheck && check.url.startsWith("https")) {
        try {
          const hostname = new URL(check.url).hostname;
          const sslExpiry = await checkSslExpiry(hostname);
          await prisma.healthCheck.update({
            where: { id: healthCheckId },
            data: { sslExpiresAt: sslExpiry },
          });
          const daysLeft = (sslExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24);
          if (daysLeft < 15) {
            await dispatchWebhook(check.workspaceId, "ssl.expiring", {
              name: check.name, url: check.url, daysLeft: Math.floor(daysLeft),
              expiresAt: sslExpiry.toISOString(),
            });
          }
        } catch { /* ssl check failed, ignore */ }
      }
    },
    { connection: redis, concurrency: 10 }
  );

  worker.on("failed", (job, err) => {
    console.error(`Health check job ${job?.id} failed:`, err.message);
  });

  return worker;
}

function checkSslExpiry(hostname: string): Promise<Date> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(443, hostname, { servername: hostname }, () => {
      const cert = socket.getPeerCertificate();
      socket.destroy();
      if (cert && cert.valid_to) {
        resolve(new Date(cert.valid_to));
      } else {
        reject(new Error("No certificate"));
      }
    });
    socket.on("error", reject);
    socket.setTimeout(5000, () => { socket.destroy(); reject(new Error("Timeout")); });
  });
}
