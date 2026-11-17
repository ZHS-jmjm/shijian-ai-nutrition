/* ============================================================
 * 食鉴 · AI 营养分析师 —— 后端服务（Express + MySQL）
 *
 * 启动：在 server 目录下执行  npm start   （或双击项目根目录的 启动.bat）
 * 访问：http://localhost:3000
 *
 * 职责：
 *   1. 托管前端页面与静态资源
 *   2. 提供 REST API：注册 / 登录 / 会话、个人资料、今日摄入记录、每日目标、
 *      AI 分析历史 —— 数据全部落到 MySQL（shijian_nutrition 库）
 * ============================================================ */

const express = require("express");
const crypto = require("crypto");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

/* ---------- 读取同目录 .env 环境变量（零依赖实现，真实环境变量优先）
 * 必须在 require("./db") 之前执行，保证数据库/AI 配置都能读到 ---------- */
(function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  }
})();

const { pool, initDatabase, hashPassword, verifyPassword, DB_CONFIG } = require("./db");
const startLocalDatabase = require("./local-db");

const PORT = Number(process.env.APP_PORT || 3000);
const bundledMysql = path.join(__dirname, "..", ".runtime", "mysql", "bin", "mysqld.exe");
const listenHost = fs.existsSync(bundledMysql) ? "127.0.0.1" : undefined;
const SESSION_DAYS = 7;
const PASSWORD_MIN_LENGTH = 6;
const PASSWORD_MAX_LENGTH = 30;
const DISPLAY_NAME_MAX_LENGTH = 32;
const AVATARS = new Set(["initial", "leaf", "grain", "berry"]);

const app = express();

/* ---------- CORS：允许页面从其他来源调用本后端 ----------
 * 页面可能不是由本后端托管的，比如 IntelliJ 内置预览（localhost:63342）、
 * 双击 HTML 文件（file://）——放行这些来源，登录和数据接口照常可用 */
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});
app.use(express.json({ limit: "1mb" }));

/* Express 4 需要显式转交异步异常，统一由末尾的错误中间件处理。 */
function handled(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function inTransaction(operation) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (err) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      connection.destroy();
      throw rollbackError;
    }
    throw err;
  } finally {
    connection.release();
  }
}

function publicUser(user) {
  return {
    username: user.username,
    goal: user.goal,
    displayName: user.display_name ?? "",
    avatar: user.avatar ?? "initial",
  };
}

