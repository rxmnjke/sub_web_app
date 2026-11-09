const $ = (id) => document.getElementById(id);

const msg = $("msg");
const clientsTbody = $("clientsTbody");
const clientSelect = $("clientSelect");
const MAX_SOURCE_SUBS = 6;

const adminBroadcastMessage = $("adminBroadcastMessage");
const adminBroadcastLinkUrl = $("adminBroadcastLinkUrl");
const adminBroadcastPreview = $("adminBroadcastPreview");
let xrayRulesLimit = 20;

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
  const previousValue = clientSelect.value;
  clientSelect.innerHTML = "";

  for (const c of clients) {
    const opt = document.createElement("option");
    opt.value = c.id;
    opt.textContent = `${c.name} (${c.id})`;
    clientSelect.appendChild(opt);
  }

  if (clients.some((c) => c.id === previousValue)) {
    clientSelect.value = previousValue;
    return;
  }

  if (clients.length) {
    clientSelect.value = clients[0].id;
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

  xrayRulesLimit = Number(data?.xrayRulesLimit || 20);
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
    const maxDevices = Number(c.maxDevices) > 0 ? Number(c.maxDevices) : 2;
    tr.innerHTML = `
      <td>${escapeHtml(c.name || "")}</td>
      <td class="small">${escapeHtml(c.id)}</td>
      <td class="small">${escapeHtml(c.token)}</td>
      <td>${mode}</td>
      <td>${maxDevices}</td>
      <td>${Array.isArray(c.links) ? c.links.length : 0}</td>
      <td>${Array.isArray(c.sourceSubs) ? c.sourceSubs.length : 0}</td>
      <td>${Array.isArray(c.externalConfigRefs) ? c.externalConfigRefs.length : 0}</td>
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

function createClientXrayRuleRow(rule = {}) {
  const row = document.createElement("div");
  row.className = "row client-xray-rule-row";
  row.style.marginTop = "8px";
  row.style.alignItems = "center";

  const type = document.createElement("select");
  type.innerHTML = `
    <option value="domain">Домен</option>
    <option value="cidr">CIDR</option>
  `;
  type.value = rule.type === "cidr" ? "cidr" : "domain";

  const value = document.createElement("input");
  value.type = "text";
  value.value = String(rule.value || "");
  value.placeholder = rule.type === "cidr" ? "192.168.0.0/16" : "example.com";
  value.style.width = "280px";

  const action = document.createElement("select");
  action.innerHTML = `
    <option value="block">Блокировать</option>
    <option value="direct">Вести напрямую</option>
    <option value="tunnel">Через туннель</option>
  `;
  action.value = ["block", "direct", "tunnel"].includes(rule.action) ? rule.action : "block";

  const remove = document.createElement("button");
  remove.type = "button";
  remove.textContent = "Удалить";
  remove.className = "danger";
  remove.onclick = () => row.remove();

  row.append(type, value, action, remove);
  return row;
}

function renderClientXrayRules(rows = []) {
  const list = $("clientXrayRulesList");
  if (!list) return;
  list.innerHTML = "";

  if (!rows.length) {
    list.appendChild(createClientXrayRuleRow({ type: "domain", value: "", action: "block" }));
    return;
  }

  for (const rule of rows) {
    list.appendChild(createClientXrayRuleRow(rule));
  }
}

function getClientXrayRulesFromForm() {
  const list = $("clientXrayRulesList");
  if (!list) return [];

  const rows = list.querySelectorAll(".client-xray-rule-row");
  const rules = [];

  for (const row of rows) {
    const type = row.querySelector("select")?.value || "domain";
    const valueEl = row.querySelector("input[type='text']");
    const actionEl = row.querySelectorAll("select")[1];
    const value = String(valueEl?.value || "").trim();
    const action = actionEl?.value || "block";

    if (!value) continue;
    rules.push({
      type,
      value,
      action
    });
  }

  return rules;
}

function setClientXrayRulesToForm(rules = []) {
  const normalized = Array.isArray(rules) ? rules.filter((r) => r && String(r.value || "").trim()) : [];
  renderClientXrayRules(normalized.length ? normalized : [{ type: "domain", value: "", action: "block" }]);
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
  if (!name) return setMessage("Введите имя клиента", false);

  const r = await api("/admin/clients", {
    method: "POST",
    body: JSON.stringify({
      name,
      maxDevices: 2
    })
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
  renderDevices(c);
  $("clientMaxDevices").value = Number(c.maxDevices) > 0 ? Number(c.maxDevices) : 2;
  $("clientBlockAds").checked = Boolean(c.blockAds);
  $("renameClientName").value = c.name || "";
  $("vlessLinks").value = (c.links || []).join("\n");
  setSourceSubItemsToForm(c.sourceSubs || []);
  setClientXrayRulesToForm(c.xrayRules || []);
  $("customJson").value = c.customJson ? JSON.stringify(c.customJson, null, 2) : "";
  await loadClientExternalConfigs(c.id);
  setMessage(`Клиент "${c.name}" загружен`);
};

$("renameClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const name = $("renameClientName").value.trim();
  if (!name) return setMessage("Введите новое имя клиента", false);

  const r = await api(`/admin/clients/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name })
  });
  if (!r.ok) return setMessage(`Ошибка переименования: ${await safeErr(r)}`, false);

  const j = await r.json();
  $("renameClientName").value = j.name;
  setMessage(`Клиент переименован: ${j.name}`);
  await loadClients();
};

