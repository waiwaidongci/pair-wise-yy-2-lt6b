// 存储层：只负责数据持久化，不含业务规则
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, "..", "data");
const dbPath = join(dataDir, "pigeons.json");

// 全新安装时的初始数据（已是第二版结构）
function seedPigeons() {
  return [
    {
      ringNo: "CHN-2026-001", owner: "北岸棚", fatherRing: "CHN-2022-188", motherRing: "CHN-2023-512",
      color: "灰", loft: "北岸A棚", version: 1, attribution: "北岸棚", descendants: [],
      vaccines: [{ date: "2026-04-01", name: "新城疫" }],
      transfers: [{ date: "2026-04-15", from: "育种棚", to: "北岸棚" }],
      races: [{ date: "2026-06-01", event: "120公里训放", distance: 120, returnTime: "10:42", rank: 18 }]
    },
    {
      ringNo: "CHN-2022-188", owner: "育种棚", fatherRing: "", motherRing: "",
      color: "雨点", loft: "种鸽棚", version: 1, attribution: "育种棚", descendants: [],
      vaccines: [], transfers: [], races: []
    },
    {
      ringNo: "CHN-2023-512", owner: "育种棚", fatherRing: "", motherRing: "",
      color: "红轮", loft: "种鸽棚", version: 1, attribution: "育种棚", descendants: [],
      vaccines: [], transfers: [], races: []
    }
  ];
}

export function defaultDb() {
  return {
    schemaVersion: 2,
    pigeons: seedPigeons(),
    batches: [],
    pending: []
  };
}

export async function loadDb() {
  if (!existsSync(dbPath)) {
    await mkdir(dataDir, { recursive: true });
    const db = defaultDb();
    await writeFile(dbPath, JSON.stringify(db, null, 2));
    return db;
  }
  const raw = await readFile(dbPath, "utf8");
  const db = JSON.parse(raw);
  if (!Array.isArray(db.pigeons)) db.pigeons = [];
  if (!Array.isArray(db.batches)) db.batches = [];
  if (!Array.isArray(db.pending)) db.pending = [];
  return db;
}

export async function saveDb(db) {
  await writeFile(dbPath, JSON.stringify(db, null, 2));
}
