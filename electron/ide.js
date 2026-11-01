const state = { root: null, files: new Map(), active: null, lastResponse: '' };
const $ = (id) => document.getElementById(id);
const api = window.aetheris;

function renderLines() {
  const count = Math.max(1, $('editor').value.split('\n').length);
  $('line-numbers').textContent = Array.from({ length: count }, (_, i) => i + 1).join('\n');
}

function renderTabs() {
  $('tabs').replaceChildren(...Array.from(state.files.keys()).map((filePath) => {
    const tab = document.createElement('button');
    tab.className = `tab ${filePath === state.active ? 'active' : ''}`;
    tab.textContent = filePath.split(/[\\/]/).pop();
    tab.onclick = () => openFile(filePath);
    return tab;
  }));
}

async function openFile(filePath) {
  if (!state.files.has(filePath)) state.files.set(filePath, await api.readFile(filePath));
  state.active = filePath;
  $('editor').value = state.files.get(filePath);
  $('language').textContent = filePath.split('.').pop()?.toUpperCase() || 'Plain Text';
  renderTabs();
  renderLines();
  $('status-message').textContent = filePath;
}

function createTree(items, parent = $('file-tree')) {
  parent.replaceChildren();
  for (const item of items) {
    const row = document.createElement('div');
    row.className = `tree-item ${item.directory ? 'tree-folder' : 'tree-file'}`;
    row.textContent = `${item.directory ? '▸' : '◇'} ${item.name}`;
    if (item.directory) {
      row.onclick = async () => {
        const children = await api.listFiles(item.path);
        const child = document.createElement('div');
        child.className = 'file-tree';
        createTree(children, child);
        row.after(child);
      };
    } else row.onclick = () => openFile(item.path);
    parent.append(row);
  }
}

async function chooseWorkspace() {
  const root = await api.chooseWorkspace();
  if (!root) return;
  state.root = root;
  $('workspace-name').textContent = root.split(/[\\/]/).pop();
  createTree(await api.listFiles(root));
  $('status-message').textContent = 'Workspace opened';
}

function appendTerminal(value) {
  const output = $('terminal-output');
  output.textContent += value;
  output.scrollTop = output.scrollHeight;
}

async function sendChat(prompt) {
  if (!prompt.trim()) return;
  const context = state.active ? `\n\nCurrent file (${state.active}):\n${$('editor').value}` : '';
  const user = document.createElement('div');
  user.className = 'message user-message';
  user.textContent = prompt;
  $('messages').append(user);
  const answer = document.createElement('div');
  answer.className = 'message assistant-message';
  answer.textContent = 'Thinking...';
  $('messages').append(answer);
  $('messages').scrollTop = $('messages').scrollHeight;
  try {
    const response = await fetch('https://www.aetherisai.me/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: prompt + context }], model: 'aetheris-basic' })
    });
    if (!response.ok) throw new Error(`Aetheris returned HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    answer.textContent = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      answer.textContent += decoder.decode(value, { stream: true });
    }
    state.lastResponse = answer.textContent;
  } catch (error) {
    answer.textContent = `Unable to reach Aetheris: ${error.message}`;
  }
  $('messages').scrollTop = $('messages').scrollHeight;
}

$('open-folder').onclick = chooseWorkspace;
$('editor').addEventListener('input', () => {
  if (state.active) state.files.set(state.active, $('editor').value);
  renderLines();
});
$('editor').addEventListener('keydown', async (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    if (!state.active) return;
    await api.writeFile(state.active, $('editor').value);
    state.files.set(state.active, $('editor').value);
    $('status-message').textContent = 'Saved';
  }
});
$('editor').addEventListener('keyup', (event) => {
  const before = $('editor').value.slice(0, $('editor').selectionStart);
  $('cursor-position').textContent = `Ln ${before.split('\n').length}, Col ${before.split('\n').pop().length + 1}`;
});
$('terminal-form').onsubmit = async (event) => {
  event.preventDefault();
  const command = $('terminal-input').value.trim();
  if (!command || !state.root) return;
  $('terminal-input').value = '';
  appendTerminal(`\n$ ${command}\n`);
  await api.runCommand(command, state.root);
};
api.onTerminalOutput(appendTerminal);
$('clear-terminal').onclick = () => { $('terminal-output').textContent = ''; };
$('chat-form').onsubmit = (event) => { event.preventDefault(); const input = $('chat-input'); const text = input.value; input.value = ''; void sendChat(text); };
$('chat-input').onkeydown = (event) => { if (event.key === 'Enter' && event.ctrlKey) { event.preventDefault(); $('chat-form').requestSubmit(); } };
document.querySelectorAll('[data-prompt]').forEach((button) => { button.onclick = () => void sendChat(button.dataset.prompt); });
$('insert-response').onclick = () => { if (state.active && state.lastResponse) { $('editor').setRangeText(state.lastResponse, $('editor').selectionStart, $('editor').selectionEnd, 'end'); $('editor').dispatchEvent(new Event('input')); } };
$('sign-in').onclick = () => void api.openExternal('https://www.aetherisai.me/desktop-auth/start');
