import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { buildSubscriptionFromCountryGroups, normalizeGeoFilesSettings } from "../server.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, "..", "data", "clients.json");

let server;
let baseUrl;

async function makeRequest(url, init = {}) {
  const res = await fetch(`${baseUrl}${url}`, {
    headers: { "Content-Type": "application/json" },
    ...init
  });

  const text = await res.text();
  const json = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  return { res, json };
}

test.before(async () => {
  fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true });
  fs.writeFileSync(
    DATA_FILE,
    JSON.stringify({ clients: [], settings: { subscriptionInfo: { announce: "", supportUrl: "" } } }, null, 2)
  );

  const mod = await import("../server.js");
  const { app } = mod;
  assert.ok(app, "Server app should be exported for tests");

  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  baseUrl = `http://127.0.0.1:${port}`;
});

test.after(async () => {
  if (server) await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  if (fs.existsSync(DATA_FILE)) {
    fs.writeFileSync(
      DATA_FILE,
      JSON.stringify({ clients: [], settings: { subscriptionInfo: { announce: "", supportUrl: "" } } }, null, 2)
    );
  }
});

test("creation rejects duplicate names", async () => {
  const first = await makeRequest("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name: "Alice" })
  });
  assert.equal(first.res.status, 200, `first create failed: ${JSON.stringify(first.json)}`);

  const second = await makeRequest("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name: "alice" })
  });
  assert.equal(second.res.status, 409, `duplicate name should be rejected: ${JSON.stringify(second.json)}`);
  assert.match(String(second.json?.error || ""), /имя|name|уже/i);
});

test("rename rejects duplicate names and accepts unique rename", async () => {
  const created = await makeRequest("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name: "Bob" })
  });
  const id = created.json.id;

  const badRename = await makeRequest(`/admin/clients/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name: "Alice" })
  });
  assert.equal(badRename.res.status, 409, `duplicate rename should be rejected: ${JSON.stringify(badRename.json)}`);

  const goodRename = await makeRequest(`/admin/clients/${id}/rename`, {
    method: "POST",
    body: JSON.stringify({ name: "Charlie" })
  });
  assert.equal(goodRename.res.status, 200, `rename should succeed: ${JSON.stringify(goodRename.json)}`);
  assert.equal(goodRename.json.name, "Charlie");
});

test("subscription returns available source configs when another source times out", async () => {
  const upstream = http.createServer((req, res) => {
    if (req.url === "/working") {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("vless://4ec4d10d-f31a-41e5-bb9f-1a32f9f1e0f1@example.com:443?type=tcp&security=none");
      return;
    }

    res.writeHead(200, { "Content-Type": "text/plain" });
  });
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const { port } = upstream.address();
  const client = await makeRequest("/admin/clients", {
    method: "POST",
    body: JSON.stringify({ name: "Partial source response" })
  });
  assert.equal(client.res.status, 200);

  const sourceSubs = await makeRequest(`/admin/clients/${client.json.id}/source-subs`, {
    method: "POST",
    body: JSON.stringify({
      items: [
        { url: `http://127.0.0.1:${port}/working`, country: "germany" },
        { url: `http://127.0.0.1:${port}/unresponsive`, country: "denmark" }
      ],
      replace: true
    })
  });
  assert.equal(sourceSubs.res.status, 200);

  const startedAt = Date.now();
  try {
    const subscription = await makeRequest(`/sub/${client.json.token}`);
    const elapsedMs = Date.now() - startedAt;

    assert.equal(subscription.res.status, 200);
    assert.ok(elapsedMs < 7000, `subscription waited ${elapsedMs}ms for an unresponsive source`);
    assert.ok(Array.isArray(subscription.json));
    assert.equal(subscription.json.length, 1, "the failed source must not produce a config");
    assert.equal(subscription.json[0].remarks, "🇩🇪 Германия");
  } finally {
    upstream.closeAllConnections();
    await new Promise((resolve) => upstream.close(resolve));
  }
});

test("client with ad blocking adds geosite rule into generated config", () => {
  const grouped = new Map([["germany", ["vless://4ec4d10d-f31a-41e5-bb9f-1a32f9f1e0f1@example.com:443?type=tcp&security=none"]]]);

  const cfg = buildSubscriptionFromCountryGroups(grouped, [], {
    client: { blockAds: true }
  });

  assert.ok(Array.isArray(cfg.routing?.rules), "routing.rules should exist");
  assert.ok(
    cfg.routing.rules.some((rule) => rule.type === "field" && rule.outboundTag === "block" && Array.isArray(rule.domain) && rule.domain.includes("geosite:category-ads-all")),
    "geosite ads rule must be injected when ad blocking is enabled"
  );
});

test("local geo files are preferred over remote URLs", () => {
  const geoDir = path.join(__dirname, "..", "data", "geo");
  fs.mkdirSync(geoDir, { recursive: true });
  fs.writeFileSync(path.join(geoDir, "geoip.dat"), "geoip-local");
  fs.writeFileSync(path.join(geoDir, "geosite.dat"), "geosite-local");

  const settings = normalizeGeoFilesSettings();

  assert.match(settings.geoipUrl, /^file:\/\//, "existing geoip file should resolve to local file URL");
  assert.match(settings.geositeUrl, /^file:\/\//, "existing geosite file should resolve to local file URL");
});
