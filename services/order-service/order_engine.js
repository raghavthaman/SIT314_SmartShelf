// services/order-service/order_engine.js
// Order sizing & lifecycle rules for SmartShelf replenishment orders.

// Allowed lifecycle transitions (PENDING -> CONFIRMED -> DISPATCHED -> DELIVERED)
const TRANSITIONS = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["DISPATCHED", "CANCELLED"],
  DISPATCHED: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

const OPEN_STATUSES = ["PENDING", "CONFIRMED", "DISPATCHED"];

function canTransition(from, to) {
  return (TRANSITIONS[from] || []).includes(to);
}

/**
 * Fallback order size when the Forecast Service is unreachable:
 * enough whole cases to lift stock to twice the reorder threshold.
 */
function fallbackOrderQty(currentStock, reorderThreshold, casePackSize = 1) {
  const pack = casePackSize > 0 ? casePackSize : 1;
  const shortfall = Math.max(0, reorderThreshold * 2 - currentStock);
  return Math.max(pack, Math.ceil(shortfall / pack) * pack);
}

/**
 * Ensure the order actually lifts stock above the reorder threshold.
 * If EOQ alone would leave stock at/below threshold, top up in whole cases.
 */
function ensureAboveThreshold(qty, currentStock, reorderThreshold, casePackSize = 1) {
  const pack = casePackSize > 0 ? casePackSize : 1;
  if (currentStock + qty > reorderThreshold) return qty;
  const needed = reorderThreshold - currentStock + 1;
  return Math.ceil(needed / pack) * pack;
}

module.exports = { TRANSITIONS, OPEN_STATUSES, canTransition, fallbackOrderQty, ensureAboveThreshold };
