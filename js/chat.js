/* ============================================================
 * 营养师对话页（chat.html）
 * 每次发送时读取今日摄入，作为本轮对话的上下文。
 * ============================================================ */
(async () => {
  if (!(await Auth.requireLogin())) return;

  const $ = (id) => document.getElementById(id);
  const chatMessages = $("chat-messages");
  const input = $("chat-input");
  const sendButton = $("chat-send");
  const quickButtons = document.querySelectorAll(".chat-quick");
  const chatHistory = [];

  /* ---------- 今日摄入（给 AI 的上下文用） ---------- */
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + "-" +
      String(d.getMonth() + 1).padStart(2, "0") + "-" +
      String(d.getDate()).padStart(2, "0");
  }

  async function loadTodayLog() {
    try {
      const data = await apiFetch("/api/intake?date=" + todayKey(), { signal: AbortSignal.timeout(5000) });
      const log = { calories: 0, protein: 0, carb: 0, fat: 0, goal: getGoal() };
      for (const m of data.meals) {
        log.calories += Number(m.calories); log.protein += Number(m.protein);
        log.carb += Number(m.carb); log.fat += Number(m.fat);
      }
      return log;
    } catch {
      return null;
    }
  }

  function getGoal() {
    return Math.max(800, Math.min(6000, Number(Auth.user && Auth.user.goal) || 2000));
  }

  /** 把今日摄入情况整理成给 AI 的上下文 */
  function buildTodayContext(log) {
    if (!log) return "暂时无法读取今天的摄入记录。";
    return "已记录摄入 " + log.calories + " kcal，蛋白质 " + log.protein +
      "g，碳水 " + log.carb + "g，脂肪 " + log.fat + "g；用户目标 " + log.goal + " kcal/天。";
  }

  /* ---------- 对话 ---------- */
  async function sendChat(text = input.value.trim()) {
    if (!text || sendButton.disabled) return;
    sendButton.disabled = true;
    quickButtons.forEach((btn) => { btn.disabled = true; });
    input.value = "";

    appendMsg("user", text);
    const message = { role: "user", content: text };
    const typing = appendMsg("ai", "正在思考…");
    typing.classList.add("typing");

    try {
      const todayLog = await loadTodayLog();
      const context = { role: "system", content: "用户今日摄入参考信息：" + buildTodayContext(todayLog) };
      const reply = await chat([context, ...chatHistory, message], todayLog);
      typing.remove();
      appendMsg("ai", reply);
      chatHistory.push(message, { role: "assistant", content: reply });
    } catch (err) {
      typing.remove();
      appendMsg("ai", "出了点小问题：" + err.message);
      if (!input.value) input.value = text;
    } finally {
      sendButton.disabled = false;
      quickButtons.forEach((btn) => { btn.disabled = false; });
    }
  }

  function appendMsg(role, content) {
    const div = document.createElement("div");
    div.className = "msg msg-" + role;
    div.textContent = content;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    return div;
  }

  /* ---------- 事件绑定 ---------- */
  sendButton.addEventListener("click", () => sendChat());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) sendChat();
  });

  quickButtons.forEach((btn) => {
    btn.addEventListener("click", () => sendChat(btn.dataset.q));
  });
})();
