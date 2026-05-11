// DOM Elements
const statusEl = document.getElementById('status');
const myIdEl = document.getElementById('my-id');
const copyIdBtn = document.getElementById('copy-id-btn');
const remoteIdInput = document.getElementById('remote-id');
const connectBtn = document.getElementById('connect-btn');
const qrcodeEl = document.getElementById('qrcode');

const textSection = document.getElementById('text-section');
const textInput = document.getElementById('text-input');
const sendTextBtn = document.getElementById('send-text-btn');
const receivedTextEl = document.getElementById('received-text');
const copyTextBtn = document.getElementById('copy-text-btn');

const fileSection = document.getElementById('file-section');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const transferInfo = document.getElementById('transfer-info');
const queueStatus = document.getElementById('queue-status');
const fileNameDisplay = document.getElementById('file-name-display');
const progressBar = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const cancelTransferBtn = document.getElementById('cancel-transfer-btn');

// PeerJS Instance
let peer = null;
let conn = null;
let wakeLock = null;

// File Transfer State
const CHUNK_SIZE = 65536; // 64KB chunks
const BUFFER_THRESHOLD = 1048576; // 1MB high water mark
let fileQueue = [];
let isTransferring = false;
let isCancelled = false;
let receivingFile = {
    name: '',
    size: 0,
    totalChunks: 0,
    chunksReceived: 0,
    data: []
};

// Initialize Peer
function initPeer() {
    const randomId = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    peer = new Peer(randomId, {
        debug: 2
    });

    peer.on('open', (id) => {
        myIdEl.textContent = id;
        generateQRCode(id);
        updateStatus('waiting', 'Waiting for connection...');
        
        const hashId = window.location.hash.substring(1);
        if (hashId && hashId !== id) {
            remoteIdInput.value = hashId;
            setTimeout(() => connectBtn.click(), 500);
        }
    });

    peer.on('connection', (connection) => {
        if (conn) {
            connection.close();
            return;
        }
        setupConnection(connection);
    });

    peer.on('error', (err) => {
        console.error('Peer error:', err);
        updateStatus('disconnected', `Error: ${err.type}`);
    });

    peer.on('disconnected', () => {
        updateStatus('disconnected', 'Disconnected from signaling server.');
    });

    // Re-request wake lock if tab becomes visible again
    document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
            await requestWakeLock();
        }
    });
}

// Generate QR Code
function generateQRCode(id) {
    qrcodeEl.innerHTML = '';
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    new QRCode(qrcodeEl, {
        text: url,
        width: 128,
        height: 128
    });
}

// Setup Connection
function setupConnection(connection) {
    conn = connection;

    conn.on('open', () => {
        updateStatus('connected', 'Connected');
        enableFeatures(true);
    });

    conn.on('data', (data) => {
        handleIncomingData(data);
    });

    conn.on('close', () => {
        updateStatus('disconnected', 'Connection closed');
        enableFeatures(false);
        conn = null;
        cancelTransfer();
    });

    conn.on('error', (err) => {
        console.error('Connection error:', err);
        updateStatus('disconnected', 'Connection error');
    });
}

// Handle Incoming Data
function handleIncomingData(data) {
    if (typeof data === 'object') {
        if (data.type === 'text') {
            displayReceivedText(data.content);
        } else if (data.type === 'file-metadata') {
            handleFileMetadata(data);
        } else if (data.type === 'file-chunk') {
            handleFileChunk(data);
        } else if (data.type === 'transfer-cancelled') {
            handleTransferCancelled();
        }
    }
}

// UI State Management
function updateStatus(state, message) {
    statusEl.textContent = message;
    statusEl.className = `status-${state}`;
}

function enableFeatures(enabled) {
    if (enabled) {
        textSection.classList.remove('disabled');
        fileSection.classList.remove('disabled');
    } else {
        textSection.classList.add('disabled');
        fileSection.classList.add('disabled');
    }
}

