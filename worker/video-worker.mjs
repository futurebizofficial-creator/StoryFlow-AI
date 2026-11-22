import { createClient } from "@supabase/supabase-js";
import { createDecipheriv } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";
import { buildEngineJobBody, isUsableThumbnail } from "./engine-request.mjs";
import { planScenesWithFallback, resolveJobAiPlan, SCENE_SYSTEM_PROMPT } from "./llm-providers.mjs";

const required = ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "STORYFLOW_CREDENTIALS_KEY"];
for (const name of required) if (!process.env[name]) throw new Error(`${name} is required by the video worker`);
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const encryptionKey = Buffer.from(process.env.STORYFLOW_CREDENTIALS_KEY, "base64");
if (encryptionKey.length !== 32) throw new Error("STORYFLOW_CREDENTIALS_KEY must decode to exactly 32 bytes");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function decrypt(row) {
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey, Buffer.from(row.nonce, "base64"));
  decipher.setAuthTag(Buffer.from(row.auth_tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.ciphertext, "base64")), decipher.final()]).toString("utf8");
}
async function providerKey(job, provider) {
  const { data, error } = await db.from("workspace_provider_credentials").select("ciphertext,nonce,auth_tag")
    .eq("workspace_id", job.workspace_id).eq("user_id", job.created_by).eq("provider", provider).maybeSingle();
  if (error) throw error;
  return data ? decrypt(data) : null;
}
async function update(id, fields) {
  if (fields.status === undefined && fields.completed_at === undefined) fields.locked_at = new Date().toISOString();
  const { error } = await db.from("video_jobs").update(fields).eq("id", id);
  if (error) throw error;
}
async function jsonFetch(url, options = {}) {
  const res = await fetch(url, { ...options, cache: "no-store", signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `Upstream request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return json;
}
function engine(name) {
  const raw = process.env[name];
  if (!raw) throw new Error(`${name} must be configured`);
  const url = new URL(raw);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error(`${name} must use HTTPS`);
  if (url.username || url.password) throw new Error(`${name} cannot include URL credentials`);
  return url.toString().replace(/\/$/, "");
}
function privateHeaders() {
  const token = process.env.VIDEO_ENGINE_TOKEN;
  if (!token && process.env.NODE_ENV === "production") throw new Error("VIDEO_ENGINE_TOKEN is required in production");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Scene planning with the job's configured AI providers (Claude only for older jobs). */
async function createSceneScript(job, plan) {
  const disabled = new Set();
  if (plan.legacy) {
    // A job without a provider plan uses Claude (paid). Refuse it in Free Mode workspaces,
    // e.g. if a request was written directly through the API without a plan.
    const { data: settings, error } = await db.from("workspace_generation_settings").select("free_mode").eq("workspace_id", job.workspace_id).maybeSingle();
    if (error) throw error;
    if (settings?.free_mode) throw new Error("Free Mode is on for this workspace, so this render cannot use Claude (paid). Generation stopped.");
  } else {
    const { data, error } = await db.from("workspace_integrations").select("provider").eq("workspace_id", job.workspace_id).eq("enabled", false);
    if (error) throw error;
    for (const row of data ?? []) disabled.add(row.provider);
  }
  const user = `Title: ${job.request.title}\nTone: ${job.request.tone || "conversational"}\nTarget duration: ${job.request.targetDuration || 60} seconds\n\nScript:\n${job.request.script}`;
  const { text } = await planScenesWithFallback({
    plan,
    system: SCENE_SYSTEM_PROMPT,
    user,
    getKey: (id) => providerKey(job, id),
    isDisabled: (id) => disabled.has(id),
    defaultClaudeModel: process.env.CLAUDE_MODEL || "claude-sonnet-4-5",
  });
  return text.slice(0, 4900) || job.request.script;
}

async function generateGeminiReference(job, apiKey) {
  const model = process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1";
  const result = await jsonFetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": apiKey, "Api-Revision": "2026-05-20" },
    body: JSON.stringify({ model, input: `Create a clean character reference image for a video titled “${job.request.title}”. Infer one distinctive recurring main character from this script. Use a neutral studio background, full body, no text. Also return a concise written visual bible describing the character's face, hair, clothing, palette and distinguishing features so scenes can keep the same look. Script: ${String(job.request.script).slice(0, 5000)}` }),
  });
  const image = result.output_image;
  if (!image?.data) throw new Error("Gemini did not return a character reference image.");
  const description = result.output_text || result.output?.filter((part) => part.type === "text").map((part) => part.text).join("\n") || "";
  // The storyflow-videos bucket accepts only PNG and JPEG images; normalize and reject anything else.
  const rawMime = String(image.mime_type || "image/png").toLowerCase().split(";")[0].trim();
  const mime = rawMime === "image/jpg" || rawMime === "image/pjpeg" ? "image/jpeg" : rawMime;
  if (mime !== "image/png" && mime !== "image/jpeg") throw new Error(`Gemini returned an unsupported image type (${mime.slice(0, 60)}); expected PNG or JPEG.`);
  return { bytes: Buffer.from(image.data, "base64"), mime, description: String(description).slice(0, 600) };
}

