import { test } from "node:test";
import assert from "node:assert/strict";
import {
  musicFilenameError,
  normalizeVoiceCatalog,
  parseRenderSettings,
  settingsToFormEntries,
} from "../src/lib/video/render-settings.ts";
import { buildEngineJobBody, EngineRequestError, isSafeMusicFilename, isUsableThumbnail } from "../worker/engine-request.mjs";

const form = (fields: Record<string, string>) => (key: string) => fields[key] ?? null;

test("empty form keeps the original defaults (subtitles on, automatic music, default voice)", () => {
  const result = parseRenderSettings(form({}));
  assert.deepEqual(result, { ok: true, settings: { showText: true } });
});

test("full subtitle, music and voice settings are parsed", () => {
  const result = parseRenderSettings(
    form({
      voice: "en-US-AriaNeural",
      showText: "true",
      subtitlePosition: "bottom",
      subtitleAnimation: "typewriter",
      subtitleBackground: "glass",
      subtitleColor: "#ffcc00",
      subtitleFontSize: "64",
      subtitleGlow: "on",
      musicMode: "file",
      musicFile: "calm-piano.mp3",
    }),
  );
  assert.deepEqual(result, {
    ok: true,
    settings: {
      showText: true,
      voice: "en-US-AriaNeural",
      backgroundMusic: "calm-piano.mp3",
      textConfig: { position: "bottom", animation: "typewriter", background: "glass", color: "#FFCC00", fontSize: 64, glow: true },
    },
  });
});

test("subtitles off drops styling", () => {
  const result = parseRenderSettings(form({ showText: "false", subtitlePosition: "top", subtitleFontSize: "500" }));
  assert.deepEqual(result, { ok: true, settings: { showText: false } });
});

test("unsupported values are rejected with the offending field", () => {
  const cases: Array<[Record<string, string>, string]> = [
    [{ showText: "maybe" }, "showText"],
    [{ subtitlePosition: "left" }, "subtitlePosition"],
    [{ subtitleAnimation: "spin" }, "subtitleAnimation"],
    [{ subtitleBackground: "blur" }, "subtitleBackground"],
    [{ subtitleColor: "red" }, "subtitleColor"],
    [{ subtitleColor: "#12345" }, "subtitleColor"],
    [{ subtitleFontSize: "15" }, "subtitleFontSize"],
    [{ subtitleFontSize: "145" }, "subtitleFontSize"],
    [{ subtitleFontSize: "20.5" }, "subtitleFontSize"],
    [{ subtitleGlow: "yes" }, "subtitleGlow"],
    [{ musicMode: "shuffle" }, "musicMode"],
    [{ musicMode: "file", musicFile: "" }, "musicFile"],
    [{ musicMode: "file", musicFile: "../secret.mp3" }, "musicFile"],
    [{ musicMode: "file", musicFile: "bgm/track.mp3" }, "musicFile"],
    [{ musicMode: "file", musicFile: "C:\\music\\track.mp3" }, "musicFile"],
    [{ musicMode: "file", musicFile: "a".repeat(256) }, "musicFile"],
    [{ voice: "<script>" }, "voice"],
  ];
  for (const [fields, field] of cases) {
    const result = parseRenderSettings(form(fields));
    assert.equal(result.ok, false, JSON.stringify(fields));
    if (!result.ok) assert.equal(result.field, field, JSON.stringify(fields));
  }
});

test("music filename rules match AVG's safeFilenameSchema", () => {
  assert.equal(musicFilenameError("track.mp3"), null);
  assert.equal(musicFilenameError("a".repeat(255)), null);
  assert.notEqual(musicFilenameError("a".repeat(256)), null);
  assert.notEqual(musicFilenameError("."), null);
  assert.notEqual(musicFilenameError("..mp3"), null);
  assert.notEqual(musicFilenameError("dir/x.mp3"), null);
  assert.notEqual(musicFilenameError("x\u0000.mp3"), null);
  assert.equal(isSafeMusicFilename("track.mp3"), true);
  assert.equal(isSafeMusicFilename("../track.mp3"), false);
  assert.equal(isSafeMusicFilename("a/b.mp3"), false);
  assert.equal(isSafeMusicFilename(42), false);
});

test("stored settings round-trip through form entries for Generate again", () => {
  const settings = {
    voice: "en-GB-SoniaNeural",
    showText: true,
    textConfig: { position: "top" as const, color: "#FFFFFF", fontSize: 48, glow: false },
    backgroundMusic: "intro.wav",
  };
  const entries = Object.fromEntries(settingsToFormEntries(settings));
  const parsed = parseRenderSettings(form(entries));
  assert.deepEqual(parsed, { ok: true, settings });
  // An old job (no settings) regenerates with defaults.
  assert.deepEqual(parseRenderSettings(form(Object.fromEntries(settingsToFormEntries({})))), { ok: true, settings: { showText: true } });
});

