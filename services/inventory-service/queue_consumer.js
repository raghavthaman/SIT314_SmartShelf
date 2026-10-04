// services/inventory-service/queue_consumer.js
// Asynchronous SQS / Queue Consumer for SmartShelf Inventory Service.
// Consumes telemetry events buffered by Node-RED / gateway, applies backpressure smoothing,
// persists records in MongoDB Atlas, and dispatches stock replenishment events.

const { queue, logger } = require("../shared");

function startQueueConsumerWorker(db, queueUrl = "smartshelf-readings-queue") {
  logger.info("Initializing Asynchronous Queue Consumer Worker", { queueUrl });

  const worker = queue.startQueueConsumer({
    queueUrl,
    pollIntervalMs: 800,
    batchSize: 10,
    handler: async (payload, rawMessage) => {
      const { store_id, shelf_id, product_id, sensor_type, quantity, reading_ts } = payload;

      // 1. Validation check
      if (!store_id || !product_id || typeof quantity !== "number") {
        logger.warn("Dropped invalid queue message payload", { payload });
        return;
      }

      if (quantity < 0) {
        logger.warn("Filtered out noise reading from queue", { store_id, product_id, quantity });
        return;
      }

      // 2. Persist raw reading to shelf_readings
      const readingDoc = {
        store_id,
        shelf_id: shelf_id || "SHELF-UNKNOWN",
        product_id,
        sensor_type: sensor_type || "rfid",
        quantity,
        reading_ts: reading_ts ? new Date(reading_ts) : new Date(),
        ingested_at: new Date(),
        source: "queue_consumer",
        message_id: rawMessage.MessageId,
      };

      await db.collection("shelf_readings").insertOne(readingDoc);

      // 3. Upsert inventory status
      await db.collection("inventory_status").updateOne(
        { store_id, product_id },
        {
          $set: {
            on_hand_qty: quantity,
            last_updated: new Date(),
            last_sensor: sensor_type || "rfid",
          },
        },
        { upsert: true }
      );

      logger.info("Queue Worker processed reading & updated stock", {
        store_id,
        product_id,
        quantity,
      });

      // 4. Threshold check -> dispatch replenishment event to stock events queue
      const product = await db.collection("products").findOne({ product_id });
      const threshold = product ? product.reorder_threshold : 10;

      if (quantity <= threshold) {
        const eventQueueUrl = process.env.SQS_STOCK_EVENTS_QUEUE_URL || "smartshelf-stock-events-queue";
        const alertEvent = {
          event_type: "REPLENISHMENT_REQUIRED",
          store_id,
          product_id,
          current_stock: quantity,
          reorder_threshold: threshold,
          timestamp: new Date().toISOString(),
          suggested_action: "TRIGGER_ORDER_REPLENISHMENT",
        };

        await queue.sendMessage(eventQueueUrl, alertEvent);
        logger.info("Dispatched replenishment event to stock events queue", {
          product_id,
          current_stock: quantity,
          threshold,
        });
      }
    },
  });

  return worker;
}

module.exports = { startQueueConsumerWorker };
