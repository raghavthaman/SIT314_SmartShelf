// simulator/sensor_publisher.js
// Simulates RFID + Weight sensor telemetry for SmartShelf
// Publishes payloads to topic: smartshelf/sensors/{store_id}/{shelf_id}

const mqtt = require("mqtt");
const path = require("path");

require("dotenv").config({ path: path.resolve(__dirname, "../.env") });

const BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
const PUBLISH_INTERVAL_MS = parseInt(process.env.SIMULATOR_INTERVAL_MS, 10) || 3000;

const SHELVES = [
  { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001" },
  { store_id: "STORE-01", shelf_id: "SHELF-B2", product_id: "SKU-1002" },
  { store_id: "STORE-01", shelf_id: "SHELF-C3", product_id: "SKU-1003" },
];

let qtyState = { "SKU-1001": 18, "SKU-1002": 9, "SKU-1003": 22 };

function generateReading(productId) {
  const noiseRoll = Math.random();
  // 10% chance of invalid / out-of-range sensor noise (-1) to test pipeline validation
  if (noiseRoll < 0.1) {
    return -1;
  }
  const drift = Math.round((Math.random() - 0.6) * 2);
  const current = qtyState[productId] || 15;
  const nextQty = Math.max(0, current + drift);
  qtyState[productId] = nextQty;
  return nextQty;
}

const client = mqtt.connect(BROKER_URL, {
  clientId: `smartshelf-simulator-${Math.random().toString(16).substring(2, 8)}`,
  clean: true,
  reconnectPeriod: 2000,
});

const isOnce = process.argv.includes("--once");
const countArgIndex = process.argv.indexOf("--count");
const maxPublishCount = countArgIndex !== -1 ? parseInt(process.argv[countArgIndex + 1], 10) : (isOnce ? 1 : Infinity);

let publishCounter = 0;

client.on("connect", () => {
  console.log(`[Simulator] Connected to MQTT broker at ${BROKER_URL}`);
  console.log(`[Simulator] Publishing mode: ${maxPublishCount === Infinity ? "Continuous" : `Limit ${maxPublishCount} rounds`}`);

  const publishRound = () => {
    publishCounter++;
    for (const shelf of SHELVES) {
      const qty = generateReading(shelf.product_id);
      const sensorType = Math.random() > 0.5 ? "rfid" : "weight";
      const topic = `smartshelf/sensors/${shelf.store_id}/${shelf.shelf_id}`;

      const payload = {
        store_id: shelf.store_id,
        shelf_id: shelf.shelf_id,
        product_id: shelf.product_id,
        sensor_type: sensorType,
        quantity: qty,
        reading_ts: new Date().toISOString(),
      };

      client.publish(topic, JSON.stringify(payload), { qos: 1 }, (err) => {
        if (err) {
          console.error(`[Simulator] Error publishing to ${topic}:`, err.message);
        } else {
          console.log(
            `[Simulator] Published [Round ${publishCounter}] -> ${topic}: product=${payload.product_id} qty=${payload.quantity} (${payload.sensor_type})${qty < 0 ? " <NOISE/INVALID>" : ""}`
          );
        }
      });
    }

    if (publishCounter >= maxPublishCount) {
      setTimeout(() => {
        console.log(`[Simulator] Reached maximum publish count (${maxPublishCount}). Exiting.`);
        client.end(false, () => process.exit(0));
      }, 500);
    }
  };

  publishRound();

  if (maxPublishCount > 1) {
    const timer = setInterval(() => {
      publishRound();
      if (publishCounter >= maxPublishCount) {
        clearInterval(timer);
      }
    }, PUBLISH_INTERVAL_MS);
  }
});

client.on("error", (err) => {
  console.error("[Simulator] MQTT client error:", err.message);
});

process.on("SIGINT", () => {
  console.log("\n[Simulator] Stopping simulator...");
  client.end(false, () => process.exit(0));
});
