let userId;
let userName;
let ws;
let wsIntentionalClose = false;
let wsReconnectAttempt = 0;
let wsReconnectTimer = null;
let wsNeedsResync = false;
let activeConversation;
let conversations = [];
let oldestLoadedId = null;
let loadingOlder = false;
let hasMoreMessages = false;

let sendInFlight = false;

const MESSAGE_PAGE_LIMIT = 50;

function setComposerEnabled(enabled) {
  // Keep #text enabled during send so Enter-submit does not steal focus (sendInFlight blocks dupes).
  document.getElementById('sendBtn').disabled = !enabled;
}

const fetchOpts = { credentials: 'same-origin' };

async function fetchMessagePage(conversationId, { before, limit } = {}) {
  const params = new URLSearchParams({
    conversationId: String(conversationId),
    limit: String(limit ?? MESSAGE_PAGE_LIMIT),
  });
  if (before != null) params.set('before', String(before));
  const res = await fetch(`/api/messages?${params}`, fetchOpts);
  return res.json();
}

async function initSession() {
  const res = await fetch('/api/session', { method: 'POST', ...fetchOpts });
  if (res.status === 503) {
    document.getElementById('userBadge').textContent = 'All users busy';
    document.getElementById('title').textContent = 'No free users — try again later';
    return;
  }
  const body = await res.json();
  userId = body.userId;
  userName = body.name;
  renderUser();
  await loadConversations({ reconnectWs: true });
}

function renderUser() {
  document.getElementById('userBadge').textContent = userName ?? `#${userId}`;
}

async function loadConversations({ reconnectWs = false } = {}) {
  const res = await fetch('/api/conversations', fetchOpts);
  if (!res.ok) return;
  conversations = await res.json();
  renderSidebar();
  if (reconnectWs) {
    connectWs({ replace: true });
  } else if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: conversations.map((c) => c.id) }));
  } else {
    connectWs();
  }
}

function setWsStatus(state) {
  const el = document.getElementById('wsStatus');
  if (!el) return;
  el.dataset.state = state;
  const labels = { connected: 'Live', reconnecting: 'Reconnecting…', disconnected: 'Offline' };
  el.textContent = labels[state] ?? state;
}

function scheduleWsReconnect() {
  if (wsIntentionalClose || wsReconnectTimer) return;
  const base = Math.min(30_000, 1000 * 2 ** wsReconnectAttempt);
  const jitter = Math.floor(Math.random() * 500);
  wsReconnectAttempt += 1;
  setWsStatus('reconnecting');
  wsReconnectTimer = setTimeout(() => {
    wsReconnectTimer = null;
    connectWs();
  }, base + jitter);
}

async function resyncAfterReconnect() {
  const res = await fetch('/api/conversations', fetchOpts);
  conversations = await res.json();
  renderSidebar();
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: conversations.map((c) => c.id) }));
  }
  if (activeConversation) {
    const c = conversations.find((x) => x.id === activeConversation);
    await openConversation(activeConversation, c?.title ?? `#${activeConversation}`);
  }
}

function connectWs({ replace = false } = {}) {
  if (wsReconnectTimer) {
    clearTimeout(wsReconnectTimer);
    wsReconnectTimer = null;
  }
  if (replace && ws) {
    wsIntentionalClose = true;
    ws.close();
  }
  if (!replace && ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${scheme}://${location.host}/`);
  ws.onopen = async () => {
    wsReconnectAttempt = 0;
    setWsStatus('connected');
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: conversations.map((c) => c.id) }));
    if (wsNeedsResync) {
      wsNeedsResync = false;
      try {
        await resyncAfterReconnect();
      } catch {
        setWsStatus('disconnected');
        scheduleWsReconnect();
      }
    }
  };
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type !== 'message') return;
    const c = conversations.find((x) => x.id === msg.conversationId);
    if (c) c.messageCount += 1;
    if (msg.conversationId === activeConversation) {
      appendMessage(msg);
    } else if (c) {
      c.unread = true;
    }
    renderSidebar();
  };
  ws.onclose = () => {
    if (wsIntentionalClose) {
      wsIntentionalClose = false;
      return;
    }
    setWsStatus('disconnected');
    wsNeedsResync = true;
    scheduleWsReconnect();
  };
  ws.onerror = () => {
    /* close handler runs next */
  };
}

function renderSidebar() {
  const list = document.getElementById('conversations');
  list.innerHTML = '';
  for (const c of conversations) {
    const li = document.createElement('li');
    if (c.id === activeConversation) li.className = 'active';
    li.innerHTML =
      `<span>${c.title} (${c.messageCount})</span>` + (c.unread ? '<span class="dot">●</span>' : '');
    li.onclick = () => openConversation(c.id, c.title);
    list.appendChild(li);
  }
}

