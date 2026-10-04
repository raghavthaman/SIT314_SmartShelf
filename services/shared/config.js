// services/shared/config.js
// Centralised config loader — reads from environment variables (via dotenv).
// Each service calls loadConfig() at startup.

const path = require("path");

function loadConfig() {
  // Load .env from project root (two levels up from services/shared/)
  require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });

  return {
    mongoUri: process.env.MONGODB_URI,
    dbName: process.env.DB_NAME || "smartshelf",

    inventoryPort: parseInt(process.env.INVENTORY_PORT, 10) || 3001,
    forecastPort: parseInt(process.env.FORECAST_PORT, 10) || 3002,
    notificationPort: parseInt(process.env.NOTIFICATION_PORT, 10) || 3003,
    orderPort: parseInt(process.env.ORDER_PORT, 10) || 3004,

    mqttBrokerUrl: process.env.MQTT_BROKER_URL || "mqtts://localhost:8883",
    mqttUsername: process.env.MQTT_USERNAME,
    mqttPassword: process.env.MQTT_PASSWORD,
    mqttCaCert: process.env.MQTT_CA_CERT,

    awsRegion: process.env.AWS_REGION || "us-east-1",
    sqsReadingsQueueUrl: process.env.SQS_READINGS_QUEUE_URL,
    sqsStockEventsQueueUrl: process.env.SQS_STOCK_EVENTS_QUEUE_URL,

    // Forecast
    forecastWindowPeriods: parseInt(process.env.FORECAST_WINDOW_PERIODS, 10) || 7,
    forecastPeriodMinutes: parseInt(process.env.FORECAST_PERIOD_MINUTES, 10) || 5,
    orderCostS: parseFloat(process.env.ORDER_COST_S) || 50,
    holdingCostH: parseFloat(process.env.HOLDING_COST_H) || 5,
  };
}

module.exports = { loadConfig };
