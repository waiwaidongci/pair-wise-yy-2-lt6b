// 规则层：纯业务逻辑，不涉及存储与接口入口
// 所有函数接收 db 对象，返回 { ok:true, ... } 或 { ok:false, error, reason, ... }

// ---------- 内部工具 ----------
function findPigeon(db, ringNo) {
  return db.pigeons.find(item => item.ringNo === ringNo) || null;
}

// 稳定序列化：对象按键排序，避免键顺序不同导致指纹不一致
function stableStringify(value) {
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]";
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return "{" + keys.map(k => JSON.stringify(k) + ":" + stableStringify(value[k])).join(",") + "}";
  }
  return JSON.stringify(value);
}

// ringNo 是否为 ancestorRing 的祖先（即 ancestorRing 是否为 ringNo 的后代）
// 迭代遍历，自带 seen，血统成环时也不会死循环
function isAncestor(db, ancestorRing, ringNo) {
  if (!ancestorRing || !ringNo) return false;
  const seen = new Set();
  const stack = [ringNo];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || seen.has(cur)) continue;
    if (cur === ancestorRing) return true;
    seen.add(cur);
    const p = findPigeon(db, cur);
    if (p) {
      if (p.fatherRing) stack.push(p.fatherRing);
      if (p.motherRing) stack.push(p.motherRing);
    }
  }
  return false;
}

// ---------- 血统 ----------
// 计算某鸽的完整后代标记（子代、孙代……全部后代）
export function descendantsOf(db, ringNo) {
  const result = [];
  const seen = new Set([ringNo]);
  const queue = [ringNo];
  while (queue.length) {
    const cur = queue.shift();
    for (const c of db.pigeons) {
      if (c.fatherRing === cur || c.motherRing === cur) {
        if (!seen.has(c.ringNo)) {
          seen.add(c.ringNo);
          result.push(c.ringNo);
          queue.push(c.ringNo);
        }
      }
    }
  }
  return result;
}

// 血统关系改动后，重算所有鸽只的完整后代标记
export function recomputeAllDescendants(db) {
  for (const p of db.pigeons) {
    p.descendants = descendantsOf(db, p.ringNo);
  }
}

// 把 ringNo 的父/母设为 fatherRing/motherRing，会否绕成祖先（形成循环）
export function pedigreeCycle(db, ringNo, fatherRing, motherRing) {
  if (fatherRing && (fatherRing === ringNo || isAncestor(db, ringNo, fatherRing))) return true;
  if (motherRing && (motherRing === ringNo || isAncestor(db, ringNo, motherRing))) return true;
  return false;
}

export function getRelation(db, ringNo) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return null;
  const father = findPigeon(db, pigeon.fatherRing);
  const mother = findPigeon(db, pigeon.motherRing);
  const children = db.pigeons.filter(p => p.fatherRing === ringNo || p.motherRing === ringNo);
  return { pigeon, father, mother, children, descendants: pigeon.descendants || [] };
}

// ---------- 鸽只 ----------
export function createPigeon(db, input) {
  if (findPigeon(db, input.ringNo)) {
    return { ok: false, error: "ring_exists", reason: "足环号已存在" };
  }
  const pigeon = {
    ringNo: input.ringNo,
    owner: input.owner,
    fatherRing: input.fatherRing || "",
    motherRing: input.motherRing || "",
    color: input.color || "",
    loft: input.loft || "",
    version: 1,
    attribution: input.owner, // 最初归属
    descendants: [],
    vaccines: [],
    transfers: [],
    races: []
  };
  db.pigeons.unshift(pigeon);
  recomputeAllDescendants(db);
  return { ok: true, pigeon };
}

// 乐观并发：clientVersion 与库内版本不一致即落败，返回归属版本与失败原因
function checkVersion(pigeon, clientVersion) {
  if (clientVersion == null || clientVersion === "") return null;
  if (Number(clientVersion) === pigeon.version) return null;
  return {
    ok: false,
    error: "version_conflict",
    reason: "归属版本已变更，操作未生效",
    current: { version: pigeon.version, owner: pigeon.owner, loft: pigeon.loft }
  };
}

export function applyTransfer(db, ringNo, input) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return { ok: false, error: "pigeon_not_found", reason: "鸽只不存在" };
  const conflict = checkVersion(pigeon, input.clientVersion);
  if (conflict) return conflict;
  const transfer = {
    date: input.date || new Date().toISOString().slice(0, 10),
    from: pigeon.owner,
    to: input.to,
    operator: input.operator || "",
    batchId: input.batchId || ""
  };
  pigeon.owner = input.to;
  if (input.loft) pigeon.loft = input.loft;
  pigeon.transfers.push(transfer);
  pigeon.version += 1;
  return { ok: true, pigeon, transfer };
}

export function applyVaccine(db, ringNo, input) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return { ok: false, error: "pigeon_not_found", reason: "鸽只不存在" };
  const conflict = checkVersion(pigeon, input.clientVersion);
  if (conflict) return conflict;
  const vaccine = {
    date: input.date || new Date().toISOString().slice(0, 10),
    name: input.name,
    operator: input.operator || "",
    batchId: input.batchId || ""
  };
  pigeon.vaccines.push(vaccine);
  pigeon.version += 1;
  return { ok: true, pigeon, vaccine };
}

