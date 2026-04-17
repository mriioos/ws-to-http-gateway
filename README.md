# WS → HTTP Gateway

A lightweight **WebSocket-to-HTTP bridge with bidirectional push support**, designed to integrate WebSocket clients with existing HTTP systems (e.g. n8n webhooks).

It provides:

- WS → HTTP proxying with path mapping
- Backend → WS push API
- Broadcast + targeted delivery
- Explicit `/ws/*` routing boundary for safety
- Optional API key protection for push endpoint

---

# Overview

## Architecture

WS Client
   ↓ (ws://domain/ws/webhook/:id)
Gateway
   ↓ (HTTP POST /webhook/:id)
Backend (e.g. n8n)
   ↓
Response
   ↓
WS Client

Backend → /push → Gateway → WS Clients

---

# Key Design Rule

All WebSocket traffic MUST be prefixed with `/ws`.

This ensures separation between:
- WebSocket transport layer (`/ws/*`)
- HTTP backend webhooks (`/webhook/*`)

Invalid WS paths are rejected with `400 Bad Request`.

---

# Features

- WebSocket → HTTP proxy (path-preserving after `/ws` stripping)
- Automatic client ID generation (`x-client-id`)
- Backend push API (`/push`)
- Broadcast support (`broadcast` client ID)
- Per-connection idle timeout cleanup
- Optional API key authentication
- Strict `/ws` namespace enforcement

---

# Installation

npm install

---

# Usage

## Basic Setup

import wsToHttpGateway from "./gateway";

const server = wsToHttpGateway({
  target_url: "http://localhost:5678",
  push_api_key: "my-secret-key",
  max_idle_millis: 300000
});

server.listen(8080);

---

# WebSocket Behavior

## Connect

const ws = new WebSocket("ws://localhost:8080/ws/webhook/test");

---

## Routing transformation

/ws/webhook/test
→ /webhook/test

---

## HTTP request

POST /webhook/test
Content-Type: text/plain
x-client-id: <uuid>

---

## Flow

1. WS message received
2. Forwarded to HTTP backend
3. Response returned
4. Sent back to WS client

---

# Push API

## Endpoint

POST /push

---

## Headers

x-client-id: <uuid | broadcast>
x-api-key: required if configured

---

## Examples

### Send to client

curl -X POST http://localhost:8080/push \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: <client-id>" \
  -d "hello client"

---

### Broadcast

curl -X POST http://localhost:8080/push \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: broadcast" \
  -d "hello everyone"

---

# Response Codes

201 → Message delivered
400 → Missing client ID
401 → Unauthorized
404 → Client not found

---

# Client Identification

Each WebSocket connection receives:

x-client-id: <uuid>

Used for:
- backend targeting
- push routing
- session identification

---

# Configuration

interface GatewayConfig {
  target_url: string;
  push_api_key?: string;
  max_idle_millis?: number;
}

---

## target_url

Base HTTP backend URL:
http://localhost:5678

---

## push_api_key

If set, required for /push requests.

---

## max_idle_millis

Default: 5 minutes

Closes idle WS connections.

---

# Routing Rules

Allowed:
- /ws/*

Rejected:
- everything else (400 Bad Request)

---

## Example mapping

/ws/chat/a → /chat/a
/ws/webhook/x → /webhook/x

---

# Error Handling

Backend failure returns:

{ "error": "proxy_error" }

---

# Notes

- Plain text payloads only
- No JSON enforcement
- In-memory client registry
- Stateless backend integration

---

# Limitations

- No persistence layer
- No horizontal scaling support
- No WS auth system
- No retry mechanism
- Timer-based idle cleanup

---

# Recommended Improvements

- Redis client store
- JWT authentication
- JSON protocol layer
- Retry queue
- Metrics/observability
- Health checks

---

# Summary

This gateway bridges WebSocket clients with HTTP webhook systems, enabling real-time communication while keeping routing strictly separated under the `/ws` namespace.