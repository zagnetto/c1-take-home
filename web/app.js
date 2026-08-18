let userId;
let userName;
let ws;
let activeConversation;
let conversations = [];
let oldestLoadedId = null;
let loadingOlder = false;
let hasMoreMessages = false;

const MESSAGE_PAGE_LIMIT = 50;

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
  await loadConversations();
}

function renderUser() {
  document.getElementById('userBadge').textContent = userName ?? `#${userId}`;
}

async function loadConversations() {
  const res = await fetch('/api/conversations', fetchOpts);
  conversations = await res.json();
  renderSidebar();
  connectWs();
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

function connectWs() {
  if (ws) ws.close();
  ws = new WebSocket(`ws://${location.host}/`);
  ws.onopen = () =>
    ws.send(JSON.stringify({ type: 'subscribe', conversationIds: conversations.map((c) => c.id) }));
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
  const input = document.getElementById('text');
  const body = input.value.trim();
  if (!body || !activeConversation) return;
  input.value = '';
  await fetch('/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...fetchOpts,
    body: JSON.stringify({
      conversationId: activeConversation,
      body,
      clientId: crypto.randomUUID(),
    }),
  });
};

document.getElementById('newConv').onclick = async () => {
  const title = prompt('Conversation title?');
  if (!title) return;
  await fetch('/api/conversations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...fetchOpts,
    body: JSON.stringify({ title, participantIds: [2] }),
  });
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
