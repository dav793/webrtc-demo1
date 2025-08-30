import readline from 'readline';
import { RTCPeerConnection, RTCDataChannel, RTCIceCandidate, RTCIceServer } from 'werift';
import WebSocket from 'ws';
import { customAlphabet } from 'nanoid';
const nanoid = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', 4);

interface PeerState {
    pc: RTCPeerConnection;
    pendingCandidates: any[];
    remoteDescriptionSet: boolean;
    connectionTimeout?: NodeJS.Timeout;
    isConnected: boolean;
    startTime: number;
    dataChannels: any;
}

export class WebRTCAgent {

    peerId = nanoid();
    private peers: { [peerId: string]: PeerState } = {};
    private ws: WebSocket;

    private readonly CONNECTION_TIMEOUT_MS = 30000;

    constructor() {}

    start() {
        console.log(`Local peer ID is ${this.peerId}`);

        this.peers = {};
        
        const addr = process.env.SIGNALING_SERVER_ADDR || 'localhost';
        const port = process.env.SIGNALING_SERVER_PORT || '8000';
        const url = `ws://${addr}:${port}/${this.peerId}`;
        this.ws = new WebSocket(url);
        console.log(`Connecting to signaling server on ws://${addr}:${port}...`);

        this.ws.on('open', () => {
            console.log(`Connection with signaling server established`);
            this.readUserInput();
        });

        this.ws.on('error', (err) => {
            console.log('WebSocket error. Verify your internet connection');
            console.log(err);
        });

        this.ws.on('close', () => {
            console.log(`Connection with signaling server lost`);
        });

        this.ws.on('message', async (data: WebSocket.Data) => {
            try {
                const msg = JSON.parse(data.toString());
                console.log(`Received message from ${msg.id} (${msg.type})`);
                // console.log(`Received message: ${msg}`);
                await this.handleMessage(msg);
            }
            catch (error) {
                console.log('Error parsing message');
                console.log(error);
            }
        });

        return this;
    }

    close() {
        console.log('WebRTC Agent is shutting down...');

        Object.keys(this.peers).forEach(peerId => {
            this.closePeerConnection(peerId);
        });

        if (this.ws)
            this.ws.close();

        console.log('WebRTC Agent closed');
    }

    private async handleMessage(msg: any) {
        switch (msg.type) {
            case 'offer':
                await this.handleOffer(msg);
                break;
            case 'answer':
                await this.handleAnswer(msg);
                break;
            case 'candidate':
                await this.handleCandidate(msg);
                break;
            default:
                console.warn(`Unknown message type: ${msg.type}`);
                break;
        }
    }

