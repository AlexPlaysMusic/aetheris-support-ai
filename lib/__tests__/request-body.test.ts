import { describe, expect, it } from 'vitest';
import { readBoundedJson, RequestBodyTooLargeError } from '../request-body';

describe('readBoundedJson', () => {
  it('parses valid JSON within the configured byte limit', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ message: 'hello' })
    });

    await expect(readBoundedJson(request, 64)).resolves.toEqual({ message: 'hello' });
  });

  it('rejects oversized streamed bodies', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: JSON.stringify({ message: 'too long' })
    });

    await expect(readBoundedJson(request, 4)).rejects.toBeInstanceOf(
      RequestBodyTooLargeError
    );
  });

  it('rejects malformed JSON', async () => {
    const request = new Request('https://example.test', {
      method: 'POST',
      body: '{'
    });

    await expect(readBoundedJson(request, 64)).rejects.toBeInstanceOf(SyntaxError);
  });
});
