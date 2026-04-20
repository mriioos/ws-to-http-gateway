import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
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

  // Mock WS server (gateway will connect outbound to this)
  const mockWss = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  await new Promise<void>((resolve) => mockWss.once("listening", resolve));
  const wssPort = (mockWss.address() as { port: number }).port;

  let serverSideWs: WebSocket | null = null;
  const wssReceivedMessages: string[] = [];
  const wssMessageResolvers: Array<(msg: string) => void> = [];

  mockWss.on("connection", (ws) => {
    serverSideWs = ws;
    ws.on("message", (data) => {
      const msg = data.toString();
      const resolver = wssMessageResolvers.shift();
      if (resolver) resolver(msg);
      else wssReceivedMessages.push(msg);
    });
  });

  function nextWssMessage(timeout = 3000): Promise<string> {
    if (wssReceivedMessages.length > 0) return Promise.resolve(wssReceivedMessages.shift()!);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("WS message timeout")), timeout);
      wssMessageResolvers.push((msg) => { clearTimeout(timer); resolve(msg); });
    });
  }

  // Mock HTTP backend
  const backendApp = express();
  backendApp.use(express.raw({ type: "*/*" }));

  let onNextBackend: ((req: BackendRequest) => void) | null = null;

  backendApp.use((req: Request, res: Response) => {
    const entry: BackendRequest = {
      path: req.path,
      headers: req.headers,
      body: Buffer.isBuffer(req.body) ? req.body.toString("utf8") : String(req.body ?? ""),
    };
    onNextBackend?.(entry);
    onNextBackend = null;
    res.status(200).send("");
  });

  const backendServer = http.createServer(backendApp);
  await new Promise<void>((resolve) => backendServer.listen(0, "127.0.0.1", resolve));
  const backendPort = (backendServer.address() as { port: number }).port;

  function expectBackend(timeout = 3000): Promise<BackendRequest> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("backend request timeout")), timeout);
      onNextBackend = (req) => { clearTimeout(timer); resolve(req); };
    });
  }

  // Gateway
  process.env.BACKEND_URL = `http://127.0.0.1:${backendPort}`;
  delete process.env.BACKEND_API_KEY;
  delete process.env.PORT;

  const { server, close } = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const gatewayPort = (server.address() as { port: number }).port;
  const httpBase = `http://127.0.0.1:${gatewayPort}`;

  let savedClientId = "";

  try {
    // Test 1: POST /connection → 201 with client_id, outbound WS established
    console.log("\nTest 1: POST /connection creates outbound WS");
    {
      const wssConnPromise = new Promise<void>((resolve) => mockWss.once("connection", () => resolve()));
      const res = await fetch(`${httpBase}/connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `ws://127.0.0.1:${wssPort}`, path: "/messages" }),
      });
      assert(res.status === 201, "1a: POST /connection returns 201");
      const body = await res.json() as { client_id?: string };
      assert(typeof body.client_id === "string" && body.client_id.length > 0, "1b: response has client_id");
      savedClientId = body.client_id ?? "";
      await Promise.race([
        wssConnPromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WS conn timeout")), 2000)),
      ]);
      assert(serverSideWs !== null, "1c: mock WS server received connection");
    }

    // Test 4: WS server sends message → forwarded to backend
    console.log("\nTest 4: WS server message → backend forwarding");
    {
      const backendPromise = expectBackend();
      serverSideWs!.send(JSON.stringify({ test: "data" }));
      const req = await backendPromise;
      assert(req.path === "/messages", "4a: forwarded to /messages");
      assert(req.headers["x-client-id"] === savedClientId, "4b: x-client-id matches");
      assert(req.headers["content-type"] === "application/json", "4c: Content-Type application/json");
    }

    // Test 5: POST /message → WS server receives it
    console.log("\nTest 5: POST /message → WS server receives");
    {
      const wssPromise = nextWssMessage();
      const res = await fetch(`${httpBase}/message`, {
        method: "POST",
        headers: { "x-client-id": savedClientId, "Content-Type": "text/plain" },
        body: "hello from backend",
      });
      assert(res.status === 200, "5a: POST /message returns 200");
      const msg = await wssPromise;
      assert(msg === "hello from backend", "5b: WS server received the message");
    }

    // Test 6: DELETE /connection closes WS; subsequent POST /message → 404
    console.log("\nTest 6: DELETE /connection");
    {
      const wsClosePromise = new Promise<void>((resolve) => {
        serverSideWs!.once("close", () => resolve());
      });
      const res = await fetch(`${httpBase}/connection`, {
        method: "DELETE",
        headers: { "x-client-id": savedClientId },
      });
      assert(res.status === 200, "6a: DELETE /connection returns 200");
      await Promise.race([
        wsClosePromise,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("WS close timeout")), 2000)),
      ]);
      assert(true, "6b: WS server saw connection close");

      const res2 = await fetch(`${httpBase}/message`, {
        method: "POST",
        headers: { "x-client-id": savedClientId },
        body: "after close",
      });
      assert(res2.status === 404, "6c: POST /message after DELETE → 404");
    }

    // Test 2: POST /connection with unreachable URL → 502
    console.log("\nTest 2: POST /connection unreachable URL");
    {
      const res = await fetch(`${httpBase}/connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: "ws://127.0.0.1:1", path: "/test" }),
      });
      assert(res.status === 502, "2: unreachable URL → 502");
    }

    // Test 3: POST /connection missing fields → 400
    console.log("\nTest 3: POST /connection missing fields");
    {
      const r1 = await fetch(`${httpBase}/connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: "/test" }),
      });
      assert(r1.status === 400, "3a: missing url → 400");

      const r2 = await fetch(`${httpBase}/connection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: `ws://127.0.0.1:${wssPort}` }),
      });
      assert(r2.status === 400, "3b: missing path → 400");
    }

  } catch (err) {
    console.error("Unexpected error:", err);
    failed++;
  } finally {
    await close();
    backendServer.close();
    mockWss.close();
    console.log(`\nResults: ${passed} passed, ${failed} failed`);
    process.exit(failed > 0 ? 1 : 0);
  }
})();
