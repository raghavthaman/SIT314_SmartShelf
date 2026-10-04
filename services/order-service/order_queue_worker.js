// services/order-service/order_queue_worker.js
// Listens to stock replenishment events from the queue and triggers automated orders.

const { queue, logger } = require("../shared");
const { createReplenishmentOrder } = require("./order_manager");

function startOrderQueueWorker(db, queueUrl = "smartshelf-stock-events-queue") {
  logger.info("Initializing Order Queue Worker", { queueUrl });

  const worker = queue.startQueueConsumer({
    queueUrl,
    pollIntervalMs: 1000,
    batchSize: 5,
    handler: async (payload, rawMessage) => {
      const { event_type, store_id, product_id } = payload;

      if (event_type === "REPLENISHMENT_REQUIRED" && store_id && product_id) {
        logger.info("Order Worker received replenishment event from queue", {
          store_id,
          product_id,
          messageId: rawMessage.MessageId,
        });

        const result = await createReplenishmentOrder(db, { store_id, product_id });
        if (result.duplicate) {
          logger.info("Order Worker skipped duplicate replenishment order", {
            existingOrder: result.existingOrder.order_id,
          });
        } else {
          logger.info("Order Worker automatically created replenishment order", {
            order_id: result.order.order_id,
            quantity: result.order.quantity,
          });
        }
      }
    },
  });

  return worker;
}

module.exports = { startOrderQueueWorker };
