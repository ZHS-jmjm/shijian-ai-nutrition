/* ============================================================
 * 数据库连接与初始化（mysql2 连接池）
 *
 * ⚠️ MySQL 连接信息优先从 server/.env 环境变量读取（DB_HOST /
 *    DB_USER / DB_PASSWORD / DB_NAME）；未配置 .env 时使用下面的默认值。
 *    如果你的 root 密码不是 123456，在 server/.env 里改 DB_PASSWORD 即可。
 * ============================================================ */

const mysql = require("mysql2/promise");
const crypto = require("crypto");
const { promisify } = require("util");
const scrypt = promisify(crypto.scrypt);

const DB_CONFIG = {
  host: process.env.DB_HOST || "127.0.0.1",
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASSWORD || "123456",   // ← 在 server/.env 的 DB_PASSWORD 里改
  database: process.env.DB_NAME || "shijian_nutrition",
  charset: "utf8mb4",
  waitForConnections: true,
  connectionLimit: 10,
};

/* 连接池：整个应用共用，自动管理连接 */
const pool = mysql.createPool(DB_CONFIG);

/* 异步计算密码散列，沿用数据库中的 "salt:key" 格式 */
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString("hex");
  const key = await scrypt(String(pw), salt, 64);
  return salt + ":" + key.toString("hex");
}

async function verifyPassword(pw, stored) {
  const [salt, key] = String(stored).split(":");
  if (!salt || !/^[a-f0-9]{128}$/i.test(key)) return false;
  const calc = await scrypt(String(pw), salt, 64);
  return crypto.timingSafeEqual(calc, Buffer.from(key, "hex"));
}

/**
 * 启动时自动建库建表 + 确保演示账号存在（幂等，可重复执行）
 * 这样「npm start」一把梭，不需要手动导 SQL。
 */
async function initDatabase() {
  // 1. 先不带 database 连上，确保库存在
  const bare = await mysql.createConnection({
    host: DB_CONFIG.host, port: DB_CONFIG.port,
    user: DB_CONFIG.user, password: DB_CONFIG.password,
    charset: "utf8mb4",
  });
  try {
    await bare.query(
      "CREATE DATABASE IF NOT EXISTS ?? DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci",
      [DB_CONFIG.database]
    );
  } finally {
    await bare.end();
  }

  // 2. 建表
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            INT UNSIGNED     NOT NULL AUTO_INCREMENT,
      username      VARCHAR(50)      NOT NULL,
      password_hash VARCHAR(255)     NOT NULL,
      goal          INT              NOT NULL DEFAULT 2000,
      created_at    TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_users_username (username)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户表'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      user_id      INT UNSIGNED NOT NULL,
      display_name VARCHAR(50)  NOT NULL DEFAULT '',
      avatar       ENUM('initial','leaf','grain','berry') NOT NULL DEFAULT 'initial',
      PRIMARY KEY (user_id),
      CONSTRAINT fk_profiles_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='用户个人资料'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      token      CHAR(64)     NOT NULL,
      user_id    INT UNSIGNED NOT NULL,
      created_at TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME     NOT NULL,
      PRIMARY KEY (token),
      CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='登录会话表'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS intake_meals (
      id         INT UNSIGNED   NOT NULL AUTO_INCREMENT,
      user_id    INT UNSIGNED   NOT NULL,
      meal_date  DATE           NOT NULL,
      name       VARCHAR(100)   NOT NULL,
      calories   DECIMAL(8,2)   NOT NULL DEFAULT 0,
      protein    DECIMAL(8,2)   NOT NULL DEFAULT 0,
      carb       DECIMAL(8,2)   NOT NULL DEFAULT 0,
      fat        DECIMAL(8,2)   NOT NULL DEFAULT 0,
      created_at TIMESTAMP      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_user_date (user_id, meal_date),
      CONSTRAINT fk_meals_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='今日摄入明细'
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS analysis_history (
      id         INT UNSIGNED  NOT NULL AUTO_INCREMENT,
      user_id    INT UNSIGNED  NOT NULL,
      source     ENUM('image','text') NOT NULL DEFAULT 'text',
      food_text  VARCHAR(500)  NULL,
      score      INT           NULL,
      calories   DECIMAL(8,2)  NULL,
      protein    DECIMAL(8,2)  NULL,
      carb       DECIMAL(8,2)  NULL,
      fat        DECIMAL(8,2)  NULL,
      fiber      DECIMAL(8,2)  NULL,
      report     JSON          NULL,
      created_at TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_history_user (user_id, created_at),
      CONSTRAINT fk_history_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='AI 分析历史'
  `);

  // 3. 确保演示账号 test / 123456 存在
  const [rows] = await pool.query("SELECT id FROM users WHERE username = ?", ["test"]);
  if (!rows.length) {
    try {
      await pool.query(
        "INSERT INTO users (username, password_hash, goal) VALUES (?, ?, ?)",
        ["test", await hashPassword("123456"), 2000]
      );
      console.log("已创建演示账号：test / 123456");
    } catch (err) {
      if (err.code !== "ER_DUP_ENTRY") throw err;
    }
  }
}

module.exports = { pool, initDatabase, hashPassword, verifyPassword, DB_CONFIG };
