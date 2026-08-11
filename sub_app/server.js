import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use("/admin-ui", express.static(path.join(__dirname, "public")));

const PORT = process.env.PORT || 8080;
const DATA_FILE = path.join(__dirname, "data", "clients.json");
const JSON_TEMPLATE_FILE = path.join(__dirname, "json_template.json");
const SUB_FETCH_TIMEOUT_MS = Number(process.env.SUB_FETCH_TIMEOUT_MS || 8000);
const SUB_CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS || 120000); // 120 sec
const SUB_UPDATE_INTERVAL_HOURS = Number(process.env.SUB_UPDATE_INTERVAL_HOURS || 2);
const HWID_ENFORCE = String(process.env.HWID_ENFORCE || "true").toLowerCase() === "true";
const HWID_MAX_DEVICES = Number(process.env.HWID_MAX_DEVICES || 2);
const HWID_HEADER_NAME = String(process.env.HWID_HEADER_NAME || "x-hwid").toLowerCase();
const BROWSER_HWID_COOKIE = "sub_device_id";

// in-memory cache: key=url, value={ expiresAt:number, text:string }
const subCache = new Map();

// helper
const COUNTRY_LABELS = {
  germany: "🇩🇪 Германия (youtube без рекламы)",
  germany2: "🇩🇪 Германия 2",
  denmark: "🇩🇰 Дания",
  denmark2: "🇩🇰 Дания 2",
  netherlands: "🇳🇱 Нидерланды"
};

