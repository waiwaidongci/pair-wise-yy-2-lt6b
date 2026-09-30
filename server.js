import http from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { JsonStore } from "./src/store/json-store.js";
import { createService } from "./src/service.js";
import { createRouter } from "./src/api/router.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || join(__dirname, "data", "pigeons.json");
const port = Number(process.env.PORT || 3024);

const store = new JsonStore(dbPath);
const service = createService(store);
const router = createRouter(service);

const server = http.createServer((req, res) => router(req, res));

store.init().then(() => {
  server.listen(port, () => console.log(`Racing pigeon registry app listening on http://localhost:${port}`));
});
