(() => {
  "use strict";
  window.AndroidAPI = {
    request(url, options = {}) {
      const method = options.method || "GET";
      const body = options.body ? JSON.parse(options.body) : {};
      if (!window.AndroidStore) throw new Error("Open Square Drills in its Android app to use local storage.");
      const response = JSON.parse(window.AndroidStore.request(JSON.stringify({ url, method, body })));
      if (!response.ok) throw new Error(response.detail || "Local operation failed");
      return response.result;
    },
  };
})();
