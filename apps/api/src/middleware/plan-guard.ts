import { Request, Response, NextFunction } from "express";
import { PrismaClient } from "@prisma/client";
import { PLAN_CONFIG } from "@ghost/shopify";

const prisma = new PrismaClient();

export const checkPlanLimit = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    // Audit check requires storeId. Purge check might require auditId.
    // Let's dynamically find the store ID based on the route.
    let storeId: string | undefined;

    if (req.body.storeId) {
      storeId = req.body.storeId;
    } else if (req.body.auditId) {
      const audit = await prisma.audit.findUnique({ where: { id: req.body.auditId } });
      if (audit) storeId = audit.storeId;
    }

    if (!storeId) {
      // If we can't find storeId, skip plan guard or reject?
      // Since some routes might not have these, we could just let them pass and fail later
      // But for /audit and /purge, they always have storeId or auditId
      return next();
    }

    const store = await prisma.store.findUnique({ where: { id: storeId } });
    if (!store) {
      return next();
    }

    const planId = store.planTier.toLowerCase() as keyof typeof PLAN_CONFIG;
    const plan = PLAN_CONFIG[planId] || PLAN_CONFIG.free;

    const action = req.path.includes("purge") ? "purge" : "audit";

    if (action === "purge") {
      if (!plan.purgeEnabled) {
        res.status(403).json({ error: "Upgrade required to run purges", upgradeUrl: "/pricing" });
        return;
      }
    } else if (action === "audit") {
      if (plan.auditLimit < 999) {
        const startOfMonth = new Date();
        startOfMonth.setDate(1);
        startOfMonth.setHours(0, 0, 0, 0);

        const auditCount = await prisma.audit.count({
          where: {
            storeId,
            startedAt: { gte: startOfMonth }
          }
        });

        if (auditCount >= plan.auditLimit) {
          res.status(403).json({ error: "Monthly audit limit reached. Please upgrade your plan.", upgradeUrl: "/pricing" });
          return;
        }
      }
    }

    next();
  } catch (err) {
    console.error("Plan Guard Error:", err);
    res.status(500).json({ error: "Failed to verify plan limits" });
  }
};
