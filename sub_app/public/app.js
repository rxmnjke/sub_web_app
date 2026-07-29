const $ = (id) => document.getElementById(id);

const tokenInput = $("token");
const authMsg = $("authMsg");
const msg = $("msg");
const clientsTbody = $("clientsTbody");
const clientSelect = $("clientSelect");

function getToken() {
  return sessionStorage.getItem("admin_token") || "";
}
function setToken(t) {
  sessionStorage.setItem("admin_token", t);
}
function api(path, options = {}) {
  const t = getToken();
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "x-admin-token": t,
      ...(options.headers || {})
    }
  });
}
function setMessage(text, ok = true) {
  msg.className = ok ? "ok" : "err";
  msg.textContent = text;
}
function currentOrigin() {
  return window.location.origin;
}

async function loadClients() {
  setMessage("Загрузка...");
  const r = await api("/admin/clients");
  if (!r.ok) {
    const e = await safeErr(r);
    setMessage(`Ошибка загрузки клиентов: ${e}`, false);
    return;
  }
  const clients = await r.json();
  renderClients(clients);
  fillSelect(clients);
  setMessage(`Клиентов: ${clients.length}`);
}

function renderClients(clients) {
  clientsTbody.innerHTML = "";
  for (const c of clients) {
    const tr = document.createElement("tr");
    const mode = c.customJson ? "customJson" : "links";
    const subUrl = `${currentOrigin()}/sub/${c.token}`;
    tr.innerHTML = `
      <td>${escapeHtml(c.name || "")}</td>
      <td class="small">${escapeHtml(c.id)}</td>
      <td class="small">${escapeHtml(c.token)}</td>
      <td>${mode}</td>
      <td>${Array.isArray(c.links) ? c.links.length : 0}</td>
      <td class="small"><a href="${subUrl}" target="_blank">${subUrl}</a></td>
    `;
    clientsTbody.appendChild(tr);
  }
}

function fillSelect(clients) {
  clientSelect.innerHTML = "";
  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    clientSelect.appendChild(opt);
  }
}

async function safeErr(r) {
  try {
    const j = await r.json();
    return j.error || JSON.stringify(j);
  } catch {
    return `${r.status} ${r.statusText}`;
  }
}

function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

$("saveToken").onclick = () => {
  const t = tokenInput.value.trim();
  setToken(t);
  authMsg.textContent = "Токен сохранен в sessionStorage";
};

$("loadClients").onclick = loadClients;

$("createClient").onclick = async () => {
  const name = $("newClientName").value.trim();
  if (!name) return setMessage("Введите имя клиента", false);

  const r = await api("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!r.ok) return setMessage(`Ошибка создания: ${await safeErr(r)}`, false);

  setMessage("Клиент создан");
  $("newClientName").value = "";
  await loadClients();
};

$("deleteClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  if (!confirm("Удалить клиента? Это действие необратимо.")) return;

  const r = await api(`/admin/clients/${id}`, { method: "DELETE" });
  if (!r.ok) return setMessage(`Ошибка удаления клиента: ${await safeErr(r)}`, false);

  setMessage("Клиент удален");
  $("vlessLinks").value = "";
  $("customJson").value = "";
  await loadClients();
};

$("showClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const r = await api(`/admin/clients/${id}`);
  if (!r.ok) return setMessage(`Ошибка: ${await safeErr(r)}`, false);

  const c = await r.json();
  $("vlessLinks").value = (c.links || []).join("\n");
  $("customJson").value = c.customJson ? JSON.stringify(c.customJson, null, 2) : "";
  setMessage(`Клиент "${c.name}" загружен`);
};

$("importLinks").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const links = $("vlessLinks").value
    .split("\n")
    .map(s => s.trim())
    .filter(Boolean);

  const replace = $("replaceLinks").checked;

  const r = await api(`/admin/clients/${id}/import`, {
    method: "POST",
    body: JSON.stringify({ links, replace })
  });
  if (!r.ok) return setMessage(`Ошибка импорта: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(`Импорт OK. Всего ссылок: ${j.totalLinks}`);
  await loadClients();
};

$("saveCustomJson").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const raw = $("customJson").value.trim();
  if (!raw) return setMessage("Вставьте JSON", false);

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    return setMessage(`JSON невалиден: ${e.message}`, false);
  }

  const r = await api(`/admin/clients/${id}/custom-json`, {
    method: "POST",
    body: JSON.stringify({ json: parsed, replace: true })
  });
  if (!r.ok) return setMessage(`Ошибка сохранения JSON: ${await safeErr(r)}`, false);

  setMessage("Custom JSON сохранен");
  await loadClients();
};

$("deleteCustomJson").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const r = await api(`/admin/clients/${id}/custom-json`, { method: "DELETE" });
  if (!r.ok) return setMessage(`Ошибка удаления custom JSON: ${await safeErr(r)}`, false);

  setMessage("Custom JSON удален, режим links восстановлен");
  $("customJson").value = "";
  await loadClients();
};

// init
tokenInput.value = getToken();
