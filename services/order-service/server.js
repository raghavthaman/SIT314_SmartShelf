// services/order-service/server.js
// SmartShelf Order Service — Express REST API
// Turns replenishment events into purchase orders (sized by EOQ) and manages
// the order lifecycle: PENDING -> CONFIRMED -> DISPATCHED -> DELIVERED (or CANCELLED).

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { connectDB, checkDBHealth, logger, loadConfig, queue } = require("../shared");
const { OPEN_STATUSES, TRANSITIONS, canTransition } = require("./order_engine");
const { startStockEventConsumer, createReplenishmentOrder } = require("./event_consumer");

process.env.SERVICE_NAME = "order-service";

const app = express();
app.use(express.json());

const config = loadConfig();
const PORT = config.orderPort || 3004;
const ctx = {
  forecastServiceUrl: config.forecastServiceUrl,
  stockEventsQueueUrl: config.sqsStockEventsQueueUrl || "smartshelf-stock-events-queue",
  notificationsQueueUrl: config.sqsNotificationsQueueUrl || "smartshelf-notifications-queue",
};

let db;

// ---- Health Check ----
app.get("/health", async (req, res) => {
  try {
    await checkDBHealth();
    res.json({ status: "healthy", service: "order-service", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Health check failed", { error: err.message });
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ---- Root Info ----
app.get("/", (req, res) => {
  res.json({ service: "SmartShelf Order Service", status: "running", lifecycle: TRANSITIONS });
});

// ---- List orders (optional filters: store_id, product_id, status) ----
app.get("/orders", async (req, res) => {
  try {
    const filter = {};
    for (const key of ["store_id", "product_id", "status"]) {
      if (req.query[key]) filter[key] = req.query[key];
    }
    const orders = await db.collection("orders").find(filter).sort({ created_at: -1 }).limit(100).toArray();
    res.json({ count: orders.length, orders });
  } catch (err) {
    logger.error("GET /orders failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Get one order ----
app.get("/orders/:order_id", async (req, res) => {
  try {
    const order = await db.collection("orders").findOne({ order_id: req.params.order_id });
    if (!order) return res.status(404).json({ error: "Order not found" });
    res.json(order);
  } catch (err) {
    logger.error("GET /orders/:id failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Manually request a replenishment order ----
app.post("/orders", async (req, res) => {
  try {
    const { store_id, product_id } = req.body;
    if (!store_id || !product_id) {
      return res.status(400).json({ error: "Missing required fields: store_id, product_id" });
    }

    const product = await db.collection("products").findOne({ product_id });
    if (!product) return res.status(404).json({ error: `Product ${product_id} not found` });

    const inv = await db.collection("inventory_status").findOne({ store_id, product_id });
    const current_stock = inv ? inv.on_hand_qty : 0;

    const result = await createReplenishmentOrder(
      db,
      { store_id, product_id, current_stock, reason: "MANUAL" },
      ctx
    );

    if (!result.created) {
      return res.status(409).json({
        error: "An open order already exists for this store/product",
        order_id: result.existing && result.existing.order_id,
      });
    }
    logger.info("Manual order created", { order_id: result.order.order_id });
    res.status(201).json(result.order);
  } catch (err) {
    logger.error("POST /orders failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Advance order lifecycle ----
app.patch("/orders/:order_id/status", async (req, res) => {
  try {
    const { status } = req.body;
    if (!status || !TRANSITIONS[status]) {
      return res.status(400).json({ error: `status must be one of ${Object.keys(TRANSITIONS).join(", ")}` });
    }

    const order = await db.collection("orders").findOne({ order_id: req.params.order_id });
    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!canTransition(order.status, status)) {
      return res.status(409).json({ error: `Invalid transition ${order.status} -> ${status}` });
    }

    const now = new Date();
    // Conditional update on the current status guards against concurrent transitions
    const result = await db.collection("orders").findOneAndUpdate(
      { order_id: order.order_id, status: order.status },
      {
        $set: { status, open: OPEN_STATUSES.includes(status), updated_at: now },
        $push: { status_history: { status, at: now } },
      },
      { returnDocument: "after" }
    );
    if (!result) return res.status(409).json({ error: "Order was modified concurrently, retry" });

    // Delivery replenishes the shelf stock
    if (status === "DELIVERED") {
      await db.collection("inventory_status").updateOne(
        { store_id: order.store_id, product_id: order.product_id },
        { $inc: { on_hand_qty: order.quantity }, $set: { last_updated: now, last_sensor: "order-delivery" } },
        { upsert: true }
      );
    }

    await queue.sendMessage(ctx.notificationsQueueUrl, {
      event_type: "ORDER_STATUS_CHANGED",
      order_id: order.order_id,
      store_id: order.store_id,
      product_id: order.product_id,
      product_name: order.product_name,
      quantity: order.quantity,
      previous_status: order.status,
      status,
      timestamp: now.toISOString(),
    });

    logger.info("Order status changed", { order_id: order.order_id, from: order.status, to: status });
    res.json(result);
  } catch (err) {
    logger.error("PATCH /orders/:id/status failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================================================================
// STARTUP
// ================================================================

connectDB()
  .then(async (database) => {
    db = database;
    // At most one open order per store/product — enforced by the database, safe across replicas
    await db.collection("orders").createIndex(
      { store_id: 1, product_id: 1 },
      { unique: true, partialFilterExpression: { open: true }, name: "one_open_order_per_product" }
    );
    await db.collection("orders").createIndex({ order_id: 1 }, { unique: true });

    app.listen(PORT, () => {
      logger.info(`Order Service listening on http://localhost:${PORT}`);
      startStockEventConsumer(db, ctx);
    });
  })
  .catch((err) => {
    logger.error("Failed to start Order Service", { error: err.message });
    process.exit(1);
  });

module.exports = app; // for testing