export function applyRace(db, ringNo, input) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return { ok: false, error: "pigeon_not_found", reason: "鸽只不存在" };
  const conflict = checkVersion(pigeon, input.clientVersion);
  if (conflict) return conflict;
  const race = {
    date: input.date || new Date().toISOString().slice(0, 10),
    event: input.event,
    distance: Number(input.distance || 0),
    returnTime: input.returnTime || "",
    rank: Number(input.rank || 0),
    operator: input.operator || "",
    batchId: input.batchId || ""
  };
  pigeon.races.push(race);
  pigeon.version += 1;
  return { ok: true, pigeon, race };
}

// 血统关系改动：先校验不能绕成祖先，通过后重算完整后代标记
export function setParents(db, ringNo, input) {
  const pigeon = findPigeon(db, ringNo);
  if (!pigeon) return { ok: false, error: "pigeon_not_found", reason: "鸽只不存在" };
  const conflict = checkVersion(pigeon, input.clientVersion);
  if (conflict) return conflict;
  const fatherRing = input.fatherRing != null ? input.fatherRing : pigeon.fatherRing;
  const motherRing = input.motherRing != null ? input.motherRing : pigeon.motherRing;
  if (pedigreeCycle(db, ringNo, fatherRing, motherRing)) {
    return {
      ok: false,
      error: "pedigree_cycle",
      reason: "血统关系不能绕成祖先：该父母会形成循环",
      current: { version: pigeon.version }
    };
  }
  pigeon.fatherRing = fatherRing;
  pigeon.motherRing = motherRing;
  pigeon.version += 1;
  recomputeAllDescendants(db);
  return { ok: true, pigeon };
}

// ---------- 离线批次合并 ----------
function applyItem(db, item) {
  const input = {
    ...(item.payload || {}),
    clientVersion: item.clientVersion,
    operator: item.operator,
    batchId: item.batchId
  };
  if (item.type === "transfer") return applyTransfer(db, item.ringNo, input);
  if (item.type === "vaccine") return applyVaccine(db, item.ringNo, input);
  if (item.type === "race") return applyRace(db, item.ringNo, input);
  return { ok: false, error: "unknown_item_type", reason: "未知批次项类型" };
}

// 回站合并离线批次
// - 同批次重传且内容一致：沿用首次结果，不重复入库
// - 同批次但内容变了：列待核对，不覆盖已入库资料
export function mergeBatch(db, batch) {
  const batchId = batch.batchId;
  const items = Array.isArray(batch.items) ? batch.items : [];
  const existing = db.batches.find(b => b.batchId === batchId);

  if (existing) {
    if (stableStringify(existing.items) === stableStringify(items)) {
      return { ok: true, replayed: true, batch: existing, result: existing.result };
    }
    // 内容变更 → 待核对，不动已入库资料
    const pending = {
      id: "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 8),
      batchId,
      reason: "content_changed",
      firstResult: existing.result,
      firstItems: existing.items,
      attemptedItems: items,
      createdAt: new Date().toISOString(),
      status: "open"
    };
    db.pending.push(pending);
    return {
      ok: false,
      replayed: false,
      error: "content_changed",
      reason: "批次内容与首次提交不一致，已列待核对，未覆盖已入库资料",
      pendingId: pending.id,
      firstResult: existing.result
    };
  }

  // 新批次：逐项套用，记录首次结果
  const result = { applied: [], conflicts: [] };
  for (const item of items) {
    const r = applyItem(db, item);
    if (r.ok) {
      result.applied.push({ type: item.type, ringNo: item.ringNo, version: r.pigeon.version });
    } else {
      result.conflicts.push({
        type: item.type, ringNo: item.ringNo,
        error: r.error, reason: r.reason, current: r.current || null
      });
    }
  }
  const record = {
    batchId,
    source: batch.source || "offline",
    operator: batch.operator || "",
    createdAt: new Date().toISOString(),
    items,
    result
  };
  db.batches.push(record);
  return { ok: true, replayed: false, batch: record, result };
}

// 待核对项处理：accept_first 维持首次结果，rejected 驳回
export function resolvePending(db, pendingId, action) {
  const item = db.pending.find(p => p.id === pendingId);
  if (!item) return { ok: false, error: "pending_not_found", reason: "待核对项不存在" };
  if (item.status !== "open") return { ok: false, error: "already_resolved", reason: "该待核对项已处理" };
  item.status = action === "accept_first" ? "resolved_first" : "rejected";
  item.resolvedAt = new Date().toISOString();
  return { ok: true, pending: item };
}

// ---------- 旧数据升级 ----------
// 旧数据没有 version/attribution，按最初归属补成第一版，并重算后代标记
export function migrate(db) {
  let changed = false;
  for (const p of db.pigeons) {
    if (p.version == null) {
      p.version = 1;
      p.attribution = p.owner; // 按最初归属补成第一版
      changed = true;
    }
    if (!Array.isArray(p.vaccines)) p.vaccines = [];
    if (!Array.isArray(p.transfers)) p.transfers = [];
    if (!Array.isArray(p.races)) p.races = [];
    if (!Array.isArray(p.descendants)) p.descendants = [];
    if (p.attribution == null) p.attribution = p.owner;
  }
  if (changed) {
    db.schemaVersion = 2;
    db.migratedAt = new Date().toISOString();
  }
  recomputeAllDescendants(db);
  return changed;
}
