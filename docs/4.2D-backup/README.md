# SmartShelf — Evidence Pack (SIT314 Task 4.2D)

Real, runnable code for the Inventory Service + MongoDB Atlas persistence layer.
Follow the steps below in order — total time roughly 20–30 minutes including screenshots.

## 0. Prerequisites
- Node.js installed (`node -v` in a terminal should print a version)
- A MongoDB Atlas account with a cluster (you already have "Cluster0" from earlier module work)
- Postman installed (or use the free web version at postman.com)

## 1. Get your MongoDB connection string
1. Log into https://cloud.mongodb.com
2. Go to your project → Cluster0 → click **Connect**
3. Choose **Drivers**, select **Node.js**
4. Copy the connection string, e.g.
   `mongodb+srv://thamanraghav4_db_user:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`
5. Make sure your current IP is allow-listed: Atlas → Network Access → Add IP Address → "Add Current IP Address"

## 2. Configure the project
```bash
cd smartshelf-evidence
npm install
cp .env.example .env
```
Open `.env` and paste in your real connection string as `MONGODB_URI`, with your actual password (no `<>` brackets).

## 3. Seed the database (creates your evidence data)
```bash
npm run seed
```
You should see console output like:
```
Connected to MongoDB Atlas, database: smartshelf
Inserted 3 products
Inserted 4 shelf_readings
Inserted 3 inventory_status records
Seed complete. Check MongoDB Atlas -> Cluster0 -> Browse Collections.
```
**📸 Screenshot #1:** this terminal output.

## 4. Screenshot the data in Atlas
1. In Atlas, go to Cluster0 → **Browse Collections**
2. You'll see a `smartshelf` database with `products`, `shelf_readings`, `inventory_status`
3. Click into each collection and screenshot the documents

**📸 Screenshots #2–4:** each of the three collections showing real documents.

## 5. Run the simulator (optional but strengthens the evidence)
In a new terminal tab:
```bash
npm run simulate
```
Let it run for ~15 seconds, then Ctrl+C. This writes live, timestamped readings into `shelf_readings` — refresh the collection in Atlas afterward and you'll see new documents appended.

**📸 Screenshot #5:** the simulator's terminal output showing readings being generated (including at least one "invalid" one being flagged).

## 6. Start the API
```bash
npm start
```
You should see:
```
Connected to MongoDB Atlas, database: smartshelf
Inventory Service listening on http://localhost:3000
```
Leave this running.

## 7. Test the API in Postman
Create these requests in a new Postman collection called "SmartShelf":

| Method | URL | Body (JSON) |
|---|---|---|
| GET | `http://localhost:3000/products` | — |
| GET | `http://localhost:3000/products/SKU-1001` | — |
| POST | `http://localhost:3000/products` | `{"product_id":"SKU-1004","name":"Orange Juice 1L","category":"Beverages","unit_weight_g":1050,"reorder_threshold":10,"case_pack_size":12}` |
| PUT | `http://localhost:3000/products/SKU-1004` | `{"reorder_threshold":15}` |
| DELETE | `http://localhost:3000/products/SKU-1004` | — |
| GET | `http://localhost:3000/inventory/STORE-01` | — |
| PUT | `http://localhost:3000/inventory/STORE-01/SKU-1002` | `{"current_estimate":6,"status":"critical"}` |

Run them **in this order** so the POST creates the record before you PUT/DELETE it.

**📸 Screenshots #6–8:** at minimum, the GET /products response, the successful POST (201, with insertedId), and the PUT /inventory response showing `modifiedCount: 1`. Then go back to Atlas and screenshot `inventory_status` for SKU-1002 showing `status: "critical"` — that's your strongest single piece of evidence because it shows the API actually changed real data.

## 8. Push to GitHub
```bash
git init
echo "node_modules/
.env" > .gitignore
git add .
git commit -m "Inventory Service + MongoDB Atlas persistence layer"
```
Then on github.com: **New repository** → name it `smartshelf` → do **not** initialise with a README (you already have one) → copy the commands it shows you under "…or push an existing repository from the command line", e.g.:
```bash
git remote add origin https://github.com/<your-username>/smartshelf.git
git branch -M main
git push -u origin main
```
Copy the resulting repo URL — that's your GitHub link for the submission.

## What this evidence demonstrates (map to the plan)
- **FR-1 / FR-4**: `shelf_readings` and `inventory_status` collections holding real per-shelf, per-SKU data (Section 8 data design)
- **Section 3.5 (Inventory Service)**: working CRUD REST API, independently deployable, stateless (all state in MongoDB)
- **Section 7.1 (validation)**: simulator marks out-of-range readings — the actual filtering logic is the next piece of work, honestly noted as such

## Honest scope note
MQTT / Node-RED ingestion and the Forecast/Notification/Delivery services are **not** included in this evidence pack — they are still in progress. Say so plainly in the status update rather than implying they're done.
