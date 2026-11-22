// Builds the Automated Video Generator (AVG) `POST /api/jobs` body from a stored
// video_jobs.request. Workspace members can write `request` directly through the API,
// so every optional setting is re-validated here against AVG's contract before it is
// forwarded. Jobs created before these settings existed have none of them and render
// exactly as before: subtitles on, engine-default styling, automatic music.

const POSITIONS = new Set(["top", "center", "bottom"]);
const ANIMATIONS = new Set(["fade", "slide", "zoom", "typewriter", "pop"]);
const BACKGROUNDS = new Set(["none", "box", "glass"]);
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const TEXT_CONFIG_KEYS = new Set(["position", "animation", "background", "color", "fontSize", "glow"]);

export class EngineRequestError extends Error {}

function fail(message) {
  throw new EngineRequestError(`Invalid render settings: ${message}`);
}

/** Mirrors AVG's safeFilenameSchema (no paths, slashes or "..", max 255 chars). */
export function isSafeMusicFilename(value) {
  if (typeof value !== "string") return false;
  const name = value.trim();
  return name.length > 0 && name.length <= 255 && !/[\\/]/.test(name) && !name.includes("..") && name !== "." && !/[\u0000-\u001f\u007f]/.test(name);
}

function textConfigFrom(raw) {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) fail("subtitle style must be an object.");
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!TEXT_CONFIG_KEYS.has(key)) fail(`unsupported subtitle option "${String(key).slice(0, 40)}".`);
    if (value === undefined || value === null) continue;
    if (key === "position" && !POSITIONS.has(value)) fail("subtitle position.");
    if (key === "animation" && !ANIMATIONS.has(value)) fail("subtitle animation.");
    if (key === "background" && !BACKGROUNDS.has(value)) fail("subtitle background.");
    if (key === "color" && (typeof value !== "string" || !HEX_COLOR.test(value))) fail("subtitle color.");
    if (key === "fontSize" && (!Number.isInteger(value) || value < 16 || value > 144)) fail("subtitle font size.");
    if (key === "glow" && typeof value !== "boolean") fail("subtitle glow.");
    out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * @param {Record<string, unknown>} request stored video_jobs.request
 * @param {string} script the scene script to render
 */
export function buildEngineJobBody(request, script) {
  const req = request && typeof request === "object" ? request : {};

  if (req.showText !== undefined && typeof req.showText !== "boolean") fail("subtitles on/off must be true or false.");
  const showText = req.showText !== false;

  let voice;
  if (req.voice !== undefined && req.voice !== null && req.voice !== "") {
    if (typeof req.voice !== "string" || !req.voice.trim() || req.voice.trim().length > 120) fail("voice.");
    voice = req.voice.trim();
  }

  let backgroundMusic;
  if (req.backgroundMusic !== undefined && req.backgroundMusic !== null && req.backgroundMusic !== "") {
    if (!isSafeMusicFilename(req.backgroundMusic)) fail("background music filename.");
    backgroundMusic = req.backgroundMusic.trim();
  }

  const textConfig = showText ? textConfigFrom(req.textConfig) : undefined;

  const body = {
    title: req.title,
    script,
    orientation: req.orientation === "landscape" ? "landscape" : "portrait",
    showText,
    skipReview: true,
    exportCaptions: true,
  };
  if (voice) body.voice = voice;
  if (textConfig) body.textConfig = textConfig;
  if (backgroundMusic) body.backgroundMusic = backgroundMusic;
  return body;
}

const MAX_THUMBNAIL_BYTES = 10 * 1024 * 1024;

/** Accepts only a non-empty JPEG within size limits (AVG renders thumbnail.jpg). */
export function isUsableThumbnail(contentType, bytes) {
  if (!bytes || bytes.length < 4 || bytes.length > MAX_THUMBNAIL_BYTES) return false;
  if (contentType && !/^image\/jpe?g\b/i.test(contentType)) return false;
  return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}
