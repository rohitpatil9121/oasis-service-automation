import { Router } from "express";
import authRoutes from "./auth.js";
import ticketRoutes from "./tickets.js";
import technicianRoutes from "./technicians.js";
import stockRoutes from "./stock.js";

const router = Router();
router.use("/auth", authRoutes);
router.use("/tickets", ticketRoutes);
router.use("/technicians", technicianRoutes);
router.use("/stock", stockRoutes);
export default router;
