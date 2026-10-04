// services/forecast-service/server.js
// SmartShelf Forecast Service — Express REST API
// Calculates Economic Order Quantity (Wilson Formula) and demand forecasts.

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const express = require("express");
const { connectDB, checkDBHealth, logger, loadConfig } = require("../shared");
const { calculateEOQ, estimateDemand } = require("./forecast_engine");

process.env.SERVICE_NAME = "forecast-service";

const app = express();
app.use(express.json());

const config = loadConfig();
const PORT = config.forecastPort || 3002;
const ORDER_COST_S = config.orderCostS || 50;
const HOLDING_COST_H = config.holdingCostH || 5;

let db;

// ---- Health Check ----
app.get("/health", async (req, res) => {
  try {
    await checkDBHealth();
    res.json({
      status: "healthy",
      service: "forecast-service",
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
    service: "SmartShelf Forecast Service",
    status: "running",
    parameters: {
      orderCostS: ORDER_COST_S,
      holdingCostH: HOLDING_COST_H,
    },
  });
});

// ---- Demand Forecast (Single Product) ----
app.get("/forecast/:store_id/:product_id", async (req, res) => {
  try {
    const { store_id, product_id } = req.params;

    // Check if product exists
    const product = await db.collection("products").findOne({ product_id });
    if (!product) {
      return res.status(404).json({ error: `Product ${product_id} not found` });
    }

    const demandStats = await estimateDemand(db, store_id, product_id);

    res.json({
      store_id,
      product_id,
      product_name: product.name,
      reorder_threshold: product.reorder_threshold,
      on_hand_qty: demandStats.on_hand_qty,
      estimatedDailyDemand: demandStats.estimatedDailyDemand,
      estimatedAnnualDemand: demandStats.estimatedAnnualDemand,
      daysOfSupply: demandStats.daysOfSupply,
      replenishment_recommended: demandStats.on_hand_qty <= product.reorder_threshold,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("GET /forecast/:store/:product failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Economic Order Quantity (EOQ / Wilson Formula) ----
app.get("/eoq/:store_id/:product_id", async (req, res) => {
  try {
    const { store_id, product_id } = req.params;

    const product = await db.collection("products").findOne({ product_id });
    if (!product) {
      return res.status(404).json({ error: `Product ${product_id} not found` });
    }

    const demandStats = await estimateDemand(db, store_id, product_id);
    const casePackSize = product.case_pack_size || 1;

    // Calculate EOQ
    const eoqResult = calculateEOQ(
      demandStats.estimatedAnnualDemand,
      ORDER_COST_S,
      HOLDING_COST_H,
      casePackSize
    );

    res.json({
      store_id,
      product_id,
      product_name: product.name,
      reorder_threshold: product.reorder_threshold,
      current_stock: demandStats.on_hand_qty,
      demandMetrics: {
        dailyDemand: demandStats.estimatedDailyDemand,
        annualDemandD: eoqResult.annualDemandD,
      },
      costParameters: {
        orderCostS: eoqResult.orderCostS,
        holdingCostH: eoqResult.holdingCostH,
      },
      eoq: {
        formula: "Q = sqrt((2 * D * S) / H)",
        rawEoq: eoqResult.rawEoq,
        casePackSize: eoqResult.casePackSize,
        optimalOrderQty: eoqResult.optimalOrderQty,
        annualOrderCost: eoqResult.annualOrderCost,
        annualHoldingCost: eoqResult.annualHoldingCost,
        totalCost: eoqResult.totalCost,
        ordersPerYear: eoqResult.ordersPerYear,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("GET /eoq/:store/:product failed", { error: err.message });
    res.status(500).json({ error: "Internal server error" });
  }
});

// ---- Store-Wide Forecast & Replenishment Recommendations ----
app.get("/forecast/:store_id", async (req, res) => {
  try {
    const { store_id } = req.params;
    const products = await db.collection("products").find().toArray();

    const results = [];
    for (const prod of products) {
      const demandStats = await estimateDemand(db, store_id, prod.product_id);
      const eoq = calculateEOQ(
        demandStats.estimatedAnnualDemand,
        ORDER_COST_S,
        HOLDING_COST_H,
        prod.case_pack_size || 1
      );

      results.push({
        product_id: prod.product_id,
        name: prod.name,
        current_stock: demandStats.on_hand_qty,
        reorder_threshold: prod.reorder_threshold,
        daysOfSupply: demandStats.daysOfSupply,
        replenishment_recommended: demandStats.on_hand_qty <= prod.reorder_threshold,
        optimalOrderQty: eoq.optimalOrderQty,
      });
    }

    res.json({
      store_id,
      productsCount: results.length,
      items: results,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error("GET /forecast/:store failed", { error: err.message });
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
      logger.info(`Forecast Service listening on http://localhost:${PORT}`);
    });
  })
  .catch((err) => {
    logger.error("Failed to connect to MongoDB", { error: err.message });
    process.exit(1);
  });

module.exports = app; // for testing
