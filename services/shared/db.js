// services/shared/db.js
// Shared MongoDB connection — used by all microservices.
// Adapted from the original 4.2D db.js.

const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "smartshelf";

if (!uri) {
  console.error(
    "Missing MONGODB_URI in environment. Copy .env.example to .env and fill it in."
  );
  process.exit(1);
}

const client = new MongoClient(uri);
let db;

async function connectDB() {
  if (db) return db;
  await client.connect();
  db = client.db(dbName);
  console.log(`Connected to MongoDB Atlas, database: ${dbName}`);
  return db;
}

async function closeDB() {
  await client.close();
}

/**
 * Health check — attempts a lightweight command against the DB.
 * Returns { ok: true } or throws.
 */
async function checkDBHealth() {
  const result = await db.command({ ping: 1 });
  if (result.ok !== 1) throw new Error("MongoDB ping failed");
  return { ok: true };
}

module.exports = { connectDB, closeDB, client, checkDBHealth };
