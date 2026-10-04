// scripts/test_phase5.js
// Automated verification script for Phase 5 (Order Service & Notification Service)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { spawn } = require("child_process");
const { connectDB, client, queue } = require("../services/shared");
const { canTransition, fallbackOrderQty, ensureAboveThreshold } = require("../services/order-service/order_engine");

const ROOT = path.resolve(__dirname, "..");
const STOCK_EVENTS_QUEUE = process.env.SQS_STOCK_EVENTS_QUEUE_URL || "smartshelf-stock-events-queue";
const NOTIFICATIONS_QUEUE = process.env.SQS_NOTIFICATIONS_QUEUE_URL || "smartshelf-notifications-queue";
const ORDER_URL = "http://localhost:3004";
const NOTIFY_URL = "http://localhost:3003";

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function http(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = await res.text();
  try {
    data = JSON.parse(data);
  } catch (_) {}
  return { status: res.status, body: data };
}

function startService(name, script, readyText) {
  const proc = spawn("node", [script], { cwd: ROOT, stdio: "pipe" });
  const ready = new Promise((resolve) => {
    proc.stdout.on("data", (d) => {
      const text = d.toString();
      if (text.includes(readyText)) {
        console.log(`   [${name}] ${readyText}`);
        resolve();
      }
    });
  });
  proc.stderr.on("data", () => {});
  return { proc, ready: Promise.race([ready, wait(15000)]) };
}

const pass = (ok) => (ok ? "✅ PASS" : "❌ FAIL");

