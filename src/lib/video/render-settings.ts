/**
 * Render settings forwarded to Automated Video Generator (AVG) `POST /api/jobs`.
 *
 * Values mirror AVG's own request contract (src/shared/contracts/job.contract.ts):
 * textConfigSchema, safeFilenameSchema for backgroundMusic, and the voice field.
 * Only settings that AVG's job API actually passes to its renderer are accepted here;
 * musicVolume and captionMode are deliberately excluded because AVG drops them.
 *
 * This module is dependency-free so it can run in the browser, on the server and in
 * Node's test runner.
 */

export const SUBTITLE_POSITIONS = ["top", "center", "bottom"] as const;
export const SUBTITLE_ANIMATIONS = ["fade", "slide", "zoom", "typewriter", "pop"] as const;
export const SUBTITLE_BACKGROUNDS = ["none", "box", "glass"] as const;
export const SUBTITLE_FONT_MIN = 16;
export const SUBTITLE_FONT_MAX = 144;
export const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
export const MUSIC_FILENAME_MAX = 255;

/** StoryFlow's (stricter than AVG) voice identifier rule for user input. */
export const VOICE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 _.:()-]{0,119}$/;

export type SubtitlePosition = (typeof SUBTITLE_POSITIONS)[number];
export type SubtitleAnimation = (typeof SUBTITLE_ANIMATIONS)[number];
export type SubtitleBackground = (typeof SUBTITLE_BACKGROUNDS)[number];

export interface SubtitleTextConfig {
  position?: SubtitlePosition;
  animation?: SubtitleAnimation;
  background?: SubtitleBackground;
  color?: string;
  fontSize?: number;
  glow?: boolean;
}

export interface RenderSettings {
  showText: boolean;
  textConfig?: SubtitleTextConfig;
  backgroundMusic?: string;
  voice?: string;
}

export type ParseResult = { ok: true; settings: RenderSettings } | { ok: false; error: string; field: string };

/** Returns an error message for an invalid AVG music filename, or null when valid. */
export function musicFilenameError(raw: string): string | null {
  const name = raw.trim();
  if (!name) return "Enter the track's filename.";
  if (name.length > MUSIC_FILENAME_MAX) return `Filenames can be at most ${MUSIC_FILENAME_MAX} characters.`;
  if (/[\\/]/.test(name)) return "Enter a filename only — paths and slashes are not allowed.";
  if (name.includes("..") || name === ".") return 'Filenames must not contain "..".';
  // Control characters are never valid in a filename.
  if (/[\u0000-\u001f\u007f]/.test(name)) return "Filenames must not contain control characters.";
  return null;
}

function oneOf<T extends string>(values: readonly T[], value: string): value is T {
  return (values as readonly string[]).includes(value);
}

/**
 * Parses render settings from form fields. Blank optional fields mean "engine default"
 * and are omitted, so AVG keeps its own defaults. Unknown values are rejected.
 */
export function parseRenderSettings(get: (key: string) => string | null | undefined): ParseResult {
  const read = (key: string) => String(get(key) ?? "").trim();

  const voice = read("voice");
  if (voice && !VOICE_PATTERN.test(voice)) {
    return { ok: false, field: "voice", error: "Voice IDs use letters, numbers, spaces and . _ - : ( ) only (max 120 characters)." };
  }

  const showTextRaw = read("showText");
  if (showTextRaw && showTextRaw !== "true" && showTextRaw !== "false") {
    return { ok: false, field: "showText", error: "Choose whether to show subtitles." };
  }
  // Absent means the historical default: subtitles on.
  const showText = showTextRaw !== "false";

  let textConfig: SubtitleTextConfig | undefined;
  if (showText) {
    const config: SubtitleTextConfig = {};
    const position = read("subtitlePosition");
    if (position) {
      if (!oneOf(SUBTITLE_POSITIONS, position)) return { ok: false, field: "subtitlePosition", error: "Choose a valid subtitle position." };
      config.position = position;
    }
    const animation = read("subtitleAnimation");
    if (animation) {
      if (!oneOf(SUBTITLE_ANIMATIONS, animation)) return { ok: false, field: "subtitleAnimation", error: "Choose a valid subtitle animation." };
      config.animation = animation;
    }
    const background = read("subtitleBackground");
    if (background) {
      if (!oneOf(SUBTITLE_BACKGROUNDS, background)) return { ok: false, field: "subtitleBackground", error: "Choose a valid subtitle background." };
      config.background = background;
    }
    const color = read("subtitleColor");
    if (color) {
      if (!HEX_COLOR.test(color)) return { ok: false, field: "subtitleColor", error: "Use a hex color such as #FFFFFF." };
      config.color = color.toUpperCase();
    }
    const fontSize = read("subtitleFontSize");
    if (fontSize) {
      const n = Number(fontSize);
      if (!/^\d+$/.test(fontSize) || !Number.isInteger(n) || n < SUBTITLE_FONT_MIN || n > SUBTITLE_FONT_MAX) {
        return { ok: false, field: "subtitleFontSize", error: `Font size must be a whole number from ${SUBTITLE_FONT_MIN} to ${SUBTITLE_FONT_MAX}.` };
      }
      config.fontSize = n;
    }
    const glow = read("subtitleGlow");
    if (glow) {
      if (glow !== "on" && glow !== "off") return { ok: false, field: "subtitleGlow", error: "Choose a valid glow setting." };
      config.glow = glow === "on";
    }
    if (Object.keys(config).length > 0) textConfig = config;
  }

  const musicMode = read("musicMode") || "auto";
  let backgroundMusic: string | undefined;
  if (musicMode === "file") {
    const file = read("musicFile");
    const problem = musicFilenameError(file);
    if (problem) return { ok: false, field: "musicFile", error: problem };
    backgroundMusic = file;
  } else if (musicMode !== "auto") {
    return { ok: false, field: "musicMode", error: "Choose automatic music or a specific track." };
  }

  return {
    ok: true,
    settings: {
      showText,
      ...(textConfig ? { textConfig } : {}),
      ...(backgroundMusic ? { backgroundMusic } : {}),
      ...(voice ? { voice } : {}),
    },
  };
}

