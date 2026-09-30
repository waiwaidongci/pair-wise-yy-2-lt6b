import { RuleError } from "./errors.js";
import { getPigeon } from "./lineage.js";

export function today(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

/**
 * 转棚（改变归属）。归属是版本化资源：
 * - expectedVersion 实现乐观并发，两人同时提交同一只鸽时只有一笔生效；
 * - 落败方拿到 409、当前归属版本、当前归属人和失败原因；
 * - expectedOwner 存在时额外校验“我以为的归属人”，离线回来发现已转手也判失败。
 */
export function transferOwnership(db, ringNo, { to, expectedVersion, expectedOwner, date, batchId, now = new Date() } = {}) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) throw new RuleError("pigeon_not_found", "鸽只档案不存在", { status: 404 });
  if (!to || typeof to !== "string") throw new RuleError("invalid_transfer", "转棚目标归属不能为空", { status: 400 });
  if (expectedVersion !== undefined && Number(expectedVersion) !== pigeon.ownerVersion) {
    throw new RuleError(
      "transfer_conflict",
      `归属版本冲突：本地依据 v${expectedVersion}，当前为 v${pigeon.ownerVersion}`,
      {
        status: 409,
        ringNo,
        ownerVersion: pigeon.ownerVersion,
        owner: pigeon.owner,
        submittedVersion: Number(expectedVersion),
        reason: "version_mismatch"
      }
    );
  }
  if (expectedOwner !== undefined && expectedOwner && expectedOwner !== pigeon.owner) {
    throw new RuleError(
      "transfer_conflict",
      `归属已变更：提交时以为属于 ${expectedOwner}，当前属于 ${pigeon.owner}`,
      {
        status: 409,
        ringNo,
        ownerVersion: pigeon.ownerVersion,
        owner: pigeon.owner,
        submittedOwner: expectedOwner,
        reason: "owner_changed"
      }
    );
  }
  const entry = {
    version: pigeon.ownerVersion + 1,
    date: date || today(now),
    from: pigeon.owner,
    to,
    ...(batchId ? { batchId } : {})
  };
  pigeon.owner = to;
  pigeon.ownerVersion = entry.version;
  pigeon.transfers.push(entry);
  return { pigeon, applied: entry };
}
