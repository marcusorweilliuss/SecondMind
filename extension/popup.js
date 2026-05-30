// Cortex popup: sign in to Supabase, pick the active project.

const CONFIG = self.CORTEX_CONFIG;

const el = (id) => document.getElementById(id);
const loginView = el("login-view");
const mainView = el("main-view");

function setStatus(msg) {
  el("status").textContent = msg || "";
}

async function getStored(keys) {
  return new Promise((resolve) => chrome.storage.local.get(keys, resolve));
}

async function signIn(email, password) {
  const res = await fetch(
    `${CONFIG.SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    }
  );
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error_description || data.msg || "Sign-in failed.");
  }
  const data = await res.json();
  await chrome.storage.local.set({
    cortex_access_token: data.access_token,
    cortex_refresh_token: data.refresh_token,
    cortex_email: data.user?.email || email,
  });
  return data;
}

async function loadProjects() {
  const { cortex_access_token } = await getStored(["cortex_access_token"]);
  const res = await fetch(`${CONFIG.API_BASE}/api/projects`, {
    headers: { Authorization: `Bearer ${cortex_access_token}` },
  });
  if (!res.ok) throw new Error("Could not load projects.");
  const data = await res.json();
  return data.projects || [];
}

async function renderMain() {
  const { cortex_email, cortex_active_project } = await getStored([
    "cortex_email",
    "cortex_active_project",
  ]);
  el("account-email").textContent = cortex_email || "";

  const select = el("project-select");
  select.innerHTML = "";
  setStatus("Loading projects…");
  try {
    const projects = await loadProjects();
    if (projects.length === 0) {
      const opt = document.createElement("option");
      opt.textContent = "No projects yet — create one in the web app";
      opt.disabled = true;
      select.appendChild(opt);
    }
    for (const p of projects) {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.name;
      if (p.id === cortex_active_project) opt.selected = true;
      select.appendChild(opt);
    }
    setStatus("");
  } catch (e) {
    setStatus(String(e.message || e));
  }

  select.addEventListener("change", () => {
    chrome.storage.local.set({ cortex_active_project: select.value });
    setStatus("Active project updated.");
  });

  loginView.classList.add("hidden");
  mainView.classList.remove("hidden");
}

function showLogin() {
  mainView.classList.add("hidden");
  loginView.classList.remove("hidden");
}

el("login-btn").addEventListener("click", async () => {
  el("login-error").textContent = "";
  const email = el("email").value.trim();
  const password = el("password").value;
  if (!email || !password) {
    el("login-error").textContent = "Enter email and password.";
    return;
  }
  el("login-btn").disabled = true;
  el("login-btn").textContent = "Signing in…";
  try {
    await signIn(email, password);
    await renderMain();
  } catch (e) {
    el("login-error").textContent = String(e.message || e);
  } finally {
    el("login-btn").disabled = false;
    el("login-btn").textContent = "Sign in";
  }
});

el("logout-btn").addEventListener("click", async () => {
  await chrome.storage.local.remove([
    "cortex_access_token",
    "cortex_refresh_token",
    "cortex_email",
    "cortex_active_project",
  ]);
  showLogin();
});

(async function init() {
  const { cortex_access_token } = await getStored(["cortex_access_token"]);
  if (cortex_access_token) {
    await renderMain();
  } else {
    showLogin();
  }
})();
