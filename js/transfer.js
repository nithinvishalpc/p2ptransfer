import { state, resetReceivingFile } from './state.js';
import { DOM, updateProgress, updateQueueUI, showBanner, clearBanner, showToast, updateTelemetry } from './ui.js';
import { MSG, TRANSFER } from './constants.js';
import { showNotification, requestWakeLock, releaseWakeLock, formatBytes, calculateHash, formatDuration } from './utils.js';

let acceptPromiseResolve = null;
const ACCEPT_TIMEOUT_MS = 30000;

function clearTransferTimers() {
    if (state.timeoutCheck) {
        clearInterval(state.timeoutCheck);
        state.timeoutCheck = null;
    }
}

export function sendText() {
    const text = DOM.textInput.value.trim();
    if (text && state.conn && state.conn.open) {
        state.conn.send({ type: MSG.TEXT, content: text });
        DOM.textInput.value = '';
    }
}

export function handleFileSelect(e) {
    const files = e.target.files || e.dataTransfer.files;
    if (files.length > 0 && state.conn && state.conn.open) {
        for (let i = 0; i < files.length; i++) {
            state.fileQueue.push(files[i]);
        }
        if (!state.isTransferring) processQueue();
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
    updateTelemetry('', '');
    releaseWakeLock(state);

    if (!state.isCancelled && !state.fileQueue.length) {
        showNotification('All Sent', { body: 'All files transferred successfully.' });
        showBanner('success', 'All files sent successfully.');
    }
}

export function handleFileAccept(data) {
    if (!state.senderTransfer || data.transferId !== state.senderTransfer.transferId) return;
    if (acceptPromiseResolve) {
        acceptPromiseResolve();
    }
}

export function handleChunkAck(data) {
    if (!state.senderTransfer || data.transferId !== state.senderTransfer.transferId) return;
    const nextIndex = Number(data.nextChunkIndex);
    if (!Number.isFinite(nextIndex) || nextIndex < 0) return;
    state.senderTransfer.nextChunkToSend = Math.max(state.senderTransfer.nextChunkToSend, nextIndex);
}

export function handleResumeRequest(data) {
    if (!state.senderTransfer || data.transferId !== state.senderTransfer.transferId) return;
    const fromChunkIndex = Number(data.fromChunkIndex);
    if (!Number.isFinite(fromChunkIndex) || fromChunkIndex < 0) return;
    state.senderTransfer.nextChunkToSend = fromChunkIndex;
}

function clearSenderCompletionWaiter(resolvePending = false) {
    if (!state.senderTransfer) return;
    if (state.senderTransfer.completeWaitTimeoutId) {
        clearTimeout(state.senderTransfer.completeWaitTimeoutId);
        state.senderTransfer.completeWaitTimeoutId = null;
    }
    if (resolvePending && state.senderTransfer.completePromiseResolve) {
        state.senderTransfer.completePromiseResolve();
    }
    state.senderTransfer.completePromiseResolve = null;
}

async function sendFile(file) {
    DOM.transferInfo.classList.remove('hidden');
    DOM.fileNameDisplay.textContent = `Sending: ${file.name}`;
    updateProgress(0);
    updateTelemetry('', '');

    if (file.size > TRANSFER.MAX_FILE_SIZE) {
        showBanner('error', `Skipped ${file.name}: exceeds max file size.`);
        return;
    }

    let expectedHash = null;
    if (file.size < 500 * 1024 * 1024) {
        DOM.fileNameDisplay.textContent = `Calculating Hash: ${file.name}...`;
        expectedHash = await calculateHash(file);
    }
    DOM.fileNameDisplay.textContent = `Sending: ${file.name}`;

    const transferId = typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString();
    const chunks = Math.max(1, Math.ceil(file.size / TRANSFER.CHUNK_SIZE));

    state.senderTransfer = {
        transferId,
        chunks,
        size: file.size,
        bytesSent: 0,
        startedAt: Date.now(),
        lastSampleAt: Date.now(),
        lastSampleBytes: 0,
        smoothBytesPerSec: 0,
        nextChunkToSend: 0,
        completePromiseResolve: null,
        completeWaitTimeoutId: null
    };

    state.conn.send({
        type: MSG.FILE_START,
        transferId,
        name: file.name,
        size: file.size,
        chunks,
        expectedHash
    });

    try {
        await waitForFileAccept();
    } catch (err) {
        await failTransfer(err?.message || 'Peer did not accept transfer in time.', transferId);
        return;
    }
    if (state.isCancelled || !state.senderTransfer || state.senderTransfer.transferId !== transferId) return;

    if (!state.conn || !state.conn.open || !state.conn.dataChannel || state.conn.dataChannel.readyState !== 'open') {
        await failTransfer('Connection closed during transfer.', transferId);
        return;
    }
    const dataChannel = state.conn.dataChannel;
    dataChannel.bufferedAmountLowThreshold = TRANSFER.BUFFER_THRESHOLD / 2;

    while (state.senderTransfer && state.senderTransfer.nextChunkToSend < chunks && !state.isCancelled) {
        const chunkIndex = state.senderTransfer.nextChunkToSend;
        const start = chunkIndex * TRANSFER.CHUNK_SIZE;
        const end = Math.min(start + TRANSFER.CHUNK_SIZE, file.size);
        const payload = await file.slice(start, end).arrayBuffer();

        if (dataChannel.bufferedAmount > TRANSFER.BUFFER_THRESHOLD) {
            await new Promise(resolve => {
                const cleanup = () => {
                    dataChannel.onbufferedamountlow = null;
                    clearInterval(waitGuard);
                };
                const settle = () => {
                    cleanup();
                    resolve();
                };
                dataChannel.onbufferedamountlow = () => {
                    settle();
                };
                const waitGuard = setInterval(() => {
                    if (
                        state.isCancelled
                        || !state.conn
                        || !state.conn.open
                        || !dataChannel
                        || dataChannel.readyState !== 'open'
                    ) {
                        settle();
                    }
                }, 100);
            });
        }

        if (!state.conn || !state.conn.open || dataChannel.readyState !== 'open') {
            await failTransfer('Connection closed during transfer.', transferId);
            return;
        }
        try {
            state.conn.send({ type: MSG.FILE_CHUNK, transferId, chunkIndex, payload });
        } catch (_err) {
            await failTransfer('Connection closed during transfer.', transferId);
            return;
        }
        state.senderTransfer.bytesSent += payload.byteLength;
        state.senderTransfer.nextChunkToSend += 1;

        if (chunkIndex % TRANSFER.ACK_INTERVAL === 0 || chunkIndex === chunks - 1) {
            const progress = file.size === 0 ? 100 : (state.senderTransfer.bytesSent / file.size) * 100;
            updateProgress(progress);
            updateTransferTelemetry(state.senderTransfer.bytesSent, file.size, state.senderTransfer);
        }
    }

    if (!state.isCancelled) {
        updateProgress(100);
        updateTelemetry('100%', 'Waiting for peer...');
        DOM.queueStatus.textContent = 'Waiting for peer to verify & save...';
        await new Promise(resolve => {
            if (!state.senderTransfer || state.senderTransfer.transferId !== transferId) {
                resolve();
                return;
            }
            let settled = false;
            const settle = () => {
                if (settled) return;
                settled = true;
                clearSenderCompletionWaiter(false);
                resolve();
            };
            state.senderTransfer.completePromiseResolve = settle;
            state.senderTransfer.completeWaitTimeoutId = setTimeout(settle, 60000);
        });
    }

    clearSenderCompletionWaiter(false);
    state.senderTransfer = null;
}

function waitForFileAccept() {
    return new Promise((resolve, reject) => {
        const connection = state.conn;
        let settled = false;
        let timeoutId = null;

        const cleanup = () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
                timeoutId = null;
            }
            if (acceptPromiseResolve === onAccept) {
                acceptPromiseResolve = null;
            }
            if (connection && typeof connection.off === 'function') {
                connection.off('close', onClose);
            }
        };

        const settle = (fn) => {
            if (settled) return;
            settled = true;
            cleanup();
            fn();
        };

        const onAccept = () => settle(resolve);
        const onClose = () => settle(() => reject(new Error('Connection closed before transfer was accepted.')));

        acceptPromiseResolve = onAccept;
        timeoutId = setTimeout(() => {
            settle(() => reject(new Error('Peer did not accept transfer in time.')));
        }, ACCEPT_TIMEOUT_MS);

        if (connection && typeof connection.on === 'function') {
            connection.on('close', onClose);
        }
        if (!connection || !connection.open) {
            onClose();
        }
    });
}

