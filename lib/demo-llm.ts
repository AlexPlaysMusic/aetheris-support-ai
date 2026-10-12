import type {
  LanguageModelV1,
  LanguageModelV1CallOptions,
  LanguageModelV1Prompt
} from '@ai-sdk/provider';

/* ------------------------------------------------------------------ */
/* Demo provider — streams a canned reply so the UI works end-to-end   */
/* with no external API. Set LLM_PROVIDER=custom (plus CUSTOM_API_URL) */
/* in .env.local to use your real endpoint instead.                    */
/* ------------------------------------------------------------------ */

function promptToText(prompt: LanguageModelV1Prompt): string {
  let lastUser = '';
  for (const message of prompt) {
    const record =
      message !== null && typeof message === 'object'
        ? (message as Record<string, unknown>)
        : {};
    if (record['role'] !== 'user') continue;
    const content = record['content'];
    if (typeof content === 'string') {
      lastUser = content;
    } else if (Array.isArray(content)) {
      const text = content
        .map((part) => {
          const p =
            part !== null && typeof part === 'object'
              ? (part as Record<string, unknown>)
              : {};
          return p['type'] === 'text' && typeof p['text'] === 'string'
            ? p['text']
            : '';
        })
        .join('');
      if (text) lastUser = text;
    }
  }
  return lastUser.trim();
}

function countPromptImages(prompt: LanguageModelV1Prompt): number {
  let n = 0;
  for (const message of prompt) {
    const record =
      message !== null && typeof message === 'object'
        ? (message as Record<string, unknown>)
        : {};
    if (record['role'] !== 'user' || !Array.isArray(record['content'])) continue;
    for (const part of record['content']) {
      const p =
        part !== null && typeof part === 'object'
          ? (part as Record<string, unknown>)
          : {};
      if (p['type'] === 'image') n += 1;
    }
  }
  return n;
}

function buildDemoReply(userText: string, modelId: string, imageCount: number): string {
  const quoted = userText.length > 160 ? `${userText.slice(0, 160)}…` : userText;
  const edition = modelId.includes('pro') ? 'Pro (v1.0)' : 'Basic (Free)';
  return [
    `You're running **Aetheris ${edition}** in **demo mode** — no external API connected yet.`,
    '',
    quoted ? `You said: _"${quoted}"_` : 'Send a message and I’ll echo it back here.',
    imageCount > 0
      ? `I can see ${imageCount} attached photo${imageCount === 1 ? '' : 's'}, but demo mode can't interpret images — switch to Gemini (\`LLM_PROVIDER=gemini\`) for real vision.`
      : '',
    '',
    'Here’s what a real answer will look like, with full formatting:',
    '',
    '- **Bold** highlights and clean bullet lists',
    '- Numbered steps when you ask how to do something',
    '- Fenced code blocks with a 1-click Copy button',
    '',
    '```ts',
    'const greeting = "Hello from Aetheris";',
    'console.log(greeting);',
    '```',
    '',
    'To connect your custom endpoint, set in `.env.local`:',
    '',
    '```env',
    'LLM_PROVIDER=custom',
    'CUSTOM_API_URL=https://your-server/v1/chat/completions',
    'CUSTOM_BASIC_MODEL=your-basic-model',
    'CUSTOM_PRO_MODEL=your-pro-model',
    '```',
    '',
    'Then restart the dev server and chat for real. ✨'
  ].join('\n');
}

const CHUNK_SIZE = 24;
const CHUNK_DELAY_MS = 18;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createDemoChatModel(modelId: string): LanguageModelV1 {
  const replyFor = (options: LanguageModelV1CallOptions): string =>
    buildDemoReply(
      promptToText(options.prompt),
      modelId,
      countPromptImages(options.prompt)
    );

  return {
    specificationVersion: 'v1',
    provider: 'demo',
    modelId,
    defaultObjectGenerationMode: undefined,

    async doGenerate(options: LanguageModelV1CallOptions) {
      return {
        text: replyFor(options),
        finishReason: 'stop',
        usage: { promptTokens: 0, completionTokens: 0 },
        rawCall: { rawPrompt: options.prompt, rawSettings: {} as Record<string, unknown> }
      };
    },

    async doStream(options: LanguageModelV1CallOptions) {
      const full = replyFor(options);
      const stream = new ReadableStream<
        import('@ai-sdk/provider').LanguageModelV1StreamPart
      >({
        async start(controller) {
          try {
            for (let i = 0; i < full.length; i += CHUNK_SIZE) {
              if (options.abortSignal?.aborted) break;
              controller.enqueue({
                type: 'text-delta',
                textDelta: full.slice(i, i + CHUNK_SIZE)
              });
              await sleep(CHUNK_DELAY_MS);
            }
            controller.enqueue({
              type: 'finish',
              finishReason: 'stop',
              usage: { promptTokens: 0, completionTokens: 0 }
            });
            controller.close();
          } catch (err) {
            controller.enqueue({
              type: 'error',
              error: err instanceof Error ? err : new Error('Demo stream failed.')
            });
            controller.close();
          }
        },
        cancel() {
          /* stop button aborts via abortSignal */
        }
      });
      return {
        stream,
        rawCall: { rawPrompt: options.prompt, rawSettings: {} as Record<string, unknown> }
      };
    }
  };
}
