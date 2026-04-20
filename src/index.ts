import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { WebSocketServer } from "ws";
import { authMiddleware } from "./middleware/auth.js";
import { connectionRouter } from "./handlers/connection.js";
import { messageRouter } from "./handlers/message.js";
import { setupWsInbound } from "./handlers/ws_inbound.js";

export interface ServerInstance {
  server: http.Server;
  close: () => Promise<void>;
}

export function createServer(): ServerInstance {
  const backendUrl = process.env.BACKEND_URL;
  if (!backendUrl) {
    throw new Error("BACKEND_URL environment variable is required");
  }
  process.env.BACKEND_URL = backendUrl.replace(/\/$/, "");

  const app = express();
  app.use(authMiddleware);
  app.use(connectionRouter);
  app.use(messageRouter);

  const server = http.createServer(app);
  const wss = new WebSocketServer({ noServer: true });
  setupWsInbound(server, wss);

  const close = (): Promise<void> =>
    new Promise((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );

  return { server, close };
}

if (path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const port = parseInt(process.env.GATEWAY_PORT ?? "6473", 10);
  const { server } = createServer();
  server.listen(port, () => {
    console.log(`[gateway] listening on port ${port}`);
  });
}
