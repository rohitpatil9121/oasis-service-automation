// Role-based access control groundwork.
// Usage: router.get("/x", requireAuth, requireRole("owner","manager"), handler)
export function requireRole(...allowed) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "Not authenticated" });
    if (!allowed.includes(req.user.role))
      return res.status(403).json({ error: "Insufficient role", need: allowed });
    next();
  };
}

// Central permission map - extend in later phases.
export const PERMISSIONS = {
  owner:      ["tickets:read", "tickets:write", "tickets:assign", "users:manage"],
  manager:    ["tickets:read", "tickets:write", "tickets:assign"],
  technician: ["tickets:read:assigned", "tickets:update:assigned"],
  customer:   [],
};
