# ws-to-http-gateway

A production-ready sidecar that bridges WebSocket connections to an HTTP-only backend. Deploy it alongside any HTTP service to give it real-time WebSocket support without changing the backend code.

---

## How it works

The gateway manages two types of connections and two message flows.

### Connection types

**Inbound** — a WS client connects to the gateway:
```
WS client  →  GET /ws/{path}  →  Gateway
```

**Outbound** — the backend asks the gateway to open a connection:
```
Backend  →  POST /connection { url, path }  →  Gateway  →  WS server
```

Once established, both connection types are identical. Each is registered under a `client_id` and handled by the same logic.

### Message flows

**WS → Backend** (triggered by a WS message arriving at the gateway):
```
WS client/server  →  Gateway  →  POST {BACKEND_URL}/{path}
                                        ↓ (if response body non-empty)
                  WS client/server  ←  Gateway
```

**Backend → WS** (triggered by the backend calling the gateway):
```
Backend  →  POST /message  (x-client-id header)  →  Gateway  →  WS client/server
```

---

## Endpoints

### WebSocket

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/ws/{path}` | Upgrade to WebSocket. Assigns a `client_id`, registers the connection. WS upgrades bypass API key auth. |

### HTTP (called by the backend)

| Method | Path | Headers | Body | Description |
|--------|------|---------|------|-------------|
| `POST` | `/connection` | `x-api-key` | `{ url: string, path: string }` | Opens an outbound WS connection to `url`. Returns `{ client_id }`. |
| `DELETE` | `/connection` | `x-api-key`, `x-client-id` | — | Closes and deregisters the specified connection. |
| `POST` | `/message` | `x-api-key`, `x-client-id` | raw string or JSON | Sends the body as a WS text message to the specified client. |

---

## Configuration

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BACKEND_URL` | Yes | — | Base URL of the HTTP backend, e.g. `http://localhost:3000` |
| `GATEWAY_PORT` | No | `6473` | Port the gateway listens on |
| `BACKEND_API_KEY` | No | — | If set, all HTTP requests to the gateway must include `x-api-key: <value>`. WS connections are exempt. |

---

## Quick start

### Docker

```bash
docker build -t ws-to-http-gateway .

docker run --rm -p 6473:6473 \
  -e BACKEND_URL=http://host.docker.internal:3000 \
  -e BACKEND_API_KEY=my-secret-key \
  ws-to-http-gateway
```

### Local (Node.js)

```bash
npm install
BACKEND_URL=http://localhost:3000 BACKEND_API_KEY=my-secret-key npm run dev
```

### Build & run compiled

```bash
npm run build
BACKEND_URL=http://localhost:3000 npm start
```

---

## Usage examples

### Inbound: connect a WS client

```js
const ws = new WebSocket("ws://localhost:6473/ws/chat");

ws.onmessage = (e) => console.log("from backend:", e.data);
ws.onopen    = ()  => ws.send(JSON.stringify({ text: "hello" }));
```

The gateway forwards each message to `POST {BACKEND_URL}/chat` with:
- `Content-Type: application/json` (if valid JSON) or `text/plain`
- `x-client-id: <uuid>`

If the backend responds with a non-empty body, that body is sent back to the WS client.

---

### Push a message to a connected client

```bash
curl -X POST http://localhost:6473/message \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: <client-id>" \
  -H "Content-Type: text/plain" \
  -d "hello from backend"
```

The `client_id` is available in every forwarded request as the `x-client-id` header.

---

### Outbound: backend opens a WS connection

```bash
curl -X POST http://localhost:6473/connection \
  -H "x-api-key: my-secret-key" \
  -H "Content-Type: application/json" \
  -d '{ "url": "wss://example.com/feed", "path": "/events" }'
# → { "client_id": "..." }
```

Messages arriving from that WS server are forwarded to `POST {BACKEND_URL}/events`. The backend can push back using `POST /message` with the returned `client_id`.

---

### Close a connection

```bash
curl -X DELETE http://localhost:6473/connection \
  -H "x-api-key: my-secret-key" \
  -H "x-client-id: <client-id>"
```

---

## Response codes

| Code | Meaning |
|------|---------|
| `200` | OK |
| `201` | Outbound connection created |
| `400` | Missing or invalid parameter |
| `401` | Missing or wrong `x-api-key` |
| `404` | `client_id` not found in registry |
| `502` | Gateway could not connect to the outbound WS URL |
| `1011` | WS close code — backend returned 5xx or was unreachable |

---

## Testing

```bash
# Unit / integration tests
npm run test

# Full Docker integration test (gateway must be running)
node docker_test.js
```

`docker_test.js` starts a local HTTP backend and WSS, then exercises the complete round-trip against a live gateway instance.
