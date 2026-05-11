import { state } from './state.js';
import { DOM, updateStatus, enableFeatures, displayReceivedText } from './ui.js';
import { generateQRCode, requestWakeLock } from './utils.js';
import { handleFileChunk, handleFileMetadata, handleTransferCancelled, cancelTransfer, handleFileAck } from './transfer.js';
import { MSG } from './constants.js';

export function initPeer() {
    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // eslint-disable-next-line no-undef
    state.peer = new Peer(randomId, {
        debug: 2
    });

    state.peer.on('open', (id) => {
        DOM.myIdEl.textContent = id;
        generateQRCode(id, DOM.qrcodeEl);
        updateStatus('waiting', 'Waiting for connection...');
        
        const hashId = window.location.hash.substring(1);
        if (hashId && hashId !== id) {
            DOM.remoteIdInput.value = hashId;
            setTimeout(() => DOM.connectBtn.click(), 500);
        }

        if ("Notification" in window && Notification.permission === "default") {
            DOM.notificationBtn.classList.remove('hidden');
        }
    });

    state.peer.on('connection', (connection) => {
        if (state.conn) {
            connection.close();
            return;
        }
        setupConnection(connection);
    });

    state.peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('disconnected', `Error: ${err.type}`);
    });

    state.peer.on('disconnected', () => {
        updateStatus('waiting', 'Reconnecting to signaling server...');
        setTimeout(() => {
            if (state.peer && !state.peer.destroyed) {
                state.peer.reconnect();
            }
        }, 1000);
    });

    // Re-request wake lock if tab becomes visible again
    document.addEventListener('visibilitychange', async () => {
        if (state.wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock(state);
        }
    });
}

export function setupConnection(connection) {
    state.conn = connection;

    state.conn.on('open', () => {
        updateStatus('connected', 'Connected');
        enableFeatures(true);

        if (window.location.hash) {
            history.replaceState(null, null, ' ');
        }
    });

    state.conn.on('data', (data) => {
        handleIncomingData(data);
    });

    state.conn.on('close', () => {
        updateStatus('disconnected', 'Connection closed');
        enableFeatures(false);
        state.conn = null;
        cancelTransfer();
    });

    state.conn.on('error', (err) => {
        console.error('Connection error:', err);
        updateStatus('disconnected', 'Connection error');
    });
}

function handleIncomingData(data) {
    if (data instanceof ArrayBuffer) {
        handleFileChunk(data);
        return;
    }

    if (typeof data === 'object') {
        if (data.type === MSG.TEXT) {
            displayReceivedText(data.content);
        } else if (data.type === MSG.FILE_META) {
            handleFileMetadata(data);
        } else if (data.type === MSG.FILE_ACK) {
            handleFileAck();
        } else if (data.type === MSG.FILE_COMPLETE) {
            // Optional: receiver acknowledged full receipt.
            console.log("Peer confirmed file completion");
        } else if (data.type === MSG.TRANSFER_CANCEL) {
            handleTransferCancelled();
        }
    }
}

export function refreshConnection() {
    if (state.peer) {
        state.peer.destroy();
    }
    DOM.remoteIdInput.value = '';
    initPeer();
}