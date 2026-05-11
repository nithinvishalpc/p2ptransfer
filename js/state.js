export const state = {
    peer: null,
    conn: null,
    wakeLock: null,
    fileQueue: [],
    isTransferring: false,
    isCancelled: false,
    lastActivity: Date.now(),
    timeoutCheck: null,
    receivingFile: {
        name: '',
        size: 0,
        totalChunks: 0,
        chunksReceived: 0,
        data: [],
        fileWriter: null,
        isStreaming: false,
        expectedHash: null,
        transferId: null
    }
};

export function resetReceivingFile() {
    state.receivingFile = {
        name: '',
        size: 0,
        totalChunks: 0,
        chunksReceived: 0,
        data: [],
        fileWriter: null,
        isStreaming: false,
        expectedHash: null,
        transferId: null
    };
}