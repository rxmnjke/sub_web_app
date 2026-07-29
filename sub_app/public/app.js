const $ = (id) => document.getElementById(id);

const msg = $("msg");
const clientsTbody = $("clientsTbody");
const clientSelect = $("clientSelect");

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
  $("sourceSubs").value = (c.sourceSubs || []).join("\n");
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
  setMessage(`Импорт OK. Всего ссылок: ${j.totalLinks}`);
  await loadClients();
};

$("saveSourceSubs").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const urls = $("sourceSubs").value
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);

  const replace = $("replaceSourceSubs").checked;

  const r = await api(`/admin/clients/${id}/source-subs`, {
    method: "POST",
    body: JSON.stringify({ urls, replace })
  });

  if (!r.ok) return setMessage(`Ошибка сохранения source subs: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(`Source subs сохранены. Всего: ${j.totalSourceSubs}`);
  await loadClients();
};

$("deleteClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  if (!confirm("Удалить клиента? Это действие необратимо.")) return;

  const r = await api(`/admin/clients/${id}`, { method: "DELETE" });
  if (!r.ok) return setMessage(`Ошибка удаления клиента: ${await safeErr(r)}`, false);

  $("vlessLinks").value = "";
  $("sourceSubs").value = "";
  $("customJson").value = "";
  setMessage("Клиент удален");
  await loadClients();
};

// init
loadClients();
