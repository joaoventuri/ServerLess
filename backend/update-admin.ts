import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  const password = await bcrypt.hash("Johnny@2026@#", 10);
  
  const user = await prisma.user.upsert({
    where: { email: "hello@aitizer.com" },
    update: {
      password,
      name: "Admin"
    },
    create: {
      name: "Admin",
      email: "hello@aitizer.com",
      password,
    },
  });

  // Ensure user is in default workspace
  const workspace = await prisma.workspace.findFirst({
    where: { slug: "default" }
  });

  if (workspace) {
    await prisma.workspaceMember.upsert({
      where: {
        userId_workspaceId: {
          userId: user.id,
          workspaceId: workspace.id
        }
      },
      update: { role: "owner" },
      create: {
        userId: user.id,
        workspaceId: workspace.id,
        role: "owner"
      }
    });
  }

  console.log("✅ Admin updated successfully!");
  console.log(`  Email: hello@aitizer.com`);
  console.log(`  Password: Johnny@2026@#`);
  console.log(`  User ID: ${user.id}`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
