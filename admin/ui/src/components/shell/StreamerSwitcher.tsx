import { useState } from 'react';
import type { StreamerInfo } from '../../../../shared/types';
import { useCurrentStreamer } from '../../hooks/useCurrentStreamer';
import { Icon } from '../ui/Icon';
import { Popover } from '../ui/Popover';
import { SearchableList } from '../ui/SearchableList';
import { avatarGradient } from './avatar';
import { useCurrentStreamerName, useStreamers } from './Streamers';

/** The first character of a name, upper-cased; a whole code point, so an emoji is never split. */
function initialOf(name: string): string {
  return (Array.from(name.trim())[0] ?? '?').toUpperCase();
}

function matchesSearch(streamer: StreamerInfo, search: string): boolean {
  const needle = search.trim().toLowerCase();
  return (
    needle === '' ||
    streamer.displayName.toLowerCase().includes(needle) ||
    streamer.slug.toLowerCase().includes(needle)
  );
}

/** A streamer's initial on its slug's gradient (the API has no streamer avatars to show). */
function StreamerAvatar({ name, slug, size = 'md' }: { name: string; slug: string; size?: 'sm' | 'md' }) {
  return (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${avatarGradient(slug)} ${
        size === 'sm' ? 'h-6 w-6 text-meta' : 'h-7 w-7 text-xs'
      }`}
    >
      {initialOf(name)}
    </span>
  );
}

/**
 * The streamer switcher: a listbox popover over the approved streamers, searchable by name or
 * slug. `card` is the sidebar's full-width streamer card; `avatar` is the top bar's round avatar
 * (below 1024 px), opening the same list aligned to its right edge. Choosing a streamer hands it
 * to `selectStreamer`: a page showing one of the old streamer's records (`/streams/:id`,
 * `/stamp?stream=`) falls back to its list, any other page stays put with its own filters — the
 * routed pages are keyed by the streamer and reload themselves. Choosing the current one only
 * closes the list.
 */
export function StreamerSwitcher({ variant = 'card' }: { variant?: 'card' | 'avatar' }) {
  const { streamers, selectStreamer } = useStreamers();
  const current = useCurrentStreamer();
  const name = useCurrentStreamerName();
  const [query, setQuery] = useState('');
  const visible = streamers.filter((streamer) => matchesSearch(streamer, query));

  const choose = (streamer: StreamerInfo, close: () => void) => {
    close();
    selectStreamer(streamer.slug);
  };

  return (
    <Popover
      kind="listbox"
      label="Streamer"
      align={variant === 'avatar' ? 'end' : 'start'}
      className={variant === 'card' ? 'w-full' : undefined}
      onOpenChange={(open) => {
        // Every opening starts from the whole list.
        if (!open) setQuery('');
      }}
      trigger={({ triggerProps }) =>
        variant === 'avatar' ? (
          <button
            {...triggerProps}
            type="button"
            title={name}
            className="flex rounded-full focus-visible:outline-none focus-visible:shadow-focus"
          >
            <StreamerAvatar name={name} slug={current} />
            <span className="sr-only">Streamer: {name}</span>
          </button>
        ) : (
          <button
            {...triggerProps}
            type="button"
            className="flex w-full min-w-0 items-center gap-2.5 rounded-[14px] border border-glass-edge bg-field px-2.5 py-2 text-left text-fg-subtle transition-colors hover:border-field-line focus-visible:outline-none focus-visible:shadow-focus"
          >
            <StreamerAvatar name={name} slug={current} />
            <span className="min-w-0 flex-1">
              <span className="sr-only">Streamer: </span>
              <span className="block truncate text-[12.5px] font-[650] leading-tight text-fg">{name}</span>
              <span className="block truncate text-meta">{current}</span>
            </span>
            <Icon name="chevronsUpDown" size={14} />
          </button>
        )
      }
    >
      {(close) => (
        <SearchableList
          items={visible}
          getKey={(streamer) => streamer.slug}
          getTitle={(streamer) => streamer.displayName}
          isSelected={(streamer) => streamer.slug === current}
          onSelect={(streamer) => choose(streamer, close)}
          renderItem={(streamer) => (
            <>
              <StreamerAvatar name={streamer.displayName} slug={streamer.slug} size="sm" />
              <span className="min-w-0">
                <span className="block truncate font-[650]">{streamer.displayName}</span>
                <span className="block truncate text-meta text-fg-subtle">{streamer.slug}</span>
              </span>
            </>
          )}
          search={query}
          onSearchChange={setQuery}
          searchLabel="Search streamers"
          searchPlaceholder="Search streamers..."
          label="Streamers"
          emptyText={query.trim() === '' ? 'No streamers' : 'No matching streamers'}
        />
      )}
    </Popover>
  );
}
