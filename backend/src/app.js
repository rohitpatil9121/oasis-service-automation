import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import apiRoutes from "./routes/index.js";
import webhookRoutes from "./routes/webhook.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

// Strict on auth (brute-force), generous on the polling dashboard API, moderate
// on the public webhook (LLM cost-abuse). standardHeaders -> 429 + Retry-After.
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });
const apiLimiter = rateLimit({ windowMs: 60 * 1000, max: 240, standardHeaders: true, legacyHeaders: false });
const webhookLimiter = rateLimit({ windowMs: 60 * 1000, max: 120, standardHeaders: true, legacyHeaders: false });

export function createApp() {
  const app = express();

  app.disable("x-powered-by");          // don't leak the framework
  app.set("trust proxy", 1);            // behind Render/Vercel proxy -> real client IP for rate limiting
  app.use(helmet({ frameguard: { action: "deny" } })); // CSP, HSTS, X-Frame-Options: DENY, nosniff, etc.
  app.use(cors({ origin: env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json({ limit: "200kb" }));
  app.use(express.urlencoded({ extended: true, limit: "200kb" })); // Twilio webhooks

  app.get("/health", (req, res) =>
    res.json({ ok: true, service: "oasis-globe", mock: env.whatsappMock }));

  app.use("/api/auth", authLimiter);
  app.use("/api", apiLimiter);
  app.use("/webhook", webhookLimiter);

  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
