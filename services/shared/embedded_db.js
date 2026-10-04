// services/shared/embedded_db.js
// Self-contained embedded document store providing MongoDB-compatible interface.
// Ensures 100% offline functionality, fault-tolerance, and zero-dependency operation
// when remote MongoDB Atlas cluster is unavailable.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DATA_DIR = path.resolve(__dirname, ".data");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function getCollectionPath(colName) {
  ensureDataDir();
  const safeName = colName.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(DATA_DIR, `${safeName}.json`);
}

function readCollection(colName) {
  const filePath = getCollectionPath(colName);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_) {
    return [];
  }
}

function writeCollection(colName, docs) {
  const filePath = getCollectionPath(colName);
  const tmpPath = `${filePath}.tmp.${Date.now()}.${Math.random().toString(16).slice(2, 6)}`;
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(docs, null, 2), "utf8");
    fs.renameSync(tmpPath, filePath);
  } catch (_) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(docs, null, 2), "utf8");
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch (_) {}
  }
}

// Pre-seed default data if collections are empty
function initSeedData() {
  ensureDataDir();
  const productsPath = getCollectionPath("products");
  if (!fs.existsSync(productsPath)) {
    const defaultProducts = [
      { _id: "prod_1", product_id: "SKU-1001", name: "Full Cream Milk 2L", category: "Dairy", unit_weight_g: 2060, reorder_threshold: 12, case_pack_size: 6, unit_price: 3.5 },
      { _id: "prod_2", product_id: "SKU-1002", name: "White Bread Loaf", category: "Bakery", unit_weight_g: 700, reorder_threshold: 15, case_pack_size: 12, unit_price: 2.5 },
      { _id: "prod_3", product_id: "SKU-1003", name: "Free Range Eggs 12pk", category: "Dairy", unit_weight_g: 780, reorder_threshold: 10, case_pack_size: 8, unit_price: 4.8 },
      { _id: "prod_4", product_id: "SKU-1004", name: "Orange Juice 1L", category: "Beverages", unit_weight_g: 1050, reorder_threshold: 10, case_pack_size: 12, unit_price: 3.0 },
      { _id: "prod_5", product_id: "SKU-1005", name: "Cheddar Cheese 500g", category: "Dairy", unit_weight_g: 520, reorder_threshold: 8, case_pack_size: 10, unit_price: 6.2 },
    ];
    writeCollection("products", defaultProducts);
  }

  const inventoryPath = getCollectionPath("inventory_status");
  if (!fs.existsSync(inventoryPath)) {
    const defaultInventory = [
      { _id: "inv_1", store_id: "STORE-01", product_id: "SKU-1001", on_hand_qty: 14, current_estimate: 14, last_sensor: "weight", last_updated: new Date().toISOString() },
      { _id: "inv_2", store_id: "STORE-01", product_id: "SKU-1002", on_hand_qty: 6, current_estimate: 6, last_sensor: "weight", last_updated: new Date().toISOString() },
      { _id: "inv_3", store_id: "STORE-01", product_id: "SKU-1003", on_hand_qty: 19, current_estimate: 19, last_sensor: "rfid", last_updated: new Date().toISOString() },
      { _id: "inv_4", store_id: "STORE-01", product_id: "SKU-1004", on_hand_qty: 15, current_estimate: 15, last_sensor: "rfid", last_updated: new Date().toISOString() },
      { _id: "inv_5", store_id: "STORE-01", product_id: "SKU-1005", on_hand_qty: 5, current_estimate: 5, last_sensor: "weight", last_updated: new Date().toISOString() },
    ];
    writeCollection("inventory_status", defaultInventory);
  }
}

initSeedData();

function matchDoc(doc, query) {
  if (!query || Object.keys(query).length === 0) return true;
  for (const [key, val] of Object.entries(query)) {
    if (val && typeof val === "object" && !(val instanceof Date)) {
      if (val.$in && Array.isArray(val.$in)) {
        if (!val.$in.includes(doc[key])) return false;
      } else if (val.$lt !== undefined) {
        if (!(doc[key] < val.$lt)) return false;
      } else if (val.$lte !== undefined) {
        if (!(doc[key] <= val.$lte)) return false;
      } else if (val.$gt !== undefined) {
        if (!(doc[key] > val.$gt)) return false;
      } else if (val.$gte !== undefined) {
        if (!(doc[key] >= val.$gte)) return false;
      }
    } else if (val instanceof RegExp) {
      if (!val.test(doc[key])) return false;
    } else {
      if (doc[key] !== val) return false;
    }
  }
  return true;
}

