// services/shared/index.js
// Re-exports all shared modules for convenient access.

const { connectDB, closeDB, client, checkDBHealth } = require("./db");
const logger = require("./logger");
const { loadConfig } = require("./config");

module.exports = {
  connectDB,
  closeDB,
  client,
  checkDBHealth,
  logger,
  loadConfig,
};
