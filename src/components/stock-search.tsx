"use client";

import { useActionState, useState } from "react";
import { searchStockAction, type StockSearchState } from "@/actions/stock";
import { Badge, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { SubmitButton } from "@/components/form";
import { Icon } from "@/components/icons";
import { cn } from "@/lib/utils";

const PROVIDERS = [
  { id: "pexels", name: "Pexels", key: true },
  { id: "pixabay", name: "Pixabay", key: true },
  { id: "unsplash", name: "Unsplash", key: true, photoOnly: true },
  { id: "wikimedia", name: "Wikimedia Commons", key: false },
  { id: "internet_archive", name: "Internet Archive", key: false },
] as const;

export function StockSearch({ savedKeys }: { savedKeys: string[] }) {
  const [state, action] = useActionState(searchStockAction, {} as StockSearchState);
  const [mediaType, setMediaType] = useState<"photo" | "video">("photo");

  return (
    <div className="grid gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
      <Card className="h-fit p-5 lg:sticky lg:top-6">
        <form action={action} className="space-y-4">
          <Field label="Scene or keywords" htmlFor="query" hint="Paste a scene; StoryFlow extracts its keywords.">
            <Textarea id="query" name="query" required maxLength={2000} placeholder="A lighthouse at dawn above a stormy sea…" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Media" htmlFor="mediaType">
              <Select id="mediaType" name="mediaType" value={mediaType} onChange={(e) => setMediaType(e.target.value as "photo" | "video")}>
                <option value="photo">Photos</option>
                <option value="video">Videos</option>
              </Select>
            </Field>
            <Field label="Orientation" htmlFor="orientation">
              <Select id="orientation" name="orientation" defaultValue="">
                <option value="">Any</option>
                <option value="landscape">Landscape</option>
                <option value="portrait">Portrait</option>
                <option value="square">Square</option>
              </Select>
            </Field>
          </div>
          {mediaType === "video" && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Min seconds" htmlFor="minDuration">
                <Input id="minDuration" name="minDuration" type="number" min={0} max={3600} inputMode="numeric" />
              </Field>
              <Field label="Max seconds" htmlFor="maxDuration">
                <Input id="maxDuration" name="maxDuration" type="number" min={1} max={3600} inputMode="numeric" />
              </Field>
            </div>
          )}
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-[13px] font-medium text-fg-2">Providers</legend>
            {PROVIDERS.map((p) => {
              const unavailable = (p.key && !savedKeys.includes(p.id)) || ("photoOnly" in p && mediaType === "video");
              return (
                <label key={p.id} className={cn("flex items-center gap-2 text-[13px]", unavailable && "opacity-50")}>
                  <input type="checkbox" name="providers" value={p.id} defaultChecked={!unavailable} disabled={unavailable} className="size-4 accent-[var(--accent)]" />
                  {p.name}
                  {p.key && !savedKeys.includes(p.id) && <span className="text-xs text-muted">· add key in Integrations</span>}
                </label>
              );
            })}
          </fieldset>
          <SubmitButton className="w-full" pendingText="Searching…">
            <Icon name="search" /> Search
          </SubmitButton>
          <p className="text-xs text-muted">
            Results link to each provider. Nothing is downloaded; check the licence and credit the creator when you use an asset.
          </p>
        </form>
      </Card>

      <div className="space-y-4">
        {state.error && <p role="alert" className="rounded-xl bg-danger-soft px-4 py-3 text-sm text-danger">{state.error}</p>}
        {state.keywords && (
          <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
            Keywords: {state.keywords.map((k) => <Badge key={k}>{k}</Badge>)}
          </div>
        )}
        {state.errors && state.errors.length > 0 && (
          <ul className="space-y-1 text-xs text-warning">
            {state.errors.map((e) => <li key={e.provider}>{PROVIDERS.find((p) => p.id === e.provider)?.name ?? e.provider}: {e.message}</li>)}
          </ul>
        )}
        {state.results && state.results.length === 0 && !state.error && (
          <Card className="p-8 text-center text-sm text-muted">No matching results. Try broader words or another orientation.</Card>
        )}
        {!state.results && !state.error && (
          <Card className="p-8 text-center text-sm text-muted">Search licensed stock media from the providers you have connected.</Card>
        )}
        {state.results && state.results.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {state.results.map((r) => (
              <li key={`${r.provider}-${r.id}`}>
                <Card className="flex h-full flex-col overflow-hidden">
                  <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="relative block aspect-video bg-surface-2">
                    {r.thumbnailUrl ? (
                      // Hotlinked provider preview, as the provider APIs require; not downloaded or stored.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.thumbnailUrl} alt={r.title} loading="lazy" referrerPolicy="no-referrer" className="size-full object-cover" />
                    ) : (
                      <span className="grid size-full place-items-center text-muted"><Icon name="image" size={22} /></span>
                    )}
                    {r.durationSec !== null && (
                      <span className="absolute right-2 bottom-2 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white tabular-nums">{Math.round(r.durationSec)}s</span>
                    )}
                  </a>
                  <div className="flex flex-1 flex-col gap-1 p-3 text-xs">
                    <p className="line-clamp-2 text-[13px] font-medium">{r.title}</p>
                    <p className="text-muted">
                      {r.creator ? (r.creatorUrl ? <a href={r.creatorUrl} target="_blank" rel="noreferrer" className="hover:underline">{r.creator}</a> : r.creator) : "Unknown creator"}
                      {" · "}
                      {PROVIDERS.find((p) => p.id === r.provider)?.name}
                    </p>
                    <p className="text-muted">
                      Licence: {r.licenseUrl ? <a href={r.licenseUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">{r.license}</a> : r.license}
                    </p>
                    <a href={r.sourceUrl} target="_blank" rel="noreferrer" className="mt-auto inline-flex items-center gap-1 pt-1 font-medium text-accent hover:underline">
                      Open source page <Icon name="external" size={11} />
                    </a>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
