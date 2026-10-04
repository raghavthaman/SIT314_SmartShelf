// services/forecast-service/forecast_engine.js
// Mathematical models for Demand Forecasting and Economic Order Quantity (Wilson Formula)

/**
 * Calculate the Economic Order Quantity (EOQ / Wilson Formula)
 * Q = sqrt((2 * D * S) / H)
 *
 * @param {number} D - Annual or cycle demand (units)
 * @param {number} S - Fixed ordering cost per order ($)
 * @param {number} H - Holding cost per unit per year ($)
 * @param {number} casePackSize - Manufacturer case pack size
 * @returns {object} Calculated metrics
 */
function calculateEOQ(D, S = 50, H = 5, casePackSize = 1) {
  if (D <= 0 || S <= 0 || H <= 0) {
    return {
      rawEoq: 0,
      optimalOrderQty: casePackSize || 1,
      orderCost: S,
      holdingCost: H,
      totalCost: 0,
      numberOfOrdersPerYear: 0,
    };
  }

  // Classical Wilson EOQ
  const rawEoq = Math.sqrt((2 * D * S) / H);

  // Round up to nearest case pack size for realistic supermarket logistics
  const packSize = casePackSize > 0 ? casePackSize : 1;
  const optimalOrderQty = Math.max(packSize, Math.ceil(rawEoq / packSize) * packSize);

  // Annual total cost = Ordering Cost + Holding Cost
  // TC = (D / Q) * S + (Q / 2) * H
  const annualOrderCost = (D / optimalOrderQty) * S;
  const annualHoldingCost = (optimalOrderQty / 2) * H;
  const totalCost = annualOrderCost + annualHoldingCost;
  const numberOfOrders = D / optimalOrderQty;

  return {
    rawEoq: parseFloat(rawEoq.toFixed(2)),
    optimalOrderQty,
    casePackSize: packSize,
    orderCostS: S,
    holdingCostH: H,
    annualDemandD: D,
    annualOrderCost: parseFloat(annualOrderCost.toFixed(2)),
    annualHoldingCost: parseFloat(annualHoldingCost.toFixed(2)),
    totalCost: parseFloat(totalCost.toFixed(2)),
    ordersPerYear: parseFloat(numberOfOrders.toFixed(2)),
  };
}

/**
 * Estimate demand rate from historical shelf readings
 *
 * @param {object} db - MongoDB database handle
 * @param {string} storeId - Store ID
 * @param {string} productId - Product SKU ID
 * @param {number} defaultBaselineDemand - Fallback annual demand
 * @returns {Promise<object>} Demand statistics
 */
async function estimateDemand(db, storeId, productId, defaultBaselineDemand = 120) {
  const readings = await db
    .collection("shelf_readings")
    .find({ store_id: storeId, product_id: productId, quantity: { $gte: 0 } })
    .sort({ reading_ts: 1 })
    .limit(50)
    .toArray();

  let estimatedDailyDemand = 0;
  let estimatedAnnualDemand = defaultBaselineDemand;

  if (readings.length >= 2) {
    let depletions = 0;
    for (let i = 1; i < readings.length; i++) {
      const diff = readings[i - 1].quantity - readings[i].quantity;
      if (diff > 0) {
        depletions += diff;
      }
    }

    const firstTime = new Date(readings[0].reading_ts || readings[0].ingested_at).getTime();
    const lastTime = new Date(
      readings[readings.length - 1].reading_ts || readings[readings.length - 1].ingested_at
    ).getTime();
    const timeDeltaHours = Math.max(0.1, (lastTime - firstTime) / (1000 * 60 * 60));

    // Rate per hour extrapolated to daily & annual demand
    const unitsPerHour = depletions / timeDeltaHours;
    estimatedDailyDemand = parseFloat((unitsPerHour * 24).toFixed(2));
    estimatedAnnualDemand = Math.max(20, Math.round(estimatedDailyDemand * 365));
  }

  // Get current on-hand inventory
  const inventoryDoc = await db.collection("inventory_status").findOne({
    store_id: storeId,
    product_id: productId,
  });

  const onHandQty = inventoryDoc ? inventoryDoc.on_hand_qty : 0;
  const daysOfSupply =
    estimatedDailyDemand > 0 ? parseFloat((onHandQty / estimatedDailyDemand).toFixed(1)) : 999;

  return {
    store_id: storeId,
    product_id: productId,
    on_hand_qty: onHandQty,
    readingsAnalyzed: readings.length,
    estimatedDailyDemand,
    estimatedAnnualDemand,
    daysOfSupply,
  };
}

module.exports = {
  calculateEOQ,
  estimateDemand,
};
