import http from "node:http";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { randomUUID } from "node:crypto";

// Extend WebSocket to store path
interface WSWithMeta extends WebSocket {
    path?: string;
    client_id?: string;
}

interface GatewayConfig {
    target_url : string;
    push_api_key? : string;
    max_idle_millis? : number;
}

const default_config : Partial<GatewayConfig> = {
    max_idle_millis : 5 * 60 * 1000 // default to 5 minutes
}

export default function wsToHttpGateway(config: GatewayConfig) {
    
    config = { ...default_config, ...config };

    // Remove trailing slash from target_url if present
    if (config.target_url.endsWith("/")) {
        config.target_url = config.target_url.slice(0, -1);
    }

    // Initialize Express app for handling push requests from backend
    const app = express();
    app.use(express.text());

    // Initialize server
    const server = http.createServer(app);

    // Initialize WebSocket server
    const wss = new WebSocketServer({ noServer: true });

    // Handle WebSocket upgrade requests manually to support per path routing
    server.on("upgrade", (req, socket, head) => {

        const raw_url = req.url || "/";

        // Check url starts with /ws, if not reject the connection
        // This forces the client to connect to the correct path /ws/<backend endpoint> and prevents mixing paths by explicitly using a prefix
        if (!raw_url.startsWith("/ws")) {
            socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
            socket.destroy();
            return;
        }

        const path = raw_url.replace(/^\/ws/, ""); // Remove the /ws prefix to get the backend endpoint path

        wss.handleUpgrade(req, socket, head, (ws) => {
            const client = ws as WSWithMeta;
            client.path = path;
            client.client_id = randomUUID(); // Assign a unique client ID for push notifications

            wss.emit("connection", client, req);
        });
    });

    // Create a mapping of client IDs to WebSocket connections for push notifications
    const clients = new Map<string, WSWithMeta>();

    // Handle WebSocket connections
    wss.on("connection", (ws: WSWithMeta) => {

        // Track idle time for this connection
        // If no messages are received within max_idle_millis, the connection is closed
        const idle_since = new Date();

        setInterval(() => {
            const now = new Date();
            if (now.getTime() - idle_since.getTime() > config.max_idle_millis!) {
                ws.close();
            }
        }, config.max_idle_millis); // Check idle status every max_idle_millis

        // Generate an identifier for this connection (used for the 'x-client-id' header)
        // Backend can use this to push requests to specific clients
        clients.set(ws.client_id!, ws);

        ws.on("message", async (message: Buffer) => {

            // Reset idle timer on message
            idle_since.setTime(Date.now());

            try {
                const res = await fetch(`${config.target_url}${ws.path}`, {
                    method: "POST",
                    headers: {
                        "Content-Type": "text/plain",
                        'x-client-id' : ws.client_id!
                    },
                    body: message.toString()
                });

                const text = await res.text();

                ws.send(text);
            } 
            catch(err){
                ws.send(JSON.stringify({ error: "proxy_error" }));
                console.error(err);
                console.log(JSON.stringify(err, null, 2));
            }
        });

        ws.on("close", () => {
            clients.delete(ws.client_id!);
        });
    });

    // Define a function to send the message to a specific client
    function sendToClient(client : WSWithMeta, message : string) {

        // Send the message if the connection is still open
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    }

    // Handle push HTTP requests from the backend to clients
    app.post('/push', (req, res) => {

        const body = req.body;

        // Authenticate request using push_api_key if provided
        if(config.push_api_key) {
            const api_key = req.headers['x-api-key'] as string;

            if (api_key !== config.push_api_key) {
                res.status(401).send({ error: "Unauthorized" });
                return;
            }
        }

        // Get the client ID from the header
        const client_id = req.headers['x-client-id'] as string;
    
        // If no client ID is provided or it's empty, return an error
        if(!client_id) {
            res.status(400).send({ error: "Missing client ID" });
            return;
        }

        // An explicit 'broadcast' client id is used to broadcast to all clients
        if(client_id === 'broadcast') {

            wss.clients.forEach((client) => {
                sendToClient(client, body);
            });
            res.status(201).send({ message : "broadcasted" });
            return;
        }

        // Find the client connection by ID and send the message to the specified client
        const client = clients.get(client_id);

        if (!client) {
            res.status(404).send({ error: "Client not found" });
            return;
        }

        sendToClient(client, body);
        res.status(201).send({ message : "sent" });
    });

    return server;
}