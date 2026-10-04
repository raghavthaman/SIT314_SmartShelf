// scripts/seed.js
// Populates the "products" and "inventory_status" collections with sample data.
// Adapted from 4.2D seed.js — uses shared db module.
//
// IMPORTANT: This script uses upsert to avoid duplicating existing data.
//            It does NOT wipe collections (unlike the original 4.2D version).
//
// Run from project root: node scripts/seed.js

const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env") });
const { connectDB, closeDB } = require("../services/shared/db");

const products = [
  { product_id: "SKU-1001", name: "Full Cream Milk 2L", category: "Dairy", unit_weight_g: 2060, reorder_threshold: 12, case_pack_size: 6 },
  { product_id: "SKU-1002", name: "White Bread Loaf", category: "Bakery", unit_weight_g: 700, reorder_threshold: 15, case_pack_size: 12 },
  { product_id: "SKU-1003", name: "Free Range Eggs 12pk", category: "Dairy", unit_weight_g: 780, reorder_threshold: 10, case_pack_size: 8 },
  { product_id: "SKU-1004", name: "Orange Juice 1L", category: "Beverages", unit_weight_g: 1050, reorder_threshold: 10, case_pack_size: 12 },
  { product_id: "SKU-1005", name: "Cheddar Cheese 500g", category: "Dairy", unit_weight_g: 520, reorder_threshold: 8, case_pack_size: 10 },
];

const inventoryStatus = [
  { store_id: "STORE-01", product_id: "SKU-1001", current_estimate: 18, forecast_depletion_date: null, status: "ok", last_updated: new Date() },
  { store_id: "STORE-01", product_id: "SKU-1002", current_estimate: 9, forecast_depletion_date: null, status: "low", last_updated: new Date() },
  { store_id: "STORE-01", product_id: "SKU-1003", current_estimate: 22, forecast_depletion_date: null, status: "ok", last_updated: new Date() },
  { store_id: "STORE-01", product_id: "SKU-1004", current_estimate: 15, forecast_depletion_date: null, status: "ok", last_updated: new Date() },
  { store_id: "STORE-01", product_id: "SKU-1005", current_estimate: 5, forecast_depletion_date: null, status: "low", last_updated: new Date() },
];

async function seed() {
  const db = await connectDB();

  // Upsert products (will not overwrite if product_id already exists)
  let upsertedProducts = 0;
  for (const product of products) {
    const result = await db.collection("products").updateOne(
      { product_id: product.product_id },
      { $setOnInsert: product },
      { upsert: true }
    );
    if (result.upsertedCount > 0) upsertedProducts++;
  }

  // Upsert inventory_status
  let upsertedInventory = 0;
  for (const inv of inventoryStatus) {
    const result = await db.collection("inventory_status").updateOne(
      { store_id: inv.store_id, product_id: inv.product_id },
      { $setOnInsert: inv },
      { upsert: true }
    );
    if (result.upsertedCount > 0) upsertedInventory++;
  }

  console.log(`Products: ${upsertedProducts} new (${products.length - upsertedProducts} already existed)`);
  console.log(`Inventory status: ${upsertedInventory} new (${inventoryStatus.length - upsertedInventory} already existed)`);
  console.log("Seed complete.");

  await closeDB();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
