import { recalcLineageFlags } from "./lineage.js";

const CURRENT_VERSION = 2;

/**
 * 旧数据升级到 v2：
 * - firstOwner 取最早一笔转棚的来源（最初归属）；没有转棚记录则用当前归属；
 * - 归属版本从 v1 起步，每笔转棚递增，历史 transfer 逐条补上 version；
 * - 补齐批次、待核对、完整标记等新字段。
 * 升级是幂等的：已经是 v2 的数据只重算标记。
 */
export function migrate(db) {
  if (!db || !Array.isArray(db.pigeons)) {
    throw new Error("数据文件格式不正确：缺少 pigeons 列表");
  }
  for (const list of ["vaccines", "transfers", "races"]) {
    for (const pigeon of db.pigeons) {
      if (!Array.isArray(pigeon[list])) pigeon[list] = [];
    }
  }

  let upgradedFrom = db.version || 1;
  for (const pigeon of db.pigeons) {
    if (pigeon.firstOwner === undefined) {
      const firstTransfer = pigeon.transfers.find(t => t && t.from);
      pigeon.firstOwner = firstTransfer ? firstTransfer.from : pigeon.owner;
    }
    if (pigeon.ownerVersion === undefined) {
      let version = 1;
      for (const transfer of pigeon.transfers) {
        if (transfer.version === undefined) transfer.version = version + 1;
        version = transfer.version;
      }
      pigeon.ownerVersion = version;
    }
    pigeon.fatherRing = pigeon.fatherRing || "";
    pigeon.motherRing = pigeon.motherRing || "";
  }

  if (!Array.isArray(db.batches)) db.batches = [];
  if (!Array.isArray(db.reviews)) db.reviews = [];
  for (const pigeon of db.pigeons) recalcLineageFlags(db, pigeon.ringNo);
  db.version = CURRENT_VERSION;
  return { db, upgradedFrom, upgradedTo: CURRENT_VERSION };
}
