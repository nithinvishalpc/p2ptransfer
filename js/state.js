export const state = {
    peer: null,
    conn: null,
    pendingConnection: false,
    wakeLock: null,
    fileQueue: [],
    isTransferring: false,
    isCancelled: false,
    lastActivity: Date.now(),
    timeoutCheck: null,
    uiTimeout: null,
    senderTransfer: null,
    receivingFile: {
        name: '',
        safeName: '',
        size: 0,
        chunks: 0,
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
            startedAt: 0,
            lastSampleAt: 0,
            lastSampleBytes: 0,
            smoothBytesPerSec: 0
        },
        expectedHash: null,
        transferId: null
    }
};

export function resetReceivingFile() {
    state.receivingFile = {
        name: '',
        safeName: '',
        size: 0,
        chunks: 0,
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
            startedAt: 0,
            lastSampleAt: 0,
            lastSampleBytes: 0,
            smoothBytesPerSec: 0
        },
        expectedHash: null,
        transferId: null
    };
}