$("saveClientXrayRules").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const rules = getClientXrayRulesFromForm();
  if (rules.length > xrayRulesLimit) {
    return setMessage(`Слишком много правил. Максимум: ${xrayRulesLimit}`, false);
  }

  const r = await api(`/admin/clients/${id}/xray-rules`, {
    method: "POST",
    body: JSON.stringify({ rules })
  });
  if (!r.ok) return setMessage(`Ошибка сохранения правил Xray: ${await safeErr(r)}`, false);

  const j = await r.json();
  setMessage(`Правила Xray сохранены: ${j.xrayRules.length}`);
  const client = await api(`/admin/clients/${id}`);
  if (client.ok) {
    const updated = await client.json();
    setClientXrayRulesToForm(updated.xrayRules || []);
  }
};

$("addClientXrayRule").onclick = () => {
  const list = $("clientXrayRulesList");
  if (!list) return;

  const currentCount = list.querySelectorAll(".client-xray-rule-row").length;
  if (currentCount >= xrayRulesLimit) {
    setMessage(`Максимум ${xrayRulesLimit} правил для клиента`, false);
    return;
  }

  list.appendChild(createClientXrayRuleRow({ type: "domain", value: "", action: "block" }));
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

$("saveClientBlockAds").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const blockAds = $("clientBlockAds").checked;
  const r = await api(`/admin/clients/${id}/block-ads`, {
    method: "POST",
    body: JSON.stringify({ blockAds })
  });
  if (!r.ok) return setMessage(`Ошибка сохранения настройки рекламы: ${await safeErr(r)}`, false);

  const j = await r.json();
  $("clientBlockAds").checked = Boolean(j.blockAds);
  setMessage(`Блокировка рекламы: ${j.blockAds ? "включена" : "выключена"}`);
};

