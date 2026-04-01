import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  // Create admin user
  const password = await bcrypt.hash("admin123", 10);
  const user = await prisma.user.upsert({
    where: { email: "admin@opsbigbro.local" },
    update: {},
    create: {
      name: "Admin",
      email: "admin@opsbigbro.local",
      password,
    },
  });

  // Create default workspace
  const workspace = await prisma.workspace.upsert({
    where: { slug: "default" },
    update: {},
    create: {
      name: "Default Workspace",
      slug: "default",
      members: {
        create: { userId: user.id, role: "owner" },
      },
    },
  });

  console.log("Seed complete.");
  console.log(`  User: admin@opsbigbro.local / admin123`);
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
