(() => {
  "use strict";
  const files = "abcdefgh";
  const descriptiveFiles = ["QR", "QN", "QB", "Q", "K", "KB", "KN", "KR"];
  const notations = ["algebraic", "white", "black"];
  const labels = { color: "Color", algebraic: "Algebraic", white: "White descriptive", black: "Black descriptive" };

  function allSquares() {
    return Array.from({ length: 8 }, (_, rank) => [...files].map((file) => `${file}${rank + 1}`)).flat();
  }
  function shuffle(values) {
    const result = [...values];
    for (let i = result.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  }
  function validCycle(value) {
    return Array.isArray(value) && value.length === 64 && new Set(value).size === 64 && value.every((square) => typeof square === "string" && /^[a-h][1-8]$/.test(square));
  }
  function details(square) {
    const file = files.indexOf(square[0]);
    const rank = Number(square[1]);
    return {
      color: (file + rank) % 2 === 1 ? "black" : "white",
      algebraic: square,
      white: `${descriptiveFiles[file]}${rank}`,
      black: `${descriptiveFiles[file]}${9 - rank}`,
    };
  }
  function normalizeColor(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (["black", "dark", "b"].includes(normalized)) return "black";
    if (["white", "light", "w"].includes(normalized)) return "white";
    return normalized;
  }
  function normalizeAlg(value) { return String(value || "").trim().toLowerCase(); }
  function normalizeDesc(value) { return String(value || "").trim().toUpperCase().replace(/\s+/g, ""); }
  function selectedFields(answerMode, custom = {}) {
    if (answerMode === "white") return ["color", "white"];
    if (answerMode === "algebraic") return ["color", "algebraic"];
    if (answerMode === "custom") return ["color", ...notations.filter((key) => custom[key] === true)];
    return ["color", ...notations];
  }
  function eligiblePrompts(answerMode, custom) {
    const selected = selectedFields(answerMode, custom).filter((key) => key !== "color");
    return selected.length === 1 ? notations.filter((key) => key !== selected[0]) : [...notations];
  }
  function effectiveFields(answerMode, custom, promptFormat) {
    return selectedFields(answerMode, custom).filter((key) => key === "color" || key !== promptFormat);
  }
  function promptFor(square, requested, answerMode, custom) {
    const eligible = eligiblePrompts(answerMode, custom);
    const format = requested === "random" ? eligible[Math.floor(Math.random() * eligible.length)] : eligible.includes(requested) ? requested : eligible[0];
    return { format, text: details(square)[format], label: labels[format] };
  }
  window.SquareDrillsCore = { allSquares, shuffle, validCycle, details, normalizeColor, normalizeAlg, normalizeDesc, selectedFields, eligiblePrompts, effectiveFields, promptFor, descriptiveFiles, labels };
})();
