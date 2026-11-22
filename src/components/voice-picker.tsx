"use client";

import { useId, useMemo, useState } from "react";
import { Input, Select } from "@/components/ui";
import { Icon } from "@/components/icons";

export interface VoicePickerGroup {
  locale: string;
  label: string;
  voices: Array<{ name: string; gender?: string }>;
}

/**
 * Searchable voice selector grouped by language. The list comes from the server
 * (AVG GET /api/voices via a server-only call); "" means the engine's default voice.
 * When the catalog is unavailable it falls back to a free-text voice ID.
 */
export function VoicePicker({
  id,
  groups,
  value,
  onChange,
  invalid,
}: {
  id: string;
  groups: VoicePickerGroup[] | null;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}) {
  const searchId = useId();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!groups) return [];
    const q = query.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((g) => {
        const groupHit = g.label.toLowerCase().includes(q) || g.locale.toLowerCase().includes(q);
        return {
          ...g,
          voices: groupHit
            ? g.voices
            : g.voices.filter((v) => v.name.toLowerCase().includes(q) || (v.gender ?? "").toLowerCase() === q),
        };
      })
      .filter((g) => g.voices.length > 0);
  }, [groups, query]);

  if (!groups) {
    return (
      <Input
        id={id}
        name="voice"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Engine default"
        maxLength={120}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
      />
    );
  }

  const matches = filtered.reduce((n, g) => n + g.voices.length, 0);
  const selectedVisible = !value || filtered.some((g) => g.voices.some((v) => v.name === value));

  return (
    <div className="space-y-2">
      <div className="relative">
        <Icon name="search" size={14} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
        <Input
          id={searchId}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search voices or languages"
          aria-label="Search voices"
          aria-controls={id}
          className="pl-8"
          autoComplete="off"
        />
      </div>
      <Select id={id} name="voice" value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid}>
        <option value="">Engine default voice</option>
        {!selectedVisible && <option value={value}>{value} (selected)</option>}
        {filtered.map((g) => (
          <optgroup key={g.locale} label={g.label}>
            {g.voices.map((v) => (
              <option key={v.name} value={v.name}>
                {v.name}
                {v.gender ? ` · ${v.gender}` : ""}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
      <p className="text-xs text-muted" aria-live="polite">
        {query ? `${matches} matching voice${matches === 1 ? "" : "s"}` : `${matches} voices in ${groups.length} languages`}
      </p>
    </div>
  );
}
