'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from 'ai/react';
import type { Message } from 'ai';
import ReactMarkdown from 'react-markdown';
import { signIn, signOut, useSession } from 'next-auth/react';
import HeaderBrand from './components/Header';
import {
  CREDIT_DAILY_GUEST,
  CREDIT_DAILY_PRO,
  CREDIT_DAILY_USER,
  CREDIT_COST_IMAGE_GEN,
  creditIdentity,
  messageCost,
  refundCredits,
  remainingCredits,
  spendCredits
} from '@/lib/credits';
import {
  ArrowRight,
  Check,
  ChevronDown,
  Coins,
  Copy,
  FileText,
  LifeBuoy,
  Lock,
  LogIn,
  LogOut,
  Menu,
  Mic,
  Paperclip,
  Pencil,
  Volume2,
  Download,
  Plus,
  Smartphone,
  RefreshCw,
  Search,
  Send,
  Settings,
  Share2,
  Square,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  User,
  X,
  Zap
} from 'lucide-react';

/* ---------------------------------- types --------------------------------- */

type ModelId = 'aetheris-basic' | 'aetheris-pro';

type Thread = {
  id: string;
  title: string;
  createdAt: number;
  model: ModelId;
  messages: Message[];
};

type AttachmentMeta = {
  name: string;
  size: number;
  kind: 'image' | 'text' | 'pdf';
  contentType: string;
  /**
   * Images + PDFs: data URL (sent to the model + rendered in chat).
   * Text files: raw text content (inlined into the message).
   */
  payload: string;
};

const MAX_ATTACHMENTS = 4;
const MAX_IMAGE_DIM = 1024;
const MAX_TEXT_CHARS = 12000;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MAX_PDF_BYTES = 3 * 1024 * 1024;

function readAsText(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}

const MAX_PDF_PAGES = 10;

/** Pull readable text out of a PDF in the browser (loaded on demand). */
async function extractPdfText(blob: Blob, maxPages: number = MAX_PDF_PAGES): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(await blob.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    const pages: string[] = [];
    const count = Math.min(doc.numPages, maxPages);
    for (let i = 1; i <= count; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) =>
          'str' in item && typeof item.str === 'string' ? item.str : ''
        )
        .join(' ');
      if (text.trim() !== '') pages.push(text);
      page.cleanup();
    }
    return pages.join('\n\n').replace(/[ \t]+/g, ' ').trim();
  } finally {
    await doc.destroy();
  }
}

function isHeicFile(f: File): boolean {
  return (
    f.type === 'image/heic' ||
    f.type === 'image/heif' ||
    /\.hei[cf]$/i.test(f.name)
  );
}

/** Convert iPhone HEIC/HEIF photos to JPEG (loaded on demand, not in the main bundle). */
async function convertHeic(f: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({
    blob: f,
    toType: 'image/jpeg',
    quality: 0.85
  });
  const first = Array.isArray(converted) ? converted[0] : converted;
  if (!first) throw new Error('HEIC conversion produced no output.');
  return first;
}

/** Downscale a photo so it stays small enough for chat + localStorage. */
function downscaleImage(
  file: Blob,
  maxDim: number = MAX_IMAGE_DIM,
  timeoutMs: number = 15000
): Promise<{ dataUrl: string; contentType: string } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const objectUrl = URL.createObjectURL(file);
    const done = (value: { dataUrl: string; contentType: string } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(objectUrl);
      resolve(value);
    };
    const timer = setTimeout(() => done(null), timeoutMs);
    const img = new Image();
    img.onload = () => {
      try {
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          done(null);
          return;
        }
        ctx.drawImage(img, 0, 0, w, h);
        done({ dataUrl: canvas.toDataURL('image/jpeg', 0.85), contentType: 'image/jpeg' });
      } catch {
        done(null);
      }
    };
    img.onerror = () => done(null);
    img.src = objectUrl;
  });
}

/** Pull image URLs out of a chat message (file parts or attachments). */
function messageImages(m: Message): string[] {
  const urls: string[] = [];
  if (m === null || typeof m !== 'object') return urls;
  const withParts = m as unknown as { parts?: unknown };
  if (Array.isArray(withParts.parts)) {
    for (const part of withParts.parts) {
      const p =
        part !== null && typeof part === 'object'
          ? (part as Record<string, unknown>)
          : null;
      if (
        p?.type === 'file' &&
        typeof p['mimeType'] === 'string' &&
        (p['mimeType'] as string).startsWith('image/') &&
        typeof p['data'] === 'string'
      ) {
        urls.push(p['data'] as string);
      }
    }
  }
  const withAtts = m as unknown as { experimental_attachments?: unknown };
  if (Array.isArray(withAtts.experimental_attachments)) {
    for (const item of withAtts.experimental_attachments) {
      const a =
        item !== null && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null;
      if (typeof a?.url !== 'string') continue;
      const ct = typeof a['contentType'] === 'string' ? (a['contentType'] as string) : '';
      const url = a['url'] as string;
      if (ct.startsWith('image/') || url.startsWith('data:image')) urls.push(url);
    }
  }
  return [...new Set(urls)];
}

type AttachedFile = { name: string; contentType: string; url: string };

/** Non-image attachments (PDFs, docs) from file parts or attachments. */
function messageFiles(m: Message): AttachedFile[] {
  const files: AttachedFile[] = [];
  if (m === null || typeof m !== 'object') return files;
  const pushFile = (name: string, contentType: string, url: string) => {
    if (contentType.startsWith('image/') || url.startsWith('data:image')) return;
    // Only linkable payloads (PDF text rides inline in the message instead).
    if (
      !url.startsWith('data:') &&
      !url.startsWith('blob:') &&
      !url.startsWith('http')
    ) {
      return;
    }
    if (files.some((f) => f.url === url)) return;
    files.push({ name, contentType, url });
  };
  const withParts = m as unknown as { parts?: unknown };
  if (Array.isArray(withParts.parts)) {
    for (const part of withParts.parts) {
      const p =
        part !== null && typeof part === 'object'
          ? (part as Record<string, unknown>)
          : null;
      if (
        p?.type === 'file' &&
        typeof p['mimeType'] === 'string' &&
        typeof p['data'] === 'string'
      ) {
        pushFile('Attached file', p['mimeType'] as string, p['data'] as string);
      }
    }
  }
  const withAtts = m as unknown as { experimental_attachments?: unknown };
  if (Array.isArray(withAtts.experimental_attachments)) {
    for (const item of withAtts.experimental_attachments) {
      const a =
        item !== null && typeof item === 'object'
          ? (item as Record<string, unknown>)
          : null;
      if (typeof a?.url !== 'string') continue;
      pushFile(
        typeof a['name'] === 'string' ? (a['name'] as string) : 'Attached file',
        typeof a['contentType'] === 'string' ? (a['contentType'] as string) : '',
        a['url'] as string
      );
    }
  }
  return files;
}

/** Text preference persisted to localStorage (hydrated client-side only). */
function useLocalString(key: string, initial: string): [string, (v: string) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(raw);
    } catch {
      /* private mode — ignore */
    }
  }, [key]);
  const set = useCallback((v: string) => {
    setValue(v);
    try {
      localStorage.setItem(key, v);
    } catch {
      /* ignore */
    }
  }, [key]);
  return [value, set];
}

/** Strip markdown down to speakable plain text for read-aloud. */
function speakable(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' Code omitted. ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' Image. ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/[*_#>~|-]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

/** Boolean preference persisted to localStorage (hydrated client-side only). */
function useLocalPref(key: string, initial: boolean): [boolean, () => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw !== null) setValue(raw === '1');
    } catch {
      /* private mode — ignore */
    }
  }, [key]);
  const toggle = useCallback(() => {
    setValue((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(key, next ? '1' : '0');
      } catch {
        /* ignore */
      }
      return next;
    });
  }, [key]);
  return [value, toggle];
}

/**
 * Turn a useChat failure into a human message. Non-OK responses arrive
 * with the server's JSON body as the error text, so parse that first.
 */
function describeSendError(error: Error): string {
  let raw = error.message;
  try {
    const parsed = JSON.parse(raw) as { error?: unknown; message?: unknown };
    const inner =
      typeof parsed['message'] === 'string' && parsed['message'] !== ''
        ? (parsed['message'] as string)
        : typeof parsed['error'] === 'string'
          ? (parsed['error'] as string)
          : '';
    if (inner !== '') raw = inner;
  } catch {
    /* transport-level failure — raw message stands */
  }
  if (/OUT_OF_CREDITS/i.test(raw)) return 'Out of credits for today.';
  if (
    /429|quota|rate.?limit|RESOURCE_EXHAUSTED|busy|overload|503/i.test(raw)
  ) {
    return 'The AI is at capacity right now — retrying on its own. If it persists, wait a few seconds and hit Retry.';
  }
  if (/timeout|timed out|network|fetch|connection|500|502|504/i.test(raw)) {
    return 'Lost the connection mid-reply — retrying on its own.';
  }
  return 'Something went wrong while streaming. Please try again.';
}

/** Format a message timestamp (Date live, ISO string after reload). */
function formatTime(value: unknown): string | null {
  if (
    value instanceof Date ||
    typeof value === 'string' ||
    typeof value === 'number'
  ) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  return null;
}

/** Fire-and-forget client diagnostic beacon (read via server logs). */
function reportClient(kind: string, message: string, extra?: string): void {
  try {
    const payload = JSON.stringify({ kind, message, extra: extra ?? '' });
    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      navigator.sendBeacon(
        '/api/client-log',
        new Blob([payload], { type: 'application/json' })
      );
    } else {
      void fetch('/api/client-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        keepalive: true
      });
    }
  } catch {
    /* never break the app over diagnostics */
  }
}

const SHARE_SIZE_LIMIT = 150_000;

/**
 * Build a shareable link embedding the chat in the URL hash (no server
 * storage needed). Photos are included when the link stays small enough;
 * oversized chats share as text only. Returns null when even that is too big.
 */
function buildShareLink(t: Thread): string | null {
  const slim: {
    v: number;
    title: string;
    messages: { role: 'user' | 'assistant'; content: string; images: string[] }[];
  } = {
    v: 1,
    title: t.title,
    messages: t.messages
      .filter((m) => m !== null && typeof m === 'object')
      .map((m) => {
        const record = m as unknown as Record<string, unknown>;
        return {
          role: record['role'] === 'user' ? ('user' as const) : ('assistant' as const),
          content:
            typeof record['content'] === 'string'
              ? (record['content'] as string).slice(0, 6000)
              : '',
          images: messageImages(m as Message).slice(0, 4)
        };
      })
      .filter((m) => m.content !== '' || m.images.length > 0)
  };
  const encode = (dropImages: boolean): string => {
    if (dropImages) {
      for (const m of slim.messages) m.images = [];
    }
    const bytes = new TextEncoder().encode(JSON.stringify(slim));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  };
  let code = encode(false);
  if (code.length > SHARE_SIZE_LIMIT) code = encode(true);
  if (code.length > SHARE_SIZE_LIMIT) return null;
  return `${window.location.origin}/share#${code}`;
}

