import nodeDataChannel from 'node-datachannel';

// Init Logger
nodeDataChannel.initLogger('Debug');

const clients = {};

const addr = process.env.SIGNALING_SERVER_ADDR || '127.0.0.1';
const port = parseInt(process.env.SIGNALING_SERVER_PORT) || 8000;
console.log(`Starting discovery server on ws://${addr}:${port}`);

const wsServer = new nodeDataChannel.WebSocketServer({
  bindAddress: addr,
  port: port,
});

wsServer.onClient((ws) => {
  let id = '';

  ws.onOpen(() => {
    id = ws.path().replace('/', '');
    console.log(`New Connection from ${id}`);
    clients[id] = ws;
  });

  ws.onMessage((buffer: string) => {
    let msg = JSON.parse(buffer);
    let peerId = msg.id;
    let peerWs = clients[peerId];

    console.log(`Message from ${id} to ${peerId} : ${buffer}`);
    if (!peerWs) return console.error(`Can not find peer with ID ${peerId}`);

    msg.id = id;
    peerWs.sendMessage(JSON.stringify(msg));
  });

  ws.onClosed(() => {
    console.log(`${id} disconnected`);
    delete clients[id];
  });

  ws.onError((err) => {
    console.error(err);
  });
});