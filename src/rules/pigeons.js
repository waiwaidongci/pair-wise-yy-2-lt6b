import { RuleError } from "./errors.js";
import { getPigeon, recalcLineageFlags } from "./lineage.js";
import { today } from "./ownership.js";

export function createPigeon(db, input, { now = new Date() } = {}) {
  const ringNo = (input.ringNo || "").trim();
  const owner = (input.owner || "").trim();
  if (!ringNo) throw new RuleError("invalid_pigeon", "足环号不能为空", { status: 400 });
  if (!owner) throw new RuleError("invalid_pigeon", "鸽主不能为空", { status: 400 });
  if (getPigeon(db, ringNo)) throw new RuleError("ring_exists", "足环号已登记", { status: 409 });

  const pigeon = {
    ringNo,
    owner,
    firstOwner: owner,
    fatherRing: input.fatherRing || "",
    motherRing: input.motherRing || "",
    color: input.color || "",
    loft: input.loft || "",
    lineageComplete: false,
    ownerVersion: 1,
    transfers: [],
    vaccines: [],
    races: []
  };
  db.pigeons.unshift(pigeon);
  recalcLineageFlags(db, ringNo);
  return pigeon;
}

/** 疫苗只追加，不覆盖任何已入库资料。 */
export function applyVaccine(db, ringNo, { name, date, batchId } = {}, { now = new Date() } = {}) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) throw new RuleError("pigeon_not_found", "鸽只档案不存在", { status: 404 });
  if (!name) throw new RuleError("invalid_vaccine", "疫苗名称不能为空", { status: 400 });
  const entry = { date: date || today(now), name, ...(batchId ? { batchId } : {}) };
  // 离线合并防重：同批次同条目键已处理过就跳过，不产生第二条。
  if (batchId && pigeon.vaccines.some(v => v.batchId === batchId && v.name === entry.name && v.date === entry.date)) {
    return { pigeon, applied: null, duplicated: true };
  }
  pigeon.vaccines.push(entry);
  return { pigeon, applied: entry, duplicated: false };
}

/** 归巢成绩只追加，不覆盖任何已入库资料。 */
export function applyRace(db, ringNo, race = {}, { now = new Date() } = {}) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) throw new RuleError("pigeon_not_found", "鸽只档案不存在", { status: 404 });
  const entry = {
    date: race.date || today(now),
    event: race.event || "未命名赛事",
    distance: Number(race.distance || 0),
    returnTime: race.returnTime || "",
    rank: Number(race.rank || 0),
    ...(race.batchId ? { batchId: race.batchId } : {})
  };
  if (race.batchId && pigeon.races.some(r => r.batchId === race.batchId && r.event === entry.event && r.date === entry.date)) {
    return { pigeon, applied: null, duplicated: true };
  }
  pigeon.races.push(entry);
  return { pigeon, applied: entry, duplicated: false };
}
