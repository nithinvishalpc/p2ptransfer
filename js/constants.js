export const MSG = {
    TEXT: 'text',
    FILE_START: 'file-start',
    FILE_ACCEPT: 'file-accept',
    FILE_CHUNK: 'file-chunk',
    CHUNK_ACK: 'chunk-ack',
    FILE_COMPLETE: 'file-complete',
    FILE_RESUME_REQUEST: 'file-resume-request',
    TRANSFER_CANCEL: 'transfer-cancelled'
};

export const TRANSFER = {
    CHUNK_SIZE: 65536, // 64KB chunks
    BUFFER_THRESHOLD: 1048576, // 1MB high water mark
    ACK_INTERVAL: 20, // ACK every 20 chunks
    TIMEOUT_MS: 30000, // 30 second timeout
    MAX_FILE_SIZE: 5 * 1024 * 1024 * 1024, // 5GB hard safety cap
    MAX_FILENAME_LENGTH: 255,
    NON_STREAMING_MAX_SIZE: 128 * 1024 * 1024, // 128MB RAM safety cap
    THROUGHPUT_SMOOTHING_ALPHA: 0.2
};