/**
 * First-line blocklist for image prompts (sexual/explicit content).
 * Proven against 229 cases: near-zero false positives on innocent words
 * ("class", "title", "badass", "comic strip", "tennis balls") while
 * catching plurals, porn-site names, and CSAM-coded terms.
 * Misspellings and euphemisms are the /api/moderate classifier's job —
 * this list is the instant, offline-capable first line, not the whole wall.
 */
const NSFW_PROMPT_PATTERN =
  /\b(nudes?|nakeds?|nsfw|porn|pornographic|porn ?stars?|pornhub|xvideos|xhamster|xnxx|redtube|youporn|manyvids|clips4sale|spankbang|chaturbate|myfreecams|livejasmin|stripchat|bongacams|rule ?34|erotic|erotica|explicit|sexy|hentai|ecchi|oppai|ahegao|yiff|loli|lolicon|shota|shotacon|school ?girls?|jailbait|ageplay|non-?con|dub-?con|zoophil(?:e|ia)?|necrophil(?:e|iac?)|pedophil(?:e|iac?)|paedophil(?:e|iac?)|hebephil(?:e|ia)?|ephebophilia|child ?porn|kiddie ?porn|teen porn|barely legal|r-?18|adults only|gangbang|creampie|oral sex|anal|femdom|findom|cuckold|cuck|jizz|cum|fetish|bdsm|bondage|dominatrix|orgasm|masturbat(?:e|ion)?|ejaculat\w*|copulat\w*|coitus|foreplay|making love|incest|bestiality|rape|sodomy|intercourse|genital|pubic|upskirt|downblouse|creepshot|voyeur(?:ism)?|exhibitionis(?:t|m)|revenge porn|thirst trap|glory holes?|grope|groping|molest\w*|fondl\w*|lingerie|pant(?:y|ies)|thongs?|g-strings?|pasties|stripper|strip ?(?:poker|clubs?)|call ?girls?|cam ?girls?|brothel|red light district|boudoir|pin-?ups?|centerfold|onlyfans|playboy|playgirl|milf|dilf|gilf|boob(?:s|ies)?|tits?|titties|puss(?:y|ies)|dicks?|cocks?|penis(?:es)?|vaginas?|clits?|nipples?|areola|breasts?|cleavage|crotch(?:less)?|butts?|butt naked|arses?|asses|(?<![a-z])ass(?!et\b)|blowjob|handjob|foot ?fetish|foot ?jobs?|tit ?jobs?|rim ?jobs?|fisting|cumshot|bukkake|pegging|deepthroat|facesitting|threesome|foursome|swingers?|orgy|prostitut(?:e|ion)?|fap|fapping|wank|wanking|wanker|jerk ?off|jack ?off|doggy ?style|lap ?dance|peep ?shows?|adult (?:films?|videos?|movies?)|blue (?:movies?|films?)|sex ?(?:tapes?|dolls?|toys?)|phone ?sex|cybersex|sexting|sex shops?|adult (?:bookstore|shop|store)s?|lewd|horny|aroused|arousal|lustful|lusty|smut(?:ty)?|raunchy|topless|undressed|undressing|undress|disrobed|sheer|see ?through|no clothes|without clothes|body ?paint|bodypaint|birthday suit|wet (?:t-?shirts?|shirts?|dress|clothes|clothing)|dildo|vibrator|fleshlight|butt ?plugs?|kamasutra)\b/i;

function isBlockedImagePrompt(prompt: string): boolean {
  return NSFW_PROMPT_PATTERN.test(prompt);
}

/** Best-effort clipboard write with a legacy fallback. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

const MODELS: {
  id: ModelId;
  label: string;
  hint: string;
  badge: string;
  locked: boolean;
}[] = [
  {
    id: 'aetheris-basic',
    label: 'Aetheris Basic (Free)',
    hint: 'Fast · Everyday chat',
    badge: 'Free',
    locked: false
  },
  {
    id: 'aetheris-pro',
    label: 'Aetheris Pro (v1.0)',
    hint: 'Locked · Coming soon',
    badge: 'Pro',
    locked: true
  }
];

const SUGGESTIONS = [
  'Plan a 3-day Kyoto trip under $1,500',
  'Explain this code: arr.map(x => x * 2).filter(x => x > 2)',
  'Draft a firm but polite refund email',
  'Teach me one photography fundamental in 5 minutes'
];

const RESPONSE_STYLES = [
  { id: 'precise', label: 'Precise', temperature: 0.3 },
  { id: 'balanced', label: 'Balanced', temperature: 0.7 },
  { id: 'creative', label: 'Creative', temperature: 1.0 }
] as const;

/** Slash commands: typed as `/name args`, picked from the popup menu. */
const SLASH_COMMANDS: { name: string; hint: string; description: string }[] = [
  { name: 'draw', hint: '<description>', description: 'Generate an image (10 credits)' },
  { name: 'image', hint: '<description>', description: 'Same as /draw' },
  { name: 'help', hint: '', description: 'Show this list' },
  { name: 'new', hint: '', description: 'Start a fresh chat' },
  { name: 'export', hint: '', description: 'Download this chat as Markdown' },
  { name: 'retry', hint: '', description: 'Regenerate the last reply' }
];

function slashHelpText(): string {
  return [
    '**Commands**',
    '',
    ...SLASH_COMMANDS.map(
      (c) => `- \`/${c.name}${c.hint !== '' ? ` ${c.hint}` : ''}\` — ${c.description}`
    )
  ].join('\n');
}

const STORAGE_KEY_BASE = 'aetheris-threads-v1';
const GUEST_KEY = `${STORAGE_KEY_BASE}:guest`;

