import http from "node:http";
import WebSocket from "ws";
import express, { type Request, type Response } from "express";
import { createServer } from "../src/index.js";

interface BackendRequest {
  path: string;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

(async () => {
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, name: string): void {
    if (condition) {
      console.log(`  ✓ ${name}`);
      passed++;
    } else {
      console.error(`  ✗ ${name}`);
      failed++;
    }
  }

  // Mock backend
  const backendApp = express();
  backendApp.use(express.raw({ type: "*/*" }));

  let backendStatus = 200;
  let backendResponseBody = "";
  let onNextRequest: ((req: BackendRequest) => void) | null = null;

  backendApp.use((req: Request, res: Response) => {
    const entry: BackendRequest = {
      path: req.path,
      headers: req.headers,
      body: Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? ""),
    };
    onNextRequest?.(entry);
    onNextRequest = null;
    if (backendStatus >= 500) {
      res.status(backendStatus).send("error");
      return;
    }
    res.status(200).send(backendResponseBody);
  });

  const backendServer = http.createServer(backendApp);
  await new Promise<void>((resolve) => backendServer.listen(0, "127.0.0.1", resolve));
  const backendPort = (backendServer.address() as { port: number }).port;

  function expectBackend(timeout = 3000): Promise<BackendRequest> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("backend request timeout")), timeout);
      onNextRequest = (req) => { clearTimeout(timer); resolve(req); };
    });
  }

  // Gateway
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;
  process.env.BACKEND_API_KEY = "testkey";
  delete process.env.PORT;

  const { server, close } = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayPort = (server.address() as { port: number }).port;
  const wsBase = `ws://127.0.0.1:${gatewayPort}`;
  const httpBase = `http://127.0.0.1:${gatewayPort}`;

  function waitForOpen(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
      if (ws.readyState === WebSocket.OPEN) return resolve();
      ws.once("open", resolve);
      ws.once("error", reject);
    });
  }

  function waitForMessage(ws: WebSocket, timeout = 3000): Promise<string> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS message timeout")), timeout);
      ws.once("message", (data) => { clearTimeout(timer); resolve(data.toString()); });
    });
  }

  function waitForClose(ws: WebSocket, timeout = 3000): Promise<number> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS close timeout")), timeout);
      ws.once("close", (code) => { clearTimeout(timer); resolve(code); });
    });
  }

  function closeWs(ws: WebSocket): Promise<void> {
    return new Promise((resolve) => {
      if (ws.readyState === WebSocket.CLOSED) return resolve();
      ws.once("close", () => resolve());
      ws.close();
    });
  }

  try {
    // Test 1: JSON message → Content-Type application/json + correct path + x-client-id
    console.log("\nTest 1: JSON message forwarding");
    {
      backendStatus = 200; backendResponseBody = "";
      const ws = new WebSocket(`${wsBase}/ws/ping`);
      await waitForOpen(ws);
      const backendPromise = expectBackend();
      ws.send(JSON.stringify({ hello: "world" }));
      const req = await backendPromise;
      assert(req.path === "/ping", "1a: forwarded to /ping");
      assert(req.headers["content-type"] === "application/json", "1b: Content-Type application/json");
      assert(typeof req.headers["x-client-id"] === "string", "1c: x-client-id header present");
      await closeWs(ws);
    }

    // Test 2: Plain text → Content-Type text/plain
    console.log("\nTest 2: Plain text message forwarding");
    {
      backendStatus = 200; backendResponseBody = "";
      const ws = new WebSocket(`${wsBase}/ws/chat`);
      await waitForOpen(ws);
      const backendPromise = expectBackend();
      ws.send("hello world");
      const req = await backendPromise;
      assert(req.path === "/chat", "2a: forwarded to /chat");
      assert((req.headers["content-type"] as string)?.startsWith("text/plain"), "2b: Content-Type text/plain");
      await closeWs(ws);
    }

    // Test 3: Backend response body → forwarded to WS client
    console.log("\nTest 3: Backend response forwarded to client");
    {
      backendStatus = 200; backendResponseBody = "pong";
      const ws = new WebSocket(`${wsBase}/ws/ping`);
      await waitForOpen(ws);
      const msgPromise = waitForMessage(ws);
      ws.send("ping");
      const msg = await msgPromise;
      assert(msg === "pong", "3: backend response forwarded to client");
      backendResponseBody = "";
      await closeWs(ws);
    }

    // Test 4: Empty backend response → no WS message sent
    console.log("\nTest 4: Empty backend response → no message to client");
    {
      backendStatus = 200; backendResponseBody = "";
      const ws = new WebSocket(`${wsBase}/ws/ping`);
      await waitForOpen(ws);
      const received: string[] = [];
      ws.on("message", (d) => received.push(d.toString()));
      const backendPromise = expectBackend();
      ws.send("ping");
      await backendPromise;
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      assert(received.length === 0, "4: no WS message for empty backend response");
      await closeWs(ws);
    }

    // Test 5: 5xx → WS closed with code 1011
    console.log("\nTest 5: 5xx backend closes WS with 1011");
    {
      backendStatus = 500;
      const ws = new WebSocket(`${wsBase}/ws/ping`);
      await waitForOpen(ws);
      const closePromise = waitForClose(ws);
      const backendPromise = expectBackend();
      ws.send("trigger");
      await backendPromise;
      const code = await closePromise;
      assert(code === 1011, "5: WS closed with code 1011 on 5xx");
      backendStatus = 200;
    }

    // Test 6: POST /message without x-api-key → 401
    console.log("\nTest 6: Auth - POST /message without API key");
    {
      const res = await fetch(`${httpBase}/message`, {
        method: "POST",
        headers: { "x-client-id": "someId" },
        body: "hello",
      });
      assert(res.status === 401, "6: POST /message without x-api-key → 401");
    }

    // Test 7: POST /message with unknown client → 404
    console.log("\nTest 7: POST /message unknown client");
    {
      const res = await fetch(`${httpBase}/message`, {
        method: "POST",
        headers: {
          "x-api-key": "testkey",
          "x-client-id": "00000000-0000-0000-0000-000000000000",
        },
        body: "hello",
      });
      assert(res.status === 404, "7: POST /message with unknown client → 404");
    }

    // Test 8: WS upgrade without x-api-key → still connects (auth exempt)
    console.log("\nTest 8: Auth - WS upgrade exempt");
    {
      const ws = new WebSocket(`${wsBase}/ws/test`);
      let opened = false;
      try {
        await waitForOpen(ws);
        opened = true;
      } catch {
        opened = false;
      }
      assert(opened, "8: WS upgrade without x-api-key succeeds");
      await closeWs(ws);
    }

  } catch (err) {
    console.error("Unexpected error:", err);
    failed++;
  } finally {
    await close();
    backendServer.close();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
})();
