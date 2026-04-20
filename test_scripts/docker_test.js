/**
 * docker_test.js — Full integration test against a running gateway instance.
 *
 * What it does:
 *   - Starts a local HTTP backend (the gateway forwards WS messages to this)
 *   - Starts a local WSS (the backend asks the gateway to connect to this)
 *   - Exercises the complete round-trip: inbound WS, outbound WS, message push, auth, cleanup
 *
 * Start the gateway before running this:
 *   docker run --rm -p 6473:6473 \
 *     -e BACKEND_URL=http://host.docker.internal:3000 \
 *     -e BACKEND_API_KEY=test-api-key \
 *     ws-to-http-gateway
 *
 * Then run: node docker_test.js
 *
 * Env overrides:
 *   GATEWAY_URL     (default: http://localhost:6473)
 *   API_KEY         (default: test-api-key)
 *   CALLBACK_HOST   host the gateway can reach back to (default: host.docker.internal)
 *   BACKEND_PORT    port this script listens on for BACKEND_URL (default: 3000)
 */

import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";

// ── Config ────────────────────────────────────────────────────────────────────

const GATEWAY_URL   = process.env.GATEWAY_URL   ?? "http://localhost:6473";
const GATEWAY_WS    = GATEWAY_URL.replace(/^http/, "ws");
const API_KEY       = process.env.API_KEY       ?? "test-api-key";
const CALLBACK_HOST = process.env.CALLBACK_HOST ?? "host.docker.internal";
const BACKEND_PORT  = parseInt(process.env.BACKEND_PORT ?? "3000", 10);

// ── Helpers ───────────────────────────────────────────────────────────────────

async function gw(path, opts = {}) {
  return fetch(`${GATEWAY_URL}${path}`, {
    ...opts,
    headers: { "x-api-key": API_KEY, ...opts.headers },
  });
}

function waitMs(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

let passed = 0, failed = 0;
function check(ok, label) {
  if (ok) { console.log(`  ✓ ${label}`); passed++; }
  else    { console.error(`  ✗ ${label}`); failed++; }
}

// ── Mock HTTP backend ─────────────────────────────────────────────────────────
// The gateway POSTs forwarded WS messages here.

const backendApp = express();
backendApp.use(express.raw({ type: "*/*" }));

const _bQueue   = [];
const _bWaiters = [];
let   _bRespond = (_req, res) => res.status(200).send("");

backendApp.use((req, res) => {
  const entry = {
    path:    req.path,
    headers: req.headers,
    body:    Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? ""),
  };
  const waiter = _bWaiters.shift();
  if (waiter) waiter(entry);
  else _bQueue.push(entry);
  _bRespond(req, res, entry);
});

const backendServer = http.createServer(backendApp);
await new Promise((resolve) => backendServer.listen(BACKEND_PORT, "0.0.0.0", resolve));

function nextBackendReq(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (_bQueue.length) return resolve(_bQueue.shift());
    const t = setTimeout(() => reject(new Error("Backend request timeout")), timeout);
    _bWaiters.push((r) => { clearTimeout(t); resolve(r); });
  });
}

// ── Mock WebSocket server ─────────────────────────────────────────────────────
// The backend asks the gateway to connect outbound to this server.

const mockWss   = new WebSocketServer({ port: 0 });
await new Promise((resolve) => mockWss.once("listening", resolve));
const WSS_PORT  = mockWss.address().port;

let   wssConn   = null;
const _wssQueue   = [];
const _wssWaiters = [];

mockWss.on("connection", (ws) => {
  wssConn = ws;
  ws.on("message", (data) => {
    const msg = data.toString();
    const waiter = _wssWaiters.shift();
    if (waiter) waiter(msg);
    else _wssQueue.push(msg);
  });
});

function nextWssMsg(timeout = 5000) {
  return new Promise((resolve, reject) => {
    if (_wssQueue.length) return resolve(_wssQueue.shift());
    const t = setTimeout(() => reject(new Error("WSS message timeout")), timeout);
    _wssWaiters.push((m) => { clearTimeout(t); resolve(m); });
  });
}

// ─────────────────────────────────────────────────────────────────────────────

console.log(`\nGateway : ${GATEWAY_URL}`);
console.log(`Backend : 0.0.0.0:${BACKEND_PORT}  (gateway uses BACKEND_URL=http://${CALLBACK_HOST}:${BACKEND_PORT})`);
console.log(`WSS     : 0.0.0.0:${WSS_PORT}       (gateway will connect to ws://${CALLBACK_HOST}:${WSS_PORT})`);
console.log("─".repeat(62));

let inboundClientId  = null;
let outboundClientId = null;
const wsClient = new WebSocket(`${GATEWAY_WS}/ws/hello`);

