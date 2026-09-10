/* ==========================================================================
   OFFLINE AI ASSISTANT — FRONTEND LOGIC
   Clean, Resilient, Production-Grade Client Logic
   ========================================================================== */

(function () {
  'use strict';

  // State
  const state = {
    backendUrl: localStorage.getItem('rag_backend_url') || detectDefaultBackendUrl(),
    username: localStorage.getItem('rag_username') || null,
    activeDoc: null,
    authMode: 'signin',
    selectedFile: null,
    healthTimer: null,
  };

  function detectDefaultBackendUrl() {
    if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
      return 'http://localhost:5000';
    }
    return '';
  }

  function getBaseUrl() {
    return (state.backendUrl || '').replace(/\/+$/, '');
  }

  function isLocalBackend() {
    const base = getBaseUrl().toLowerCase();
    return base.includes('localhost') || base.includes('127.0.0.1');
  }

  // DOM Elements
  const el = {
    // Topbar
    statusPill: document.getElementById('backend-status-pill'),
    statusLabel: document.querySelector('#backend-status-pill .status-label'),
    btnClearChat: document.getElementById('btn-clear-chat'),
    btnAuth: document.getElementById('btn-auth'),
    avatarInitial: document.getElementById('avatar-initial'),
    usernameLabel: document.getElementById('username-label'),
    btnSettings: document.getElementById('btn-settings'),

    // Sidebar
    activeDocBanner: document.getElementById('active-doc-banner'),
    docTitleText: document.getElementById('doc-title-text'),
    btnReplaceDoc: document.getElementById('btn-replace-doc'),
    dropzone: document.getElementById('dropzone'),
    pdfInput: document.getElementById('pdf-input'),
    uploadProgressWrap: document.getElementById('upload-progress-wrap'),
    fileStagedBox: document.getElementById('file-staged-box'),
    stagedFileName: document.getElementById('staged-file-name'),
    btnUploadFile: document.getElementById('btn-upload-file'),
    sidebarToast: document.getElementById('sidebar-toast'),

    // Chat Viewport
    contextBanner: document.getElementById('context-banner'),
    bannerMessage: document.getElementById('banner-message'),
    btnCloseBanner: document.getElementById('btn-close-banner'),
    chatMessages: document.getElementById('chat-messages'),
    emptyStateHero: document.getElementById('empty-state-hero'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    btnSendMessage: document.getElementById('btn-send-message'),

    // Settings Modal
    settingsModal: document.getElementById('settings-modal'),
    btnCloseSettings: document.getElementById('btn-close-settings'),
    btnPresetLocal: document.getElementById('btn-preset-local'),
    serverUrlField: document.getElementById('server-url-field'),
    connectionStatusBox: document.getElementById('connection-status-box'),
    btnTestConn: document.getElementById('btn-test-conn'),
    btnSaveConn: document.getElementById('btn-save-conn'),

    // Auth Modal
    authDialog: document.getElementById('auth-dialog'),
    btnCloseAuth: document.getElementById('btn-close-auth'),
    authTitle: document.getElementById('auth-title'),
    tabSignin: document.getElementById('tab-signin'),
    tabRegister: document.getElementById('tab-register'),
    authSubmitForm: document.getElementById('auth-submit-form'),
    inputUsername: document.getElementById('input-username'),
    inputPassword: document.getElementById('input-password'),
    authFeedback: document.getElementById('auth-feedback'),
    btnSubmitAuth: document.getElementById('btn-submit-auth'),
  };

  // Toast auto-clear timer
  let toastTimeout = null;

  // ==========================================================================
  // INITIALIZATION
  // ==========================================================================

  function init() {
    bindEvents();
    syncAuthUI();

    if (!state.backendUrl) {
      openSettings();
      updateStatusBadge('offline', 'Configure Server');
    } else {
      checkBackendHealth();
      fetchStatus();
    }

    // Ping server health every 30s
    state.healthTimer = setInterval(checkBackendHealth, 30000);
  }

  // ==========================================================================
  // EVENT BINDINGS
  // ==========================================================================

  function bindEvents() {
    // Settings triggers
    el.statusPill.addEventListener('click', openSettings);
    el.btnSettings.addEventListener('click', openSettings);
    el.btnCloseSettings.addEventListener('click', closeSettings);
    el.settingsModal.addEventListener('click', (e) => {
      if (e.target === el.settingsModal) closeSettings();
    });

    el.btnPresetLocal.addEventListener('click', () => {
      el.serverUrlField.value = 'http://localhost:5000';
    });

    el.btnTestConn.addEventListener('click', testConnection);
    el.btnSaveConn.addEventListener('click', saveConnection);

    // Auth triggers
    el.btnAuth.addEventListener('click', handleAuthClick);
    el.btnCloseAuth.addEventListener('click', closeAuth);
    el.authDialog.addEventListener('click', (e) => {
      if (e.target === el.authDialog) closeAuth();
    });

    el.tabSignin.addEventListener('click', () => setAuthTab('signin'));
    el.tabRegister.addEventListener('click', () => setAuthTab('register'));
    el.authSubmitForm.addEventListener('submit', submitAuth);

    // Banner dismiss
    el.btnCloseBanner.addEventListener('click', () => {
      el.contextBanner.classList.add('hidden');
    });

    // Clear chat
    el.btnClearChat.addEventListener('click', resetChat);

    // File input & Drag-drop
    el.dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      el.dropzone.classList.add('dragover');
    });

    el.dropzone.addEventListener('dragleave', () => {
      el.dropzone.classList.remove('dragover');
    });

    el.dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      el.dropzone.classList.remove('dragover');
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        onFileSelected(e.dataTransfer.files[0]);
      }
    });

    el.pdfInput.addEventListener('change', (e) => {
      if (e.target.files && e.target.files.length > 0) {
        onFileSelected(e.target.files[0]);
      }
    });

    el.btnReplaceDoc.addEventListener('click', () => {
      el.pdfInput.click();
    });

    el.btnUploadFile.addEventListener('click', uploadSelectedPdf);

    // Composer input dynamic button state
    el.chatInput.addEventListener('input', () => {
      el.btnSendMessage.disabled = el.chatInput.value.trim().length === 0;
    });

    el.chatForm.addEventListener('submit', onQuestionSubmit);

    // Starter suggestion chips
    document.querySelectorAll('.suggestion-chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const text = chip.getAttribute('data-text');
        if (text) {
          el.chatInput.value = text;
          el.btnSendMessage.disabled = false;
          onQuestionSubmit(new Event('submit'));
        }
      });
    });
  }

  // ==========================================================================
  // SERVER HEALTH & STATUS
  // ==========================================================================

  async function checkBackendHealth() {
    const base = getBaseUrl();
    if (!base) {
      updateStatusBadge('offline', 'No Backend');
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 9000);

    try {
      const res = await fetch(`${base}/api/health`, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (res.ok) {
        const label = isLocalBackend() ? 'Localhost :5000' : 'Render Live';
        updateStatusBadge('online', label);
        el.contextBanner.classList.add('hidden');
      } else {
        updateStatusBadge('offline', `HTTP ${res.status}`);
      }
    } catch (err) {
      clearTimeout(timeout);
      if (isLocalBackend()) {
        updateStatusBadge('offline', 'Local Offline');
        showBanner('Local server is offline. Run "python app.py" in your terminal to start it.');
      } else {
        updateStatusBadge('waking', 'Waking Up...');
        showBanner('Render backend is spinning up (free tier takes ~30-50s). Retrying automatically...');
      }
    }
  }

  function updateStatusBadge(type, text) {
    el.statusPill.className = `status-pill ${type}`;
    el.statusLabel.textContent = text;
  }

  function showBanner(msg) {
    el.bannerMessage.textContent = msg;
    el.contextBanner.classList.remove('hidden');
  }

  async function fetchStatus() {
    const base = getBaseUrl();
    if (!base) return;

    try {
      const res = await fetch(`${base}/api/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.has_document || data.active_pdf) {
          showActiveDoc(data.active_pdf || 'Python Unit-4 Answers.pdf');
        }
      }
    } catch (_) {}
  }

  // ==========================================================================
  // SETTINGS MODAL
  // ==========================================================================

  function openSettings() {
    el.serverUrlField.value = state.backendUrl;
    el.connectionStatusBox.classList.add('hidden');
    el.settingsModal.classList.remove('hidden');
  }

  function closeSettings() {
    el.settingsModal.classList.add('hidden');
  }

  async function testConnection() {
    const url = el.serverUrlField.value.trim().replace(/\/+$/, '');
    if (!url) {
      showConnFeedback('Please enter a backend URL.', false);
      return;
    }

    showConnFeedback('Pinging ' + url + '...', 'loading');
    const start = performance.now();

    try {
      const res = await fetch(`${url}/api/health`, { method: 'GET' });
      const duration = Math.round(performance.now() - start);

      if (res.ok) {
        const data = await res.json();
        showConnFeedback(`✓ Connected successfully in ${duration}ms! Service: ${data.service || 'Ready'}`, true);
      } else {
        showConnFeedback(`Server reached, but returned HTTP error ${res.status}.`, false);
      }
    } catch (err) {
      showConnFeedback(`Connection failed: ${err.message}. If deploying to Render free tier, it may be waking up.`, false);
    }
  }

  function showConnFeedback(msg, success) {
    el.connectionStatusBox.classList.remove('hidden', 'feedback-success', 'feedback-error');
    if (success === 'loading') {
      el.connectionStatusBox.style.color = '#94a3b8';
      el.connectionStatusBox.textContent = msg;
    } else if (success) {
      el.connectionStatusBox.classList.add('feedback-success');
      el.connectionStatusBox.textContent = msg;
    } else {
      el.connectionStatusBox.classList.add('feedback-error');
      el.connectionStatusBox.textContent = msg;
    }
  }

  function saveConnection() {
    const url = el.serverUrlField.value.trim().replace(/\/+$/, '');
    state.backendUrl = url;
    localStorage.setItem('rag_backend_url', url);
    closeSettings();
    checkBackendHealth();
    fetchStatus();
  }

  // ==========================================================================
  // AUTHENTICATION
  // ==========================================================================

  function handleAuthClick() {
    if (state.username) {
      if (confirm(`Signed in as '${state.username}'. Would you like to sign out?`)) {
        state.username = null;
        localStorage.removeItem('rag_username');
        syncAuthUI();
      }
    } else {
      openAuth();
    }
  }

  function openAuth() {
    setAuthTab('signin');
    el.inputUsername.value = '';
    el.inputPassword.value = '';
    el.authFeedback.classList.add('hidden');
    el.authDialog.classList.remove('hidden');
  }

  function closeAuth() {
    el.authDialog.classList.add('hidden');
  }

  function setAuthTab(tab) {
    state.authMode = tab;
    if (tab === 'signin') {
      el.tabSignin.classList.add('active');
      el.tabRegister.classList.remove('active');
      el.authTitle.textContent = 'Sign In';
      el.btnSubmitAuth.querySelector('.btn-label').textContent = 'Sign In';
    } else {
      el.tabRegister.classList.add('active');
      el.tabSignin.classList.remove('active');
      el.authTitle.textContent = 'Create Account';
      el.btnSubmitAuth.querySelector('.btn-label').textContent = 'Create Account';
    }
    el.authFeedback.classList.add('hidden');
  }

  async function submitAuth(e) {
    e.preventDefault();
    const base = getBaseUrl();
    if (!base) {
      showAuthFeedback('Configure your Backend URL first in settings.', false);
      return;
    }

    const username = el.inputUsername.value.trim();
    const password = el.inputPassword.value.trim();
    if (!username || !password) {
      showAuthFeedback('Username and password are required.', false);
      return;
    }

    const endpoint = state.authMode === 'signin' ? '/api/login' : '/api/register';
    const btn = el.btnSubmitAuth;
    setButtonLoading(btn, true);

    try {
      const res = await fetch(`${base}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        if (state.authMode === 'register') {
          setAuthTab('signin');
          showAuthFeedback('Account created! Please sign in.', true);
        } else {
          state.username = username;
          localStorage.setItem('rag_username', username);
          syncAuthUI();
          closeAuth();
        }
      } else {
        showAuthFeedback(data.message || 'Authentication error.', false);
      }
    } catch (err) {
      showAuthFeedback(`Network error: ${err.message}`, false);
    } finally {
      setButtonLoading(btn, false);
    }
  }

  function showAuthFeedback(msg, success) {
    el.authFeedback.classList.remove('hidden', 'feedback-success', 'feedback-error');
    el.authFeedback.classList.add(success ? 'feedback-success' : 'feedback-error');
    el.authFeedback.textContent = msg;
  }

  function syncAuthUI() {
    if (state.username) {
      el.usernameLabel.textContent = state.username;
      el.avatarInitial.textContent = state.username.charAt(0).toUpperCase();
    } else {
      el.usernameLabel.textContent = 'Sign In';
      el.avatarInitial.textContent = '?';
    }
  }

  // ==========================================================================
  // DOCUMENT UPLOAD
  // ==========================================================================

  function onFileSelected(file) {
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      showSidebarToast('Please choose a valid PDF file.', 'error');
      return;
    }

    state.selectedFile = file;
    el.stagedFileName.textContent = file.name;
    el.fileStagedBox.classList.remove('hidden');
    el.sidebarToast.classList.add('hidden');
  }

  async function uploadSelectedPdf() {
    if (!state.selectedFile) return;

    const base = getBaseUrl();
    if (!base) {
      showSidebarToast('Configure backend URL in settings first.', 'error');
      openSettings();
      return;
    }

    const btn = el.btnUploadFile;
    setButtonLoading(btn, true);
    el.uploadProgressWrap.classList.remove('hidden');

    const formData = new FormData();
    formData.append('pdf', state.selectedFile);

    try {
      const res = await fetch(`${base}/api/upload`, {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (res.ok && data.success) {
        showActiveDoc(state.selectedFile.name);
        showSidebarToast(data.message || 'Document indexed successfully!', 'success');
        el.fileStagedBox.classList.add('hidden');
        state.selectedFile = null;
        el.pdfInput.value = '';
      } else {
        showSidebarToast(data.message || 'Could not index document.', 'error');
      }
    } catch (err) {
      showSidebarToast(`Upload error: ${err.message}`, 'error');
    } finally {
      setButtonLoading(btn, false);
      el.uploadProgressWrap.classList.add('hidden');
    }
  }

  function showActiveDoc(name) {
    state.activeDoc = name;
    el.docTitleText.textContent = name;
    el.activeDocBanner.classList.remove('hidden');
  }

  function showSidebarToast(msg, type) {
    if (toastTimeout) clearTimeout(toastTimeout);
    el.sidebarToast.className = `sidebar-toast toast-${type}`;
    el.sidebarToast.textContent = msg;
    el.sidebarToast.classList.remove('hidden');

    // Auto-fade after 3.5s
    toastTimeout = setTimeout(() => {
      el.sidebarToast.classList.add('hidden');
    }, 3500);
  }

  // ==========================================================================
  // CHAT & Q&A INTERACTION
  // ==========================================================================

  async function onQuestionSubmit(e) {
    if (e) e.preventDefault();

    const question = el.chatInput.value.trim();
    if (!question) return;

    const base = getBaseUrl();
    if (!base) {
      openSettings();
      return;
    }

    // Hide welcome hero
    if (el.emptyStateHero) {
      el.emptyStateHero.classList.add('hidden');
    }

    // Append user question
    appendUserBubble(question);
    el.chatInput.value = '';
    el.btnSendMessage.disabled = true;

    // Append thinking shimmer
    const thinkingId = appendThinkingCard();

    try {
      const res = await fetch(`${base}/api/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const data = await res.json();
      removeElement(thinkingId);

      if (res.ok && data.answer) {
        appendAssistantCard(data.answer);
      } else {
        appendAssistantCard(data.message || 'Could not retrieve an answer at this time.');
      }
    } catch (err) {
      removeElement(thinkingId);
      appendAssistantCard(`Network error: ${err.message}. Please check if the backend server is running.`);
    } finally {
      el.btnSendMessage.disabled = el.chatInput.value.trim().length === 0;
      el.chatInput.focus();
    }
  }

  function appendUserBubble(text) {
    const turn = document.createElement('div');
    turn.className = 'chat-turn';

    const bubble = document.createElement('div');
    bubble.className = 'user-bubble';
    bubble.textContent = text;

    turn.appendChild(bubble);
    el.chatMessages.appendChild(turn);
    scrollChat();
  }

  function appendThinkingCard() {
    const id = 'think-' + Date.now();
    const card = document.createElement('div');
    card.id = id;
    card.className = 'thinking-card';
    card.innerHTML = `
      <span>Searching indexed chunks</span>
      <div class="pulsing-dots">
        <span></span><span></span><span></span>
      </div>
    `;
    el.chatMessages.appendChild(card);
    scrollChat();
    return id;
  }

  function appendAssistantCard(rawText) {
    const turn = document.createElement('div');
    turn.className = 'chat-turn';

    const card = document.createElement('div');
    card.className = 'assistant-card';

    // Top bar
    const topbar = document.createElement('div');
    topbar.className = 'card-topbar';

    const badge = document.createElement('div');
    badge.className = 'source-badge';
    badge.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>
      </svg>
      <span>Answer from Document</span>
    `;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'btn-clipboard';
    copyBtn.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
      </svg>
      <span>Copy</span>
    `;

    copyBtn.addEventListener('click', () => {
      navigator.clipboard.writeText(rawText).then(() => {
        copyBtn.innerHTML = `
          <svg viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2.5" width="13" height="13">
            <polyline points="20 6 9 17 4 12"/>
          </svg>
          <span style="color: #10b981;">Copied!</span>
        `;
        setTimeout(() => {
          copyBtn.innerHTML = `
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
            </svg>
            <span>Copy</span>
          `;
        }, 2000);
      });
    });

    topbar.appendChild(badge);
    topbar.appendChild(copyBtn);

    // Body with code formatting
    const body = document.createElement('div');
    body.className = 'answer-body';
    body.innerHTML = formatAnswerHtml(rawText);

    card.appendChild(topbar);
    card.appendChild(body);
    turn.appendChild(card);

    el.chatMessages.appendChild(turn);
    scrollChat();
  }

  function formatAnswerHtml(text) {
    if (!text) return '';

    // Sanitize basic HTML entities
    let escaped = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    // Look for Python code blocks (starts with import, def, class, x =, etc.)
    const codeMatch = escaped.match(/(import\s+[a-zA-Z0-9_\.]+|def\s+[a-zA-Z0-9_]+)[\s\S]+/);
    if (codeMatch && codeMatch.index !== undefined) {
      const beforeCode = escaped.slice(0, codeMatch.index).trim();
      const codePart = escaped.slice(codeMatch.index).trim();
      return `
        <div>${beforeCode.replace(/\n\n/g, '<br><br>')}</div>
        <pre class="answer-code-block"><code>${codePart}</code></pre>
      `;
    }

    // Format numbered lists cleanly
    escaped = escaped.replace(/\n\n/g, '<br><br>');
    return escaped;
  }

  function resetChat() {
    el.chatMessages.innerHTML = '';
    if (el.emptyStateHero) {
      el.chatMessages.appendChild(el.emptyStateHero);
      el.emptyStateHero.classList.remove('hidden');
    }
  }

  function scrollChat() {
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function removeElement(id) {
    const elem = document.getElementById(id);
    if (elem) elem.remove();
  }

  function setButtonLoading(btn, loading) {
    if (!btn) return;
    const label = btn.querySelector('.btn-label');
    const spinner = btn.querySelector('.btn-spinner');
    btn.disabled = loading;
    if (spinner) spinner.classList.toggle('hidden', !loading);
    if (label) label.style.opacity = loading ? '0.6' : '1';
  }

  // Run on DOM load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
