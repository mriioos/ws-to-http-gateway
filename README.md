# WS → HTTP Gateway

A lightweight **WebSocket to HTTP bridge** with optional backend → client push capabilities.

This service allows:

* WebSocket clients to communicate with an HTTP backend
* The backend to **push messages back to specific clients or broadcast to all**

---

# Overview

## Architecture

```
WS Client
   ↓
WebSocket Gateway
   ↓
HTTP Backend (POST)
   ↓
Response
   ↓
WS Client

Backend → Gateway (/push) → WS Client(s)
```

---

# Features

* WebSocket → HTTP proxying (per-path routing)
* Automatic client ID assignment (`x-client-id`)
* Backend → client push system
* Broadcast support
* Idle connection cleanup
* Optional API key authentication for push endpoint

---

# Installation

```bash
npm install
```

---

# Usage

## Basic Setup

```ts
import wsToHttpGateway from "./gateway";

const server = wsToHttpGateway({
  target_url: "http://localhost:5678",
  push_api_key: "my-secret-key", // optional
  max_idle_millis: 300000        // optional (default: 5 min)
});

server.listen(8080, () => {
  console.log("Gateway running on port 8080");
});
```

---

# WebSocket Behavior

## Connect

```js
const ws = new WebSocket("ws://localhost:8080/chat");
```

## Send message

```js
ws.send("hello");
```

## What happens

1. Gateway receives message
2. Sends HTTP request:

```
POST http://<target_url>/chat
Content-Type: text/plain
x-client-id: <generated-id>
```

3. Response is sent back to WS client

---

# Push API (Backend → Client)

## Endpoint

```
POST /push
```

---

## Headers

| Header        | Description                       |
| ------------- | --------------------------------- |
| `x-client-id` | Target client ID or `"broadcast"` |
| `x-api-key`   | Required if `push_api_key` is set |

---

## Body

Raw text (same format as WS messages)

---

## Examples

### Send to specific client

```bash
curl -X POST http://localhost:8080/push \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: <client-id>" \
  -d "hello client"
```

---

### Broadcast to all clients

```bash
curl -X POST http://localhost:8080/push \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: broadcast" \
  -d "hello everyone"
```

---

# Response Codes

| Status | Meaning           |
| ------ | ----------------- |
| 201    | Message sent      |
| 400    | Missing client ID |
| 401    | Unauthorized      |
| 404    | Client not found  |

---

# Client Identification

Each WebSocket connection receives a unique:

```
x-client-id: <uuid>
```

This is:

* generated automatically
* sent to backend on each request
* used by backend to push responses

---

# Configuration

```ts
interface GatewayConfig {
  target_url: string;
  push_api_key?: string;
  max_idle_millis?: number;
}
```

---

## Options

### `target_url` (required)

Base HTTP endpoint where WS messages are forwarded.

Example:

```
http://localhost:5678
```

---

### `push_api_key` (optional)

Enables authentication for `/push`.

If set:

* all push requests must include `x-api-key`

---

### `max_idle_millis` (optional)

Default:

```
5 minutes
```

If no messages are received within this time:

* connection is closed automatically

---

# Routing

WebSocket paths are preserved:

```
ws://host/chat   → POST /chat
ws://host/echo   → POST /echo
```

---

# Error Handling

If HTTP request fails:

```json
{ "error": "proxy_error" }
```

is sent back to the WebSocket client.

---

# Notes

* Uses plain text payloads (`text/plain`)
* No JSON parsing by default
* WebSocket connections are stateful (tracked in memory)

---

# Limitations

* No persistence (clients stored in memory)
* No horizontal scaling (requires shared state)
* No built-in authentication for WS connections
* No retry logic for failed HTTP requests

---

# Recommended Improvements

* Add client authentication
* Add message queue / retry
* Support JSON payloads
* Externalize client store (Redis)
* Add health check endpoint

---

# Summary

This gateway provides a minimal but flexible way to:

* bridge WebSocket clients with HTTP systems
* implement real-time messaging on top of existing APIs
* enable backend-driven push notifications

---
