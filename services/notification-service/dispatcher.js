// services/notification-service/dispatcher.js
// Formats order events into human-readable alerts and dispatches them to channels.
// Channels: "console" (always — structured log, picked up by CloudWatch Logs)
//           "webhook" (when NOTIFICATION_WEBHOOK_URL is set, e.g. Slack/Teams incoming webhook)

const { logger } = require("../shared");

function formatNotification(event) {
  const item = `${event.product_name || event.product_id} (${event.product_id})`;
  switch (event.event_type) {
    case "ORDER_CREATED":
      return {
        severity: "warning",
        title: `Replenishment order ${event.order_id} raised`,
        message: `${event.store_id}: ${item} fell to ${event.stock_at_order} (threshold ${event.reorder_threshold}). Ordered ${event.quantity} units.`,
      };
    case "ORDER_STATUS_CHANGED":
      return {
        severity: event.status === "CANCELLED" ? "warning" : "info",
        title: `Order ${event.order_id} ${event.status}`,
        message: `${event.store_id}: ${item} order of ${event.quantity} units moved ${event.previous_status} -> ${event.status}.`,
      };
    default:
      return null;
  }
}

async function dispatch(notification, webhookUrl) {
  const deliveries = [];

  logger.info(`[${notification.severity.toUpperCase()}] ${notification.title}`, { message: notification.message });
  deliveries.push({ channel: "console", ok: true });

  if (webhookUrl) {
    try {
      const res = await fetch(webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `*${notification.title}*\n${notification.message}` }),
        signal: AbortSignal.timeout(5000),
      });
      deliveries.push({ channel: "webhook", ok: res.ok, status: res.status });
    } catch (err) {
      logger.error("Webhook delivery failed", { error: err.message });
      deliveries.push({ channel: "webhook", ok: false, error: err.message });
    }
  }

  return deliveries;
}

module.exports = { formatNotification, dispatch };
