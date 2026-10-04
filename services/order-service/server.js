// services/order-service/server.js
// SmartShelf Order Service — Express REST API
// Manages replenishment orders, order lifecycles, and automated restocking.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { connectDB, checkDBHealth, logger, loadConfig } = require("../shared");
const { createOrder, createReplenishmentOrder, updateOrderStatus } = require("./order_manager");
const { startOrderQueueWorker } = require("./order_queue_worker");

process.env.SERVICE_NAME = "order-service";

const app = express();
app.use(express.json());

const config = loadConfig();
const PORT = config.orderPort || 3004;

let db;

// ---- Health Check ----
app.get("/health", async (req, res) => {
  try {
    await checkDBHealth();
    res.json({
      status: "healthy",
      service: "order-service",
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("Health check failed", { error: err.message });
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ---- Root Info ----
app.get("/", (req, res) => {
  res.json({
    service: "SmartShelf Order Service",
    status: "running",
  });
});

// ---- List Orders ----
app.get("/orders", async (req, res) => {
  try {
    const { store_id, status } = req.query;
    const filter = {};
    if (store_id) filter.store_id = store_id;
    if (status) filter.status = status;

    const orders = await db.collection("orders").find(filter).sort({ created_at: -1 }).toArray();
    res.json(orders);
  } catch (err) {
    logger.error("GET /orders failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Get Order by ID ----
app.get("/orders/:order_id", async (req, res) => {
  try {
    const order = await db.collection("orders").findOne({ order_id: req.params.order_id });
    if (!order) {
      return res.status(404).json({ error: `Order ${req.params.order_id} not found` });
    }
    res.json(order);
  } catch (err) {
    logger.error("GET /orders/:id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Create Manual Order ----
app.post("/orders", async (req, res) => {
  try {
    const { store_id, product_id, quantity, notes, unit_price } = req.body;
    if (!store_id || !product_id || !quantity) {
      return res.status(400).json({ error: "Missing required fields: store_id, product_id, quantity" });
    }

    const order = await createOrder(db, {
      store_id,
      product_id,
      quantity,
      source: "manual_api",
      notes: notes || "",
      unit_price: unit_price || 2.5,
    });

    res.status(201).json(order);
  } catch (err) {
    logger.error("POST /orders failed", { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ---- Trigger Automated Replenishment Order ----
app.post("/orders/replenish", async (req, res) => {
  try {
    const { store_id, product_id } = req.body;
    if (!store_id || !product_id) {
      return res.status(400).json({ error: "Missing required fields: store_id, product_id" });
    }

    const result = await createReplenishmentOrder(db, { store_id, product_id });
    if (result.duplicate) {
      return res.status(409).json(result);
    }

    res.status(201).json(result);
  } catch (err) {
    logger.error("POST /orders/replenish failed", { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ---- Update Order Status ----
app.put("/orders/:order_id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status) {
      return res.status(400).json({ error: "Missing required field: status" });
    }

    const updated = await updateOrderStatus(db, req.params.order_id, status);
    if (!updated) {
      return res.status(404).json({ error: `Order ${req.params.order_id} not found` });
    }

    res.json(updated);
  } catch (err) {
    logger.error("PUT /orders/:id/status failed", { error: err.message });
    res.status(400).json({ error: err.message });
  }
});

// ---- Cancel Order ----
app.delete("/orders/:order_id", async (req, res) => {
  try {
    const order = await db.collection("orders").findOne({ order_id: req.params.order_id });
    if (!order) {
      return res.status(404).json({ error: `Order ${req.params.order_id} not found` });
    }

    if (order.status === "DELIVERED") {
      return res.status(400).json({ error: "Cannot cancel an order that has already been delivered" });
    }

    await db.collection("orders").updateOne(
      { order_id: req.params.order_id },
      { $set: { status: "CANCELLED", updated_at: new Date() } }
    );

    res.json({ message: `Order ${req.params.order_id} cancelled successfully` });
  } catch (err) {
    logger.error("DELETE /orders/:id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================================================================
// STARTUP
// ================================================================

connectDB()
  .then((database) => {
    db = database;
    app.listen(PORT, () => {
      logger.info(`Order Service listening on http://localhost:${PORT}`);
      // Start background queue consumer worker for replenishment events
      startOrderQueueWorker(db);
    });
  })
  .catch((err) => {
    logger.error("Failed to connect to MongoDB", { error: err.message });
    process.exit(1);
  });

module.exports = app; // for testing
