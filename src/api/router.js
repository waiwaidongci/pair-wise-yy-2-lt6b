import { RuleError } from "../rules/errors.js";
import { page } from "./page.js";

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new RuleError("invalid_json", "请求体不是合法 JSON", { status: 400 });
  }
}

/**
 * 接口入口层：只负责解析 HTTP、调用服务、翻译错误码。
 * 业务判断全部在 rules/，落盘全部在 store/。
 */
export function createRouter(service) {
  return async function router(req, res) {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const path = url.pathname;

      if (req.method === "GET" && path === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        return res.end(page);
      }

      if (req.method === "GET" && path === "/api/pigeons") return sendJson(res, 200, service.listPigeons());

      if (req.method === "POST" && path === "/api/pigeons") {
        const pigeon = await service.createPigeon(await readBody(req));
        return sendJson(res, 201, pigeon);
      }

      let match = path.match(/^\/api\/pigeons\/([^/]+)$/);
      if (match && req.method === "GET") {
        const all = service.listPigeons();
        const pigeon = all.find(item => item.ringNo === decodeURIComponent(match[1]));
        return pigeon ? sendJson(res, 200, pigeon) : sendJson(res, 404, { error: "pigeon_not_found" });
      }

      match = path.match(/^\/api\/pigeons\/([^/]+)\/relation$/);
      if (match && req.method === "GET") {
        const data = service.relation(decodeURIComponent(match[1]));
        return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
      }

      match = path.match(/^\/api\/pigeons\/([^/]+)\/lineage$/);
      if (match && req.method === "PATCH") {
        const data = await service.updateLineage(decodeURIComponent(match[1]), await readBody(req));
        return sendJson(res, 200, data);
      }

      match = path.match(/^\/api\/pigeons\/([^/]+)\/(transfers|races|vaccines)$/);
      if (match && req.method === "POST") {
        const ringNo = decodeURIComponent(match[1]);
        const body = await readBody(req);
        let data;
        if (match[2] === "transfers") data = await service.transfer(ringNo, body);
        if (match[2] === "vaccines") data = await service.vaccine(ringNo, body);
        if (match[2] === "races") data = await service.race(ringNo, body);
        return sendJson(res, 200, data);
      }

      if (req.method === "GET" && path === "/api/offline-batches") return sendJson(res, 200, service.listBatches());

      if (req.method === "POST" && path === "/api/offline-batches") {
        const result = await service.submitBatch(await readBody(req));
        return sendJson(res, 200, result);
      }

      match = path.match(/^\/api\/offline-batches\/([^/]+)$/);
      if (match && req.method === "GET") {
        const batch = service.getBatch(decodeURIComponent(match[1]));
        return batch ? sendJson(res, 200, batch) : sendJson(res, 404, { error: "batch_not_found" });
      }

      if (req.method === "GET" && path === "/api/reviews") {
        return sendJson(res, 200, service.listReviews(url.searchParams.get("status") || "pending"));
      }

      match = path.match(/^\/api\/reviews\/([^/]+)\/resolve$/);
      if (match && req.method === "POST") {
        const result = await service.resolveReview(decodeURIComponent(match[1]), await readBody(req));
        return sendJson(res, 200, result);
      }

      if (req.method === "POST" && path === "/api/admin/recompute-lineage") {
        return sendJson(res, 200, { recalculated: await service.recomputeAll() });
      }

      return sendJson(res, 404, { error: "not_found" });
    } catch (error) {
      if (error instanceof RuleError) {
        const status = error.status || 400;
        const { name, ...extra } = error;
        return sendJson(res, status, { error: error.code, message: error.message, ...extra });
      }
      return sendJson(res, 500, { error: "internal_error", message: error.message });
    }
  };
}
