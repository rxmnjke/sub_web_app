import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

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