function sanitizeFileName(name) {
    const cleaned = String(name || '')
        .replace(/[\\/]/g, '_')
        .replace(/[\x00-\x1F\x7F]/g, '')
        .trim();
    return cleaned.slice(0, TRANSFER.MAX_FILENAME_LENGTH) || 'received-file';
}

function validateMetadata(metadata) {
    if (!metadata || typeof metadata !== 'object') return 'Malformed metadata.';
    if (typeof metadata.transferId !== 'string' || metadata.transferId.length < 8) return 'Invalid transfer id.';
    if (typeof metadata.name !== 'string' || !metadata.name.trim()) return 'Invalid filename.';
    if (!Number.isFinite(metadata.size) || metadata.size < 0 || metadata.size > TRANSFER.MAX_FILE_SIZE) return 'Invalid file size.';
    if (!Number.isFinite(metadata.chunks) || metadata.chunks <= 0) return 'Invalid chunk count.';
    const expectedChunks = Math.max(1, Math.ceil(metadata.size / TRANSFER.CHUNK_SIZE));
    if (metadata.chunks !== expectedChunks) return 'Chunk count does not match file size.';
    return '';
}

export async function handleFileStart(metadata) {
    if (state.uiTimeout) {
        clearTimeout(state.uiTimeout);
        state.uiTimeout = null;
    }

    const validationError = validateMetadata(metadata);
    if (validationError) {
        await failTransfer(validationError, metadata?.transferId);
        return;
    }

    const safeName = sanitizeFileName(metadata.name);
    state.receivingFile = {
        name: metadata.name,
        safeName,
        size: metadata.size,
        chunks: metadata.chunks,
        chunksReceived: 0,
        bytesReceived: 0,
        data: [],
        fileWriter: null,
        fileHandle: null,
        isStreaming: false,
        isReceivingBinary: false,
        receivedChunkIndexes: new Set(),
        highestContiguousAck: -1,
        pendingAckCount: 0,
        telemetry: {
            startedAt: Date.now(),
            lastSampleAt: Date.now(),
            lastSampleBytes: 0,
            smoothBytesPerSec: 0
        },
        expectedHash: metadata.expectedHash,
        transferId: metadata.transferId
    };

    DOM.incomingFileName.textContent = safeName;
    DOM.incomingFileSizeDisplay.textContent = formatBytes(metadata.size);
    DOM.acceptOverlay.classList.remove('hidden');
    showBanner('info', `Incoming file request: ${safeName}`);
    showNotification('Incoming File', { body: `Peer wants to send ${safeName}` });

    state.lastActivity = Date.now();
    clearTransferTimers();
    state.timeoutCheck = setInterval(() => {
        if (Date.now() - state.lastActivity > TRANSFER.TIMEOUT_MS) {
            clearTransferTimers();
            cancelTransfer('Timed out due to inactivity.');
        }
    }, 5000);
}

