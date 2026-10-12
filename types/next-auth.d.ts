import type { DefaultSession } from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      /** Stable per-user id (Google `sub`), used to scope chat history. */
      id: string;
    } & DefaultSession['user'];
  }
}
