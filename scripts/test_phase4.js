// scripts/test_phase4.js
// Automated verification script for Phase 4 (Forecast Service & EOQ Wilson Formula)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { spawn } = require("child_process");
const http = require("http");
const { connectDB, client } = require("../services/shared");
const { calculateEOQ } = require("../services/forecast-service/forecast_engine");

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (e) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on("error", reject);
  });
}

async function runTest() {
  console.log("=================================================");
  console.log("   SmartShelf Phase 4 Automated Test & Verification");
  console.log("   (Forecast Service — EOQ Wilson Formula & Demand)");
  console.log("=================================================\n");

  // 1. Verify Unit Math: EOQ (Wilson Formula)
  console.log("🚀 Step 1: Validating Wilson Formula Mathematics...");
  // Test case: D = 1000, S = 50, H = 5, packSize = 10
  // Q* = sqrt((2 * 1000 * 50) / 5) = sqrt(20000) = 141.42
  // Case pack rounded: ceil(141.42 / 10) * 10 = 150
  const unitTestEoq = calculateEOQ(1000, 50, 5, 10);
  console.log("   Theoretical calculation:");
  console.log(`   - Formula: Q = sqrt((2 * D * S) / H)`);
  console.log(`   - D=1000, S=50, H=5 -> Raw EOQ: ${unitTestEoq.rawEoq} (expected 141.42)`);
  console.log(`   - Case pack size = 10 -> Rounded EOQ: ${unitTestEoq.optimalOrderQty} (expected 150)`);
  console.log(`   - Annual Total Cost: $${unitTestEoq.totalCost}`);

  const mathPass = Math.abs(unitTestEoq.rawEoq - 141.42) < 0.1 && unitTestEoq.optimalOrderQty === 150;
  console.log(`   Math Validation Result: ${mathPass ? "✅ PASS" : "❌ FAIL"}`);

  // 2. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("\n✅ Step 2: Connected to MongoDB Atlas (smartshelf)");

  // 3. Start Forecast Service on port 3002
  console.log("\n🚀 Step 3: Starting Forecast Service on port 3002...");
  const serviceProc = spawn("node", ["services/forecast-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  serviceProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text.includes("Forecast Service listening")) {
      console.log(`   [Service] ${text}`);
    }
  });

  await wait(3000);

  // 4. Test GET /health
  console.log("\n🚀 Step 4: Testing GET /health endpoint...");
  const healthResp = await httpGet("http://localhost:3002/health");
  console.log("   Status:", healthResp.status, "| Body:", JSON.stringify(healthResp.body));
  const healthPass = healthResp.status === 200 && healthResp.body.status === "healthy";

  // 5. Test GET /forecast/STORE-01/SKU-1001
  console.log("\n🚀 Step 5: Testing GET /forecast/STORE-01/SKU-1001...");
  const forecastResp = await httpGet("http://localhost:3002/forecast/STORE-01/SKU-1001");
  console.log("   Status:", forecastResp.status);
  console.log(`   - Product: ${forecastResp.body.product_name} (${forecastResp.body.product_id})`);
  console.log(`   - Current Stock: ${forecastResp.body.on_hand_qty}`);
  console.log(`   - Reorder Threshold: ${forecastResp.body.reorder_threshold}`);
  console.log(`   - Estimated Daily Demand: ${forecastResp.body.estimatedDailyDemand} units/day`);
  console.log(`   - Estimated Days of Supply: ${forecastResp.body.daysOfSupply} days`);
  console.log(`   - Replenishment Recommended: ${forecastResp.body.replenishment_recommended}`);
  const forecastPass = forecastResp.status === 200 && forecastResp.body.product_id === "SKU-1001";

  // 6. Test GET /eoq/STORE-01/SKU-1002
  console.log("\n🚀 Step 6: Testing GET /eoq/STORE-01/SKU-1002 (Wilson Formula Endpoint)...");
  const eoqResp = await httpGet("http://localhost:3002/eoq/STORE-01/SKU-1002");
  console.log("   Status:", eoqResp.status);
  console.log(`   - Product: ${eoqResp.body.product_name} (${eoqResp.body.product_id})`);
  console.log(`   - Case Pack Size: ${eoqResp.body.eoq.casePackSize}`);
  console.log(`   - Raw EOQ: ${eoqResp.body.eoq.rawEoq} units`);
  console.log(`   - Optimal Order Quantity (Q*): ${eoqResp.body.eoq.optimalOrderQty} units`);
  console.log(`   - Total Annual Inventory Cost: $${eoqResp.body.eoq.totalCost}`);
  console.log(`   - Orders Per Year: ${eoqResp.body.eoq.ordersPerYear}`);
  const eoqPass = eoqResp.status === 200 && eoqResp.body.eoq.optimalOrderQty > 0;

  // 7. Test GET /forecast/STORE-01 (Store-wide batch recommendations)
  console.log("\n🚀 Step 7: Testing GET /forecast/STORE-01 (Store-wide summary)...");
  const batchResp = await httpGet("http://localhost:3002/forecast/STORE-01");
  console.log("   Status:", batchResp.status, `| Total Products Evaluated: ${batchResp.body.productsCount}`);
  batchResp.body.items.slice(0, 3).forEach((item) => {
    console.log(
      `   [${item.product_id}] ${item.name} -> Stock: ${item.current_stock} | Threshold: ${item.reorder_threshold} | Reorder Needed: ${item.replenishment_recommended} | EOQ: ${item.optimalOrderQty}`
    );
  });
  const batchPass = batchResp.status === 200 && batchResp.body.productsCount > 0;

  // 8. Test 404 for invalid product
  console.log("\n🚀 Step 8: Testing error handling for non-existent product...");
  const notFoundResp = await httpGet("http://localhost:3002/forecast/STORE-01/SKU-INVALID-999");
  console.log("   Status:", notFoundResp.status, "| Expected: 404");
  const notFoundPass = notFoundResp.status === 404;

  // Cleanup
  serviceProc.kill("SIGINT");
  await client.close();

  console.log("\n=================================================");
  console.log("   PHASE 4 VERIFICATION SUMMARY");
  console.log("=================================================");
  console.log(`   1. Mathematical Accuracy (Wilson Formula): ${mathPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   2. Health Check (Atlas DB Ping):          ${healthPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   3. Product Forecast & Depletion Analysis: ${forecastPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   4. EOQ Optimization & Packaging Constraint: ${eoqPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   5. Store-Wide Batch Recommendations:      ${batchPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   6. 404 Input Validation & Error Handling: ${notFoundPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log("=================================================");

  const overallSuccess = mathPass && healthPass && forecastPass && eoqPass && batchPass && notFoundPass;
  console.log(`   PHASE 4 RESULT: ${overallSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");

  if (!overallSuccess) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("Phase 4 test encountered an error:", err);
  process.exit(1);
});
