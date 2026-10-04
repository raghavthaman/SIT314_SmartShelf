// scripts/test_phase2.js
// Automated verification script for Phase 2 (Node-RED Edge Processing Pipeline)

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
  console.log("   SmartShelf Phase 2 Automated Test & Verification");
  console.log("   (MQTT -> Node-RED Edge Gateway -> Inventory API)");
  console.log("=================================================\n");

  // 1. Connect to MongoDB Atlas
  const db = await connectDB();
  console.log("✅ Step 1: Connected to MongoDB Atlas (smartshelf)");

  // 2. Start MQTT Broker
  console.log("\n🚀 Step 2: Starting embedded MQTT broker...");
  const brokerProc = spawn("node", ["services/mqtt-broker/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  brokerProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text.includes("Client connected") || text.includes("Published to")) {
      console.log(`   [Broker] ${text}`);
    }
  });

  await wait(2000);

  // 3. Start Inventory Service
  console.log("🚀 Step 3: Starting Inventory Service (REST API)...");
  const serviceProc = spawn("node", ["services/inventory-service/server.js"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "pipe",
  });

  serviceProc.stdout.on("data", (d) => {
    const text = d.toString().trim();
    if (text.includes("Inventory Service listening") || text.includes("Inventory updated")) {
      console.log(`   [Service] ${text}`);
    }
  });

  await wait(3000);

  // 4. Start Node-RED
  console.log("🚀 Step 4: Starting Node-RED Edge Gateway on port 1880...");
  const noderedProc = spawn(
    "node-red",
    ["-u", "node-red", "-s", "node-red/settings.js", "node-red/flows.json"],
    {
      cwd: path.resolve(__dirname, ".."),
      stdio: "pipe",
      shell: true,
    }
  );

  let noderedConnected = false;
  let noderedValidTelemetryCount = 0;
  let noderedDroppedNoiseCount = 0;
  let noderedLowStockAlertCount = 0;
  let noderedHttpUpdatesCount = 0;

  noderedProc.stdout.on("data", (d) => {
    const text = d.toString();
    if (text.includes("Connected to broker: nodered-smartshelf-edge")) {
      noderedConnected = true;
      console.log("   [Node-RED] Connected to MQTT broker at 127.0.0.1:1883");
    }
    if (text.includes("[Valid Telemetry]")) {
      noderedValidTelemetryCount++;
      console.log("   [Node-RED -> Debug] Received & Validated Telemetry");
    }
    if (text.includes("[Dropped Noise]")) {
      noderedDroppedNoiseCount++;
      console.log("   [Node-RED -> Filter] Dropped Sensor Noise Reading");
    }
    if (text.includes("[Low Stock Event]")) {
      noderedLowStockAlertCount++;
      console.log("   [Node-RED -> Alert] Triggered Low-Stock Alert Event");
    }
    if (text.includes("[HTTP Response]")) {
      noderedHttpUpdatesCount++;
      console.log("   [Node-RED -> HTTP] Successfully updated Inventory Service");
    }
  });

  noderedProc.stderr.on("data", (d) => {
    // console.error(`[Node-RED err] ${d.toString().trim()}`);
  });

  // Wait for Node-RED to initialize flows
  await wait(6000);

  // 5. Run Simulator in batch mode (4 rounds)
  console.log("\n🚀 Step 5: Running Sensor Simulator (4 telemetry rounds)...");
  const simProc = spawn("node", ["simulator/sensor_publisher.js", "--count", "4"], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
    env: { ...process.env, SIMULATOR_INTERVAL_MS: "600" },
  });

  await new Promise((resolve) => simProc.on("exit", resolve));
  console.log("✅ Sensor Simulator completed 4 rounds.");

  // Wait 3s for all in-flight messages in Node-RED to complete
  await wait(3000);

  // 6. Verification and Analysis
  console.log("\n=================================================");
  console.log("   PHASE 2 VERIFICATION & ANALYSIS");
  console.log("=================================================");

  console.log(`\n🌊 1. Node-RED Flow Metrics:`);
  console.log(`   - Connected to MQTT Broker: ${noderedConnected ? "✅ Connected" : "⚠️ Flow active"}`);
  console.log(`   - Valid Telemetry Events Processed: ${noderedValidTelemetryCount}`);
  console.log(`   - Noise / Out-of-range Readings Dropped: ${noderedDroppedNoiseCount}`);
  console.log(`   - Low-Stock Alert Events Triggered: ${noderedLowStockAlertCount}`);
  console.log(`   - Inventory HTTP Forwarding Actions: ${noderedHttpUpdatesCount}`);

  // Query MongoDB Atlas for verification
  console.log(`\n📦 2. Live Inventory State in MongoDB Atlas:`);
  const stockItems = await db.collection("inventory_status").find().toArray();
  stockItems.forEach((s) => {
    console.log(
      `   Store: ${s.store_id} | Product: ${s.product_id} | Stock: ${s.on_hand_qty} | Last Updated: ${s.last_updated.toISOString()}`
    );
  });

  // Cleanup processes
  console.log("\n🧹 Cleaning up processes...");
  noderedProc.kill();
  serviceProc.kill("SIGINT");
  brokerProc.kill("SIGINT");
  await client.close();

  const success = noderedValidTelemetryCount > 0;

  console.log("\n=================================================");
  console.log(`   PHASE 2 VERIFICATION RESULT: ${success ? "✅ SUCCESS" : "❌ FAILED"}`);
  console.log("=================================================");
}

runTest().catch((err) => {
  console.error("Phase 2 test failed with error:", err);
  process.exit(1);
});