function normalizeSourceSubs(items = []) {
  const out = [];
  for (const it of items) {
    const url = String(it?.url || "").trim();
    const country = String(it?.country || "").trim().toLowerCase();
    if (!url) continue;
    if (!["germany", "germany2", "denmark", "denmark2", "netherlands"].includes(country)) continue;
    try {
      const p = new URL(url);
      if (!["http:", "https:"].includes(p.protocol)) continue;
      out.push({ url, country });
    } catch {
      // skip invalid
    }
  }

  // dedup by url+country
  const seen = new Set();
  return out.filter((x) => {
    const k = `${x.country}|${x.url}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function ensureDataFile() {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(DATA_FILE, JSON.stringify({ clients: [] }, null, 2));
  }
}
ensureDataFile();

function readDb() {
  return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
}
function writeDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}
function randToken() {
  return crypto.randomBytes(24).toString("hex");
}
function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
function loadJsonTemplate() {
  const raw = fs.readFileSync(JSON_TEMPLATE_FILE, "utf-8");
  return JSON.parse(raw);
}

function parseVlessLink(link, index = 0) {
  if (!link.startsWith("vless://")) throw new Error("Not a vless link");

  const u = new URL(link);
  const id = u.username;
  const address = u.hostname;
  const port = Number(u.port || 443);
  const q = u.searchParams;

  const type = (q.get("type") || "tcp").toLowerCase();
  const security = q.get("security") || "none";
  const flow = q.get("flow") || undefined;
  const sni = q.get("sni") || q.get("serverName") || undefined;
  const fp = q.get("fp") || undefined;
  const pbk = q.get("pbk") || undefined;
  const sid = q.get("sid") || undefined;
  const spx = q.get("spx") || undefined;
  const alpn = q.get("alpn") || undefined;

  const wsPath = q.get("path") || "/";
  const wsHost = q.get("host") || undefined;
  const serviceName = q.get("serviceName") || undefined;

  const outbound = {
    tag: `vless-${type}`,
    protocol: "vless",
    settings: {
      vnext: [
        {
          address,
          port,
          users: [
            {
              id,
              encryption: "none",
              ...(flow ? { flow } : {})
            }
          ]
        }
      ]
    },
    streamSettings: {
      network: type,
      security
    }
  };

  if (security === "tls") {
    outbound.streamSettings.tlsSettings = {
      ...(sni ? { serverName: sni } : {}),
      ...(alpn ? { alpn: alpn.split(",").map((s) => s.trim()).filter(Boolean) } : {}),
      ...(fp ? { fingerprint: fp } : {})
    };
  }

  if (security === "reality") {
    outbound.streamSettings.realitySettings = {
      show: false,
      ...(pbk ? { publicKey: pbk } : {}),
      ...(sid ? { shortId: sid } : {}),
      ...(spx ? { spiderX: spx } : {}),
      ...(sni ? { serverName: sni } : {}),
      ...(fp ? { fingerprint: fp } : {})
    };
  }

  if (type === "ws") {
    outbound.streamSettings.wsSettings = {
      path: wsPath,
      headers: {
        ...(wsHost ? { Host: wsHost } : {})
      }
    };
  }

  if (type === "grpc") {
    outbound.streamSettings.grpcSettings = {
      ...(serviceName ? { serviceName } : {})
    };
  }

  if (type === "xhttp") {
    outbound.streamSettings.xhttpSettings = {
      path: wsPath || "/",
      mode: "auto",
      xPaddingBytes: "100-1000",
      scMaxEachPostBytes: 1000000
    };
  }

  return outbound;
}

function tryBase64Decode(s) {
  try {
    const cleaned = String(s || "").replace(/\s+/g, "");
    const pad = "=".repeat((4 - (cleaned.length % 4)) % 4);
    return Buffer.from(cleaned + pad, "base64").toString("utf8");
  } catch {
    return String(s || "");
  }
}

function extractVlessLinks(raw) {
  const text = raw.includes("vless://") ? raw : tryBase64Decode(raw);
  return text
    .split(/\r?\n/)
    .map((x) => x.trim())
    .filter((x) => x.startsWith("vless://"));
}

function parseCookies(req) {
  const raw = String(req.headers.cookie || "");
  const out = {};

  for (const part of raw.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    const value = trimmed.slice(eqIndex + 1).trim();
    if (!key) continue;

    out[key] = decodeURIComponent(value);
  }

  return out;
}

function isBrowserNavigationRequest(req) {
  const accept = String(req.get("accept") || "").toLowerCase();
  const secFetchDest = String(req.get("sec-fetch-dest") || "").toLowerCase();
  const secFetchMode = String(req.get("sec-fetch-mode") || "").toLowerCase();

  return accept.includes("text/html") || secFetchDest === "document" || secFetchMode === "navigate";
}

function setBrowserHwidCookie(req, res, hwid) {
  const forwardedProto = String(req.get("x-forwarded-proto") || "").toLowerCase();
  const isSecure = req.secure || forwardedProto === "https";
  const parts = [
    `${BROWSER_HWID_COOKIE}=${encodeURIComponent(hwid)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=31536000"
  ];

  if (isSecure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

function getRequestHwid(req, res) {
  const fromHeader = String(req.get(HWID_HEADER_NAME) || "").trim();
  const fromQueryHwid = String(req.query?.hwid || "").trim();
  const fromQueryDeviceId = String(req.query?.device_id || "").trim();
  const fromCookie = String(parseCookies(req)[BROWSER_HWID_COOKIE] || "").trim();

  if (fromHeader || fromQueryHwid || fromQueryDeviceId || fromCookie) {
    return fromHeader || fromQueryHwid || fromQueryDeviceId || fromCookie;
  }

  if (!isBrowserNavigationRequest(req)) return "";

  const generated = `browser-${crypto.randomUUID()}`;
  setBrowserHwidCookie(req, res, generated);
  return generated;
}

function ensureClientDevices(client) {
  if (!Array.isArray(client.devices)) client.devices = [];
  return client.devices;
}

async function fetchTextWithCache(url, timeoutMs = SUB_FETCH_TIMEOUT_MS) {
  const now = Date.now();
  const hit = subCache.get(url);
  if (hit && hit.expiresAt > now) return hit.text;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const text = await r.text();
    subCache.set(url, { text, expiresAt: now + SUB_CACHE_TTL_MS });
    return text;
  } finally {
    clearTimeout(timer);
  }
}

async function collectLinksFromSubs(items = []) {
  const normalized = normalizeSourceSubs(items);

  const tasks = normalized.map(async (it) => {
    try {
      const txt = await fetchTextWithCache(it.url);
      const links = extractVlessLinks(txt);
      return { ok: true, url: it.url, country: it.country, links };
    } catch (e) {
      return {
        ok: false,
        url: it.url,
        country: it.country,
        error: String(e?.message || e || "fetch failed")
      };
    }
  });

  const settled = await Promise.all(tasks);
  const grouped = new Map(); // country -> links[]
  const stats = [];

  for (const r of settled) {
    if (!r.ok) {
      stats.push(r);
      continue;
    }
    if (!grouped.has(r.country)) grouped.set(r.country, []);
    grouped.get(r.country).push(...r.links);
    stats.push({ url: r.url, country: r.country, ok: true, linksCount: r.links.length });
  }

  for (const [country, arr] of grouped.entries()) {
    grouped.set(country, [...new Set(arr)]);
  }

  return { grouped, stats };
}

function buildSubscriptionFromCountryGroups(grouped, manualLinks = [], opts = {}) {
  const template = deepClone(loadJsonTemplate());

  const parsed = [];
  const tagCount = new Map();

  const pushParsed = (link) => {
    try {
      const ob = parseVlessLink(link);

      // unique tag if duplicates by transport
      const n = (tagCount.get(ob.tag) || 0) + 1;
      tagCount.set(ob.tag, n);
      if (n > 1) ob.tag = `${ob.tag}-${n}`;

      parsed.push(ob);
    } catch {
      // skip bad link
    }
  };

  for (const links of grouped.values()) {
    for (const link of links) pushParsed(link);
  }

  for (const link of manualLinks) pushParsed(link);

  const staticOutbounds = Array.isArray(template.outbounds)
    ? template.outbounds.filter((o) => !String(o?.tag || "").startsWith("vless-"))
    : [];

  template.outbounds = [...parsed, ...staticOutbounds];

  const vlessTags = parsed.map((o) => o.tag);

  if (!template.burstObservatory) template.burstObservatory = {};
  template.burstObservatory.subjectSelector = [...vlessTags];

  if (!template.routing) template.routing = {};
  if (!Array.isArray(template.routing.balancers)) template.routing.balancers = [];

  const bPrimary = template.routing.balancers.find((b) => b.tag === "primary");
  const bTier1 = template.routing.balancers.find((b) => b.tag === "tier1");
  const bTier2 = template.routing.balancers.find((b) => b.tag === "tier2");

  if (bPrimary) bPrimary.selector = [...vlessTags];

  const grpcTags = vlessTags.filter((t) => t.startsWith("vless-grpc"));
  const xhttpTags = vlessTags.filter((t) => t.startsWith("vless-xhttp"));

  if (bTier1) bTier1.selector = grpcTags.length ? grpcTags : (vlessTags[0] ? [vlessTags[0]] : []);
  if (bTier2) {
    bTier2.selector = xhttpTags.length
      ? xhttpTags
      : (vlessTags[1] ? [vlessTags[1]] : (bTier1?.selector || []));
  }

  if (opts.remark) {
    template.remarks = opts.remark;
  }

  return template;
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Admin API
app.post("/admin/clients", (req, res) => {
  const { name } = req.body || {};
  if (!name) return res.status(400).json({ error: "name is required" });

  const db = readDb();
  const id = crypto.randomUUID();
  const token = randToken();

  const client = {
    id,
    name,
    token,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    links: [],
    sourceSubs: [], // [{ url, country }]
    devices: [], // [{ hwid, firstSeenAt, lastSeenAt }]
    customJson: null
  };

  db.clients.push(client);
  writeDb(db);
  res.json(client);
});

app.get("/admin/clients", (req, res) => {
  const db = readDb();
  res.json(db.clients);
});

app.get("/admin/clients/:id", (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });
  res.json(client);
});

app.delete("/admin/clients/:id", (req, res) => {
  const db = readDb();
  const idx = db.clients.findIndex((c) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Client not found" });

  const removed = db.clients[idx];
  db.clients.splice(idx, 1);
  writeDb(db);

  res.json({ ok: true, removed: { id: removed.id, name: removed.name } });
});

app.post("/admin/clients/:id/import", (req, res) => {
  const { links, replace = false } = req.body || {};
  if (!Array.isArray(links)) {
    return res.status(400).json({ error: "links must be array of vless URLs" });
  }

  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const clean = links.map((x) => String(x).trim()).filter(Boolean);
  for (const l of clean) {
    if (!l.startsWith("vless://")) {
      return res.status(400).json({ error: `Invalid link: ${l}` });
    }
  }

  client.links = replace ? clean : [...client.links, ...clean];
  client.links = [...new Set(client.links)];
  client.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json({ ok: true, totalLinks: client.links.length, mode: "links" });
});

app.post("/admin/clients/:id/source-subs", (req, res) => {
  const { items = [], replace = true } = req.body || {};
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: "items must be array of {url,country}" });
  }

  const normalized = normalizeSourceSubs(items);

  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const current = Array.isArray(client.sourceSubs) ? client.sourceSubs : [];
  client.sourceSubs = replace ? normalized : normalizeSourceSubs([...current, ...normalized]);
  client.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json({ ok: true, totalSourceSubs: client.sourceSubs.length });
});

