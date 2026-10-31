import { limitRequest } from '@/lib/rate-limit';

export async function POST(req: Request) {
  const limited = limitRequest(req, { key: 'image', limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  return Response.json(
    {
      error:
        'Aetheris image generation is not available until an image model is deployed.'
    },
    { status: 503 }
  );
}
