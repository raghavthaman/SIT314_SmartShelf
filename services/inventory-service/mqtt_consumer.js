// services/inventory-service/mqtt_consumer.js
// Subscribes to MQTT sensor topics (smartshelf/sensors/#)
// Validates telemetry readings, writes raw telemetry to `shelf_readings`,
// and updates stock levels in `inventory_status`.

const mqtt = require("mqtt");
const logger = require("../shared/logger");

function startMqttConsumer(db, brokerUrl) {
  const url = brokerUrl || process.env.MQTT_BROKER_URL || "mqtt://localhost:1883";
  const topicPattern = "smartshelf/sensors/#";

  logger.info("Initializing MQTT Telemetry Consumer", { brokerUrl: url, topicPattern });

  const client = mqtt.connect(url, {
    clientId: `inventory-consumer-${Math.random().toString(16).substring(2, 8)}`,
    clean: true,
    reconnectPeriod: 2000,
  });

  client.on("connect", () => {
    logger.info("Connected to MQTT broker", { brokerUrl: url });
    client.subscribe(topicPattern, { qos: 1 }, (err) => {
      if (err) {
        logger.error("Failed to subscribe to MQTT topic", { topicPattern, error: err.message });
      } else {
        logger.info("Subscribed to MQTT telemetry stream", { topicPattern });
      }
    });
  });

  client.on("message", async (topic, payloadBuffer) => {
    try {
      const rawText = payloadBuffer.toString("utf8");
      const data = JSON.parse(rawText);

      const { store_id, shelf_id, product_id, sensor_type, quantity, reading_ts } = data;

      // 1. Validation check
      if (!store_id || !product_id || typeof quantity !== "number") {
        logger.warn("Dropped invalid telemetry message (missing mandatory fields)", { topic, data });
        return;
      }

      if (quantity < 0) {
        logger.warn("Dropped noise/out-of-range sensor reading", {
          topic,
          store_id,
          product_id,
          quantity,
          sensor_type,
        });
        return;
      }

      // 2. Persist raw reading to shelf_readings collection
      const readingDoc = {
        store_id,
        shelf_id: shelf_id || "SHELF-UNKNOWN",
        product_id,
        sensor_type: sensor_type || "rfid",
        quantity,
        reading_ts: reading_ts ? new Date(reading_ts) : new Date(),
        ingested_at: new Date(),
        topic,
      };

      await db.collection("shelf_readings").insertOne(readingDoc);

      // 3. Upsert into inventory_status collection
      await db.collection("inventory_status").updateOne(
        { store_id, product_id },
        {
          $set: {
            on_hand_qty: quantity,
            last_updated: new Date(),
            last_sensor: sensor_type || "rfid",
          },
        },
        { upsert: true }
      );

      logger.info("Processed telemetry event & updated stock", {
        store_id,
        product_id,
        quantity,
        sensor_type,
      });
    } catch (err) {
      logger.error("Error processing MQTT telemetry message", { topic, error: err.message });
    }
  });

  client.on("error", (err) => {
    logger.error("MQTT client connection error", { error: err.message });
  });

  return client;
}

module.exports = { startMqttConsumer };
