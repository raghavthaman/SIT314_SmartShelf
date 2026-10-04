// server.js
// Inventory Service - minimal Express REST API over the "products" and
// "inventory_status" collections, per Section 3.5 of the status update.
// Run with: npm start   (after running: npm run seed)

require("dotenv").config();
const express = require("express");
const { connectDB } = require("./db");
const { ObjectId } = require("mongodb");

const app = express();
app.use(express.json());
const PORT = process.env.PORT || 3000;

let db;

// ---- Health check ----
app.get("/", (req, res) => {
  res.json({ service: "SmartShelf Inventory Service", status: "running" });
});

// ---- PRODUCTS: CRUD ----

// CREATE
app.post("/products", async (req, res) => {
  const result = await db.collection("products").insertOne(req.body);
  res.status(201).json({ insertedId: result.insertedId });
});

// READ (all)
app.get("/products", async (req, res) => {
  const items = await db.collection("products").find({}).toArray();
  res.json(items);
});

// READ (one, by product_id)
app.get("/products/:product_id", async (req, res) => {
  const item = await db.collection("products").findOne({ product_id: req.params.product_id });
  if (!item) return res.status(404).json({ error: "Product not found" });
  res.json(item);
});

// UPDATE (by product_id)
app.put("/products/:product_id", async (req, res) => {
  const result = await db.collection("products").updateOne(
    { product_id: req.params.product_id },
    { $set: req.body }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ modifiedCount: result.modifiedCount });
});

// DELETE (by product_id)
app.delete("/products/:product_id", async (req, res) => {
  const result = await db.collection("products").deleteOne({ product_id: req.params.product_id });
  if (result.deletedCount === 0) return res.status(404).json({ error: "Product not found" });
  res.json({ deletedCount: result.deletedCount });
});

// ---- INVENTORY STATUS: read-focused endpoints ----

// Current stock for a store
app.get("/inventory/:store_id", async (req, res) => {
  const items = await db.collection("inventory_status").find({ store_id: req.params.store_id }).toArray();
  res.json(items);
});

// Stock for a specific product in a specific store
app.get("/inventory/:store_id/:product_id", async (req, res) => {
  const item = await db.collection("inventory_status").findOne({
    store_id: req.params.store_id,
    product_id: req.params.product_id,
  });
  if (!item) return res.status(404).json({ error: "No inventory record found" });
  res.json(item);
});

// Manually update stock estimate (simulates what the Inventory microservice
// would do automatically when a fused sensor reading arrives)
app.put("/inventory/:store_id/:product_id", async (req, res) => {
  const result = await db.collection("inventory_status").updateOne(
    { store_id: req.params.store_id, product_id: req.params.product_id },
    { $set: { ...req.body, last_updated: new Date() } }
  );
  if (result.matchedCount === 0) return res.status(404).json({ error: "No inventory record found" });
  res.json({ modifiedCount: result.modifiedCount });
});

connectDB()
  .then((database) => {
    db = database;
    app.listen(PORT, () => console.log(`Inventory Service listening on http://localhost:${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to connect to MongoDB:", err);
    process.exit(1);
  });
