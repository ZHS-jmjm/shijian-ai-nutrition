const { spawn } = require("node:child_process");
const { createHash, randomUUID } = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const net = require("node:net");
const { setTimeout: delay } = require("node:timers/promises");
const mysql = require("mysql2/promise");

const host = "127.0.0.1";
const legacyPort = 3307;
const runtimeDir = path.join(__dirname, "..", ".runtime");
const migrationFile = path.join(__dirname, "..", "database", "migration.sql");

function databaseListening(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (reachable) => {
      socket.destroy();
      resolve(reachable);
    };
    socket.setTimeout(500);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
  });
}

function realPath(location) {
  return fs.realpathSync.native(location).toLowerCase();
}

// MySQL 的 Windows 命令行对含非 ASCII 字符的路径兼容性有限。
// 目录联接提供一个英文路径，同时让数据库文件留在项目内。
function mysqlRuntimePath() {
  const actual = realPath(runtimeDir);
  if (/^[\x20-\x7e]+$/.test(actual)) return runtimeDir;

  const key = createHash("sha256").update(actual).digest("hex").slice(0, 24);
  for (const location of [process.env.LOCALAPPDATA, process.env.ProgramData]) {
    if (!location || !/^[\x20-\x7e]+$/.test(location)) continue;
    const aliases = path.join(location, "ShijianRuntime");
    const link = path.join(aliases, key);
    try {
      fs.mkdirSync(aliases, { recursive: true });
      try {
        fs.symlinkSync(runtimeDir, link, "junction");
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
      if (fs.lstatSync(link).isSymbolicLink() && realPath(link) === actual) return link;
    } catch {
      // 换另一个可用的目录。
    }
  }
  throw new Error("无法为 MySQL 创建兼容的本地路径。请将项目解压到纯英文路径，例如 C:\\Shijian。");
}

function runTool(executable, args, options) {
  return new Promise((resolve, reject) => {
    const process = spawn(executable, args, { windowsHide: true, stdio: "ignore", ...options });
    process.once("error", reject);
    process.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(path.basename(executable) + " 退出，代码 " + code + "。"));
    });
  });
}

function mysqlArgs(executable, dataDir) {
  return [
    "--no-defaults", "--basedir=" + path.dirname(path.dirname(executable)),
    "--datadir=" + dataDir, "--skip-log-bin",
  ];
}

