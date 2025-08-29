import readline from 'readline';
import { RTCPeerConnection, RTCDataChannel, RTCSessionDescription, RTCIceCandidate } from 'werift';
import WebSocket from 'ws';
import { customAlphabet } from 'nanoid';
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 4);

const peerId = nanoid();
const pcMap: { [peerId: string]: RTCPeerConnection } = {};

const addr = process.env.SIGNALING_SERVER_ADDR || 'localhost';
const port = process.env.SIGNALING_SERVER_PORT || '8000';
const url = `ws://${addr}:${port}/${peerId}`;

console.log(`Peer ID: ${peerId}`);

const ws = new WebSocket(url);
console.log('Waiting to establish connection with signaling server...');

ws.on('open', () => {
    console.log(`Connection with signaling server established`);
    readUserInput();
});

ws.on('error', (err) => {
    console.error(err);
});

ws.on('message', async (data: WebSocket.Data) => {
    try {
        const msg = JSON.parse(data.toString());
        // console.log(`Received message:`, msg);
        console.log(`Received message from ${msg.id} (${msg.type})`);
        await handleMessage(msg);
    } catch (error) {
        console.log(`Error parsing message: ${error}`);
    }
});

async function handleMessage(msg: any) {
    switch (msg.type) {
        case 'offer':
            await handleOffer(msg);
            break;
        case 'answer':
            await handleAnswer(msg);
            break;
        case 'candidate':
            await handleCandidate(msg);
            break;
        default:
            console.warn(`Unknown message type: ${msg.type}`);
            break;
    }
}

async function handleOffer(msg: any) {
    try {
        console.log(`Handling offer from ${msg.id}`);

        if (!pcMap[msg.id]) {
            await createPeerConnection(msg.id);
        }
        
        const pc = pcMap[msg.id];
        // await pc.setRemoteDescription(new RTCSessionDescription(msg.description, 'offer'));
        await pc.setRemoteDescription({ type: 'offer', sdp: msg.description });

        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);

        console.log(`Sending answer to ${msg.id}`);
        ws.send(JSON.stringify({
            id: msg.id,     // This is the target peer ID
            type: 'answer',
            description: answer.sdp
        }));
    } catch (error) {
        console.log(`Error handling offer: ${error}`);
    }
}

async function handleAnswer(msg: any) {
    try {
        console.log(`Handling answer from ${msg.id}`);

        const pc = pcMap[msg.id];
        if (pc) {
            // await pc.setRemoteDescription(new RTCSessionDescription(msg.description, 'answer'));
            await pc.setRemoteDescription({ type: 'answer', sdp: msg.description });
        }
        else {
            console.log(`No peer connection found for ${msg.id}`);
        }
    } catch (error) {
        console.log(`Error handling answer: ${error}`);
    }
}

async function handleCandidate(msg: any) {
    try {
        // console.log(`Handling candidate from ${msg.id}`);

        const pc = pcMap[msg.id];
        if (pc) {
            await pc.addIceCandidate(new RTCIceCandidate({
                candidate: msg.candidate,
                sdpMLineIndex: msg.sdpMLineIndex,
                sdpMid: msg.sdpMid
            }));
        } 
        else {
            console.log(`No peer connection found for ${msg.id}`);
        }
    } catch (error) {
        console.log(`Error handling candidate: ${error}`);
    }
}

