import { createPigeon, applyVaccine, applyRace } from "./rules/pigeons.js";
import { transferOwnership } from "./rules/ownership.js";
import { describeLineage, setLineage, recalcLineageFlags } from "./rules/lineage.js";
import { submitBatch, resolveReview } from "./rules/batches.js";

/** 服务层只做编排：存储给事务，规则做判断，接口入口不直接碰任何规则细节。 */
export function createService(store) {
  return {
    listPigeons() {
      return store.read().pigeons;
    },
    relation(ringNo) {
      return describeLineage(store.read(), ringNo);
    },
    createPigeon(input) {
      return store.mutate((db, now) => createPigeon(db, input, { now }));
    },
    updateLineage(ringNo, input) {
      return store.mutate((db) => setLineage(db, ringNo, input));
    },
    transfer(ringNo, input) {
      return store.mutate((db, now) => {
        const { pigeon, applied } = transferOwnership(db, ringNo, { ...input, now });
        return { pigeon, applied };
      });
    },
    vaccine(ringNo, input) {
      return store.mutate((db, now) => applyVaccine(db, ringNo, input, { now }));
    },
    race(ringNo, input) {
      return store.mutate((db, now) => applyRace(db, ringNo, input, { now }));
    },
    listBatches() {
      return store.read().batches;
    },
    getBatch(batchId) {
      return store.read().batches.find(batch => batch.batchId === batchId) || null;
    },
    submitBatch(input) {
      return store.mutate((db, now) => submitBatch(db, input, { now }));
    },
    listReviews(status = "pending") {
      const reviews = store.read().reviews;
      return status === "all" ? reviews : reviews.filter(review => review.status === status);
    },
    resolveReview(reviewId, input) {
      return store.mutate((db) => resolveReview(db, reviewId, input));
    },
    recomputeAll() {
      return store.mutate((db) => {
        const touched = new Set();
        for (const pigeon of db.pigeons) {
          for (const ringNo of recalcLineageFlags(db, pigeon.ringNo)) touched.add(ringNo);
        }
        return [...touched];
      });
    }
  };
}
