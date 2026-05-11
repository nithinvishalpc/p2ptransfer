import { state, resetReceivingFile } from './state.js';
import { DOM, updateProgress, updateQueueUI } from './ui.js';
import { MSG, TRANSFER } from './constants.js';
import { showNotification, requestWakeLock, releaseWakeLock, formatBytes, calculateHash } from './utils.js';

export function sendText() {
    const text = DOM.textInput.value.trim();
    if (text && state.conn && state.conn.open) {
        state.conn.send({
            type: MSG.TEXT,
            content: text
        });
        DOM.textInput.value = '';
    }
}

export function handleFileSelect(e) {
    const files = e.target.files || e.dataTransfer.files;
    if (files.length > 0 && state.conn && state.conn.open) {
        for (let i = 0; i < files.length; i++) {
            state.fileQueue.push(files[i]);
        }
        if (!state.isTransferring) {
            processQueue();
        }
    }
}

export async function processQueue() {
    state.isTransferring = true;
    state.isCancelled = false;
    await requestWakeLock(state);

    while (state.fileQueue.length > 0 && !state.isCancelled) {
        const file = state.fileQueue.shift();
        updateQueueUI(state.fileQueue.length + 1);
        await sendFile(file);
    }

    state.isTransferring = false;
    DOM.transferInfo.classList.add('hidden');
    releaseWakeLock(state);
    
    if (!state.isCancelled && !state.fileQueue.length) {
        showNotification("All Sent", { body: "All files transferred successfully." });
        alert('File(s) sent successfully!');
    }
}

// Custom promise wrapper to wait for receiver's accept
let acceptPromiseResolve = null;
export function handleFileAck() {
    if (acceptPromiseResolve) {
        acceptPromiseResolve();
        acceptPromiseResolve = null;
    }
}

async function sendFile(file) {
    DOM.fileNameDisplay.textContent = `Sending: ${file.name}`;
    updateProgress(0);

    let expectedHash = null;
    if (file.size < 500 * 1024 * 1024) {
        DOM.fileNameDisplay.textContent = `Calculating Hash: ${file.name}...`;
        expectedHash = await calculateHash(file);
    }
    DOM.fileNameDisplay.textContent = `Sending: ${file.name}`;

    const transferId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString();
    const totalChunks = Math.ceil(file.size / TRANSFER.CHUNK_SIZE);

    state.conn.send({
        type: MSG.FILE_META,
        transferId,
        name: file.name,
        size: file.size,
        totalChunks,
        expectedHash
    });

    await new Promise(resolve => { acceptPromiseResolve = resolve; });

    if (state.isCancelled) return;

    const dataChannel = state.conn.dataChannel;
    dataChannel.bufferedAmountLowThreshold = TRANSFER.BUFFER_THRESHOLD / 2;

    const stream = file.stream();
    const reader = stream.getReader();
    let bytesRead = 0;
    let chunkIndex = 0;

    while (true) {
        if (state.isCancelled) break;

        if (dataChannel.bufferedAmount > TRANSFER.BUFFER_THRESHOLD) {
            await new Promise(resolve => {
                dataChannel.onbufferedamountlow = () => {
                    dataChannel.onbufferedamountlow = null;
                    resolve();
                };
            });
        }

        if (state.isCancelled) break;

        const { done, value } = await reader.read();
        
        if (done) break;

        let offset = 0;
        while (offset < value.length) {
            if (state.isCancelled) break;
            const end = Math.min(offset + TRANSFER.CHUNK_SIZE, value.length);
            const slice = value.slice(offset, end);
            
            while (dataChannel.bufferedAmount > TRANSFER.BUFFER_THRESHOLD) {
                await new Promise(resolve => {
                    dataChannel.onbufferedamountlow = () => {
                        dataChannel.onbufferedamountlow = null;
                        resolve();
                    };
                });
            }

            state.conn.send(slice.buffer || slice);
            bytesRead += slice.length;
            offset = end;
            chunkIndex++;

            if (chunkIndex % 20 === 0) {
                updateProgress((bytesRead / file.size) * 100);
            }
        }
    }
    
    if (!state.isCancelled) {
        updateProgress(100);
    }
}

