const $ = (id) => document.getElementById(id);

const msg = $("msg");
const clientsTbody = $("clientsTbody");
const clientSelect = $("clientSelect");
const MAX_SOURCE_SUBS = 5;

const adminBroadcastMessage = $("adminBroadcastMessage");
const adminBroadcastLinkUrl = $("adminBroadcastLinkUrl");
const adminBroadcastPreview = $("adminBroadcastPreview");

function api(path, options = {}) {
  return fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
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

function fillSelect(clients) {
  clientSelect.innerHTML = "";
  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    clientSelect.appendChild(opt);
  }
}

function renderAdminBroadcastPreview(payload = {}) {
  const message = String(payload?.announce || payload?.message || "").trim();
  const linkUrl = String(payload?.supportUrl || payload?.linkUrl || "").trim();

  if (!message) {
    adminBroadcastPreview.className = "broadcast-preview muted";
    adminBroadcastPreview.textContent = "Сообщение пока не задано.";
    return;
  }

  adminBroadcastPreview.className = "broadcast-preview";
  const safeMessage = escapeHtml(message);
  const safeLinkUrl = escapeHtml(linkUrl);

  adminBroadcastPreview.innerHTML = linkUrl
    ? `${safeMessage} <a class="icon-link" href="${safeLinkUrl}" target="_blank" rel="noopener noreferrer" title="Support">&#128279;</a>`
    : safeMessage;
}

function insertAtCursor(input, text) {
  if (!input || !text) return;

  const start = Number.isInteger(input.selectionStart) ? input.selectionStart : input.value.length;
  const end = Number.isInteger(input.selectionEnd) ? input.selectionEnd : input.value.length;
  const before = input.value.slice(0, start);
  const after = input.value.slice(end);

  input.value = `${before}${text}${after}`;
  const next = start + text.length;
  input.selectionStart = next;
  input.selectionEnd = next;
}

async function loadAdminBroadcastSettings() {
  const r = await api("/admin/settings");
  if (!r.ok) return setMessage(`Ошибка загрузки сообщения: ${await safeErr(r)}`, false);

  const data = await r.json();
  const payload = data?.subscriptionInfo || data?.adminBroadcast || {};

  adminBroadcastMessage.value = payload.announce || payload.message || "";
  adminBroadcastLinkUrl.value = payload.supportUrl || payload.linkUrl || "";
  renderAdminBroadcastPreview(payload);
}

function renderClients(clients) {
  clientsTbody.innerHTML = "";
  for (const c of clients) {
    const tr = document.createElement("tr");
    const mode = c.customJson ? "customJson" : "template";
    const subUrl = `${currentOrigin()}/sub/${c.token}`;
    tr.innerHTML = `
      <td>${escapeHtml(c.name || "")}</td>
      <td class="small">${escapeHtml(c.id)}</td>
      <td class="small">${escapeHtml(c.token)}</td>
      <td>${mode}</td>
      <td>${Array.isArray(c.links) ? c.links.length : 0}</td>
      <td>${Array.isArray(c.sourceSubs) ? c.sourceSubs.length : 0}</td>
      <td class="small"><a href="${subUrl}" target="_blank">${subUrl}</a></td>
    `;
    clientsTbody.appendChild(tr);
  }
}

function getSourceSubItemsFromForm() {
  const items = [];
  for (let i = 1; i <= MAX_SOURCE_SUBS; i++) {
    const url = $(`subUrl${i}`).value.trim();
    const country = $(`subCountry${i}`).value;
    if (!url) continue;
    items.push({ url, country });
  }
  return items;
}

function setSourceSubItemsToForm(items = []) {
  for (let i = 1; i <= MAX_SOURCE_SUBS; i++) {
    $(`subUrl${i}`).value = "";
    $(`subCountry${i}`).value = "germany";
  }

  for (let i = 0; i < Math.min(items.length, MAX_SOURCE_SUBS); i++) {
    const row = items[i] || {};
    $(`subUrl${i + 1}`).value = row.url || "";
    $(`subCountry${i + 1}`).value = row.country || "germany";
  }
}

async function loadClients() {
  setMessage("Загрузка...");
  const r = await api("/admin/clients");
  if (!r.ok) return setMessage(`Ошибка загрузки клиентов: ${await safeErr(r)}`, false);

  const clients = await r.json();
  renderClients(clients);
  fillSelect(clients);
  setMessage(`Клиентов: ${clients.length}`);
}

$("loadClients").onclick = loadClients;

$("loadAdminBroadcast").onclick = async () => {
  await loadAdminBroadcastSettings();
  setMessage("Общее сообщение загружено");
};

