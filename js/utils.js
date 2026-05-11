export function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

export function showNotification(title, options) {
    if ("Notification" in window && Notification.permission === "granted") {
        new Notification(title, options);
    }
}

export async function requestWakeLock(state) {
    try {
        if ('wakeLock' in navigator) {
            state.wakeLock = await navigator.wakeLock.request('screen');
        }
    } catch (err) {
        console.warn('Wake Lock failed:', err);
    }
}

export function releaseWakeLock(state) {
    if (state.wakeLock) {
        state.wakeLock.release().then(() => {
            state.wakeLock = null;
        });
    }
}

export function generateQRCode(id, qrcodeEl) {
    qrcodeEl.innerHTML = '';
    const url = `${window.location.origin}${window.location.pathname}#${id}`;
    // eslint-disable-next-line no-undef
    new QRCode(qrcodeEl, {
        text: url,
        width: 128,
        height: 128
    });
}

export async function calculateHash(fileOrBuffer) {
    let arrayBuffer;
    if (fileOrBuffer instanceof Blob) {
        arrayBuffer = await fileOrBuffer.arrayBuffer();
    } else {
        arrayBuffer = fileOrBuffer;
    }
    const hashBuffer = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
}