import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rm } from "node:fs/promises";
import http from "node:http";
import { JsonStore } from "../src/store/json-store.js";
import { createService } from "../src/service.js";
import { createRouter } from "../src/api/router.js";
import { migrate } from "../src/rules/migration.js";
import {
  isLineageComplete, recalcLineageFlags, setLineage, ancestorRings
} from "../src/rules/lineage.js";

let server, baseUrl, store, dbFile;

async function setup() {
  dbFile = join(tmpdir(), `pigeon-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  store = new JsonStore(dbFile);
  await store.init();
  const service = createService(store);
  server = http.createServer(createRouter(service));
  await new Promise(resolve => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
}

async function teardown() {
  await new Promise(resolve => server.close(resolve));
  await rm(dbFile, { force: true });
}

async function req(method, path, body) {
  const res = await fetch(baseUrl + path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined
  });
  const json = await res.json();
  return { status: res.status, json };
}

test.beforeEach(setup);
test.afterEach(teardown);

// ---------- 离线批次：首次合并、重传沿用、变更待核对 ----------

test("离线批次：回站后把转棚/疫苗/成绩合并进鸽只档案", async () => {
  const r = await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-1", deviceId: "LOFT-A",
    items: [
      { clientItemId: "t1", type: "transfer", ringNo: "CHN-2026-001", payload: { to: "南湾棚", expectedVersion: 2 } },
      { clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { date: "2026-09-30", name: "禽流感" } },
      { clientItemId: "r1", type: "race", ringNo: "CHN-2026-001", payload: { date: "2026-09-28", event: "300公里赛", distance: 300, rank: 6 } }
    ]
  });
  assert.equal(r.status, 200);
  assert.equal(r.json.changed, false);
  assert.deepEqual(r.json.batch.items.map(i => i.outcome), ["applied", "applied", "applied"]);

  const { json: pigeon } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.equal(pigeon.owner, "南湾棚");
  assert.equal(pigeon.ownerVersion, 3);
  assert.equal(pigeon.vaccines.at(-1).name, "禽流感");
  assert.equal(pigeon.vaccines.at(-1).batchId, "B-TEST-1");
  assert.equal(pigeon.races.at(-1).event, "300公里赛");
});

test("离线批次：同 batchId 原样重传沿用首次结果，不重复写库", async () => {
  const payload = {
    batchId: "B-TEST-2",
    items: [{ clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { date: "2026-09-30", name: "禽流感" } }]
  };
  await req("POST", "/api/offline-batches", payload);
  const again = await req("POST", "/api/offline-batches", payload);
  assert.equal(again.json.replayed, true);
  assert.equal(again.json.changed, false);
  // 沿用首次结果对象：疫苗只有一条，没有第二条
  const { json: pigeon } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.equal(pigeon.vaccines.filter(v => v.name === "禽流感").length, 1);
  assert.equal(again.json.batch.items[0].outcome, "applied");
});

test("离线批次：键顺序不同但内容一致也算同批次重传", async () => {
  const first = { batchId: "B-TEST-3", items: [
    { clientItemId: "x", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "巴拉米哥", date: "2026-10-01" } }
  ] };
  await req("POST", "/api/offline-batches", first);
  const second = { batchId: "B-TEST-3", items: [
    { clientItemId: "x", payload: { date: "2026-10-01", name: "巴拉米哥" }, ringNo: "CHN-2026-001", type: "vaccine" }
  ] };
  const r = await req("POST", "/api/offline-batches", second);
  assert.equal(r.json.changed, false);
  assert.equal(r.json.replayed, true);
});

test("离线批次：条目数组顺序不同但内容一致也沿用首次结果", async () => {
  const first = { batchId: "B-TEST-3B", items: [
    { clientItemId: "a", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗A" } },
    { clientItemId: "b", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗B" } }
  ] };
  await req("POST", "/api/offline-batches", first);
  const reordered = { batchId: "B-TEST-3B", items: [first.items[1], first.items[0]] };
  const r = await req("POST", "/api/offline-batches", reordered);
  assert.equal(r.json.changed, false);
  assert.equal(r.json.replayed, true);
});

test("离线批次：内容变了列入待核对，不覆盖已入库资料", async () => {
  await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-4",
    items: [{ clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { date: "2026-09-30", name: "禽流感" } }]
  });
  const changed = await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-4",
    items: [{ clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { date: "2026-09-30", name: "腺病毒（改）" } }]
  });
  assert.equal(changed.json.changed, true);
  assert.equal(changed.json.batch.status, "needs_review");
  assert.equal(changed.json.reviews.length, 1);
  assert.equal(changed.json.reviews[0].kind, "changed_item");

  // 已入库的仍是首次内容
  const { json: pigeon } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.ok(pigeon.vaccines.some(v => v.name === "禽流感"));
  assert.ok(!pigeon.vaccines.some(v => v.name === "腺病毒（改）"));

  // 首次结果仍可在批次记录里读到
  const batch = changed.json.batch;
  assert.equal(batch.items[0].result.applied.name, "禽流感");

  // 待核对接受后才按新内容实时入库
  const reviews = await req("GET", "/api/reviews");
  const accept = await req("POST", `/api/reviews/${reviews.json[0].id}/resolve`, { action: "accept" });
  assert.equal(accept.status, 200);
  assert.equal(accept.json.resolution.outcome, "applied");
  const { json: after } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.ok(after.vaccines.some(v => v.name === "禽流感"));        // 首次资料保留
  assert.ok(after.vaccines.some(v => v.name === "腺病毒（改）"));  // 追加而非覆盖
});

test("离线批次：新增/删除条目也进待核对", async () => {
  await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-5",
    items: [
      { clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗A" } },
      { clientItemId: "v2", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗B" } }
    ]
  });
  const changed = await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-5",
    items: [
      { clientItemId: "v1", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗A" } },
      { clientItemId: "v3", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "疫苗C" } }
    ]
  });
  const kinds = changed.json.reviews.map(r => r.kind).sort();
  assert.deepEqual(kinds, ["added_item", "removed_item"]);
});

test("离线批次：条目级失败不拖垮整批，冲突结果可读", async () => {
  const r = await req("POST", "/api/offline-batches", {
    batchId: "B-TEST-6",
    items: [
      { clientItemId: "bad-ring", type: "vaccine", ringNo: "CHN-NOPE", payload: { name: "X" } },
      { clientItemId: "bad-type", type: "deworm", ringNo: "CHN-2026-001", payload: {} },
      { clientItemId: "good", type: "vaccine", ringNo: "CHN-2026-001", payload: { name: "好疫苗" } }
    ]
  });
  assert.deepEqual(r.json.batch.items.map(i => i.outcome), ["error", "error", "applied"]);
});

// ---------- 转棚乐观并发 ----------

test("转棚：两人同时提交同一只鸽，只有一笔生效，落败方读到归属版本与原因", async () => {
  const a = await req("POST", "/api/pigeons/CHN-2026-001/transfers", { to: "南湾棚", expectedVersion: 2 });
  assert.equal(a.status, 200);
  assert.equal(a.json.applied.version, 3);

  const b = await req("POST", "/api/pigeons/CHN-2026-001/transfers", { to: "西岭棚", expectedVersion: 2 });
  assert.equal(b.status, 409);
  assert.equal(b.json.error, "transfer_conflict");
  assert.equal(b.json.reason, "version_mismatch");
  assert.equal(b.json.ownerVersion, 3);      // 读到生效的归属版本
  assert.equal(b.json.owner, "南湾棚");       // 读到当前归属
  assert.equal(b.json.submittedVersion, 2);

  const { json: pigeon } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.equal(pigeon.owner, "南湾棚");
  assert.equal(pigeon.transfers.filter(t => t.version === 3).length, 1);
});

test("转棚：离线批次中落败的一笔同样返回归属版本与失败原因，后续不生效", async () => {
  await req("POST", "/api/pigeons/CHN-2026-001/transfers", { to: "南湾棚", expectedVersion: 2 });
  const r = await req("POST", "/api/offline-batches", {
    batchId: "B-RACE",
    items: [{ clientItemId: "late", type: "transfer", ringNo: "CHN-2026-001", payload: { to: "西岭棚", expectedVersion: 2 } }]
  });
  const item = r.json.batch.items[0];
  assert.equal(item.outcome, "conflict");
  assert.equal(item.result.reason, "version_mismatch");
  assert.equal(item.result.ownerVersion, 3);
  assert.equal(item.result.owner, "南湾棚");
  const { json: pigeon } = await req("GET", "/api/pigeons/CHN-2026-001");
  assert.equal(pigeon.owner, "南湾棚");
});

test("转棚：无版本号的直接录入仍可工作（人工录入场景）", async () => {
  const r = await req("POST", "/api/pigeons/CHN-2026-001/transfers", { to: "东河棚" });
  assert.equal(r.status, 200);
  assert.equal(r.json.pigeon.ownerVersion, 3);
});

// ---------- 血缘环检测与后代重算 ----------

function dbWith(pigeons) {
  return {
    version: 2,
    pigeons,
    batches: [],
    reviews: []
  };
}

test("血统：父子关系不能绕成祖先（直接自环与多代环都拒绝）", () => {
  const db = dbWith([
    { ringNo: "A", fatherRing: "", motherRing: "", owner: "x", firstOwner: "x", ownerVersion: 1, transfers: [], vaccines: [], races: [] },
    { ringNo: "B", fatherRing: "A", motherRing: "", owner: "x", firstOwner: "x", ownerVersion: 1, transfers: [], vaccines: [], races: [] },
    { ringNo: "C", fatherRing: "B", motherRing: "", owner: "x", firstOwner: "x", ownerVersion: 1, transfers: [], vaccines: [], races: [] }
  ]);
  // A -> B -> C 已成立；试图让 C 成为 A 的父亲会成环 A→B→C→A
  assert.throws(() => setLineage(db, "A", { fatherRing: "C" }), /lineage_cycle|后代/);
  // 自环
  assert.throws(() => setLineage(db, "B", { fatherRing: "B" }), /lineage_cycle/);
  // 同父同母
  assert.throws(() => setLineage(db, "C", { fatherRing: "B", motherRing: "B" }), /lineage_cycle|同一只鸽/);
  // 合法改动放行
  const ok = setLineage(db, "C", { motherRing: "A" });
  assert.equal(ok.pigeon.motherRing, "A");
});

test("血统：改动后向下重算后代完整标记", () => {
  const make = ringNo => ({ ringNo, fatherRing: "", motherRing: "", owner: "x", firstOwner: "x", ownerVersion: 1, transfers: [], vaccines: [], races: [], lineageComplete: false });
  const gf = make("GF"), gm = make("GM"), f = make("F"), m = make("M"), child = make("K");
  const db = dbWith([child, f, m, gf, gm]);

  // F 的父母档案齐全；M 挂未登记环号 → M 断档
  setLineage(db, "F", { fatherRing: "GF", motherRing: "GM" });
  setLineage(db, "M", { fatherRing: "GHOST-MF" });
  assert.equal(isLineageComplete(db, "F"), true);
  assert.equal(isLineageComplete(db, "M"), false);

  // K 把 F、M 挂为父母：经 M 的悬空引用，K 也不完整
  setLineage(db, "K", { fatherRing: "F", motherRing: "M" });
  assert.equal(isLineageComplete(db, "K"), false);
  assert.equal(db.pigeons.find(p => p.ringNo === "K").lineageComplete, false);

  // 给 M 补上父亲档案并改挂已登记环号，M 与其后代 K 向下重算为完整
  const mf = make("MF");
  db.pigeons.push(mf);
  setLineage(db, "M", { fatherRing: "MF" });
  assert.equal(db.pigeons.find(p => p.ringNo === "M").lineageComplete, true);
  assert.equal(db.pigeons.find(p => p.ringNo === "K").lineageComplete, true);
  assert.equal(db.pigeons.find(p => p.ringNo === "F").lineageComplete, true);
});

test("血统：悬空足环号先登记，档案补录后重算可变完整", () => {
  const make = ringNo => ({ ringNo, fatherRing: "", motherRing: "", owner: "x", firstOwner: "x", ownerVersion: 1, transfers: [], vaccines: [], races: [], lineageComplete: false });
  const child = make("K"), f = make("F"), m = make("M");
  const db = dbWith([child, f, m]);
  setLineage(db, "K", { fatherRing: "F", motherRing: "M" });
  assert.equal(ancestorRings(db, "K").has("F"), true);
  assert.equal(isLineageComplete(db, "K"), true); // 父母档案都在、无悬空引用即完整
  // F 挂一个未登记环号：F 与其子 K 都变成不完整
  setLineage(db, "F", { fatherRing: "GHOST" });
  assert.equal(isLineageComplete(db, "F"), false);
  assert.equal(isLineageComplete(db, "K"), false);
  // 补录该祖先档案并重新计算，父子两代恢复完整
  db.pigeons.push(make("GHOST"));
  recalcLineageFlags(db, "GHOST");
  assert.equal(isLineageComplete(db, "F"), true);
  assert.equal(isLineageComplete(db, "K"), true);
});

test("血缘接口：环关系改动经 HTTP 生效并重算；成环返回 400", async () => {
  await req("POST", "/api/pigeons", { ringNo: "A", owner: "x", color: "灰", loft: "棚" });
  await req("POST", "/api/pigeons", { ringNo: "B", owner: "x", color: "灰", loft: "棚" });
  const ok = await req("PATCH", "/api/pigeons/B/lineage", { fatherRing: "A" });
  assert.equal(ok.status, 200);
  const cyc = await req("PATCH", "/api/pigeons/A/lineage", { fatherRing: "B" });
  assert.equal(cyc.status, 400);
  assert.equal(cyc.json.error, "lineage_cycle");
});

// ---------- 旧数据升级 ----------

test("旧数据升级：按最初归属补成第一版，历史转棚逐条补版本号", () => {
  const legacy = {
    pigeons: [
      { ringNo: "P1", owner: "丙棚", fatherRing: "", motherRing: "", color: "灰", loft: "L",
        vaccines: [],
        transfers: [
          { date: "2026-01-01", from: "甲棚", to: "乙棚" },
          { date: "2026-02-01", from: "乙棚", to: "丙棚" }
        ],
        races: [] },
      { ringNo: "P2", owner: "原棚", fatherRing: "", motherRing: "", color: "雨点", loft: "L",
        vaccines: [{ date: "2026-03-01", name: "新城疫" }], transfers: [], races: [] }
    ]
  };
  const { db, upgradedFrom } = migrate(legacy);
  assert.equal(upgradedFrom, 1);
  assert.equal(db.version, 2);
  const p1 = db.pigeons.find(p => p.ringNo === "P1");
  assert.equal(p1.firstOwner, "甲棚");       // 最初归属 = 最早转棚的来源
  assert.equal(p1.ownerVersion, 3);
  assert.deepEqual(p1.transfers.map(t => t.version), [2, 3]);
  const p2 = db.pigeons.find(p => p.ringNo === "P2");
  assert.equal(p2.firstOwner, "原棚");       // 没有转棚：当前归属即最初归属 v1
  assert.equal(p2.ownerVersion, 1);
  assert.equal("lineageComplete" in p2, true);
});

test("旧数据升级幂等：重复升级不改变版本", () => {
  const once = migrate({ pigeons: [{ ringNo: "P", owner: "甲", transfers: [{ from: "甲", to: "乙" }], races: [], vaccines: [] }] }).db;
  const ownerVersion = once.pigeons[0].ownerVersion;
  const twice = migrate(once).db;
  assert.equal(twice.pigeons[0].ownerVersion, ownerVersion);
  assert.equal(twice.pigeons[0].transfers[0].version, 2);
});

test("存储层：v1 数据文件首次加载即被升级落盘", async () => {
  const file = join(tmpdir(), `pigeon-legacy-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(file, JSON.stringify({
    pigeons: [
      { ringNo: "OLD-1", owner: "乙棚", fatherRing: "", motherRing: "", color: "灰", loft: "L",
        vaccines: [], transfers: [{ date: "2026-05-01", from: "甲棚", to: "乙棚" }], races: [] }
    ]
  }));
  const legacyStore = new JsonStore(file);
  await legacyStore.init();
  const p = legacyStore.read().pigeons.find(x => x.ringNo === "OLD-1");
  assert.equal(p.firstOwner, "甲棚");
  assert.equal(p.ownerVersion, 2);
  assert.equal(p.transfers[0].version, 2);
  assert.equal(Array.isArray(legacyStore.read().reviews), true);
  // 落盘后重新加载，升级幂等
  const again = new JsonStore(file);
  await again.init();
  assert.equal(again.read().pigeons[0].ownerVersion, 2);
  await rm(file, { force: true });
});

test("页面：GET / 返回离线批次入口页面", async () => {
  const res = await fetch(baseUrl + "/");
  assert.equal(res.status, 200);
  const html = await res.text();
  assert.ok(html.includes("离线批次"));
  assert.ok(html.includes("待核对"));
});
