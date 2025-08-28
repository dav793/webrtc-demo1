
# WebRTC demo

Tiny, minimal demo showing how to establish direct P2P (Peer-to-peer) connections between clients/private hosts behind NAT, using WebRTC. 

P2P connections between clients/private hosts require NAT traversal techniques that typical connections to public hosts do not.
Here, public STUN servers from Google are used to facilitate NAT mappings via which traffic can be sent to the private hosts.

The signaling server allows the clients to discover each other and initiate a direct data channel. Afterwards, the clients become peers and are able to transfer data with each other without the signaling server or the STUN servers sitting in the middle or knowing about it.

## Processes

This demo can run two types of processes; **signaling server** and **peer**. To properly test it, at least 3 total instances must be run remotely from each other. One instance must be a signaling server, and the rest should be peers. Initially, the peers only know the signaling server's public address, but they have no way to reach each other (unless they're in the same network). They use the signaling server to find and connect directly with each other and transfer data.

For both the peers and the signaling server, first you need to create your local .env file by copying the template provided and modifying it:
```bash
cp .env.template .env
nano .env
```

In unix systems, you should ensure `.env` has unix line endings or it won't work. If you run `cat -A .env` you should see something like this:
```bash
SIGNALING_SERVER_ADDR=18.206.213.59$
SIGNALING_SERVER_PORT=8091$
```
Carriage returns will display as `$` for unix line endings, or `^M$` for windows line endings. If you need to convert `.env` to unix line endings, you can use this command:
```bash
sed -i 's/\r$//' .env
```

### Signaling server

In `.env`, make sure to use your server's **private** IP address.

Build:
    ```
    npm run build
    ```

Then run:
* *Unix*:
    ```bash
    npm run serve:signal:unix
    ```
* *Windows*:
    ```cmd
    npm run serve:signal:win
    ```

### Peers

In `.env`, make sure to use your signaling server's **public** IP address.

Build:
    ```
    npm run build
    ```

Then run:
* *Unix*:
    ```bash
    npm run serve:peer:unix
    ```
* *Windows*:
    ```cmd
    npm run serve:peer:win
    ```

### Further reading
* [webrtcforthecurious.com](https://webrtcforthecurious.com/docs/01-what-why-and-how/)
* [node-datachannel](https://github.com/murat-dogan/node-datachannel/tree/d83ba00d80d8e665f4c61c94da19cad8c21a778c)
* [lib-datachannel (C/C++)](https://github.com/paullouisageneau/libdatachannel/tree/master)
* [RFC 4787](https://datatracker.ietf.org/doc/html/rfc4787)