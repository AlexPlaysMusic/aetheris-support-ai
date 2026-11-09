# Aetheris AI API and self-hosted inference

## Status and architecture

The developer API and key-management layer are Aetheris-owned. The website's
chatbot temporarily uses Gemini so visitors can chat while Aetheris has no
deployed model server. This is a third-party inference service, not an Aetheris
foundation model. The `/api/v1` developer API serves exclusively through a
configured OpenAI-compatible provider (OpenRouter, Groq, local vLLM, or an
Aetheris inference host) — Google's key is deliberately not a fallback there.
Callers only ever hold Aetheris API keys, never provider keys.

Developer API keys (SHA-256 digests plus metadata) are stored in Vercel Blob
on the production project, in a JSON file directory on self-hosted deploys, or
in process memory as a last resort — no Redis is required for keys. Upstash
Redis, when configured, remains the store for the application's credit ledger
and strict rate counters. Aetheris inference still runs
separately on a GPU host under Aetheris's control; the repository currently has
no deployed GPU inference host or selected model weights. No foundation-model
ownership or training is claimed.

```text
Website / public API (Vercel)
  ├─ /api/chat             website chat (temporarily Gemini)
  ├─ /api/v1/*             authenticated developer API
  │     └─ configured OpenAI-compatible provider (required; no Google fallback)
  ├─ /api/keys             signed-in key creation, usage, and revocation
  └─ Key store             Vercel Blob / file / memory (SHA-256 digests)
             │ HTTPS + private provider bearer key
             ▼
OpenAI-compatible provider (OpenRouter, Groq, local vLLM, or Aetheris GPU host)
  └─ /v1/models and /v1/chat/completions
```

## API endpoints

The API is available at:

- `https://www.aetherisai.me/api/v1/models`
- `https://www.aetherisai.me/api/v1/chat/completions`

For the shorter public host, assign `api.aetherisai.me` to the same Vercel
project in Vercel's domain settings and configure its DNS. The middleware maps
`https://api.aetherisai.me/v1/...` to the same API routes. This domain/DNS
assignment is a manual deployment step and is not performed by this repository.

Both endpoints require `Authorization: Bearer <Aetheris API key>`.

## VS Code extension

The `vscode-extension` directory contains the Aetheris AI VS Code extension.
It signs users in through the existing website, stores a revocable 30-day
access token in VS Code SecretStorage, and uses the website's `/api/chat`
endpoint for chat and selected-code assistance. Prompts are processed by
Gemini temporarily, as disclosed in the extension and the privacy policy.
The Marketplace account owner must publish the generated VSIX; publishing is
not automated by this repository.

From the repository root, run `npm install --prefix vscode-extension`,
`npm run vscode:typecheck`, `npm run vscode:compile`, and
`npm run vscode:package`. Install the resulting
`vscode-extension/aetheris-ai-0.1.0.vsix` in VS Code using **Extensions:
Install from VSIX...**. The first Marketplace release requires a verified
publisher account and a Marketplace publishing token.

### List available models

```http
GET /v1/models
Authorization: Bearer aeth_sk_live_...
```

Response uses the OpenAI-compatible `{"object":"list","data":[...]}` shape.
Only aliases that are configured and currently returned by the inference
server's `/v1/models` endpoint are listed.

### Create a chat completion

```http
POST /v1/chat/completions
Authorization: Bearer aeth_sk_live_...
Content-Type: application/json
```

```json
{
  "model": "aetheris-basic",
  "messages": [
    { "role": "system", "content": "Answer clearly and briefly." },
    { "role": "user", "content": "What is a fixed-window rate limit?" }
  ],
  "stream": true,
  "temperature": 0.4,
  "max_tokens": 512
}
```

`stream` defaults to `true`; streamed responses use server-sent events. Set
`stream` to `false` for a JSON chat-completion response. Supported roles are
`system`, `user`, and `assistant`; message content must be text. The service
validates request size and parameters, applies per-key rate limits, enforces
configured model token caps, and tracks requests and tokens when supplied by
the inference server.

## API key management

Sign into the Aetheris website and select **API keys** from the account menu,
or open `/api-keys`. Create a labeled key there. Its plaintext is returned once
and is never stored; only its SHA-256 digest and metadata are kept, in Vercel
Blob (production), a JSON file directory (self-hosted), or process memory.
Copy it directly to a secure server-side secret manager. The key prefix, label,
creation time, request count, token totals, and last-used time remain visible
in the dashboard. Revoke a key there to immediately invalidate it.

