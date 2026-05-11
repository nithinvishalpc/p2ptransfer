export const MSG = {
    TEXT: 'text',
    FILE_META: 'file-metadata',
    FILE_CHUNK: 'file-chunk',
    FILE_ACK: 'file-ack',
    FILE_COMPLETE: 'file-complete',
    TRANSFER_CANCEL: 'transfer-cancelled'
};

export const TRANSFER = {
    CHUNK_SIZE: 65536, // 64KB chunks
    BUFFER_THRESHOLD: 1048576, // 1MB high water mark
    ACK_INTERVAL: 20, // ACK every 20 chunks
    TIMEOUT_MS: 30000 // 30 second timeout
};