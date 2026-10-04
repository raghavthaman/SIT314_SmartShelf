// services/shared/db.js
// Shared Database connection for SmartShelf microservices.
// Connects to MongoDB Atlas when available; gracefully falls back to
// embedded persistent SmartShelf DB when offline or credentials expire.

const { MongoClient } = require("mongodb");
const { EmbeddedDB } = require("./embedded_db");

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "smartshelf";

let client = null;
let db = null;
let isEmbedded = false;

async function connectDB() {
  if (db) return db;

  // Option to explicitly enforce embedded offline mode
  if (process.env.USE_EMBEDDED_DB === "true" || !uri) {
    console.log(`[Database] Using Embedded SmartShelf DB (offline mode), database: ${dbName}`);
    db = new EmbeddedDB(dbName);
    isEmbedded = true;
    return db;
  }

  try {
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    db = client.db(dbName);
    console.log(`Connected to MongoDB Atlas, database: ${dbName}`);
    isEmbedded = false;
    return db;
  } catch (err) {
    console.warn(`[Database] MongoDB Atlas connection failed (${err.message}). Falling back to Embedded SmartShelf DB.`);
    db = new EmbeddedDB(dbName);
    isEmbedded = true;
    return db;
  }
}

async function closeDB() {
  if (client && !isEmbedded) {
    try {
      await client.close();
    } catch (_) {}
  }
}

/**
 * Health check — attempts a lightweight command against the DB.
 * Returns { ok: true } or throws.
 */
async function checkDBHealth() {
  if (!db) {
    await connectDB();
  }
  const result = await db.command({ ping: 1 });
  if (result.ok !== 1) throw new Error("Database ping failed");
  return { ok: true, isEmbedded };
}

module.exports = { connectDB, closeDB, client, checkDBHealth };
