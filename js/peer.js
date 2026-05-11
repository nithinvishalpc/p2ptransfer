import { state } from './state.js';
import { DOM, updateStatus, enableFeatures, displayReceivedText, showToast } from './ui.js';
import { generateQRCode, requestWakeLock } from './utils.js';
import { handleFileChunk, handleFileStart, handleTransferCancelled, cancelTransfer, handleFileAccept, handleChunkAck, handleResumeRequest, handleFileComplete } from './transfer.js';
import { MSG } from './constants.js';

let visibilityListenerRegistered = false;

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
        if (state.conn && (state.pendingConnection || state.conn.open)) {
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
    if (!visibilityListenerRegistered) {
        visibilityListenerRegistered = true;
        document.addEventListener('visibilitychange', async () => {
            if (state.wakeLock !== null && document.visibilityState === 'visible') {
                await requestWakeLock(state);
            }
        });
    }
}

export function setupConnection(connection) {
    state.conn = connection;
    state.pendingConnection = true;

    state.conn.on('open', () => {
        state.pendingConnection = false;
        updateStatus('connected', 'Connected');
        enableFeatures(true);

        if (window.location.hash) {
            history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
        }
    });

    state.conn.on('data', (data) => {
        handleIncomingData(data);
    });

    state.conn.on('close', () => {
        state.pendingConnection = false;
        updateStatus('disconnected', 'Connection closed');
        enableFeatures(false);
        state.conn = null;
        cancelTransfer();
    });

    state.conn.on('error', (err) => {
        state.pendingConnection = false;
        console.error('Connection error:', err);
        updateStatus('disconnected', 'Connection error');
        cancelTransfer('Connection error.');
    });
}

function handleIncomingData(data) {
    if (data && typeof data === 'object') {
        if (data.type === MSG.TEXT) {
            displayReceivedText(data.content);
        } else if (data.type === MSG.FILE_START) {
            handleFileStart(data);
        } else if (data.type === MSG.FILE_ACCEPT) {
            handleFileAccept(data);
        } else if (data.type === MSG.FILE_CHUNK) {
            handleFileChunk(data);
        } else if (data.type === MSG.CHUNK_ACK) {
            handleChunkAck(data);
        } else if (data.type === MSG.FILE_COMPLETE) {
            showToast('Peer confirmed completion');
            handleFileComplete(data);
        } else if (data.type === MSG.FILE_RESUME_REQUEST) {
            handleResumeRequest(data);
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
