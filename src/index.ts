import wsToHttpGateway from "./gateway";

// Load environment variables
const TARGET_URL = process.env.TARGET_URL as string;
const GATEWAY_PORT = Number.parseInt(process.env.GATEWAY_PORT as string) || 8080;
const MAX_IDLE_MILLIS = Number.parseInt(process.env.MAX_IDLE_MILLIS as string) || 5 * 60 * 1000; // milliseconds before closing idle connections
const PUSH_API_KEY = process.env.PUSH_API_KEY;

// Validate target URL
if (!TARGET_URL) {
    console.error("Error: TARGET_URL environment variable is not set.");
    process.exit(1);
}

try{

    // Validate protocol
    const aux = new URL(TARGET_URL);
    if (aux.protocol !== "http:" && aux.protocol !== "https:") {
        console.error("Error: TARGET_URL must start with http:// or https://");
        process.exit(1);
    }
}
catch(err){
    console.error("Error: TARGET_URL environment variable is not a valid URL.");
    console.error(err);
    process.exit(1);
}


// Validate gateway port
if (!GATEWAY_PORT) {
    console.error("Error: GATEWAY_PORT environment variable is not set.");
    process.exit(1);
}

if (Number.isNaN(GATEWAY_PORT)) {
    console.error("Error: GATEWAY_PORT environment variable is not a valid number.");
    process.exit(1);
}

// Start the WebSocket to HTTP adapter
const server = wsToHttpGateway({
    target_url : TARGET_URL,
    push_api_key : PUSH_API_KEY,
    max_idle_millis : MAX_IDLE_MILLIS
});

// Start server
server.listen(GATEWAY_PORT, () => {
    console.log(`WS to HTTP gateway running on port ${GATEWAY_PORT}, forwarding to ${TARGET_URL}`);
});