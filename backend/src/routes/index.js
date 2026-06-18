import { Router } from "express";
import authRoutes from "./auth.js";
import ticketRoutes from "./tickets.js";
import technicianRoutes from "./technicians.js";
import stockRoutes from "./stock.js";
import customerRoutes from "./customers.js";
import mediaRoutes from "./media.js";

const router = Router();
router.use("/auth", authRoutes);
router.use("/tickets", ticketRoutes);
router.use("/technicians", technicianRoutes);
router.use("/stock", stockRoutes);
router.use("/customers", customerRoutes);
router.use("/media", mediaRoutes);
export default router;
