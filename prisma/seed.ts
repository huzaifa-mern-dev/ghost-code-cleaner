import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // Upsert dev store so re-running seed is idempotent
  const store = await prisma.store.upsert({
    where: { shopDomain: "ghost-code-test.myshopify.com" },
    update: {
      accessToken: "shpua_f49fe9224089dd64d03c915aee85d0f1",
    },
    create: {
      shopDomain: "ghost-code-test.myshopify.com",
      accessToken: "shpua_f49fe9224089dd64d03c915aee85d0f1",
      planTier: "free",
    },
  });

  console.log(`✅ Store seeded: ${store.shopDomain} (id: ${store.id})`);
}

main()
  .catch((err) => {
    console.error("❌ Seed failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
