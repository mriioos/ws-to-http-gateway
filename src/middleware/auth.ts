import type { Request, Response, NextFunction } from "express";

export function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const apiKey = process.env.BACKEND_API_KEY;
  if (!apiKey) {
    next();
    return;
  }
  const provided = req.headers["x-api-key"];
  if (provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
