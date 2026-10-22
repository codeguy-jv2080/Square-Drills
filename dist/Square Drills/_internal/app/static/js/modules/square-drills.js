(() => {
  "use strict";
  const { api, register, el, showNotice, clearSaved } = window.ChessTools;
  const C = window.SquareDrillsCore;
  const moduleId = "square-drills";
  const keys = ["color", "algebraic", "white", "black"];
  const suffix = { color: "Color", algebraic: "Algebraic", white: "White", black: "Black" };
  const emptyAnswers = () => Object.fromEntries(keys.map((key) => [key, ""]));
  const defaults = () => ({
    remember: true, promptMode: "algebraic", answerMode: "all",
    custom: { algebraic: true, white: true, black: true },
    cycle: C.shuffle(C.allSquares()), index: 0, current: null, shownPrompt: null,
    attempts: 0, correct: 0, locked: false, answers: emptyAnswers(), results: null,
    timerEnabled: false, timerElapsed: 0, activeField: "color",
    sessionVersion: 2, sessionResults: {}, completed: false,
  });
  let state = defaults();
  let active = false;
  let nativePaused = false;
  let startedAt = null;
  let timer = null;
  let saveQueue = Promise.resolve();
  let saveError = null;
  let failedPayload = null;
  let pendingClear = Promise.resolve();
  const input = (key) => el(`sd${suffix[key]}`);
  const row = (key) => el(`sdRow${suffix[key]}`);
  const editable = () => Boolean(state.current && !state.locked && !state.completed);
  const fields = () => C.effectiveFields(state.answerMode, state.custom, state.shownPrompt?.format);
  const elapsed = () => state.timerElapsed + (startedAt === null ? 0 : Math.max(0, Date.now() - startedAt));

  function snapshot() {
    return { ...state, custom: { ...state.custom }, cycle: [...state.cycle], sessionResults: { ...state.sessionResults }, answers: { ...state.answers }, shownPrompt: state.shownPrompt && { ...state.shownPrompt }, results: state.results?.map((result) => ({ ...result })) || null, timerElapsed: elapsed() };
  }
  function queueSave(payload) {
    saveQueue = saveQueue.then(async () => {
      await api.saveState(moduleId, payload);
      saveError = null;
      failedPayload = null;
    }).catch((error) => { saveError = error; failedPayload = payload; showNotice(error.message, "error"); });
    return saveQueue;
  }
  function save(force = false) {
    if (!state.remember && !force) return saveQueue;
    return queueSave(snapshot());
  }
  function renderTimer() {
    const tenths = Math.floor(elapsed() / 100);
    const minutes = Math.floor(tenths / 600);
    const seconds = Math.floor(tenths / 10) % 60;
    el("sdTimer").textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${tenths % 10}`;
  }
  function pauseTimer() {
    state.timerElapsed = elapsed();
    startedAt = null;
    if (timer !== null) { clearInterval(timer); timer = null; }
  }
  function syncTimer() {
    if (state.timerEnabled && editable() && active && !document.hidden && !nativePaused) {
      if (startedAt === null) startedAt = Date.now();
      if (timer === null) timer = setInterval(renderTimer, 100);
    } else pauseTimer();
    renderTimer();
  }
  function enforcePrompt() {
    const eligible = C.eligiblePrompts(state.answerMode, state.custom);
    if (state.promptMode !== "random" && !eligible.includes(state.promptMode)) state.promptMode = eligible[0];
  }
  function restore(saved) {
    if (!saved || typeof saved !== "object") return false;
    state.remember = saved.remember !== false;
    if (["all", "white", "algebraic", "custom"].includes(saved.answerMode)) state.answerMode = saved.answerMode;
    if (["algebraic", "white", "black", "random"].includes(saved.promptMode)) state.promptMode = saved.promptMode;
    for (const key of ["algebraic", "white", "black"]) {
      if (typeof saved.custom?.[key] === "boolean") state.custom[key] = saved.custom[key];
    }
    enforcePrompt();
    state.timerEnabled = saved.timerEnabled === true;
    // The old looping totals cannot describe a single round. Replace that
    // progress once, retaining the user's settings; no backup is created.
    if (saved.sessionVersion !== 2) return true;
    const validCycle = C.validCycle(saved.cycle) && Number.isInteger(saved.index) && saved.index >= 0 && saved.index <= 64;
    if (!validCycle) return false;
    state.cycle = [...saved.cycle];
    if (!saved.index || saved.current !== state.cycle[saved.index - 1]) return false;
    const format = saved.shownPrompt?.format;
    if (!C.eligiblePrompts(state.answerMode, state.custom).includes(format)) return false;
    const outcomes = saved.sessionResults;
    const answered = saved.locked === true ? saved.index : saved.index - 1;
    if (!outcomes || typeof outcomes !== "object" || Array.isArray(outcomes) ||
        Object.keys(outcomes).length !== answered ||
        !state.cycle.slice(0, answered).every((square) => typeof outcomes[square] === "boolean")) return false;
    state.sessionResults = { ...outcomes };
    state.attempts = answered;
    state.correct = Object.values(outcomes).filter(Boolean).length;
    state.completed = answered === 64;
    state.index = saved.index;
    state.current = saved.current;
    state.shownPrompt = C.promptFor(state.current, format, state.answerMode, state.custom);
    state.locked = saved.locked === true;
    const required = fields();
    for (const key of required) state.answers[key] = String(saved.answers?.[key] || "").slice(0, 32);
    state.timerElapsed = Number.isFinite(saved.timerElapsed) && saved.timerElapsed >= 0 ? saved.timerElapsed : 0;
    state.activeField = required.includes(saved.activeField) ? saved.activeField : "color";
    if (state.locked) state.results = checkAnswers();
    return false;
  }
  function clearAnswers() {
    state.answers = emptyAnswers();
    state.results = null;
    state.activeField = "color";
  }
  function renderKeypad() {
    const visible = fields().filter((key) => key !== "color");
    if (!visible.includes(state.activeField)) state.activeField = visible[0] || "color";
    const key = state.activeField;
    const locked = !editable();
    keys.forEach((field) => row(field).classList.toggle("selected-field", !locked && field === key));
    const pad = el("sdKeypad");
    pad.replaceChildren();
    pad.hidden = !visible.length;
    if (pad.hidden) return;
    const title = document.createElement("p");
    title.className = "sd-keypad-label";
    title.textContent = state.completed ? "Session complete · reshuffle when you want another session" : locked ? state.current ? "Select Next for a new square" : "Select Start to begin" : `Enter ${C.labels[key]} · select a field to switch`;
    pad.appendChild(title);
    function change(value) {
      if (!editable() || !fields().includes(key)) return;
      input(key).value = value;
      input(key).dispatchEvent(new Event("input", { bubbles: true }));
    }
    function group(values, apply, selected, className = "") {
      const grid = document.createElement("div");
      grid.className = `sd-key-grid ${className}`;
      values.forEach(([label, value]) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.disabled = locked;
        button.setAttribute("aria-label", `${C.labels[key]}: ${label}`);
        button.setAttribute("aria-pressed", String(selected === value));
        button.addEventListener("click", () => apply(value));
        grid.appendChild(button);
      });
      pad.appendChild(grid);
    }
    const value = key === "algebraic" ? C.normalizeAlg(state.answers[key]) : C.normalizeDesc(state.answers[key]);
    const parts = /^(.*?)([1-8]?)$/.exec(value);
    const file = parts[1];
    const rank = parts[2];
    const files = key === "algebraic" ? [..."abcdefgh"] : C.descriptiveFiles;
    group(files.map((part) => [part, part]), (part) => change(part + rank), file);
    group([..."12345678"].map((part) => [part, part]), (part) => change(file + part), rank);
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "sd-clear-answer";
    clear.textContent = "Clear answer";
    clear.disabled = locked;
    clear.addEventListener("click", () => change(""));
    pad.appendChild(clear);
  }
  function renderColor() {
    for (const [id, value] of [["sdColorLight", "white"], ["sdColorDark", "black"]]) {
      const button = el(id);
      button.disabled = !editable();
      button.setAttribute("aria-pressed", String(C.normalizeColor(state.answers.color) === value));
    }
  }
  function render() {
    const required = fields();
    el("sdPromptMode").value = state.promptMode;
    el("sdAnswerMode").value = state.answerMode;
    el("sdPromptMode").disabled = state.locked;
    el("sdAnswerMode").disabled = state.locked;
    el("sdRemember").checked = state.remember;
    el("sdTimerEnabled").checked = state.timerEnabled;
    el("sdTimerEnabled").disabled = state.completed;
    el("sdCustom").hidden = state.answerMode !== "custom";
    el("sdCustom").querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
      checkbox.checked = state.custom[checkbox.value] === true;
      checkbox.disabled = state.locked;
    });
    const eligible = C.eligiblePrompts(state.answerMode, state.custom);
    [...el("sdPromptMode").options].forEach((option) => { option.disabled = option.value !== "random" && !eligible.includes(option.value); });
    keys.forEach((key) => {
      row(key).hidden = !required.includes(key);
      input(key).disabled = !editable() || !required.includes(key);
      input(key).tabIndex = key === "color" || input(key).disabled ? -1 : 0;
      input(key).value = required.includes(key) ? state.answers[key] : "";
    });
    el("sdAttempts").textContent = state.attempts;
    el("sdCorrect").textContent = state.correct;
    el("sdAccuracy").textContent = state.attempts ? `${Math.round(state.correct / state.attempts * 100)}%` : "—";
    el("sdCyclePosition").textContent = state.index;
    el("sdCycleProgress").style.width = `${state.index / 64 * 100}%`;
    el("sdNext").textContent = state.current ? "Next" : "Start";
    el("sdNext").disabled = state.completed || Boolean(state.current && !state.locked);
    el("sdReset").disabled = state.completed || !state.current;
    el("sdReshuffle").textContent = state.completed ? "Reshuffle & start another session" : "Reshuffle";
    el("sdSubmit").hidden = state.timerEnabled || state.completed;
    el("sdSubmit").disabled = !editable() || state.timerEnabled;
    el("sdPrompt").textContent = state.shownPrompt?.text || "Ready";
    el("sdPromptType").textContent = state.shownPrompt?.label || "Select Start to begin";
    const correct = state.results?.every((result) => result.passed);
    const feedback = el("sdFeedback");
    feedback.textContent = state.results ? correct ? "Correct" : "Incorrect" : "No answer submitted.";
    if (state.results) {
      const expected = C.details(state.current);
      for (const result of state.results) {
        const answer = result.key === "color" ? expected.color === "black" ? "Dark" : "Light" : expected[result.key];
        const line = document.createElement("div");
        line.textContent = `${C.labels[result.key]}: ${result.passed ? "OK" : `correct answer is ${answer}`}`;
        feedback.appendChild(line);
      }
    }
    el("sdFeedback").className = `feedback${state.results ? correct ? " success" : " failure" : ""}`;
    el("sdSessionResults").hidden = !state.completed;
    el("sdSessionAttempts").textContent = state.attempts;
    el("sdSessionCorrect").textContent = state.correct;
    el("sdSessionIncorrect").textContent = state.attempts - state.correct;
    el("sdSessionAccuracy").textContent = state.attempts ? `${Math.round(state.correct / state.attempts * 100)}%` : "—";
    renderColor();
    renderKeypad();
    syncTimer();
  }
  function focusAnswer() {
    if (active && editable()) el(C.normalizeColor(state.answers.color) === "black" ? "sdColorDark" : "sdColorLight").focus();
  }
  function nextSquare() {
    if (state.completed || (state.current && !state.locked) || state.index >= 64) return;
    pauseTimer();
    state.current = state.cycle[state.index++];
    enforcePrompt();
    state.shownPrompt = C.promptFor(state.current, state.promptMode, state.answerMode, state.custom);
    state.locked = false;
    state.timerElapsed = 0;
    clearAnswers();
    render();
    focusAnswer();
    save();
  }
  function checkAnswers() {
    const expected = C.details(state.current);
    return fields().map((key) => {
      const normalize = key === "color" ? C.normalizeColor : key === "algebraic" ? C.normalizeAlg : C.normalizeDesc;
      return { key, passed: normalize(state.answers[key]) === expected[key] };
    });
  }
  function autoCheck() {
    if (!state.timerEnabled || !editable()) return false;
    const complete = fields().every((key) => {
      if (key === "color") return ["black", "white"].includes(C.normalizeColor(state.answers[key]));
      const value = key === "algebraic" ? C.normalizeAlg(state.answers[key]) : C.normalizeDesc(state.answers[key]);
      // Wait for both file and rank, whether entered by keypad or typing.
      // Complete but incorrect notation must still be checked as a miss.
      return /^[a-z]+[0-9]$/i.test(value);
    });
    if (!complete) return false;
    submit();
    return true;
  }
  function submit() {
    if (!editable()) return;
    // Read the same fields for typed and button-entered answers.
    for (const key of fields()) state.answers[key] = input(key).value;
    state.results = checkAnswers();
    const correct = state.results.every((result) => result.passed);
    state.sessionResults[state.current] = correct;
    state.attempts = Object.keys(state.sessionResults).length;
    state.correct = Object.values(state.sessionResults).filter(Boolean).length;
    state.locked = true;
    if (state.attempts === 64) {
      state.completed = true;
      pauseTimer();
      render();
      save();
      return;
    }
    if (state.timerEnabled && correct) {
      nextSquare();
      return;
    }
    render();
    save();
  }
  function changeSettings(update) {
    if (state.locked) { render(); return; }
    update();
    enforcePrompt();
    if (state.current) {
      state.shownPrompt = C.promptFor(state.current, state.promptMode, state.answerMode, state.custom);
      clearAnswers();
    }
    render();
    focusAnswer();
    save();
  }
  function resetState() {
    pauseTimer();
    state = defaults();
    render();
  }
  function startSession(reshuffle) {
    if (!reshuffle && (state.completed || !state.current)) return;
    if (state.current && !state.completed && !window.confirm(reshuffle
      ? "End this unfinished session and reshuffle all 64 squares? Its score will reset."
      : "Reset this session and start its 64 squares again? Its score will reset.")) return;
    pauseTimer();
    if (reshuffle) state.cycle = C.shuffle(C.allSquares());
    state.index = 0;
    state.current = null;
    state.shownPrompt = null;
    state.attempts = 0;
    state.correct = 0;
    state.sessionResults = {};
    state.completed = false;
    state.locked = false;
    state.timerElapsed = 0;
    clearAnswers();
    nextSquare();
  }

  register(moduleId, {
    async init() {
      const replacedLegacyProgress = restore(await api.loadState(moduleId));
      if (replacedLegacyProgress) {
        await save(true);
        if (saveError) throw saveError;
      }
      const touch = document.body.dataset.inputMode === "touch";
      keys.forEach((key) => {
        input(key).readOnly = touch;
        if (touch) input(key).inputMode = "none";
        const select = () => {
          if (key === "color" || !editable() || !fields().includes(key)) return;
          state.activeField = key;
          renderKeypad();
        };
        input(key).addEventListener("focus", select);
        input(key).addEventListener("click", select);
        input(key).addEventListener("input", () => {
          if (!editable() || !fields().includes(key)) { input(key).value = state.answers[key]; return; }
          state.answers[key] = input(key).value;
          if (key !== "color") state.activeField = key;
          if (autoCheck()) return;
          renderColor();
          renderKeypad();
          save();
        });
      });
      for (const [id, value] of [["sdColorLight", "white"], ["sdColorDark", "black"]]) {
        el(id).addEventListener("click", () => {
          if (!editable()) return;
          input("color").value = C.normalizeColor(state.answers.color) === value ? "" : value;
          input("color").dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      el("sdNext").addEventListener("click", nextSquare);
      el("sdSubmit").addEventListener("click", submit);
      el("sdReshuffle").addEventListener("click", () => startSession(true));
      el("sdReset").addEventListener("click", () => startSession(false));
      el("sdPromptMode").addEventListener("change", (event) => changeSettings(() => { state.promptMode = event.target.value; }));
      el("sdAnswerMode").addEventListener("change", (event) => changeSettings(() => { state.answerMode = event.target.value; }));
      el("sdCustom").addEventListener("change", (event) => {
        if (!["algebraic", "white", "black"].includes(event.target.value)) return;
        changeSettings(() => { state.custom[event.target.value] = event.target.checked; });
      });
      el("sdTimerEnabled").addEventListener("change", (event) => { if (!state.completed) { state.timerEnabled = event.target.checked; save(); } render(); });
      el("sdRemember").addEventListener("change", async (event) => {
        state.remember = event.target.checked;
        await save(true);
        showNotice(state.remember ? "This module will be remembered." : "Remembering paused; saved data was retained.");
      });
      el("sdClearSaved").addEventListener("click", () => {
        pendingClear = pendingClear.then(async () => { await saveQueue; await clearSaved(moduleId, resetState); });
      });
      document.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.repeat || !active || state.completed) return;
        if (event.target.closest?.("button, select, a, textarea, input[type=checkbox]")) return;
        event.preventDefault();
        if (editable()) {
          if (state.timerEnabled) autoCheck(); else submit();
        } else nextSquare();
      });
      document.addEventListener("visibilitychange", () => { syncTimer(); if (document.hidden) save(); });
      window.addEventListener("pagehide", () => { pauseTimer(); save(); });
      document.addEventListener("chess-mobile-flush", () => save());
      document.addEventListener("chess-mobile-pause", () => { nativePaused = true; syncTimer(); save(); });
      document.addEventListener("chess-mobile-resume", () => { nativePaused = false; syncTimer(); });
      render();
    },
    activate() { active = true; syncTimer(); focusAnswer(); },
    deactivate() { active = false; syncTimer(); save(); },
    async flush() {
      await pendingClear;
      await save();
      // Remember-off still needs its final snapshot to become durable. Retry
      // that exact snapshot, never any answers entered after remembering paused.
      if (!state.remember && failedPayload) await queueSave(failedPayload);
      if (saveError) throw saveError;
    },
  });
})();