async function startRender(job, script) {
  await update(job.id, { stage: "rendering", progress: 20 });
  const root = engine("AUTOMATED_VIDEO_GENERATOR_URL");
  // Validated against AVG's contract; older jobs without settings get the original defaults.
  const body = buildEngineJobBody(job.request, script);
  const started = await jsonFetch(`${root}/api/jobs`, { method: "POST", headers: { ...privateHeaders(), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const engineJobId = started.data?.jobId;
  const publicId = started.data?.publicId;
  if (!engineJobId || !publicId) throw new Error("Automated Video Generator returned an invalid job id.");
  await update(job.id, { stage: "rendering", progress: 25, engine_job_id: engineJobId });
  const deadline = Date.now() + 45 * 60_000;
  while (Date.now() < deadline) {
    await sleep(5000);
    const status = await jsonFetch(`${root}/api/jobs/${encodeURIComponent(engineJobId)}`, { headers: privateHeaders() });
    const state = status.data?.status ?? status.data?.state;
    const progress = Math.max(25, Math.min(90, Number(status.data?.progress || 25)));
    await update(job.id, { stage: state || "rendering", progress });
    if (state === "failed") throw new Error(status.data?.error || "Video rendering failed.");
    if (state === "cancelled") throw new Error("Video rendering was cancelled.");
    if (state === "completed") {
      const video = await fetch(`${root}/files/${encodeURIComponent(publicId)}/video`, { headers: privateHeaders(), signal: AbortSignal.timeout(180_000) });
      if (!video.ok) throw new Error(`Could not download rendered MP4 (${video.status}).`);
      return { mp4: Buffer.from(await video.arrayBuffer()), thumbnail: await fetchThumbnail(root, publicId) };
    }
  }
  throw new Error("Video rendering exceeded the 45 minute worker limit.");
}

/** AVG renders thumbnail.jpg during its render step; a missing or invalid thumbnail is non-fatal. */
async function fetchThumbnail(root, publicId) {
  try {
    const response = await fetch(`${root}/files/${encodeURIComponent(publicId)}/thumbnail`, { headers: privateHeaders(), redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return isUsableThumbnail(response.headers.get("content-type"), bytes) ? bytes : null;
  } catch {
    return null;
  }
}

async function qualityCheck(bytes, jobId) {
  const base = process.env.AGENTIC_VIDEO_URL;
  const sharedRoot = process.env.AGENTIC_VIDEO_SHARED_ROOT;
  if (!base || !sharedRoot) return null;
  const dir = path.resolve(sharedRoot);
  const filename = `${jobId}.mp4`;
  const file = path.join(dir, filename);
  if (!file.startsWith(`${dir}${path.sep}`)) throw new Error("Invalid Agentic Video shared path.");
  await mkdir(dir, { recursive: true });
  await writeFile(file, bytes, { mode: 0o600 });
  try {
    const result = await jsonFetch(`${base.replace(/\/$/, "")}/run`, { method: "POST", headers: { ...privateHeaders(), "content-type": "application/json" },
      body: JSON.stringify({ plugin: "analyze.video", input: { file, out: `${jobId}-quality.json` } }),
    });
    if (!result.ok) throw new Error(result.error?.message || "Agentic Video quality check failed.");
    return result.outputs?.[0]?.meta ?? null;
  } finally { await unlink(file).catch(() => {}); }
}

async function driveUpload(job, bytes) {
  const { data, error } = await db.from("google_drive_connections").select("ciphertext,nonce,auth_tag")
    .eq("user_id", job.created_by).maybeSingle();
  if (error || !data) return null;
  const stored = JSON.parse(decrypt(data));
  if (!stored.refresh_token) return null;
  const token = await jsonFetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: stored.refresh_token, grant_type: "refresh_token" }),
  });
  const metadata = JSON.stringify({ name: `${String(job.request.title || "StoryFlow video").slice(0, 100)}.mp4`, mimeType: "video/mp4" });
  const start = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,webViewLink", {
    method: "POST", headers: { Authorization: `Bearer ${token.access_token}`, "Content-Type": "application/json; charset=UTF-8", "X-Upload-Content-Type": "video/mp4", "X-Upload-Content-Length": String(bytes.byteLength) },
    body: metadata, cache: "no-store", signal: AbortSignal.timeout(60_000),
  });
  if (!start.ok) throw new Error(`Google Drive upload could not start (${start.status}).`);
  const uploadUrl = start.headers.get("location");
  if (!uploadUrl || new URL(uploadUrl).origin !== "https://www.googleapis.com") throw new Error("Google Drive returned an invalid resumable upload URL.");
  const upload = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.byteLength) }, body: bytes, cache: "no-store", signal: AbortSignal.timeout(10 * 60_000) });
  const uploaded = await upload.json().catch(() => ({}));
  if (!upload.ok) throw new Error(`Google Drive video upload failed (${upload.status}).`);
  return uploaded.webViewLink ?? null;
}