/* ---------- 会话校验中间件：从 Authorization: Bearer <token> 解出当前用户 ---------- */
const requireUser = handled(async (req, res, next) => {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) return res.status(401).json({ ok: false, msg: "未登录" });

  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.goal, p.display_name, p.avatar FROM sessions s
     JOIN users u ON u.id = s.user_id
     LEFT JOIN user_profiles p ON p.user_id = u.id
     WHERE s.token = ? AND s.expires_at > NOW()`,
    [token]
  );
  if (!rows.length) return res.status(401).json({ ok: false, msg: "登录已过期，请重新登录" });
  req.user = rows[0];
  req.sessionToken = token;
  next();
});

/* ============================================================
 * 认证接口
 * ============================================================ */

app.post("/api/auth/register", handled(async (req, res) => {
  const name = String(req.body.username || "").trim();
  const pw = String(req.body.password || "");
  if (name.length < 2) return res.json({ ok: false, msg: "用户名至少 2 个字符" });
  if (name.length > 50) return res.json({ ok: false, msg: "用户名最长 50 个字符" });
  if (pw.length < PASSWORD_MIN_LENGTH) return res.json({ ok: false, msg: "密码至少 6 位" });
  if (pw.length > PASSWORD_MAX_LENGTH) return res.json({ ok: false, msg: "密码最长 30 位" });

  const passwordHash = await hashPassword(pw);
  let token;
  try {
    token = await inTransaction(async (connection) => {
      const [r] = await connection.query(
        "INSERT INTO users (username, password_hash, goal) VALUES (?, ?, 2000)",
        [name, passwordHash]
      );
      return createSession(r.insertId, connection);
    });
  } catch (err) {
    if (err.code === "ER_DUP_ENTRY") {
      return res.json({ ok: false, msg: "这个用户名已经被注册啦，换一个试试" });
    }
    throw err;
  }
  cleanupExpiredSessions();
  return res.json({ ok: true, token, user: publicUser({ username: name, goal: 2000 }) });
}));

app.post("/api/auth/login", handled(async (req, res) => {
  const name = String(req.body.username || "").trim();
  const pw = String(req.body.password || "");

  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.goal, u.password_hash, p.display_name, p.avatar
     FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id WHERE u.username = ?`,
    [name]
  );
  if (!rows.length) return res.json({ ok: false, msg: "用户名不存在，先注册一个吧" });
  const u = rows[0];
  if (!(await verifyPassword(pw, u.password_hash))) return res.json({ ok: false, msg: "密码不对，再想想？" });

  // 登录与修改密码按相同顺序锁定账户，防止旧密码校验通过后才写入新会话。
  const token = await inTransaction(async (connection) => {
    const [[current]] = await connection.query("SELECT password_hash FROM users WHERE id = ? FOR UPDATE", [u.id]);
    if (current?.password_hash !== u.password_hash) return null;
    return createSession(u.id, connection);
  });
  if (!token) return res.json({ ok: false, msg: "密码已更新，请使用新密码登录" });
  cleanupExpiredSessions();
  return res.json({ ok: true, token, user: publicUser(u) });
}));

/** 生成会话 token（随机 64 位十六进制）并写入 sessions 表 */
async function createSession(userId, connection) {
  const token = crypto.randomBytes(32).toString("hex");
  await connection.query(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? DAY))",
    [token, userId, SESSION_DAYS]
  );
  return token;
}

/* 每小时最多发起一次清理，会话有效性仍由 requireUser 实时检查。 */
let nextSessionCleanup = 0;
function cleanupExpiredSessions() {
  const now = Date.now();
  if (now < nextSessionCleanup) return;
  nextSessionCleanup = now + 60 * 60 * 1000;
  pool.query("DELETE FROM sessions WHERE expires_at <= NOW()").catch(() => {});
}

app.post("/api/auth/logout", requireUser, handled(async (req, res) => {
  await pool.query("DELETE FROM sessions WHERE token = ?", [req.sessionToken]);
  res.json({ ok: true });
}));

