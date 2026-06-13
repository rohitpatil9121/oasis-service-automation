import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

// Verifies the Bearer JWT and attaches { id, role, full_name } to req.user.
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: "Missing bearer token" });
  try {
    req.user = jwt.verify(token, env.jwtSecret);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

export function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, full_name: user.full_name, phone: user.phone },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn }
  );
}
