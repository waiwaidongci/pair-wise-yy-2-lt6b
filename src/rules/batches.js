import { contentHash, newBatchId } from "./ids.js";
import { getPigeon } from "./lineage.js";
import { transferOwnership } from "./ownership.js";
import { applyVaccine, applyRace } from "./pigeons.js";
import { RuleError } from "./errors.js";

export const BATCH_TYPES = new Set(["transfer", "vaccine", "race"]);

export function itemKey(item, index) {
  return item.clientItemId || `#${index}`;
}

/** 参与比对的条目内容；clientItemId 等传输字段不参与。 */
export function itemContent(item) {
  return { type: item.type, ringNo: item.ringNo, payload: item.payload || {} };
}

export function itemHash(item) {
  return contentHash(itemContent(item));
}

/**
 * 把单条离线条目落到档案上。不抛异常：任何规则失败都转成条目级结果，
 * 避免一条坏数据拖垮整个回站合并。
 */
export function processItem(db, item, { batchId = null, live = false } = {}) {
  const { type, ringNo, payload = {} } = item;
  try {
    if (!BATCH_TYPES.has(type)) return { outcome: "error", result: { reason: "unknown_type", type } };
    if (!ringNo || !getPigeon(db, ringNo)) return { outcome: "error", result: { reason: "pigeon_not_found", ringNo } };
    if (type === "transfer") {
      const { pigeon, applied } = transferOwnership(db, ringNo, { ...payload, batchId: batchId || undefined });
      return {
        outcome: "applied",
        result: { applied, owner: pigeon.owner, ownerVersion: pigeon.ownerVersion, live }
      };
    }
    if (type === "vaccine") {
      const r = applyVaccine(db, ringNo, { ...payload, batchId: batchId || undefined });
      return r.duplicated
        ? { outcome: "duplicate", result: { reason: "already_applied_in_batch", batchId }, live }
        : { outcome: "applied", result: { applied: r.applied, live } };
    }
    const r = applyRace(db, ringNo, { ...payload, batchId: batchId || undefined });
    return r.duplicated
      ? { outcome: "duplicate", result: { reason: "already_applied_in_batch", batchId }, live }
      : { outcome: "applied", result: { applied: r.applied, live } };
  } catch (error) {
    if (error.code === "transfer_conflict") {
      return {
        outcome: "conflict",
        result: {
          reason: error.reason,
          message: error.message,
          owner: error.owner,
          ownerVersion: error.ownerVersion,
          submittedVersion: error.submittedVersion,
          submittedOwner: error.submittedOwner
        }
      };
    }
    return { outcome: "error", result: { reason: error.code || "rule_error", message: error.message } };
  }
}

function normalizeItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new RuleError("invalid_batch", "离线批次至少包含一条记录", { status: 400 });
  }
  const seenKeys = new Set();
  return items.map((raw, index) => {
    const key = itemKey(raw, index);
    if (seenKeys.has(key)) throw new RuleError("invalid_batch", `批次内条目键重复：${key}`, { status: 400 });
    seenKeys.add(key);
    return { key, type: raw.type, ringNo: raw.ringNo, payload: raw.payload || {}, hash: itemHash(raw) };
  });
}

function pushReview(db, entry) {
  const id = "R-" + (db.reviews.length + 1) + "-" + Date.now().toString(36);
  const review = { id, status: "pending", createdAt: new Date().toISOString(), ...entry };
  db.reviews.unshift(review);
  return review;
}

/** 批次整体内容：按条目键排序，与条目顺序无关，只看内容本身。 */
function batchHash(items) {
  const sorted = items
    .map(({ key, type, ringNo, payload }) => ({ key, type, ringNo, payload }))
    .sort((a, b) => a.key.localeCompare(b.key));
  return contentHash(sorted);
}

/**
 * 回站提交离线批次。
 * - 首次提交：逐条合并，结果随批次存档；
 * - 同 batchId 重传且内容一致：沿用首次结果，不重复写库；
 * - 内容变化：变更/新增/删除的条目列入待核对，首次结果与已入库资料原样保留。
 */
