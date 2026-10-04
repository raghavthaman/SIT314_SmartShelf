// scripts/test_phase5.js
// Automated verification script for Phase 5 (Order Service & Automated Replenishment)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { spawn } = require("child_process");
const http = require("http");
const { connectDB, closeDB, client, queue } = require("../services/shared");

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function httpRequest(url, method = "GET", data = null) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const options = {
      hostname: u.hostname,
      port: u.port,
      path: u.pathname + u.search,
      method,
      headers: { "Content-Type": "application/json" },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch (_) {
          resolve({ status: res.statusCode, body });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

async function runTest() {
  console.log("=================================================");
  console.log("   SmartShelf Phase 5 Automated Test & Verification");
  console.log("   (Order Service — Automated Replenishment & Restock)");
  console.log("=================================================\n");

  // 1. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("✅ Step 1: Connected to MongoDB Atlas (smartshelf)");

  // 2. Start Forecast Service (port 3002)
  console.log("\n🚀 Step 2: Starting Forecast Service on port 3002...");
  const forecastProc = spawn("node", ["services/forecast-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });
  await wait(2500);

  // 3. Start Order Service (port 3004)
  console.log("🚀 Step 3: Starting Order Service on port 3004...");
  const orderProc = spawn("node", ["services/order-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  orderProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text.includes("Order created") || text.includes("Order Worker") || text.includes("restocked")) {
      console.log(`   [Order Service] ${text}`);
    }
  });

  await wait(3000);

  // 4. Test GET /health on Order Service
  console.log("\n🚀 Step 4: Testing GET /health endpoint...");
  const healthResp = await httpRequest("http://localhost:3004/health");
  console.log("   Status:", healthResp.status, "| Body:", JSON.stringify(healthResp.body));
  const healthPass = healthResp.status === 200 && healthResp.body.status === "healthy";

  // 5. Test Automated Replenishment (POST /orders/replenish)
  console.log("\n🚀 Step 5: Testing POST /orders/replenish for SKU-1002...");
  const replenishResp = await httpRequest("http://localhost:3004/orders/replenish", "POST", {
    store_id: "STORE-01",
    product_id: "SKU-1002",
  });

  console.log("   Status:", replenishResp.status);
  const createdOrder = replenishResp.status === 201 ? replenishResp.body.order : replenishResp.body.existingOrder;
  console.log(`   - Order ID: ${createdOrder.order_id}`);
  console.log(`   - Product: ${createdOrder.product_name} (${createdOrder.product_id})`);
  console.log(`   - Order Quantity: ${createdOrder.quantity} units`);
  console.log(`   - Total Cost: $${createdOrder.total_cost}`);
  console.log(`   - Order Status: ${createdOrder.status}`);

  const replenishPass = (replenishResp.status === 201 || replenishResp.status === 409) && createdOrder.quantity > 0;

  // 6. Test Duplicate Order Suppression
  console.log("\n🚀 Step 6: Testing duplicate order suppression (re-requesting SKU-1002)...");
  const dupResp = await httpRequest("http://localhost:3004/orders/replenish", "POST", {
    store_id: "STORE-01",
    product_id: "SKU-1002",
  });
  console.log("   Status:", dupResp.status, `(Expected: 409 Conflict)`);
  console.log(`   - Message: ${dupResp.body.message}`);
  const duplicatePass = dupResp.status === 409 && dupResp.body.duplicate === true;

  // 7. Test Order Retrieval (GET /orders and GET /orders/:id)
  console.log("\n🚀 Step 7: Testing GET /orders and GET /orders/:id...");
  const getOrderResp = await httpRequest(`http://localhost:3004/orders/${createdOrder.order_id}`);
  console.log("   Status:", getOrderResp.status, `| Found Order ID: ${getOrderResp.body.order_id}`);
  const getPass = getOrderResp.status === 200 && getOrderResp.body.order_id === createdOrder.order_id;

  // 8. Test Delivery Restocking Workflow (PUT /orders/:id/status -> DELIVERED)
  console.log("\n🚀 Step 8: Testing Order Delivery & Automatic Inventory Restocking...");
  const stockBefore = await db.collection("inventory_status").findOne({ store_id: "STORE-01", product_id: "SKU-1002" });
  const initialQty = stockBefore ? stockBefore.on_hand_qty : 0;
  console.log(`   - Current on-hand stock before delivery: ${initialQty} units`);

  const deliveryResp = await httpRequest(`http://localhost:3004/orders/${createdOrder.order_id}/status`, "PUT", {
    status: "DELIVERED",
  });
  console.log("   Update Status HTTP:", deliveryResp.status, `| New Status: ${deliveryResp.body.status}`);

  // Query database to verify automatic restocking
  await wait(1000);
  const stockAfter = await db.collection("inventory_status").findOne({ store_id: "STORE-01", product_id: "SKU-1002" });
  console.log(`   - On-hand stock after delivery: ${stockAfter.on_hand_qty} units (credited +${createdOrder.quantity})`);
  console.log(`   - Restocked Order Reference: ${stockAfter.last_restocked_order}`);
  const restockPass = stockAfter.on_hand_qty === initialQty + createdOrder.quantity;

  // 9. Test Queue-Driven Replenishment Worker
  console.log("\n🚀 Step 9: Testing background Queue-Driven Replenishment Worker...");
  await queue.sendMessage("smartshelf-stock-events-queue", {
    event_type: "REPLENISHMENT_REQUIRED",
    store_id: "STORE-01",
    product_id: "SKU-1003",
    timestamp: new Date().toISOString(),
  });

  console.log("   Enqueued REPLENISHMENT_REQUIRED event for SKU-1003. Waiting for worker...");
  await wait(3000);

  const autoQueueOrder = await db.collection("orders").findOne({ store_id: "STORE-01", product_id: "SKU-1003" });
  console.log(`   - Worker automatically generated order: ${autoQueueOrder ? autoQueueOrder.order_id : "N/A"}`);
  console.log(`   - Product: ${autoQueueOrder ? autoQueueOrder.product_name : "N/A"} | Qty: ${autoQueueOrder ? autoQueueOrder.quantity : "N/A"}`);
  const queueWorkerPass = autoQueueOrder !== null && autoQueueOrder.quantity > 0;

  // Cleanup
  orderProc.kill("SIGINT");
  forecastProc.kill("SIGINT");
  await closeDB();

  console.log("\n=================================================");
  console.log("   PHASE 5 VERIFICATION SUMMARY");
  console.log("=================================================");
  console.log(`   1. Order Service Health Check:              ${healthPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   2. EOQ-Driven Automated Replenishment:      ${replenishPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   3. Duplicate Order Suppression (409):       ${duplicatePass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   4. Order Retrieval API (GET /orders/:id):   ${getPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   5. Automatic Inventory Restocking:          ${restockPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   6. Queue-Driven Replenishment Worker:       ${queueWorkerPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log("=================================================");

  const overallSuccess = healthPass && replenishPass && duplicatePass && getPass && restockPass && queueWorkerPass;
  console.log(`   PHASE 5 RESULT: ${overallSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");

  if (!overallSuccess) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("Phase 5 test encountered an error:", err);
  process.exit(1);
});
