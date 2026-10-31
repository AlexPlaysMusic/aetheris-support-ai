import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey
} from '@/lib/aetheris-api-keys';
import { limitRequest } from '@/lib/rate-limit';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/request-body';

const MAX_KEY_REQUEST_BYTES = 4096;

async function authenticatedOwner() {
  const session = await getServerSession(authOptions);
  return session?.user?.id || session?.user?.email || null;
}

export async function GET(req: Request) {
  const limited = limitRequest(req, {
    key: 'api-keys-list',
    limit: 30,
    windowMs: 60_000
  });
  if (limited) return limited;
  try {
    const ownerId = await authenticatedOwner();
    if (!ownerId) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    const keys = await listApiKeys(ownerId);
    return Response.json(
      {
        keys: keys.map(
          ({
            id,
            label,
            prefix,
            createdAt,
            revokedAt,
            requestCount,
            promptTokens,
            completionTokens,
            lastUsedAt
          }) => ({
            id,
            label,
            prefix,
            createdAt,
            revokedAt,
            requestCount,
            promptTokens,
            completionTokens,
            lastUsedAt
          })
        )
      },
      { headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    console.error('[aetheris/api-keys] list failed:', error);
    return Response.json({ error: 'API key storage is unavailable.' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const limited = limitRequest(req, {
    key: 'api-keys-create',
    limit: 5,
    windowMs: 60_000
  });
  if (limited) return limited;
  try {
    const ownerId = await authenticatedOwner();
    if (!ownerId) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    const body: unknown = await readBoundedJson(req, MAX_KEY_REQUEST_BYTES);
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const label = typeof record['label'] === 'string' ? record['label'].trim() : '';
    if (label === '' || label.length > 80) {
      return Response.json(
        { error: 'A key label between 1 and 80 characters is required.' },
        { status: 400 }
      );
    }
    const created = await createApiKey(ownerId, label);
    return Response.json(
      {
        key: created.key,
        record: {
          id: created.record.id,
          label: created.record.label,
          prefix: created.record.prefix,
          createdAt: created.record.createdAt
        }
      },
      { status: 201, headers: { 'Cache-Control': 'no-store' } }
    );
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('[aetheris/api-keys] create failed:', error);
    return Response.json({ error: 'API key storage is unavailable.' }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const limited = limitRequest(req, {
    key: 'api-keys-revoke',
    limit: 10,
    windowMs: 60_000
  });
  if (limited) return limited;
  try {
    const ownerId = await authenticatedOwner();
    if (!ownerId) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    const body: unknown = await readBoundedJson(req, MAX_KEY_REQUEST_BYTES);
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    const revoked = await revokeApiKey(ownerId, id);
    if (!revoked) {
      return Response.json(
        { error: 'API key was not found or is already revoked.' },
        { status: 404 }
      );
    }
    return Response.json({ revoked: true });
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return Response.json({ error: 'Request body is too large.' }, { status: 413 });
    }
    if (error instanceof SyntaxError) {
      return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    console.error('[aetheris/api-keys] revoke failed:', error);
    return Response.json({ error: 'API key storage is unavailable.' }, { status: 503 });
  }
}