/** Converts stored job settings back into form fields (used by "Generate again"). */
export function settingsToFormEntries(request: {
  voice?: unknown;
  showText?: unknown;
  textConfig?: unknown;
  backgroundMusic?: unknown;
}): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  if (typeof request.voice === "string" && request.voice) entries.push(["voice", request.voice]);
  entries.push(["showText", request.showText === false ? "false" : "true"]);
  const tc = request.textConfig && typeof request.textConfig === "object" ? (request.textConfig as Record<string, unknown>) : {};
  if (typeof tc.position === "string") entries.push(["subtitlePosition", tc.position]);
  if (typeof tc.animation === "string") entries.push(["subtitleAnimation", tc.animation]);
  if (typeof tc.background === "string") entries.push(["subtitleBackground", tc.background]);
  if (typeof tc.color === "string") entries.push(["subtitleColor", tc.color]);
  if (typeof tc.fontSize === "number") entries.push(["subtitleFontSize", String(tc.fontSize)]);
  if (typeof tc.glow === "boolean") entries.push(["subtitleGlow", tc.glow ? "on" : "off"]);
  if (typeof request.backgroundMusic === "string" && request.backgroundMusic) {
    entries.push(["musicMode", "file"], ["musicFile", request.backgroundMusic]);
  } else {
    entries.push(["musicMode", "auto"]);
  }
  return entries;
}

// ---------------------------------------------------------------------------
// Voice catalog (AVG GET /api/voices → { success, data: { [locale]: Voice[] } })
// ---------------------------------------------------------------------------

export interface VoiceOption {
  name: string;
  gender?: string;
}

export interface VoiceGroup {
  locale: string;
  voices: VoiceOption[];
}

const LOCALE_PATTERN = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/;
const MAX_LOCALES = 300;
const MAX_VOICES = 3000;

/**
 * Validates and normalises AVG's voice catalog. Anything malformed is dropped; the
 * result contains only names that StoryFlow would also accept as a voice ID.
 */
export function normalizeVoiceCatalog(payload: unknown): VoiceGroup[] | null {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as { success?: unknown; data?: unknown };
  if (body.success === false || !body.data || typeof body.data !== "object" || Array.isArray(body.data)) return null;

  const groups: VoiceGroup[] = [];
  let total = 0;
  for (const [locale, list] of Object.entries(body.data as Record<string, unknown>).slice(0, MAX_LOCALES)) {
    if (!LOCALE_PATTERN.test(locale) || !Array.isArray(list)) continue;
    const seen = new Set<string>();
    const voices: VoiceOption[] = [];
    for (const item of list) {
      if (total >= MAX_VOICES) break;
      const v = item as { name?: unknown; gender?: unknown };
      if (!item || typeof item !== "object" || typeof v.name !== "string") continue;
      const name = v.name.trim();
      if (!VOICE_PATTERN.test(name) || seen.has(name)) continue;
      seen.add(name);
      const gender = typeof v.gender === "string" && /^[A-Za-z ]{1,20}$/.test(v.gender) ? v.gender : undefined;
      voices.push(gender ? { name, gender } : { name });
      total++;
    }
    if (voices.length) {
      voices.sort((a, b) => a.name.localeCompare(b.name));
      groups.push({ locale, voices });
    }
  }
  groups.sort((a, b) => a.locale.localeCompare(b.locale));
  return groups;
}
