/* ============================================================
 * 主页面（home.html）交互：欢迎语 + 今日概览
 * 数据来源：MySQL（后端 /api/intake、/api/auth/me）
 * ============================================================ */

(async () => {
  if (!(await Auth.requireLogin())) return;

  const session = Auth.current();
  if (!session) return;
  Auth.mountNavUser(document.getElementById("nav-user"));

  /* ---------- 欢迎语（按时段问候） ---------- */
  const h = new Date().getHours();
  const period = h < 6 ? "夜深了" : h < 11 ? "早上好" : h < 14 ? "中午好"
               : h < 18 ? "下午好" : h < 22 ? "晚上好" : "夜深了";
  document.getElementById("welcome-title").textContent =
    period + "，" + session.name + " 👋";

  /* ---------- 今日概览（与追踪页共用 MySQL 里同一份数据） ---------- */
  function todayStr() {
    const d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  function getGoal() {
    const saved = Number(Auth.user && Auth.user.goal) || 2000;
    return Math.max(800, Math.min(6000, saved));
  }

  /* ---------- 区块3：今日餐食记录横向卡片 ---------- */
  function renderMeals(meals, loaded) {
    const list = document.getElementById("rec-meals");
    const empty = document.getElementById("rec-meals-empty");
    if (!list || !empty) return;
    empty.hidden = meals.length > 0;
    empty.querySelector("p").textContent = loaded ? "今天还没有记录，去分析第一餐吧。" : "今日餐食加载失败，可刷新重试";
    list.innerHTML = meals.map((m) => `
      <div class="meal-card">
        <div class="meal-card-top">
          <img class="mini-thumb" src="${mealThumbnail(m.name)}" alt="" loading="lazy" decoding="async">
          <div>
            <p class="meal-card-name">${String(m.name).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]))}</p>
            <p class="meal-card-meta">P${Math.round(m.protein)}g · C${Math.round(m.carb)}g · F${Math.round(m.fat)}g</p>
          </div>
        </div>
        <p class="meal-card-kcal">${Math.round(m.calories)} <small>kcal</small></p>
      </div>`).join("");
  }

  async function renderOverview() {
    const log = { calories: 0, protein: 0, carb: 0, fat: 0 };
    let loaded = false;
    try {
      const data = await apiFetch("/api/intake?date=" + todayStr());
      for (const m of data.meals) {
        log.calories += Number(m.calories); log.protein += Number(m.protein);
        log.carb += Number(m.carb); log.fat += Number(m.fat);
      }
      renderMeals(data.meals, true);
      loaded = true;
    } catch {
      renderMeals([], false);
    }

    const goal = getGoal();
    const pct = Math.min((log.calories / goal) * 100, 100);

    document.getElementById("ov-calorie").textContent = loaded ? Math.round(log.calories) : "—";
    document.getElementById("ov-goal").textContent = goal;
    const fill = document.getElementById("ov-fill");
    fill.style.width = pct + "%";
    fill.style.background = log.calories > goal
      ? "linear-gradient(90deg,#ef4444,#f87171)" : "";
    document.getElementById("ov-protein").textContent = loaded ? Math.round(log.protein) + "g" : "—";
    document.getElementById("ov-carb").textContent = loaded ? Math.round(log.carb) + "g" : "—";
    document.getElementById("ov-fat").textContent = loaded ? Math.round(log.fat) + "g" : "—";

    // 运动中心同步：读取今日运动消耗（localStorage，由 exercise.js 写入）
    const exKey = "shijian_exercise_v2_" + encodeURIComponent(session.name) + "_" + todayStr();
    let ex = null;
    try { ex = JSON.parse(localStorage.getItem(exKey)); } catch { /* 忽略 */ }
    const exEl = document.getElementById("ov-exercise");
    if (Array.isArray(ex?.records) && ex.burn > 0) {
      exEl.textContent = "🏃 今日运动消耗 " + Math.round(ex.burn) + " kcal";
      exEl.hidden = false;
    } else {
      exEl.hidden = true;
    }
  }

  renderOverview();
  // 从分析页返回主页时刷新数据（bfcache 场景）
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) renderOverview();
  });
})();

/* ============================================================
 * 侧栏：饮水打卡（本地存储，按天记录）
 * ============================================================ */
(() => {
  const GOAL = 2000, STEP = 200, DEFAULT = 1200;
  const nowEl = document.getElementById("water-now");
  const fillEl = document.getElementById("water-fill");
  const btn = document.getElementById("water-add");
  if (!nowEl || !fillEl || !btn) return;

  const d = new Date();
  const key = "shijian_water_" + d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

  let ml = Number(localStorage.getItem(key)) || DEFAULT;

  function render() {
    nowEl.textContent = ml;
    fillEl.style.width = Math.min((ml / GOAL) * 100, 100) + "%";
    btn.disabled = ml >= GOAL;
    btn.textContent = ml >= GOAL ? "今日目标已完成 🎉" : "＋ 记一杯 200ml";
  }

  btn.addEventListener("click", () => {
    ml = Math.min(GOAL, ml + STEP);
    localStorage.setItem(key, ml);
    render();
  });

  render();
})();