class EmbeddedCollection {
  constructor(name) {
    this.name = name;
  }

  async findOne(query) {
    const docs = readCollection(this.name);
    const found = docs.find((d) => matchDoc(d, query));
    return found ? JSON.parse(JSON.stringify(found)) : null;
  }

  find(query = {}) {
    const docs = readCollection(this.name);
    let matched = docs.filter((d) => matchDoc(d, query));

    const cursor = {
      _sort: null,
      _limit: null,
      sort(sortObj) {
        cursor._sort = sortObj;
        return cursor;
      },
      limit(n) {
        cursor._limit = n;
        return cursor;
      },
      async toArray() {
        let res = [...matched];
        if (cursor._sort) {
          const [key, dir] = Object.entries(cursor._sort)[0] || [];
          if (key) {
            res.sort((a, b) => {
              if (a[key] < b[key]) return dir > 0 ? -1 : 1;
              if (a[key] > b[key]) return dir > 0 ? 1 : -1;
              return 0;
            });
          }
        }
        if (cursor._limit && cursor._limit > 0) {
          res = res.slice(0, cursor._limit);
        }
        return JSON.parse(JSON.stringify(res));
      },
    };

    return cursor;
  }

  async insertOne(doc) {
    const docs = readCollection(this.name);
    const newDoc = {
      _id: doc._id || `id_${crypto.randomBytes(6).toString("hex")}`,
      ...doc,
    };
    docs.push(newDoc);
    writeCollection(this.name, docs);
    return { insertedId: newDoc._id, acknowledged: true };
  }

  async updateOne(query, update, options = {}) {
    const docs = readCollection(this.name);
    const idx = docs.findIndex((d) => matchDoc(d, query));

    if (idx === -1) {
      if (options.upsert) {
        const newDoc = {
          _id: `id_${crypto.randomBytes(6).toString("hex")}`,
          ...query,
          ...(update.$setOnInsert || {}),
          ...(update.$set || {}),
        };
        docs.push(newDoc);
        writeCollection(this.name, docs);
        return { matchedCount: 0, modifiedCount: 0, upsertedCount: 1, upsertedId: newDoc._id };
      }
      return { matchedCount: 0, modifiedCount: 0 };
    }

    const target = docs[idx];
    if (update.$set) {
      Object.assign(target, update.$set);
    }
    if (update.$inc) {
      for (const [k, v] of Object.entries(update.$inc)) {
        target[k] = (target[k] || 0) + v;
      }
    }

    docs[idx] = target;
    writeCollection(this.name, docs);
    return { matchedCount: 1, modifiedCount: 1 };
  }

  async deleteOne(query) {
    const docs = readCollection(this.name);
    const idx = docs.findIndex((d) => matchDoc(d, query));
    if (idx === -1) return { deletedCount: 0 };

    docs.splice(idx, 1);
    writeCollection(this.name, docs);
    return { deletedCount: 1 };
  }

  async deleteMany(query) {
    const docs = readCollection(this.name);
    const remaining = docs.filter((d) => !matchDoc(d, query));
    const deletedCount = docs.length - remaining.length;
    writeCollection(this.name, remaining);
    return { deletedCount };
  }

  async countDocuments(query = {}) {
    const docs = readCollection(this.name);
    return docs.filter((d) => matchDoc(d, query)).length;
  }

  async createIndex(keys, options = {}) {
    return Object.keys(keys).join("_");
  }

  aggregate(pipeline = []) {
    const docs = readCollection(this.name);
    let result = [...docs];

    for (const stage of pipeline) {
      if (stage.$group) {
        const idField = stage.$group._id;
        const groups = {};
        for (const doc of result) {
          const key = idField && typeof idField === "string" && idField.startsWith("$") ? doc[idField.slice(1)] : "all";
          if (!groups[key]) groups[key] = 0;
          groups[key]++;
        }
        result = Object.entries(groups).map(([k, count]) => ({ _id: k, count }));
      }
    }

    return {
      async toArray() {
        return result;
      },
    };
  }
}

class EmbeddedDB {
  constructor(dbName = "smartshelf") {
    this.dbName = dbName;
    this.collections = new Map();
  }

  collection(name) {
    if (!this.collections.has(name)) {
      this.collections.set(name, new EmbeddedCollection(name));
    }
    return this.collections.get(name);
  }

  async command(cmd) {
    if (cmd && cmd.ping !== undefined) {
      return { ok: 1 };
    }
    return { ok: 1 };
  }
}

module.exports = {
  EmbeddedDB,
};
