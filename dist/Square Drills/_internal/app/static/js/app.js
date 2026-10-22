(() => {
  "use strict";

  const api = {
    async request(url, options = {}) {
      const response = await fetch(url, {
        headers: { "Content-Type": "application/json", ...(options.headers || {}) },
        ...options,
      });
      if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try { message = (await response.json()).detail || message; } catch (_) { /* no JSON */ }
        throw new Error(message);
      }
      return response.json();
    },
    async loadState(moduleId) { return (await this.request(`/api/state/${moduleId}`)).payload; },
    saveState(moduleId, payload) {
      return this.request(`/api/state/${moduleId}`, { method: "PUT", body: JSON.stringify({ payload }) });
    },
    deleteState(moduleId) { return this.request(`/api/state/${moduleId}`, { method: "DELETE" }); },
  };
  const modules = {};
  let noticeTimer;
  let themeSave = Promise.resolve();
  let themeError = null;
  let pendingTheme = null;
  let controllerInitialized = false;
  function register(id, controller) { modules[id] = controller; }
  function el(id) { return document.getElementById(id); }
  function showNotice(message, kind = "info") {
    const notice = el("notice");
    notice.textContent = message;
    notice.hidden = false;
    notice.dataset.kind = kind;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 4000);
  }
  function setTheme(theme) {
    const selected = theme === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = selected;
    for (const value of ["light", "dark"]) {
      el(`theme${value === "light" ? "Light" : "Dark"}`).setAttribute("aria-pressed", String(selected === value));
    }
  }
  function saveTheme(theme) {
    const buttons = [el("themeLight"), el("themeDark")];
    buttons.forEach((button) => { button.disabled = true; });
    pendingTheme = theme;
    themeSave = themeSave.then(async () => {
      await api.request("/api/settings/theme", { method: "PUT", body: JSON.stringify({ theme }) });
      themeError = null;
      pendingTheme = null;
      setTheme(theme);
    }).catch((error) => { themeError = error; showNotice(error.message, "error"); })
      .finally(() => buttons.forEach((button) => { button.disabled = !controllerInitialized; }));
    return themeSave;
  }
  async function clearSaved(moduleId, resetCallback) {
    if (!window.confirm("Clear the saved Square Drills state? The current screen will reset.")) return;
    try {
      await api.deleteState(moduleId);
      resetCallback();
      showNotice("Saved state cleared.");
    } catch (error) { showNotice(error.message, "error"); }
  }
  async function flush() {
    await themeSave;
    if (themeError && pendingTheme !== null) await saveTheme(pendingTheme);
    if (controllerInitialized) await modules["square-drills"].flush();
    if (themeError) throw themeError;
  }
  window.ChessTools = { api, register, el, showNotice, clearSaved, flush };

  window.addEventListener("DOMContentLoaded", async () => {
    window.MobileUI?.setup();
    setTheme("light");
    const themeButtons = [el("themeLight"), el("themeDark")];
    for (const [index, theme] of ["light", "dark"].entries()) {
      themeButtons[index].addEventListener("click", () => saveTheme(theme));
    }
    try {
      const health = await api.request("/api/health");
      el("serverStatusText").textContent = "Local database connected";
      el("appVersion").textContent = `v${health.version}`;
      setTheme((await api.request("/api/settings/theme")).theme);
    } catch (error) {
      el("serverStatus").classList.add("error");
      el("serverStatusText").textContent = "Database unavailable";
      showNotice("Local storage is unavailable. State cannot be saved.", "error");
    }
    try {
      const controller = modules["square-drills"];
      await controller.init();
      controllerInitialized = true;
      controller.activate();
      themeButtons.forEach((button) => { button.disabled = false; });
      document.body.dataset.ready = "true";
    } catch (error) { showNotice(`Square Drills could not initialize: ${error.message}`, "error"); }
  });
})();
