// Cortex content script.
// Shows a floating "Save signal" button when text is highlighted, and a toast
// with the resulting connection after capture.

(() => {
  let button = null;
  let lastSelection = "";

  function removeButton() {
    if (button) {
      button.remove();
      button = null;
    }
  }

  function showButton(x, y, text) {
    removeButton();
    lastSelection = text;

    button = document.createElement("div");
    button.className = "cortex-capture-btn";
    button.textContent = "+ Signal";
    button.style.top = `${y + window.scrollY + 8}px`;
    button.style.left = `${x + window.scrollX}px`;

    button.addEventListener("mousedown", (e) => {
      // Prevent the click from clearing the current selection.
      e.preventDefault();
      e.stopPropagation();
    });
    button.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      capture(lastSelection);
    });

    document.body.appendChild(button);
  }

  function capture(text) {
    if (button) {
      button.textContent = "Saving…";
      button.classList.add("cortex-loading");
    }
    chrome.runtime.sendMessage(
      {
        type: "CORTEX_CAPTURE",
        payload: {
          highlight_text: text,
          source_url: location.href,
          source_title: document.title,
        },
      },
      (response) => {
        removeButton();
        if (chrome.runtime.lastError) {
          showToast("error", "Cortex: " + chrome.runtime.lastError.message);
          return;
        }
        if (!response?.ok) {
          showToast("error", response?.error || "Cortex capture failed.");
          return;
        }
        const s = response.signal;
        const project = s.project_name ? `Project: ${s.project_name}` : "Unfiled";
        const connection = s.connected_to
          ? `Connected to: ${s.connected_to}`
          : `Saved: ${s.signal_summary || "signal"}`;
        showToast("ok", `[Signal saved → ${project}]\n${connection}`);
      }
    );
  }

  function showToast(kind, message) {
    const toast = document.createElement("div");
    toast.className = `cortex-toast cortex-toast-${kind}`;
    toast.textContent = message;
    document.body.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add("cortex-toast-in"));
    setTimeout(() => {
      toast.classList.remove("cortex-toast-in");
      setTimeout(() => toast.remove(), 300);
    }, 5000);
  }

  document.addEventListener("mouseup", (e) => {
    if (button && button.contains(e.target)) return;
    setTimeout(() => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text.length > 3 && sel.rangeCount > 0) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        showButton(rect.right, rect.bottom, text);
      } else {
        removeButton();
      }
    }, 10);
  });

  document.addEventListener("scroll", removeButton, { passive: true });
})();
