// seed.js
// Populates the "products", "shelf_readings" and "inventory_status" collections
// with sample data, matching the data design in Section 8 of distinction_plan.pdf.
// Run with: npm run seed

const { connectDB, client } = require("./db");

const products = [
  { product_id: "SKU-1001", name: "Full Cream Milk 2L", category: "Dairy", unit_weight_g: 2060, reorder_threshold: 12, case_pack_size: 6 },
  { product_id: "SKU-1002", name: "White Bread Loaf", category: "Bakery", unit_weight_g: 700, reorder_threshold: 15, case_pack_size: 12 },
  { product_id: "SKU-1003", name: "Free Range Eggs 12pk", category: "Dairy", unit_weight_g: 780, reorder_threshold: 10, case_pack_size: 8 },
];

const now = new Date();

const shelfReadings = [
  { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001", sensor_type: "weight", quantity: 18, reading_ts: now },
  { store_id: "STORE-01", shelf_id: "SHELF-A1", product_id: "SKU-1001", sensor_type: "rfid", quantity: 17, reading_ts: now },
  { store_id: "STORE-01", shelf_id: "SHELF-B2", product_id: "SKU-1002", sensor_type: "weight", quantity: 9, reading_ts: now },
  { store_id: "STORE-01", shelf_id: "SHELF-C3", product_id: "SKU-1003", sensor_type: "rfid", quantity: 22, reading_ts: now },
];

const inventoryStatus = [
  { store_id: "STORE-01", product_id: "SKU-1001", current_estimate: 17.5, forecast_depletion_date: null, status: "ok", last_updated: now },
  { store_id: "STORE-01", product_id: "SKU-1002", current_estimate: 9, forecast_depletion_date: null, status: "low", last_updated: now },
  { store_id: "STORE-01", product_id: "SKU-1003", current_estimate: 22, forecast_depletion_date: null, status: "ok", last_updated: now },
];

async function seed() {
  const db = await connectDB();

  await db.collection("products").deleteMany({});
  await db.collection("shelf_readings").deleteMany({});
  await db.collection("inventory_status").deleteMany({});

  const p = await db.collection("products").insertMany(products);
  const r = await db.collection("shelf_readings").insertMany(shelfReadings);
  const s = await db.collection("inventory_status").insertMany(inventoryStatus);

  console.log(`Inserted ${p.insertedCount} products`);
  console.log(`Inserted ${r.insertedCount} shelf_readings`);
  console.log(`Inserted ${s.insertedCount} inventory_status records`);
  console.log("Seed complete. Check MongoDB Atlas -> Cluster0 -> Browse Collections.");

  await client.close();
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
