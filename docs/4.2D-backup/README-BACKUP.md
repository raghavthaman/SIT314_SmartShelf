# 4.2D Original Source — Preserved Backup

**DO NOT MODIFY these files.** They are read-only evidence of the working 4.2D implementation
that 6.3D is built upon.

## Files

| File | Description |
|------|-------------|
| `server.js` | Original 4.2D Express REST API (products + inventory_status + shelf_readings) |
| `db.js` | Original MongoDB connection helper |
| `seed.js` | Original seed script (uses deleteMany — do not run against live Atlas) |
| `simulator.js` | Original direct-to-MongoDB sensor simulator |
| `package.json` | Original dependencies |
| `env.example` | Original environment variable template |
| `README.md` | Original 4.2D README |

## What the 4.2D implementation demonstrated

- MongoDB Atlas connection via MONGODB_URI environment variable
- Express REST API: GET/POST/PUT/DELETE on `/products`
- Read/Update endpoints on `/inventory/:store_id`
- `shelf_readings` collection: sensor data written directly to MongoDB
- `inventory_status` collection: per-product stock estimates
- Seed data: SKU-1001 (Milk), SKU-1002 (Bread), SKU-1003 (Eggs)
- Working locally on `http://localhost:3000`

## Differences in 6.3D

The 6.3D `services/inventory-service/server.js` improves on this by adding:
- Proper `try/catch` error handling on all async routes
- Input validation (missing fields, type checks)
- `/health` endpoint (ALB-compatible)
- Structured JSON logging via shared logger
- Port from `INVENTORY_PORT` env var (default 3001)
- Shared `db.js` with `checkDBHealth()` function

The original 4.2D data collections (`products`, `shelf_readings`, `inventory_status`) in
MongoDB Atlas are preserved unchanged.
