import { prisma } from "../config/db";

export async function dispatchWebhook(workspaceId: string, event: string, data: Record<string, unknown>) {
  const webhooks = await prisma.webhook.findMany({
    where: {
      workspaceId,
      isActive: true,
      events: { has: event },
    },
  });

  for (const wh of webhooks) {
    try {
      await fetch(wh.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event, timestamp: new Date().toISOString(), data }),
      });
    } catch (err) {
      console.error(`Webhook ${wh.id} failed:`, err);
    }
  }
}
