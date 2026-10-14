'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Bot, User } from 'lucide-react';
import HeaderBrand from '../components/Header';
import { decodeShareChat, type SharedChat } from '@/lib/share';

export default function SharePage() {
  const [chat, setChat] = useState<SharedChat | null | undefined>(undefined);

  useEffect(() => {
    setChat(decodeShareChat(window.location.hash));
  }, []);

  return (
    <div className="flex min-h-[100dvh] flex-col bg-abyss text-slate-100">
      <header className="sticky top-0 z-30 border-b border-white/5 bg-abyss/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3">
          <a href="/" aria-label="Back to Aetheris">
            <HeaderBrand size={24} />
          </a>
          <span className="ml-auto rounded-full border border-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-400">
            Shared chat
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl flex-1 px-3 py-6 sm:px-4">
        {chat === undefined ? (
          <p className="py-16 text-center text-[14px] text-slate-500">Loading…</p>
        ) : chat === null ? (
          <div className="py-16 text-center">
            <p className="text-lg font-semibold text-white">
              This share link didn&apos;t work
            </p>
            <p className="mx-auto mt-2 max-w-sm text-[13.5px] leading-6 text-slate-400">
              The link is invalid, truncated, or too old. Ask the sender for a
              fresh one.
            </p>
            <a
              href="/"
              className="mt-5 inline-block rounded-xl bg-cyan-400 px-4 py-2 text-sm font-semibold text-[#06121a] transition hover:bg-cyan-300"
            >
              Open Aetheris
            </a>
          </div>
        ) : (
          <>
            <h1 className="mb-5 text-xl font-bold tracking-tight text-white">
              {chat.title}
            </h1>
            <div className="flex flex-col gap-4">
              {chat.messages.map((m, i) => {
                const isUser = m.role === 'user';
                return (
                  <div
                    key={`${i}-${m.role}`}
                    className={`flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}
                  >
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-slate-300">
                      {isUser ? <User size={16} /> : <Bot size={16} />}
                    </div>
                    <div
                      className={`min-w-0 max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[80%] ${
                        isUser
                          ? 'rounded-tr-md border border-white/10 bg-white/[0.07]'
                          : 'rounded-tl-md border border-white/5 bg-surface'
                      }`}
                    >
                      {isUser && m.images.length > 0 && (
                        <div className="mb-2 grid grid-cols-2 gap-1.5">
                          {m.images.map((src) => (
                            <a
                              key={src.slice(-32)}
                              href={src}
                              target="_blank"
                              rel="noreferrer"
                            >
                              <img
                                src={src}
                                alt="Shared photo"
                                className="max-h-48 w-full rounded-lg object-cover"
                              />
                            </a>
                          ))}
                        </div>
                      )}
                      {isUser ? (
                        <p className="whitespace-pre-wrap text-[14.5px] leading-7">
                          {m.content}
                        </p>
                      ) : (
                        <div className="markdown-body">
                          <ReactMarkdown>{m.content}</ReactMarkdown>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-8 text-center text-[11px] leading-5 text-slate-600">
              Shared from Aetheris · Anyone with this link can read it ·
              Photos may be omitted from very long chats.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
