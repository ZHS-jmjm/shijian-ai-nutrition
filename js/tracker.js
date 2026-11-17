/* ============================================================
 * 今日摄入页（tracker.html）— 双卡仪表盘版
 * 数据存 MySQL：
 *  - 左卡：热量环 + 三餐签到（按记录时间分早/午/晚餐）+
 *          达成统计 + 近7日签到网格 + 近7日每日摄入柱状图
 *  - 右卡：今日三大营养素 + 近7日趋势平滑曲线
 *  - 餐食记录列表（可删除单条）
 * 三餐分槽规则：按数据库 created_at 的小时数
 *  <11 点 → 早餐；11~16 点 → 午餐；16 点以后 → 晚餐
 * ============================================================ */
(async () => {
  if (!(await Auth.requireLogin())) return;
  Auth.mountNavUser(document.getElementById("nav-user"));

  const $ = (id) => document.getElementById(id);

  /* ---------- 工具 ---------- */
  function pad(n) { return String(n).padStart(2, "0"); }
  function dateKey(d) {
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }
  function getGoal() {
    return Math.max(800, Math.min(6000, Number($("goal-input").value) || 2000));
  }
  /* 三餐分槽：b=早餐 l=午餐 d=晚餐 */
  function slotOf(meal) {
    const h = meal.created_at ? new Date(meal.created_at).getHours() : 12;
    return h < 11 ? "b" : h < 16 ? "l" : "d";
  }
  const WD = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  /* 把任意数值向上取成"好看"的刻度上限 */
  function niceMax(v) {
    if (!v || v <= 0) return 100;
    const exp = Math.pow(10, Math.floor(Math.log10(v)));
    for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) {
      if (m * exp >= v) return m * exp;
    }
    return 10 * exp;
  }
  /* Catmull-Rom → 三次贝塞尔，画平滑曲线（lo/hi 限制控制点范围，防止曲线越过坐标区） */
  function smoothPath(pts, lo, hi) {
    if (pts.length < 2) return "";
    const clamp = (v) => (lo === undefined ? v : Math.min(hi, Math.max(lo, v)));
    let d = `M ${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)], p1 = pts[i],
            p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = clamp(p1[1] + (p2[1] - p0[1]) / 6);
      const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = clamp(p2[1] - (p3[1] - p1[1]) / 6);
      d += ` C ${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0]},${p2[1]}`;
    }
    return d;
  }

  /* ---------- 今日与近 7 天共用同一份摄入数据 ---------- */
  function setMeals(day, meals) {
    day.meals = meals;
    day.kcal = day.protein = day.carb = day.fat = 0;
    day.slots = { b: false, l: false, d: false };
    for (const meal of meals) {
      day.kcal += Number(meal.calories);
      day.protein += Number(meal.protein);
      day.carb += Number(meal.carb);
      day.fat += Number(meal.fat);
      day.slots[slotOf(meal)] = true;
    }
    return day;
  }

  let todayLog = null;
  let week = [];
  let loading = false;
  let pendingDelete = null;
  let requestingAdvice = false;

  function updateAdviceButton() {
    $("ai-advice-btn").disabled = loading || !todayLog || requestingAdvice;
  }

  async function loadTracker() {
    if (loading) return;
    loading = true;
    updateAdviceButton();
    if (pendingDelete) await pendingDelete.catch(() => {});

    const now = new Date();
    const days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (6 - i));
      return { key: dateKey(d), wd: WD[d.getDay()], today: i === 6 };
    });

    const results = await Promise.allSettled(days.map(async (day) => {
      const data = await apiFetch("/api/intake?date=" + day.key);
      return setMeals(day, data.meals);
    }));
    todayLog = results[6].status === "fulfilled" ? results[6].value : null;
    week = results.every((result) => result.status === "fulfilled") ? days : [];
    loading = false;
    renderTracker();
    if (week.length) {
      renderDashboard();
    } else {
      for (const id of ["st-rate", "st-b", "st-l", "st-d"]) $(id).textContent = "—";
      for (const id of ["sign-grid", "week-chart", "trend-chart"]) $(id).replaceChildren();
      $("week-summary").textContent = "近 7 天摄入加载失败，可刷新重试";
    }
    updateAdviceButton();
  }

  /* ---------- 每日目标修改 ---------- */
  const goalInput = $("goal-input");
  goalInput.value = Auth.user.goal;
  goalInput.addEventListener("change", async () => {
    goalInput.disabled = true;
    try {
      const data = await apiFetch("/api/goal", { method: "PUT", body: { goal: getGoal() } });
      Auth.user.goal = data.goal;
    } catch (e) {
      alert("保存目标失败：" + e.message);
    } finally {
      goalInput.value = Auth.user.goal;
      goalInput.disabled = false;
      renderTracker();
    }
  });

  /* ---------- 渲染：热量环 + 三餐卡片 + 进度 + 营养素 + 餐食列表 ---------- */
  function renderTracker() {
    const log = todayLog;
    const goal = getGoal();
    const calories = log?.kcal ?? 0;
    const pct = Math.min((calories / goal) * 100, 100);
    const C = 2 * Math.PI * 50;   // 热量环周长（r=50）

    // 热量环
    const ring = $("ring-fill");
    ring.setAttribute("stroke-dasharray", C.toFixed(1));
    ring.setAttribute("stroke-dashoffset", (C * (1 - pct / 100)).toFixed(1));
    ring.classList.toggle("over", calories > goal);
    $("ring-kcal").textContent = log ? Math.round(calories) : "—";
    $("ring-goal").textContent = goal;

    // 今日三餐分槽（按记录时间归到早/午/晚餐）
    const slots = { b: { n: 0, kcal: 0 }, l: { n: 0, kcal: 0 }, d: { n: 0, kcal: 0 } };
    for (const m of log?.meals ?? []) {
      const s = slots[slotOf(m)];
      s.n++; s.kcal += Number(m.calories);
    }
    let signed = 0;
    for (const k of ["b", "l", "d"]) {
      const s = slots[k], el = $("meal-" + k);
      if (s.n > 0) { signed++; el.classList.remove("off"); }
      else el.classList.add("off");
      el.querySelector(".st").textContent = s.n > 0 ? "已记录 " + s.n + " 项" : log ? "未记录" : "—";
      el.querySelector("em").textContent = log ? Math.round(s.kcal) + " kcal" : "—";
    }
    $("sign-chip").textContent = log ? "今日签到 " + signed + "/3 餐" : "今日签到加载失败";

    // 每日目标进度
    const fill = $("tk-fill");
    fill.style.width = pct + "%";
    fill.classList.toggle("over", calories > goal);
    $("goal-pct").textContent = log ? Math.round(pct) + "%" : "—";
    $("goal-remain").textContent =
      !log ? "今日摄入加载失败" : calories > goal
        ? "已超出目标 " + Math.round(calories - goal) + " kcal，明天轻一点 🌿"
        : "还能吃 " + Math.round(goal - calories) + " kcal";

    // 运动中心同步行（localStorage，由 exercise.js 写入）
    const exKey = "shijian_exercise_v2_" + encodeURIComponent(Auth.user.username) + "_" + dateKey(new Date());
    let ex = null;
    try { ex = JSON.parse(localStorage.getItem(exKey)); } catch { /* 忽略 */ }
    const exEl = $("ov-exercise");
    if (Array.isArray(ex?.records) && ex.burn > 0) {
      exEl.textContent = "🏃 今日运动消耗 " + Math.round(ex.burn) + " kcal";
      exEl.hidden = false;
    } else {
      exEl.hidden = true;
    }

    // 今日三大营养素和记录列表
    const grams = (key) => log ? Math.round(log[key]) + "g" : "—";
    $("ov-protein").textContent = grams("protein");
    $("ov-carb").textContent = grams("carb");
    $("ov-fat").textContent = grams("fat");
    $("tracker-macros").innerHTML =
      "<span>蛋白质 " + grams("protein") + "</span>" +
      "<span>碳水 " + grams("carb") + "</span>" +
      "<span>脂肪 " + grams("fat") + "</span>";

    $("meal-list").innerHTML = log?.meals.length
      ? log.meals.map((meal) =>
          `<li><span><img class="mini-thumb" src="${mealThumbnail(meal.name)}" alt="" loading="lazy" decoding="async">${escapeHtml(meal.name)}　<b>${Math.round(meal.calories)} kcal</b></span>` +
          `<button class="meal-del" data-meal-id="${escapeHtml(meal.id)}"${pendingDelete ? " disabled" : ""}>删除</button></li>`).join("")
      : `<li class="meal-empty">${log ? "还没有记录，先去分析一餐吧 👆" : "今日摄入加载失败，可刷新重试"}</li>`;
  }

  $("meal-list").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-meal-id]");
    if (!button || !todayLog || loading || pendingDelete) return;
    const id = button.dataset.mealId;
    for (const item of $("meal-list").querySelectorAll("button")) item.disabled = true;
    pendingDelete = apiFetch("/api/intake/" + encodeURIComponent(id), { method: "DELETE" });
    try {
      if (pendingDelete) await pendingDelete.catch(() => {});
      setMeals(todayLog, todayLog.meals.filter((meal) => String(meal.id) !== id));
      if (week.length) renderDashboard();
    } catch (e) {
      alert("删除失败：" + e.message);
    } finally {
      pendingDelete = null;
      renderTracker();
    }
  });

  function renderDashboard() {
    /* --- 达成统计 --- */
    const count = (k) => week.filter((d) => d.slots[k]).length;
    const totalSlots = week.reduce((s, d) => s + (d.slots.b + d.slots.l + d.slots.d), 0);
    $("st-rate").textContent = (totalSlots / 21 * 100).toFixed(1).replace(/\.0$/, "") + "%";
    $("st-b").textContent = count("b") + " 天";
    $("st-l").textContent = count("l") + " 天";
    $("st-d").textContent = count("d") + " 天";

    /* --- 近7日三餐签到网格 --- */
    const grid = $("sign-grid");
    let html = '<span></span>' + week.map((d) =>
      `<span class="hd${d.today ? ' strong' : ''}" title="${d.key}">${d.wd.slice(1)}</span>`).join("");
    for (const [k, name] of [["b", "早餐"], ["l", "午餐"], ["d", "晚餐"]]) {
      html += `<span class="rl">${name}</span>` + week.map((d) =>
        `<span class="cell${d.slots[k] ? " on" : ""}" title="${d.key} ${name}${d.slots[k] ? "：已记录" : "：未记录"}"></span>`).join("");
    }
    grid.innerHTML = html;

    /* --- 近7日每日摄入柱状图 --- */
    renderBars();

    /* --- 近7日三大营养素趋势曲线 --- */
    renderTrend();
  }

  function renderBars() {
    const W = 380, top = 20, bottom = 148, left = 40, right = 8;
    const maxY = niceMax(Math.max(...week.map((d) => d.kcal), 100));
    const step = (W - left - right) / 7, bw = 24;
    const y = (v) => bottom - (v / maxY) * (bottom - top);
    const cx = (i) => left + step * i + step / 2;

    let svg = "";
    // 网格线 + y 轴刻度（0 / 中间 / 最大）
    for (const t of [0, 0.5, 1]) {
      const v = maxY * t, yy = y(v);
      svg += `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#e5e7eb" stroke-width="1"/>`;
      svg += `<text x="${left - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${Math.round(v)}</text>`;
    }
    svg += `<text x="${left - 6}" y="${top - 8}" text-anchor="end" font-size="9.5" fill="#9ca3af">kcal</text>`;

    week.forEach((d, i) => {
      const h = Math.max(d.kcal > 0 ? 6 : 2, bottom - y(d.kcal));
      svg += `<rect class="hist-bar" x="${cx(i) - bw / 2}" y="${bottom - h}" width="${bw}" height="${h}" rx="6"
              fill="${d.today ? "#10b981" : "#a7f3d0"}"><title>${d.key}：${Math.round(d.kcal)} kcal</title></rect>`;
      if (d.kcal > 0) svg += `<text x="${cx(i)}" y="${bottom - h - 6}" text-anchor="middle" font-size="10"
              fill="${d.today ? "#059669" : "#9ca3af"}" font-weight="${d.today ? "700" : "400"}">${Math.round(d.kcal)}</text>`;
      svg += `<text x="${cx(i)}" y="${bottom + 16}" text-anchor="middle" font-size="10.5"
              fill="${d.today ? "#059669" : "#9ca3af"}" font-weight="${d.today ? "700" : "400"}">${d.wd}</text>`;
    });
    $("week-chart").innerHTML = svg;

    const total = week.reduce((s, d) => s + d.kcal, 0);
    const active = week.filter((d) => d.kcal > 0).length;
    const avg = active ? Math.round(total / active) : 0;
    $("week-summary").textContent =
      `近 7 天有 ${active} 天有记录，日均摄入约 ${avg} kcal —— 三餐规律就很棒，慢慢来 🌿`;
  }

  function renderTrend() {
    const W = 420, H = 270, top = 24, bottom = 226, left = 44, right = 12;
    const maxY = niceMax(Math.max(...week.map((d) => Math.max(d.protein, d.carb, d.fat)), 50));
    const step = (W - left - right) / 7;
    const x = (i) => left + step * i + step / 2;
    const y = (v) => bottom - (v / maxY) * (bottom - top);

    let svg = "";
    // 横向网格线 + y 轴刻度
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      const v = maxY * t, yy = y(v);
      svg += `<line x1="${left}" y1="${yy}" x2="${W - right}" y2="${yy}" stroke="#eef1ee" stroke-width="1"/>`;
      svg += `<text x="${left - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${Math.round(v)}</text>`;
    }
    svg += `<text x="${left - 6}" y="${top - 10}" text-anchor="end" font-size="9.5" fill="#9ca3af">g</text>`;

    // 三条平滑曲线（蛋白质/碳水/脂肪）
    const series = [
      { key: "protein", color: "#3b82f6", name: "蛋白质" },
      { key: "carb", color: "#10b981", name: "碳水" },
      { key: "fat", color: "#f59e0b", name: "脂肪" },
    ];
    for (const s of series) {
      const pts = week.map((d, i) => [x(i), y(d[s.key])]);
      const path = smoothPath(pts, top, bottom);
      // 曲线下淡色渐变面积
      svg += `<path d="${path} L ${pts[pts.length - 1][0]},${bottom} L ${pts[0][0]},${bottom} Z"
              fill="${s.color}" opacity="0.07"/>`;
      svg += `<path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.5" stroke-linecap="round"/>`;
      week.forEach((d, i) => {
        svg += `<circle cx="${pts[i][0]}" cy="${pts[i][1]}" r="3.5" fill="#fff" stroke="${s.color}" stroke-width="2"><title>${d.key} ${s.name}：${Math.round(d[s.key])} g</title></circle>`;
      });
    }

    // x 轴星期标签
    week.forEach((d, i) => {
      svg += `<text x="${x(i)}" y="${bottom + 20}" text-anchor="middle" font-size="10.5"
              fill="${d.today ? "#059669" : "#9ca3af"}" font-weight="${d.today ? "700" : "400"}">${d.wd}</text>`;
    });
    $("trend-chart").innerHTML = svg;
  }

  /* ---------- AI 今日饮食建议 ---------- */
  $("ai-advice-btn").addEventListener("click", async () => {
    const btn = $("ai-advice-btn");
    const box = $("ai-advice-text");
    if (btn.disabled || !todayLog) return;
    requestingAdvice = true;
    updateAdviceButton();
    btn.textContent = "AI 分析中…";
    box.classList.add("loading");
    box.textContent = "AI 正在阅读你的饮食记录，稍等几秒…";

    // 汇总今日 + 近 7 天数据，交给 AI
    const goal = getGoal();
    const slots = { b: 0, l: 0, d: 0 };
    for (const m of todayLog.meals) slots[slotOf(m)]++;
    const weekAvg = week.length ? Math.round(week.reduce((sum, day) => sum + day.kcal, 0) / week.length) : null;
    const prompt =
      `我的每日热量目标是 ${goal} kcal。\n` +
      `今天已摄入 ${Math.round(todayLog.kcal)} kcal，蛋白质 ${Math.round(todayLog.protein)}g，碳水 ${Math.round(todayLog.carb)}g，脂肪 ${Math.round(todayLog.fat)}g。\n` +
      `今天三餐记录：早餐 ${slots.b} 项，午餐 ${slots.l} 项，晚餐 ${slots.d} 项。\n` +
      (week.length
        ? `近 7 天日均摄入约 ${weekAvg} kcal，各日摄入：${week.map((d) => `${d.key.slice(5)} ${Math.round(d.kcal)}kcal`).join("，")}。`
        : "近 7 天数据暂时无法读取。") +
      "\n请用简短要点点评今日记录并给出下一餐建议。有近 7 天数据时，再提供 1 条来自趋势的建议。每条不超过 40 字，口语化。";

    try {
      const text = await chat([{ role: "user", content: prompt }], { calories: todayLog.kcal, goal });
      box.textContent = text || "（AI 没有返回建议，稍后再试一次）";
    } catch (e) {
      box.textContent = "获取建议失败：" + e.message + "（可稍后重试）";
    } finally {
      requestingAdvice = false;
      updateAdviceButton();
      btn.textContent = "让 AI 看看";
      box.classList.remove("loading");
    }
  });

  /* ---------- 初始化 ---------- */
  loadTracker();
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) loadTracker();
  });
})();
