export const page = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>赛鸽血统环号登记站</title>
  <style>
    :root { --bg:#eff2f5; --panel:#fff; --ink:#1f2833; --muted:#697786; --line:#d3dce4; --accent:#315f83; --warn:#9a6b1f; --warnBg:#fdf6e8; --red:#9b3f35; --ok:#2e6b46; }
    * { box-sizing:border-box; } body { margin:0; background:var(--bg); color:var(--ink); font-family:Arial,"PingFang SC",sans-serif; }
    header { padding:22px 28px; background:#fff; border-bottom:1px solid var(--line); display:flex; justify-content:space-between; gap:16px; align-items:center; }
    h1 { margin:0; font-size:26px; } h2 { margin:0 0 12px; font-size:18px; } h3 { margin:0; }
    main { display:grid; grid-template-columns:380px 1fr; gap:22px; padding:22px 28px; }
    form,.panel,.card,.small { background:#fff; border:1px solid var(--line); border-radius:8px; padding:16px; }
    label { display:block; margin:10px 0 5px; color:var(--muted); font-size:13px; } input,select,textarea { width:100%; border:1px solid var(--line); border-radius:6px; padding:9px; font:inherit; }
    textarea { min-height:90px; font-family:ui-monospace,Menlo,monospace; font-size:12px; }
    button { border:0; border-radius:6px; background:var(--accent); color:#fff; padding:9px 13px; font-weight:700; cursor:pointer; }
    button.ghost { background:#eef3f7; color:var(--accent); } button.warn { background:var(--warn); } button.danger { background:var(--red); } button.ok { background:var(--ok); }
    .toolbar { display:grid; grid-template-columns:1fr auto; gap:10px; margin-bottom:14px; } .grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:12px; }
    .card { display:grid; gap:8px; } .meta { color:var(--muted); font-size:13px; } .pill { display:inline-block; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:12px; }
    .pill.v { background:#eef3f7; } .pill.bad { border-color:var(--warn); background:var(--warnBg); color:var(--warn); } .pill.ok { border-color:var(--ok); color:var(--ok); }
    .section { margin-top:14px; } .relation { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; margin-bottom:14px; }
    .row { display:flex; gap:8px; align-items:center; } .row input { flex:1; }
    .review { border:1px solid var(--warn); background:var(--warnBg); border-radius:8px; padding:12px; margin-bottom:10px; }
    .outcome-applied { color:var(--ok); font-weight:700; } .outcome-conflict,.outcome-error { color:var(--red); font-weight:700; } .outcome-duplicate { color:var(--muted); font-weight:700; }
    pre { white-space:pre-wrap; word-break:break-all; background:#f6f8fa; border-radius:6px; padding:8px; font-size:12px; margin:6px 0; }
    @media (max-width:900px){ header{display:block;padding:18px 16px;} main{grid-template-columns:1fr;padding:16px;} .relation{grid-template-columns:1fr;} }
  </style>
</head>
<body>
  <header><div><h1>赛鸽血统环号登记站</h1><div class="meta">档案、血统、版本化转棚、离线批次与待核对</div></div><button id="reload">刷新</button></header>
  <main>
    <div style="display:grid;gap:16px;align-content:start;">
      <form id="form">
        <h2>创建鸽只档案</h2>
        <label>足环号</label><input name="ringNo" required>
        <label>鸽主（最初归属即 v1）</label><input name="owner" required>
        <label>父鸽足环号</label><input name="fatherRing">
        <label>母鸽足环号</label><input name="motherRing">
        <label>羽色</label><input name="color" required>
        <label>出生棚号</label><input name="loft" required>
        <button>保存档案</button>
      </form>

      <div class="panel">
        <h2>离线批次回站合并</h2>
        <div class="meta">断网时把转棚 / 疫苗 / 归巢先记成批次。同 batchId 重传沿用首次结果；内容变化进待核对。</div>
        <label>批次号 batchId（留空自动生成）</label><input id="batchId" placeholder="B-棚号-序号">
        <label>设备号</label><input id="deviceId" placeholder="LOFT-A">
        <label>条目 JSON 数组</label>
        <textarea id="batchItems">[
  { "clientItemId": "t1", "type": "transfer", "ringNo": "CHN-2026-001", "payload": { "to": "南湾棚", "expectedVersion": 2 } },
  { "clientItemId": "v1", "type": "vaccine", "ringNo": "CHN-2026-001", "payload": { "date": "2026-09-30", "name": "禽流感" } }
]</textarea>
        <div class="row" style="margin-top:10px;"><button id="submitBatch">提交 / 合并批次</button></div>
        <pre id="batchResult"></pre>
      </div>

      <div class="panel">
        <h2>待核对队列</h2>
        <div id="reviews"></div>
      </div>
    </div>

    <section>
      <div class="toolbar"><input id="search" placeholder="输入足环号查询血统"><button id="searchBtn">查询</button></div>
      <div class="panel" id="detail"></div>
      <div class="section grid" id="cards"></div>
    </section>
  </main>
  <script>
    let pigeons = [];
    const form = document.querySelector("#form");
    const search = document.querySelector("#search");
    async function api(path, options) {
      const res = await fetch(path, options && options.body ? { ...options, headers:{ "Content-Type":"application/json" } } : options);
      const data = await res.json();
      if (!res.ok) throw new Error((data.error||"") + " " + JSON.stringify(data).slice(0,200));
      return data;
    }
    function esc(s){ return String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","\\"":"&quot;"}[c])); }
    function outcomePill(o){ return '<span class="pill outcome-'+o+'">'+({applied:"已入库",conflict:"冲突未生效",error:"错误",duplicate:"重复沿用"}[o]||o)+'</span>'; }

    function renderCards() {
      document.querySelector("#cards").innerHTML = pigeons.map(p =>
        '<article class="card"><div class="row"><h3>'+esc(p.ringNo)+'</h3><span class="pill v">归属 v'+p.ownerVersion+'</span>'
        +(p.lineageComplete ? '<span class="pill ok">血统完整</span>' : '<span class="pill bad">血统待补</span>')+'</div>'
        +'<span class="pill">'+esc(p.owner)+'</span><div class="meta">'+esc(p.color)+' · '+esc(p.loft)+' · 最初归属 '+esc(p.firstOwner)+'</div>'
        +'<div>父：'+esc(p.fatherRing || "未登记")+'　母：'+esc(p.motherRing || "未登记")+'</div>'
        +'<label>修改血缘（留空清除；带版本无关）</label><div class="row"><input data-father="'+esc(p.ringNo)+'" placeholder="父环号" value="'+esc(p.fatherRing)+'"><input data-mother="'+esc(p.ringNo)+'" placeholder="母环号" value="'+esc(p.motherRing)+'"><button data-lineage="'+esc(p.ringNo)+'">保存血缘</button></div>'
        +'<label>转棚（依据版本 v'+p.ownerVersion+'，两人并发时落后版本失败）</label><div class="row"><input data-to="'+esc(p.ringNo)+'" placeholder="新归属人"><button data-transfer="'+esc(p.ringNo)+'">保存转棚</button></div>'
        +'<label>疫苗</label><div class="row"><input data-vac="'+esc(p.ringNo)+'" placeholder="疫苗名/日期，如 新城疫/2026-10-01"><button data-vacbtn="'+esc(p.ringNo)+'">保存疫苗</button></div>'
        +'<label>归巢成绩</label><div class="row"><input data-race="'+esc(p.ringNo)+'" placeholder="赛事/距离/名次，如200公里/200/6"><button data-score="'+esc(p.ringNo)+'">保存成绩</button></div>'
        +'</article>').join("");

      document.querySelectorAll("[data-lineage]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.lineage;
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/lineage', { method:'PATCH', body: JSON.stringify({
          fatherRing: document.querySelector('[data-father="'+ringNo+'"]').value,
          motherRing: document.querySelector('[data-mother="'+ringNo+'"]').value
        }) }); await load();
      });
      document.querySelectorAll("[data-transfer]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.transfer;
        const to = document.querySelector('[data-to="'+ringNo+'"]').value;
        const p = pigeons.find(x => x.ringNo === ringNo);
        try {
          await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/transfers', { method:'POST', body: JSON.stringify({ to, expectedVersion: p.ownerVersion }) });
        } catch(e) { alert("转棚未生效："+e.message); }
        await load();
      });
      document.querySelectorAll("[data-vacbtn]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.vacbtn; const raw = document.querySelector('[data-vac="'+ringNo+'"]').value.split("/");
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/vaccines', { method:'POST', body: JSON.stringify({ name: raw[0], date: raw[1] || undefined }) });
        await load();
      });
      document.querySelectorAll("[data-score]").forEach(btn => btn.onclick = async () => {
        const ringNo = btn.dataset.score; const raw = document.querySelector('[data-race="'+ringNo+'"]').value.split("/");
        await api('/api/pigeons/'+encodeURIComponent(ringNo)+'/races', { method:'POST', body: JSON.stringify({ event: raw[0] || "未命名赛事", distance: Number(raw[1] || 0), rank: Number(raw[2] || 0) }) });
        await load();
      });
    }

    function renderRelation(data) {
      const detail = document.querySelector("#detail");
      if (!data) { detail.innerHTML = '<h2>血统查询</h2><p class="meta">请输入足环号查看父母、子代、版本化转棚和成绩。</p>'; return; }
      const p = data.pigeon;
      detail.innerHTML = '<h2>'+esc(p.ringNo)+' 血统档案</h2>'
        + '<div class="relation"><div class="small"><b>父鸽</b><br>'+esc(data.father?.ringNo || "未登记")+(data.father?.unregistered?' <span class="pill bad">档案缺失</span>':'')+'</div>'
        + '<div class="small"><b>本鸽</b><br>'+esc(p.owner)+' v'+p.ownerVersion+' · '+esc(p.color)+(data.lineageComplete?' <span class="pill ok">血统完整</span>':' <span class="pill bad">血统待补</span>')+'</div>'
        + '<div class="small"><b>母鸽</b><br>'+esc(data.mother?.ringNo || "未登记")+(data.mother?.unregistered?' <span class="pill bad">档案缺失</span>':'')+'</div></div>'
        + '<div><b>子代</b> '+(data.children.map(c => esc(c.ringNo)).join("、") || "暂无")+'</div>'
        + '<div class="meta">最初归属：'+esc(p.firstOwner)+'</div>'
        + '<div class="meta">转棚：'+(p.transfers.map(t => 'v'+t.version+' '+esc(t.date)+' '+esc(t.from)+'→'+esc(t.to)).join(" / ") || "暂无")+'</div>'
        + '<div class="meta">疫苗：'+(p.vaccines.map(v => esc(v.date)+' '+esc(v.name)).join(" / ") || "暂无")+'</div>'
        + '<div class="meta">归巢：'+(p.races.map(r => esc(r.event)+' 第'+r.rank+'名').join(" / ") || "暂无")+'</div>';
    }

    async function renderReviews() {
      const reviews = await api("/api/reviews");
      document.querySelector("#reviews").innerHTML = reviews.length ? reviews.map(r =>
        '<div class="review"><div><b>'+({changed_item:"内容变更",added_item:"新增条目",removed_item:"条目删除"}[r.kind]||r.kind)+'</b> · '+esc(r.batchId)+' · '+esc(r.ringNo)+' · '+esc(r.type)+'</div>'
        + '<label>首次内容</label><pre>'+esc(JSON.stringify(r.firstPayload))+'</pre>'
        + '<label>重传内容</label><pre>'+esc(JSON.stringify(r.latestPayload))+'</pre>'
        + '<div class="row"><button class="ok" data-accept="'+esc(r.id)+'">接受重传（实时入库）</button><button class="danger" data-reject="'+esc(r.id)+'">拒绝（保留已入库）</button></div></div>').join("")
        : '<div class="meta">暂无待核对项</div>';
      document.querySelectorAll("[data-accept]").forEach(btn => btn.onclick = async () => { await api('/api/reviews/'+encodeURIComponent(btn.dataset.accept)+'/resolve', { method:'POST', body: JSON.stringify({ action:'accept' }) }); await load(); });
      document.querySelectorAll("[data-reject]").forEach(btn => btn.onclick = async () => { await api('/api/reviews/'+encodeURIComponent(btn.dataset.reject)+'/resolve', { method:'POST', body: JSON.stringify({ action:'reject' }) }); await load(); });
    }

    async function load(){
      pigeons = await api("/api/pigeons");
      renderCards(); renderRelation(null); renderReviews();
    }
    document.querySelector("#searchBtn").onclick = async () => renderRelation(await api('/api/pigeons/'+encodeURIComponent(search.value)+'/relation'));
    document.querySelector("#reload").onclick = load;
    document.querySelector("#form").onsubmit = async event => {
      event.preventDefault();
      await api("/api/pigeons", { method:"POST", body: JSON.stringify(Object.fromEntries(new FormData(form).entries())) });
      form.reset(); await load();
    };
    document.querySelector("#submitBatch").onclick = async () => {
      let items;
      try { items = JSON.parse(document.querySelector("#batchItems").value); } catch(e) { alert("JSON 解析失败："+e.message); return; }
      const result = await api("/api/offline-batches", { method:"POST", body: JSON.stringify({
        batchId: document.querySelector("#batchId").value || undefined,
        deviceId: document.querySelector("#deviceId").value || undefined,
        items
      }) });
      document.querySelector("#batchResult").textContent = JSON.stringify({
        batchId: result.batch.batchId, status: result.batch.status, replayed: result.replayed, changed: result.changed,
        items: result.batch.items.map(i => ({ key:i.key, outcome:i.outcome, owner:i.result?.owner, ownerVersion:i.result?.ownerVersion, reason:i.result?.reason }))
      }, null, 2);
      await load();
    };
    load();
  </script>
</body>
</html>`;