async function requestWakeLock() {
    try {
        if ('wakeLock' in navigator) {
            wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock failed:', err);
    }
}

function releaseWakeLock() {
    if (wakeLock) {
        wakeLock.release().then(() => {
            wakeLock = null;
        });
    }
}

// Text Transfer Logic
function sendText() {
    const text = textInput.value.trim();
    if (text && conn && conn.open) {
        conn.send({
            type: 'text',
            content: text
        });
        textInput.value = '';
    }
}

function displayReceivedText(text) {
    receivedTextEl.textContent = text;
    receivedTextEl.classList.remove('placeholder-box');
}

// File Transfer Logic
function handleFileSelect(e) {
    const files = e.target.files || e.dataTransfer.files;
    if (files.length > 0 && conn && conn.open) {
        for (let i = 0; i < files.length; i++) {
            fileQueue.push(files[i]);
        }
        if (!isTransferring) {
            processQueue();
        }
    }
}

async function processQueue() {
    isTransferring = true;
    isCancelled = false;
    await requestWakeLock();

    while (fileQueue.length > 0 && !isCancelled) {
        const file = fileQueue.shift();
        const totalInQueue = fileQueue.length;
        updateQueueUI(totalInQueue + 1);
        await sendFile(file);
    }

    isTransferring = false;
    transferInfo.classList.add('hidden');
    releaseWakeLock();
    
    if (!isCancelled && !fileQueue.length) {
        alert('File(s) sent successfully!');
    }
}

function updateQueueUI(count) {
    transferInfo.classList.remove('hidden');
    queueStatus.textContent = count > 1 ? `Queue: ${count} files remaining` : '';
}

async function sendFile(file) {
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    fileNameDisplay.textContent = `Sending: ${file.name}`;
    updateProgress(0);

    conn.send({
        type: 'file-metadata',
        name: file.name,
        size: file.size,
        totalChunks: totalChunks
    });

    const dataChannel = conn.dataChannel;

    for (let i = 0; i < totalChunks; i++) {
        if (isCancelled) break;

        const start = i * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunk = file.slice(start, end);
        const buffer = await chunk.arrayBuffer();

        // Dynamic Flow Control using bufferedAmount
        while (dataChannel.bufferedAmount > BUFFER_THRESHOLD) {
            await new Promise(r => setTimeout(r, 50));
            if (isCancelled) break;
        }

        if (isCancelled) break;

        conn.send({
            type: 'file-chunk',
            index: i,
            data: buffer
        });

        if (i % 5 === 0 || i === totalChunks - 1) {
            updateProgress(((i + 1) / totalChunks) * 100);
        }
    }
}

async function handleFileMetadata(metadata) {
    receivingFile = {
        name: metadata.name,
        size: metadata.size,
        totalChunks: metadata.totalChunks,
        chunksReceived: 0,
        data: new Array(metadata.totalChunks)
    };

    transferInfo.classList.remove('hidden');
    queueStatus.textContent = 'Receiving...';
    fileNameDisplay.textContent = metadata.name;
    updateProgress(0);
    await requestWakeLock();
}

function handleFileChunk(chunk) {
    if (!receivingFile.name) return;

    receivingFile.data[chunk.index] = chunk.data;
    receivingFile.chunksReceived++;

    if (receivingFile.chunksReceived % 5 === 0 || receivingFile.chunksReceived === receivingFile.totalChunks) {
        const progress = (receivingFile.chunksReceived / receivingFile.totalChunks) * 100;
        updateProgress(progress);
    }

    if (receivingFile.chunksReceived === receivingFile.totalChunks) {
        assembleAndDownloadFile();
    }
}

function handleTransferCancelled() {
    receivingFile = { name: '', size: 0, totalChunks: 0, chunksReceived: 0, data: [] };
    transferInfo.classList.add('hidden');
    fileQueue = [];
    isTransferring = false;
    releaseWakeLock();
    alert('Peer cancelled the transfer.');
}

function cancelTransfer() {
    isCancelled = true;
    fileQueue = [];
    if (conn && conn.open) {
        conn.send({ type: 'transfer-cancelled' });
    }
    transferInfo.classList.add('hidden');
    releaseWakeLock();
}

function assembleAndDownloadFile() {
    const blob = new Blob(receivingFile.data);
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = receivingFile.name;
    a.click();
    
    URL.revokeObjectURL(url);
    
    setTimeout(() => {
        transferInfo.classList.add('hidden');
        receivingFile = { name: '', size: 0, totalChunks: 0, chunksReceived: 0, data: [] };
        releaseWakeLock();
    }, 1000);
}

function updateProgress(percent) {
    const rounded = Math.round(percent);
    progressBar.style.width = `${rounded}%`;
    progressPercent.textContent = `${rounded}%`;
}

// Event Listeners
copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(myIdEl.textContent);
    const originalText = copyIdBtn.textContent;
    copyIdBtn.textContent = '✅';
    setTimeout(() => copyIdBtn.textContent = originalText, 2000);
});

connectBtn.addEventListener('click', () => {
    const remoteId = remoteIdInput.value.trim().toUpperCase();
    if (remoteId && !conn) {
        const connection = peer.connect(remoteId, { reliable: true });
        setupConnection(connection);
    }
});

sendTextBtn.addEventListener('click', sendText);

copyTextBtn.addEventListener('click', () => {
    const text = receivedTextEl.textContent;
    if (text && text !== 'No text received yet.') {
        navigator.clipboard.writeText(text);
        const originalText = copyTextBtn.textContent;
        copyTextBtn.textContent = 'Copied!';
        setTimeout(() => copyTextBtn.textContent = originalText, 2000);
    }
});

cancelTransferBtn.addEventListener('click', cancelTransfer);

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('dragover');
});

dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('dragover');
});

dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('dragover');
    handleFileSelect(e);
});

// Start initialization
initPeer();