async function processJob(job) {
  try {
    // Reject invalid render or provider settings before spending any of the user's AI quota.
    buildEngineJobBody(job.request, "");
    const plan = resolveJobAiPlan(job.request);
    // Production Setup: the character reference is optional (older jobs: on). Validate the stored
    // value rather than trusting it, and only require a Gemini key when the step will run.
    if (job.request.characterReference !== undefined && typeof job.request.characterReference !== "boolean") {
      throw new Error("Invalid render settings: character reference must be true or false.");
    }
    const useReference = job.request.characterReference !== false;
    const geminiKey = useReference ? await providerKey(job, "gemini") : null;
    if (useReference && !geminiKey) {
      throw new Error("Save your own Gemini API key in Integrations before rendering, or skip the character reference in Production Setup.");
    }
    await update(job.id, { stage: "orchestrating", progress: 5 });
    const script = await createSceneScript(job, plan);
    let referencePath = null;
    let visualBible = "";
    if (useReference) {
      await update(job.id, { stage: "generating_character_reference", progress: 12 });
      let reference;
      try {
        reference = await generateGeminiReference(job, geminiKey);
      } catch (err) {
        if (err?.status === 429 || err?.status === 402) {
          throw new Error("Gemini quota exhausted while creating the character reference (" + err.status + "). Generation stopped; no other provider was used.");
        }
        throw new Error(`Character reference (Google Gemini, model ${process.env.GEMINI_IMAGE_MODEL || "gemini-nano-banana-2.1"}) failed${err?.status ? ` (${err.status})` : ""}: ${err instanceof Error ? err.message : String(err)}`);
      }
      referencePath = `${job.workspace_id}/${job.id}/character-reference.${reference.mime === "image/jpeg" ? "jpg" : "png"}`;
      const { error: referenceError } = await db.storage.from("storyflow-videos").upload(referencePath, reference.bytes, { contentType: reference.mime, upsert: true });
      if (referenceError) throw referenceError;
      visualBible = reference.description ? `## Consistent character reference\n${reference.description}\n\n` : "";
    }
    const renderScript = `${visualBible}${script}`.slice(0, 4900);
    const { mp4, thumbnail } = await startRender(job, renderScript);
    await update(job.id, { stage: "quality_check", progress: 92 });
    const quality = await qualityCheck(mp4, job.id);
    const outputPath = `${job.workspace_id}/${job.id}/video.mp4`;
    const { error: uploadError } = await db.storage.from("storyflow-videos").upload(outputPath, mp4, { contentType: "video/mp4", upsert: true });
    if (uploadError) throw uploadError;
    if (thumbnail) {
      // Stored at a fixed path next to the video; the web app falls back to the character reference if absent.
      // A thumbnail problem must never fail an otherwise completed render.
      try {
        const { error: thumbnailError } = await db.storage.from("storyflow-videos").upload(`${job.workspace_id}/${job.id}/thumbnail.jpg`, thumbnail, { contentType: "image/jpeg", upsert: true });
        if (thumbnailError) process.stderr.write(`Thumbnail upload skipped for job ${job.id}: ${thumbnailError.message}\n`);
      } catch (thumbnailErr) {
        process.stderr.write(`Thumbnail upload skipped for job ${job.id}: ${thumbnailErr instanceof Error ? thumbnailErr.message : "unknown error"}\n`);
      }
    }
    let driveLink = null;
    if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) driveLink = await driveUpload(job, mp4);
    await update(job.id, { status: "completed", stage: "completed", progress: 100, output_url: outputPath,
      visual_reference_path: referencePath, drive_file_url: driveLink, quality_report: quality, completed_at: new Date().toISOString(), error: null });
    process.stdout.write(`Completed video job ${job.id}\n`);
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).replace(/(sk-[\w-]{12,}|AIza[\w-]{20,})/g, "[REDACTED]").slice(0, 800);
    await update(job.id, { status: "failed", stage: "failed", error: message, completed_at: new Date().toISOString() });
    process.stderr.write(`Video job ${job.id} failed: ${message}\n`);
  }
}

async function main() {
  process.stdout.write("StoryFlow video worker started\n");
  while (true) {
    const { data, error } = await db.rpc("claim_video_job");
    if (error) { process.stderr.write(`Queue poll failed: ${error.message}\n`); await sleep(5000); continue; }
    const job = Array.isArray(data) ? data[0] : data;
    if (!job) { await sleep(2000); continue; }
    await processJob(job);
  }
}
main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