/** Chat history is scoped per account; signed-out visitors share a guest key. */
function storageKeyFor(userId: string | null): string {
  return userId ? `${STORAGE_KEY_BASE}:${userId}` : GUEST_KEY;
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `chat-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

function loadThreads(key: string): Thread[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Thread[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persistThreads(key: string, threads: Thread[]) {
  try {
    localStorage.setItem(key, JSON.stringify(threads));
  } catch {
    /* storage full / private mode — ignore */
  }
}

function threadTitleFrom(messages: Message[]): string {
  const list = Array.isArray(messages) ? messages : [];
  const firstUser = list.find(
    (m) =>
      m !== null &&
      typeof m === 'object' &&
      (m as { role?: unknown }).role === 'user'
  );
  const content =
    typeof firstUser?.content === 'string' ? firstUser.content : '';
  const raw = content
    .trim()
    .replace(/^\/(draw|image)\s+/i, '')
    .replace(/\s+/g, ' ');
  if (raw) return raw.length > 42 ? `${raw.slice(0, 42)}…` : raw;
  if (firstUser && messageImages(firstUser).length > 0) return 'Photo message';
  return 'New conversation';
}

/* ---------------------------------- logo ---------------------------------- */

function AetherisLogo({ size = 34 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      role="img"
      aria-label="Aetheris logo"
    >
      <defs>
        <linearGradient id="aether-glow" x1="0" y1="0" x2="64" y2="64">
          <stop offset="0%" stopColor="#00F2FE" />
          <stop offset="55%" stopColor="#67E8F9" />
          <stop offset="100%" stopColor="#8B5CF6" />
        </linearGradient>
        <linearGradient id="aether-inner" x1="0" y1="64" x2="64" y2="0">
          <stop offset="0%" stopColor="#0EA5E9" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#00F2FE" stopOpacity="0.25" />
        </linearGradient>
      </defs>

      {/* base platform */}
      <path
        d="M8 50 L32 58 L56 50 L32 44 Z"
        stroke="url(#aether-glow)"
        strokeWidth="2.4"
        strokeLinejoin="round"
        fill="rgba(0,242,254,0.08)"
      />
      {/* outer dome */}
      <path
        d="M10 50 V32 C10 18 20 8 32 8 C44 8 54 18 54 32 V50"
        stroke="url(#aether-glow)"
        strokeWidth="3"
        strokeLinecap="round"
        fill="rgba(0,242,254,0.06)"
      />
      {/* crossing ribs */}
      <path
        d="M18 50 V30 C18 20 24 13 32 10 C40 13 46 20 46 30 V50"
        stroke="url(#aether-glow)"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="none"
        opacity="0.95"
      />
      <path
        d="M10 34 C18 28 26 24 32 24 C38 24 46 28 54 34"
        stroke="url(#aether-glow)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
        opacity="0.85"
      />
      <path
        d="M14 42 C21 37 27 35 32 35 C37 35 43 37 50 42"
        stroke="url(#aether-glow)"
        strokeWidth="1.5"
        strokeLinecap="round"
        fill="none"
        opacity="0.7"
      />
      {/* side arches */}
      <path
        d="M18 50 V38 C18 35 20 33 22.5 33 C25 33 27 35 27 38 V48"
        stroke="url(#aether-glow)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M37 48 V38 C37 35 39 33 41.5 33 C44 33 46 35 46 38 V50"
        stroke="url(#aether-glow)"
        strokeWidth="1.8"
        strokeLinecap="round"
        fill="none"
      />
      {/* center arch + core crystal */}
      <path
        d="M26 50 V36 C26 32 29 30 32 30 C35 30 38 32 38 36 V50"
        stroke="url(#aether-glow)"
        strokeWidth="2.2"
        strokeLinecap="round"
        fill="url(#aether-inner)"
      />
      <path
        d="M28 42 L32 38 L36 42 L32 46 Z"
        fill="#00F2FE"
        opacity="0.95"
      />
      <circle cx="32" cy="20" r="1.8" fill="#E0FEFF" />
    </svg>
  );
}

/* ------------------------------- code block ------------------------------- */

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = code;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    setCopied(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="group my-3 overflow-hidden rounded-xl border border-white/10 bg-[#0A0F1C]">
      <div className="flex items-center justify-between border-b border-white/5 bg-white/[0.03] px-3 py-1.5">
        <span className="text-[11px] font-medium uppercase tracking-wider text-cyan-200/80">
          {language || 'code'}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium text-slate-300 transition hover:bg-cyan-400/10 hover:text-cyan-200"
          aria-label="Copy code"
        >
          {copied ? (
            <>
              <Check size={13} className="text-emerald-300" /> Copied
            </>
          ) : (
            <>
              <Copy size={13} /> Copy Code
            </>
          )}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] leading-6">
        <code className="font-mono text-slate-100">{code}</code>
      </pre>
    </div>
  );
}

function ChatMarkdown({ content }: { content: string }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        components={{
          pre: ({ children }) => <>{children}</>,
          img: ({ src, alt }) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={typeof src === 'string' ? src : ''}
              alt={typeof alt === 'string' ? alt : 'Generated image'}
              className="my-2 max-h-96 w-auto rounded-xl border border-white/10"
            />
          ),
          code: ({ className, children }) => {
            const text = String(children ?? '').replace(/\n$/, '');
            const match = /language-([\w-]+)/.exec(className || '');
            const isBlock = Boolean(match) || text.includes('\n');
            if (!isBlock) {
              return (
                <code className="rounded-md bg-white/10 px-1.5 py-0.5 font-mono text-[13px] text-slate-100">
                  {text}
                </code>
              );
            }
            return <CodeBlock language={match?.[1] ?? ''} code={text} />;
          }
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

function ProfileAvatar({
  src,
  name,
  size = 32
}: {
  src?: string | null;
  name?: string | null;
  size?: number;
}) {
  if (src) {
    return (
      <img
        src={src}
        alt={name ?? 'Profile photo'}
        width={size}
        height={size}
        referrerPolicy="no-referrer"
        className="shrink-0 rounded-full border border-white/15"
      />
    );
  }
  return (
    <span
      className="flex shrink-0 items-center justify-center rounded-full border border-white/15 bg-white/5 text-slate-300"
      style={{ width: size, height: size }}
    >
      <User size={Math.round(size * 0.5)} />
    </span>
  );
}

/** Basic-plan AI avatar: faceted crystal bot head, transparent background. */
function BasicBotAvatar({ size = 32 }: { size?: number }) {
  return (
    <span
      className="block shrink-0 overflow-hidden rounded-full border border-white/15 bg-transparent"
      style={{ width: size, height: size }}
      role="img"
      aria-label="Aetheris Basic"
    >
      <svg width={size} height={size} viewBox="0 0 64 64" fill="none">
        <defs>
          <linearGradient id="crystal-edge" x1="8" y1="4" x2="56" y2="58">
            <stop offset="0%" stopColor="#99F6E4" />
            <stop offset="55%" stopColor="#22D3EE" />
            <stop offset="100%" stopColor="#0E7490" />
          </linearGradient>
        </defs>
        {/* crown spikes */}
        <polygon points="21,11 23,3 26,11" fill="#22D3EE" opacity="0.85" />
        <polygon points="38,11 41,3 43,11" fill="#22D3EE" opacity="0.85" />
        {/* helmet shell */}
        <polygon
          points="32,5 45,10 49,22 47,38 40,50 32,54 24,50 17,38 15,22 19,10"
          fill="rgba(34,211,238,0.07)"
          stroke="url(#crystal-edge)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />
        {/* brow facet */}
        <polyline
          points="22,23 32,18 42,23"
          stroke="#67E8F9"
          strokeWidth="1.4"
          opacity="0.6"
          strokeLinejoin="round"
        />
        {/* ear fins */}
        <polygon
          points="15,25 10,28 10,40 15,43"
          fill="rgba(34,211,238,0.08)"
          stroke="#22D3EE"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <polygon
          points="49,25 54,28 54,40 49,43"
          fill="rgba(34,211,238,0.08)"
          stroke="#22D3EE"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        {/* dotted LED eyes */}
        <g fill="#67E8F9">
          <circle cx="24" cy="31" r="1" />
          <circle cx="26.5" cy="31" r="1" />
          <circle cx="29" cy="31" r="1" />
          <circle cx="24" cy="33.5" r="1" opacity="0.55" />
          <circle cx="26.5" cy="33.5" r="1" opacity="0.55" />
          <circle cx="29" cy="33.5" r="1" opacity="0.55" />
          <circle cx="35" cy="31" r="1" />
          <circle cx="37.5" cy="31" r="1" />
          <circle cx="40" cy="31" r="1" />
          <circle cx="35" cy="33.5" r="1" opacity="0.55" />
          <circle cx="37.5" cy="33.5" r="1" opacity="0.55" />
          <circle cx="40" cy="33.5" r="1" opacity="0.55" />
        </g>
        {/* wireframe muzzle dome */}
        <path
          d="M23 51 A9 9 0 0 1 41 51"
          stroke="#67E8F9"
          strokeWidth="1.2"
        />
        <path
          d="M24.5 47.5 A8 8 0 0 0 39.5 47.5"
          stroke="#67E8F9"
          strokeWidth="1"
          opacity="0.7"
        />
        <line x1="27.5" y1="44" x2="27.5" y2="51" stroke="#67E8F9" strokeWidth="1" opacity="0.7" />
        <line x1="32" y1="43" x2="32" y2="52" stroke="#67E8F9" strokeWidth="1" opacity="0.7" />
        <line x1="36.5" y1="44" x2="36.5" y2="51" stroke="#67E8F9" strokeWidth="1" opacity="0.7" />
        {/* cheek facets */}
        <line x1="20" y1="41" x2="26" y2="48" stroke="#22D3EE" strokeWidth="1.2" opacity="0.5" />
        <line x1="44" y1="41" x2="38" y2="48" stroke="#22D3EE" strokeWidth="1.2" opacity="0.5" />
      </svg>
    </span>
  );
}

/** Labeled on/off switch row for the settings dialog. */
function PrefToggle({
  label,
  hint,
  checked,
  onToggle,
  ariaLabel
}: {
  label: string;
  hint: string;
  checked: boolean;
  onToggle: () => void;
  ariaLabel?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg px-1 py-2">
      <div className="min-w-0">
        <p className="text-[13.5px] font-medium text-slate-100">{label}</p>
        <p className="text-[11.5px] text-slate-500">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel ?? label}
        onClick={onToggle}
        className={`relative h-6 w-11 shrink-0 rounded-full transition ${
          checked ? 'bg-cyan-400' : 'bg-white/15'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
    </div>
  );
}