async function initializeStorage(executable, dataDir) {
  if (fs.existsSync(path.join(dataDir, "mysql.ibd"))) return;
  if (fs.existsSync(dataDir)) {
    throw new Error("本地 MySQL 数据目录不完整。请保留此目录并检查数据库备份。");
  }

  const staging = fs.mkdtempSync(path.join(path.dirname(dataDir), "mysql-install-"));
  try {
    console.log("正在初始化本地 MySQL。首次启动可能需要片刻...");
    // MySQL 生成过期的临时密码。即使首次设置密码失败，也不会开放无密码的 root。
    const initLog = "mysql-initialize.err";
    await runTool(executable, [...mysqlArgs(executable, staging), "--initialize", "--log-error=" + initLog], { cwd: staging });
    fs.rmSync(path.join(staging, initLog), { force: true });
    fs.writeFileSync(path.join(staging, ".needs-password"), "");
    if (fs.existsSync(migrationFile)) fs.writeFileSync(path.join(staging, ".migration-pending"), "");
    fs.renameSync(staging, dataDir);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

async function assertOwnedInstance(config, dataDir) {
  const connection = await mysql.createConnection({
    host, port: config.port, user: config.user, password: config.password, connectTimeout: 1500,
  });
  try {
    const [[row]] = await connection.query("SELECT @@datadir AS dataDir");
    if (realPath(row.dataDir) !== realPath(dataDir)) {
      throw new Error("端口 " + config.port + " 上的 MySQL 使用另一个数据目录。请关闭其他实例或更换 DB_PORT。");
    }
  } finally {
    await connection.end().catch(() => {});
  }
}

async function startMysql(executable, dataDir, port, initFile) {
  const args = [
    ...mysqlArgs(executable, dataDir), "--bind-address=" + host, "--port=" + port,
    "--mysqlx=OFF", "--log-error=shijian-mysql.err",
  ];
  if (initFile) args.push("--init-file=" + initFile);

  console.log("正在启动项目的本地 MySQL（" + port + "）...");
  const child = spawn(executable, args, { cwd: dataDir, detached: true, windowsHide: true, stdio: "ignore" });
  let launchError;
  child.once("error", (err) => { launchError = err; });
  child.unref();

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (await databaseListening(port)) return;
    await delay(250);
  }
  throw new Error("本地 MySQL 未就绪，请查看 .runtime/mysql-data/shijian-mysql.err。");
}

async function importMigration(executable, config, dataDir) {
  const pending = path.join(dataDir, ".migration-pending");
  if (!fs.existsSync(pending)) return;

  console.log("正在导入食鉴的迁移数据...");
  const input = fs.openSync(migrationFile, "r");
  try {
    await runTool(path.join(path.dirname(executable), "mysql.exe"), [
      "--no-defaults", "--host=" + host, "--port=" + config.port, "--user=" + config.user,
      "--protocol=TCP", "--default-character-set=utf8mb4", "--binary-mode",
    ], { stdio: [input, "ignore", "inherit"], env: { ...process.env, MYSQL_PWD: config.password } });
    fs.unlinkSync(pending);
  } finally {
    fs.closeSync(input);
  }
}

async function startLocalDatabase(config) {
  if (process.platform !== "win32" || ![host, "localhost"].includes(config.host)) return;
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    throw new Error("DB_PORT 必须是 1 到 65535 之间的整数。");
  }

  const bundled = path.join(runtimeDir, "mysql", "bin", "mysqld.exe");
  if (!fs.existsSync(bundled)) {
    // 兼容本机以前的启动配置。迁移包使用相对目录里的 MySQL。
    const settingsFile = path.join(runtimeDir, "mysql-local.json");
    if (config.port !== legacyPort || !fs.existsSync(settingsFile) || await databaseListening(config.port)) return;
    const settings = JSON.parse(fs.readFileSync(settingsFile, "utf8"));
    const executable = path.resolve(runtimeDir, settings.executable);
    const dataDir = path.resolve(runtimeDir, settings.dataDir);
    if (!fs.existsSync(executable)) throw new Error("找不到项目配置的 MySQL 程序：" + executable);
    if (!fs.existsSync(path.join(dataDir, "mysql.ibd"))) throw new Error("找不到项目的 MySQL 数据目录：" + dataDir);
    await startMysql(executable, dataDir, config.port);
    return;
  }

  const runtime = mysqlRuntimePath();
  const executable = path.join(runtime, "mysql", "bin", "mysqld.exe");
  const dataDir = path.join(runtime, "mysql-data");
  const passwordMarker = path.join(dataDir, ".needs-password");
  if (await databaseListening(config.port)) {
    if (!fs.existsSync(path.join(dataDir, "mysql.ibd"))) {
      throw new Error("本地数据库端口 " + config.port + " 已被占用。请关闭其他实例或更换 DB_PORT。");
    }
    await assertOwnedInstance(config, dataDir);
    fs.rmSync(passwordMarker, { force: true });
  } else {
    if (!fs.existsSync(path.join(dataDir, "mysql.ibd")) && (config.user !== "root" || !config.password)) {
      throw new Error("首次初始化本地 MySQL 需要在 server/.env 中配置 root 和数据库密码。");
    }
    await initializeStorage(executable, dataDir);
    let initFile;
    try {
      if (fs.existsSync(passwordMarker)) {
        initFile = path.join(runtime, "mysql-password-" + randomUUID() + ".sql");
        fs.writeFileSync(initFile, "SET NAMES utf8mb4;\nALTER USER 'root'@'localhost' IDENTIFIED BY " +
          mysql.escape(config.password) + ";\n", { flag: "wx", mode: 0o600 });
      }
      await startMysql(executable, dataDir, config.port, initFile);
      await assertOwnedInstance(config, dataDir);
      fs.rmSync(passwordMarker, { force: true });
    } finally {
      if (initFile) fs.rmSync(initFile, { force: true });
    }
  }
  await importMigration(executable, config, dataDir);
}

module.exports = startLocalDatabase;
