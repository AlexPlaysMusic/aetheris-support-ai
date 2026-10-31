import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';

const API_BASE = 'https://www.aetherisai.me';
const TOKEN_SECRET_KEY = 'aetheris.ide.accessToken';
const USER_STATE_KEY = 'aetheris.ide.user';
const PENDING_STATE_KEY = 'aetheris.ide.pendingState';
const ACCESS_TOKEN_PATTERN = /^aeth_vscode_[A-Za-z0-9_-]{43}$/;
const MAX_PROMPT_CHARS = 50_000;

type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

type SignedInUser = {
  email: string;
  name: string | null;
};

type EditTarget = {
  uri: vscode.Uri;
  range: vscode.Range;
  version: number;
  originalText: string;
};

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'signIn' }
  | { type: 'signOut' }
  | { type: 'newChat' }
  | { type: 'send'; text: unknown }
  | { type: 'stop' }
  | { type: 'apply' };

type RedeemResponse = {
  accessToken?: unknown;
  user?: { email?: unknown; name?: unknown };
  error?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function html(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };
    return entities[character] ?? character;
  });
}

function extractCodeBlock(value: string): string | null {
  const match = value.match(/```[^\r\n]*\r?\n([\s\S]*?)\r?\n```/);
  return match?.[1] ?? null;
}

