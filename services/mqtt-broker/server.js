// services/mqtt-broker/server.js
// Standalone embedded MQTT broker using Aedes
// Listens on port 1883 for local MQTT clients (simulators, handlers, microservices)

const aedes = require("aedes")();
const net = require("net");
const path = require("path");

// Load config
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

const PORT = parseInt(process.env.MQTT_PORT, 10) || 1883;
const HOST = process.env.MQTT_HOST || "0.0.0.0";

const server = net.createServer(aedes.handle);

server.listen(PORT, HOST, () => {
  console.log(`[MQTT Broker] Listening on mqtt://${HOST}:${PORT}`);
});

aedes.on("client", (client) => {
  console.log(`[MQTT Broker] Client connected: ${client ? client.id : "unknown"}`);
});

aedes.on("clientDisconnect", (client) => {
  console.log(`[MQTT Broker] Client disconnected: ${client ? client.id : "unknown"}`);
});

aedes.on("publish", (packet, client) => {
  if (client && !packet.topic.startsWith("$SYS/")) {
    console.log(`[MQTT Broker] Published to '${packet.topic}' by ${client.id} (${packet.payload.length} bytes)`);
  }
});

process.on("SIGINT", () => {
  console.log("\n[MQTT Broker] Shutting down...");
  server.close(() => {
    aedes.close(() => {
      console.log("[MQTT Broker] Stopped.");
      process.exit(0);
    });
  });
});
