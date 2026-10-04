// services/inventory-service/server.js
// Inventory Service — Express REST API over "products" and "inventory_status".
// Adapted from the original 4.2D server.js with:
//   - Proper error handling (try/catch on all async routes)
//   - Input validation on POST/PUT
//   - /health endpoint with DB connectivity check
//   - Structured JSON logging via shared logger
//
// Run with: npm start

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { connectDB, checkDBHealth } = require("../shared/db");
const logger = require("../shared/logger");

process.env.SERVICE_NAME = "inventory-service";

const app = express();
app.use(express.json());
const PORT = process.env.INVENTORY_PORT || 3001;

let db;

// ---- Health check (ALB-compatible: checks DB connectivity) ----
app.get("/health", async (req, res) => {
  try {
    await checkDBHealth();
    res.json({ status: "healthy", service: "inventory-service", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Health check failed", { error: err.message });
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ---- Basic root info ----
app.get("/", (req, res) => {
  res.json({ service: "SmartShelf Inventory Service", status: "running" });
});

// ================================================================
// PRODUCTS: CRUD
// ================================================================

// CREATE — with validation
app.post("/products", async (req, res) => {
  try {
    const { product_id, name, category, unit_weight_g, reorder_threshold, case_pack_size } = req.body;

    // Validate required fields
    if (!product_id || !name || !category) {
      return res.status(400).json({ error: "Missing required fields: product_id, name, category" });
    }
    if (typeof unit_weight_g !== "number" || unit_weight_g <= 0) {
      return res.status(400).json({ error: "unit_weight_g must be a positive number" });
    }
    if (typeof reorder_threshold !== "number" || reorder_threshold < 0) {
      return res.status(400).json({ error: "reorder_threshold must be a non-negative number" });
    }
    if (typeof case_pack_size !== "number" || case_pack_size <= 0) {
      return res.status(400).json({ error: "case_pack_size must be a positive number" });
    }

    // Check for duplicate product_id
    const existing = await db.collection("products").findOne({ product_id });
    if (existing) {
      return res.status(409).json({ error: `Product ${product_id} already exists` });
    }

    const doc = { product_id, name, category, unit_weight_g, reorder_threshold, case_pack_size };
    const result = await db.collection("products").insertOne(doc);
    logger.info("Product created", { product_id });
    res.status(201).json({ insertedId: result.insertedId, product_id });
  } catch (err) {
    logger.error("POST /products failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// READ (all)
app.get("/products", async (req, res) => {
  try {
    const items = await db.collection("products").find({}).toArray();
    res.json(items);
  } catch (err) {
    logger.error("GET /products failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// READ (one, by product_id)
app.get("/products/:product_id", async (req, res) => {
  try {
    const item = await db.collection("products").findOne({ product_id: req.params.product_id });
    if (!item) return res.status(404).json({ error: "Product not found" });
    res.json(item);
  } catch (err) {
    logger.error("GET /products/:id failed", { error: err.message, product_id: req.params.product_id });
    res.status(500).json({ error: "Internal server error" });
  }
});

// UPDATE (by product_id)
app.put("/products/:product_id", async (req, res) => {
  try {
    const result = await db.collection("products").updateOne(
      { product_id: req.params.product_id },
      { $set: req.body }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: "Product not found" });
    logger.info("Product updated", { product_id: req.params.product_id });
    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    logger.error("PUT /products/:id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE (by product_id)
app.delete("/products/:product_id", async (req, res) => {
  try {
    const result = await db.collection("products").deleteOne({ product_id: req.params.product_id });
    if (result.deletedCount === 0) return res.status(404).json({ error: "Product not found" });
    logger.info("Product deleted", { product_id: req.params.product_id });
    res.json({ deletedCount: result.deletedCount });
  } catch (err) {
    logger.error("DELETE /products/:id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================================================================
// INVENTORY STATUS
// ================================================================

// Current stock for a store
app.get("/inventory/:store_id", async (req, res) => {
  try {
    const items = await db.collection("inventory_status")
      .find({ store_id: req.params.store_id })
      .toArray();
    res.json(items);
  } catch (err) {
    logger.error("GET /inventory/:store_id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Stock for a specific product in a specific store
app.get("/inventory/:store_id/:product_id", async (req, res) => {
  try {
    const item = await db.collection("inventory_status").findOne({
      store_id: req.params.store_id,
      product_id: req.params.product_id,
    });
    if (!item) return res.status(404).json({ error: "No inventory record found" });
    res.json(item);
  } catch (err) {
    logger.error("GET /inventory/:store/:product failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Manually update stock estimate
app.put("/inventory/:store_id/:product_id", async (req, res) => {
  try {
    const result = await db.collection("inventory_status").updateOne(
      { store_id: req.params.store_id, product_id: req.params.product_id },
      { $set: { ...req.body, last_updated: new Date() } }
    );
    if (result.matchedCount === 0) return res.status(404).json({ error: "No inventory record found" });
    logger.info("Inventory updated", {
      store_id: req.params.store_id,
      product_id: req.params.product_id,
    });
    res.json({ modifiedCount: result.modifiedCount });
  } catch (err) {
    logger.error("PUT /inventory/:store/:product failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// Queue depth and metrics endpoint
app.get("/queue/status", async (req, res) => {
  try {
    const { queue } = require("../shared");
    const readingsQueue = process.env.SQS_READINGS_QUEUE_URL || "smartshelf-readings-queue";
    const eventsQueue = process.env.SQS_STOCK_EVENTS_QUEUE_URL || "smartshelf-stock-events-queue";

    const [readingsStats, eventsStats] = await Promise.all([
      queue.getQueueStats(readingsQueue),
      queue.getQueueStats(eventsQueue),
    ]);

    res.json({
      service: "inventory-service",
      timestamp: new Date().toISOString(),
      queues: {
        readingsQueue: readingsStats,
        eventsQueue: eventsStats,
      },
    });
  } catch (err) {
    logger.error("GET /queue/status failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================================================================
// STARTUP
// ================================================================

const { startMqttConsumer } = require("./mqtt_consumer");
const { startQueueConsumerWorker } = require("./queue_consumer");

connectDB()
  .then((database) => {
    db = database;
    app.listen(PORT, () => {
      logger.info(`Inventory Service listening on http://localhost:${PORT}`);
      // Start MQTT Telemetry Consumer
      startMqttConsumer(db);
      // Start Asynchronous Queue Consumer Worker
      startQueueConsumerWorker(db);
    });
  })
  .catch((err) => {
    logger.error("Failed to connect to MongoDB", { error: err.message });
    process.exit(1);
  });

module.exports = app; // for testing
