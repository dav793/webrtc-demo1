import WebSocket, { WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { URL } from 'url';

const clients: { [id: string]: WebSocket } = {};

const addr = process.env.SIGNALING_SERVER_ADDR || '127.0.0.1';
const port = parseInt(process.env.SIGNALING_SERVER_PORT) || 8000;

console.log(`Starting signaling server on ws://${addr}:${port}`);

const wsServer = new WebSocketServer({
    host: addr,
    port: port,
    // Handle path-based routing
    handleProtocols: (protocols, request) => {
        // You can handle protocols here if needed
        return false;
    }
});

wsServer.on('connection', (ws: WebSocket, request: IncomingMessage) => {
    let id = '';

    // Extract client ID from the URL path
    if (request.url) {
        try {
            const url = new URL(request.url, `http://${request.headers.host}`);
            id = url.pathname.replace('/', '') || '';
        } catch (error) {
            console.error('Error parsing URL:', error);
            ws.close(1002, 'Invalid URL');
            return;
        }
    }
    if (!id) {
        console.error('Client connected without ID');
        ws.close(1002, 'Missing client ID');
        return;
    }

    console.log(`New Connection from ${id}`);
    clients[id] = ws;

    ws.on('message', (data: WebSocket.Data) => {
        try {
            const buffer = data.toString();
            const msg = JSON.parse(buffer);
            const peerId = msg.id;
            const peerWs = clients[peerId];

            console.log(`Message from ${id} to ${peerId} : ${buffer}`);

            if (!peerWs) {
                console.error(`Cannot find peer with ID ${peerId}`);
                return;
            }

            // Check if peer connection is still open
            if (peerWs.readyState !== WebSocket.OPEN) {
                console.error(`Peer ${peerId} is not connected`);
                delete clients[peerId];
                return;
            }

            // Forward the message with the sender's ID
            msg.id = id;
            peerWs.send(JSON.stringify(msg));
        }
        catch (error) {
            console.error(`Error handling message from ${id}:`, error);
        }
    });

    ws.on('close', (code: number, reason: Buffer) => {
        console.log(`${id} disconnected (code: ${code}, reason: ${reason.toString()})`);
        delete clients[id];
    });

    ws.on('error', (error: Error) => {
        console.error(`WebSocket error for ${id}:`, error);
        if (clients[id])
            delete clients[id];
    });

    // Optional: handle pong responses (for keep-alive)
    ws.on('pong', () => {
        // Client is still alive
    });
});

wsServer.on('error', (error: Error) => {
    console.error('WebSocket server error:', error);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('Shutting down signaling server...');
    
    Object.keys(clients).forEach(id => {
        const ws = clients[id];
        if (ws.readyState === WebSocket.OPEN) {
            ws.close(1001, 'Server shutting down');
        }
    });

    wsServer.close(() => {
        console.log('Signaling server closed');
        process.exit(0);
    });
});

// Optional: keep-alive mechanism
const keepAliveInterval = setInterval(() => {
    Object.keys(clients).forEach(id => {
        const ws = clients[id];
        if (ws.readyState === WebSocket.OPEN) {
            ws.ping();
        } else {
            // Clean up dead connections
            delete clients[id];
        }
    });
}, 30000); // Ping every 30 seconds

wsServer.on('close', () => {
    clearInterval(keepAliveInterval);
});

console.log('Signaling server started successfully');
