import type { NextAuthOptions } from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import GoogleProvider from 'next-auth/providers/google';
import {
  consumeDesktopTicket,
  consumeEmailCode,
  emailIdentity,
  normalizeEmail,
  rememberGoogleIdentity
} from './auth-credentials';

export const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? ''
    }),
    CredentialsProvider({
      id: 'email-code',
      name: 'Email code',
      credentials: {
        email: { label: 'Email', type: 'email' },
        code: { label: 'Verification code', type: 'text' }
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.['email'] === 'string'
            ? normalizeEmail(credentials['email'])
            : '';
        const code =
          typeof credentials?.['code'] === 'string'
            ? credentials['code'].trim()
            : '';
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
          return null;
        }
        if (!(await consumeEmailCode(email, code))) return null;
        return {
          id: await emailIdentity(email),
          email,
          name: email
        };
      }
    }),
    CredentialsProvider({
      id: 'desktop-ticket',
      name: 'Desktop sign-in',
      credentials: { ticket: { label: 'Sign-in ticket', type: 'text' } },
      async authorize(credentials) {
        const ticket =
          typeof credentials?.['ticket'] === 'string'
            ? credentials['ticket']
            : '';
        return ticket === '' ? null : consumeDesktopTicket(ticket);
      }
    })
  ],
  secret: process.env.NEXTAUTH_SECRET,
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account, user }) {
      if (account?.provider === 'google' && user.email && user.id) {
        try {
          await rememberGoogleIdentity(user.email, user.id);
        } catch (error) {
          console.error('[aetheris/auth] could not save Google email mapping:', error);
        }
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = typeof token.sub === 'string' ? token.sub : '';
        if (typeof token.email === 'string') session.user.email = token.email;
      }
      return session;
    }
  }
};
