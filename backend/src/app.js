import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { log } from "./lib/logger.js";
import apiRoutes from "./routes/index.js";
import webhookRoutes from "./routes/webhook.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.corsOrigin.split(",").map((s) => s.trim()) }));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true })); // Twilio webhooks

  app.get("/health", (req, res) =>
    res.json({ ok: true, service: "oasis-globe", mock: env.whatsappMock }));

  app.use("/api", apiRoutes);
  app.use("/webhook", webhookRoutes);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
