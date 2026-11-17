/* 运动记录按账号与日期保存在当前浏览器。 */
(async () => {
  if (!(await Auth.requireLogin())) return;

  /* ---------- 运动目录（分类快捷选择） ---------- */
  const CATALOG = [
    { key: "daily", label: "🚶 日常活动", items: [
      { name: "饭后散步", icon: "🚶", min: 30, rate: 3.3 },
      { name: "爬楼梯", icon: "🪜", min: 10, rate: 6 },
      { name: "逛超市/菜市场", icon: "🛒", min: 30, rate: 2.7 },
      { name: "做家务", icon: "🧹", min: 20, rate: 3.5 },
    ]},
    { key: "cardio", label: "🏃 有氧", items: [
      { name: "慢骑", icon: "🚲", min: 40, rate: 4 },
      { name: "慢跑", icon: "🏃‍♂️", min: 30, rate: 8 },
      { name: "跳绳", icon: "🪢", min: 10, rate: 10 },
      { name: "游泳", icon: "🏊", min: 30, rate: 9 },
    ]},
    { key: "strength", label: "💪 力量", items: [
      { name: "深蹲", icon: "🏋️", min: 15, rate: 4 },
      { name: "俯卧撑", icon: "🤸", min: 10, rate: 3.6 },
      { name: "平板支撑", icon: "🧱", min: 3, rate: 2 },
      { name: "弹力带训练", icon: "🎗️", min: 15, rate: 3 },
    ]},
    { key: "relax", label: "🌙 放松", items: [
      { name: "居家拉伸", icon: "🧘", min: 15, rate: 2.6 },
      { name: "瑜伽", icon: "🕉️", min: 30, rate: 2.7 },
      { name: "八段锦", icon: "☯️", min: 20, rate: 2.3 },
      { name: "冥想呼吸", icon: "😌", min: 10, rate: 1 },
    ]},
  ];

  const $ = (id) => document.getElementById(id);
  const kcalOf = (item, min) => Math.round(item.rate * min);

  const activities = CATALOG.flatMap((category) => category.items);
  const accountPrefix = "shijian_exercise_v2_" + encodeURIComponent(Auth.user.username) + "_";
  const dateKey = (date) => date.getFullYear() + "-" +
    String(date.getMonth() + 1).padStart(2, "0") + "-" + String(date.getDate()).padStart(2, "0");

  function readDay(key) {
    try { return JSON.parse(localStorage.getItem(accountPrefix + key)); }
    catch { return null; }
  }

  function readRecords(key) {
    const saved = readDay(key)?.records;
    if (!Array.isArray(saved)) return [];
    return saved.flatMap((record) => {
      const item = activities.find((activity) => activity.name === record?.name);
      const min = record?.min;
      const time = record?.time;
      if (!item || !Number.isInteger(min) || min < 1 || min > 600 ||
          typeof time !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return [];
      return [{ name: item.name, icon: item.icon, min, kcal: kcalOf(item, min), time }];
    });
  }

  let recordsDate = dateKey(new Date());
  let records = readRecords(recordsDate);
  const WEEK_GOAL_DAYS = 5;
  const todayIdx = () => (new Date().getDay() + 6) % 7;   // 周一 = 0

  function weekTotals() {
    const now = new Date();
    const index = todayIdx();
    return Array.from({ length: 7 }, (_, i) => {
      if (i > index) return 0;
      if (i === index) return totalBurn();
      const date = new Date(now);
      date.setDate(date.getDate() + i - index);
      return readRecords(dateKey(date)).reduce((sum, record) => sum + record.kcal, 0);
    });
  }

  const totalBurn = () => records.reduce((s, r) => s + r.kcal, 0);
  const totalMin  = () => records.reduce((s, r) => s + r.min, 0);

  /* ---------- 渲染：概览四卡 ---------- */
  function renderOverview(week) {
    const burn = totalBurn(), min = totalMin(), count = records.length;

    const done = week.filter((burn) => burn > 0).length;
    const pct = Math.min(Math.round((done / WEEK_GOAL_DAYS) * 100), 100);

    $("bn-burn").textContent = burn;
    $("ov-min").textContent = min;
    $("ov-burn").textContent = burn;
    $("ov-count").textContent = count;
    $("ov-weekpct").textContent = pct;
    $("ov-weekfill").style.width = pct + "%";
    $("ov-weekfill").style.background =
      pct >= 100 ? "linear-gradient(90deg,#10b981,#a7f3d0)" : "";
    $("ov-weeknote").textContent = "本周目标：舒展 5 天（" + done + "/" + WEEK_GOAL_DAYS + "）";
  }

  /* ---------- 渲染：今日记录列表 ---------- */
  function renderRecords() {
    const list = $("rec-list");
    $("rec-empty").hidden = records.length > 0;
    list.innerHTML = records.map((r, i) => `
      <button type="button" class="bg-white text-left rounded-2xl shadow-sm border border-[#e5e7eb] px-5 py-4 min-w-[240px] lift cursor-pointer" data-del="${i}"
              aria-label="删除${r.time}的${r.name}记录" title="点击删除这条记录">
        <span class="flex items-center gap-3">
          <span aria-hidden="true" class="w-12 h-12 rounded-xl flex-none grid place-items-center text-2xl" style="background:#ecfdf5;">${r.icon}</span>
          <span>
            <span class="block text-[15px] font-bold text-gray-800">${r.name}</span>
            <span class="block text-[12px] text-gray-400 mt-0.5">时长 ${r.min} 分钟 · ${r.time}</span>
          </span>
        </span>
        <span class="block mt-3 text-[20px] font-bold" style="color:#059669;">${r.kcal} <span class="text-[12px] font-semibold text-gray-400">kcal</span></span>
      </button>`).join("");
  }

  $("rec-list").addEventListener("click", (event) => {
    const button = event.target.closest("[data-del]");
    if (!button) return;
    if (updateDate()) {
      refresh();
      return;
    }
    const [record] = records.splice(Number(button.dataset.del), 1);
    if (!record) return;
    const saved = saveDay();
    refresh();
    toast(saved ? `已删除「${record.name}」的记录` : "浏览器未能保存删除操作");
  });

  /* ---------- 渲染：分类标签 + 快捷选择 ---------- */
  let curCat = CATALOG[0].key;

  function renderTabs() {
    $("qtabs").innerHTML = CATALOG.map((c) =>
      `<button class="qtab ${c.key === curCat ? "active" : ""}" data-cat="${c.key}">${c.label}</button>`).join("");
    $("qtabs").querySelectorAll("[data-cat]").forEach((btn) => {
      btn.addEventListener("click", () => { curCat = btn.dataset.cat; renderTabs(); renderTags(); });
    });
  }

  function renderTags() {
    const cat = CATALOG.find((c) => c.key === curCat);
    $("qtags").innerHTML = cat.items.map((it) =>
      `<button class="qtag" data-add="${it.name}" data-min="${it.min}">
         ${it.icon} ${it.name} · ${it.min}分钟 · 约${kcalOf(it, it.min)}kcal</button>`).join("");
  }

  /* ---------- 添加记录（推荐卡片 / 快捷标签 / 弹窗共用） ---------- */
  function addRecord(name, min) {
    const item = activities.find((activity) => activity.name === name);
    if (!item || !Number.isInteger(min) || min < 1 || min > 600) return;
    updateDate();
    const now = new Date();
    const time = String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0");
    const kcal = kcalOf(item, min);
    records.push({ name, icon: item.icon, min, kcal, time });
    const saved = saveDay();
    refresh();
    toast(saved ? `已记录：${name} ${min} 分钟 · 约 ${kcal} kcal 🌿` : "浏览器未能保存这条运动记录");
  }

  /* 推荐卡片与快捷标签：data-add 属性统一委托 */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-add]");
    if (el) addRecord(el.dataset.add, Number(el.dataset.min));
  });

  /* ---------- 添加记录弹窗 ---------- */
  (function initModal() {
    const opts = activities
      .map((it) => `<option value="${it.name}" data-rate="${it.rate}">${it.icon} ${it.name}</option>`)
      .join("");
    $("ex-select").innerHTML = opts;

    const modal = $("ex-modal");
    const minutes = $("ex-min");
    minutes.required = true;
    const preview = () => {
      const item = $("ex-select").selectedOptions[0];
      $("ex-kcal").textContent = minutes.validity.valid ? kcalOf({ rate: Number(item.dataset.rate) }, Number(minutes.value)) : "—";
    };
    $("ex-select").addEventListener("change", preview);
    $("ex-min").addEventListener("input", preview);

    $("add-btn").addEventListener("click", () => { preview(); modal.hidden = false; });
    $("ex-cancel").addEventListener("click", () => { modal.hidden = true; });
    modal.addEventListener("click", (e) => { if (e.target === modal) modal.hidden = true; });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") modal.hidden = true; });

    $("ex-save").addEventListener("click", () => {
      if (!minutes.reportValidity()) return;
      addRecord($("ex-select").value, Number(minutes.value));
      modal.hidden = true;
    });
  })();

  /* ---------- 本周折线图（纯 SVG，简易） ---------- */
  function renderChart(data) {
    const idx = todayIdx();
    const days = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

    const top = 42, bottom = 208, left = 50, step = 103;
    const maxY = Math.max(400, ...data);
    const x = (i) => left + i * step;
    const y = (v) => bottom - (v / maxY) * (bottom - top);

    const pts = data.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    const area = `${x(0)},${bottom} ${pts} ${x(6)},${bottom}`;

    $("week-chart").innerHTML = `
      <defs>
        <linearGradient id="g-area" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#10b981" stop-opacity=".22"/>
          <stop offset="100%" stop-color="#10b981" stop-opacity="0"/>
        </linearGradient>
      </defs>
      <polygon points="${area}" fill="url(#g-area)"/>
      <polyline points="${pts}" fill="none" stroke="#10b981" stroke-width="3"
                stroke-linecap="round" stroke-linejoin="round"/>
      ${data.map((v, i) => `
        <circle cx="${x(i)}" cy="${y(v)}" r="5" fill="#fff" stroke="#059669" stroke-width="2.5"/>
        <text x="${x(i)}" y="${y(v) - 14}" text-anchor="middle" font-size="12" fill="#059669" font-weight="600">${v}</text>
        <text x="${x(i)}" y="${bottom + 26}" text-anchor="middle" font-size="12.5"
              fill="${i === idx ? "#059669" : "#9ca3af"}" font-weight="${i === idx ? "700" : "400"}">${days[i]}${i === idx ? "（今天）" : ""}</text>
      `).join("")}
    `;

    const sum = data.reduce((s, v) => s + v, 0);
    const active = data.filter((v) => v > 0).length;
    $("week-summary").textContent =
      `这周已经动起来 ${active} 天，累计消耗约 ${sum} kcal —— 不追强度，舒服地坚持就很好 🌿`;
  }

  function updateDate() {
    const key = dateKey(new Date());
    if (key === recordsDate) return false;
    recordsDate = key;
    records = readRecords(recordsDate);
    return true;
  }

  function saveDay() {
    try {
      localStorage.setItem(accountPrefix + recordsDate, JSON.stringify({
        burn: totalBurn(),
        records: records.map(({ name, min, time }) => ({ name, min, time })),
      }));
      return true;
    } catch {
      return false;
    }
  }

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const el = $("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------- 初始化 ---------- */
  function refresh() {
    const week = weekTotals();
    renderOverview(week);
    renderRecords();
    renderChart(week);
  }
  window.addEventListener("pageshow", (event) => {
    if (!event.persisted) return;
    updateDate();
    records = readRecords(recordsDate);
    refresh();
  });
  window.addEventListener("storage", (event) => {
    if (!event.key?.startsWith(accountPrefix)) return;
    updateDate();
    if (event.key === accountPrefix + recordsDate) records = readRecords(recordsDate);
    refresh();
  });
  renderTabs();
  renderTags();
  refresh();
})();
