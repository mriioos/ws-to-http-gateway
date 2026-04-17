const WebSocket = require("ws");

const client = new WebSocket(`ws://localhost:8079/ping`);

client.on("open", () => {
    console.log("WebSocket client connected to gateway. Pinging backend...");
    client.send("hello-from-client");
});

client.on("message", (data) => {
    const msg = data.toString();
    console.log("WebSocket client received message from gateway:");
    console.log(msg);

    console.log("TEST PASSED");

    client.close();
    process.exit(0);
});

// Set a safe timeout to prevent hanging if the gateway doesn't respond
setTimeout(() => {
    console.error("TEST FAILED: No response from gateway after 5 seconds");
    client.close();
    process.exit(1);
}, 5000);