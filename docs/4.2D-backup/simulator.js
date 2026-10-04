// simulator.js
// Simulates RFID + weight sensor readings for the products seeded by seed.js,
// writing them directly to "shelf_readings" (stands in for the ESP32 edge
// gateway + MQTT + Node-RED pipeline, which is planned for the next iteration).
// Run with: npm run simulate   (Ctrl+C to stop)

const { connectDB, client } = require("./db");

const SHELVES = [
  { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001" },
  { store_id: "STORE-01", shelf_id: "SHELF-B2", product_id: "SKU-1002" },
  { store_id: "STORE-01", shelf_id: "SHELF-C3", product_id: "SKU-1003" },
];

function randomReading(baseQty) {
  // occasionally simulate a noisy / out-of-range reading, so the validation
  // logic planned for Node-RED has something realistic to filter later
  const noiseRoll = Math.random();
  if (noiseRoll < 0.1) return -1; // out-of-range (invalid)
  const drift = Math.round((Math.random() - 0.6) * 2); // slow depletion over time
  return Math.max(0, baseQty + drift);
}

async function run() {
  const db = await connectDB();
  let qtyState = { "SKU-1001": 18, "SKU-1002": 9, "SKU-1003": 22 };

  console.log("Simulator running. Publishing a reading every 3s per shelf. Ctrl+C to stop.");

  setInterval(async () => {
    for (const shelf of SHELVES) {
      const qty = randomReading(qtyState[shelf.product_id]);
      if (qty >= 0) qtyState[shelf.product_id] = qty;

      const reading = {
        ...shelf,
        sensor_type: Math.random() > 0.5 ? "rfid" : "weight",
        quantity: qty,
        reading_ts: new Date(),
      };

      await db.collection("shelf_readings").insertOne(reading);
      console.log(
        `[${reading.reading_ts.toISOString()}] ${reading.store_id}/${reading.shelf_id} ` +
        `${reading.product_id} qty=${reading.quantity} (${reading.sensor_type})` +
        (qty < 0 ? "  <-- invalid, would be dropped by validation stage" : "")
      );
    }
  }, 3000);
}

run().catch((err) => {
  console.error("Simulator failed:", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  console.log("\nStopping simulator...");
  await client.close();
  process.exit(0);
});