/* 当前登录用户信息（含每日目标），页面加载时用它恢复登录态 */
app.get("/api/auth/me", requireUser, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

app.put("/api/profile", requireUser, handled(async (req, res) => {
  const { displayName, avatar } = req.body;
  if (typeof displayName !== "string" || !AVATARS.has(avatar)) {
    return res.status(400).json({ ok: false, msg: "请输入有效的昵称并选择头像" });
  }

  const name = displayName.trim();
  if (name.length > DISPLAY_NAME_MAX_LENGTH) {
    return res.status(400).json({ ok: false, msg: "昵称最长 32 个字符" });
  }
  await pool.query(
    `INSERT INTO user_profiles (user_id, display_name, avatar) VALUES (?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = ?, avatar = ?`,
    [req.user.id, name, avatar, name, avatar]
  );
  res.json({ ok: true, profile: { displayName: name, avatar } });
}));

app.post("/api/auth/password", requireUser, handled(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (typeof currentPassword !== "string" || !currentPassword) {
    return res.status(400).json({ ok: false, msg: "请输入当前密码" });
  }
  if (typeof newPassword !== "string" || newPassword.length < PASSWORD_MIN_LENGTH) {
    return res.status(400).json({ ok: false, msg: "新密码至少 6 位" });
  }
  if (newPassword.length > PASSWORD_MAX_LENGTH) {
    return res.status(400).json({ ok: false, msg: "新密码最长 30 位" });
  }
  if (currentPassword === newPassword) {
    return res.status(400).json({ ok: false, msg: "新密码必须与当前密码不同" });
  }

  const [[account]] = await pool.query("SELECT password_hash FROM users WHERE id = ?", [req.user.id]);
  if (!account) return res.status(401).json({ ok: false, msg: "登录已过期，请重新登录" });
  if (!(await verifyPassword(currentPassword, account.password_hash))) {
    return res.status(400).json({ ok: false, msg: "当前密码不正确" });
  }

  const passwordHash = await hashPassword(newPassword);
  const status = await inTransaction(async (connection) => {
    const [[locked]] = await connection.query(
      "SELECT password_hash FROM users WHERE id = ? FOR UPDATE", [req.user.id]
    );
    const [[session]] = await connection.query(
      "SELECT token FROM sessions WHERE token = ? AND user_id = ? AND expires_at > NOW() FOR UPDATE",
      [req.sessionToken, req.user.id]
    );
    if (!locked || !session) return 401;
    if (locked.password_hash !== account.password_hash) return 409;

    await connection.query("UPDATE users SET password_hash = ? WHERE id = ?", [passwordHash, req.user.id]);
    await connection.query("DELETE FROM sessions WHERE user_id = ? AND token <> ?", [req.user.id, req.sessionToken]);
    return 200;
  });

  if (status === 401) return res.status(401).json({ ok: false, msg: "登录已过期，请重新登录" });
  if (status === 409) return res.status(409).json({ ok: false, msg: "密码已更新，请确认当前密码后重试" });
  return res.json({ ok: true });
}));

/* ---------- 每日热量目标 ---------- */
app.put("/api/goal", requireUser, handled(async (req, res) => {
  const goal = Math.round(Math.max(800, Math.min(6000, Number(req.body.goal) || 2000)));
  await pool.query("UPDATE users SET goal = ? WHERE id = ?", [goal, req.user.id]);
  res.json({ ok: true, goal });
}));

/* ============================================================
 * 今日摄入接口（每餐一行，与前端「单餐删除」交互对应）
 * ============================================================ */

/* GET /api/intake?date=2026-11-11 → 该日的所有餐次 */
app.get("/api/intake", requireUser, handled(async (req, res) => {
  const date = normDate(req.query.date);
  const [rows] = await pool.query(
    `SELECT id, name, calories, protein, carb, fat, created_at
     FROM intake_meals WHERE user_id = ? AND meal_date = ? ORDER BY id`,
    [req.user.id, date]
  );
  res.json({ ok: true, meals: rows });
}));

/* POST /api/intake {date, name, calories, protein, carb, fat} → 新增一餐 */
app.post("/api/intake", requireUser, handled(async (req, res) => {
  const date = normDate(req.body.date);
  const name = String(req.body.name || "一餐").slice(0, 100);
  const num = (v) => Math.max(0, Number(v) || 0);

  const [r] = await pool.query(
    `INSERT INTO intake_meals (user_id, meal_date, name, calories, protein, carb, fat)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, date, name, num(req.body.calories), num(req.body.protein), num(req.body.carb), num(req.body.fat)]
  );
  res.json({
    ok: true,
    meal: { id: r.insertId, name, calories: num(req.body.calories), protein: num(req.body.protein), carb: num(req.body.carb), fat: num(req.body.fat) },
  });
}));

/* DELETE /api/intake/:id → 删除单餐 */
app.delete("/api/intake/:id", requireUser, handled(async (req, res) => {
  await pool.query("DELETE FROM intake_meals WHERE id = ? AND user_id = ?", [req.params.id, req.user.id]);
  res.json({ ok: true });
}));

/* ============================================================
 * AI 分析历史接口（分析成功后前端自动上报一份，方便回看/统计）
 * ============================================================ */

app.post("/api/history", requireUser, handled(async (req, res) => {
  const r = req.body.report || {};
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : null);
  await pool.query(
    `INSERT INTO analysis_history
       (user_id, source, food_text, score, calories, protein, carb, fat, fiber, report)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      req.user.id,
      req.body.source === "image" ? "image" : "text",
      String(req.body.foodText || "").slice(0, 500) || null,
      num(r.score), num(r.calories), num(r.protein), num(r.carb), num(r.fat), num(r.fiber),
      JSON.stringify(r),
    ]
  );
  res.json({ ok: true });
}));

