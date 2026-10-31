import { NextRequest, NextResponse } from 'next/server';

const API_HOST = 'api.aetherisai.me';

export function middleware(req: NextRequest) {
  if (req.nextUrl.hostname.toLowerCase() !== API_HOST) {
    return NextResponse.next();
  }
  const url = req.nextUrl.clone();
  url.pathname = `/api${url.pathname}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/v1/:path*']
};
