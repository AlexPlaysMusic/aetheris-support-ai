import type { Message } from 'ai';

/** Pull image URLs out of a chat message (file parts or attachments). */
export function messageImages(m: Message): string[] {
  const urls: string[] = [];
  if (m === null || typeof m !== 'object') return urls;
  const withParts = m as unknown as { parts?: unknown };
  if (Array.isArray(withParts.parts)) {
    for (const part of withParts.parts) {
      const p =
        part !== null && typeof part === 'object'
          ? (part as Record<string, unknown>)
          : null;
      if (
        p?.type === 'file' &&
        typeof p['mimeType'] === 'string' &&
        (p['mimeType'] as string).startsWith('image/') &&
        typeof p['data'] === 'string'
      ) {
        urls.push(p['data'] as string);
      }
    }
  }
  const withAtts = m as unknown as { experimental_attachments?: unknown };
  if (Array.isArray(withAtts.experimental_attachments)) {
    for (const item of withAtts.experimental_attachments) {
      const a =
        item !== null && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null;
      if (typeof a?.url !== 'string') continue;
      const ct =
        typeof a['contentType'] === 'string' ? (a['contentType'] as string) : '';
      const url = a['url'] as string;
      if (ct.startsWith('image/') || url.startsWith('data:image')) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

export type SharedMessage = {
  role: 'user' | 'assistant';
  content: string;
  images: string[];
};

export type SharedChat = {
  title: string;
  messages: SharedMessage[];
};

export const SHARE_SIZE_LIMIT = 150_000;

/**
 * Build a shareable link embedding the chat in the URL hash (no server
 * storage needed). Photos ride along while the link stays small; oversized
 * chats share as text only. Returns null when even that is too big.
 */
export function buildShareLink(
  t: { title: string; messages: Message[] },
  origin: string
): string | null {
  const slim: {
    v: number;
    title: string;
    messages: SharedMessage[];
  } = {
    v: 1,
    title: t.title,
    messages: t.messages
      .filter((m) => m !== null && typeof m === 'object')
      .map((m) => {
        const record = m as unknown as Record<string, unknown>;
        return {
          role:
            record['role'] === 'user'
              ? ('user' as const)
              : ('assistant' as const),
          content:
            typeof record['content'] === 'string'
              ? (record['content'] as string).slice(0, 6000)
              : '',
          images: messageImages(m as Message).slice(0, 4)
        };
      })
      .filter((m) => m.content !== '' || m.images.length > 0)
  };
  const encode = (dropImages: boolean): string => {
    if (dropImages) {
      for (const m of slim.messages) m.images = [];
    }
    const bytes = new TextEncoder().encode(JSON.stringify(slim));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  };
  let code = encode(false);
  if (code.length > SHARE_SIZE_LIMIT) code = encode(true);
  if (code.length > SHARE_SIZE_LIMIT) return null;
  return `${origin}/share#${code}`;
}

/** Decode a share link hash back into a chat. Null = invalid/oversized. */
export function decodeShareChat(hash: string): SharedChat | null {
  try {
    const code = hash.startsWith('#') ? hash.slice(1) : hash;
    if (code === '') return null;
    const b64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(b64);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    const parsed = JSON.parse(json) as {
      title?: unknown;
      messages?: unknown;
    };
    if (!Array.isArray(parsed.messages)) return null;
    const messages: SharedMessage[] = [];
    for (const item of parsed.messages.slice(0, 200)) {
      if (item === null || typeof item !== 'object') continue;
      const record = item as Record<string, unknown>;
      const content =
        typeof record['content'] === 'string'
          ? (record['content'] as string).slice(0, 20000)
          : '';
      const images = Array.isArray(record['images'])
        ? (record['images'] as unknown[])
            .filter((u): u is string => typeof u === 'string')
            .slice(0, 4)
        : [];
      if (content === '' && images.length === 0) continue;
      messages.push({
        role: record['role'] === 'user' ? 'user' : 'assistant',
        content,
        images
      });
    }
    if (messages.length === 0) return null;
    return {
      title:
        typeof parsed.title === 'string' && parsed.title !== ''
          ? parsed.title.slice(0, 120)
          : 'Shared chat',
      messages
    };
  } catch {
    return null;
  }
}