export function submitBatch(db, input = {}, { now = new Date() } = {}) {
  const incoming = normalizeItems(input.items);
  const batchId = input.batchId || newBatchId();
  const existing = db.batches.find(batch => batch.batchId === batchId);

  if (!existing) {
    const storedItems = incoming.map(item => {
      const { outcome, result } = processItem(db, item, { batchId });
      return { ...item, outcome, result };
    });
    const batch = {
      batchId,
      deviceId: input.deviceId || "",
      recordedAt: input.recordedAt || null,
      mergedAt: now.toISOString(),
      status: "merged",
      hash: batchHash(incoming),
      items: storedItems
    };
    db.batches.unshift(batch);
    return { batch, replayed: false, changed: false, reviews: [] };
  }

  // 重传：先比对整体内容（与条目顺序无关），完全一致直接沿用首次结果。
  const sameHash = existing.hash === batchHash(incoming);
  if (sameHash) {
    return { batch: existing, replayed: true, changed: false, reviews: [] };
  }

  const firstByKey = new Map(existing.items.map(item => [item.key, item]));
  const latestByKey = new Map(incoming.map(item => [item.key, item]));
  const reviews = [];

  for (const latest of incoming) {
    const first = firstByKey.get(latest.key);
    if (!first) {
      // 新增条目不自动入库，先核对。
      reviews.push(pushReview(db, {
        batchId,
        itemKey: latest.key,
        kind: "added_item",
        ringNo: latest.ringNo,
        type: latest.type,
        firstPayload: null,
        latestPayload: latest.payload
      }));
    } else if (first.hash !== latest.hash) {
      // 内容变了：保留首次结果，列入待核对，绝不覆盖已入库资料。
      reviews.push(pushReview(db, {
        batchId,
        itemKey: latest.key,
        kind: "changed_item",
        ringNo: latest.ringNo,
        type: latest.type,
        firstPayload: first.payload,
        firstResult: first.result,
        latestPayload: latest.payload
      }));
    }
  }
  for (const first of existing.items) {
    if (!latestByKey.has(first.key)) {
      // 条目被删掉也只做核对登记——疫苗/成绩/转棚都是只追加资料，不回滚。
      reviews.push(pushReview(db, {
        batchId,
        itemKey: first.key,
        kind: "removed_item",
        ringNo: first.ringNo,
        type: first.type,
        firstPayload: first.payload,
        firstResult: first.result,
        latestPayload: null
      }));
    }
  }

  existing.status = "needs_review";
  existing.resentAt = now.toISOString();
  return { batch: existing, replayed: true, changed: true, reviews };
}

/** 待核对条目处理：接受则按最新内容走一次实时入库；拒绝则仅关闭工单。 */
export function resolveReview(db, reviewId, { action } = {}) {
  const review = db.reviews.find(item => item.id === reviewId);
  if (!review) throw new RuleError("review_not_found", "待核对记录不存在", { status: 404 });
  if (review.status !== "pending") throw new RuleError("review_closed", "该核对工单已处理", { status: 409 });
  if (action === "reject") {
    review.status = "rejected";
    review.resolvedAt = new Date().toISOString();
    return { review, resolution: { outcome: "rejected" } };
  }
  if (action !== "accept") throw new RuleError("invalid_action", "action 只能是 accept 或 reject", { status: 400 });

  let resolution;
  if (review.kind === "removed_item") {
    // 转棚/疫苗/成绩只追加，接受删除也不抹除已入库资料，只记录确认。
    resolution = { outcome: "acknowledged", note: "append_only_data_not_removed" };
  } else {
    const item = { type: review.type, ringNo: review.ringNo, payload: review.latestPayload };
    resolution = processItem(db, item, { batchId: review.batchId, live: true });
  }
  review.status = "accepted";
  review.resolvedAt = new Date().toISOString();
  review.resolution = resolution;
  return { review, resolution };
}