class AetherisChatView implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private history: ChatMessage[] = [];
  private activeRequest: AbortController | undefined;
  private pendingEdit: EditTarget | undefined;
  private lastSuggestion: string | undefined;
  private signedInUser: SignedInUser | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = { enableScripts: true };
    view.webview.html = this.getHtml(view.webview);
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
      this.stopRequest();
    });
    view.webview.onDidReceiveMessage((message: WebviewMessage) => {
      switch (message.type) {
        case 'ready':
          this.publishState();
          break;
        case 'signIn':
          void this.signIn();
          break;
        case 'signOut':
          void this.signOut();
          break;
        case 'newChat':
          this.newChat();
          break;
        case 'send':
          if (typeof message.text === 'string') void this.sendPrompt(message.text);
          break;
        case 'stop':
          this.stopRequest();
          break;
        case 'apply':
          void this.applySuggestion();
          break;
        default:
          break;
      }
    });
  }

  show(): void {
    if (this.view) {
      this.view.show(true);
      return;
    }
    void vscode.commands.executeCommand('workbench.view.extension.aetheris');
  }

  async handleUri(uri: vscode.Uri): Promise<void> {
    if (uri.authority !== 'aetheris.aetheris-ai' || uri.path !== '/auth') return;
    const params = new URLSearchParams(uri.query);
    const state = params.get('state') ?? '';
    const ticket = params.get('ticket') ?? '';
    const expectedState = this.context.globalState.get<string>(PENDING_STATE_KEY);
    await this.context.globalState.update(PENDING_STATE_KEY, undefined);
    if (!expectedState || state !== expectedState || !/^[a-f0-9]{64}$/.test(ticket)) {
      void vscode.window.showErrorMessage('This Aetheris sign-in link is invalid or expired.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE}/api/ide-auth/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticket })
      });
      const data: RedeemResponse = await response.json();
      if (!response.ok || typeof data.accessToken !== 'string' ||
          !ACCESS_TOKEN_PATTERN.test(data.accessToken) ||
          typeof data.user?.email !== 'string') {
        throw new Error(data.error ?? 'Could not complete Aetheris sign-in.');
      }

      const previousToken = await this.context.secrets.get(TOKEN_SECRET_KEY);
      if (previousToken) await this.revokeToken(previousToken);
      await this.context.secrets.store(TOKEN_SECRET_KEY, data.accessToken);
      this.signedInUser = {
        email: data.user.email,
        name: typeof data.user.name === 'string' ? data.user.name : null
      };
      await this.context.globalState.update(USER_STATE_KEY, this.signedInUser);
      await vscode.commands.executeCommand('setContext', 'aetheris.signedIn', true);
      this.publishState();
      this.show();
      void vscode.window.showInformationMessage(`Signed in to Aetheris as ${this.signedInUser.email}.`);
    } catch (error) {
      console.error('[aetheris-vscode] sign-in callback failed:', error);
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'Could not complete Aetheris sign-in.'
      );
    }
  }

  async signIn(): Promise<void> {
    try {
      const state = randomBytes(32).toString('hex');
      await this.context.globalState.update(PENDING_STATE_KEY, state);
      const response = await fetch(`${API_BASE}/api/ide-auth/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ state })
      });
      const data: unknown = await response.json();
      if (!response.ok || !isRecord(data) || typeof data['authorizationUrl'] !== 'string') {
        const message =
          isRecord(data) && typeof data['error'] === 'string'
            ? data['error']
            : 'Could not start Aetheris sign-in.';
        throw new Error(message);
      }
      const authUrl = new URL(data['authorizationUrl']);
      if (authUrl.origin !== API_BASE) throw new Error('Aetheris returned an unexpected sign-in URL.');
      const opened = await vscode.env.openExternal(vscode.Uri.parse(authUrl.toString()));
      if (!opened) throw new Error('Could not open the Aetheris sign-in page in your browser.');
    } catch (error) {
      await this.context.globalState.update(PENDING_STATE_KEY, undefined);
      console.error('[aetheris-vscode] could not start sign-in:', error);
      void vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'Could not start Aetheris sign-in.'
      );
    }
  }

  async signOut(): Promise<void> {
    const token = await this.context.secrets.get(TOKEN_SECRET_KEY);
    if (token) {
      try {
        await this.revokeToken(token);
      } catch (error) {
        console.error('[aetheris-vscode] session revocation failed:', error);
        const choice = await vscode.window.showWarningMessage(
          'Could not reach Aetheris to revoke this session. Remove the token from VS Code anyway?',
          'Sign Out Locally'
        );
        if (choice !== 'Sign Out Locally') return;
      }
    }
    await this.context.secrets.delete(TOKEN_SECRET_KEY);
    await this.context.globalState.update(USER_STATE_KEY, undefined);
    this.signedInUser = undefined;
    await vscode.commands.executeCommand('setContext', 'aetheris.signedIn', false);
    this.publishState();
    void vscode.window.showInformationMessage('Signed out of Aetheris in VS Code.');
  }

  async revokeToken(token: string): Promise<void> {
    const response = await fetch(`${API_BASE}/api/ide-auth/revoke`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!response.ok && response.status !== 401) {
      throw new Error('Aetheris could not revoke the VS Code session.');
    }
  }

  async sendPrompt(prompt: string, editTarget?: EditTarget): Promise<void> {
    const text = prompt.trim();
    if (!text || text.length > MAX_PROMPT_CHARS) {
      void vscode.window.showWarningMessage('Enter a prompt under 50,000 characters.');
      return;
    }
    const token = await this.context.secrets.get(TOKEN_SECRET_KEY);
    if (!token || !ACCESS_TOKEN_PATTERN.test(token)) {
      this.publishState();
      void vscode.window.showInformationMessage('Sign in to Aetheris before starting a chat.');
      this.show();
      return;
    }
    if (this.activeRequest) return;

    this.pendingEdit = editTarget;
    this.lastSuggestion = undefined;
    this.history.push({ role: 'user', content: text });
    this.post({ type: 'userMessage', text });
    this.post({ type: 'suggestion', available: false });
    const controller = new AbortController();
    this.activeRequest = controller;
    this.post({ type: 'requestStarted' });

    try {
      const response = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          messages: this.history.slice(-24),
          model: 'aetheris-basic'
        }),
        signal: controller.signal
      });
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null);
        const error =
          isRecord(body) && typeof body['message'] === 'string'
            ? body['message']
            : isRecord(body) && typeof body['error'] === 'string'
              ? body['error']
              : `Aetheris chat failed (${response.status}).`;
        if (response.status === 401) await this.signOut();
        throw new Error(error);
      }
      if (!response.body) throw new Error('Aetheris returned an empty chat response.');

      let answer = '';
      let pending = '';
      const decoder = new TextDecoder();
      const reader = response.body.getReader();
      const consumeLine = (line: string) => {
        if (line.startsWith('0:')) {
          const value: unknown = JSON.parse(line.slice(2));
          if (typeof value === 'string') {
            answer += value;
            this.post({ type: 'assistantChunk', text: answer });
          }
        } else if (line.startsWith('3:')) {
          const value: unknown = JSON.parse(line.slice(2));
          throw new Error(typeof value === 'string' ? value : 'Aetheris could not complete the request.');
        }
      };
      while (true) {
        const { done, value } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split('\n');
        pending = lines.pop() ?? '';
        for (const line of lines) {
          if (line.trim() !== '') consumeLine(line.replace(/\r$/, ''));
        }
        if (done) break;
      }
      if (pending.trim() !== '') consumeLine(pending);
      if (answer.trim() === '') throw new Error('Aetheris returned an empty answer. Please try again.');
      this.history.push({ role: 'assistant', content: answer });
      this.history = this.history.slice(-24);
      this.lastSuggestion = extractCodeBlock(answer) ?? undefined;
      this.post({ type: 'suggestion', available: Boolean(this.lastSuggestion && this.pendingEdit) });
    } catch (error) {
      if (controller.signal.aborted) {
        this.post({ type: 'requestStopped' });
      } else {
        if (this.history.at(-1)?.role === 'user') this.history.pop();
        console.error('[aetheris-vscode] chat request failed:', error);
        this.post({
          type: 'error',
          text: error instanceof Error ? error.message : 'Aetheris could not complete the request.'
        });
      }
    } finally {
      if (this.activeRequest === controller) this.activeRequest = undefined;
      this.post({ type: 'requestFinished' });
    }
  }

  async applySuggestion(): Promise<void> {
    const target = this.pendingEdit;
    const suggestion = this.lastSuggestion;
    if (!target || !suggestion) {
      void vscode.window.showInformationMessage('Ask Aetheris to fix or generate code first.');
      return;
    }
    const preview = suggestion.length > 500 ? `${suggestion.slice(0, 500)}…` : suggestion;
    const confirm = await vscode.window.showWarningMessage(
      'Apply Aetheris code suggestion?',
      {
        modal: true,
        detail: `${target.uri.fsPath}\n\n${preview}`
      },
      'Apply Suggestion'
    );
    if (confirm !== 'Apply Suggestion') return;

    const document = await vscode.workspace.openTextDocument(target.uri);
    if (document.version !== target.version ||
        document.getText(target.range) !== target.originalText) {
      void vscode.window.showErrorMessage(
        'The file changed since this suggestion was requested. Ask Aetheris again before applying it.'
      );
      return;
    }
    const editor = await vscode.window.showTextDocument(document);
    const applied = await editor.edit((editBuilder) => {
      editBuilder.replace(target.range, suggestion);
    });
    if (!applied) {
      void vscode.window.showErrorMessage('VS Code could not apply the code suggestion.');
      return;
    }
    this.pendingEdit = undefined;
    this.lastSuggestion = undefined;
    this.post({ type: 'suggestion', available: false });
    void vscode.window.showInformationMessage('Aetheris suggestion applied. Review and save your changes.');
  }

  newChat(): void {
    this.stopRequest();
    this.history = [];
    this.pendingEdit = undefined;
    this.lastSuggestion = undefined;
    this.post({ type: 'clear' });
  }

  explainSelection(): void {
    const editor = vscode.window.activeTextEditor;
    const code = editor?.document.getText(editor.selection).trim();
    if (!editor || !code) {
      void vscode.window.showInformationMessage('Select some code to explain.');
      return;
    }
    const language = editor.document.languageId;
    void this.sendPrompt(
      `Explain this selected ${language} code. Describe what it does and point out any important behavior or edge cases:\n\n\`\`\`${language}\n${code}\n\`\`\``
    );
  }

  fixSelection(): void {
    const editor = vscode.window.activeTextEditor;
    const code = editor?.document.getText(editor.selection);
    if (!editor || !code?.trim()) {
      void vscode.window.showInformationMessage('Select the code you want Aetheris to fix.');
      return;
    }
    const target = this.captureEditTarget(editor);
    const language = editor.document.languageId;
    void this.sendPrompt(
      `Suggest a fix for this ${language} code. Return only the corrected replacement code in one fenced code block. Do not include an explanation outside the code block.\n\n\`\`\`${language}\n${code}\n\`\`\``,
      target
    );
  }

  async generateCode(): Promise<void> {
    const request = await vscode.window.showInputBox({
      prompt: 'Describe the code you want Aetheris to generate',
      placeHolder: 'e.g. Add a typed helper that validates an email address',
      ignoreFocusOut: true
    });
    if (!request?.trim()) return;
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      void vscode.window.showInformationMessage('Open an editor to receive generated code.');
      return;
    }
    const target = this.captureEditTarget(editor);
    const language = editor.document.languageId;
    void this.sendPrompt(
      `Generate ${language} code for this request: ${request.trim()}\nReturn only the code in one fenced code block, with no explanation outside it.`,
      target
    );
  }

  private captureEditTarget(editor: vscode.TextEditor): EditTarget {
    return {
      uri: editor.document.uri,
      range: new vscode.Range(
        editor.selection.start,
        editor.selection.end
      ),
      version: editor.document.version,
      originalText: editor.document.getText(editor.selection)
    };
  }

  private stopRequest(): void {
    this.activeRequest?.abort();
  }

  private async publishState(): Promise<void> {
    const storedUser = this.context.globalState.get<SignedInUser>(USER_STATE_KEY);
    const token = await this.context.secrets.get(TOKEN_SECRET_KEY);
    if (!this.signedInUser && storedUser && token) this.signedInUser = storedUser;
    const signedIn = Boolean(token && ACCESS_TOKEN_PATTERN.test(token));
    await vscode.commands.executeCommand('setContext', 'aetheris.signedIn', signedIn);
    this.post({ type: 'auth', user: signedIn ? this.signedInUser : undefined });
    for (const message of this.history) {
      this.post({ type: 'historyMessage', role: message.role, text: message.content });
    }
  }

  private post(message: Record<string, unknown>): void {
    void this.view?.webview.postMessage(message);
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = randomBytes(16).toString('base64');
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <title>Aetheris AI</title>
  <style>
    :root { color-scheme: dark; }
    * { box-sizing: border-box; }
    body { margin: 0; padding: 14px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); font: 13px var(--vscode-font-family); }
    header { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-bottom:12px; }
    h1 { margin:0; color:#67e8f9; font-size:15px; font-weight:650; }
    button { border:1px solid var(--vscode-button-border, transparent); border-radius:5px; padding:6px 9px; color:var(--vscode-button-foreground); background:var(--vscode-button-background); cursor:pointer; }
    button:hover { background:var(--vscode-button-hoverBackground); }
    button:disabled { opacity:.5; cursor:default; }
    .secondary { color:var(--vscode-foreground); background:transparent; border-color:var(--vscode-panel-border); }
    .small { padding:4px 7px; font-size:11px; }
    #account, #notice { color:var(--vscode-descriptionForeground); font-size:11px; }
    #account { flex:1; text-align:right; overflow-wrap:anywhere; }
    #notice { margin:4px 0 12px; line-height:1.55; }
    #messages { display:flex; flex-direction:column; gap:10px; padding-bottom:12px; }
    .message { border:1px solid var(--vscode-panel-border); border-radius:7px; padding:9px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }
    .user { border-color:#0891b2; background:color-mix(in srgb, #0891b2 13%, transparent); }
    .assistant { background:var(--vscode-editor-background); }
    .role { display:block; margin-bottom:5px; color:var(--vscode-descriptionForeground); font-size:10px; text-transform:uppercase; letter-spacing:.06em; }
    #composer { position:sticky; bottom:0; padding-top:8px; background:var(--vscode-sideBar-background); }
    textarea { width:100%; min-height:74px; max-height:220px; resize:vertical; border:1px solid var(--vscode-input-border, transparent); border-radius:6px; padding:9px; color:var(--vscode-input-foreground); background:var(--vscode-input-background); font:inherit; }
    .actions { display:flex; align-items:center; justify-content:space-between; gap:8px; margin-top:7px; }
    .actions > div { display:flex; gap:6px; }
    #apply { width:100%; margin-top:7px; }
    #auth { display:flex; align-items:center; gap:7px; }
    #signout { display:none; }
    #status { color:var(--vscode-descriptionForeground); font-size:11px; }
  </style>
</head>
<body>
  <header>
    <h1>Aetheris AI</h1>
    <span id="account">Not signed in</span>
  </header>
  <div id="auth"><button id="signin">Sign in</button><button id="signout" class="secondary small">Sign out</button></div>
  <p id="notice">Sign in with your Aetheris account to chat. Prompts are processed by Google Gemini through Aetheris.</p>
  <div id="messages" role="log" aria-live="polite"></div>
  <div id="composer">
    <textarea id="prompt" aria-label="Message Aetheris" placeholder="Ask Aetheris about your code…" maxlength="${MAX_PROMPT_CHARS}"></textarea>
    <div class="actions">
      <span id="status"></span>
      <div><button id="stop" class="secondary small" hidden>Stop</button><button id="send">Send</button></div>
    </div>
    <button id="apply" class="secondary" hidden>Review and apply code suggestion…</button>
  </div>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const messages = document.getElementById('messages');
    const prompt = document.getElementById('prompt');
    const send = document.getElementById('send');
    const stop = document.getElementById('stop');
    const apply = document.getElementById('apply');
    const status = document.getElementById('status');
    const account = document.getElementById('account');
    const signIn = document.getElementById('signin');
    const signOut = document.getElementById('signout');
    let activeAssistant;
    function addMessage(role, text) {
      const article = document.createElement('article');
      article.className = 'message ' + role;
      const label = document.createElement('span');
      label.className = 'role';
      label.textContent = role === 'user' ? 'You' : 'Aetheris';
      const content = document.createElement('div');
      content.textContent = text;
      article.append(label, content);
      messages.appendChild(article);
      messages.scrollTop = messages.scrollHeight;
      return content;
    }
    send.addEventListener('click', () => {
      const text = prompt.value.trim();
      if (!text) return;
      prompt.value = '';
      vscode.postMessage({ type: 'send', text });
    });
    prompt.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        send.click();
      }
    });
    document.getElementById('signin').addEventListener('click', () => vscode.postMessage({ type: 'signIn' }));
    document.getElementById('signout').addEventListener('click', () => vscode.postMessage({ type: 'signOut' }));
    document.getElementById('stop').addEventListener('click', () => vscode.postMessage({ type: 'stop' }));
    document.getElementById('apply').addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
    window.addEventListener('message', (event) => {
      const message = event.data;
      switch (message.type) {
        case 'auth':
          account.textContent = message.user ? (message.user.name || message.user.email) : 'Not signed in';
          signIn.style.display = message.user ? 'none' : '';
          signOut.style.display = message.user ? '' : 'none';
          break;
        case 'historyMessage':
          addMessage(message.role, message.text);
          break;
        case 'userMessage':
          addMessage('user', message.text);
          break;
        case 'assistantChunk':
          if (!activeAssistant) activeAssistant = addMessage('assistant', '');
          activeAssistant.textContent = message.text;
          messages.scrollTop = messages.scrollHeight;
          break;
        case 'requestStarted':
          activeAssistant = undefined;
          status.textContent = 'Aetheris is responding…';
          send.disabled = true;
          stop.hidden = false;
          break;
        case 'requestFinished':
        case 'requestStopped':
          status.textContent = '';
          send.disabled = false;
          stop.hidden = true;
          activeAssistant = undefined;
          break;
        case 'error':
          addMessage('assistant', message.text);
          break;
        case 'suggestion':
          apply.hidden = !message.available;
          break;
        case 'clear':
          messages.replaceChildren();
          apply.hidden = true;
          break;
      }
    });
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}

export function activate(context: vscode.ExtensionContext): void {
  const chat = new AetherisChatView(context);
  const providerRegistration = vscode.window.registerWebviewViewProvider(
    'aetheris.chatView',
    chat,
    { webviewOptions: { retainContextWhenHidden: true } }
  );
  const uriRegistration = vscode.window.registerUriHandler({
    handleUri: (uri) => chat.handleUri(uri)
  });

  context.subscriptions.push(
    providerRegistration,
    uriRegistration,
    vscode.commands.registerCommand('aetheris.signIn', () => chat.signIn()),
    vscode.commands.registerCommand('aetheris.signOut', () => chat.signOut()),
    vscode.commands.registerCommand('aetheris.explainSelection', () => chat.explainSelection()),
    vscode.commands.registerCommand('aetheris.fixSelection', () => chat.fixSelection()),
    vscode.commands.registerCommand('aetheris.generateCode', () => chat.generateCode()),
    vscode.commands.registerCommand('aetheris.applyLastResponse', () => chat.applySuggestion()),
    vscode.commands.registerCommand('aetheris.newChat', () => chat.newChat())
  );
}

export function deactivate(): void {}
