import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { buildSeed } from "../rules/seed.js";
import { migrate } from "../rules/migration.js";

/**
 * JSON 文件存储：
 * - 首次运行写入 v2 种子；
 * - 旧文件在加载时原地升级（按最初归属补第一版）；
 * - mutate 串行执行并“先改后落盘”，保证两人同时提交时规则层看到的版本号是最新的；
 * - 写入走临时文件 + rename，避免半写文件。
 */
export class JsonStore {
  constructor(filePath, { clock = () => new Date() } = {}) {
    this.filePath = filePath;
    this.clock = clock;
    this.db = null;
    this.tail = Promise.resolve();
  }

  async init() {
    if (this.db) return this.db;
    if (!existsSync(this.filePath)) {
      await mkdir(dirname(this.filePath), { recursive: true });
      this.db = buildSeed();
      await this.#flush();
      return this.db;
    }
    const raw = await readFile(this.filePath, "utf8");
    const parsed = raw.trim() ? JSON.parse(raw) : buildSeed();
    const { db } = migrate(parsed);
    this.db = db;
    await this.#flush();
    return this.db;
  }

  read() {
    return this.db;
  }

  /** 串行化的读-改-写事务，mutator 返回什么就透传什么。 */
  mutate(mutator) {
    const run = this.tail.then(async () => {
      const result = await mutator(this.db, this.clock());
      await this.#flush();
      return result;
    });
    // 单个事务失败不阻断后续事务。
    this.tail = run.then(() => undefined, () => undefined);
    return run;
  }

  async #flush() {
    const tmp = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(this.db, null, 2));
    await rename(tmp, this.filePath);
  }
}
