// node-red/settings.js
// Isolated settings file for SmartShelf Node-RED runtime

module.exports = {
  uiPort: process.env.NODERED_PORT || 1880,
  uiHost: "0.0.0.0",
  flowFile: "flows.json",
  flowFilePretty: true,
  credentialSecret: false,
  logging: {
    console: {
      level: "info",
      metrics: false,
      audit: false,
    },
  },
  editorTheme: {
    page: {
      title: "SmartShelf Node-RED Gateway",
    },
    header: {
      title: "SmartShelf SIT314 Edge Gateway",
    },
  },
};
