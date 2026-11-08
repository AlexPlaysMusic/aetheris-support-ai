import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import {
  createApiKey,
  listApiKeys,
  refreshApiKeyClaims,
  revokeApiKey
} from '@/lib/aetheris-api-keys';
import { resolveTier } from '@/lib/pro';
import {
  getCookieValue,
  PLAN_COOKIE_NAME
} from '@/lib/plan-cookie';
import { limitRequest } from '@/lib/rate-limit';
import { readBoundedJson, RequestBodyTooLargeError } from '@/lib/request-body';

const MAX_KEY_REQUEST_BYTES = 4096;

async function authenticatedOwner(): Promise<{ ownerId: string; email: string | null } | null> {
  const session = await getServerSession(authOptions);
  const ownerId = session?.user?.id || session?.user?.email || null;
  if (!ownerId) return null;
  return { ownerId, email: session?.user?.email ?? null };
}

/** Current paying membership for the browser session (cookie-aware). */
async function currentClaim(req: Request, ownerId: string, email: string | null) {
  const cookieValue = getCookieValue(req.headers.get('cookie'), PLAN_COOKIE_NAME);
  const resolved = await resolveTier(ownerId, cookieValue, email);
  return resolved.tier === 'pro' || resolved.tier === 'asteroid'
    ? { tier: resolved.tier, subscriptionId: resolved.subscriptionId ?? null }
    : null;
}

export async function GET(req: Request) {
  const limited = limitRequest(req, {
    key: 'api-keys-list',
    limit: 30,
    windowMs: 60_000
  });
  if (limited) return limited;
  try {
    const owner = await authenticatedOwner();
    if (!owner) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    // Keep membership claims on active keys in step with the account's
    // current plan so paid models stay reachable through the API.
    try {
      const claim = await currentClaim(req, owner.ownerId, owner.email);
      if (claim) await refreshApiKeyClaims(owner.ownerId, claim);
    } catch (error) {
      console.error('[aetheris/api-keys] claim refresh failed:', error);
    }
    const keys = await listApiKeys(owner.ownerId);
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
    const owner = await authenticatedOwner();
    if (!owner) return Response.json({ error: 'Sign in required.' }, { status: 401 });
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
    let claim: { tier: 'asteroid' | 'pro'; subscriptionId: string | null } | null = null;
    try {
      claim = await currentClaim(req, owner.ownerId, owner.email);
    } catch (error) {
      console.error('[aetheris/api-keys] claim resolution failed:', error);
    }
    const created = await createApiKey(owner.ownerId, label, claim);
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
    const owner = await authenticatedOwner();
    if (!owner) return Response.json({ error: 'Sign in required.' }, { status: 401 });
    const body: unknown = await readBoundedJson(req, MAX_KEY_REQUEST_BYTES);
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const id = typeof record['id'] === 'string' ? record['id'] : '';
    const revoked = await revokeApiKey(owner.ownerId, id);
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
