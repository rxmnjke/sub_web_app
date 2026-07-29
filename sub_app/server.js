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
const SUB_FETCH_TIMEOUT_MS = Number(process.env.SUB_FETCH_TIMEOUT_MS || 8000);
const SUB_CACHE_TTL_MS = Number(process.env.SUB_CACHE_TTL_MS || 120000); // 120 sec

// in-memory cache: key=url, value={ expiresAt:number, text:string }
const subCache = new Map();

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

function decodeTag(hashPart = "") {
  try {
    return decodeURIComponent(hashPart);
  } catch {
    return hashPart;
  }
}

function parseVlessLink(link, index = 0) {
  if (!link.startsWith("vless://")) throw new Error("Not a vless link");

  const u = new URL(link);
  const id = u.username;
  const address = u.hostname;
  const port = Number(u.port || 443);
  const q = u.searchParams;

  const type = q.get("type") || "tcp";
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

  const tagRaw = u.hash ? u.hash.slice(1) : "";
  const tag = decodeTag(tagRaw) || `node-${index + 1}`;

  const outbound = {
    tag,
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
      ...(sni ? { serverName: sni } : {}),
      ...(fp ? { fingerprint: fp } : {}),
      ...(pbk ? { publicKey: pbk } : {}),
      ...(sid ? { shortId: sid } : {}),
      ...(spx ? { spiderX: spx } : {})
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

  return outbound;
}

function buildSubscriptionFromLinks(links = [], opts = {}) {
  const outbounds = [];
  for (let i = 0; i < links.length; i++) {
    const link = String(links[i] || "").trim();
    if (!link) continue;
    try {
      outbounds.push(parseVlessLink(link, i));
    } catch {
      // skip invalid link
    }
  }

  outbounds.push({ tag: "direct", protocol: "freedom" });
  outbounds.push({ tag: "block", protocol: "blackhole" });

  const selectors = outbounds
    .map((o) => o.tag)
    .filter((t) => !["direct", "block"].includes(t));

  const useBalancer = selectors.length > 1;
  const hasProxy = selectors.length > 0;

  const routingRules = [
    {
      type: "field",
      domain: ["geosite:category-gov-ru", "geosite:ru"],
      outboundTag: "direct"
    },
    {
      type: "field",
      ip: ["geoip:ru", "geoip:private"],
      outboundTag: "direct"
    }
  ];

  if (hasProxy) {
    if (useBalancer) {
      routingRules.push({
        type: "field",
        network: "tcp,udp",
        balancerTag: "proxy-balance"
      });
    } else {
      routingRules.push({
        type: "field",
        network: "tcp,udp",
        outboundTag: selectors[0]
      });
    }
  } else {
    routingRules.push({
      type: "field",
      network: "tcp,udp",
      outboundTag: "direct"
    });
  }

  return {
    log: { loglevel: "warning" },
    inbounds: [
      {
        tag: "socks-in",
        listen: "127.0.0.1",
        port: 10808,
        protocol: "socks",
        settings: { udp: true }
      }
    ],
    outbounds,
    routing: {
      domainStrategy: "AsIs",
      rules: routingRules,
      ...(useBalancer
        ? {
            balancers: [
              {
                tag: "proxy-balance",
                selector: selectors,
                strategy: { type: "leastPing" }
              }
            ]
          }
        : {})
    },
    ...(opts.remark ? { remarks: opts.remark } : {})
  };
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

async function collectLinksFromSubs(urls = []) {
  const uniqueUrls = [...new Set(urls.map((u) => String(u).trim()).filter(Boolean))];
  if (uniqueUrls.length === 0) return { links: [], stats: [] };

  const settled = await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      const txt = await fetchTextWithCache(url);
      const links = extractVlessLinks(txt);
      return { url, linksCount: links.length, links };
    })
  );

  const all = [];
  const stats = [];
  for (const r of settled) {
    if (r.status === "fulfilled") {
      all.push(...r.value.links);
      stats.push({ url: r.value.url, ok: true, linksCount: r.value.linksCount });
    } else {
      stats.push({ url: "unknown", ok: false, error: String(r.reason?.message || r.reason || "fetch failed") });
    }
  }

  return { links: [...new Set(all)], stats };
}

// Health
app.get("/health", (req, res) => res.json({ ok: true }));

// Admin API (auth should be done in nginx via Basic Auth)
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
    sourceSubs: [],
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
  const { urls = [], replace = true } = req.body || {};
  if (!Array.isArray(urls)) return res.status(400).json({ error: "urls must be array" });

  const clean = urls.map((x) => String(x).trim()).filter(Boolean);
  for (const u of clean) {
    try {
      const p = new URL(u);
      if (!["http:", "https:"].includes(p.protocol)) throw new Error("bad protocol");
    } catch {
      return res.status(400).json({ error: `Invalid URL: ${u}` });
    }
  }

  const db = readDb();
  const client = db.clients.find((c) => c.id === req.params.id);
  if (!client) return res.status(404).json({ error: "Client not found" });

  client.sourceSubs = replace ? clean : [...(client.sourceSubs || []), ...clean];
  client.sourceSubs = [...new Set(client.sourceSubs)];
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
  const merged = [...new Set([...manual, ...fetched.links])];

  res.json({
    ok: true,
    manualLinks: manual.length,
    fetchedLinks: fetched.links.length,
    totalMerged: merged.length,
    fetchStats: fetched.stats
  });
});

// Public subscription endpoint
app.get("/sub/:token", async (req, res) => {
  const db = readDb();
  const client = db.clients.find((c) => c.token === req.params.token);
  if (!client) return res.status(404).json({ error: "Subscription not found" });

  if (client.customJson) {
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.send(JSON.stringify(client.customJson, null, 2));
  }

  const manual = client.links || [];
  const fetched = await collectLinksFromSubs(client.sourceSubs || []);
  const merged = [...new Set([...manual, ...fetched.links])];

  const result = buildSubscriptionFromLinks(merged, { remark: client.name });
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.send(JSON.stringify(result, null, 2));
});

app.listen(PORT, () => {
  console.log(`Server started on :${PORT}`);
});
