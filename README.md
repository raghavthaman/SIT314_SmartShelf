# SmartShelf — SIT314 6.3D

**Automatic Stock Management and Delivery System for Supermarkets**

Built on top of the working 4.2D implementation, extended for SIT314 6.3D with:
- Event-driven architecture (MQTT → Node-RED → SQS → microservices)
- Horizontal scaling on AWS (EC2 Auto Scaling, ALB)
- CloudWatch monitoring
- Load testing with real metrics

---

## Project Structure

```
6.3D/
├── docs/
│   ├── 4.2D-backup/        # Original 4.2D source (DO NOT MODIFY)
│   └── EVIDENCE_LOG.md     # Real, dated evidence for all phases
├── infra/                  # AWS CloudFormation / scripts
├── loadtest/               # k6 load test scripts
├── mqtt/
│   └── certs/              # TLS certificates (not committed)
├── node-red/               # Node-RED flow exports
├── results/                # Load test raw output CSVs/JSON
├── scripts/
│   └── seed.js             # DB seed (upsert — safe to re-run)
├── services/
│   ├── shared/             # Shared db.js, logger.js, config.js
│   ├── inventory-service/  # Phase 0: working REST API
│   ├── forecast-service/   # Phase 4: EOQ/Wilson forecast (port 3002)
│   ├── notification-service/ # Phase 5: order alert dispatcher (port 3003)
│   └── order-service/      # Phase 5: EOQ-sized replenishment orders (port 3004)
├── simulator/              # MQTT sensor simulator (Phase 1+)
├── .env.example            # Copy to .env — fill in secrets
├── .gitignore
└── package.json
```

## Quick Start

```bash
# 1. Copy environment template
cp .env.example .env
# Edit .env — fill in MONGODB_URI, etc.

# 2. Install inventory service dependencies
cd services/inventory-service && npm install

# 3. Start inventory service
npm start
# → http://localhost:3001

# 4. (Optional) seed MongoDB Atlas
cd ../.. && node scripts/seed.js
```

## API Endpoints (Inventory Service)

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check (DB ping) |
| GET | /products | List all products |
| POST | /products | Create product |
| GET | /products/:id | Get product |
| PUT | /products/:id | Update product |
| DELETE | /products/:id | Delete product |
| GET | /inventory/:store | Stock for a store |
| GET | /inventory/:store/:product | Stock for product |
| PUT | /inventory/:store/:product | Update stock estimate |

## Order Service (port 3004)

Consumes `REPLENISHMENT_REQUIRED` events from `smartshelf-stock-events-queue`, sizes each order with the
Forecast Service EOQ (falls back to local sizing if it is down), and allows at most one open order per
store/product (unique partial index). Order events go to `smartshelf-notifications-queue`.

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check (DB ping) |
| GET | /orders | List orders (`?store_id=&product_id=&status=`) |
| GET | /orders/:order_id | Get order |
| POST | /orders | Manual replenishment order `{store_id, product_id}` (409 if one is open) |
| PATCH | /orders/:order_id/status | `{status}` — PENDING → CONFIRMED → DISPATCHED → DELIVERED, or CANCELLED. DELIVERED adds the quantity to stock |

## Notification Service (port 3003)

Consumes `smartshelf-notifications-queue`, dispatches alerts to the console log (and to
`NOTIFICATION_WEBHOOK_URL` if set), and records them in the `notifications` collection.

| Method | Path | Description |
|--------|------|-------------|
| GET | /health | Health check (DB ping) |
| GET | /notifications | History (`?store_id=&product_id=&event_type=`) |
| GET | /notifications/stats | Counts by event type + queue depth |

## Evidence

See [`docs/EVIDENCE_LOG.md`](docs/EVIDENCE_LOG.md) for all phase test results.

## Security Notes

- **Never commit `.env`** — it is gitignored.
- **Never commit certificates** (`.pem`, `.key`, `.crt`) — gitignored.
- **Never commit AWS credentials** — gitignored.
- Use `.env.example` as the template.
