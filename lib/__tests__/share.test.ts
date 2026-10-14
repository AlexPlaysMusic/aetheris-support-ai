import { describe, expect, it } from 'vitest';
import type { Message } from 'ai';
import { buildShareLink, decodeShareChat } from '../share';

function userMsg(content: string, images: string[] = []): Message {
  return {
    id: `u-${content.length}-${images.length}`,
    role: 'user',
    content,
    experimental_attachments: images.map((url, i) => ({
      name: `img-${i}.jpg`,
      contentType: 'image/jpeg',
      url
    }))
  } as Message;
}

function asstMsg(content: string): Message {
  return { id: `a-${content.length}`, role: 'assistant', content } as Message;
}

describe('share codec round-trip', () => {
  it('encodes and decodes a mixed chat', () => {
    const thread = {
      title: 'Trip plans',
      messages: [
        userMsg('Hello **there**', ['data:image/jpeg;base64,AAA']),
        asstMsg('Hi! Here you go.')
      ]
    };
    const link = buildShareLink(thread, 'https://example.com');
    expect(link).not.toBeNull();
    expect(link as string).toMatch(/^https:\/\/example\.com\/share#[A-Za-z0-9\-_]+$/);
    const hash = (link as string).split('#')[1];
    const decoded = decodeShareChat(`#${hash}`);
    expect(decoded?.title).toBe('Trip plans');
    expect(decoded?.messages).toHaveLength(2);
    expect(decoded?.messages[0]).toMatchObject({
      role: 'user',
      content: 'Hello **there**',
      images: ['data:image/jpeg;base64,AAA']
    });
    expect(decoded?.messages[1]).toMatchObject({ role: 'assistant' });
  });

  it('rejects empty and garbage input', () => {
    expect(decodeShareChat('')).toBeNull();
    expect(decodeShareChat('#')).toBeNull();
    expect(decodeShareChat('#not-base64!!!')).toBeNull();
    expect(decodeShareChat('#e30=')).toBeNull(); // valid base64, not a chat
  });

  it('drops photos before giving up on oversized chats', () => {
    const bigImages = ['A', 'B', 'C', 'D'].map(
      (ch) => `data:image/jpeg;base64,${ch.repeat(40_000)}`
    );
    const thread = {
      title: 'Big',
      messages: [userMsg('look', bigImages)]
    };
    const link = buildShareLink(thread, 'https://example.com');
    expect(link).not.toBeNull();
    const decoded = decodeShareChat(`#${(link as string).split('#')[1]}`);
    expect(decoded?.messages[0].content).toBe('look');
    expect(decoded?.messages[0].images).toEqual([]);
  });

  it('returns null when even text-only is too big', () => {
    const thread = {
      title: 'Huge',
      messages: Array.from({ length: 60 }, (_, i) =>
        userMsg(`message number ${i} ` + 'x'.repeat(6000))
      )
    };
    expect(buildShareLink(thread, 'https://example.com')).toBeNull();
  });

  it('caps lengths and normalizes roles', () => {
    const thread = {
      title: 't'.repeat(500),
      messages: [
        { id: 'x', role: 'system', content: 'y'.repeat(9000) } as unknown as Message
      ]
    };
    const link = buildShareLink(thread, 'https://example.com');
    expect(link).not.toBeNull();
    const decoded = decodeShareChat(`#${(link as string).split('#')[1]}`);
    expect(decoded?.title.length).toBeLessThanOrEqual(120);
    expect(decoded?.messages[0].role).toBe('assistant');
    expect(decoded?.messages[0].content.length).toBeLessThanOrEqual(6000);
  });
});
