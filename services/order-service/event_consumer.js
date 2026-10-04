// services/order-service/event_consumer.js
// Consumes REPLENISHMENT_REQUIRED events from the stock events queue, sizes the order
// via the Forecast Service (EOQ / Wilson formula), creates an idempotent purchase order,
// and publishes ORDER_CREATED to the notifications queue.

const crypto = require("crypto");
const { queue, logger } = require("../shared");
const { fallbackOrderQty, ensureAboveThreshold } = require("./order_engine");

const DUPLICATE_KEY_ERROR = 11000;

async function fetchEOQ(forecastServiceUrl, store_id, product_id) {
  const res = await fetch(`${forecastServiceUrl}/eoq/${store_id}/${product_id}`, {
    signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) throw new Error(`Forecast Service responded ${res.status}`);
  return res.json();
}

/**
 * Creates a replenishment order for a store/product.
 * Returns { created: true, order } or { created: false, existing } when an open order already exists.
 */
async function createReplenishmentOrder(db, { store_id, product_id, current_stock, reason, source_event_id }, ctx) {
  const product = await db.collection("products").findOne({ product_id });
  if (!product) throw new Error(`Product ${product_id} not found`);

  const casePackSize = product.case_pack_size || 1;
  const threshold = product.reorder_threshold;

  // 1. Size the order: EOQ from Forecast Service, local fallback if unreachable
  let quantity;
  let quantitySource;
  let eoqDetails = null;
  try {
    const eoq = await fetchEOQ(ctx.forecastServiceUrl, store_id, product_id);
    quantity = eoq.eoq.optimalOrderQty;
    quantitySource = "forecast-eoq";
    eoqDetails = { rawEoq: eoq.eoq.rawEoq, annualDemandD: eoq.demandMetrics.annualDemandD, totalCost: eoq.eoq.totalCost };
  } catch (err) {
    logger.warn("Forecast Service unavailable, using fallback order sizing", { product_id, error: err.message });
    quantity = fallbackOrderQty(current_stock, threshold, casePackSize);
    quantitySource = "fallback";
  }
  quantity = ensureAboveThreshold(quantity, current_stock, threshold, casePackSize);

  // 2. Insert — unique partial index on (store_id, product_id, open:true) rejects duplicates
  const now = new Date();
  const order = {
    order_id: `PO-${now.getTime()}-${crypto.randomBytes(3).toString("hex")}`,
    store_id,
    product_id,
    product_name: product.name,
    quantity,
    case_pack_size: casePackSize,
    cases: quantity / casePackSize,
    quantity_source: quantitySource,
    eoq: eoqDetails,
    stock_at_order: current_stock,
    reorder_threshold: threshold,
    reason,
    status: "PENDING",
    open: true,
    source_event_id: source_event_id || null,
    duplicate_events: 0,
    status_history: [{ status: "PENDING", at: now }],
    created_at: now,
    updated_at: now,
  };

  try {
    await db.collection("orders").insertOne(order);
  } catch (err) {
    if (err.code !== DUPLICATE_KEY_ERROR) throw err;
    const existing = await db.collection("orders").findOneAndUpdate(
      { store_id, product_id, open: true },
      { $inc: { duplicate_events: 1 }, $set: { updated_at: new Date() } },
      { returnDocument: "after" }
    );
    return { created: false, existing };
  }

  // 3. Publish ORDER_CREATED for the Notification Service
  await queue.sendMessage(ctx.notificationsQueueUrl, {
    event_type: "ORDER_CREATED",
    order_id: order.order_id,
    store_id,
    product_id,
    product_name: product.name,
    quantity,
    status: "PENDING",
    stock_at_order: current_stock,
    reorder_threshold: threshold,
    timestamp: now.toISOString(),
  });

  return { created: true, order };
}

function startStockEventConsumer(db, ctx) {
  logger.info("Initializing Stock Event Consumer", { queueUrl: ctx.stockEventsQueueUrl });

  return queue.startQueueConsumer({
    queueUrl: ctx.stockEventsQueueUrl,
    pollIntervalMs: 1000,
    batchSize: 10,
    handler: async (event, rawMessage) => {
      if (!event || event.event_type !== "REPLENISHMENT_REQUIRED") {
        logger.warn("Ignored unsupported stock event", { event_type: event && event.event_type });
        return;
      }
      if (!event.store_id || !event.product_id || typeof event.current_stock !== "number") {
        logger.warn("Dropped malformed replenishment event", { event });
        return;
      }

      const result = await createReplenishmentOrder(
        db,
        {
          store_id: event.store_id,
          product_id: event.product_id,
          current_stock: event.current_stock,
          reason: "REPLENISHMENT_REQUIRED",
          source_event_id: rawMessage.MessageId,
        },
        ctx
      );

      if (result.created) {
        logger.info("Replenishment order created", {
          order_id: result.order.order_id,
          product_id: event.product_id,
          quantity: result.order.quantity,
          quantity_source: result.order.quantity_source,
        });
      } else {
        logger.info("Duplicate replenishment event suppressed (open order exists)", {
          order_id: result.existing && result.existing.order_id,
          product_id: event.product_id,
        });
      }
    },
  });
}

module.exports = { startStockEventConsumer, createReplenishmentOrder };
