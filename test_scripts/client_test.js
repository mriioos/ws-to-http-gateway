import WebSocket from "ws";

const PROTOCOL = 'wss'; // or ws
const URL = 'n8n.onirossoftware.com'; // localhost:6473
const BACKEND_URL = '/webhook-test/ping' // /ping


const client = new WebSocket(`${PROTOCOL}://${URL}/ws${BACKEND_URL}`);

client.on("open", () => {
    console.log("WebSocket client connected to gateway. Pinging backend...");
    client.send("hello-from-client");
});

client.on("message", (data) => {
    const msg = data.toString();
    console.log("WebSocket client received message from gateway:");
    console.log(msg);

    if(msg.includes('[CLOSE MESSAGE]')){
        console.log('Close message recieved from backend');
        
        console.log("TEST PASSED");
        client.close();
        process.exit(0);
    }
});

// Set a safe timeout to prevent hanging if the gateway doesn't respond
setTimeout(() => {
    console.error("TEST FAILED: No response from gateway after 5 seconds");
    client.close();
    process.exit(1);
}, 5000);