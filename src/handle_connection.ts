import WebSocket, { type RawData } from "ws";
import { deregister } from "./registry.js";

function rawToString(raw: RawData): string {
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

export function handleConnection(ws: WebSocket, path: string, clientId: string): void {
  const backendUrl = process.env.BACKEND_URL!;

  ws.on("message", async (raw: RawData) => {
    const body = rawToString(raw);

    let isJson = false;
    try {
      JSON.parse(body);
      isJson = true;
    } catch {
      // not JSON
    }

    let res: Response;
    try {
      res = await fetch(`${backendUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": isJson ? "application/json" : "text/plain",
          "x-client-id": clientId,
        },
        body,
      });
    } catch (err) {
      console.error(`[gateway] backend unreachable for client ${clientId}:`, err);
      ws.close(1011, "backend unreachable");
      return;
    }

    if (res.status >= 500) {
      console.error(`[gateway] backend ${res.status} for client ${clientId}`);
      ws.close(1011, `backend error ${res.status}`);
      return;
    }

    const text = await res.text();
    if (text.length > 0) {
      ws.send(text);
    }
  });

  ws.on("close", (code: number, reason: Buffer) => {
    deregister(clientId);
    console.log(`[gateway] client ${clientId} closed (code=${code} reason=${reason.toString()})`);
  });

  ws.on("error", (err: Error) => {
    deregister(clientId);
    console.error(`[gateway] client ${clientId} error:`, err.message);
  });
}
