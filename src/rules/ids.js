import crypto from "node:crypto";

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return "[" + value.map(canonicalize).join(",") + "]";
  return "{" + Object.keys(value).sort().map(k => JSON.stringify(k) + ":" + canonicalize(value[k])).join(",") + "}";
}

/** 与键顺序无关的内容哈希，用来判断离线批次重传时内容是否变化。 */
export function contentHash(payload) {
  return crypto.createHash("sha256").update(canonicalize(payload)).digest("hex");
}

export function newBatchId() {
  return "B-" + new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14) + "-" + crypto.randomBytes(3).toString("hex");
}
