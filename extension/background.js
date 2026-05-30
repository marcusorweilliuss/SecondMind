// Cortex MV3 service worker.
// Holds the auth token + active project, and proxies signal-capture requests
// to the Next.js API so the content script never touches credentials.

importScripts("config.js");

const CONFIG = self.CORTEX_CONFIG;

async function getStored(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

// Refresh the Supabase access token using the stored refresh token.
async function refreshAccessToken() {
  const { cortex_refresh_token } = await getStored(["cortex_refresh_token"]);
  if (!cortex_refresh_token) return null;

  const res = await fetch(
    `${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ refresh_token: cortex_refresh_token }),
    }
  );
  if (!res.ok) return null;
  const data = await res.json();
  await chrome.storage.local.set({
    cortex_access_token: data.access_token,
    cortex_refresh_token: data.refresh_token,
  });
  return data.access_token;
}

// POST a captured highlight to the backend, retrying once on 401.
async function captureSignal(payload) {
  let { cortex_access_token } = await getStored(["cortex_access_token"]);
  if (!cortex_access_token) {
    return { ok: false, error: "Not signed in. Open the Cortex popup to log in." };
  }

  const doFetch = (token) =>
    fetch(`${CONFIG.API_BASE}/api/signals`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

  let res = await doFetch(cortex_access_token);
  if (res.status === 401) {
    const refreshed = await refreshAccessToken();
    if (refreshed) res = await doFetch(refreshed);
  }

  if (!res.ok) {
    const text = await res.text();
    return { ok: false, error: `Capture failed (${res.status}): ${text}` };
  }
  const data = await res.json();
  return { ok: true, signal: data.signal };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CORTEX_CAPTURE") {
    getStored(["cortex_active_project"]).then(({ cortex_active_project }) => {
      captureSignal({ ...message.payload, project_id: cortex_active_project })
        .then(sendResponse)
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
    });
    return true; // async response
  }
  return false;
});