export async function acceptFile() {
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.remove('hidden');
    DOM.queueStatus.textContent = 'Receiving...';
    DOM.fileNameDisplay.textContent = state.receivingFile.safeName;
    updateProgress(0);
    updateTelemetry('', '');
    await requestWakeLock(state);

    if ('showSaveFilePicker' in window) {
        try {
            const handle = await window.showSaveFilePicker({ suggestedName: state.receivingFile.safeName });
            state.receivingFile.fileHandle = handle;
            state.receivingFile.fileWriter = await handle.createWritable();
            state.receivingFile.isStreaming = true;
        } catch (err) {
            if (err?.name === 'AbortError') {
                cancelTransfer('Transfer cancelled by user in save dialog.');
                return;
            }
            state.receivingFile.isStreaming = false;
        }
    }

    if (!state.receivingFile.isStreaming && state.receivingFile.size > TRANSFER.NON_STREAMING_MAX_SIZE) {
        cancelTransfer(`Receive blocked: browser cannot stream and file exceeds ${formatBytes(TRANSFER.NON_STREAMING_MAX_SIZE)}.`);
        return;
    }

    state.receivingFile.isReceivingBinary = true;
    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.FILE_ACCEPT, transferId: state.receivingFile.transferId });
    }
}

export function declineFile() {
    DOM.acceptOverlay.classList.add('hidden');
    cancelTransfer('Transfer declined.');
}

