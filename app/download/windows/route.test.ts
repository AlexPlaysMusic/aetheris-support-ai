import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import { GET } from './route';

vi.mock('@vercel/blob', () => ({
  issueSignedToken: vi.fn(),
  list: vi.fn(),
  presignUrl: vi.fn()
}));

const mockList = vi.mocked(list);
const mockIssueSignedToken = vi.mocked(issueSignedToken);
const mockPresignUrl = vi.mocked(presignUrl);
const signedToken = {
  delegationToken: 'delegation-token',
  clientSigningToken: 'client-signing-token',
  validUntil: Date.now() + 60 * 60 * 1000
};
const signedUrl = {
  presignedUrl:
    'https://store.private.blob.vercel-storage.com/downloads/installer.exe?signature=signed'
};

describe('Windows installer download route', () => {
  beforeEach(() => {
    mockList.mockReset();
    mockIssueSignedToken.mockReset().mockResolvedValue(signedToken);
    mockPresignUrl.mockReset().mockResolvedValue(signedUrl);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('redirects to a signed private installer download URL', async () => {
    mockList.mockResolvedValue({
      blobs: [
        {
          pathname: 'downloads/Aetheris-AI-Setup-latest-x64.exe',
          url: 'https://store.private.blob.vercel-storage.com/downloads/installer.exe',
          downloadUrl:
            'https://store.private.blob.vercel-storage.com/downloads/installer.exe?download=1',
          size: 121_000_000,
          uploadedAt: new Date(),
          etag: '"installer-etag"'
        }
      ],
      cursor: undefined,
      hasMore: false
    });

    const response = await GET();

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(signedUrl.presignedUrl);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(mockIssueSignedToken).toHaveBeenCalledWith(
      expect.objectContaining({
        pathname: 'downloads/Aetheris-AI-Setup-latest-x64.exe',
        operations: ['get']
      })
    );
    expect(mockPresignUrl).toHaveBeenCalledWith(
      signedToken,
      expect.objectContaining({
        access: 'private',
        operation: 'get',
        pathname: 'downloads/Aetheris-AI-Setup-latest-x64.exe',
        useCache: false
      })
    );
  });

  it('returns 404 before an installer has been uploaded', async () => {
    mockList.mockResolvedValue({ blobs: [], cursor: undefined, hasMore: false });

    const response = await GET();

    expect(response.status).toBe(404);
  });

  it('returns 503 and logs when Blob storage cannot be reached', async () => {
    const error = new Error('storage unavailable');
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockRejectedValue(error);

    const response = await GET();

    expect(response.status).toBe(503);
    expect(logError).toHaveBeenCalledWith(
      '[downloads/windows] installer lookup failed:',
      error
    );
    logError.mockRestore();
  });

  it('refuses to sign a blob URL outside the private Vercel Blob host', async () => {
    const logError = vi.spyOn(console, 'error').mockImplementation(() => {});
    mockList.mockResolvedValue({
      blobs: [
        {
          pathname: 'downloads/Aetheris-AI-Setup-latest-x64.exe',
          url: 'https://attacker.example/installer.exe',
          downloadUrl: 'https://attacker.example/installer.exe?download=1',
          size: 1,
          uploadedAt: new Date(),
          etag: '"installer-etag"'
        }
      ],
      cursor: undefined,
      hasMore: false
    });

    const response = await GET();

    expect(response.status).toBe(503);
    expect(logError).toHaveBeenCalled();
    logError.mockRestore();
  });
});