try {

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 1 — Inbound WS: client connects to gateway, messages flow to backend
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n[Part 1] Inbound WebSocket — client → gateway → backend");

  await new Promise((resolve, reject) => {
    wsClient.once("open", resolve);
    wsClient.once("error", reject);
  });
  check(true, "WS client connected to /ws/hello");

  // 1a. Client sends JSON — gateway forwards to backend with correct headers
  _bRespond = (req, res, entry) => {
    inboundClientId = entry.headers["x-client-id"];
    res.status(200).json({ reply: "from backend" });
  };

  const replyPromise = new Promise((resolve) => wsClient.once("message", (d) => resolve(d.toString())));
  wsClient.send(JSON.stringify({ text: "hello gateway" }));

  const fwdReq = await nextBackendReq();
  check(fwdReq.path === "/hello",                               "1a: forwarded to POST /hello");
  check(fwdReq.headers["content-type"] === "application/json", "1b: Content-Type: application/json");
  check(typeof fwdReq.headers["x-client-id"] === "string",     "1c: x-client-id header present");
  check(JSON.parse(fwdReq.body)?.text === "hello gateway",      "1d: body forwarded intact");

  const reply = JSON.parse(await replyPromise);
  check(reply?.reply === "from backend", "1e: backend response forwarded to WS client");

  _bRespond = (_req, res) => res.status(200).send("");

  // 1b. Client sends plain text — gateway forwards with text/plain
  wsClient.send("just a string");
  const txtReq = await nextBackendReq();
  check(txtReq.headers["content-type"]?.startsWith("text/plain"), "1f: plain text → Content-Type: text/plain");

  // 1c. Backend pushes a message to the inbound client via POST /message
  const pushPromise = new Promise((resolve) => wsClient.once("message", (d) => resolve(d.toString())));
  const pushRes = await gw("/message", {
    method: "POST",
    headers: { "x-client-id": inboundClientId, "Content-Type": "text/plain" },
    body:    "push from backend",
  });
  check(pushRes.status === 200,             "1g: POST /message → 200");
  check(await pushPromise === "push from backend", "1h: client received pushed message");

  // 1d. Auth — request without API key → 401 (WS upgrades are exempt by design)
  const noAuthRes = await fetch(`${GATEWAY_URL}/message`, {
    method:  "POST",
    headers: { "x-client-id": inboundClientId },
    body:    "should fail",
  });
  check(noAuthRes.status === 401, "1i: no x-api-key → 401");

  // 1e. Close inbound client cleanly
  await new Promise((resolve) => { wsClient.once("close", resolve); wsClient.close(); });
  check(true, "1j: inbound WS client closed cleanly");

  // Confirm the registry was cleaned up
  await waitMs(50);
  const afterCloseRes = await gw("/message", {
    method:  "POST",
    headers: { "x-client-id": inboundClientId },
    body:    "ghost",
  });
  check(afterCloseRes.status === 404, "1k: POST /message after close → 404 (registry cleaned up)");

  // ═══════════════════════════════════════════════════════════════════════════
  // PART 2 — Outbound WS: backend asks gateway to connect to our WSS
  // ═══════════════════════════════════════════════════════════════════════════
  console.log("\n[Part 2] Outbound WebSocket — backend → POST /connection → gateway → WSS");

  // 2a. Backend calls POST /connection → gateway opens outbound WS to our WSS
  const wssConnPromise = new Promise((resolve) => mockWss.once("connection", resolve));
  const connRes = await gw("/connection", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ url: `ws://${CALLBACK_HOST}:${WSS_PORT}`, path: "/events" }),
  });
  check(connRes.status === 201, "2a: POST /connection → 201");
  const connBody = await connRes.json();
  outboundClientId = connBody.client_id;
  check(typeof outboundClientId === "string" && outboundClientId.length > 0, `2b: got client_id (${outboundClientId})`);

  await Promise.race([
    wssConnPromise,
    waitMs(5000).then(() => { throw new Error("WSS connection timeout"); }),
  ]);
  check(wssConn !== null, "2c: gateway connected to mock WSS");

  // 2b. WSS sends event → gateway forwards to backend
  wssConn.send(JSON.stringify({ event: "something happened" }));
  const evtReq = await nextBackendReq();
  check(evtReq.path === "/events",                              "2d: WSS message forwarded to POST /events");
  check(evtReq.headers["x-client-id"] === outboundClientId,    "2e: x-client-id matches outbound connection");
  check(evtReq.headers["content-type"] === "application/json", "2f: Content-Type: application/json");

  // 2c. Backend pushes to outbound WS via POST /message → WSS receives it
  const wssMsgPromise = nextWssMsg();
  const outPushRes = await gw("/message", {
    method:  "POST",
    headers: { "x-client-id": outboundClientId, "Content-Type": "text/plain" },
    body:    "hello ws server",
  });
  check(outPushRes.status === 200,            "2g: POST /message to outbound client → 200");
  check(await wssMsgPromise === "hello ws server", "2h: WSS received message from backend");

  // 2d. Backend closes outbound connection via DELETE /connection
  const wssClosePromise = new Promise((resolve) => wssConn.once("close", resolve));
  const delRes = await gw("/connection", {
    method:  "DELETE",
    headers: { "x-client-id": outboundClientId },
  });
  check(delRes.status === 200, "2i: DELETE /connection → 200");

  await Promise.race([
    wssClosePromise,
    waitMs(5000).then(() => { throw new Error("WSS close timeout"); }),
  ]);
  check(true, "2j: WSS saw connection close after DELETE");

  const ghostRes = await gw("/message", {
    method:  "POST",
    headers: { "x-client-id": outboundClientId },
    body:    "ghost",
  });
  check(ghostRes.status === 404, "2k: POST /message after DELETE → 404 (registry cleaned up)");

} catch (err) {
  console.error("\nUnexpected error:", err);
  failed++;
} finally {
  wsClient.readyState !== WebSocket.CLOSED && wsClient.close();
  backendServer.close();
  mockWss.close();
  console.log("\n" + "─".repeat(62));
  console.log(`Results: ${passed} passed, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}
