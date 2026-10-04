// services/notification-service/server.js
// SmartShelf Notification Service — consumes order events from the notifications queue,
// dispatches alerts to store staff channels, and keeps an auditable notification history.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { connectDB, checkDBHealth, logger, loadConfig, queue } = require("../shared");
const { formatNotification, dispatch } = require("./dispatcher");

process.env.SERVICE_NAME = "notification-service";

const app = express();
app.use(express.json());

const config = loadConfig();
const PORT = config.notificationPort || 3003;
const NOTIFICATIONS_QUEUE = config.sqsNotificationsQueueUrl || "smartshelf-notifications-queue";
const WEBHOOK_URL = process.env.NOTIFICATION_WEBHOOK_URL || "";

let db;

// ---- Health Check ----
app.get("/health", async (req, res) => {
  try {
    await checkDBHealth();
    res.json({ status: "healthy", service: "notification-service", timestamp: new Date().toISOString() });
  } catch (err) {
    logger.error("Health check failed", { error: err.message });
    res.status(503).json({ status: "unhealthy", error: err.message });
  }
});

// ---- Root Info ----
app.get("/", (req, res) => {
  res.json({
    service: "SmartShelf Notification Service",
    status: "running",
    channels: WEBHOOK_URL ? ["console", "webhook"] : ["console"],
  });
});

// ---- Notification history (optional filters: store_id, product_id, event_type) ----
app.get("/notifications", async (req, res) => {
  try {
    const filter = {};
    for (const key of ["store_id", "product_id", "event_type"]) {
      if (req.query[key]) filter[key] = req.query[key];
    }
    const items = await db.collection("notifications").find(filter).sort({ created_at: -1 }).limit(100).toArray();
    res.json({ count: items.length, notifications: items });
  } catch (err) {
    logger.error("GET /notifications failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Aggregate counts + queue depth ----
app.get("/notifications/stats", async (req, res) => {
  try {
    const [byType, queueStats] = await Promise.all([
      db.collection("notifications").aggregate([{ $group: { _id: "$event_type", count: { $sum: 1 } } }]).toArray(),
      queue.getQueueStats(NOTIFICATIONS_QUEUE),
    ]);
    res.json({
      byEventType: Object.fromEntries(byType.map((t) => [t._id, t.count])),
      queue: queueStats,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("GET /notifications/stats failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ================================================================
// QUEUE CONSUMER
// ================================================================

function startNotificationConsumer() {
  logger.info("Initializing Notification Consumer", { queueUrl: NOTIFICATIONS_QUEUE });

  return queue.startQueueConsumer({
    queueUrl: NOTIFICATIONS_QUEUE,
    pollIntervalMs: 1000,
    batchSize: 10,
    handler: async (event, rawMessage) => {
      const notification = formatNotification(event);
      if (!notification) {
        logger.warn("Ignored unsupported notification event", { event_type: event && event.event_type });
        return;
      }

      // At-least-once delivery: skip messages already recorded (redelivery after visibility timeout)
      const seen = await db.collection("notifications").findOne({ message_id: rawMessage.MessageId });
      if (seen) {
        logger.info("Duplicate notification message skipped", { message_id: rawMessage.MessageId });
        return;
      }

      const deliveries = await dispatch(notification, WEBHOOK_URL);

      try {
        await db.collection("notifications").insertOne({
          message_id: rawMessage.MessageId,
          event_type: event.event_type,
          order_id: event.order_id,
          store_id: event.store_id,
          product_id: event.product_id,
          ...notification,
          deliveries,
          event_timestamp: event.timestamp ? new Date(event.timestamp) : null,
          created_at: new Date(),
        });
      } catch (err) {
        if (err.code !== 11000) throw err; // another replica recorded it first
      }
    },
  });
}

// ================================================================
// STARTUP
// ================================================================

connectDB()
  .then(async (database) => {
    db = database;
    await db.collection("notifications").createIndex({ message_id: 1 }, { unique: true });

    app.listen(PORT, () => {
      logger.info(`Notification Service listening on http://localhost:${PORT}`);
      startNotificationConsumer();
    });
  })
  .catch((err) => {
    logger.error("Failed to start Notification Service", { error: err.message });
    process.exit(1);
  });

module.exports = app; // for testing