function renderEarlierHint() {
  const pane = document.getElementById('messages');
  let hint = pane.querySelector('.earlier-hint');
  if (!hasMoreMessages) {
    hint?.remove();
    return;
  }
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'msg earlier-hint';
    hint.style.color = '#888';
    hint.style.textAlign = 'center';
    hint.textContent = '↑ scroll up for earlier messages';
    pane.prepend(hint);
  }
}

async function openConversation(id, title) {
  activeConversation = id;
  oldestLoadedId = null;
  hasMoreMessages = false;
  const c = conversations.find((x) => x.id === id);
  if (c) c.unread = false;
  renderSidebar();

  document.getElementById('title').textContent = title;
  const page = await fetchMessagePage(id, { limit: MESSAGE_PAGE_LIMIT });
  const pane = document.getElementById('messages');
  pane.innerHTML = '';
  for (const m of page.messages) appendMessage(m, { scroll: false });
  oldestLoadedId = page.nextBefore;
  hasMoreMessages = page.hasMore;
  renderEarlierHint();
  pane.scrollTop = pane.scrollHeight;
}

function createMessageElement(m) {
  const div = document.createElement('div');
  div.className = 'msg';
  div.textContent = `#${m.senderId}: ${m.body}`;
  return div;
}

async function loadOlderMessages() {
  if (!activeConversation || loadingOlder || !hasMoreMessages || oldestLoadedId == null) return;
  loadingOlder = true;
  const pane = document.getElementById('messages');
  const prevHeight = pane.scrollHeight;
  const prevTop = pane.scrollTop;

  const page = await fetchMessagePage(activeConversation, {
    before: oldestLoadedId,
    limit: MESSAGE_PAGE_LIMIT,
  });
  if (page.messages.length) {
    oldestLoadedId = page.nextBefore;
    hasMoreMessages = page.hasMore;
    const fragment = document.createDocumentFragment();
    for (const m of page.messages) fragment.appendChild(createMessageElement(m));
    const hint = pane.querySelector('.earlier-hint');
    if (hint) pane.insertBefore(fragment, hint.nextSibling);
    else pane.prepend(fragment);
    pane.scrollTop = prevTop + (pane.scrollHeight - prevHeight);
  } else {
    hasMoreMessages = false;
  }
  renderEarlierHint();
  loadingOlder = false;
}

function appendMessage(m, opts = {}) {
  const pane = document.getElementById('messages');
  pane.appendChild(createMessageElement(m));
  if (opts.scroll !== false) pane.scrollTop = pane.scrollHeight;
}

document.getElementById('messages').addEventListener('scroll', (ev) => {
  if (ev.target.scrollTop <= 24) void loadOlderMessages();
});

document.getElementById('composer').onsubmit = async (e) => {
  e.preventDefault();
  if (sendInFlight) return;
  const input = document.getElementById('text');
  const body = input.value.trim();
  if (!body || !activeConversation) return;

  const clientId = crypto.randomUUID();
  input.value = '';
  sendInFlight = true;
  setComposerEnabled(false);

  try {
    await fetch('/api/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      ...fetchOpts,
      body: JSON.stringify({
        conversationId: activeConversation,
        body,
        clientId,
      }),
    });
  } catch {
    input.value = body;
  } finally {
    sendInFlight = false;
    setComposerEnabled(true);
    input.focus();
  }
};

document.getElementById('newConv').onclick = async () => {
  const title = prompt('Conversation title?');
  if (!title) return;
  const res = await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...fetchOpts,
    body: JSON.stringify({ title, participantIds: [2] }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    alert(err.error ?? 'Could not create conversation');
    return;
  }
  await loadConversations();
};

document.getElementById('searchForm').onsubmit = async (e) => {
  e.preventDefault();
  const q = document.getElementById('search').value.trim();
  if (!q) return;
  const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, fetchOpts);
  renderResults(q, await res.json());
};

function renderResults(q, results) {
  activeConversation = null;
  document.getElementById('title').textContent = `Search: "${q}"`;
  const pane = document.getElementById('messages');
  pane.innerHTML = '';
  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'msg';
    empty.style.color = '#888';
    empty.textContent = 'No results.';
    pane.appendChild(empty);
    return;
  }
  for (const r of results) {
    const div = document.createElement('div');
    div.className = 'msg';
    div.style.cursor = 'pointer';
    const title = document.createElement('strong');
    title.textContent = r.conversationTitle ?? '#' + r.conversationId;
    div.append(title, ' — ' + (r.body ?? ''));
    div.onclick = () => openConversation(r.conversationId, r.conversationTitle ?? '#' + r.conversationId);
    pane.appendChild(div);
  }
}

initSession();
