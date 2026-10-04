// scripts/test_phase1.js
// Automated verification script for Phase 1 (MQTT Pipeline)

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const { spawn } = require("child_process");
const { connectDB, client } = require("../services/shared/db");

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runTest() {
  const testStartTime = new Date();
  console.log("=================================================");
  console.log("   SmartShelf Phase 1 Automated Test & Verification");
  console.log("=================================================\n");

  // 1. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("✅ Step 1: Connected to MongoDB Atlas (smartshelf)");

  // Get baseline count of readings before test
  const initialReadingsCount = await db.collection("shelf_readings").countDocuments();
  console.log(`   Baseline 'shelf_readings' document count: ${initialReadingsCount}`);

  // 2. Start MQTT Broker
  console.log("\n🚀 Step 2: Starting embedded MQTT broker...");
  const brokerProc = spawn("node", ["services/mqtt-broker/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  brokerProc.stdout.on("data", (d) => {
    console.log(`[Broker] ${d.toString().trim()}`);
  });

  await wait(2000);

  // 3. Start Inventory Service
  console.log("🚀 Step 3: Starting Inventory Service (with MQTT Consumer)...");
  const serviceProc = spawn("node", ["services/inventory-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  serviceProc.stdout.on("data", (d) => {
    console.log(`[Service] ${d.toString().trim()}`);
  });

  await wait(3000);

  // 4. Run Simulator in batch mode (5 rounds)
  console.log("🚀 Step 4: Running Sensor Simulator (5 telemetry rounds)...");
  const simProc = spawn("node", ["simulator/sensor_publisher.js", "--count", "5"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, SIMULATOR_INTERVAL_MS: "500" },
  });

  await new Promise((resolve) => simProc.on("exit", resolve));
  console.log("✅ Sensor Simulator finished 5 rounds.");

  // Wait 2s for all MQTT messages to flush to DB
  await wait(2000);

  // 5. Query MongoDB Atlas for Results
  console.log("\n=================================================");
  console.log("   VERIFICATION & ANALYSIS");
  console.log("=================================================");

  const finalReadingsCount = await db.collection("shelf_readings").countDocuments();
  const newReadingsCount = finalReadingsCount - initialReadingsCount;
  console.log(`\n📊 1. Raw Telemetry Ingested ('shelf_readings'):`);
  console.log(`   - New documents added: ${newReadingsCount}`);

  const recentReadings = await db
    .collection("shelf_readings")
    .find()
    .sort({ ingested_at: -1 })
    .limit(newReadingsCount || 5)
    .toArray();

  console.log("\n   Latest Ingested Readings (sample):");
  recentReadings.slice(0, 5).forEach((r) => {
    const ts = r.ingested_at ? (r.ingested_at instanceof Date ? r.ingested_at.toISOString() : new Date(r.ingested_at).toISOString()) : "N/A";
    console.log(
      `   [${ts}] ${r.store_id}/${r.shelf_id} -> ${r.product_id} qty=${r.quantity} (${r.sensor_type})`
    );
  });

  // Check noise filtering (only inspect records created during this test run)
  const newInvalidReadingsInDb = await db.collection("shelf_readings").countDocuments({
    ingested_at: { $gte: testStartTime },
    quantity: { $lt: 0 },
  });
  console.log(`\n🛡️ 2. Validation & Noise Filtering:`);
  console.log(`   - Out-of-range (< 0) readings ingested during test run: ${newInvalidReadingsInDb}`);
  const filterPass = newInvalidReadingsInDb === 0;
  console.log(`   - Noise Filter Result: ${filterPass ? "✅ PASS (0 noise readings persisted)" : "❌ FAIL"}`);

  // Check inventory status updates
  console.log(`\n📦 3. Live Stock Status ('inventory_status'):`);
  const stockItems = await db.collection("inventory_status").find().toArray();
  stockItems.forEach((s) => {
    console.log(
      `   Store: ${s.store_id} | Product: ${s.product_id} | On Hand Qty: ${s.on_hand_qty} | Sensor: ${s.last_sensor} | Updated: ${s.last_updated.toISOString()}`
    );
  });

  // Cleanup processes
  console.log("\n🧹 Cleaning up processes...");
  serviceProc.kill("SIGINT");
  brokerProc.kill("SIGINT");
  await client.close();

  console.log("\n=================================================");
  console.log(`   PHASE 1 VERIFICATION RESULT: ${filterPass && newReadingsCount > 0 ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");
}

runTest().catch((err) => {
  console.error("Test failed with error:", err);
  process.exit(1);
});