Keys can also be managed through the authenticated same-origin routes:

- `GET /api/keys` — list the signed-in account's keys and usage
- `POST /api/keys` with `{"label":"..."}` — create a key, returning its
  plaintext only in this response
- `DELETE /api/keys` with `{"id":"<key-id>"}` — revoke a key

Do not put developer keys in `NEXT_PUBLIC_*` variables, frontend source, or
browser storage. Per-key request limits default to 60/minute and can be changed
with the server-only `AETHERIS_API_RATE_LIMIT_PER_MINUTE` setting. Billing and
plan-based public API quotas are not implemented yet.

## Deploying inference

The website's Vercel functions cannot load and operate a large model's GPU
weights. Run the separate inference service on a Linux host with a supported
NVIDIA GPU, NVIDIA Container Toolkit, Docker Compose, sufficient GPU VRAM for
the model you select, and disk for its weights/cache. CPU-only inference is not
configured or represented as a production option here.

1. Select an open-weight model only after reviewing its license, safety
   properties, hardware/VRAM requirements, and intended use. The project does
   not choose or claim an operational model for you.
2. Copy `deploy/inference/.env.example` to `deploy/inference/.env`. Set
   `AETHERIS_UPSTREAM_MODEL` to the model repository/path and
   `AETHERIS_UPSTREAM_MODEL_ID` to the exact ID returned by its vLLM
   `/v1/models` endpoint. Set a long random `AETHERIS_INFERENCE_API_KEY`.
3. Start the server from `deploy/inference` with
   `docker compose up -d`. The Compose file binds vLLM to localhost. Put an
   HTTPS reverse proxy in front of it for Vercel, keep authentication enabled,
   and restrict network access where your host supports it. Do not expose an
   unauthenticated vLLM port to the public internet.
4. Configure Vercel server environment variables:
   - `AETHERIS_INFERENCE_BASE_URL=https://<your-inference-host>/v1`
   - `AETHERIS_INFERENCE_API_KEY` — the same secret used by vLLM
   - `AETHERIS_INFERENCE_TIMEOUT_MS=55000`
   - `AETHERIS_MODELS_JSON` — aliases mapped to IDs actually served, for
     example:

     ```json
     [
       {"id":"aetheris-basic","upstreamModel":"<exact-loaded-model-id>","label":"Aetheris Basic","maxTokens":2048,"supportsVision":false}
     ]
     ```

     Configure `aetheris-asteroid` and `aetheris-pro` only if their separately
     selected models are loaded and validated. Never put inference credentials
     in a client-visible environment variable.
5. Upstash Redis is optional: API keys, usage, and revocation work without
   it (Blob/file/memory store); connect it only when strict server-side
   credit metering is wanted. Set `AETHERIS_API_RATE_LIMIT_PER_MINUTE` as
   needed, then deploy the website.
6. Verify `GET /api/chat` reports configured models and, with an API key,
   `GET /api/v1/models` lists only models returned by the live inference
   server. Send a test completion before announcing a model as available.

Vercel's function duration and streaming limits depend on the project's plan;
the API routes request a maximum of 60 seconds. Select a model and generation
limits that fit that ceiling or move the API gateway itself to a host with a
longer supported request duration. The inference server's timeout is
configurable, but a Vercel function can still terminate earlier.

## Feature availability

- Website chat temporarily calls Gemini using the server-only
  `GOOGLE_GENERATIVE_AI_API_KEY`; configure it in Vercel's server environment.
  Keep the key out of client-side variables and browser storage.
  The current chat aliases map to `gemini-3.1-flash-lite`,
  `gemini-3.5-flash-lite`, and `gemini-3.8-flash`, respectively.
- The public developer API serves exclusively through the configured
  OpenAI-compatible provider (`AETHERIS_INFERENCE_BASE_URL` /
  `AETHERIS_INFERENCE_API_KEY` / `AETHERIS_MODELS_JSON`); when those are
  unset it returns 503 and never falls back to Google. Paid aliases are gated
  by the key owner's membership, re-verified against PayPal at request time.
  Support replies and prompt classification also require a configured
  inference host and have no fallback.
- Image generation is explicitly unavailable until a separate Aetheris image
  inference model is deployed; it does not fall back to Gemini.
- This temporary chat connection should be replaced when a real Aetheris model
  is deployed and verified.
- API custom-domain DNS, Vercel environment configuration, GPU provisioning,
  model selection/download, and production deployment remain operational setup
  steps. Nothing here deploys or overwrites production.
