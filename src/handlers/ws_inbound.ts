import type { IncomingMessage, Server } from "node:http";
import type { Socket } from "node:net";
import { WebSocketServer } from "ws";
import { randomUUID } from "node:crypto";
import { register } from "../registry.js";
import { handleConnection } from "../handle_connection.js";

export function setupWsInbound(server: Server, wss: WebSocketServer): void {
  server.on("upgrade", (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = req.url ?? "/";

    if (!url.startsWith("/ws/")) {
      socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
      socket.destroy();
      return;
    }

    const parsedPath = new URL(url, "http://x").pathname.slice("/ws".length) || "/";

    wss.handleUpgrade(req, socket, head, (ws) => {
      const clientId = randomUUID();
      register(clientId, { ws, path: parsedPath });
      handleConnection(ws, parsedPath, clientId);
    });
  });
}
