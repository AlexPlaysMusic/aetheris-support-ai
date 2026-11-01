import { issueSignedToken, list, presignUrl } from '@vercel/blob';
import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const INSTALLER_PATH = 'downloads/Aetheris-AI-Setup-latest-x64.exe';
const DOWNLOAD_LINK_LIFETIME_MS = 60 * 60 * 1000;

export async function GET() {
  try {
    const { blobs } = await list({ prefix: INSTALLER_PATH, limit: 1 });
    const installer = blobs.find((blob) => blob.pathname === INSTALLER_PATH);

    if (!installer) {
      return new NextResponse('Windows installer is not available yet.', {
        status: 404,
        headers: { 'Cache-Control': 'no-store' }
      });
    }

    const blobUrl = new URL(installer.url);
    if (
      blobUrl.protocol !== 'https:' ||
      !blobUrl.hostname.endsWith('.private.blob.vercel-storage.com')
    ) {
      throw new Error('Installer blob URL is not a private Vercel Blob URL.');
    }

    const validUntil = Date.now() + DOWNLOAD_LINK_LIFETIME_MS;
    const signedToken = await issueSignedToken({
      pathname: INSTALLER_PATH,
      operations: ['get'],
      validUntil
    });
    const { presignedUrl } = await presignUrl(signedToken, {
      access: 'private',
      operation: 'get',
      pathname: INSTALLER_PATH,
      validUntil,
      useCache: false
    });

    return NextResponse.redirect(presignedUrl, {
      status: 307,
      headers: { 'Cache-Control': 'no-store' }
    });
  } catch (error) {
    console.error('[downloads/windows] installer lookup failed:', error);
    return new NextResponse('Windows installer is temporarily unavailable.', {
      status: 503,
      headers: { 'Cache-Control': 'no-store' }
    });
  }
}