app.get("/api/history", requireUser, handled(async (req, res) => {
  const limit = Math.trunc(Math.max(1, Math.min(50, Number(req.query.limit) || 20)));
  const [rows] = await pool.query(
    `SELECT id, source, food_text, score, calories, protein, carb, fat, fiber, created_at
     FROM analysis_history WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    [req.user.id, limit]
  );
  res.json({ ok: true, items: rows });
}));

/* ============================================================
 * AI 接口中转（DeepSeek）—— API Key 只存在于本进程的环境变量里，
 * 前端只把对话内容 POST 到这里，浏览器中不存在任何密钥
 * ============================================================ */

const AI = {
  get key() { return process.env.AI_API_KEY || ""; },
  get baseURL() { return (process.env.AI_BASE_URL || "https://api.deepseek.com/v1").replace(/\/+$/, ""); },
  get model() { return process.env.AI_MODEL || "deepseek-flash"; },
  get maxTokens() { return Number(process.env.AI_MAX_TOKENS) || 3000; },
  get reasoningEffort() { return process.env.AI_REASONING_EFFORT || "low"; },
  get timeout() { return Number(process.env.AI_TIMEOUT) || 90000; },
};

/* GET /api/ai/status → 前端判断服务器是否配置了真实 AI（没配则走演示数据） */
app.get("/api/ai/status", (req, res) => {
  res.json({ ok: true, enabled: !!AI.key });
});

/* POST /api/ai/chat {messages:[...], wantJson?:bool} → 透传 DeepSeek 响应
 * messages 原样转发（OpenAI 兼容格式，含图片 content 数组），服务器不做内容理解 */
app.post("/api/ai/chat", requireUser, handled(async (req, res) => {
  if (!AI.key) {
    return res.status(503).json({
      ok: false,
      code: "AI_NOT_CONFIGURED",
      msg: "AI 服务未配置：请在 server/.env 里填写 AI_API_KEY",
    });
  }

  const messages = Array.isArray(req.body.messages) ? req.body.messages : null;
  if (!messages || !messages.length) return res.status(400).json({ ok: false, msg: "缺少 messages 参数" });
  const wantJson = !!req.body.wantJson;

  /* 推理模型偶尔把 max_tokens 预算耗光导致正文为空，空则翻倍预算重试一次 */
  for (let attempt = 0; attempt < 2; attempt++) {
    const body = {
      model: AI.model,
      messages,
      temperature: wantJson ? 0.3 : 0.6,
      max_tokens: AI.maxTokens * (attempt + 1),
      reasoning_effort: AI.reasoningEffort,
    };
    if (wantJson) body.response_format = { type: "json_object" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI.timeout);
    try {
      const resp = await fetch(AI.baseURL + "/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + AI.key },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!resp.ok) {
        await resp.body?.cancel();
        console.error("[AI 上游错误]", resp.status);
        /* 只回状态码与简短提示，不透传上游原始报错（避免泄露账户信息） */
        const map = {
          401: "AI Key 无效或已失效，请联系管理员检查 server/.env",
          402: "AI 账户余额不足，请联系管理员充值",
          429: "AI 请求太频繁，请等几秒再试",
        };
        return res.status(502).json({
          ok: false,
          msg: "AI 接口返回 " + resp.status + (map[resp.status] ? "：" + map[resp.status] : ""),
        });
      }

      const json = await resp.json();
      const content = json.choices?.[0]?.message?.content;
      if (typeof content !== "string" || !content.trim()) {
        if (attempt === 0) continue;
        return res.status(502).json({ ok: false, msg: "AI 只输出了思考过程没有答案，请换一种描述方式再试" });
      }
      return res.json(json);
    } catch (e) {
      if (e.name === "AbortError") {
        return res.status(504).json({ ok: false, msg: "AI 响应超时，网络或模型响应太慢，稍后再试" });
      }
      console.error("[AI 调用异常]", e.message);
      return res.status(502).json({ ok: false, msg: "AI 服务暂时不可用，请稍后再试" });
    } finally {
      clearTimeout(timer);
    }
  }
}));

/* ---------- 工具：把任意日期输入规范成 YYYY-MM-DD ---------- */
function normDate(v) {
  const s = String(v || "");
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : new Date().toISOString().slice(0, 10);
}

/* ============================================================
 * 静态托管前端页面和资源
 * ============================================================ */
const ROOT = path.join(__dirname, "..");
const pages = [
  "index.html", "register.html", "home.html", "nutrition.html",
  "chat.html", "tracker.html", "exercise.html", "faq.html",
];
function sendPage(page) {
  return (req, res) => res.sendFile(page, { root: ROOT });
}
app.get("/", sendPage("index.html"));
for (const page of pages) {
  app.get("/" + page, sendPage(page));
}
for (const directory of ["css", "js", "image"]) {
  app.use("/" + directory, express.static(path.join(ROOT, directory)));
}

/* 统一错误处理：给 API 返回简短的 JSON 提示，数据库连接异常可以重试。 */
const dbUnavailableCodes = new Set([
  "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "PROTOCOL_CONNECTION_LOST",
  "ENOTFOUND", "EAI_AGAIN", "ER_CON_COUNT_ERROR", "ER_ACCESS_DENIED_ERROR",
]);
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  if (err.status === 400) return res.status(400).json({ ok: false, msg: "请求格式不正确" });
  if (err.status === 413) return res.status(413).json({ ok: false, msg: "请求内容过大，请缩小图片或减少内容后重试" });
  if (err.status === 404) return res.status(404).json({ ok: false, msg: "页面不存在" });
  console.error("[服务异常]", err.code || err.name);
  if (dbUnavailableCodes.has(err.code)) {
    return res.status(503).json({ ok: false, msg: "数据库暂时不可用，请稍后再试" });
  }
  return res.status(500).json({ ok: false, msg: "服务器出错了，请稍后再试" });
});

/* ============================================================
 * 启动：先自动建库建表，再监听端口
 * ============================================================ */
(async () => {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    console.error("APP_PORT 必须是 1 到 65535 之间的整数。");
    process.exit(1);
  }
  try {
    await startLocalDatabase(DB_CONFIG);
    await initDatabase();
    console.log("数据库就绪（表结构与演示账号已确认）");
  } catch (e) {
    console.error("数据库初始化失败：" + e.message);
    console.error("请确认 MySQL 正在运行，并检查 server/.env 里的数据库连接信息。");
    process.exit(1);
  }

  const listener = app.listen(PORT, listenHost, () => {
    const url = "http://localhost:" + PORT;
    console.log("");
    console.log("  食鉴 · AI 营养分析师 后端已启动");
    console.log("  ➜  请用浏览器打开  " + url);
    console.log("  ➜  演示账号        test / 123456");
    console.log("");
    if (process.platform === "win32" && process.argv.includes("--open")) {
      const browser = spawn("explorer.exe", [url], { detached: true, stdio: "ignore", windowsHide: true });
      browser.on("error", () => console.error("无法自动打开浏览器，请手动访问 " + url));
      browser.unref();
    }
  });
  listener.on("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      console.error("端口 " + PORT + " 已被占用。请关闭已有的食鉴窗口，或在 server/.env 里更改 APP_PORT。");
    } else {
      console.error("网站启动失败：" + error.message);
    }
    process.exitCode = 1;
    await pool.end().catch(() => {});
  });
})();
