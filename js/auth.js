/* ============================================================
 * 登录态管理（MySQL 后端版）
 * - 注册 / 登录走 POST /api/auth/*，账号存在 MySQL users 表
 * - 会话 token 存 localStorage（shijian_token），7 天有效
 * - 内置演示账号：test / 123456（后端启动时自动创建）
 * - 所有请求封装在全局 apiFetch() 里，别的 js 文件也能用
 * ============================================================ */

/* 正式页面跟随当前站点端口，文件和 IntelliJ 的本地预览使用默认后端地址。 */
const API_BASE = location.protocol === "file:" || location.port === "63342"
  ? "http://localhost:3000"
  : "";

/* 站内链接点击 → 打导航标记（供 requireLogin 判定"来自站内"，与登录态无关） */
document.addEventListener("click", (e) => {
  const a = e.target && e.target.closest ? e.target.closest('a[href$=".html"]') : null;
  if (a) { try { sessionStorage.setItem("shijian_nav", String(Date.now())); } catch (err) {} }
});

/** 统一的后端请求函数：自动带上会话 token，非 2xx 抛错 */
async function apiFetch(url, options = {}) {
  const token = localStorage.getItem("shijian_token");
  const signal = options.signal || AbortSignal.timeout(12000);
  const resp = await fetch(API_BASE + url, {
    method: options.method || (options.body !== undefined ? "POST" : "GET"),
    headers: {
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal,
  });
  const data = await resp.json().catch(() => {
    signal.throwIfAborted();
    if (resp.ok) throw new Error("服务器返回的数据格式有误");
    return {};
  });
  if (!resp.ok) {
    const err = new Error(data.msg || "请求失败（" + resp.status + "）");
    err.status = resp.status;
    err.code = data.code;
    throw err;
  }
  return data;
}

const Auth = {
  KEY_TOKEN: "shijian_token",
  user: null,            // 登录后缓存的当前用户 { username, goal }
  _readyPromise: null,   // 只初始化一次

  /** 页面加载时调用一次：用 token 换取当前用户信息（GET /api/auth/me） */
  ready() {
    if (!this._readyPromise) {
      this._readyPromise = (async () => {
        const token = localStorage.getItem(this.KEY_TOKEN);
        if (!token) return null;
        try {
          const data = await apiFetch("/api/auth/me");
          if (localStorage.getItem(this.KEY_TOKEN) === token) this.user = data.user;
        } catch (err) {
          if (err.status === 401 && localStorage.getItem(this.KEY_TOKEN) === token) {
            localStorage.removeItem(this.KEY_TOKEN);
          }
        }
        return this.user;
      })();
    }
    return this._readyPromise;
  },

  /** 同步获取当前会话（须先 await Auth.ready()），形状与旧版一致：{name} 或 null */
  current() {
    return this.user ? { name: this.user.username } : null;
  },

  async register(name, pw) {
    try {
      const data = await apiFetch("/api/auth/register", { method: "POST", body: { username: name, password: pw } });
      if (!data.ok) return { ok: false, msg: data.msg };
      localStorage.setItem(this.KEY_TOKEN, data.token);
      this.user = data.user;
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.status ? e.message : "连不上服务器，请先启动后端（双击 启动.bat）" };
    }
  },

  async login(name, pw) {
    try {
      const data = await apiFetch("/api/auth/login", { method: "POST", body: { username: name, password: pw } });
      if (!data.ok) return { ok: false, msg: data.msg };
      localStorage.setItem(this.KEY_TOKEN, data.token);
      this.user = data.user;
      return { ok: true };
    } catch (e) {
      return { ok: false, msg: e.status ? e.message : "连不上服务器，请先启动后端（双击 启动.bat）" };
    }
  },

  async logout() {
    try { await apiFetch("/api/auth/logout", { method: "POST" }); } catch { /* token 已失效也照样退出 */ }
    localStorage.removeItem(this.KEY_TOKEN);
    this.user = null;
    location.replace("index.html");
  },

  /** 页面守卫：未登录跳回登录页（用于 home / nutrition 等内页）
   *  只校验登录态是否有效；登录有效就放行，不再要求"3 秒内从站内点过来"，
   *  避免不同浏览器 referrer/sessionStorage 差异导致的误踢回登录页 */
  async requireLogin() {
    await this.ready();
    if (this.current()) return true;
    location.replace("index.html");
    return false;
  },

  /** 登录页用：保持"启动先见登录页"，不再自动跳转主页面 */
  async redirectIfLoggedIn() {
    await this.ready();
  },

  /** 在导航栏渲染用户区（传入容器元素；内部会先等登录态就绪） */
  async mountNavUser(el) {
    await this.ready();
    const session = this.current();
    if (!el || !session) return;
    el.innerHTML =
      '<span class="nav-username">👋 ' + this.escapeHtml(session.name) + "</span>" +
      '<button class="nav-logout" id="logout-btn">退出登录</button>';
    document.getElementById("logout-btn").addEventListener("click", () => this.logout());
  },

  escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  },
};