async function createPeerConnection(remotePeerId: string): Promise<RTCPeerConnection> {
    console.log(`Creating peer connection for ${remotePeerId}`);

    const pc = new RTCPeerConnection({
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.l.google.com:5349' },
            { urls: 'stun:stun1.l.google.com:3478' },
            { urls: 'stun:stun1.l.google.com:5349' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:5349' },
            { urls: 'stun:stun3.l.google.com:3478' },
            { urls: 'stun:stun3.l.google.com:5349' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:5349' }
        ]
    });

    // Handle connection state changes
    pc.onconnectionstatechange = () => {
        console.log(`[${remotePeerId}] Connection State: ${pc.connectionState}`);
    };

    // Handle ICE gathering state changes
    pc.onicegatheringstatechange = () => {
        console.log(`[${remotePeerId}] ICE Gathering State: ${pc.iceGatheringState}`);
    };

    // Handle ICE candidates
    pc.onicecandidate = (event) => {
        if (event.candidate) {
            console.log(`Sending ICE candidate to ${remotePeerId}`);
            ws.send(JSON.stringify({
                id: remotePeerId,   // Target peer ID
                type: 'candidate',
                candidate: event.candidate.candidate,
                sdpMLineIndex: event.candidate.sdpMLineIndex,
                sdpMid: event.candidate.sdpMid
            }));
        }
    };

    // Handle data channels
    pc.ondatachannel = (event) => {
        const channel: RTCDataChannel = event.channel;
        // console.log(`DataChannel from ${remotePeerId} received with label "${channel.label}"`);
        
        channel.onopen = () => {
            console.log(`DataChannel "${channel.label}" opened`);
            channel.send(`Hello From ${peerId}`);
        };

        channel.onmessage = (event) => {
            console.log(`Message from ${remotePeerId} received: ${event.data}`);
        };

        channel.onclose = () => {
            console.log(`DataChannel "${channel.label}" closed`);
        };

        channel.onerror = (error) => {
            console.log(`DataChannel error: ${error}`);
        };
    };

    pcMap[remotePeerId] = pc;
    return pc;
}

async function createOffer(remotePeerId: string): Promise<void> {
    try {
        // console.log(`Creating offer for ${remotePeerId}`);

        let pc = pcMap[remotePeerId];
        if (!pc) {
            pc = await createPeerConnection(remotePeerId);
        }
        
        // Create a data channel
        const dataChannel = pc.createDataChannel('messages', {
            ordered: true
        });

        dataChannel.onopen = () => {
            console.log(`DataChannel "messages" opened with ${remotePeerId}`);
            dataChannel.send(`Hello from ${peerId}`);
        };

        dataChannel.onmessage = (event) => {
            console.log(`Message from ${remotePeerId}: ${event.data}`);
        };

        dataChannel.onerror = (error) => {
            console.log(`DataChannel error: ${error}`);
        };

        // Create and send offer
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);

        console.log(`Sending offer to ${remotePeerId}`);
        ws.send(JSON.stringify({
            id: remotePeerId,
            type: 'offer',
            description: offer.sdp
        }));
    } catch (error) {
        console.log(`Error creating offer: ${error}`);
    }
}

function closePeerConnection(remotePeerId: string) {
    if (pcMap[remotePeerId]) {
        pcMap[remotePeerId].close();
        delete pcMap[remotePeerId];
        console.log(`Closed connection with ${remotePeerId}`);
    }
}

// Close all connections and websocket
function close() {
    console.log('Shutting down...');

    Object.keys(pcMap).forEach(remotePeerId => {
        closePeerConnection(remotePeerId);
    });

    if (ws)
        ws.close();

    console.log('WebRTC Agent closed');
    process.exit(0);
}

function readUserInput() {
    // Read Line Interface

    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
    });

    console.log('\nCommands:');
    console.log('- Enter peer ID to send offer');
    console.log('- Type "list" to show connected peers');
    console.log('- Type "quit" to exit');

    rl.question('> ', async (input) => {
        const command = input.trim();

        if (command === 'quit') {
            rl.close();
            close();
            return;
        }
        
        if (command === 'list') {
            console.log('Connected peers:', Object.keys(pcMap));
            rl.close();
            readUserInput();
            return;
        }
        
        if (command && command.length > 2) {
            console.log(`Offering to ${command}`);
            await createOffer(command);
        }
        else {
            console.log('Please enter a valid peer ID');
        }

        rl.close();
        readUserInput();
    });
}