export async function handleFileMetadata(metadata) {
    state.receivingFile = {
        name: metadata.name,
        size: metadata.size,
        totalChunks: metadata.totalChunks,
        bytesReceived: 0,
        data: [],
        fileWriter: null,
        isStreaming: false,
        expectedHash: metadata.expectedHash,
        transferId: metadata.transferId
    };

    DOM.incomingFileName.textContent = metadata.name;
    DOM.incomingFileSizeDisplay.textContent = formatBytes(metadata.size);
    DOM.acceptOverlay.classList.remove('hidden');
    
    showNotification("Incoming File", { body: `Peer wants to send ${metadata.name}` });

    state.lastActivity = Date.now();
    if (state.timeoutCheck) clearInterval(state.timeoutCheck);
    state.timeoutCheck = setInterval(() => {
        if (Date.now() - state.lastActivity > TRANSFER.TIMEOUT_MS) {
            console.error("Transfer timed out");
            clearInterval(state.timeoutCheck);
            cancelTransfer();
            alert("Transfer timed out due to inactivity.");
        }
    }, 5000);
}

export async function acceptFile() {
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.remove('hidden');
    DOM.queueStatus.textContent = 'Receiving...';
    DOM.fileNameDisplay.textContent = state.receivingFile.name;
    updateProgress(0);
    await requestWakeLock(state);

    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: state.receivingFile.name,
            });
            state.receivingFile.fileWriter = await handle.createWritable();
            state.receivingFile.isStreaming = true;
        } catch (err) {
            console.warn('Streaming declined, falling back to RAM:', err);
        }
    }

    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.FILE_ACK, transferId: state.receivingFile.transferId });
    }
}

export function declineFile() {
    DOM.acceptOverlay.classList.add('hidden');
    cancelTransfer();
}

export async function handleFileChunk(buffer) {
    if (!state.receivingFile.name) return;
    
    state.lastActivity = Date.now();

    if (state.receivingFile.isStreaming) {
        await state.receivingFile.fileWriter.write(buffer);
    } else {
        state.receivingFile.data.push(buffer);
    }
    
    state.receivingFile.bytesReceived += buffer.byteLength;

    const progress = (state.receivingFile.bytesReceived / state.receivingFile.size) * 100;
    if (Math.floor(progress) % 2 === 0) {
        updateProgress(progress);
    }

    if (state.receivingFile.bytesReceived >= state.receivingFile.size) {
        clearInterval(state.timeoutCheck);
        
        if (state.receivingFile.isStreaming) {
            await state.receivingFile.fileWriter.close();
            await verifyAndFinishTransfer(null);
        } else {
            const blob = new Blob(state.receivingFile.data);
            await verifyAndFinishTransfer(blob);
        }
    }
}

async function verifyAndFinishTransfer(blob) {
    if (state.receivingFile.expectedHash && blob) {
        DOM.queueStatus.textContent = 'Verifying Checksum...';
        const actualHash = await calculateHash(blob);
        if (actualHash !== state.receivingFile.expectedHash) {
            alert("Checksum mismatch! The file may be corrupted.");
            console.error(`Hash mismatch. Expected: ${state.receivingFile.expectedHash}, Got: ${actualHash}`);
            handleTransferCancelled();
            return;
        }
    } else if (state.receivingFile.expectedHash && state.receivingFile.isStreaming) {
        console.warn("Checksum verification skipped for streamed file to save disk I/O.");
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = state.receivingFile.name;
        a.click();
        URL.revokeObjectURL(url);
    }
    
    finishTransfer();
}

export function handleTransferCancelled() {
    if (state.timeoutCheck) clearInterval(state.timeoutCheck);
    resetReceivingFile();
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.add('hidden');
    state.fileQueue = [];
    state.isTransferring = false;
    releaseWakeLock(state);
    alert('Transfer was cancelled or timed out.');
}

export function cancelTransfer() {
    if (state.timeoutCheck) clearInterval(state.timeoutCheck);
    state.isCancelled = true;
    state.fileQueue = [];
    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.TRANSFER_CANCEL });
    }
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.add('hidden');
    releaseWakeLock(state);
}

function finishTransfer() {
    showNotification("Transfer Complete", { body: `${state.receivingFile.name} received.` });
    
    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.FILE_COMPLETE });
    }

    setTimeout(() => {
        DOM.transferInfo.classList.add('hidden');
        resetReceivingFile();
        releaseWakeLock(state);
    }, 1000);
}