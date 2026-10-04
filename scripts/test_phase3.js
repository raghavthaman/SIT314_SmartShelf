// scripts/test_phase3.js
// Automated verification script for Phase 3 (Asynchronous Message Queuing & Event Processing)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { spawn } = require("child_process");
const http = require("http");
const { connectDB, client, queue } = require("../services/shared");

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
  console.log("   SmartShelf Phase 3 Automated Test & Verification");
  console.log("   (Asynchronous SQS Queue Buffering & Processing)");
  console.log("=================================================\n");

  // 1. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("✅ Step 1: Connected to MongoDB Atlas (smartshelf)");

  const readingsQueueUrl = "smartshelf-readings-queue";
  const eventsQueueUrl = "smartshelf-stock-events-queue";

  // 2. Test Direct Queue Buffering (Burst of 15 telemetry messages)
  console.log("\n🚀 Step 2: Simulating high-velocity telemetry burst to Queue...");
  const burstPayloads = [
    { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001", quantity: 14, sensor_type: "weight" },
    { store_id: "STORE-01", shelf_id: "SHELF-B2", product_id: "SKU-1002", quantity: 7, sensor_type: "rfid" }, // triggers threshold!
    { store_id: "STORE-01", shelf_id: "SHELF-C3", product_id: "SKU-1003", quantity: 19, sensor_type: "weight" },
    { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001", quantity: -1, sensor_type: "rfid" }, // noise
    { store_id: "STORE-01", shelf_id: "SHELF-B2", product_id: "SKU-1002", quantity: 6, sensor_type: "weight" }, // triggers threshold!
  ];

  for (let i = 0; i < 3; i++) {
    for (const p of burstPayloads) {
      await queue.sendMessage(readingsQueueUrl, {
        ...p,
        reading_ts: new Date().toISOString(),
        burst_round: i + 1,
      });
    }
  }

  const bufferedStats = await queue.getQueueStats(readingsQueueUrl);
  console.log(`✅ Telemetry burst buffered in queue: ${bufferedStats.approximateNumberOfMessages} messages`);
  const queueBufferPass = bufferedStats.approximateNumberOfMessages === 15;

  // 3. Start Inventory Service (with Queue Consumer Worker)
  console.log("\n🚀 Step 3: Starting Inventory Service (Queue Consumer Worker)...");
  const serviceProc = spawn("node", ["services/inventory-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  serviceProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text.includes("Queue Worker processed") || text.includes("Dispatched replenishment event")) {
      console.log(`   [Service Worker] ${text}`);
    }
  });

  // Wait for worker to consume and process messages
  console.log("   Waiting for Queue Consumer Worker to drain and process queue...");
  await wait(5000);

  // 4. Verify Queue Drain & Metrics
  console.log("\n🚀 Step 4: Inspecting Queue Drain & Stock Event Dispatches...");
  const drainedStats = await queue.getQueueStats(readingsQueueUrl);
  const eventsStats = await queue.getQueueStats(eventsQueueUrl);

  console.log(`   - Readings Queue Remaining: ${drainedStats.approximateNumberOfMessages}`);
  console.log(`   - Stock Alert Events Dispatched to Downstream Queue: ${eventsStats.approximateNumberOfMessages}`);

  const drainPass = drainedStats.approximateNumberOfMessages === 0;
  const alertQueuePass = eventsStats.approximateNumberOfMessages > 0;

  // 5. Verify REST API /queue/status
  console.log("\n🚀 Step 5: Querying GET /queue/status REST API endpoint...");
  const apiResp = await httpGet("http://localhost:3001/queue/status");
  console.log("   API Response:", JSON.stringify(apiResp.body, null, 2));
  const apiPass = apiResp.status === 200 && apiResp.body.service === "inventory-service";

  // 6. Verify MongoDB Atlas updates
  console.log("\n🚀 Step 6: Verifying database persistence in MongoDB Atlas...");
  const updatedStock = await db.collection("inventory_status").findOne({ store_id: "STORE-01", product_id: "SKU-1002" });
  console.log(`   - Product SKU-1002 stock in Atlas: ${updatedStock ? updatedStock.on_hand_qty : "N/A"}`);
  console.log(`   - Last Sensor: ${updatedStock ? updatedStock.last_sensor : "N/A"}`);
  console.log(`   - Last Updated: ${updatedStock ? updatedStock.last_updated.toISOString() : "N/A"}`);

  // Cleanup
  serviceProc.kill("SIGINT");
  await client.close();

  console.log("\n=================================================");
  console.log("   PHASE 3 VERIFICATION SUMMARY");
  console.log("=================================================");
  console.log(`   1. Queue Buffering & Spike Smoothing: ${queueBufferPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   2. Asynchronous Queue Processing & Drain: ${drainPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   3. Event-Driven Alert Queuing: ${alertQueuePass ? "✅ PASS" : "❌ FAIL"}`);
  console.log(`   4. REST Queue Status API: ${apiPass ? "✅ PASS" : "❌ FAIL"}`);
  console.log("=================================================");

  const overallSuccess = queueBufferPass && drainPass && alertQueuePass && apiPass;
  console.log(`   PHASE 3 RESULT: ${overallSuccess ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");

  if (!overallSuccess) {
    process.exit(1);
  }
}

runTest().catch((err) => {
  console.error("Phase 3 test encountered an error:", err);
  process.exit(1);
});