/** Centered bottom-sheet (mobile) / dialog (desktop) used by all modals. */
function ModalShell({
  title,
  onClose,
  children
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 backdrop-blur-sm sm:items-center"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-2xl border border-white/10 bg-surface shadow-2xl shadow-black/60"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-[15px] font-semibold text-white">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={`Close ${title}`}
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>
        <div className="max-h-[70dvh] overflow-y-auto px-4 py-4">{children}</div>
      </div>
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */

export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [modelOpen, setModelOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<ModelId>('aetheris-basic');
  const [chatId, setChatId] = useState<string>(() => newId());
  const [threads, setThreads] = useState<Thread[]>([]);
  const [attachments, setAttachments] = useState<AttachmentMeta[]>([]);
  const [isListening, setIsListening] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [joinedWaitlist, setJoinedWaitlist] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [contactEmail, setContactEmail] = useState('');
  const [contactMessage, setContactMessage] = useState('');
  const [contactStatus, setContactStatus] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');
  const [contactError, setContactError] = useState<string | null>(null);

  const openHelp = () => {
    setContactEmail(session?.user?.email ?? '');
    setContactMessage('');
    setContactError(null);
    setContactStatus('idle');
    setSidebarOpen(false);
    setHelpOpen(true);
  };

  const submitSupport = (e?: React.FormEvent) => {
    e?.preventDefault();
    const email = contactEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setContactError('Enter a valid email address.');
      setContactStatus('error');
      return;
    }
    if (contactMessage.trim() === '') {
      setContactError('Describe the problem first.');
      setContactStatus('error');
      return;
    }
    setContactStatus('sending');
    setContactError(null);
    void fetch('/api/support', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, message: contactMessage.trim() })
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Record<string, unknown> | null;
        if (!r.ok) {
          throw new Error(
            (d && typeof d['error'] === 'string' && d['error']) ||
              'Could not send. Try again.'
          );
        }
        setContactStatus('done');
      })
      .catch((err: unknown) => {
        setContactError(
          err instanceof Error ? err.message : 'Could not send. Try again.'
        );
        setContactStatus('error');
      });
  };
  const [enterToSend, toggleEnterToSend] = useLocalPref('aetheris-enter-to-send', true);
  const [autoScroll, toggleAutoScroll] = useLocalPref('aetheris-auto-scroll', true);
  const [showTimestamps, toggleTimestamps] = useLocalPref('aetheris-timestamps', false);
  const [reduceMotion, toggleReduceMotion] = useLocalPref('aetheris-reduce-motion', false);
  const [reactions, setReactions] = useState<Record<string, 'up' | 'down'>>({});
  const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
  const [creditsLeft, setCreditsLeft] = useState(CREDIT_DAILY_GUEST);
  const [outOfCredits, setOutOfCredits] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const lastSpent = useRef(0);
  const autoRetried = useRef(false);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [sharedId, setSharedId] = useState<string | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [processingFiles, setProcessingFiles] = useState(false);
  const [checkingDraw, setCheckingDraw] = useState(false);
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashHidden, setSlashHidden] = useState(false);
  const [canInstall, setCanInstall] = useState(false);
  const installEvt = useRef<{
    prompt: () => Promise<void>;
  } | null>(null);

  /* capture the PWA install prompt (Chrome/Edge/Android) */
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.matchMedia('(display-mode: standalone)').matches
    ) {
      return;
    }
    const onPrompt = (e: Event) => {
      e.preventDefault();
      installEvt.current = e as unknown as { prompt: () => Promise<void> };
      setCanInstall(true);
    };
    const onInstalled = () => {
      installEvt.current = null;
      setCanInstall(false);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const installApp = () => {
    const evt = installEvt.current;
    if (!evt) return;
    void evt.prompt().then(() => {
      installEvt.current = null;
      setCanInstall(false);
    });
  };
  const attachErrTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showAttachError = (message: string) => {
    setAttachError(message);
    if (attachErrTimer.current) clearTimeout(attachErrTimer.current);
    attachErrTimer.current = setTimeout(() => setAttachError(null), 5000);
  };
  const { data: session, status } = useSession();
  const userId = session?.user?.id || session?.user?.email || null;
  const storeKey = storageKeyFor(userId);
  const creditId = useMemo(() => creditIdentity(userId), [userId]);
  const [instructions, setInstructions] = useLocalString(
    `aetheris-instructions:${userId ?? 'guest'}`,
    ''
  );
  const [styleId, setStyle] = useLocalString('aetheris-style', 'balanced');
  const styleTemp =
    RESPONSE_STYLES.find((s) => s.id === styleId)?.temperature ?? 0.7;
  const [daypart, setDaypart] = useState('Hello');
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const isGuest = status !== 'authenticated';

  /* time-aware greeting (computed on the client so prerender stays neutral) */
  useEffect(() => {
    const h = new Date().getHours();
    setDaypart(
      h < 5 ? 'Up late' : h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
    );
  }, []);
  const prevStoreKeyRef = useRef(storeKey);

  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const msgCopyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* reconcile the header balance with the authoritative server ledger */
  const resyncServerCredits = useCallback(() => {
    void fetch('/api/credits')
      .then((r) => (r.ok ? r.json() : null))
      .then((d: unknown) => {
        const rec =
          d !== null && typeof d === 'object'
            ? (d as Record<string, unknown>)
            : null;
        if (rec && typeof rec['remaining'] === 'number') {
          const remaining = rec['remaining'] as number;
          setCreditsLeft(remaining);
          if (remaining <= 0) setOutOfCredits(true);
        }
      })
      .catch(() => {
        /* offline — keep the local balance */
      });
  }, []);

  const {
    messages,
    input,
    setInput,
    handleInputChange,
    handleSubmit,
    append,
    setMessages,
    isLoading,
    stop,
    error,
    reload
  } = useChat({
    api: '/api/chat',
    id: chatId,
    body: {
      model: selectedModel,
      userId,
      systemExtra: instructions,
      temperature: styleTemp
    },
    onFinish: () => {
      setSendError(null);
      resyncServerCredits();
    },
    onError: (err) => {
      // Drop the dead empty assistant shell so a bare toolbar never lingers.
      setMessages((prev) => {
        const last = prev[prev.length - 1];
        if (last && last.role === 'assistant') {
          const text = typeof last.content === 'string' ? last.content.trim() : '';
          if (text === '') return prev.slice(0, -1);
        }
        return prev;
      });
      setSendError(describeSendError(err));
      resyncServerCredits();
      // One automatic retry for transient blips (rate limits, overloads,
      // dropped connections) — but never for out-of-credits.
      if (!autoRetried.current && !/OUT_OF_CREDITS/i.test(err.message)) {
        autoRetried.current = true;
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null;
          reload();
        }, 2500);
      }
    }
  });

  const activeModel = useMemo(
    () => MODELS.find((m) => m.id === selectedModel) ?? MODELS[0],
    [selectedModel]
  );

  const filteredThreads = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q === '') return threads;
    return threads.filter((t) => t.title.toLowerCase().includes(q));
  }, [threads, searchQuery]);

  const refreshCredits = useCallback(() => {
    setCreditsLeft(remainingCredits(creditId));
  }, [creditId]);

  /* keep the balance fresh across identity changes, sends, and midnight rollover */
  useEffect(() => {
    setOutOfCredits(false);
    refreshCredits();
  }, [creditId, messages, refreshCredits]);

  /* a failed request refunds the credits its send spent */
  useEffect(() => {
    if (error && lastSpent.current > 0) {
      const amount = lastSpent.current;
      lastSpent.current = 0;
      setCreditsLeft(refundCredits(creditId, amount));
    }
  }, [error, creditId]);

  /**
   * Charge one send. Returns true when affordable (balance already
   * updated); shows the out-of-credits notice and returns false otherwise.
   */
  const chargeSend = useCallback(
    (images: number, files: number): boolean => {
      const cost = messageCost({
        pro: selectedModel === 'aetheris-pro',
        images,
        files
      });
      const remaining = spendCredits(creditId, cost);
      if (remaining === null) {
        lastSpent.current = 0;
        setOutOfCredits(true);
        return false;
      }
      lastSpent.current = cost;
      setCreditsLeft(remaining);
      setOutOfCredits(false);
      return true;
    },
    [creditId, selectedModel]
  );

  /* load per-account history; fold guest chats into the account on sign-in */
  useEffect(() => {
    const prevKey = prevStoreKeyRef.current;
    prevStoreKeyRef.current = storeKey;
    const current = loadThreads(storeKey);
    if (prevKey === GUEST_KEY && storeKey !== GUEST_KEY) {
      // Just signed in: merge any guest chats into this account.
      const guestThreads = loadThreads(GUEST_KEY);
      const seen = new Set(current.map((t) => t.id));
      const merged = [...current, ...guestThreads.filter((t) => !seen.has(t.id))]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 30);
      persistThreads(storeKey, merged);
      setThreads(merged);
      try {
        localStorage.removeItem(GUEST_KEY);
      } catch {
        /* ignore */
      }
    } else {
      setThreads(current);
    }
    setMessages([]);
    setChatId(newId());
    setSearchQuery('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeKey]);

  /* autosave current thread */
  useEffect(() => {
    if (messages.length === 0) return;
    setThreads((prev) => {
      const title = threadTitleFrom(messages);
      const existing = prev.find((t) => t.id === chatId);
      if (
        existing &&
        existing.messages === messages &&
        existing.title === title &&
        existing.model === selectedModel
      ) {
        // Nothing changed (e.g. re-tapping the open chat) — skip the
        // expensive localStorage rewrite so rapid taps stay instant.
        return prev;
      }
      let next: Thread[];
      if (existing) {
        next = prev.map((t) =>
          t.id === chatId
            ? { ...t, messages, title, model: selectedModel }
            : t
        );
      } else {
        next = [
          {
            id: chatId,
            title,
            createdAt: Date.now(),
            model: selectedModel,
            messages
          },
          ...prev
        ].slice(0, 30);
      }
      persistThreads(storeKey, next);
      return next;
    });
  }, [messages, chatId, selectedModel, storeKey]);

  /* autoscroll */
  useEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading, autoScroll]);

  /* autoresize textarea */
  useEffect(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`;
  }, [input]);

  /* close dropdown menus on outside click */
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        modelMenuRef.current &&
        !modelMenuRef.current.contains(e.target as Node)
      ) {
        setModelOpen(false);
      }
      if (
        accountMenuRef.current &&
        !accountMenuRef.current.contains(e.target as Node)
      ) {
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  /* close dialogs on Escape */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setUpgradeOpen(false);
      setSettingsOpen(false);
      setHelpOpen(false);
      setAccountOpen(false);
      setModelOpen(false);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  /* hydrate local prefs (client-only: localStorage is unavailable at prerender) */
  useEffect(() => {
    try {
      setJoinedWaitlist(localStorage.getItem('aetheris-pro-waitlist') === '1');
    } catch {
      /* private mode — ignore */
    }
  }, []);

  /* clear transient timers on unmount */
  useEffect(() => {
    return () => {
      if (msgCopyTimer.current) clearTimeout(msgCopyTimer.current);
      if (attachErrTimer.current) clearTimeout(attachErrTimer.current);
      if (retryTimer.current) clearTimeout(retryTimer.current);
    };
  }, []);

  /* report client crashes/rejections to the server log for diagnosis */
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      reportClient(
        'error',
        e.message || 'unknown error',
        `${e.filename ?? ''}:${e.lineno ?? 0}`
      );
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const reason = e.reason as unknown;
      reportClient(
        'rejection',
        reason instanceof Error
          ? reason.message || reason.name
          : String(reason).slice(0, 500)
      );
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  const stopSpeaking = () => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      /* ignore */
    }
    setSpeakingId(null);
  };

  const toggleSpeak = (id: string, text: string) => {
    if (speakingId === id) {
      stopSpeaking();
      return;
    }
    try {
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const synth = window.speechSynthesis;
      synth.cancel();
      const said = speakable(text);
      if (said === '') return;
      const utter = new SpeechSynthesisUtterance(said);
      utter.onend = () =>
        setSpeakingId((current) => (current === id ? null : current));
      utter.onerror = () =>
        setSpeakingId((current) => (current === id ? null : current));
      setSpeakingId(id);
      synth.speak(utter);
    } catch {
      setSpeakingId(null);
    }
  };

  const startNewChat = useCallback(() => {
    setMessages([]);
    setChatId(newId());
    setAttachments([]);
    setSidebarOpen(false);
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      /* ignore */
    }
    setSpeakingId(null);
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [setMessages]);

  const openThread = useCallback(
    (t: Thread) => {
      try {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.cancel();
        }
      } catch {
        /* ignore */
      }
      setSpeakingId(null);
      setChatId(t.id);
      setMessages(t.messages);
      // Pro is locked: old threads saved on Pro fall back to Basic.
      setSelectedModel(t.model === 'aetheris-pro' ? 'aetheris-basic' : t.model);
      setAttachments([]);
      setSidebarOpen(false);
    },
    [setMessages]
  );

  const clearAll = useCallback(() => {
    persistThreads(storeKey, []);
    setThreads([]);
    setMessages([]);
    setChatId(newId());
    setSearchQuery('');
    setSidebarOpen(false);
  }, [setMessages, storeKey]);

  const deleteThread = useCallback(
    (id: string) => {
      setRenamingId((current) => (current === id ? null : current));
      setThreads((prev) => {
        const next = prev.filter((t) => t.id !== id);
        persistThreads(storeKey, next);
        return next;
      });
      if (id === chatId) {
        setMessages([]);
        setChatId(newId());
      }
    },
    [chatId, setMessages, storeKey]
  );

  const commitRename = useCallback(() => {
    if (renamingId === null) return;
    const title = renameDraft.trim().slice(0, 80);
    if (title !== '') {
      setThreads((prev) => {
        const next = prev.map((t) => (t.id === renamingId ? { ...t, title } : t));
        persistThreads(storeKey, next);
        return next;
      });
    }
    setRenamingId(null);
  }, [renamingId, renameDraft, storeKey]);

  const shareThread = useCallback((t: Thread) => {
    const link = buildShareLink(t);
    if (!link) {
      showAttachError('Chat is too large to share as a link (photos make links huge).');
      return;
    }
    void copyText(link).then(() => {
      setSharedId(t.id);
      if (msgCopyTimer.current) clearTimeout(msgCopyTimer.current);
      msgCopyTimer.current = setTimeout(() => setSharedId(null), 1600);
    });
  }, []);

  const onPickFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    // Snapshot the selection first: clearing the input can invalidate
    // the live FileList in some browsers.
    const picked =
      e.target.files && e.target.files.length > 0
        ? Array.from(e.target.files).slice(0, MAX_ATTACHMENTS)
        : [];
    e.target.value = '';
    if (picked.length === 0) return;
    setAttachError(null);
    setProcessingFiles(true);
    void (async () => {
      const valid: AttachmentMeta[] = [];
      const failed: string[] = [];
      for (const f of picked) {
        try {
          const fileName = f.name || 'file';
          if (isHeicFile(f) || f.type.startsWith('image/')) {
            let blob: Blob = f;
            // iPhone HEIC/HEIF needs converting before any browser can read it.
            if (isHeicFile(f)) blob = await convertHeic(f);
            const downscaled = await downscaleImage(blob);
            if (!downscaled) {
              failed.push(fileName);
              continue;
            }
            valid.push({
              name: fileName,
              size: f.size,
              kind: 'image',
              contentType: downscaled.contentType,
              payload: downscaled.dataUrl
            });
          } else if (f.type === 'application/pdf' || /\.pdf$/i.test(fileName)) {
            if (f.size > MAX_PDF_BYTES) {
              failed.push(`${fileName} (over 3MB)`);
              continue;
            }
            const text = await extractPdfText(f);
            if (text === '') {
              failed.push(`${fileName} (no readable text — scanned image?)`);
              continue;
            }
            valid.push({
              name: fileName,
              size: f.size,
              kind: 'pdf',
              contentType: 'application/pdf',
              payload: text.slice(0, MAX_TEXT_CHARS)
            });
          } else if (
            f.type.startsWith('text/') ||
            f.type === 'application/json' ||
            /\.(txt|json|csv|md|log)$/i.test(fileName)
          ) {
            if (f.size > MAX_TEXT_BYTES) {
              failed.push(`${fileName} (over 5MB)`);
              continue;
            }
            const text = await readAsText(f);
            valid.push({
              name: fileName,
              size: f.size,
              kind: 'text',
              contentType: f.type || 'text/plain',
              payload: text.slice(0, MAX_TEXT_CHARS)
            });
          } else {
            failed.push(fileName);
          }
        } catch {
          failed.push(f.name || 'file');
        }
      }
      if (valid.length > 0) {
        setAttachments((prev) => [...prev, ...valid].slice(0, MAX_ATTACHMENTS));
      }
      if (failed.length > 0) {
        showAttachError(
          `Couldn't attach ${failed.join(', ')}. Supported: photos, PDF (max 3MB), TXT / JSON / CSV.`
        );
      } else if (valid.length === 0) {
        showAttachError('No usable files selected. Try a JPG or PNG photo.');
      }
      setProcessingFiles(false);
    })();
  };

  const toggleMic = () => {
    if (isListening) {
      try {
        recognitionRef.current?.stop();
      } catch {
        /* noop */
      }
      setIsListening(false);
      return;
    }
    const w = window as unknown as {
      SpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: { transcript: string }[][] }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
      webkitSpeechRecognition?: new () => {
        lang: string;
        interimResults: boolean;
        onresult: ((ev: { results: { transcript: string }[][] }) => void) | null;
        onend: (() => void) | null;
        start: () => void;
        stop: () => void;
      };
    };
    const SR = w.SpeechRecognition ?? w.webkitSpeechRecognition;
    if (!SR) {
      setIsListening(true);
      setTimeout(() => setIsListening(false), 1200);
      return;
    }
    try {
      const rec = new SR();
      rec.lang = 'en-US';
      rec.interimResults = false;
      rec.onresult = (ev) => {
        const transcript = ev.results?.[0]?.[0]?.transcript ?? '';
        if (transcript) setInput((prev) => (prev ? `${prev} ${transcript}` : transcript));
      };
      rec.onend = () => setIsListening(false);
      recognitionRef.current = rec;
      rec.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const generateImage = (prompt: string) => {
    autoRetried.current = false;
    setSendError(null);
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    if (isBlockedImagePrompt(prompt)) {
      showAttachError("That kind of image isn't allowed here. Try something else.");
      return;
    }
    // Semantic safety gate: understands misspellings, slang, euphemisms.
    // Fail closed — a blocked or failed check never generates.
    setCheckingDraw(true);
    void fetch('/api/moderate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt.slice(0, 500) })
    })
      .then(async (res) => {
        const data = (await res.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        return data !== null && data['ok'] === true;
      })
      .catch(() => false)
      .then((allowed) => {
        setCheckingDraw(false);
        if (!allowed) {
          showAttachError(
            "That kind of image isn't allowed here. Try something else."
          );
          return;
        }
        const remaining = spendCredits(creditId, CREDIT_COST_IMAGE_GEN);
        if (remaining === null) {
          lastSpent.current = 0;
          setOutOfCredits(true);
          return;
        }
        // NOTE: image costs live in the client ledger only — generations load
        // straight from the free image API (no server round-trip to meter, and
        // no cost to us), so there is nothing for the server to enforce here.
        lastSpent.current = 0;
        setCreditsLeft(remaining);
        setOutOfCredits(false);
        setInput('');
        if (textareaRef.current) textareaRef.current.style.height = 'auto';

        // Free photorealistic generation (no key, no quota): the picture URL
        // itself is the request — the browser renders it on load.
        const seed = Math.floor(Math.random() * 1000000);
        const imageUrl =
          'https://image.pollinations.ai/prompt/' +
          encodeURIComponent(prompt.slice(0, 500)) +
          `?width=1024&height=1024&seed=${seed}&nologo=true&model=flux&private=true`;
        const now = new Date();
        setMessages((prev) => [
          ...prev,
          { id: newId(), role: 'user', content: prompt, createdAt: now },
          {
            id: newId(),
            role: 'assistant',
            content: `![Generated image: ${prompt.slice(0, 120)}](${imageUrl})`,
            createdAt: now
          }
        ]);
      });
  };

  /** Commands the slash menu filters as you type `/…`. */
  const filteredSlash = useMemo(() => {
    if (!input.startsWith('/') || slashHidden || isLoading) return [];
    const match = /^\/([a-z]*)$/.exec(input);
    if (!match) return [];
    const q = match[1].toLowerCase();
    return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
  }, [input, slashHidden, isLoading]);

  const showSlashMenu = filteredSlash.length > 0;

  const selectSlash = useCallback(
    (name: string) => {
      setInput(`/${name} `);
      setSlashHidden(true);
      setSlashIndex(0);
      requestAnimationFrame(() => textareaRef.current?.focus());
    },
    [setInput]
  );

  /** Run a slash command. Returns true when the line was consumed. */
  const runSlash = (name: string, arg: string): boolean => {
    switch (name) {
      case 'draw':
      case 'image': {
        if (arg === '') {
          showAttachError('Describe the image after /draw — e.g. /draw a sunset.');
          return true;
        }
        generateImage(arg);
        return true;
      }
      case 'help': {
        const now = new Date();
        setMessages((prev) => [
          ...prev,
          {
            id: newId(),
            role: 'assistant',
            content: slashHelpText(),
            createdAt: now
          }
        ]);
        return true;
      }
      case 'new': {
        startNewChat();
        return true;
      }
      case 'export': {
        if (messages.length === 0) {
          showAttachError('Nothing to export yet. Send a message first.');
          return true;
        }
        exportChat();
        return true;
      }
      case 'retry': {
        if (messages.length === 0) {
          showAttachError('Nothing to regenerate yet.');
          return true;
        }
        autoRetried.current = false;
        setSendError(null);
        reload();
        return true;
      }
      default: {
        showAttachError(`Unknown command "/${name}". Try /help.`);
        return true;
      }
    }
  };

  const onFormSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const text = input.trim();
    if ((!text && attachments.length === 0) || isLoading) return;
    autoRetried.current = false;
    setSendError(null);
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }

    // Slash commands run locally typed or picked from the popup menu.
    const slashMatch = /^\/([a-z]+)(?:\s+([\s\S]*))?$/.exec(text);
    if (slashMatch && attachments.length === 0) {
      runSlash(slashMatch[1].toLowerCase(), (slashMatch[2] ?? '').trim());
      setInput('');
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }

    if (
      !chargeSend(
        attachments.filter((a) => a.kind === 'image').length,
        attachments.filter((a) => a.kind !== 'image').length
      )
    ) {
      return;
    }

    if (attachments.length > 0) {
      // Text files + PDFs ride along as message text; photos go as
      // vision attachments so every provider receives the real content.
      const fileBlocks = attachments
        .filter((a) => a.kind === 'text' || a.kind === 'pdf')
        .map((a) => `[${a.name}]:\n\`\`\`\n${a.payload}\n\`\`\``);
      const full = [text, ...fileBlocks].filter((s) => s !== '').join('\n\n');
      const media = attachments
        .filter((a) => a.kind === 'image')
        .map((a) => ({
          name: a.name,
          contentType: a.contentType,
          url: a.payload
        }));
      const outgoing: {
        role: 'user';
        content: string;
        experimental_attachments?: { name: string; contentType: string; url: string }[];
      } = { role: 'user', content: full };
      if (media.length > 0) outgoing.experimental_attachments = media;
      void append(outgoing);
      setInput('');
      setAttachments([]);
      if (textareaRef.current) textareaRef.current.style.height = 'auto';
      return;
    }
    handleSubmit(e);
  };

  const sendSuggestion = (s: string) => {
    if (isLoading) return;
    if (!chargeSend(0, 0)) return;
    autoRetried.current = false;
    setSendError(null);
    if (retryTimer.current) {
      clearTimeout(retryTimer.current);
      retryTimer.current = null;
    }
    void append({ role: 'user', content: s });
  };

  const exportChat = () => {
    if (messages.length === 0) return;
    const lines: string[] = [`# ${threadTitleFrom(messages)}`, ''];
    for (const m of messages) {
      if (m === null || typeof m !== 'object') continue;
      const isUserMsg = m.role === 'user';
      lines.push(isUserMsg ? '## You' : '## Aetheris', '');
      const imgs = isUserMsg ? messageImages(m) : [];
      if (imgs.length > 0) {
        lines.push(
          `_(${imgs.length} photo${imgs.length === 1 ? '' : 's'} attached — see the app for images)_`,
          ''
        );
      }
      const text = typeof m.content === 'string' ? m.content.trim() : '';
      if (text !== '') lines.push(text, '');
    }
    lines.push('---', '_Exported from Aetheris_');
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeTitle = threadTitleFrom(messages)
      .replace(/[^\w\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60);
    a.href = url;
    a.download = `aetheris-${safeTitle || 'chat'}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const canSend = input.trim().length > 0 || attachments.length > 0;

  const copyMessage = (id: string, text: string) => {
    void copyText(text).then(() => {
      setCopiedMsgId(id);
      if (msgCopyTimer.current) clearTimeout(msgCopyTimer.current);
      msgCopyTimer.current = setTimeout(() => setCopiedMsgId(null), 1600);
    });
  };

  const toggleReaction = (id: string, kind: 'up' | 'down') => {
    setReactions((prev) => {
      const next = { ...prev };
      if (next[id] === kind) {
        delete next[id];
      } else {
        next[id] = kind;
      }
      return next;
    });
  };

  const joinWaitlist = () => {
    setJoinedWaitlist(true);
    try {
      localStorage.setItem('aetheris-pro-waitlist', '1');
    } catch {
      /* ignore */
    }
  };

  const [waitlistEmail, setWaitlistEmail] = useState('');
  const [waitlistStatus, setWaitlistStatus] = useState<
    'idle' | 'sending' | 'done' | 'error'
  >('idle');
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [waitlistError, setWaitlistError] = useState<string | null>(null);

  const submitWaitlist = (e?: React.FormEvent) => {
    e?.preventDefault();
    const email = waitlistEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setWaitlistError('Enter a valid email address.');
      setWaitlistStatus('error');
      return;
    }
    setWaitlistStatus('sending');
    setWaitlistError(null);
    void fetch('/api/waitlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email })
    })
      .then(async (r) => {
        const d = (await r.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        if (!r.ok) {
          const message =
            (d && typeof d['message'] === 'string' && d['message']) ||
            'Could not join the waitlist. Try again.';
          throw new Error(message);
        }
        setWaitlistPosition(
          d && typeof d['position'] === 'number' ? d['position'] : null
        );
        setWaitlistStatus('done');
        joinWaitlist();
      })
      .catch((err: unknown) => {
        setWaitlistError(
          err instanceof Error ? err.message : 'Could not join. Try again.'
        );
        setWaitlistStatus('error');
      });
  };



  return (
    <div
      className={`flex h-[100dvh] flex-col bg-abyss text-slate-100 ${
        reduceMotion ? 'reduce-motion' : ''
      }`}
    >
      {/* ------------------------------- header ------------------------------ */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-abyss/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center gap-2 px-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg p-2 text-slate-300 hover:bg-white/5 hover:text-white"
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>

          <HeaderBrand size={24} />

          <div className="ml-auto flex items-center gap-2">
            <div ref={modelMenuRef}>
            <div className="relative">
              <button
                type="button"
                onClick={() => setModelOpen((v) => !v)}
                className="flex items-center gap-2 rounded-full border border-white/10 bg-surface/80 py-1.5 pl-3 pr-2 text-left transition hover:border-white/20"
                aria-haspopup="listbox"
                aria-expanded={modelOpen}
              >
                <Zap size={14} className="shrink-0 text-aether" />
                <span className="max-w-[110px] truncate text-[13px] font-medium text-slate-100 sm:max-w-none">
                  {activeModel.label}
                </span>
                <ChevronDown
                  size={15}
                  className={`text-slate-400 transition ${modelOpen ? 'rotate-180' : ''}`}
                />
              </button>

              {modelOpen && (
                <div
                  role="listbox"
                  className="absolute right-0 top-11 w-64 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-xl shadow-black/50"
                >
                  {MODELS.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={m.id === selectedModel}
                      title={m.locked ? 'Aetheris Pro is locked — see upgrade options' : undefined}
                      onClick={() => {
                        if (m.locked) {
                          setModelOpen(false);
                          setUpgradeOpen(true);
                          return;
                        }
                        setSelectedModel(m.id);
                        setModelOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 px-3.5 py-3 text-left transition hover:bg-white/5 ${
                        m.id === selectedModel ? 'bg-cyan-400/[0.07]' : ''
                      }`}
                    >
                      <span
                        className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                          m.id === 'aetheris-pro'
                            ? 'bg-white/10 text-slate-400'
                            : 'bg-cyan-400/15 text-cyan-200'
                        }`}
                      >
                        {m.badge}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-white">
                          {m.label}
                        </span>
                        <span className="block truncate text-[11px] text-slate-400">
                          {m.hint}
                        </span>
                      </span>
                      {m.locked ? (
                        <Lock size={15} className="shrink-0 text-slate-500" />
                      ) : (
                        m.id === selectedModel && (
                          <Check size={15} className="shrink-0 text-cyan-300" />
                        )
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
            </div>

            <span
              title={`Daily credits — resets at midnight (${isGuest ? 'guest' : 'signed in'})`}
              className="hidden shrink-0 items-center gap-1 rounded-full border border-white/10 bg-surface/80 px-2.5 py-1 text-[12px] font-medium text-slate-300 min-[420px]:flex"
            >
              <Coins size={13} className="text-cyan-300" />
              {creditsLeft}
            </span>

            {status === 'authenticated' && session?.user ? (
              <div className="relative shrink-0" ref={accountMenuRef}>
                <button
                  type="button"
                  onClick={() => setAccountOpen((v) => !v)}
                  aria-haspopup="menu"
                  aria-expanded={accountOpen}
                  className="flex items-center gap-1.5 rounded-full border border-transparent py-0.5 pl-0.5 pr-1 transition hover:border-white/10 hover:bg-white/5"
                >
                  <ProfileAvatar
                    src={session.user.image}
                    name={session.user.name}
                    size={30}
                  />
                  <span className="hidden max-w-[110px] truncate text-[13px] font-medium text-slate-200 lg:block">
                    {session.user.name ?? session.user.email}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`hidden text-slate-400 transition lg:block ${accountOpen ? 'rotate-180' : ''}`}
                  />
                </button>

                {accountOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-10 z-50 w-52 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-xl shadow-black/50"
                  >
                    <div className="border-b border-white/5 px-3.5 py-2.5">
                      <p className="truncate text-[13px] font-medium text-white">
                        {session.user.name ?? 'Signed in'}
                      </p>
                      {session.user.email && (
                        <p className="truncate text-[11px] text-slate-500">
                          {session.user.email}
                        </p>
                      )}
                    </div>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        setAccountOpen(false);
                        setSettingsOpen(true);
                      }}
                      className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-slate-200 transition hover:bg-white/5"
                    >
                      <Settings size={15} className="text-slate-400" /> Settings
                    </button>
                    <div className="border-t border-white/5">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => signOut({ callbackUrl: '/' })}
                        className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-[13px] text-slate-200 transition hover:bg-white/5"
                      >
                        <LogOut size={15} className="text-slate-400" /> Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => signIn('google')}
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                <LogIn size={15} />
                <span className="hidden sm:inline">Sign in</span>
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="relative mx-auto flex w-full max-w-3xl flex-1 flex-col overflow-hidden">
        {/* ------------------------------ drawer ----------------------------- */}
        {sidebarOpen && (
          <button
            type="button"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-[1px]"
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col border-r border-white/5 bg-surface transition-transform duration-200 ${
            sidebarOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
        >
          <div className="flex items-center gap-2 border-b border-white/5 p-3">
            <HeaderBrand size={24} tagline={false} />
            <button
              type="button"
              onClick={() => setSidebarOpen(false)}
              className="ml-auto rounded-lg p-1.5 text-slate-400 hover:bg-white/5 hover:text-white"
              aria-label="Close sidebar"
            >
              <X size={18} />
            </button>
          </div>

          <div className="p-3">
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                startNewChat();
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  startNewChat();
                }
              }}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-[#06121a] transition hover:bg-cyan-300"
            >
              <Plus size={16} strokeWidth={2.5} /> New Chat
            </button>
          </div>

          <div className="px-3 pb-2">
            <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-abyss px-3 py-2 transition focus-within:border-cyan-300/40">
              <Search size={15} className="shrink-0 text-slate-500" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search chats..."
                aria-label="Search chats"
                className="w-full bg-transparent text-[13px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              {searchQuery !== '' && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear search"
                  className="shrink-0 rounded p-0.5 text-slate-500 transition hover:text-white"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {isGuest && (
            <div className="mx-3 mb-2 rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[12px] leading-5 text-slate-400">
                You&apos;re chatting as a guest. Sign in to save your history.
              </p>
              <button
                type="button"
                onClick={() => signIn('google')}
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-slate-900 transition hover:bg-slate-200"
              >
                <LogIn size={14} /> Sign in with Google
              </button>
            </div>
          )}

          <p className="px-4 pb-1 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Recent
          </p>
          <div className="flex-1 overflow-y-auto px-2 pb-2">
            {threads.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-slate-500">
                No conversations yet.
                <br />
                Start a new chat below.
              </p>
            ) : filteredThreads.length === 0 ? (
              <p className="px-3 py-6 text-center text-[13px] text-slate-500">
                No matching conversations found.
              </p>
            ) : (
              filteredThreads.map((t) => (
                <div
                  key={t.id}
                  className={`mb-1 flex items-center gap-0.5 rounded-lg transition hover:bg-white/5 ${
                    t.id === chatId ? 'bg-cyan-400/10' : ''
                  }`}
                >
                  {renamingId === t.id ? (
                    <div className="min-w-0 flex-1 px-3 py-2.5">
                      <input
                        autoFocus
                        value={renameDraft}
                        maxLength={80}
                        aria-label="Rename chat"
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            commitRename();
                          } else if (e.key === 'Escape') {
                            setRenamingId(null);
                          }
                        }}
                        onBlur={() => commitRename()}
                        className="w-full rounded-md border border-cyan-300/40 bg-abyss px-2 py-1 text-[13px] text-white focus:outline-none"
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Open chat: ${t.title}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        openThread(t);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          openThread(t);
                        }
                      }}
                      className="min-w-0 flex-1 px-3 py-2.5 text-left"
                    >
                      <span className="block truncate text-[13px] font-medium text-slate-100">
                        {t.title}
                      </span>
                      <span className="mt-0.5 block text-[11px] text-slate-500">
                        {new Date(t.createdAt).toLocaleDateString()} ·{' '}
                        {t.model === 'aetheris-pro' ? 'Pro (locked)' : 'Basic'}
                      </span>
                    </button>
                  )}
                  {renamingId !== t.id && (
                    <span className="flex shrink-0 items-center pr-1">
                      <button
                        type="button"
                        aria-label={`Rename chat: ${t.title}`}
                        title="Rename"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setRenamingId(t.id);
                          setRenameDraft(t.title);
                        }}
                        className="rounded-md p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-200"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Copy share link for: ${t.title}`}
                        title={sharedId === t.id ? 'Link copied' : 'Copy share link'}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => shareThread(t)}
                        className="rounded-md p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-slate-200"
                      >
                        {sharedId === t.id ? (
                          <Check size={14} className="text-emerald-300" />
                        ) : (
                          <Share2 size={14} />
                        )}
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete chat: ${t.title}`}
                        title="Delete"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => deleteThread(t.id)}
                        className="rounded-md p-1.5 text-slate-600 transition hover:bg-white/5 hover:text-red-300"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="border-t border-white/5 p-3">
            <button
              type="button"
              onClick={exportChat}
              disabled={messages.length === 0}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:border-white/25 hover:text-white disabled:opacity-40"
            >
              <Download size={15} /> Export chat (.md)
            </button>
            <button
              type="button"
              onClick={openHelp}
              className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:border-white/25 hover:text-white"
            >
              <LifeBuoy size={15} /> Help &amp; Support
            </button>
            {canInstall && (
              <button
                type="button"
                onClick={installApp}
                className="mb-2 flex w-full items-center justify-center gap-2 rounded-xl border border-cyan-300/30 bg-cyan-400/10 px-3 py-2 text-[13px] font-medium text-cyan-200 transition hover:bg-cyan-400/15"
              >
                <Smartphone size={15} /> Install app
              </button>
            )}
            {status === 'authenticated' && session?.user && (
              <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-white/10 px-3 py-2">
                <ProfileAvatar
                  src={session.user.image}
                  name={session.user.name}
                  size={30}
                />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[13px] font-medium text-white">
                    {session.user.name ?? 'Signed in'}
                  </span>
                  {session.user.email && (
                    <span className="block truncate text-[11px] text-slate-500">
                      {session.user.email}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={() => signOut({ callbackUrl: '/' })}
                  className="rounded-lg p-1.5 text-slate-400 transition hover:bg-white/5 hover:text-white"
                  aria-label="Sign out"
                  title="Sign out"
                >
                  <LogOut size={16} />
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={clearAll}
              disabled={threads.length === 0 && messages.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-[13px] font-medium text-slate-300 transition hover:border-red-400/40 hover:text-red-300 disabled:opacity-40"
            >
              <Trash2 size={15} /> Clear conversations
            </button>
          </div>
        </aside>

        {/* ------------------------------- chat ------------------------------ */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pb-4 pt-4 sm:px-4">
          {messages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="mb-4 scale-125">
                <AetherisLogo size={64} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white">
                {daypart}
                {session?.user?.name
                  ? `, ${session.user.name.split(' ')[0]}`
                  : ''}
              </h1>
              <p className="mt-2 max-w-sm text-[14px] leading-6 text-slate-400">
                What are we working on today?
              </p>
              <p className="mt-1.5 max-w-sm text-[12.5px] leading-6 text-slate-500">
                Tip: type <span className="font-mono text-slate-300">/draw</span> followed
                by a description to generate an image.
              </p>
              <div className="mt-6 grid w-full gap-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => sendSuggestion(s)}
                    className="rounded-xl border border-white/10 bg-surface/80 px-3.5 py-2.5 text-left text-[13px] text-slate-200 transition hover:border-white/25 hover:bg-surface"
                  >
                    <span className="mr-2 inline-block text-slate-500">
                      <ArrowRight size={13} className="inline" />
                    </span>
                    {s}
                  </button>
                ))}
              </div>
              <p className="mt-5 text-[11px] text-slate-600">
                Using {activeModel.label}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {(Array.isArray(messages) ? messages : []).map((m, index) => {
                const role = m !== null && typeof m === 'object' ? m.role : 'assistant';
                const isUser = role === 'user';
                const attachedImages = isUser ? messageImages(m) : [];
                const attachedFiles = isUser ? messageFiles(m) : [];
                const bodyText = typeof m?.content === 'string' ? m.content : '';
                const key = typeof m?.id === 'string' && m.id !== '' ? m.id : `msg-${index}`;
                const timeText = formatTime(
                  m !== null && typeof m === 'object'
                    ? (m as { createdAt?: unknown }).createdAt
                    : null
                );
                return (
                  <div
                    key={key}
                    className={`group flex gap-2.5 ${isUser ? 'flex-row-reverse' : ''}`}
                  >
                    <div className="mt-0.5 h-8 w-8 shrink-0">
                      {isUser ? (
                        <ProfileAvatar
                          src={session?.user?.image}
                          name={session?.user?.name}
                          size={32}
                        />
                      ) : (
                        <BasicBotAvatar size={32} />
                      )}
                    </div>
                    <div
                      className={`flex min-w-0 max-w-[85%] flex-col sm:max-w-[80%] ${
                        isUser ? 'items-end' : 'items-start'
                      }`}
                    >
                    <div
                      className={`w-full rounded-2xl px-3.5 py-2.5 ${
                        isUser
                          ? 'rounded-tr-md border border-white/10 bg-white/[0.07] text-slate-100'
                          : 'rounded-tl-md border border-white/5 bg-surface text-slate-100'
                      } ${!isUser && isLoading && m === messages[messages.length - 1] ? 'stream-caret' : ''}`}
                    >
                      {isUser ? (
                        <div>
                          {attachedImages.length > 0 && (
                            <div className="mb-2 grid grid-cols-2 gap-1.5">
                              {attachedImages.map((src) => (
                                <a
                                  key={src.slice(-32)}
                                  href={src}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <img
                                    src={src}
                                    alt="Attached photo"
                                    className="max-h-48 w-full rounded-lg object-cover"
                                  />
                                </a>
                              ))}
                            </div>
                          )}
                          {attachedFiles.length > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1.5">
                              {attachedFiles.map((f) => (
                                <a
                                  key={f.url.slice(-32) + f.name}
                                  href={f.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-slate-200 transition hover:border-white/25"
                                >
                                  <FileText size={12} className="shrink-0 text-slate-400" />
                                  <span className="max-w-[140px] truncate">{f.name}</span>
                                </a>
                              ))}
                            </div>
                          )}
                          {bodyText.trim() !== '' && (
                            <p className="whitespace-pre-wrap text-[14.5px] leading-7">
                              {bodyText}
                            </p>
                          )}
                        </div>
                      ) : (
                        <div className="min-w-0">
                          <ChatMarkdown content={bodyText} />
                          <div className="mt-1.5 flex items-center gap-0.5 transition md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100">
                            <button
                              type="button"
                              onClick={() => copyMessage(key, bodyText)}
                              aria-label="Copy response"
                              title="Copy response"
                              className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
                            >
                              {copiedMsgId === key ? (
                                <Check size={14} className="text-emerald-300" />
                              ) : (
                                <Copy size={14} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => reload()}
                              aria-label="Regenerate response"
                              title="Regenerate response"
                              className="rounded-md p-1.5 text-slate-500 transition hover:bg-white/5 hover:text-slate-200"
                            >
                              <RefreshCw size={14} />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleSpeak(key, bodyText)}
                              aria-label={
                                speakingId === key ? 'Stop reading aloud' : 'Read aloud'
                              }
                              aria-pressed={speakingId === key}
                              title={
                                speakingId === key ? 'Stop reading aloud' : 'Read aloud'
                              }
                              className={`rounded-md p-1.5 transition hover:bg-white/5 ${
                                speakingId === key
                                  ? 'text-cyan-300'
                                  : 'text-slate-500 hover:text-slate-200'
                              }`}
                            >
                              {speakingId === key ? (
                                <Square size={14} />
                              ) : (
                                <Volume2 size={14} />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleReaction(key, 'up')}
                              aria-label="Good response"
                              aria-pressed={reactions[key] === 'up'}
                              title="Good response"
                              className={`rounded-md p-1.5 transition hover:bg-white/5 ${
                                reactions[key] === 'up'
                                  ? 'text-cyan-300'
                                  : 'text-slate-500 hover:text-slate-200'
                              }`}
                            >
                              <ThumbsUp
                                size={14}
                                className={reactions[key] === 'up' ? 'fill-current' : ''}
                              />
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleReaction(key, 'down')}
                              aria-label="Bad response"
                              aria-pressed={reactions[key] === 'down'}
                              title="Bad response"
                              className={`rounded-md p-1.5 transition hover:bg-white/5 ${
                                reactions[key] === 'down'
                                  ? 'text-cyan-300'
                                  : 'text-slate-500 hover:text-slate-200'
                              }`}
                            >
                              <ThumbsDown
                                size={14}
                                className={reactions[key] === 'down' ? 'fill-current' : ''}
                              />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                    {showTimestamps && timeText !== null && (
                      <span className="mt-1 px-1 text-[10.5px] text-slate-500">
                        {timeText}
                      </span>
                    )}
                    </div>
                  </div>
                );
              })}

              {isLoading &&
                messages[messages.length - 1]?.role === 'user' && (
                  <div className="flex gap-2.5">
                    <div className="h-8 w-8 shrink-0">
                      <BasicBotAvatar size={32} />
                    </div>
                    <div className="flex items-center gap-1.5 rounded-2xl rounded-tl-md border border-white/5 bg-surface px-4 py-3">
                      {[0, 1, 2].map((d) => (
                        <span
                          key={d}
                          className={`h-1.5 w-1.5 rounded-full bg-slate-400 ${
                            reduceMotion ? '' : 'animate-bounce'
                          }`}
                          style={{ animationDelay: `${d * 150}ms` }}
                        />
                      ))}
                    </div>
                  </div>
                )}

              {error && (
                <div className="rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-3 text-[13px] text-red-200">
                  {sendError ?? 'Something went wrong while streaming. Please try again.'}
                  <button
                    type="button"
                    onClick={() => {
                      autoRetried.current = false;
                      setSendError(null);
                      reload();
                    }}
                    className="ml-2 font-semibold underline underline-offset-2 hover:text-red-100"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ---------------------------- input bar ---------------------------- */}
        <div className="sticky bottom-0 z-20 bg-gradient-to-t from-abyss via-abyss to-transparent px-3 pb-3 pt-6 sm:px-4 sm:pb-4">
          {attachError && (
            <div className="mb-2 rounded-xl border border-red-400/30 bg-red-500/10 px-3.5 py-2.5 text-[12.5px] text-red-200">
              {attachError}
            </div>
          )}
          {processingFiles && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-surface px-3.5 py-2.5 text-[12.5px] text-slate-300">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
              Adding your files…
            </div>
          )}
          {checkingDraw && (
            <div className="mb-2 flex items-center gap-2 rounded-xl border border-white/10 bg-surface px-3.5 py-2.5 text-[12.5px] text-slate-300">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/15 border-t-cyan-300" />
              Checking that prompt…
            </div>
          )}
          {outOfCredits && (
            <div className="mb-2 rounded-xl border border-amber-400/30 bg-amber-500/10 px-3.5 py-2.5 text-[12.5px] leading-6 text-amber-200">
              {isGuest ? (
                <>
                  You&apos;re out of free credits for today.{' '}
                  <button
                    type="button"
                    onClick={() => signIn('google')}
                    className="font-semibold underline underline-offset-2 hover:text-amber-100"
                  >
                    Sign in for {CREDIT_DAILY_USER} a day
                  </button>
                  .
                </>
              ) : (
                <>
                  You&apos;re out of credits — more land at midnight. Pro members
                  get {CREDIT_DAILY_PRO.toLocaleString()} a day.
                </>
              )}
            </div>
          )}
          {attachments.length > 0 && (
            <div className="mb-2 flex flex-wrap gap-1.5">
              {attachments.map((a, i) => (
                <span
                  key={`${i}-${a.name}`}
                  className="flex items-center gap-2 rounded-xl border border-white/10 bg-surface py-1 pl-1 pr-2"
                >
                  {a.kind === 'image' ? (
                    <img
                      src={a.payload}
                      alt={a.name}
                      className="h-10 w-10 rounded-lg object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-white/5 text-slate-300">
                      <FileText size={18} />
                    </span>
                  )}
                  <span className="max-w-[120px] truncate text-[11px] text-slate-200">
                    {a.name}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove ${a.name}`}
                    onClick={() =>
                      setAttachments((prev) => prev.filter((_, j) => j !== i))
                    }
                    className="text-slate-400 hover:text-white"
                  >
                    <X size={12} />
                  </button>
                </span>
              ))}
            </div>
          )}

          <form
            onSubmit={onFormSubmit}
            className="relative rounded-2xl border border-white/10 bg-surface p-2 focus-within:border-white/25"
          >
            {showSlashMenu && (
              <div
                role="listbox"
                aria-label="Commands"
                className="absolute inset-x-2 bottom-full z-30 mb-2 overflow-hidden rounded-xl border border-white/10 bg-surface shadow-xl shadow-black/50"
              >
                {filteredSlash.map((c, i) => (
                  <button
                    key={c.name}
                    type="button"
                    role="option"
                    aria-selected={i === slashIndex}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectSlash(c.name);
                    }}
                    onMouseEnter={() => setSlashIndex(i)}
                    className={`flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition ${
                      i === slashIndex ? 'bg-cyan-400/10' : 'hover:bg-white/5'
                    }`}
                  >
                    <span className="font-mono text-[13px] font-semibold text-cyan-200">
                      /{c.name}
                    </span>
                    {c.hint !== '' && (
                      <span className="font-mono text-[11px] text-slate-500">
                        {c.hint}
                      </span>
                    )}
                    <span className="ml-auto truncate text-[12px] text-slate-400">
                      {c.description}
                    </span>
                  </button>
                ))}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => {
                handleInputChange(e);
                setSlashHidden(false);
                setSlashIndex(0);
              }}
              onKeyDown={(e) => {
                if (showSlashMenu) {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setSlashIndex((i) => (i + 1) % filteredSlash.length);
                    return;
                  }
                  if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setSlashIndex(
                      (i) => (i - 1 + filteredSlash.length) % filteredSlash.length
                    );
                    return;
                  }
                  if (e.key === 'Enter' || e.key === 'Tab') {
                    e.preventDefault();
                    const picked =
                      filteredSlash[slashIndex] ?? filteredSlash[0];
                    if (picked) selectSlash(picked.name);
                    return;
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setSlashHidden(true);
                    return;
                  }
                }
                if (e.key === 'Enter' && !e.shiftKey && enterToSend) {
                  e.preventDefault();
                  (e.target as HTMLTextAreaElement).form?.requestSubmit();
                }
              }}
              rows={1}
              placeholder={`Message ${activeModel.id === 'aetheris-pro' ? 'Aetheris Pro' : 'Aetheris'}…`}
              className="max-h-[160px] w-full resize-none bg-transparent px-2.5 py-2 text-[14.5px] leading-6 text-slate-100 placeholder:text-slate-500 focus:outline-none"
            />
            <div className="flex items-center gap-1 px-1 pb-0.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,.pdf,.txt,.json,.csv,.md,.heic,.heif"
                multiple
                className="hidden"
                onChange={onPickFiles}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg p-2 text-slate-400 transition hover:bg-white/5 hover:text-cyan-200"
                aria-label="Attach photos"
                title="Attach photos"
              >
                <Paperclip size={18} />
              </button>
              <button
                type="button"
                onClick={toggleMic}
                aria-label={isListening ? 'Stop voice input' : 'Start voice input'}
                className={`rounded-lg p-2 transition ${
                  isListening
                    ? 'bg-red-500/15 text-red-300'
                    : 'text-slate-400 hover:bg-white/5 hover:text-cyan-200'
                }`}
              >
                <Mic size={18} />
              </button>

              {isListening && (
                <span className="text-[11px] font-medium text-red-300">
                  Listening…
                </span>
              )}

              <div className="ml-auto flex items-center gap-1.5">
                {isLoading ? (
                  <button
                    type="button"
                    onClick={() => stop()}
                    className="flex items-center gap-1.5 rounded-xl bg-white/10 px-3.5 py-2 text-[13px] font-semibold text-white transition hover:bg-white/15"
                  >
                    <Square size={14} /> Stop
                  </button>
                ) : (
                  <button
                    type="submit"
                    disabled={!canSend}
                    aria-label="Send message"
                    className={`flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-[13px] font-semibold transition ${
                      canSend
                        ? 'bg-cyan-400 text-[#06121a] hover:bg-cyan-300'
                        : 'cursor-not-allowed bg-white/5 text-slate-500'
                    }`}
                  >
                    <Send size={15} /> Send
                  </button>
                )}
              </div>
            </div>
          </form>
          <p className="mt-1.5 text-center text-[10.5px] text-slate-600">
            Aetheris can make mistakes. Verify important information.
          </p>
        </div>
      </div>

      {/* ------------------------- upgrade modal ------------------------- */}
      {upgradeOpen && (
        <ModalShell title="Upgrade to Aetheris Pro" onClose={() => setUpgradeOpen(false)}>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-cyan-400/15 px-2.5 py-1 text-[12px] font-bold text-cyan-200">
              $20 / month
            </span>
            <span className="text-[12px] text-slate-400">Coming Soon — Join Waitlist</span>
          </div>
          <ul className="mt-4 space-y-2.5">
            {[
              'Access to Aetheris v1.0 (Advanced Reasoning)',
              'Faster generation speeds & zero queue times',
              'Increased rate limits & file attachment support',
              `${CREDIT_DAILY_PRO.toLocaleString()} daily credits for heavy use`
            ].map((feature) => (
              <li key={feature} className="flex items-start gap-2.5 text-[13.5px] text-slate-200">
                <Check size={16} className="mt-0.5 shrink-0 text-cyan-300" />
                {feature}
              </li>
            ))}
          </ul>
          {joinedWaitlist || waitlistStatus === 'done' ? (
            <div className="mt-5 flex items-center justify-center gap-2 rounded-xl bg-white/10 px-3 py-2.5 text-sm font-semibold text-slate-200">
              <Check size={16} className="text-emerald-300" /> You&apos;re on
              the waitlist
              {waitlistPosition !== null && (
                <span className="text-slate-400">· #{waitlistPosition} in line</span>
              )}
            </div>
          ) : (
            <form onSubmit={submitWaitlist} className="mt-5">
              <label
                htmlFor="waitlist-email"
                className="mb-1.5 block text-[12px] font-medium text-slate-300"
              >
                Email for your invite
              </label>
              <input
                id="waitlist-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={waitlistEmail}
                onChange={(e) => setWaitlistEmail(e.target.value)}
                className="w-full rounded-xl border border-white/10 bg-abyss px-3 py-2.5 text-[14px] text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />
              {waitlistStatus === 'error' && waitlistError && (
                <p className="mt-1.5 text-[12px] text-red-300">{waitlistError}</p>
              )}
              <button
                type="submit"
                disabled={waitlistStatus === 'sending'}
                className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#00F2FE] px-3 py-2.5 text-sm font-semibold text-[#06121a] shadow-glow transition hover:brightness-110 disabled:opacity-60"
              >
                {waitlistStatus === 'sending' ? 'Joining…' : 'Join Pro Waitlist'}
              </button>
            </form>
          )}
          <p className="mt-2.5 text-center text-[11px] text-slate-500">
            No payment today. We only ever email you about Pro.
          </p>
        </ModalShell>
      )}

      {/* ----------------------- help & support modal ---------------------- */}
      {helpOpen && (
        <ModalShell title="Help & Support" onClose={() => setHelpOpen(false)}>
          {contactStatus === 'done' ? (
            <div className="py-2 text-center">
              <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-emerald-400/15">
                <Check size={20} className="text-emerald-300" />
              </span>
              <p className="mt-3 text-[14px] font-semibold text-white">
                Reply on its way
              </p>
              <p className="mx-auto mt-1 max-w-[260px] text-[12.5px] leading-6 text-slate-400">
                Our AI drafted an answer and emailed it to {contactEmail}.
                Check spam if it doesn&apos;t arrive in a few minutes.
              </p>
            </div>
          ) : (
            <>
              <p className="text-[13px] leading-6 text-slate-400">
                Describe the problem — our AI drafts a reply and emails it to you.
              </p>
              <form onSubmit={submitSupport} className="mt-3">
                <label
                  htmlFor="support-email"
                  className="mb-1.5 block text-[12px] font-medium text-slate-300"
                >
                  Your email
                </label>
                <input
                  id="support-email"
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-abyss px-3 py-2.5 text-[14px] text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                />
                <label
                  htmlFor="support-message"
                  className="mb-1.5 mt-3 block text-[12px] font-medium text-slate-300"
                >
                  What went wrong?
                </label>
                <textarea
                  id="support-message"
                  rows={4}
                  placeholder="e.g. Sign-in loops back to the homepage…"
                  value={contactMessage}
                  onChange={(e) => setContactMessage(e.target.value)}
                  className="max-h-[160px] w-full resize-none rounded-xl border border-white/10 bg-abyss px-3 py-2.5 text-[14px] leading-6 text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
                />
                {contactStatus === 'error' && contactError && (
                  <p className="mt-1.5 text-[12px] text-red-300">{contactError}</p>
                )}
                <button
                  type="submit"
                  disabled={contactStatus === 'sending'}
                  className="mt-2.5 flex w-full items-center justify-center gap-2 rounded-xl bg-cyan-400 px-3 py-2.5 text-sm font-semibold text-[#06121a] transition hover:bg-cyan-300 disabled:opacity-60"
                >
                  {contactStatus === 'sending' ? 'Sending…' : 'Send to support'}
                </button>
              </form>
            </>
          )}
        </ModalShell>
      )}

      {/* ------------------------- settings modal ------------------------ */}
      {settingsOpen && (
        <ModalShell title="Settings" onClose={() => setSettingsOpen(false)}>
          <div className="space-y-1">
            <div className="flex items-center justify-between rounded-lg px-1 py-2">
              <div>
                <p className="text-[13.5px] font-medium text-slate-100">Appearance</p>
                <p className="text-[11.5px] text-slate-500">Aetheris dark theme</p>
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                Dark · On
              </span>
            </div>
            <div className="flex items-center justify-between rounded-lg px-1 py-2">
              <div>
                <p className="text-[13.5px] font-medium text-slate-100">Streaming responses</p>
                <p className="text-[11.5px] text-slate-500">Tokens appear in real time</p>
              </div>
              <span className="rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-300">
                Always on
              </span>
            </div>
            <PrefToggle
              label="Enter to send"
              hint="Shift + Enter for a new line"
              checked={enterToSend}
              onToggle={toggleEnterToSend}
            />
            <PrefToggle
              label="Auto-scroll"
              hint="Follow new messages as they stream in"
              checked={autoScroll}
              onToggle={toggleAutoScroll}
            />
            <PrefToggle
              label="Message timestamps"
              hint="Show the time under each message"
              checked={showTimestamps}
              onToggle={toggleTimestamps}
            />
            <PrefToggle
              label="Reduce motion"
              hint="Turn off typing and streaming animations"
              checked={reduceMotion}
              onToggle={toggleReduceMotion}
            />
            <div className="mt-2 border-t border-white/5 px-1 pt-3">
              <p className="text-[13.5px] font-medium text-slate-100">
                Personalization
              </p>
              <p className="mb-2 text-[11.5px] text-slate-500">
                How should Aetheris talk to you? Saved on this device
                {isGuest ? ' (sign in to keep it per account)' : ''}.
              </p>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value.slice(0, 1000))}
                rows={3}
                maxLength={1000}
                placeholder="e.g. Keep answers short. I'm learning Spanish — correct my mistakes."
                aria-label="Custom instructions for Aetheris"
                className="w-full resize-none rounded-xl border border-white/10 bg-abyss px-3 py-2.5 text-[13.5px] leading-6 text-slate-100 placeholder:text-slate-500 focus:border-cyan-300/50 focus:outline-none"
              />
              <div className="mt-2 grid grid-cols-3 gap-1.5" role="group" aria-label="Response style">
                {RESPONSE_STYLES.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setStyle(s.id)}
                    aria-pressed={styleId === s.id}
                    className={`rounded-lg border px-2 py-1.5 text-[12.5px] font-medium transition ${
                      styleId === s.id
                        ? 'border-cyan-300/50 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <p className="mt-3 border-t border-white/5 pt-3 text-[11px] leading-5 text-slate-500">
            More settings (account, notifications, data controls) are coming soon.{' '}
            <a href="/privacy" className="underline underline-offset-2 hover:text-slate-300">
              Privacy
            </a>{' '}
            ·{' '}
            <a href="/terms" className="underline underline-offset-2 hover:text-slate-300">
              Terms
            </a>
          </p>
        </ModalShell>
      )}

    </div>
  );
}
