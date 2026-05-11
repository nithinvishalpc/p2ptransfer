# S3ndit - Serverless P2P Transfer

A purely static, browser-based application that enables real-time, peer-to-peer (P2P) transfer of text and files between devices. No servers, no logs, just direct communication.

## 🚀 Overview

This application provides a zero-install, locally routed transfer mechanism that requires no proprietary backend server for data hosting. It prioritizes privacy and speed by leveraging WebRTC for direct device-to-device communication.

**Live Demo:** [Link to your GitHub Pages URL]

## ✨ Key Features

-   **Zero Backend:** Hosted entirely on GitHub Pages as static files.
-   **True P2P:** Data moves directly between browsers, never touching a central server.
-   **Secure:** All transfers are encrypted end-to-end natively by WebRTC.
-   **Universal Pairing:**
    -   Manual Peer ID entry.
    -   QR Code scanning for quick mobile-to-desktop pairing.
-   **Text Transfer:** Instant text sharing with a one-click copy feature.
-   **Large File Support:** Uses advanced chunking and reassembly to transfer files up to 1GB+ (limited only by device RAM).
-   **No Data Retention:** No logs, history, or files are stored after the session is closed.

## 🛠️ Technical Architecture

-   **Frontend:** Vanilla HTML5, CSS3, and JavaScript.
-   **Signaling:** [PeerJS Public Cloud](https://peerjs.com/) (strictly for initial handshake and device discovery).
-   **Data Transport:** WebRTC `RTCDataChannel` for direct peer communication.
-   **QR Generation:** [QRCode.js](https://davidshimjs.github.io/qrcodejs/) for client-side QR generation.

### How it Works
1.  **Discovery:** Device A generates a unique Peer ID and registers with the PeerJS signaling server.
2.  **Handshake:** Device B enters Device A's ID. The signaling server helps them exchange "offers" and "answers" (WebRTC metadata).
3.  **Direct Link:** Once the handshake is complete, the signaling server is no longer involved. A direct encrypted tunnel is established between the two browsers.
4.  **Transfer:** Files are sliced into 16KB chunks, sent across the tunnel, and reassembled in the recipient's browser memory.

## 📦 Deployment

Since the app is purely static, you can host it anywhere for free.

### GitHub Pages (Recommended)
1.  Fork this repository.
2.  Go to **Settings > Pages**.
3.  Select the `main` branch and `/ (root)` folder as the source.
4.  Click **Save**. Your app will be live at `https://<username>.github.io/<repo-name>/`.

### Local Development
Simply clone the repo and open `index.html` in any modern browser:
```bash
git clone https://github.com/yourusername/p2p-transfer.git
cd p2p-transfer
# Open index.html in your browser
```

## 📋 Requirements

-   **Browser:** Modern versions of Chrome, Firefox, Safari, or Edge.
-   **HTTPS:** Secure browser APIs like WebRTC and the Clipboard API require an HTTPS context (automatically handled by GitHub Pages and `localhost`).

## 🛡️ Privacy & Security

-   **No Payload Logging:** The signaling server only sees connection metadata, never your files or text.
-   **Encryption:** Data is encrypted using DTLS (Datagram Transport Layer Security) and SRTP (Secure Real-time Transport Protocol).
-   **Volatile Storage:** All received data is stored in temporary browser memory (Blobs) and is wiped upon page refresh.

## 📄 License

MIT License - feel free to use, modify, and distribute!
