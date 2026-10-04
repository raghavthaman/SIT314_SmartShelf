// services/shared/logger.js
// Structured JSON logger for all services.
// Keeps logs machine-parseable for CloudWatch / log aggregation.

const SERVICE = process.env.SERVICE_NAME || "unknown";

function formatLog(level, message, meta = {}) {
  return JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE,
    message,
    ...meta,
  });
}

const logger = {
  info(message, meta) {
    console.log(formatLog("info", message, meta));
  },
  warn(message, meta) {
    console.warn(formatLog("warn", message, meta));
  },
  error(message, meta) {
    console.error(formatLog("error", message, meta));
  },
  debug(message, meta) {
    if (process.env.LOG_LEVEL === "debug") {
      console.log(formatLog("debug", message, meta));
    }
  },
};

module.exports = logger;
