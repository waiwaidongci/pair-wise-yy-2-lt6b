import { RuleError } from "./errors.js";

/**
 * “血统完整”指沿父/母边向上的每一条已登记引用都能查到档案，
 * 直到自然终止（足环号留空）为止；中间任何一环只挂环号、档案缺失即为不完整。
 * 这样补录祖先档案后，后代标记经重算可以由不完整变为完整。
 */

export function getPigeon(db, ringNo) {
  return db.pigeons.find(item => item.ringNo === ringNo) || null;
}

export function describeLineage(db, ringNo) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) return null;
  const father = pigeon.fatherRing ? getPigeon(db, pigeon.fatherRing) : null;
  const mother = pigeon.motherRing ? getPigeon(db, pigeon.motherRing) : null;
  const children = db.pigeons.filter(item => item.fatherRing === ringNo || item.motherRing === ringNo);
  return {
    pigeon,
    father: father || (pigeon.fatherRing ? { ringNo: pigeon.fatherRing, unregistered: true } : null),
    mother: mother || (pigeon.motherRing ? { ringNo: pigeon.motherRing, unregistered: true } : null),
    children,
    lineageComplete: isLineageComplete(db, ringNo)
  };
}

export function isLineageComplete(db, ringNo) {
  let complete = true;
  const visited = new Set();
  const walk = currentRing => {
    if (visited.has(currentRing)) return; // 防御旧数据里的成环：不继续遍历
    visited.add(currentRing);
    const pigeon = getPigeon(db, currentRing);
    if (!pigeon) {
      // 环号被引用但档案缺失：血统书断档
      complete = false;
      return;
    }
    if (pigeon.fatherRing) walk(pigeon.fatherRing);
    if (pigeon.motherRing) walk(pigeon.motherRing);
  };
  walk(ringNo);
  return complete;
}

/** 收集 ringNo 的全部后代（子代、孙代……），用于血缘改动后向下重算。 */
export function collectDescendants(db, ringNo) {
  const result = [];
  const queue = [ringNo];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    const kids = db.pigeons.filter(p => p.fatherRing === current || p.motherRing === current);
    for (const child of kids) {
      if (!seen.has(child.ringNo)) {
        seen.add(child.ringNo);
        result.push(child.ringNo);
        queue.push(child.ringNo);
      }
    }
  }
  return result;
}

/** 血缘改动后，重算本鸽与全部后代的完整标记。 */
export function recalcLineageFlags(db, ringNo) {
  const touched = [ringNo, ...collectDescendants(db, ringNo)];
  for (const target of touched) {
    const pigeon = getPigeon(db, target);
    if (pigeon) pigeon.lineageComplete = isLineageComplete(db, target);
  }
  return touched;
}

/** 沿父/母边向上收集祖先环号（含环号已登记但档案缺失的悬空引用）。 */
export function ancestorRings(db, ringNo) {
  const ancestors = new Set();
  const walk = (current, path) => {
    const pigeon = getPigeon(db, current);
    if (!pigeon) return;
    for (const parentRing of [pigeon.fatherRing, pigeon.motherRing]) {
      if (!parentRing) continue;
      if (path.includes(parentRing)) continue; // 旧数据若已存在环，停止这条路径
      ancestors.add(parentRing);
      walk(parentRing, [...path, parentRing]);
    }
  };
  walk(ringNo, [ringNo]);
  return ancestors;
}

/**
 * 建立父子关系前的校验：
 * - 父母不能是同一只鸽；
 * - 新父亲/新母亲沿父母边不能回到本鸽（本鸽不能是其祖先），
 *   即不能把后代或自己设为父/母，父子关系不能绕成环。
 */
export function assertLineageAllowed(db, ringNo, { fatherRing, motherRing }) {
  const pigeon = getPigeon(db, ringNo);
  if (!pigeon) throw new RuleError("pigeon_not_found", "鸽只档案不存在", { status: 404 });
  // 只改一边时（字段缺省）沿用现值；空串/ null 都视为显式清除。
  const nextFather = fatherRing === undefined ? pigeon.fatherRing : (fatherRing || "");
  const nextMother = motherRing === undefined ? pigeon.motherRing : (motherRing || "");
  if (nextFather && nextFather === ringNo) throw new RuleError("lineage_cycle", "lineage_cycle：不能把自己设为父亲");
  if (nextMother && nextMother === ringNo) throw new RuleError("lineage_cycle", "lineage_cycle：不能把自己设为母亲");
  if (nextFather && nextFather === nextMother) throw new RuleError("lineage_cycle", "lineage_cycle：父鸽和母鸽不能是同一只鸽");
  // 新父/母必须不是本鸽后代：沿其父母边若能走回本鸽就成环。
  // 悬空环号（档案缺失）没有可走的边，允许先挂关系。
  if (nextFather && ancestorRings(db, nextFather).has(ringNo)) {
    throw new RuleError("lineage_cycle", `鸽只 ${nextFather} 是 ${ringNo} 的后代，不能再设为父亲`);
  }
  if (nextMother && ancestorRings(db, nextMother).has(ringNo)) {
    throw new RuleError("lineage_cycle", `鸽只 ${nextMother} 是 ${ringNo} 的后代，不能再设为母亲`);
  }
}

/** 修改父母关系；悬空足环号允许先登记，档案补录后重算即可变完整。 */
export function setLineage(db, ringNo, { fatherRing, motherRing }) {
  assertLineageAllowed(db, ringNo, { fatherRing, motherRing });
  const pigeon = getPigeon(db, ringNo);
  if (fatherRing !== undefined) pigeon.fatherRing = fatherRing || "";
  if (motherRing !== undefined) pigeon.motherRing = motherRing || "";
  const recalculated = recalcLineageFlags(db, ringNo);
  return { pigeon, recalculated };
}