async function runTest() {
  console.log("=================================================");
  console.log("   SmartShelf Phase 5 Automated Test & Verification");
  console.log("   (Order Service & Notification Service)");
  console.log("=================================================\n");

  // 1. Unit checks: order sizing & lifecycle rules
  console.log("🚀 Step 1: Validating order sizing & lifecycle rules...");
  const fb = fallbackOrderQty(6, 15, 12); // shortfall 24 -> 2 cases = 24
  const topUp = ensureAboveThreshold(12, 2, 20, 12); // 2+12 <= 20 -> need 19 -> 2 cases = 24
  const keep = ensureAboveThreshold(84, 6, 15, 12); // already above -> 84
  console.log(`   - fallbackOrderQty(stock=6, threshold=15, pack=12) = ${fb} (expected 24)`);
  console.log(`   - ensureAboveThreshold(12, stock=2, threshold=20, pack=12) = ${topUp} (expected 24)`);
  console.log(`   - ensureAboveThreshold(84, stock=6, threshold=15, pack=12) = ${keep} (expected 84)`);
  const lifecycleOk =
    canTransition("PENDING", "CONFIRMED") && canTransition("DISPATCHED", "DELIVERED") &&
    !canTransition("DELIVERED", "PENDING") && !canTransition("PENDING", "DELIVERED");
  console.log(`   - Lifecycle transition rules enforced: ${lifecycleOk}`);
  const unitPass = fb === 24 && topUp === 24 && keep === 84 && lifecycleOk;

  // 2. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("\n✅ Step 2: Connected to MongoDB Atlas (smartshelf)");

  const openBefore = await db.collection("orders").findOne({ store_id: "STORE-01", product_id: "SKU-1002", open: true });
  const ordersBefore = await db.collection("orders").countDocuments({ store_id: "STORE-01", product_id: "SKU-1002" });

  // 3. Queue duplicate replenishment events (on top of any already waiting from Phase 3)
  console.log("\n🚀 Step 3: Queueing 3 duplicate REPLENISHMENT_REQUIRED events for SKU-1002...");
  for (const stock of [7, 6, 5]) {
    await queue.sendMessage(STOCK_EVENTS_QUEUE, {
      event_type: "REPLENISHMENT_REQUIRED",
      store_id: "STORE-01",
      product_id: "SKU-1002",
      current_stock: stock,
      reorder_threshold: 15,
      timestamp: new Date().toISOString(),
      suggested_action: "TRIGGER_ORDER_REPLENISHMENT",
    });
  }
  const eventsDepth = (await queue.getQueueStats(STOCK_EVENTS_QUEUE)).approximateNumberOfMessages;
  console.log(`   Stock events queue depth: ${eventsDepth}`);

  // 4. Start Forecast, Order and Notification services
  console.log("\n🚀 Step 4: Starting Forecast (3002), Order (3004) & Notification (3003) services...");
  const forecast = startService("Forecast", "services/forecast-service/server.js", "Forecast Service listening");
  const order = startService("Order", "services/order-service/server.js", "Order Service listening");
  const notify = startService("Notification", "services/notification-service/server.js", "Notification Service listening");
  await Promise.all([forecast.ready, order.ready, notify.ready]);

  const health = await Promise.all([http("GET", `${ORDER_URL}/health`), http("GET", `${NOTIFY_URL}/health`)]);
  const healthPass = health.every((h) => h.status === 200 && h.body.status === "healthy");
  console.log(`   Order /health: ${health[0].status} | Notification /health: ${health[1].status}`);

  // 5. Wait for the order consumer to drain the stock events queue
  console.log("\n🚀 Step 5: Waiting for Order Service to drain stock events queue...");
  for (let i = 0; i < 20; i++) {
    const s = await queue.getQueueStats(STOCK_EVENTS_QUEUE);
    if (s.approximateNumberOfMessages === 0 && s.approximateNumberOfMessagesNotVisible === 0) break;
    await wait(1000);
  }
  const eventsAfter = await queue.getQueueStats(STOCK_EVENTS_QUEUE);
  const openOrders = await db.collection("orders").find({ store_id: "STORE-01", product_id: "SKU-1002", open: true }).toArray();
  const ordersAfter = await db.collection("orders").countDocuments({ store_id: "STORE-01", product_id: "SKU-1002" });
  const created = ordersAfter - ordersBefore;
  const po = openOrders[0];
  console.log(`   Queue depth after drain: ${eventsAfter.approximateNumberOfMessages}`);
  console.log(`   ${eventsDepth} events -> ${created} new order(s); open orders for SKU-1002: ${openOrders.length}`);
  if (po) {
    console.log(`   Order ${po.order_id}: qty=${po.quantity} (${po.cases} cases of ${po.case_pack_size}), source=${po.quantity_source}, duplicates suppressed=${po.duplicate_events}`);
  }
  const dedupPass =
    eventsAfter.approximateNumberOfMessages === 0 && openOrders.length === 1 && created === (openBefore ? 0 : 1);
  const eoqPass = !!po && (openBefore ? true : po.quantity_source === "forecast-eoq") && po.quantity % po.case_pack_size === 0;

  // 6. Lifecycle: PENDING -> CONFIRMED -> DISPATCHED -> DELIVERED, stock replenished
  console.log("\n🚀 Step 6: Advancing order lifecycle to DELIVERED...");
  const invBefore = await db.collection("inventory_status").findOne({ store_id: "STORE-01", product_id: "SKU-1002" });
  let lifecyclePass = !!po;
  if (po) {
    let current = po.status;
    for (const next of ["CONFIRMED", "DISPATCHED", "DELIVERED"]) {
      if (current === next || !canTransition(current, next)) continue;
      const r = await http("PATCH", `${ORDER_URL}/orders/${po.order_id}/status`, { status: next });
      console.log(`   PATCH ${current} -> ${next}: HTTP ${r.status}`);
      lifecyclePass = lifecyclePass && r.status === 200;
      current = next;
    }
  }
  const invAfter = await db.collection("inventory_status").findOne({ store_id: "STORE-01", product_id: "SKU-1002" });
  const before = invBefore ? invBefore.on_hand_qty : 0;
  console.log(`   SKU-1002 stock: ${before} -> ${invAfter.on_hand_qty} (+${po ? po.quantity : 0})`);
  const deliveryPass = !!po && invAfter.on_hand_qty === before + po.quantity;

  const invalid = po ? await http("PATCH", `${ORDER_URL}/orders/${po.order_id}/status`, { status: "PENDING" }) : { status: 0 };
  console.log(`   Invalid transition DELIVERED -> PENDING: HTTP ${invalid.status} (expected 409)`);
  const invalidPass = invalid.status === 409;

  // 7. Resilience: Forecast Service down -> fallback order sizing; duplicate manual order -> 409
  console.log("\n🚀 Step 7: Stopping Forecast Service and placing a manual order for SKU-1003...");
  forecast.proc.kill("SIGINT");
  await wait(1000);
  const manual = await http("POST", `${ORDER_URL}/orders`, { store_id: "STORE-01", product_id: "SKU-1003" });
  let fallbackPass = false;
  let manualOrderId = manual.body.order_id;
  if (manual.status === 201) {
    console.log(`   HTTP 201: ${manualOrderId} qty=${manual.body.quantity}, source=${manual.body.quantity_source}`);
    fallbackPass = manual.body.quantity_source === "fallback";
  } else {
    console.log(`   HTTP ${manual.status}: ${JSON.stringify(manual.body)}`);
  }
  const dup = await http("POST", `${ORDER_URL}/orders`, { store_id: "STORE-01", product_id: "SKU-1003" });
  console.log(`   Duplicate manual order: HTTP ${dup.status} (expected 409)`);
  const dupPass = dup.status === 409;
  if (manualOrderId) {
    const c = await http("PATCH", `${ORDER_URL}/orders/${manualOrderId}/status`, { status: "CANCELLED" });
    console.log(`   Cancelled ${manualOrderId}: HTTP ${c.status}`);
  }

  // 8. Notifications recorded for the order lifecycle
  console.log("\n🚀 Step 8: Verifying Notification Service history...");
  for (let i = 0; i < 15; i++) {
    const s = await queue.getQueueStats(NOTIFICATIONS_QUEUE);
    if (s.approximateNumberOfMessages === 0 && s.approximateNumberOfMessagesNotVisible === 0) break;
    await wait(1000);
  }
  await wait(500);
  const notes = po ? await http("GET", `${NOTIFY_URL}/notifications?product_id=SKU-1002`) : { body: { notifications: [] } };
  const forOrder = notes.body.notifications.filter((n) => n.order_id === (po && po.order_id)).reverse();
  forOrder.forEach((n) => console.log(`   [${n.severity}] ${n.title}`));
  const stats = await http("GET", `${NOTIFY_URL}/notifications/stats`);
  console.log(`   Stats: ${JSON.stringify(stats.body.byEventType)} | queue depth ${stats.body.queue.approximateNumberOfMessages}`);
  const expectedNotes = openBefore ? 3 : 4; // ORDER_CREATED + CONFIRMED + DISPATCHED + DELIVERED
  const notifyPass = forOrder.length >= expectedNotes && stats.status === 200;

  // Cleanup
  order.proc.kill("SIGINT");
  notify.proc.kill("SIGINT");
  await client.close();

  const results = [
    ["Order sizing & lifecycle rules (unit)", unitPass],
    ["Health checks (Order + Notification)", healthPass],
    ["Event dedup: N events -> 1 open order", dedupPass],
    ["EOQ-sized order via Forecast Service", eoqPass],
    ["Lifecycle PENDING -> DELIVERED", lifecyclePass],
    ["Delivery replenishes inventory stock", deliveryPass],
    ["Invalid transition rejected (409)", invalidPass],
    ["Fallback sizing when Forecast down", fallbackPass],
    ["Duplicate manual order rejected (409)", dupPass],
    ["Notifications dispatched & recorded", notifyPass],
  ];

  console.log("\n=================================================");
  console.log("   PHASE 5 VERIFICATION SUMMARY");
  console.log("=================================================");
  results.forEach(([label, ok], i) => console.log(`   ${String(i + 1).padStart(2)}. ${label.padEnd(40)} ${pass(ok)}`));
  console.log("=================================================");
  const overallSuccess = results.every(([, ok]) => ok);
  console.log(`   PHASE 5 RESULT: ${overallSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");

  if (!overallSuccess) process.exit(1);
}

runTest().catch((err) => {
  console.error("Phase 5 test encountered an error:", err);
  process.exit(1);
});
