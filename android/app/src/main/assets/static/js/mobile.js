(() => {
  "use strict";
  function setup() {
    document.addEventListener("visibilitychange", () => { if (document.hidden) flush(); });
    window.addEventListener("pagehide", flush);
  }
  function flush() { document.dispatchEvent(new Event("chess-mobile-flush")); }
  function pause() { document.dispatchEvent(new Event("chess-mobile-pause")); flush(); }
  function resume() { document.dispatchEvent(new Event("chess-mobile-resume")); }
  window.MobileUI = { setup, flush, pause, resume };
})();