app.post("/admin/clients/:id/custom-json", (req, res) => {
  const { json, replace = true } = req.body || {};
  if (!json) return res.status(400).json({ error: "json is required" });

  let parsed;
  try {
    parsed = typeof json === "string" ? JSON.parse(json) : json;
  } catch {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  client.customJson = parsed;
  if (replace) client.links = [];
  client.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json({ ok: true, mode: "customJson" });
});

app.delete("/admin/clients/:id/custom-json", (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  client.customJson = null;
  client.updatedAt = new Date().toISOString();

  writeDb(db);
  res.json({ ok: true, mode: "links" });
});

app.post("/admin/clients/:id/preview-merged-links", async (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const manual = client.links || [];
  const fetched = await collectLinksFromSubs(client.sourceSubs || []);

  let fetchedCount = 0;
  for (const arr of fetched.grouped.values()) fetchedCount += arr.length;

  res.json({
    ok: true,
    manualLinks: manual.length,
    fetchedLinks: fetchedCount,
    totalMergedApprox: manual.length + fetchedCount,
    fetchStats: fetched.stats
  });
});

app.delete("/admin/clients/:id/devices/:hwid", (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  const hwid = String(req.params.hwid || "").trim();
  if (!hwid) return res.status(400).json({ error: "HWID is required" });

  client.devices = Array.isArray(client.devices) ? client.devices : [];
  const before = client.devices.length;
  client.devices = client.devices.filter((d) => String(d.hwid) !== hwid);
  const removed = before - client.devices.length;

  client.updatedAt = new Date().toISOString();
  writeDb(db);

  return res.json({ ok: true, removed, devices: client.devices });
});

// Public subscription endpoint
app.get("/sub/:token", async (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: "Subscription not found" });

  res.setHeader("Profile-Update-Interval", String(SUB_UPDATE_INTERVAL_HOURS));

  const nowIso = new Date().toISOString();
  const hwid = getRequestHwid(req, res);

  if (hwid) {
    const devices = ensureClientDevices(client);
    const found = devices.find((d) => d.hwid === hwid);

    if (found) {
      found.lastSeenAt = nowIso;
    } else {
      if (HWID_ENFORCE && devices.length >= HWID_MAX_DEVICES) {
        const limitMessage = "Превышен лимит устройств";
        const blockedConfig = {
          remarks: limitMessage
        };
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        return res.status(200).send(JSON.stringify(blockedConfig, null, 2));
      }
      devices.push({ hwid, firstSeenAt: nowIso, lastSeenAt: nowIso });
    }

    client.updatedAt = nowIso;
    writeDb(db);
  }

  if (client.customJson) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(JSON.stringify(client.customJson, null, 2));
  }

  const fetched = await collectLinksFromSubs(client.sourceSubs || []);

  const resultList = [];
  for (const [country, links] of fetched.grouped.entries()) {
    const oneCountryGrouped = new Map([[country, links]]);
    const cfg = buildSubscriptionFromCountryGroups(oneCountryGrouped, [], {
      remark: COUNTRY_LABELS[country] || country
    });
    resultList.push(cfg);
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(resultList, null, 2));
});

app.listen(PORT, () => {
  console.log(`Server started on :${PORT}`);
});