test("old jobs build the exact engine request they used before", () => {
  const oldRequest = { title: "Old job", script: "stored", targetDuration: 60, orientation: "landscape" };
  const before = JSON.parse(
    JSON.stringify({ title: "Old job", script: "SCENES", orientation: "landscape", voice: undefined, showText: true, skipReview: true, exportCaptions: true }),
  );
  assert.deepEqual(JSON.parse(JSON.stringify(buildEngineJobBody(oldRequest, "SCENES"))), before);
  const withVoice = buildEngineJobBody({ ...oldRequest, orientation: "portrait", voice: "en-US-GuyNeural" }, "SCENES");
  assert.equal(withVoice.voice, "en-US-GuyNeural");
  assert.equal(withVoice.orientation, "portrait");
});

test("worker forwards validated subtitle and music settings to AVG", () => {
  const body = buildEngineJobBody(
    {
      title: "New",
      orientation: "portrait",
      showText: true,
      textConfig: { position: "center", animation: "pop", background: "box", color: "#FFF", fontSize: 72, glow: true },
      backgroundMusic: "upbeat.mp3",
    },
    "SCENES",
  );
  assert.deepEqual(body, {
    title: "New",
    script: "SCENES",
    orientation: "portrait",
    showText: true,
    skipReview: true,
    exportCaptions: true,
    textConfig: { position: "center", animation: "pop", background: "box", color: "#FFF", fontSize: 72, glow: true },
    backgroundMusic: "upbeat.mp3",
  });
  const off = buildEngineJobBody({ title: "Off", showText: false, textConfig: { position: "top" } }, "S");
  assert.equal(off.showText, false);
  assert.equal("textConfig" in off, false);
  assert.equal("musicVolume" in body || "captionMode" in body, false);
});

test("worker rejects tampered request settings", () => {
  const bad = [
    { showText: "yes" },
    { textConfig: { position: "left" } },
    { textConfig: { fontSize: 8 } },
    { textConfig: { color: "javascript:alert(1)" } },
    { textConfig: { musicVolume: 0.5 } },
    { textConfig: ["top"] },
    { backgroundMusic: "../../etc/passwd" },
    { backgroundMusic: "a/b.mp3" },
    { voice: "x".repeat(121) },
  ];
  for (const extra of bad) {
    assert.throws(() => buildEngineJobBody({ title: "T", ...extra }, "S"), EngineRequestError, JSON.stringify(extra));
  }
});

test("voice catalog is normalised and grouped by locale", () => {
  const groups = normalizeVoiceCatalog({
    success: true,
    data: {
      "en-US": [
        { name: "en-US-GuyNeural", gender: "Male" },
        { name: "en-US-AriaNeural", gender: "Female" },
        { name: "en-US-AriaNeural", gender: "Female" },
        { name: "<bad>" },
        "nonsense",
      ],
      "fr-FR": [{ name: "fr-FR-DeniseNeural", gender: "Female" }],
      "not a locale": [{ name: "x" }],
      "de-DE": "not-an-array",
    },
  });
  assert.deepEqual(groups, [
    { locale: "en-US", voices: [{ name: "en-US-AriaNeural", gender: "Female" }, { name: "en-US-GuyNeural", gender: "Male" }] },
    { locale: "fr-FR", voices: [{ name: "fr-FR-DeniseNeural", gender: "Female" }] },
  ]);
  assert.equal(normalizeVoiceCatalog({ success: false, data: {} }), null);
  assert.equal(normalizeVoiceCatalog(null), null);
  assert.equal(normalizeVoiceCatalog({ success: true, data: [] }), null);
});

test("only real JPEG thumbnails are stored", () => {
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.equal(isUsableThumbnail("image/jpeg", jpeg), true);
  assert.equal(isUsableThumbnail(null, jpeg), true);
  assert.equal(isUsableThumbnail("text/html", jpeg), false);
  assert.equal(isUsableThumbnail("image/jpeg", Buffer.from("<html>")), false);
  assert.equal(isUsableThumbnail("image/jpeg", Buffer.alloc(0)), false);
  assert.equal(isUsableThumbnail("image/jpeg", Buffer.concat([jpeg, Buffer.alloc(10 * 1024 * 1024)])), false);
});