$("saveAdminBroadcast").onclick = async () => {
  const payload = {
    announce: adminBroadcastMessage.value.trim(),
    supportUrl: adminBroadcastLinkUrl.value.trim()
  };

  const r = await api("/admin/settings/subscription-info", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  if (!r.ok) return setMessage(`Ошибка сохранения сообщения: ${await safeErr(r)}`, false);

  const j = await r.json();
  renderAdminBroadcastPreview(j.subscriptionInfo || payload);
  setMessage("Общее сообщение сохранено");
};

adminBroadcastMessage.addEventListener("input", () => {
  renderAdminBroadcastPreview({
    announce: adminBroadcastMessage.value,
    supportUrl: adminBroadcastLinkUrl.value
  });
});

adminBroadcastLinkUrl.addEventListener("input", () => {
  renderAdminBroadcastPreview({
    announce: adminBroadcastMessage.value,
    supportUrl: adminBroadcastLinkUrl.value
  });
});

document.querySelectorAll("[data-emoji]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const emoji = String(btn.getAttribute("data-emoji") || "");
    if (!emoji) return;

    insertAtCursor(adminBroadcastMessage, emoji);
    adminBroadcastMessage.focus();
    renderAdminBroadcastPreview({
      announce: adminBroadcastMessage.value,
      supportUrl: adminBroadcastLinkUrl.value
    });
  });
});

$("createClient").onclick = async () => {
  const name = $("newClientName").value.trim();
  const maxDevices = Number($("newClientMaxDevices").value);
  if (!name) return setMessage("Введите имя клиента", false);

  const r = await api("/admin/clients", {
    method: "POST",
    body: JSON.stringify({
      name,
      maxDevices: Number.isFinite(maxDevices) && maxDevices > 0 ? maxDevices : 2
    })
  });
  if (!r.ok) return setMessage(`Ошибка создания: ${await safeErr(r)}`, false);

  $("newClientName").value = "";
  $("newClientMaxDevices").value = "2";
  setMessage("Клиент создан");
  await loadClients();
};

$("showClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const r = await api(`/admin/clients/${id}`);
  if (!r.ok) return setMessage(`Ошибка: ${await safeErr(r)}`, false);

  const c = await r.json();
  renderDevices(c);
  $("clientMaxDevices").value = Number(c.maxDevices) > 0 ? Number(c.maxDevices) : 2;
  $("vlessLinks").value = (c.links || []).join("\n");
  setSourceSubItemsToForm(c.sourceSubs || []);
  $("customJson").value = c.customJson ? JSON.stringify(c.customJson, null, 2) : "";
  setMessage(`Клиент "${c.name}" загружен`);
};

$("saveClientMaxDevices").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const maxDevices = Number($("clientMaxDevices").value);
  if (!Number.isFinite(maxDevices) || maxDevices < 1) {
    return setMessage("Укажите корректный лимит устройств (минимум 1)", false);
  }

  const r = await api(`/admin/clients/${id}/max-devices`, {
    method: "POST",
    body: JSON.stringify({ maxDevices })
  });
  if (!r.ok) return setMessage(`Ошибка сохранения лимита: ${await safeErr(r)}`, false);

  const j = await r.json();
  $("clientMaxDevices").value = Number(j.maxDevices) > 0 ? Number(j.maxDevices) : 2;
  const client = await api(`/admin/clients/${id}`);
  if (client.ok) {
    const updated = await client.json();
    renderDevices(updated);
  }
  setMessage(`Лимит устройств сохранён: ${j.maxDevices}`);
};

$("deleteClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  if (!confirm("Удалить клиента? Это действие необратимо.")) return;

  const r = await api(`/admin/clients/${id}`, { method: "DELETE" });
  if (!r.ok) return setMessage(`Ошибка удаления клиента: ${await safeErr(r)}`, false);

  $("vlessLinks").value = "";
  $("customJson").value = "";
  setSourceSubItemsToForm([]);
  renderDevices({ devices: [] });
  setMessage("Клиент удален");
  await loadClients();
};

$("importLinks").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const links = $("vlessLinks").value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const replace = $("replaceLinks").checked;

  const r = await api(`/admin/clients/${id}/import`, {
    method: "POST",
    body: JSON.stringify({ links, replace })
  });
  if (!r.ok) return setMessage(`Ошибка импорта: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(`Импорт OK. Всего ручных ссылок: ${j.totalLinks}`);
  await loadClients();
};

$("saveSourceSubs").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const items = getSourceSubItemsFromForm();
  const replace = $("replaceSourceSubs").checked;

  const r = await api(`/admin/clients/${id}/source-subs`, {
    method: "POST",
    body: JSON.stringify({ items, replace })
  });

  if (!r.ok) return setMessage(`Ошибка сохранения source subs: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(`Source subs сохранены. Всего: ${j.totalSourceSubs}`);
  await loadClients();
};

$("previewMerged").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const r = await api(`/admin/clients/${id}/preview-merged-links`, { method: "POST" });
  if (!r.ok) return setMessage(`Ошибка preview: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(
    `Preview: manual=${j.manualLinks}, fetched=${j.fetchedLinks}, total≈${j.totalMergedApprox}`
  );
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

  $("customJson").value = "";
  setMessage("Custom JSON удален, режим template восстановлен");
  await loadClients();
};

// init
Promise.all([loadClients(), loadAdminBroadcastSettings()]).catch((e) => {
  setMessage(`Ошибка инициализации: ${e.message}`, false);
});