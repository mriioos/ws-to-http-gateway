import express, { Router, type Request, type Response } from "express";
import { get } from "../registry.js";

export const messageRouter = Router();

messageRouter.post("/message", express.raw({ type: "*/*" }), (req: Request, res: Response) => {
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

  const body = Buffer.isBuffer(req.body) ? req.body.toString() : String(req.body ?? "");
  entry.ws.send(body);

  res.status(200).json({ message: "sent" });
});
