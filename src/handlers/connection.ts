import express, { Router, type Request, type Response } from "express";
import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import { register, deregister, get } from "../registry.js";
import { handleConnection } from "../handle_connection.js";

export const connectionRouter = Router();

connectionRouter.post("/connection", express.json(), async (req: Request, res: Response) => {
  const body = req.body as { url?: unknown; path?: unknown } | undefined;
  const { url, path } = body ?? {};

  if (!url || typeof url !== "string") {
    res.status(400).json({ error: "missing or invalid url" });
    return;
  }
  if (path === undefined || path === null || typeof path !== "string") {
    res.status(400).json({ error: "missing or invalid path" });
    return;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const ws = new WebSocket(url);

  try {
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", (err) => reject(err));
    });
  } catch (err) {
    console.error("[POST /connection] failed to connect:", (err as Error).message);
    ws.terminate();
    res.status(502).json({ error: "failed to connect to WebSocket URL" });
    return;
  }

  const clientId = randomUUID();
  register(clientId, { ws, path: normalizedPath });
  handleConnection(ws, normalizedPath, clientId);

  res.status(201).json({ client_id: clientId });
});

connectionRouter.delete("/connection", (req: Request, res: Response) => {
  const clientId = req.headers["x-client-id"];

  if (!clientId || typeof clientId !== "string") {
    res.status(400).json({ error: "missing x-client-id header" });
    return;
  }

  const entry = get(clientId);
  if (!entry) {
    res.status(404).json({ error: "client not found" });
    return;
  }

  deregister(clientId);
  entry.ws.close(1000);

  res.status(200).json({ message: "connection closed" });
});
