import type { WebSocket } from "ws";

export interface ClientEntry {
  ws: WebSocket;
  path: string;
}

const registry = new Map<string, ClientEntry>();

export function register(clientId: string, entry: ClientEntry): void {
  registry.set(clientId, entry);
}

export function deregister(clientId: string): void {
  registry.delete(clientId);
}

export function get(clientId: string): ClientEntry | undefined {
  return registry.get(clientId);
}