export async function handleFileChunk(message) {
    if (!state.receivingFile.name || !state.receivingFile.isReceivingBinary) return;
    if (!message || message.type !== MSG.FILE_CHUNK) return;
    if (message.transferId !== state.receivingFile.transferId) return;

    const chunkIndex = Number(message.chunkIndex);
    const payload = message.payload;
    if (!Number.isFinite(chunkIndex) || chunkIndex < 0 || chunkIndex >= state.receivingFile.chunks) return;
    if (!(payload instanceof ArrayBuffer) && !ArrayBuffer.isView(payload)) return;
    if (state.receivingFile.receivedChunkIndexes.has(chunkIndex)) return;

    const buffer = payload instanceof ArrayBuffer
        ? payload
        : payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength);
    const isFinalChunk = chunkIndex === state.receivingFile.chunks - 1;
    const expectedChunkSize = isFinalChunk
        ? state.receivingFile.size - (chunkIndex * TRANSFER.CHUNK_SIZE)
        : TRANSFER.CHUNK_SIZE;
    if (buffer.byteLength !== expectedChunkSize) {
        await failTransfer('Invalid chunk size.', state.receivingFile.transferId);
        return;
    }

    state.lastActivity = Date.now();

    try {
        if (state.receivingFile.isStreaming) {
            await state.receivingFile.fileWriter.write({
                type: 'write',
                position: chunkIndex * TRANSFER.CHUNK_SIZE,
                data: buffer
            });
        } else {
            state.receivingFile.data[chunkIndex] = buffer;
        }
        state.receivingFile.bytesReceived += buffer.byteLength;
        state.receivingFile.chunksReceived += 1;
        state.receivingFile.receivedChunkIndexes.add(chunkIndex);
        state.receivingFile.pendingAckCount += 1;
    } catch (_err) {
        await failTransfer('Failed to write incoming file data.', state.receivingFile.transferId);
        return;
    }

    while (state.receivingFile.receivedChunkIndexes.has(state.receivingFile.highestContiguousAck + 1)) {
        state.receivingFile.highestContiguousAck += 1;
    }

    if (state.receivingFile.pendingAckCount >= TRANSFER.ACK_INTERVAL || state.receivingFile.chunksReceived === state.receivingFile.chunks) {
        state.receivingFile.pendingAckCount = 0;
        if (!state.conn || !state.conn.open) {
            await failTransfer('Connection closed during transfer.', state.receivingFile.transferId);
            return;
        }
        try {
            state.conn.send({
                type: MSG.CHUNK_ACK,
                transferId: state.receivingFile.transferId,
                nextChunkIndex: state.receivingFile.highestContiguousAck + 1
            });
        } catch (_err) {
            await failTransfer('Connection closed during transfer.', state.receivingFile.transferId);
            return;
        }
    }

    const receiveProgress = state.receivingFile.size === 0
        ? 100
        : (state.receivingFile.bytesReceived / state.receivingFile.size) * 100;
    updateProgress(receiveProgress);
    updateTransferTelemetry(state.receivingFile.bytesReceived, state.receivingFile.size, state.receivingFile.telemetry);

    const completedByBytes = state.receivingFile.bytesReceived === state.receivingFile.size;
    const completedByChunks = state.receivingFile.chunksReceived === state.receivingFile.chunks;

    if (completedByBytes && completedByChunks) {
        if (state.receivingFile.receivedChunkIndexes.size !== state.receivingFile.chunks) {
            await failTransfer('Transfer ended with inconsistent chunk receipt.', state.receivingFile.transferId);
            return;
        }

        clearTransferTimers();
        if (state.receivingFile.isStreaming) {
            await closeFileWriter();
            await verifyAndFinishTransfer(null);
        } else {
            for (let i = 0; i < state.receivingFile.chunks; i += 1) {
                if (!state.receivingFile.data[i]) {
                    await failTransfer('Transfer ended with missing chunk data.', state.receivingFile.transferId);
                    return;
                }
            }
            const blob = new Blob(state.receivingFile.data);
            await verifyAndFinishTransfer(blob);
        }
    }
}

function updateTransferTelemetry(bytesDone, totalBytes, telemetryState) {
    const now = Date.now();
    const dt = (now - telemetryState.lastSampleAt) / 1000;
    if (dt <= 0) return;
    const instant = (bytesDone - telemetryState.lastSampleBytes) / dt;
    telemetryState.smoothBytesPerSec = telemetryState.smoothBytesPerSec
        ? telemetryState.smoothBytesPerSec + TRANSFER.THROUGHPUT_SMOOTHING_ALPHA * (instant - telemetryState.smoothBytesPerSec)
        : instant;
    telemetryState.lastSampleAt = now;
    telemetryState.lastSampleBytes = bytesDone;

    const speed = telemetryState.smoothBytesPerSec;
    const etaSeconds = speed > 0 ? (totalBytes - bytesDone) / speed : Infinity;
    updateTelemetry(`${formatBytes(Math.max(speed, 0))}/s`, Number.isFinite(etaSeconds) ? `ETA ${formatDuration(etaSeconds)}` : 'ETA --');
}

