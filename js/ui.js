export const DOM = {
    statusEl: document.getElementById('status'),
    myIdEl: document.getElementById('my-id'),
    copyIdBtn: document.getElementById('copy-id-btn'),
    remoteIdInput: document.getElementById('remote-id'),
    connectBtn: document.getElementById('connect-btn'),
    qrcodeEl: document.getElementById('qrcode'),
    textSection: document.getElementById('text-section'),
    textInput: document.getElementById('text-input'),
    sendTextBtn: document.getElementById('send-text-btn'),
    receivedTextEl: document.getElementById('received-text'),
    copyTextBtn: document.getElementById('copy-text-btn'),
    fileSection: document.getElementById('file-section'),
    dropZone: document.getElementById('drop-zone'),
    fileInput: document.getElementById('file-input'),
    transferInfo: document.getElementById('transfer-info'),
    queueStatus: document.getElementById('queue-status'),
    fileNameDisplay: document.getElementById('file-name-display'),
    progressBar: document.getElementById('progress-bar'),
    progressPercent: document.getElementById('progress-percent'),
    cancelTransferBtn: document.getElementById('cancel-transfer-btn'),
    refreshConnBtn: document.getElementById('refresh-conn-btn'),
    notificationBtn: document.getElementById('enable-notifications'),
    acceptOverlay: document.getElementById('accept-file-overlay'),
    incomingFileName: document.getElementById('incoming-file-name'),
    incomingFileSizeDisplay: document.getElementById('incoming-file-size-display'),
    acceptSaveBtn: document.getElementById('accept-save-btn'),
    declineFileBtn: document.getElementById('decline-file-btn')
};

export function updateStatus(stateStr, message) {
    DOM.statusEl.textContent = message;
    DOM.statusEl.className = `status-${stateStr}`;
    
    if (stateStr === 'disconnected') {
        DOM.refreshConnBtn.classList.remove('hidden');
    } else {
        DOM.refreshConnBtn.classList.add('hidden');
    }
}

export function enableFeatures(enabled) {
    if (enabled) {
        DOM.textSection.classList.remove('disabled');
        DOM.fileSection.classList.remove('disabled');
    } else {
        DOM.textSection.classList.add('disabled');
        DOM.fileSection.classList.add('disabled');
    }
}

export function displayReceivedText(text) {
    DOM.receivedTextEl.textContent = text;
    DOM.receivedTextEl.classList.remove('placeholder-box');
}

export function updateProgress(percent) {
    const rounded = Math.round(percent);
    DOM.progressBar.style.width = `${rounded}%`;
    DOM.progressPercent.textContent = `${rounded}%`;
}

export function updateQueueUI(count) {
    DOM.transferInfo.classList.remove('hidden');
    DOM.queueStatus.textContent = count > 1 ? `Queue: ${count} files remaining` : '';
}