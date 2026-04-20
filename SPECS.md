# Defined Actors

## Web Socket Only side
Side that only uses Web Socket protocol

- Persistent connections
- Sends messages that may or may not expect response
- Recieves messages that may or may not be responded

**Client**
- Initiates connection

**Server**
- Expects connection to be initiated

## HTTP Only side
- Ephemeral connections
- If sends, expects response
- If recieving, responds

## WS to HTTP GateWay side
- Links WS connections to the HTTP server.
- Connection may be started from either side.
- Forwards messages from WebSocket to HTTP.
- Forwards HTTP responses back to WebSocket if any content.
- HTTP side may want to actively send a message to a WS client.

# Gateway behaviour

- Accepts incoming WebSocket connections at `/ws/{path}`
- Accepts HTTP requests.
- Forwards inbound messages to HTTP server via `POST /{path}`
- Forwards outbound messages recived at `POST /message` to the specified WS client (client id can be specified using the `x-client-id` header).
- Opens WebSocket outbound connections when `POST /connection` is triggered, where body contains the `url` of the WebSocket server and `path` where messages should be forwarded to. The result of this operation should be the 'active' equivalent as when an incoming WebSocket connection to `/ws/{path}` is made.
- Closes the specified WebSocket connection when `DELETE /connection` is triggered (client id can be specified using the `x-client-id` header)

**Another way of understanding**
There are two ways of creating a connection with an associated `{path}` on the backend:
- Inbound connections: a client connects to the wss, at `[gateway] /ws/{path}`.
- Outbound connections: backend requests a ws creation using `[gateway] POST /connection` + `url` + `path`.

There are two ways of sending messages:
- Inbound message: connected ws client sends a message, gets forwarded to `[backend] POST /{path}`, response is sent back to ws client.
- Outbound message: backend requests a message to be sent to a client ws using `[gateway] POST /message` + `x-client-id`.

Backend can request the deletion of a connection using `[gateway] DELETE /connection`. No analog exists on the ws side as the connection can be closed at any moment.