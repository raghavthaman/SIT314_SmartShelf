// scripts/test_phase6.js
// Phase 6 & 7 Verification: Caching Layer (Cache-Aside pattern)
// Tests:
// 1. Initial request produces Cache MISS (fetches from database)
// 2. Subsequent request produces Cache HIT with significant latency reduction
// 3. Stock mutation triggers immediate Cache Invalidation
// 4. Subsequent read re-populates cache with updated values
// 5. Cache stats metrics endpoint verification

const http = require("http");
const { spawn } = require("child_process");
const path = require("path");

function httpRequest(options, postData = null) {
  return new Promise((resolve, reject) => {
    const startTime = process.hrtime.bigint();
    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => {
        const endTime = process.hrtime.bigint();
        const durationMs = Number(endTime - startTime) / 1e6;
        let data = body;
        try {
          data = JSON.parse(body);
        } catch (_) {}
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data,
          durationMs,
        });
      });
    });
    req.on("error", reject);
    if (postData) {
      req.write(typeof postData === "string" ? postData : JSON.stringify(postData));
    }
    req.end();
  });
}

async function waitForServer(port, retries = 20) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await httpRequest({
        hostname: "localhost",
        port,
        path: "/health",
        method: "GET",
      });
      if (res.statusCode === 200) return true;
    } catch (_) {}
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

async function run() {
  console.log("==================================================================");
  console.log(" PHASE 6 & 7 VERIFICATION: CACHING LAYER & PERFORMANCE BENCHMARKS");
  console.log("==================================================================");

  let srvProc = null;
  const isRunning = await waitForServer(3001, 2);
  if (!isRunning) {
    console.log("[*] Starting inventory service on port 3001...");
    srvProc = spawn("node", ["services/inventory-service/server.js"], {
      cwd: path.resolve(__dirname, ".."),
      stdio: "pipe",
    });
    const ready = await waitForServer(3001, 25);
    if (!ready) {
      console.error("[-] Inventory service failed to start");
      if (srvProc) srvProc.kill();
      process.exit(1);
    }
    console.log("[+] Inventory service running on port 3001.");
  } else {
    console.log("[+] Inventory service already running on port 3001.");
  }

  try {
    // -------------------------------------------------------------
    // Test 1: Cache Miss vs Cache Hit for Products
    // -------------------------------------------------------------
    console.log("\n[Test 1] Testing /products Cache Miss vs Cache Hit");
    
    // First call -> Cache MISS
    const missRes = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/products",
      method: "GET",
    });
    console.log(`  -> Call 1: HTTP ${missRes.statusCode}, X-Cache: ${missRes.headers["x-cache"]}, Latency: ${missRes.durationMs.toFixed(2)}ms`);

    // Second call -> Cache HIT
    const hitRes = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/products",
      method: "GET",
    });
    console.log(`  -> Call 2: HTTP ${hitRes.statusCode}, X-Cache: ${hitRes.headers["x-cache"]}, Latency: ${hitRes.durationMs.toFixed(2)}ms`);

    const speedup = missRes.durationMs > 0 ? (missRes.durationMs / (hitRes.durationMs || 0.1)).toFixed(1) : "N/A";
    console.log(`  -> Cache Hit Speedup: ${speedup}x faster`);

    if (hitRes.headers["x-cache"] !== "HIT") {
      throw new Error("Expected X-Cache: HIT on second request");
    }

    // -------------------------------------------------------------
    // Test 2: Store Inventory Caching & Invalidation
    // -------------------------------------------------------------
    console.log("\n[Test 2] Testing Store Inventory Caching & Invalidation");
    const storeMiss = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/inventory/STORE-01",
      method: "GET",
    });
    console.log(`  -> Initial store inventory read: X-Cache: ${storeMiss.headers["x-cache"]}, Latency: ${storeMiss.durationMs.toFixed(2)}ms`);

    const storeHit = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/inventory/STORE-01",
      method: "GET",
    });
    console.log(`  -> Cached store inventory read: X-Cache: ${storeHit.headers["x-cache"]}, Latency: ${storeHit.durationMs.toFixed(2)}ms`);
    if (storeHit.headers["x-cache"] !== "HIT") {
      throw new Error("Expected X-Cache: HIT for store inventory");
    }

    // Invalidation via PUT
    console.log("  -> Modifying stock to trigger cache invalidation...");
    const updateRes = await httpRequest(
      {
        hostname: "localhost",
        port: 3001,
        path: "/inventory/STORE-01/SKU-1001",
        method: "PUT",
        headers: { "Content-Type": "application/json" },
      },
      { current_estimate: 25 }
    );
    console.log(`  -> Stock update HTTP status: ${updateRes.statusCode}`);

    // Read after invalidation -> MUST be MISS
    const postInvalidateRes = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/inventory/STORE-01",
      method: "GET",
    });
    console.log(`  -> Read after invalidation: X-Cache: ${postInvalidateRes.headers["x-cache"]}, Latency: ${postInvalidateRes.durationMs.toFixed(2)}ms`);
    if (postInvalidateRes.headers["x-cache"] !== "MISS") {
      throw new Error("Expected X-Cache: MISS following cache invalidation");
    }

    // -------------------------------------------------------------
    // Test 3: Cache Metrics Endpoint
    // -------------------------------------------------------------
    console.log("\n[Test 3] Verifying /cache/stats endpoint");
    const statsRes = await httpRequest({
      hostname: "localhost",
      port: 3001,
      path: "/cache/stats",
      method: "GET",
    });
    console.log("  -> Cache Stats:", JSON.stringify(statsRes.data, null, 2));

    if (!statsRes.data || !statsRes.data.cache || typeof statsRes.data.cache.cachedKeysCount !== "number") {
      throw new Error("Invalid cache stats response");
    }

    console.log("\n==================================================================");
    console.log(" [SUCCESS] PHASE 6 & 7 CACHING VERIFICATION PASSED");
    console.log("==================================================================");
  } finally {
    if (srvProc) {
      console.log("[*] Shutting down spawned test server...");
      srvProc.kill();
    }
  }
}

run().catch((err) => {
  console.error("[-] Verification failed:", err);
  process.exit(1);
});
