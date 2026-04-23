import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import helmet from "helmet";
import cors from "cors";

// ─────────────────────────────────────────────
// App Configuration
// ─────────────────────────────────────────────

const PORT = Number(process.env.PORT ?? 3001);
const NODE_ENV = process.env.NODE_ENV ?? "development";

// ─────────────────────────────────────────────
// Express Application
// ─────────────────────────────────────────────

const app = express();

// Security middleware
app.use(helmet());

// CORS — allow requests from the Next.js frontend in development
app.use(
  cors({
    origin:
      NODE_ENV === "production"
        ? process.env.SHOPIFY_APP_URL
        : "http://localhost:3000",
    credentials: true,
  })
);

// Body parsing
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────

/**
 * GET /health
 * Used by Docker health checks and load balancers.
 */
app.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    version: process.env.npm_package_version ?? "0.1.0",
    environment: NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

/**
 * GET /api/v1
 * API root — returns service metadata.
 */
app.get("/api/v1", (_req: Request, res: Response) => {
  res.json({
    service: "ghost-code-cleaner-api",
    version: "1",
    status: "operational",
  });
});

// ─────────────────────────────────────────────
// 404 Handler
// ─────────────────────────────────────────────

app.use((_req: Request, res: Response) => {
  res.status(404).json({ error: "Not Found" });
});

// ─────────────────────────────────────────────
// Global Error Handler
// ─────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[error]", err.message, err.stack);
  res.status(500).json({
    error: NODE_ENV === "production" ? "Internal Server Error" : err.message,
  });
});

// ─────────────────────────────────────────────
// Start Server
// ─────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(
    `[ghost-api] Server running on http://localhost:${PORT} (${NODE_ENV})`
  );
});

export default app;
