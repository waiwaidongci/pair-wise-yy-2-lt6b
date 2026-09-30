# 赛鸽血统环号登记站

鸽舍断网时把转棚、疫苗、归巢成绩先记成**离线批次**，回站后合并进鸽只档案。

## 运行

```bash
npm start      # http://localhost:3024
npm test       # 规则层 + HTTP 端到端测试（node:test，18 项）
```

## 分层

| 层 | 位置 | 职责 |
| --- | --- | --- |
| 规则 | `src/rules/` | 纯函数：批次合并、归属版本、血统环检测、旧数据升级，不碰文件与 HTTP |
| 存储 | `src/store/json-store.js` | JSON 文件原子写（临时文件 + rename）、串行读-改-写队列 |
| 接口入口 | `src/api/router.js`、`server.js` | HTTP 解析、错误码翻译、页面 |

## 业务规则

### 离线批次（断网记录，回站合并）

- `POST /api/offline-batches`，`items[]` 每条含 `clientItemId`、`type`（`transfer`/`vaccine`/`race`）、`ringNo`、`payload`。
- 首次提交：逐条合并入档案，条目结果（`applied`/`conflict`/`duplicate`/`error`）随批次永久存档；一条坏数据不拖垮整批。
- **同 `batchId` 原样重传**：直接沿用首次结果，不重复写库（内容比对与 JSON 键顺序、条目顺序都无关）。
- **重传内容变了**：变更 / 新增 / 删除的条目进入待核对队列（`GET /api/reviews`），首次结果和已入库资料原样保留；接受后才按新内容**追加**入库（`POST /api/reviews/:id/resolve`），拒绝则仅关闭工单。转棚、疫苗、成绩均为只追加，不回滚。

### 版本化转棚（两人并发只有一笔生效）

- 每只鸽的归属带 `ownerVersion`，从 v1 起步；`firstOwner` 记录最初归属。
- 转棚提交 `expectedVersion`；版本落后返回 `409 transfer_conflict`，响应里带当前 `ownerVersion`、当前 `owner`、失败原因（`version_mismatch` / `owner_changed`），落败方据此刷新后重试。
- 不带版本号的直接录入（人工场景）仍可用。

### 血统关系

- `PATCH /api/pigeons/:ringNo/lineage` 修改父/母环号。
- 成环拒绝（自环、把后代设为父/母、父母同为一只）：`400 lineage_cycle`。
- `lineageComplete`：沿父/母边向上的每条已登记引用都能查到档案即完整，断档为不完整。血缘改动后自动重算本鸽与全部后代；悬空环号（先挂关系、后补档案）在补录并重算后可变完整。

### 旧数据升级

- v1 JSON 首次加载时原地升级到 v2：`firstOwner` 取最早一笔转棚的来源（无转棚则取当前归属）作为 v1，历史转棚逐条补 `version`，补全批次、待核对列表与完整标记；升级幂等。

## 主要接口

```
GET    /api/pigeons[/:ringNo]
POST   /api/pigeons
GET    /api/pigeons/:ringNo/relation
PATCH  /api/pigeons/:ringNo/lineage
POST   /api/pigeons/:ringNo/transfers          { to, expectedVersion?, expectedOwner? }
POST   /api/pigeons/:ringNo/vaccines
POST   /api/pigeons/:ringNo/races
GET    /api/offline-batches[ /:batchId]
POST   /api/offline-batches
GET    /api/reviews?status=pending
POST   /api/reviews/:id/resolve                { action: accept|reject }
POST   /api/admin/recompute-lineage            # 全量重算完整标记
```
