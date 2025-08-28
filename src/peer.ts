
import readline from 'readline';
import nodeDataChannel from 'node-datachannel';
import { customAlphabet } from 'nanoid';
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 4);

// Init Logger
nodeDataChannel.initLogger('Error');

// PeerConnection Map
const pcMap = {};

// Local ID
const id = nanoid();
console.log(`The local ID is: ${id}`);

// Signaling Server
const WS_URL = `ws://${process.env.SIGNALING_SERVER_ADDR}:${process.env.SIGNALING_SERVER_PORT}` || 'ws://localhost:8000';
console.log(`Connecting to signaling server @ ${WS_URL}`);

const ws = new nodeDataChannel.WebSocket();
ws.open(WS_URL + '/' + id);
console.log(`Waiting for signaling to be connected...`);

ws.onOpen(() => {
    console.log('WebSocket connected, signaling ready');
    readUserInput();
});

ws.onError((err) => {
    console.log('WebSocket Error: ', err);
});

ws.onMessage((msgStr: string) => {
    let msg = JSON.parse(msgStr);
    switch (msg.type) {
        case 'offer':
            createPeerConnection(msg.id);
            pcMap[msg.id].setRemoteDescription(msg.description, msg.type);
            break;
        case 'answer':
            pcMap[msg.id].setRemoteDescription(msg.description, msg.type);
            break;
        case 'candidate':
            pcMap[msg.id].addRemoteCandidate(msg.candidate, msg.mid);
            break;
        default:
            break;
    }
});

function readUserInput() {
    // Read Line Interface

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    rl.question('Enter a remote ID to send an offer:\n', (peerId) => {
        if (peerId && peerId.length > 2) {
            console.log('Offering to ', peerId);
            createPeerConnection(peerId);

            console.log('Creating DataChannel with label "test"');
            let dc = pcMap[peerId].createDataChannel('test');
            dc.onOpen(() => {
                dc.sendMessage('Hello from ' + id);
            });

            dc.onMessage((msg) => {
                console.log('Message from ' + peerId + ' received:', msg);
            });
        }

        rl.close();
        readUserInput();
    });
}

function createPeerConnection(peerId) {
    // Create PeerConnection
    let peerConnection = new nodeDataChannel.PeerConnection('pc', {
        iceServers: [
            'stun:stun.l.google.com:19302',
            'stun:stun.l.google.com:5349',
            'stun:stun1.l.google.com:3478',
            'stun:stun1.l.google.com:5349',
            'stun:stun2.l.google.com:19302',
            'stun:stun2.l.google.com:5349',
            'stun:stun3.l.google.com:3478',
            'stun:stun3.l.google.com:5349',
            'stun:stun4.l.google.com:19302',
            'stun:stun4.l.google.com:5349'
        ],
    });
    peerConnection.onStateChange((state) => {
        console.log('State: ', state);
    });
    peerConnection.onGatheringStateChange((state) => {
        console.log('GatheringState: ', state);
    });
    peerConnection.onLocalDescription((description, type) => {
        ws.sendMessage(JSON.stringify({ id: peerId, type, description }));
    });
    peerConnection.onLocalCandidate((candidate, mid) => {
        ws.sendMessage(JSON.stringify({ id: peerId, type: 'candidate', candidate, mid }));
    });
    peerConnection.onDataChannel((dc) => {
        console.log('DataChannel from ' + peerId + ' received with label "', dc.getLabel() + '"');
        dc.onMessage((msg) => {
            console.log('Message from ' + peerId + ' received:', msg);
        });
        dc.sendMessage('Hello From ' + id);
    });

    pcMap[peerId] = peerConnection;
}

// interval(4200).pipe(
//     take(100)
// ).subscribe({
//     next: () => process.stdout.write('Hello from Host...'),
//     complete: () => process.exit(0)
// });
