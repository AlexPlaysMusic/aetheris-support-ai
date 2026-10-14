import { limitRequest } from '@/lib/rate-limit';

/** Receives client-side error beacons so UI failures can be diagnosed
 *  from the server logs. Truncates everything; never throws. */
export async function POST(req: Request) {
  // Telemetry must not become a log-spam vector.
  const limited = limitRequest(req, { key: 'client-log', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const body: unknown = await req.json();
    const record =
      body !== null && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};
    const kind =
      typeof record['kind'] === 'string'
        ? record['kind'].slice(0, 40)
        : 'log';
    const message =
      typeof record['message'] === 'string'
        ? record['message'].slice(0, 1000)
        : '';
    const extra =
      typeof record['extra'] === 'string'
        ? record['extra'].slice(0, 1000)
        : '';
    console.log(`[client:${kind}] ${message}${extra !== '' ? ` | ${extra}` : ''}`);
  } catch {
    /* logging must never break the app */
  }
  return Response.json({ ok: true });
}
