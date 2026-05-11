import { state } from './js/state.js';
import { DOM, showToast, showBanner } from './js/ui.js';
import { initPeer, refreshConnection, setupConnection } from './js/peer.js';
import { sendText, handleFileSelect, cancelTransfer, acceptFile, declineFile } from './js/transfer.js';

let notificationsRequested = false;
const THEME_KEY = 'p2p-theme';

function applyTheme(theme) {
    const normalized = theme === 'light' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', normalized);
    const moonIcon = document.getElementById('theme-icon-moon');
    const sunIcon = document.getElementById('theme-icon-sun');
    if (moonIcon && sunIcon) {
        moonIcon.style.display = normalized === 'dark' ? 'block' : 'none';
        sunIcon.style.display = normalized === 'light' ? 'block' : 'none';
    }
}

function initTheme() {
    const savedTheme = localStorage.getItem(THEME_KEY);
    const initialTheme = savedTheme === 'light' || savedTheme === 'dark' ? savedTheme : 'dark';
    applyTheme(initialTheme);

    const themeToggle = document.getElementById('theme-toggle');
    if (!themeToggle) return;

    themeToggle.addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        applyTheme(nextTheme);
        localStorage.setItem(THEME_KEY, nextTheme);
    });
}

function requestNotificationsOnce() {
    if (notificationsRequested) return;
    if (!('Notification' in window) || Notification.permission !== 'default') return;
    notificationsRequested = true;
    Notification.requestPermission().then(permission => {
        if (permission !== 'default') {
            DOM.notificationBtn.classList.add('hidden');
        }
    });
}

DOM.copyIdBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(DOM.myIdEl.textContent);
    const originalText = DOM.copyIdBtn.textContent;
    DOM.copyIdBtn.textContent = 'Done';
    setTimeout(() => {
        DOM.copyIdBtn.textContent = originalText;
    }, 2000);
});

DOM.connectBtn.addEventListener('click', () => {
    const remoteId = DOM.remoteIdInput.value.trim().toUpperCase();
    if (remoteId && !state.conn) {
        if (remoteId === state.peer.id) {
            showBanner('error', 'Cannot connect to yourself.');
            return;
        }
        const connection = state.peer.connect(remoteId, { reliable: true });
        setupConnection(connection);
    } else if (state.conn?.open) {
        showToast('Already connected');
    }
});

DOM.sendTextBtn.addEventListener('click', sendText);

DOM.copyTextBtn.addEventListener('click', () => {
    const text = DOM.receivedTextEl.textContent;
    if (text && text !== 'No text received yet.') {
        navigator.clipboard.writeText(text);
        const originalText = DOM.copyTextBtn.textContent;
        DOM.copyTextBtn.textContent = 'Copied!';
        setTimeout(() => {
            DOM.copyTextBtn.textContent = originalText;
        }, 2000);
    }
});

DOM.notificationBtn.addEventListener('click', () => {
    Notification.requestPermission().then(permission => {
        if (permission !== 'default') {
            DOM.notificationBtn.classList.add('hidden');
        }
    });
});

document.addEventListener('click', requestNotificationsOnce, { once: true });
document.addEventListener('keydown', requestNotificationsOnce, { once: true });
document.addEventListener('touchstart', requestNotificationsOnce, { once: true });

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

initTheme();
initPeer();