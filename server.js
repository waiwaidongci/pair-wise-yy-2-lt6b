// 接口入口层：只负责 HTTP 收发与页面呈现，业务规则在 rules.js，持久化在 storage.js
import http from "node:http";
import { loadDb, saveDb } from "./lib/storage.js";
import * as rules from "./lib/rules.js";

const port = Number(process.env.PORT || 3024);

async function body(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {};
}
function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --red:#9b3f35; --green:#2e7d4f; --amber:#8a6d1a; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; flex-wrap:wrap; }
    h1 { margin:0; font-size:26px; } main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.stat { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; } h2 { margin:0 0 12px; font-size:18px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:10px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#eef2f5; color:var(--ink); } button.danger { background:var(--red); } button.small { padding:6px 9px; font-size:12px; }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.ver { background:#eef2f5; } .pill.owner { background:#e7f0ea; color:var(--green); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; } .small { background:#f8fafb; border:1px solid var(--line); border-radius:8px; padding:10px; }
    .queue-item,.pending-item { border:1px solid var(--line); border-radius:6px; padding:8px 10px; margin-bottom:8px; font-size:13px; background:#f8fafb; }
    .banner { border-radius:8px; padding:10px 12px; margin-bottom:12px; font-size:14px; } .banner.ok { background:#e7f0ea; color:var(--green); } .banner.err { background:#f7e9e7; color:var(--red); } .banner.info { background:#eef2f5; color:var(--accent); }
    .row { display:flex; gap:8px; flex-wrap:wrap; align-items:center; } .muted { color:var(--muted); }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、转让和归巢成绩 · 离线批次回站合并</div></div><div class="row"><span class="pill ver" id="schemaVer">schema v-</span><button id="reload">刷新</button></div></header>
  <main>
    <div>
      <form id="form">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主（最初归属）</label><input name="owner" required>
        <label>父鸽足环号</label><input name="fatherRing">
        <label>母鸽足环号</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>出生棚号</label><input name="loft" required>
        <button>保存档案</button>
      </form>

      <div class="panel section">
        <h2>离线批次（断网先记，回站合并）</h2>
        <div class="meta">断网时把转棚、疫苗、归巢成绩加入队列；回站后点“合并回站”。同批次重传沿用首次结果，内容变了列待核对，不覆盖已入库资料。</div>
        <div class="row" style="margin:10px 0;">
          <button id="mergeBatch">合并回站</button>
          <button id="clearQueue" class="ghost">清空队列</button>
        </div>
        <div id="queue"></div>
        <div id="batchResult"></div>
      </div>

      <div class="panel section">
        <h2>待核对（内容变更，未入库）</h2>
        <div id="pending"></div>
      </div>
    </div>

    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    const form = document.querySelector("#form");
    const cards = document.querySelector("#cards");
    const detail = document.querySelector("#detail");
    const search = document.querySelector("#search");
    const queueEl = document.querySelector("#queue");
    const pendingEl = document.querySelector("#pending");
    const batchResultEl = document.querySelector("#batchResult");
    const schemaVerEl = document.querySelector("#schemaVer");
    let pigeons = [];
    let queue = []; // 离线批次项

    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw data;
      return data;
    }
    function banner(el, kind, msg) { el.innerHTML = '<div class="banner '+kind+'">'+msg+'</div>'; }

    function queueAdd(item) {
      queue.push(item);
      renderQueue();
    }
    function renderQueue() {
      if (!queue.length) { queueEl.innerHTML = '<p class="meta">队列为空。断网时可在下方鸽片上把操作加入队列。</p>'; return; }
      queueEl.innerHTML = queue.map((q, i) =>
        '<div class="queue-item"><b>'+q.type+'</b> · '+q.ringNo+' <span class="meta">'+JSON.stringify(q.payload)+'</span> <button class="small danger" data-rm="'+i+'">移除</button></div>').join("");
      queueEl.querySelectorAll("[data-rm]").forEach(b => b.onclick = () => { queue.splice(Number(b.dataset.rm), 1); renderQueue(); });
    }

    async function mergeBatch() {
      if (!queue.length) { banner(batchResultEl, "info", "队列为空，无批次可合并。"); return; }
      const batchId = "batch-" + Date.now();
      try {
        const r = await api("/api/batches", { method:"POST", body: JSON.stringify({ batchId, source:"offline", items: queue }) });
        if (r.replayed) banner(batchResultEl, "ok", "批次 "+batchId+" 重传：沿用首次结果，未重复入库。已应用 "+r.result.applied.length+" 笔。");
        else banner(batchResultEl, "ok", "批次 "+batchId+" 已合并：应用 "+r.result.applied.length+" 笔，冲突 "+r.result.conflicts.length+" 笔。");
        queue = []; renderQueue(); await load();
      } catch (e) {
        if (e.error === "content_changed") banner(batchResultEl, "err", "批次内容与首次提交不一致，已列待核对（"+e.pendingId+"），未覆盖已入库资料。");
        else banner(batchResultEl, "err", "合并失败："+(e.reason || e.error || "未知错误"));
      }
    }

    async function loadPending() {
      const list = await api("/api/pending");
      if (!list.length) { pendingEl.innerHTML = '<p class="meta">暂无待核对项。</p>'; return; }
      pendingEl.innerHTML = list.map(p =>
        '<div class="pending-item"><b>'+p.batchId+'</b> · '+p.reason+' <span class="meta">'+p.createdAt+'</span>'+
        '<div class="meta">首次结果：'+JSON.stringify(p.firstResult)+'</div>'+
        (p.status === "open" ? '<div class="row" style="margin-top:6px;"><button class="small" data-accept="'+p.id+'">维持首次结果</button><button class="small ghost" data-reject="'+p.id+'">驳回</button></div>' : '<div class="meta">已处理：'+p.status+'</div>')+
        '</div>').join("");
      pendingEl.querySelectorAll("[data-accept]").forEach(b => b.onclick = async () => { await api("/api/pending/"+b.dataset.accept+"/resolve", { method:"POST", body: JSON.stringify({ action:"accept_first" }) }); await loadPending(); });
      pendingEl.querySelectorAll("[data-reject]").forEach(b => b.onclick = async () => { await api("/api/pending/"+b.dataset.reject+"/resolve", { method:"POST", body: JSON.stringify({ action:"reject" }) }); await loadPending(); });
    }

    function renderCards() {
      cards.innerHTML = pigeons.map(p => {
        const desc = (p.descendants && p.descendants.length) ? p.descendants.join("、") : "无";
        return '<article class="card"><h3>'+p.ringNo+'</h3>'+
          '<div class="row"><span class="pill owner">'+p.owner+'</span><span class="pill ver">v'+(p.version||1)+'</span></div>'+
          '<div class="meta">'+p.color+' · '+p.loft+' · 最初归属 '+ (p.attribution||p.owner) +'</div>'+
          '<div>父：'+(p.fatherRing || "未登记")+'　母：'+(p.motherRing || "未登记")+'</div>'+
          '<div class="meta">后代标记：'+desc+'</div>'+
          '<label>录入转棚（新归属人）</label><input data-to="'+p.ringNo+'" placeholder="新归属人">'+
          '<div class="row"><button data-transfer="'+p.ringNo+'">立即转棚</button><button class="ghost" data-q-transfer="'+p.ringNo+'">加入离线队列</button></div>'+
          '<label>疫苗</label><input data-vac="'+p.ringNo+'" placeholder="疫苗名称">'+
          '<div class="row"><button data-vaccine="'+p.ringNo+'">立即接种</button><button class="ghost" data-q-vaccine="'+p.ringNo+'">加入离线队列</button></div>'+
          '<label>归巢成绩（赛事/距离/名次）</label><input data-race="'+p.ringNo+'" placeholder="如200公里/200/6">'+
          '<div class="row"><button data-score="'+p.ringNo+'">立即记成绩</button><button class="ghost" data-q-race="'+p.ringNo+'">加入离线队列</button></div>'+
          '<label>更改父母（血统）</label><input data-father="'+p.ringNo+'" placeholder="父鸽足环号"><input data-mother="'+p.ringNo+'" placeholder="母鸽足环号"><button data-parents="'+p.ringNo+'">保存血统</button>'+
          '</article>';
      }).join("");

      cards.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer; const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to, clientVersion: p.version }) }); await load(); }
        catch (e) { alert("转棚未生效："+(e.reason||e.error)+(e.current?("；归属版本 v"+e.current.version+"，当前归属 "+e.current.owner):"")); }
      });
      cards.querySelectorAll("[data-vaccine]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.vaccine; const name = document.querySelector('[data-vac="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/vaccines', { method:'POST', body: JSON.stringify({ name, clientVersion: p.version }) }); await load(); }
        catch (e) { alert("接种未生效："+(e.reason||e.error)); }
      });
      cards.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        const p = pigeons.find(x => x.ringNo === ringNo);
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0]||"未命名赛事", distance: Number(raw[1]||0), rank: Number(raw[2]||0), clientVersion: p.version }) }); await load(); }
        catch (e) { alert("成绩未生效："+(e.reason||e.error)); }
      });
      cards.querySelectorAll("[data-parents]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.parents;
        const fatherRing = document.querySelector('[data-father="'+ringNo+'"]').value;
        const motherRing = document.querySelector('[data-mother="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        try { await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/parents', { method:'POST', body: JSON.stringify({ fatherRing, motherRing, clientVersion: p.version }) }); await load(); }
        catch (e) { alert("血统未更新："+(e.reason||e.error)); }
      });
      // 加入离线队列
      cards.querySelectorAll("[data-q-transfer]").forEach(btn => btn.onclick = () => {
        const ringNo = btn.dataset.qTransfer; const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        queueAdd({ type:"transfer", ringNo, clientVersion: p.version, payload:{ to } });
      });
      cards.querySelectorAll("[data-q-vaccine]").forEach(btn => btn.onclick = () => {
        const ringNo = btn.dataset.qVaccine; const name = document.querySelector('[data-vac="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        queueAdd({ type:"vaccine", ringNo, clientVersion: p.version, payload:{ name } });
      });
      cards.querySelectorAll("[data-q-race]").forEach(btn => btn.onclick = () => {
        const ringNo = btn.dataset.qRace; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        const p = pigeons.find(x => x.ringNo === ringNo);
        queueAdd({ type:"race", ringNo, clientVersion: p.version, payload:{ event: raw[0]||"未命名赛事", distance: Number(raw[1]||0), rank: Number(raw[2]||0) } });
      });
    }

    function renderRelation(data) {
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、完整后代标记、转让和成绩。</p>'; return; }
      const p = data.pigeon;
      detail.innerHTML = '<h2>'+p.ringNo+' 血统档案</h2>'+
        '<div class="relation"><div class="small"><b>父鸽</b><br>'+(data.father?.ringNo || p.fatherRing || "未登记")+'</div>'+
        '<div class="small"><b>本鸽</b><br>'+p.owner+' · '+p.color+' · v'+(p.version||1)+'</div>'+
        '<div class="small"><b>母鸽</b><br>'+(data.mother?.ringNo || p.motherRing || "未登记")+'</div></div>'+
        '<div><b>子代</b> '+(data.children.map(c => c.ringNo).join("、") || "暂无")+'</div>'+
        '<div><b>完整后代标记</b> '+(data.descendants.join("、") || "暂无")+'</div>'+
        '<div class="meta">转让：'+(p.transfers.map(t => t.from+"→"+t.to).join(" / ") || "暂无")+'</div>'+
        '<div class="meta">疫苗：'+(p.vaccines.map(v => v.name).join("、") || "暂无")+'</div>'+
        '<div class="meta">归巢：'+(p.races.map(r => r.event+" 第"+r.rank+"名").join(" / ") || "暂无")+'</div>';
    }

    async function load(){
      pigeons = await api("/api/pigeons");
      const meta = await api("/api/meta");
      schemaVerEl.textContent = "schema v"+meta.schemaVersion;
      renderCards(); renderRelation(null); renderQueue(); await loadPending();
    }
    document.querySelector("#searchBtn").onclick = async () => {
      try { renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation')); }
      catch (e) { renderRelation(null); }
    };
    document.querySelector("#reload").onclick = load;
    document.querySelector("#mergeBatch").onclick = mergeBatch;
    document.querySelector("#clearQueue").onclick = () => { queue = []; renderQueue(); };
    form.onsubmit = async event => {
      event.preventDefault();
      await api("/api/pigeons", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await load();
    };
    load();
  </script>
</body>
</html>`;

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const db = await loadDb();
    if (rules.migrate(db)) await saveDb(db);

    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      return res.end(page);
    }
    if (req.method === "GET" && url.pathname === "/api/meta") {
      return sendJson(res, 200, { schemaVersion: db.schemaVersion || 1 });
    }
    if (req.method === "GET" && url.pathname === "/api/pigeons") {
      return sendJson(res, 200, db.pigeons);
    }
    if (req.method === "POST" && url.pathname === "/api/pigeons") {
      const input = await body(req);
      const r = rules.createPigeon(db, input);
      if (!r.ok) return sendJson(res, 409, r);
      await saveDb(db);
      return sendJson(res, 201, r.pigeon);
    }

    let m = url.pathname.match(/^\/api\/pigeons\/(.+)\/relation$/);
    if (m && req.method === "GET") {
      const data = rules.getRelation(db, decodeURIComponent(m[1]));
      return data ? sendJson(res, 200, data) : sendJson(res, 404, { error: "pigeon_not_found" });
    }

    m = url.pathname.match(/^\/api\/pigeons\/(.+)\/parents$/);
    if (m && req.method === "POST") {
      const r = rules.setParents(db, decodeURIComponent(m[1]), await body(req));
      if (!r.ok) return sendJson(res, 409, r);
      await saveDb(db);
      return sendJson(res, 200, r.pigeon);
    }

    m = url.pathname.match(/^\/api\/pigeons\/(.+)\/(transfers|races|vaccines)$/);
    if (m && req.method === "POST") {
      const ringNo = decodeURIComponent(m[1]);
      const input = await body(req);
      let r;
      if (m[2] === "transfers") r = rules.applyTransfer(db, ringNo, input);
      else if (m[2] === "races") r = rules.applyRace(db, ringNo, input);
      else r = rules.applyVaccine(db, ringNo, input);
      if (!r.ok) return sendJson(res, 409, r);
      await saveDb(db);
      return sendJson(res, 200, r.pigeon);
    }

    if (req.method === "GET" && url.pathname === "/api/batches") {
      return sendJson(res, 200, db.batches);
    }
    if (req.method === "POST" && url.pathname === "/api/batches") {
      const r = rules.mergeBatch(db, await body(req));
      await saveDb(db);
      return sendJson(res, r.ok ? 200 : 409, r);
    }

    if (req.method === "GET" && url.pathname === "/api/pending") {
      return sendJson(res, 200, db.pending);
    }
    m = url.pathname.match(/^\/api\/pending\/(.+)\/resolve$/);
    if (m && req.method === "POST") {
      const input = await body(req);
      const r = rules.resolvePending(db, decodeURIComponent(m[1]), input.action);
      if (!r.ok) return sendJson(res, 404, r);
      await saveDb(db);
      return sendJson(res, 200, r.pending);
    }

    sendJson(res, 404, { error: "not_found" });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
  }
});

server.listen(port, () => console.log(`Racing pigeon registry listening on http://localhost:${port}`));