$("deleteClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  if (!confirm("Удалить клиента? Это действие необратимо.")) return;

  const r = await api(`/admin/clients/${id}`, { method: "DELETE" });
  if (!r.ok) return setMessage(`Ошибка удаления клиента: ${await safeErr(r)}`, false);

  $("vlessLinks").value = "";
  $("customJson").value = "";
  setClientXrayRulesToForm([]);
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

let externalSubsCache = [];

function renderExternalSubsList() {
  const container = $("externalSubsList");
  if (!externalSubsCache.length) {
    container.innerHTML = '<div class="muted">Подписки не добавлены</div>';
    return;
  }

  container.innerHTML = externalSubsCache
    .map(
      (sub) => `
      <div class="row" style="align-items: center; margin-top: 6px;">
        <span class="muted" style="flex: 1;">${escapeHtml(sub.url)}</span>
        <span class="muted">${sub.configs.length} конфигов</span>
        <button type="button" class="danger external-sub-delete" data-sub-id="${escapeHtml(
          sub.id
        )}">Удалить</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".external-sub-delete").forEach((btn) => {
    btn.onclick = async () => {
      const subId = btn.getAttribute("data-sub-id");
      const r = await api(`/admin/external-subs/${subId}`, { method: "DELETE" });
      if (!r.ok) return setMessage(`Ошибка удаления: ${await safeErr(r)}`, false);
      await loadExternalSubs();
      setMessage("Подписка удалена");
    };
  });
}

function renderExternalConfigsSelect() {
  const select = $("externalSubConfigs");
  select.innerHTML = "";

  for (const sub of externalSubsCache) {
    const group = document.createElement("optgroup");
    group.label = sub.url;
    for (const cfg of sub.configs) {
      const opt = document.createElement("option");
      opt.value = `${sub.id}:${cfg.index}`;
      opt.textContent = cfg.remarks;
      group.appendChild(opt);
    }
    select.appendChild(group);
  }
}

async function loadExternalSubs() {
  const r = await api("/admin/external-subs");
  if (!r.ok) return setMessage(`Ошибка загрузки подписок: ${await safeErr(r)}`, false);

  const j = await r.json();
  externalSubsCache = Array.isArray(j) ? j : [];
  renderExternalSubsList();
  renderExternalConfigsSelect();
}

async function loadClientExternalConfigs(id) {
  const container = $("clientExternalConfigs");
  const r = await api(`/admin/clients/${id}/external-configs`);
  if (!r.ok) {
    container.innerHTML = `<span class="err">Ошибка загрузки: ${escapeHtml(await safeErr(r))}</span>`;
    return;
  }

  const j = await r.json();
  const refs = Array.isArray(j.refs) ? j.refs : [];
  if (!refs.length) {
    container.innerHTML = "Пока не выбрано";
    return;
  }

  container.innerHTML = refs
    .map(
      (ref, idx) => `
      <div class="row" style="align-items: center; margin-top: 4px;">
        <span style="flex: 1;">${escapeHtml(ref.remarks)}</span>
        <span class="muted">${escapeHtml(ref.url)}</span>
        <button type="button" class="danger client-ext-cfg-delete" data-idx="${idx}">Удалить</button>
      </div>
    `
    )
    .join("");

  container.querySelectorAll(".client-ext-cfg-delete").forEach((btn) => {
    btn.onclick = async () => {
      const idx = Number(btn.getAttribute("data-idx"));
      const refsAfter = refs.filter((_, i) => i !== idx);
      const save = await api(`/admin/clients/${id}/external-configs`, {
        method: "POST",
        body: JSON.stringify({ refs: refsAfter })
      });
      if (!save.ok) return setMessage(`Ошибка удаления: ${await safeErr(save)}`, false);
      await loadClientExternalConfigs(id);
      setMessage("Конфиг удалён у клиента");
    };
  });
}

$("addExternalSub").onclick = async () => {
  const url = $("externalSubUrl").value.trim();
  if (!url) return setMessage("Введите URL подписки", false);

  const r = await api("/admin/external-subs", {
    method: "POST",
    body: JSON.stringify({ url })
  });
  if (!r.ok) return setMessage(`Ошибка добавления: ${await safeErr(r)}`, false);

  $("externalSubUrl").value = "";
  await loadExternalSubs();
  setMessage("Подписка добавлена и спарсена");
};

$("parseAllExternalSubs").onclick = async () => {
  const r = await api("/admin/external-subs/parse-all", { method: "POST" });
  if (!r.ok) return setMessage(`Ошибка парсинга: ${await safeErr(r)}`, false);

  const j = await r.json();
  const okCount = j.results.filter((x) => x.ok).length;
  await loadExternalSubs();
  setMessage(`Спарсено подписок: ${okCount} из ${j.results.length}`);
};

$("addExternalConfigsToClient").onclick = async () => {
  const id = clientSelect.value;
  if (!id) return setMessage("Выберите клиента", false);

  const select = $("externalSubConfigs");
  const selected = Array.from(select.selectedOptions).map((o) => {
    const [subId, index] = o.value.split(":");
    return { subId, index: Number(index) };
  });
  if (!selected.length) return setMessage("Выберите конфиги из списка", false);

  const rc = await api(`/admin/clients/${id}/external-configs`);
  if (!rc.ok) return setMessage(`Ошибка загрузки клиента: ${await safeErr(rc)}`, false);
  const current = await rc.json();
  const currentRefs = Array.isArray(current.refs)
    ? current.refs.map((r) => ({ subId: r.subId, index: r.index }))
    : [];

  const merged = [...currentRefs];
  for (const ref of selected) {
    const exists = merged.some((r) => r.subId === ref.subId && r.index === ref.index);
    if (!exists) merged.push(ref);
  }

  const r = await api(`/admin/clients/${id}/external-configs`, {
    method: "POST",
    body: JSON.stringify({ refs: merged })
  });
  if (!r.ok) return setMessage(`Ошибка добавления: ${await safeErr(r)}`, false);

  await loadClientExternalConfigs(id);
  setMessage(`Добавлено конфигов клиенту: ${selected.length}`);
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
Promise.all([loadClients(), loadAdminBroadcastSettings(), loadExternalSubs()]).catch((e) => {
  setMessage(`Ошибка инициализации: ${e.message}`, false);
});