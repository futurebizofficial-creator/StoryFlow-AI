# Video platform operations

StoryFlow keeps login, workspace membership, authorization, job records and artifacts in Supabase. Rendering runs in a separate persistent worker (`npm run worker`); never run FFmpeg/Remotion in the Next.js request lifecycle.

## Services

- Deploy Automated Video Generator as a private, long-running Node service with FFmpeg/ffprobe, Chromium, Python/TTS dependencies and persistent scratch storage. Set `AUTOMATED_VIDEO_GENERATOR_URL` to its private origin.
- Deploy Agentic Video as a private Node 20+ service with FFmpeg/ffprobe and its supported plugin dependencies. Set `AGENTIC_VIDEO_URL`. Mount the same `AGENTIC_VIDEO_SHARED_ROOT` into the StoryFlow worker and Agentic Video service to enable the `analyze.video` post-render quality check.
- Keep both upstream HTTP services behind private networking and an authenticated ingress gateway. Their native HTTP surfaces are designed for trusted local callers and do not implement StoryFlow tenant authorization. Do not expose them directly to the public internet.
- Run at least one persistent worker beside the services. Worker replicas may scale horizontally; `claim_video_job()` uses row locking to claim jobs once, and stale leases are retried up to three times.

The worker calls the upstream jobs API for stock-media acquisition, voice generation, subtitles and Remotion rendering. Agentic Video is used through a narrow plugin adapter; only `analyze.video` is called by the render pipeline. Other plugins can be enabled deliberately after input and filesystem boundaries are reviewed.

## Secrets and provider connections

Set `STORYFLOW_CREDENTIALS_KEY` to a base64-encoded random 32-byte key, `SUPABASE_SERVICE_ROLE_KEY` only in the worker environment, and `VIDEO_ENGINE_TOKEN` at the private gateway and worker. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the exact OAuth callback URI `/api/integrations/google-drive/callback` to enable each user's own Drive connection. Enable Drive API and configure the OAuth consent screen for the scopes in the connect route.

Users enter Claude and Gemini API keys in Integrations. StoryFlow encrypts keys and refresh tokens with AES-256-GCM before storing them; changing the encryption key makes stored credentials unreadable. Never add service-role keys, OAuth client secrets, or provider keys to `NEXT_PUBLIC_*` variables or source control.

Rendered MP4s and Gemini character-reference images are stored in the private `storyflow-videos` Supabase Storage bucket. Apply all migrations before starting the worker. Configure Supabase Auth redirect URLs for the deployed StoryFlow domain.

## Render settings forwarded to Automated Video Generator

AI Video Studio stores these in `video_jobs.request`; the worker re-validates them (`worker/engine-request.mjs`) and forwards them to AVG `POST /api/jobs`. Jobs created before these settings existed render with the original defaults (subtitles on, engine-default styling, automatic music).

- `showText` and `textConfig` (`position`, `animation`, `background`, `color`, `fontSize` 16–144, `glow`) — AVG subtitle styling.
- `backgroundMusic` — a filename in AVG's `input/bgm` library (no paths, slashes or `..`, max 255 characters). Omitted means AVG picks a royalty-free track automatically. An unknown filename renders without music.
- `voice` — chosen from AVG `GET /api/voices` when the web service has `AUTOMATED_VIDEO_GENERATOR_URL` and `VIDEO_ENGINE_TOKEN` (fetched server-side, cached for an hour), otherwise a free-text voice ID or the engine default.

After rendering, the worker downloads AVG's `GET /files/:publicId/thumbnail` and stores it as `<workspace>/<job>/thumbnail.jpg` in the private bucket. Pages fall back to the Gemini character reference when no thumbnail exists.

Not exposed because AVG's job API currently drops them before rendering: `musicVolume`, `captionMode`.
