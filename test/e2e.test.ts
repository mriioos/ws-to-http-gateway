import express from "express";
import WebSocket from "ws";

// adjust import path to your project structure
import wsToHttpGateway from "../src/gateway";

// Set test parameters
const GATEWAY_PORT = 8080;
const TARGET_PORT = 5678;
const TARGET_URL = `http://localhost:${TARGET_PORT}`;
const MAX_IDLE_MILLIS = 60_000;
const PUSH_API_KEY = 'test-api-key';

let TEST_CLIENT_ID = null; // Will be set when client connects

// Define tests
const tests_passed = {

    // Client perspective tests
    response_test : false,                      // Client recieves correct response from backend through gateway
    push_test_specific_client : false,          // Client receives push from backend through gateway
    push_test_broadcast : false,                // Client receives broadcast push from backend through gateway

    // Backend perspective tests
    push_test_401_no_api_key : false,           // Backend push without API key is rejected with 401
    push_test_201_broadcast : false,            // Backend push with null client id is broadcasted (201) to all clients
    push_test_400_missing_client_id : false,    // Backend push without client id is rejected with 400
    push_test_404_client_not_found : false,     // Backend push with non existing client id is rejected with 404
    push_test_201_specific_client : false       // Backend push with specific client id is sent (201) to that client
}

/**
 * 1. Mock HTTP backend
 */
const app = express();
app.use(express.text());

app.post("/ping", (req, res) => {

    const input = req.body;
    const client_id = req.headers['x-client-id'] as string;

    // simulate processing
    console.log(`[System] Client ${client_id} sent message to backend: ${input}\n`);
    TEST_CLIENT_ID = client_id;
    res.send(`Pong! - HTTP_RESPONSE: ${input}`);
});

const target = app.listen(TARGET_PORT, () => {
    console.log("[System] Mock HTTP server running on\n", TARGET_PORT);
});

/**
 * 2. Start WS gateway
 */
const gateway = wsToHttpGateway({
    target_url : TARGET_URL,
    max_idle_millis : MAX_IDLE_MILLIS,
    push_api_key : PUSH_API_KEY
});

gateway.listen(GATEWAY_PORT, () => {
    console.log(`[System] WS to HTTP gateway running on port ${GATEWAY_PORT}, forwarding to ${TARGET_URL}\n`);
});

/**
 * 3. WebSocket client
 */
const client = new WebSocket(`ws://localhost:${GATEWAY_PORT}/ping`);

client.on("open", () => {
    console.log("[System] WebSocket client connected to gateway. Pinging backend...\n");
    client.send("Ping! - hello-from-client");
});

client.on("message", (data) => {
    const msg = data.toString();
    console.log("[System] WebSocket client received message from gateway:");
    console.log(msg);

    if (msg.includes("HTTP_RESPONSE")) {
        console.log("[Client] RESPONSE TEST PASSED\n");
        tests_passed.response_test = true;
    }

    if(msg.includes('HTTP_PUSH_BROADCAST')){
        console.log("[Client] PUSH TEST BROADCAST PASSED\n");
        tests_passed.push_test_broadcast = true;
    }

    if(msg.includes('HTTP_PUSH_DIRECT')){
        console.log("[Client] PUSH TEST SPECIFIC CLIENT PASSED\n");
        tests_passed.push_test_specific_client = true;
    }
});

/**
 * 4. Test push from backend to client
 */

setTimeout(async () => {

    // 401 (no API key)
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method : "POST",
        body : "test-push-data"
    })
    .then(res => {
        if(res.status === 401){
            console.log("[Active Backend] PUSH TEST 401 PASSED\n");
            tests_passed.push_test_401_no_api_key = true;
        }
    });

    // 400 (missing client id)
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method : "POST",
        headers : {
            'Content-Type' : 'application/json',
            "x-api-key" : PUSH_API_KEY
        },
        body : "test-push-data"
    })
    .then(res => {
        if(res.status === 400){
            console.log("[Active Backend] PUSH TEST 400 MISSING CLIENT ID PASSED\n");
            tests_passed.push_test_400_missing_client_id = true;
        }
    });

    // 201 (broadcast)
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method : "POST",
        headers : {
            "x-api-key" : PUSH_API_KEY,
            'x-client-id' : 'broadcast'
        },
        body : "HTTP_PUSH_BROADCAST"
    })
    .then(res => res.json())
    .then(json => {
        if(json.message === "broadcasted"){
            console.log("[Active Backend] PUSH TEST BROADCAST PASSED\n");
            tests_passed.push_test_201_broadcast = true;
        }
    });

    // 404 (client not found)
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method : "POST",
        headers : {
            "x-api-key" : PUSH_API_KEY,
            'x-client-id' : 'non-existing-client-id'
        },
        body : "test-data"
    })
    .then(res => {
        if(res.status === 404){
            console.log("[Active Backend] PUSH TEST 404 CLIENT NOT FOUND PASSED\n");
            tests_passed.push_test_404_client_not_found = true;
        }
    });


    // 201 (sent to specific client)
    await fetch(`http://localhost:${GATEWAY_PORT}/push`, {
        method : "POST",
        headers : {
            "x-api-key" : PUSH_API_KEY,
            'x-client-id' : TEST_CLIENT_ID!
        },
        body : "HTTP_PUSH_DIRECT"
    })
    .then(res => res.json())
    .then(json => {
        if(json.message === "sent"){
            console.log("[Active Backend] PUSH TEST SENT TO SPECIFIC CLIENT PASSED\n");
            tests_passed.push_test_201_specific_client = true;
        }
    });

}, 5000); // Wait for client to connect and tests to run before sending push requests from backend


/**
 * 5. Finalize tests
 */
setTimeout(() => {

    // Close all connections
    client.close();
    gateway.close();
    target.close();

    // Check test results
    if(Object.values(tests_passed).every(Boolean)){
        console.log("[System] ALL TESTS PASSED\n");
        process.exit(0);
    }
    
    console.error("[System] TEST FAILED: Some tests did not pass\n");
    console.error("[System] Test results:", tests_passed);
    process.exit(1);

}, 15000); // Wait for all tests to complete before finalizing