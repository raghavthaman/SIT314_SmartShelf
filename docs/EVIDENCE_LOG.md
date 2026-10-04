# SmartShelf Evidence Log — SIT314 6.3D

This log records real, verified evidence for every implementation phase.  
All outputs shown are from actual command runs — **nothing fabricated**.

> [!IMPORTANT]
> Every entry below corresponds to a real command that was run and a real result that was observed.
> No results, metrics, or screenshots in this log are invented.

---

## Phase 0 — Git Repository, Project Structure & 4.2D Baseline

### P0-01 — Git repository initialised

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:57:05+11:00 |
| **Feature tested** | Git repository setup |
| **Command/action** | `git log --oneline` |
| **Actual result** | `34623ea Phase 0: add root-level dotenv+mongodb deps for seed.js` / `2bf2626 Phase 0: initial project scaffold` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: git_log_phase0.png` (capture in your terminal) |
| **SIT314 requirement** | Version control / project scaffold |

```
34623ea Phase 0: add root-level dotenv+mongodb deps for seed.js
2bf2626 Phase 0: initial project scaffold
```

---

### P0-02 — .env excluded from Git, .env.example tracked

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:56+11:00 |
| **Feature tested** | Credential security — .env not committed |
| **Command/action** | `git check-ignore -v .env` and `git status --short` |
| **Actual result** | `.gitignore:2:.env  .env` — .env is excluded. `.env.example` IS tracked. No credentials in repo. |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: git_status_no_env.png` |
| **SIT314 requirement** | Security — secrets not committed to version control |

---

### P0-03 — 4.2D original source backed up

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:53:10+11:00 |
| **Feature tested** | 4.2D evidence preservation |
| **Command/action** | Copied `server.js`, `db.js`, `seed.js`, `simulator.js`, `package.json`, `.env.example`, `README.md` from `4.2D/` to `docs/4.2D-backup/` |
| **Actual result** | 7 files copied successfully to `docs/4.2D-backup/`. Committed in initial git commit. Original 4.2D directory untouched. |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `docs/4.2D-backup/` (in git history) |
| **SIT314 requirement** | Preserve baseline 4.2D evidence |

---

### P0-04 — Inventory Service starts and connects to MongoDB Atlas

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:55:56+11:00 |
| **Feature tested** | Service startup + MongoDB Atlas connectivity |
| **Command/action** | `node server.js` in `services/inventory-service/` |
| **Actual result** | `Connected to MongoDB Atlas, database: smartshelf` + `{"level":"info","service":"unknown","message":"Inventory Service listening on http://localhost:3001"}` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: inventory_service_startup.png` |
| **SIT314 requirement** | MongoDB Atlas integration; microservice baseline |

```
Connected to MongoDB Atlas, database: smartshelf
{"timestamp":"2026-10-04T03:55:56.560Z","level":"info","service":"unknown","message":"Inventory Service listening on http://localhost:3001"}
```

---

### P0-05 — GET / returns service info

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | Root endpoint |
| **Command/action** | `Invoke-RestMethod -Uri http://localhost:3001/ -Method Get` |
| **Actual result** | `{"service":"SmartShelf Inventory Service","status":"running"}` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_root.png` |
| **SIT314 requirement** | REST API baseline |

---

### P0-06 — GET /health returns healthy (DB ping passes)

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | Health endpoint with MongoDB Atlas ping |
| **Command/action** | `Invoke-RestMethod -Uri http://localhost:3001/health -Method Get` |
| **Actual result** | `{"status":"healthy","service":"inventory-service","timestamp":"2026-10-04T03:56:20.324Z"}` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_health.png` |
| **SIT314 requirement** | MongoDB Atlas integration; ALB-compatible health check |

---

### P0-07 — GET /products returns existing MongoDB data

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | Products collection read — existing 4.2D data preserved |
| **Command/action** | `Invoke-RestMethod -Uri http://localhost:3001/products -Method Get` |
| **Actual result** | `Product count=4` — returned SKU-1001, SKU-1002, SKU-1003, SKU-1004 from Atlas. No data destroyed. |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_products.png` |
| **SIT314 requirement** | MongoDB Atlas — products collection; existing data preserved |

```
Product count=4
{"_id":"6aa72db8...","product_id":"SKU-1003","name":"Free Range Eggs 12pk","category":"Dairy","unit_weight_g":780,"reorder_threshold":10,"case_pack_size":8}
```

---

### P0-08 — GET /inventory/STORE-01 returns existing inventory data

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | inventory_status collection read — existing data preserved |
| **Command/action** | `Invoke-RestMethod -Uri http://localhost:3001/inventory/STORE-01 -Method Get` |
| **Actual result** | `Inventory records=3` — SKU-1001 (ok), SKU-1002 (low), SKU-1003 (ok) from Atlas |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_inventory.png` |
| **SIT314 requirement** | MongoDB Atlas — inventory_status collection; existing data preserved |

---

### P0-09 — POST /products input validation (400 on missing fields)

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | Input validation on product creation |
| **Command/action** | `POST /products` with `{"product_id":"SKU-9999"}` (missing name, category, etc.) |
| **Actual result** | HTTP 400 returned (expected 4xx — PASS) |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_validation.png` |
| **SIT314 requirement** | Improved over 4.2D — proper error handling |

