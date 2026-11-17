(async () => {
  if (!(await Auth.requireLogin())) return;
  const $ = (id) => document.getElementById(id);
  const goalInput = $("profile-goal");
  const nameInput = $("profile-display-name");
  const avatarChoice = $("profile-avatar-choice");
  let intakeKcal;

  function renderIdentity() {
    $("profile-username").textContent = Auth.displayNameFor();
    $("profile-avatar").textContent = Auth.avatarFor();
    Auth.mountNavUser($("nav-user"));
  }

  function renderRemaining() {
    if (intakeKcal === undefined) return;
    const remaining = Math.round(Auth.user.goal - intakeKcal);
    $("profile-remaining-kcal").textContent = Math.max(0, remaining).toLocaleString("zh-CN");
    $("profile-intake-status").textContent = remaining < 0
      ? "已超过热量目标 " + Math.abs(remaining).toLocaleString("zh-CN") + " 千卡。"
      : "";
  }

  async function loadIntake() {
    const status = $("profile-intake-status");
    status.textContent = "正在加载今日记录…";
    const now = new Date();
    const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
      .map((part) => String(part).padStart(2, "0")).join("-");
    try {
      const { meals } = await apiFetch("/api/intake?date=" + date);
      intakeKcal = meals.reduce((total, meal) => total + (Number(meal.calories) || 0), 0);
      $("profile-intake-kcal").textContent = Math.round(intakeKcal).toLocaleString("zh-CN");
      $("profile-meal-count").textContent = meals.length.toLocaleString("zh-CN");
      renderRemaining();
    } catch {
      status.textContent = "暂时无法读取今日记录，可稍后刷新查看。";
    }
  }

  function bindForm(formId, statusId, save) {
    const form = $(formId);
    const status = $(statusId);
    const controls = form.querySelectorAll("input, select, button");
    const disable = (disabled) => controls.forEach((control) => { control.disabled = disabled; });
    let saving = false;
    disable(false);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (saving || !form.reportValidity()) return;
      saving = true;
      disable(true);
      status.dataset.kind = "";
      status.textContent = "正在保存…";
      try {
        status.textContent = await save();
        status.dataset.kind = "success";
      } catch (error) {
        status.textContent = error.status === 401
          ? "登录已过期，请重新登录后再操作。"
          : (error.status && error.status < 500 ? error.message : "保存失败，请稍后重试。");
        status.dataset.kind = "error";
      } finally {
        saving = false;
        disable(false);
      }
    });
  }

  $("profile-account-id").textContent = Auth.user.username;
  nameInput.value = Auth.user.displayName || "";
  avatarChoice.value = Auth.user.avatar || "initial";
  goalInput.value = Auth.user.goal;
  renderIdentity();
  loadIntake();

  bindForm("profile-goal-form", "profile-status", async () => {
    const goal = goalInput.valueAsNumber;
    if (goal === Number(Auth.user.goal)) return "每日热量目标已保存。";

    const data = await apiFetch("/api/goal", { method: "PUT", body: { goal } });
    Auth.user.goal = data.goal;
    goalInput.value = data.goal;
    renderRemaining();
    return "每日热量目标已更新。";
  });

  bindForm("profile-edit-form", "profile-edit-status", async () => {
    const body = { displayName: nameInput.value.trim(), avatar: avatarChoice.value };
    const { profile } = await apiFetch("/api/profile", { method: "PUT", body });
    Auth.user.displayName = profile.displayName;
    Auth.user.avatar = profile.avatar;
    nameInput.value = profile.displayName;
    avatarChoice.value = profile.avatar;
    renderIdentity();
    return "个人资料已更新。";
  });

  const passwordForm = $("profile-password-form");
  const currentPassword = $("profile-current-password");
  const newPassword = $("profile-new-password");
  const confirmation = $("profile-confirm-password");
  function validateConfirmation() {
    confirmation.setCustomValidity(confirmation.value && newPassword.value !== confirmation.value
      ? "两次输入的新密码不一致。" : "");
  }
  passwordForm.addEventListener("input", validateConfirmation);
  passwordForm.addEventListener("submit", validateConfirmation);
  bindForm("profile-password-form", "profile-password-status", async () => {
    const body = { currentPassword: currentPassword.value, newPassword: newPassword.value };
    await apiFetch("/api/auth/password", { method: "POST", body });
    passwordForm.reset();
    confirmation.setCustomValidity("");
    return "密码已修改，其他设备需重新登录。";
  });
})();
