/**
 * This test verifies that the gateway can push messages to WebSocket clients correctly.
 * It connects a WebSocket client to the gateway, sends a message, and then simulates
 * backend push requests to test both broadcast and specific client messaging.
 * The test will pass if the client receives the expected messages from the gateway.
 */

const WebSocket = require("ws");
const express = require('express');

// Configuration for the test - ensure it matches the gateway configuration
const BACKEND_PORT = 3000;
const GATEWAY_PORT = 8080;
const PUSH_API_KEY = "test_push_api_key";
let TEST_CLIENT_ID = "test-client-id"; // Set dynamically when the client sends the first message

const app = express();
app.use(express.text());

app.post('/ping', (req, res) => {

    const input = req.body;

    // Get the client ID from the header
    const client_id = req.headers['x-client-id'];

    console.log(`Received message from client ${client_id}: ${input}`);
    TEST_CLIENT_ID = client_id;

    res.status(200).send(`Pong!`);
});

app.listen(BACKEND_PORT, () => {
    console.log(`Backend server is listening on port ${BACKEND_PORT}`);
});

const client = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ping`);

client.on("open", () => {
    console.log("WebSocket client connected to gateway. Pinging backend...");
    client.send("hello-from-client");
});

let test_broadcast_passed = false;
let test_specific_client_passed = false;

client.on("message", (data) => {
    const msg = data.toString();
    console.log("WebSocket client received message from gateway:");
    console.log(msg);

    if(msg.includes("[Broadcast]")){
        console.log("PUSH TEST BROADCAST PASSED\n");
        test_broadcast_passed = true;
    }

    if(msg.includes("hello-from-active-backend")){
        console.log("PUSH TEST SENT TO SPECIFIC CLIENT PASSED\n");
        test_specific_client_passed = true;
    }

    if(test_broadcast_passed && test_specific_client_passed){
        console.log("ALL PUSH TESTS PASSED\n");
        client.close();
        process.exit(0);
    }
});

setTimeout(async () => {
    
    console.log('Simulating backend broadcast push requests to gateway...\n');
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'x-api-key': PUSH_API_KEY,
            'x-client-id': 'broadcast' // Use 'broadcast' to send to all clients
        },
        body: '[Broadcast] hello-from-active-backend'
    });

    console.log('Simulating backend push request to specific client...\n');
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method: 'POST',
        headers: {
            'Content-Type': 'text/plain',
            'x-api-key': PUSH_API_KEY,
            'x-client-id': TEST_CLIENT_ID // Use the specific client ID to send to that client
        },
        body: 'hello-from-active-backend'
    });
}, 2000); // Delay to ensure the client is connected before sending push requests

// Set a safe timeout to prevent hanging if the gateway doesn't respond
setTimeout(() => {
    console.error("TEST FAILED: No response from gateway after 5 seconds");
    client.close();
    process.exit(1);
}, 5000);