---

### P0-10 — GET /products/SKU-NOTEXIST returns 404

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:20+11:00 |
| **Feature tested** | 404 handling for missing product |
| **Command/action** | `GET /products/SKU-NOTEXIST` |
| **Actual result** | HTTP 404 returned (expected 404 — PASS) |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: api_test_404.png` |
| **SIT314 requirement** | Improved over 4.2D — proper error handling |

---

### P0-11 — seed.js runs safely without destroying existing data

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T14:56:45+11:00 |
| **Feature tested** | Upsert-safe seed script |
| **Command/action** | `node scripts/seed.js` from project root |
| **Actual result** | `Products: 1 new (4 already existed)` / `Inventory status: 2 new (3 already existed)` / `Seed complete.` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `screenshot: seed_output.png` |
| **SIT314 requirement** | MongoDB Atlas — existing data NOT destroyed (Rule 4 compliance) |

```
Products: 1 new (4 already existed)
Inventory status: 2 new (3 already existed)
Seed complete.
```

---

## Phase 0 Summary

| Check | Status |
|-------|--------|
| Git repo initialised with 2 commits | ✅ |
| `.env` excluded from Git (credentials safe) | ✅ |
| `.env.example` committed with placeholder values | ✅ |
| `.gitignore` covers: .env, node_modules, certs, private keys, AWS creds | ✅ |
| 4.2D original source backed up in `docs/4.2D-backup/` | ✅ |
| Project structure created (services/, docs/, infra/, loadtest/, etc.) | ✅ |
| Inventory Service starts on port 3001 | ✅ |
| MongoDB Atlas connection confirmed (smartshelf database) | ✅ |
| All 6 API endpoint tests pass | ✅ |
| Existing products (4) and inventory records (3) preserved | ✅ |
| seed.js upsert-safe (no deleteMany) | ✅ |
| Node.js version: v22.17.1 | ✅ |

**Phase 0 Status: COMPLETE ✅**

---

## Phase 1 — MQTT Broker, Telemetry Simulator & Ingestion Pipeline

### P1-01 — Embedded MQTT Broker startup

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T15:17:26+11:00 |
| **Feature tested** | Standalone MQTT Broker service (`services/mqtt-broker`) |
| **Command/action** | `node services/mqtt-broker/server.js` |
| **Actual result** | `[MQTT Broker] Listening on mqtt://0.0.0.0:1883` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `services/mqtt-broker/server.js` |
| **SIT314 requirement** | Event-driven architecture — MQTT Broker initialization |

---

### P1-02 — Telemetry Ingestion Consumer subscription

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T15:17:26+11:00 |
| **Feature tested** | Inventory Service MQTT Consumer (`mqtt_consumer.js`) |
| **Command/action** | Integrated into Inventory Service startup sequence |
| **Actual result** | Subscribed to topic `smartshelf/sensors/#` on `mqtt://localhost:1883` |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `services/inventory-service/mqtt_consumer.js` |
| **SIT314 requirement** | Event-driven microservice telemetry ingestion |

---

### P1-03 — Telemetry Simulation & Noise Filtering

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T15:17:28+11:00 |
| **Feature tested** | Telemetry publisher & validation logic |
| **Command/action** | `node simulator/sensor_publisher.js --count 5` |
| **Actual result** | 15 total telemetry events published (RFID + Weight); 3 noise events (`qty = -1`) dropped by validation rules; 12 valid readings stored in MongoDB Atlas `shelf_readings`. Zero noise records persisted. |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `simulator/sensor_publisher.js` |
| **SIT314 requirement** | Sensor telemetry ingestion, data validation & MongoDB Atlas persistence |

---

### P1-04 — Inventory Status Live Update

| Field | Value |
|-------|-------|
| **Date/Time** | 2026-10-04T15:17:28+11:00 |
| **Feature tested** | Stock level update in `inventory_status` |
| **Command/action** | Automatic update triggered by MQTT telemetry ingestion |
| **Actual result** | Stock status updated in real-time (`SKU-1001`: 17, `SKU-1002`: 8, `SKU-1003`: 22) with `last_updated` timestamp and `last_sensor` type |
| **Pass/Fail** | ✅ PASS |
| **Evidence filename** | `scripts/test_phase1.js` |
| **SIT314 requirement** | Live stock estimation from sensor fusion |

---

## Phase 1 Summary

| Check | Status |
|-------|--------|
| Standalone Aedes MQTT broker running on port 1883 | ✅ |
| Eclipse Mosquitto Docker configuration (`infra/docker-compose.yml`, `infra/mosquitto.conf`) provided | ✅ |
| Sensor simulator (`simulator/sensor_publisher.js`) publishing to `smartshelf/sensors/#` | ✅ |
| Telemetry consumer (`mqtt_consumer.js`) validating messages and filtering out noise | ✅ |
| Raw telemetry persisted to MongoDB Atlas `shelf_readings` collection | ✅ |
| Real-time inventory status updated in MongoDB Atlas `inventory_status` collection | ✅ |
| Phase 1 end-to-end automated test suite (`scripts/test_phase1.js`) passed | ✅ |

**Phase 1 Status: COMPLETE ✅**


