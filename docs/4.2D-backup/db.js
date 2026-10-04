// db.js
// Single shared MongoDB connection used by both seed.js and server.js.
require("dotenv").config();
const { MongoClient } = require("mongodb");

const uri = process.env.MONGODB_URI;
const dbName = process.env.DB_NAME || "smartshelf";

if (!uri) {
  console.error("Missing MONGODB_URI in .env — copy .env.example to .env and fill it in.");
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

module.exports = { connectDB, client };
