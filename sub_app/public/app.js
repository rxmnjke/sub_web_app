const $ = (id) => document.getElementById(id);

const msg = $("msg");
const clientsTbody = $("clientsTbody");
const clientSelect = $("clientSelect");
const MAX_SOURCE_SUBS = 5;

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

$("createClient").onclick = async () => {
  const name = $("newClientName").value.trim();
  if (!name) return setMessage("Введите имя клиента", false);

  const r = await api("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!r.ok) return setMessage(`Ошибка создания: ${await safeErr(r)}`, false);

  $("newClientName").value = "";
  setMessage("Клиент создан");
  await loadClients();
};

$("showClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const r = await api(`/admin/clients/${id}`);
  if (!r.ok) return setMessage(`Ошибка: ${await safeErr(r)}`, false);

  const c = await r.json();
  $("vlessLinks").value = (c.links || []).join("\n");
  setSourceSubItemsToForm(c.sourceSubs || []);
  $("customJson").value = c.customJson ? JSON.stringify(c.customJson, null, 2) : "";
  setMessage(`Клиент "${c.name}" загружен`);
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
loadClients();