    private async createOffer(targetPeerId: string) {
        try {
            console.log(`Creating offer for ${targetPeerId}`);

            // close existing connection if any
            if (this.peers[targetPeerId]) {
                console.log(`Closing existing connection to ${targetPeerId}`);
                this.closePeerConnection(targetPeerId, 'creating new offer');
            }

            await this.createPeerConnection(targetPeerId);

            const peerState = this.peers[targetPeerId];
            const pc = peerState.pc;

            // Create a data channel
            const dataChannelName = 'messages';
            const dataChannel = pc.createDataChannel(dataChannelName, {
                ordered: true
            });
            peerState.dataChannels[dataChannelName] = dataChannel;

            dataChannel.onopen = () => {
                console.log(`DataChannel "${dataChannelName}" opened with ${targetPeerId}`);
                dataChannel.send(`Hello from ${this.peerId}`);
            };

            dataChannel.onmessage = (event) => {
                console.log(`Message from ${targetPeerId}: ${event.data}`);
            };

            dataChannel.onerror = (error) => {
                console.log(`DataChannel error: ${error}`);
            };

            dataChannel.onclose = () => {
                delete peerState.dataChannels[dataChannelName];
                console.log(`DataChannel closed for ${targetPeerId}`);
            };

            // Create and send offer
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);

            console.log(`Sending offer to ${targetPeerId}`);
            this.ws.send(JSON.stringify({
                id: targetPeerId,
                type: 'offer',
                description: offer.sdp
            }));

            console.log(`Connection attempt stats for ${targetPeerId}: ${this.getConnectionStats(targetPeerId)}`);
        }
        catch (error) {
            console.log(`Error creating offer: ${error}`);
            this.closePeerConnection(targetPeerId, 'offer creation failed');
        }
    }

    private async createPeerConnection(targetPeerId: string) {
        console.log(`Creating peer connection for ${targetPeerId}`);

        // it may take some time to go through all the servers and wait for the ones that don't respond (~30s in my testing.)
        // when testing on your local environment you may want to comment out some of the servers to make it connect faster 
        const iceServers: RTCIceServer[] = [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun.l.google.com:5349' },
            { urls: 'stun:stun1.l.google.com:3478' },
            { urls: 'stun:stun1.l.google.com:5349' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:5349' },
            { urls: 'stun:stun3.l.google.com:3478' },
            { urls: 'stun:stun3.l.google.com:5349' },
            { urls: 'stun:stun4.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:5349' },

            // TURN servers for NAT traversal
            // these ones are free to use but very slow to respond
            {
                urls: 'turn:openrelay.metered.ca:80',
                username: 'openrelayproject',
                credential: 'openrelayproject'
            },
            {
                urls: 'turn:openrelay.metered.ca:443',
                username: 'openrelayproject', 
                credential: 'openrelayproject'
            }
        ];
        const pc = new RTCPeerConnection({ iceServers });

        // Initialize peer state
        const peerState: PeerState = {
            pc,
            pendingCandidates: [],
            remoteDescriptionSet: false,
            isConnected: false,
            startTime: Date.now(),
            dataChannels: {}
        };

        this.setupConnectionTimeout(targetPeerId, peerState);

        // Handle connection state changes
        pc.onconnectionstatechange = () => {
            const duration = Date.now() - peerState.startTime;
            console.log(`[${targetPeerId}] Connection State: ${pc.connectionState} (after ${duration}ms)`);

            if (pc.connectionState === 'connected') {
                peerState.isConnected = true;
                // clear timeout since connection succeeded
                if (peerState.connectionTimeout) {
                    clearTimeout(peerState.connectionTimeout);
                    peerState.connectionTimeout = undefined;
                }
                console.log(`Connected to ${targetPeerId} in ${duration}ms`);
            }
            else if (pc.connectionState === 'failed') {
                console.log(`Connection to ${targetPeerId} failed after ${duration}ms`);
                this.closePeerConnection(targetPeerId, 'connection failed');
            }
            else if (pc.connectionState === 'disconnected') {
                console.log(`Connection to ${targetPeerId} disconnected after ${duration}ms`);
                this.closePeerConnection(targetPeerId, 'disconnected');
            }
        };

        // Handle ICE connection state changes
        pc.oniceconnectionstatechange = () => {
            const duration = Date.now() - peerState.startTime;
            console.log(`[${targetPeerId}] ICE Connection State: ${pc.iceConnectionState} (after ${duration}ms)`);

            if (pc.iceConnectionState === 'failed') {
                console.log(`ICE connection failed for ${targetPeerId} after ${duration}ms, restarting ICE`);
                try {
                    pc.restartIce();
                } catch (error) {
                    console.log(`ICE restart failed: ${error}`);
                    this.closePeerConnection(targetPeerId, 'ICE restart failed');
                }
            }
        };

        // Handle ICE gathering state changes
        pc.onicegatheringstatechange = () => {
            console.log(`[${targetPeerId}] ICE Gathering State: ${pc.iceGatheringState}`);
        };

        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                console.log(`Sending ICE candidate to ${targetPeerId}`);
                this.ws.send(JSON.stringify({
                    id: targetPeerId,   // Target peer ID
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
            peerState.dataChannels[channel.label] = channel;
            // console.log(`DataChannel from ${targetPeerId} received with label "${channel.label}"`);
            
            channel.onopen = () => {
                console.log(`DataChannel "${channel.label}" opened`);
                channel.send(`Hello From ${this.peerId}`);
            };

            channel.onmessage = (event) => {
                console.log(`Message from ${targetPeerId} received: ${event.data}`);
            };

            channel.onclose = () => {
                delete peerState.dataChannels[channel.label];
                console.log(`DataChannel "${channel.label}" closed`);
            };

            channel.onerror = (error) => {
                console.log(`DataChannel error: ${error}`);
            };
        };

        this.peers[targetPeerId] = peerState;
        return pc;
    }

    private setupConnectionTimeout(targetPeerId: string, peerState: PeerState) {
        peerState.connectionTimeout = setTimeout(() => {
            const duration = Date.now() - peerState.startTime;

            if (!peerState.isConnected) {
                console.log(`Connection timeout for ${targetPeerId} after ${duration}ms`);
                this.closePeerConnection(targetPeerId, 'connection timeout');
            }
        }, this.CONNECTION_TIMEOUT_MS);
    }

    private getConnectionStats(targetPeerId: string): string {
        const peerState = this.peers[targetPeerId];
        if (!peerState) return 'No connection';
        
        const duration = Date.now() - peerState.startTime;
        const pc = peerState.pc;
        
        return `Duration: ${duration}ms, Connection: ${pc.connectionState}, ICE: ${pc.iceConnectionState}`;
    }

    private closePeerConnection(targetPeerId: string, reason?: string) {
        const peerState = this.peers[targetPeerId];
        if (peerState) {
            // clear timeout if exists
            if (peerState.connectionTimeout)
                clearTimeout(peerState.connectionTimeout);

            peerState.pc.close();
            delete this.peers[targetPeerId];

            const reasonText = reason ? ` (${reason})` : '';
            console.log(`Closed connection with ${targetPeerId}${reasonText}`);
        }
    }

    // retry connection with exponential backoff
    private async retryConnection(targetPeerId: string, attempt: number = 1, maxRetries: number = 3) {
        if (attempt > maxRetries) {
            console.log(`Max retry attempts (${maxRetries}) reached for ${targetPeerId}`);
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Max 10s delay
        console.log(`Retrying connection to ${targetPeerId} in ${delay}ms (attempt ${attempt}/${maxRetries})`);
        
        setTimeout(async () => {
            try {
                await this.createOffer(targetPeerId);
            }
            catch (error) {
                console.log(`Retry ${attempt} failed for ${targetPeerId}: ${error}`);
                this.retryConnection(targetPeerId, attempt + 1, maxRetries);
            }
        }, delay);
    }

    private async handleOffer(msg: any) {
        try {
            console.log(`Handling offer from ${msg.id}`);
    
            // close existing connection if any
            if (this.peers[msg.id]) {
                console.log(`Closing existing connection to ${msg.id} to handle new offer`);
                this.closePeerConnection(msg.id, 'handling new offer');
            }

            await this.createPeerConnection(msg.id);
            const peerState = this.peers[msg.id];
            const pc = peerState.pc;

            await pc.setRemoteDescription({ type: 'offer', sdp: msg.description });
            peerState.remoteDescriptionSet = true;

            // process any pending candidates
            for (const candidate of peerState.pendingCandidates) {
                await pc.addIceCandidate(new RTCIceCandidate(candidate));
                console.log(`Added buffered ICE candidate from ${msg.id}`);
            }
            peerState.pendingCandidates = [];

            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);

            console.log(`Sending answer to ${msg.id}`);
            this.ws.send(JSON.stringify({
                id: msg.id,
                type: 'answer',
                description: answer.sdp
            }));

            // Log connection attempt stats
            console.log(`Connection attempt stats for ${msg.id}: ${this.getConnectionStats(msg.id)}`);
        } catch (error) {
            console.log(`Error handling offer from ${msg.id}: ${error}`);
            this.closePeerConnection(msg.id, 'offer handling failed');
        }
    }

    private async handleAnswer(msg: any) {
        try {
            console.log(`Handling answer from ${msg.id}`);
    
            const peerState = this.peers[msg.id];
            if (peerState) {
                const pc = peerState.pc;
                await pc.setRemoteDescription({ type: 'answer', sdp: msg.description });
                peerState.remoteDescriptionSet = true;

                // Process any pending candidates
                for (const candidate of peerState.pendingCandidates) {
                    await pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`Added buffered ICE candidate from ${msg.id}`);
                }
                peerState.pendingCandidates = [];
            }
            else {
                console.log(`No peer connection found for ${msg.id}`);
            }
        } catch (error) {
            console.log(`Error handling answer: ${error}`);
        }
    }

    private async handleCandidate(msg: any) {
        try {
            // console.log(`Handling candidate from ${msg.id}`);

            const peerState = this.peers[msg.id];
            if (peerState) {
                const candidate = {
                    candidate: msg.candidate,
                    sdpMLineIndex: msg.sdpMLineIndex,
                    sdpMid: msg.sdpMid
                };

                if (peerState.remoteDescriptionSet) {
                    // remote description is set, add candidate immediately
                    await peerState.pc.addIceCandidate(new RTCIceCandidate(candidate));
                    console.log(`Added ICE candidate from ${msg.id}`);
                } else {
                    // buffer the candidate until remote description is set
                    peerState.pendingCandidates.push(candidate);
                    console.log(`Buffered ICE candidate from ${msg.id}`);
                }
            }
            else {
                console.log(`No peer connection found for ${msg.id}`);
            }
        } catch (error) {
            console.log(`Error handling candidate: ${error}`);
        }
    }

    private sendMessageToPeer(targetPeerId: string, message: string) {
        const peerState = this.peers[targetPeerId];
        if (!peerState) {
            console.log(`No peer connection found for ${targetPeerId}`);
            return;
        }

        const channel = peerState.dataChannels['messages'];
        if (!channel) {
            console.log(`Data channel "messages" not found for ${targetPeerId}`);
            return;
        }

        channel.send(message);
    }

    readUserInput() {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });

        const showHelp = () => {
            console.log('\n========= Available Commands =========');
            console.log('  <peerId>         - Send offer to peer');
            console.log('  status           - Show all connection statuses');
            console.log('  send <id> <msg>  - Close specific connection')
            console.log('  close <id>       - Close specific connection');
            console.log('  retry <id>       - Retry connection to peer');
            console.log('  help             - Show this help');
            console.log('  quit             - Exit application');
            console.log('======================================\n');
        };

        rl.question('\nEnter command (type "help" for options): ', async (input) => {
            const parts = input.trim().split(' ');
            const command = parts[0].toLowerCase();
            const arg = parts[1];
            const arg2 = parts[2];

            switch (command) {
                case 'help':
                    showHelp();
                    break;
                    
                case 'status':
                    console.log('\n========= Connection Status =========');
                    const peerIds = Object.keys(this.peers);
                    if (peerIds.length === 0) {
                        console.log('No active connections');
                    } else {
                        peerIds.forEach(peerId => {
                            console.log(`${peerId}: ${this.getConnectionStats(peerId)}`);
                        });
                    }
                    console.log('======================================\n');
                    break;
                    
                case 'send':
                    if (arg && arg2 && this.peers[arg]) {
                        console.log(`Sending message to ${parts[1]}`);
                        this.sendMessageToPeer(arg, arg2);
                    }
                    else {
                        console.log('Please specify a valid peer ID and message');
                    }
                    break;

                case 'close':
                    if (arg && this.peers[arg]) {
                        this.closePeerConnection(arg, 'user requested');
                        console.log(`Closed connection to ${arg}`);
                    } else {
                        console.log('Please specify a valid peer ID');
                    }
                    break;
                    
                case 'retry':
                    if (arg) {
                        console.log(`Retrying connection to ${arg}`);
                        await this.retryConnection(arg);
                    } else {
                        console.log('Please specify a peer ID to retry');
                    }
                    break;
                    
                case 'quit':
                case 'exit':
                    console.log('Shutting down...');
                    this.close();
                    rl.close();
                    process.exit(0);
                    return;
                    
                default:
                    if (command && command.length > 2) {
                        console.log(`Offering to ${parts[0]}`);
                        await this.createOffer(parts[0]);
                    } else {
                        console.log('Invalid command. Type "help" for available options.');
                    }
                    break;
            }

            rl.close();
            this.readUserInput();
        });
    }
}

const webRtcAgent = new WebRTCAgent().start();
