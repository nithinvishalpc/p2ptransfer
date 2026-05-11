import { state } from './js/state.js';
import { DOM } from './js/ui.js';
import { initPeer, refreshConnection, setupConnection } from './js/peer.js';
import { sendText, handleFileSelect, cancelTransfer, acceptFile, declineFile } from './js/transfer.js';

// Event Listeners
DOM.copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(DOM.myIdEl.textContent);
    const originalText = DOM.copyIdBtn.textContent;
    DOM.copyIdBtn.textContent = '✅';
    setTimeout(() => { DOM.copyIdBtn.textContent = originalText; }, 2000);
});

DOM.connectBtn.addEventListener('click', () => {
    const remoteId = DOM.remoteIdInput.value.trim().toUpperCase();
    if (remoteId && !state.conn) {
        if (remoteId === state.peer.id) {
            alert("Cannot connect to yourself.");
            return;
        }
        const connection = state.peer.connect(remoteId, { reliable: true });
        setupConnection(connection);
    } else if (state.conn?.open) {
        alert("Already connected");
    }
});

DOM.sendTextBtn.addEventListener('click', sendText);

DOM.copyTextBtn.addEventListener('click', () => {
    const text = DOM.receivedTextEl.textContent;
    if (text && text !== 'No text received yet.') {
        navigator.clipboard.writeText(text);
        const originalText = DOM.copyTextBtn.textContent;
        DOM.copyTextBtn.textContent = 'Copied!';
        setTimeout(() => { DOM.copyTextBtn.textContent = originalText; }, 2000);
    }
});

DOM.notificationBtn.addEventListener('click', () => {
    Notification.requestPermission().then(permission => {
        if (permission === "granted") {
            DOM.notificationBtn.classList.add('hidden');
        }
    });
});

DOM.acceptSaveBtn.addEventListener('click', acceptFile);
DOM.declineFileBtn.addEventListener('click', declineFile);
DOM.cancelTransferBtn.addEventListener('click', cancelTransfer);
DOM.refreshConnBtn.addEventListener('click', refreshConnection);

DOM.dropZone.addEventListener('click', () => DOM.fileInput.click());
DOM.fileInput.addEventListener('change', handleFileSelect);

DOM.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.add('dragover');
});

DOM.dropZone.addEventListener('dragleave', () => {
    DOM.dropZone.classList.remove('dragover');
});

DOM.dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    DOM.dropZone.classList.remove('dragover');
    handleFileSelect(e);
});

// Start initialization
initPeer();