async function verifyAndFinishTransfer(blob) {
    let fileToVerify = blob;
    if (!fileToVerify && state.receivingFile.fileHandle) {
        try {
            if (typeof state.receivingFile.fileHandle.getFile !== 'function') {
                await failTransfer('Transfer failed checksum verification: unable to read saved file for verification.', state.receivingFile.transferId);
                return;
            }
            fileToVerify = await state.receivingFile.fileHandle.getFile();
        } catch (_err) {
            await failTransfer('Transfer failed checksum verification: unable to read saved file for verification.', state.receivingFile.transferId);
            return;
        }
    }

    if (state.receivingFile.expectedHash) {
        if (!fileToVerify) {
            await failTransfer('Transfer failed checksum verification: no file data available to verify.', state.receivingFile.transferId);
            return;
        }
        DOM.queueStatus.textContent = 'Verifying Checksum...';
        const actualHash = await calculateHash(fileToVerify);
        if (actualHash !== state.receivingFile.expectedHash) {
            await failTransfer('Transfer failed checksum verification.', state.receivingFile.transferId);
            return;
        }
    }

    if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = state.receivingFile.safeName;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    }

    finishTransfer();
}

export function handleTransferCancelled() {
    state.isCancelled = true;
    clearSenderCompletionWaiter(true);
    if (acceptPromiseResolve) {
        acceptPromiseResolve();
    }
    clearTransferTimers();
    if (state.uiTimeout) {
        clearTimeout(state.uiTimeout);
        state.uiTimeout = null;
    }
    cleanupFileWriter(true);
    resetReceivingFile();
    state.senderTransfer = null;
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.add('hidden');
    updateTelemetry('', '');
    state.fileQueue = [];
    state.isTransferring = false;
    releaseWakeLock(state);
    showNotification('Transfer Cancelled', { body: 'Transfer was cancelled by peer or timed out.' });
    showBanner('error', 'Transfer cancelled by peer.');
}

export function cancelTransfer(reason = 'Transfer cancelled.') {
    clearTransferTimers();
    if (state.uiTimeout) {
        clearTimeout(state.uiTimeout);
        state.uiTimeout = null;
    }
    if (acceptPromiseResolve) {
        acceptPromiseResolve();
    }
    clearSenderCompletionWaiter(true);
    state.isCancelled = true;
    state.fileQueue = [];
    cleanupFileWriter(true);
    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.TRANSFER_CANCEL, reason, transferId: state.receivingFile.transferId || state.senderTransfer?.transferId || null });
    }
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.add('hidden');
    updateTelemetry('', '');
    showNotification('Transfer Cancelled', { body: reason });
    showBanner('error', reason);
    showToast(reason);
    releaseWakeLock(state);
}

function finishTransfer() {
    showNotification('Transfer Complete', { body: `${state.receivingFile.safeName} received.` });
    showBanner('success', `${state.receivingFile.safeName} received successfully.`);
    showToast('Transfer complete');

    if (state.conn && state.conn.open) {
        state.conn.send({ type: MSG.FILE_COMPLETE, transferId: state.receivingFile.transferId });
    }

    state.uiTimeout = setTimeout(() => {
        DOM.transferInfo.classList.add('hidden');
        updateTelemetry('', '');
        clearBanner();
        resetReceivingFile();
        releaseWakeLock(state);
        state.uiTimeout = null;
    }, 1000);
}

async function closeFileWriter() {
    if (!state.receivingFile.fileWriter) return;
    try {
        await state.receivingFile.fileWriter.close();
    } catch (_err) {
        // no-op
    } finally {
        state.receivingFile.fileWriter = null;
    }
}

function cleanupFileWriter(abort = false) {
    if (!state.receivingFile.fileWriter) return;
    const writer = state.receivingFile.fileWriter;
    state.receivingFile.fileWriter = null;
    if (abort && typeof writer.abort === 'function') {
        writer.abort().catch(() => {});
        return;
    }
    if (typeof writer.close === 'function') {
        writer.close().catch(() => {});
    }
}

async function failTransfer(message, transferId = null) {
    if (acceptPromiseResolve) {
        acceptPromiseResolve();
    }
    clearSenderCompletionWaiter(true);
    showNotification('Transfer Failed', { body: message });
    showBanner('error', message);
    showToast(message);
    clearTransferTimers();
    if (state.uiTimeout) {
        clearTimeout(state.uiTimeout);
        state.uiTimeout = null;
    }
    cleanupFileWriter(true);
    if (state.conn?.open) {
        state.conn.send({ type: MSG.TRANSFER_CANCEL, reason: message, transferId });
    }
    resetReceivingFile();
    state.senderTransfer = null;
    DOM.acceptOverlay.classList.add('hidden');
    DOM.transferInfo.classList.add('hidden');
    updateTelemetry('', '');
    state.fileQueue = [];
    state.isTransferring = false;
    releaseWakeLock(state);
}

export function handleFileComplete(data) {
    if (!data || !state.senderTransfer || state.senderTransfer.transferId !== data.transferId) return;
    clearSenderCompletionWaiter(true);
}
