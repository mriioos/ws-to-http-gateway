const express = require('express');

const app = express();
app.use(express.text());

app.post('/ping', (req, res) => {

    const input = req.body;

    // Get the client ID from the header
    const client_id = req.headers['x-client-id'];

    console.log(`Received message from client ${client_id}: ${input}`);

    res.status(200).send(`Pong! - HTTP_RESPONSE: ${input}`);
});

app.listen(8080, () => {
    console.log('Backend server is listening on port 8080');
});