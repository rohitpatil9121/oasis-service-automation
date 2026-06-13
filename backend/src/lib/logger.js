// Tiny structured logger (no dependency). Swap for pino in production.
const ts = () => new Date().toISOString();
const fmt = (level, args) =>
  [`[${ts()}]`, `[${level}]`, ...args];

export const log = {
  info: (...a) => console.log(...fmt("INFO", a)),
  warn: (...a) => console.warn(...fmt("WARN", a)),
  error: (...a) => console.error(...fmt("ERROR", a)),
  debug: (...a) =>
    process.env.NODE_ENV !== "production" && console.log(...fmt("DEBUG", a)),
};
