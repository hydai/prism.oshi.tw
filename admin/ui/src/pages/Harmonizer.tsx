import { useRef, useState } from 'react';
import SimilarArtistsTab from '../components/harmonizer/SimilarArtistsTab';
import SimilarSongsTab from '../components/harmonizer/SimilarSongsTab';
import { PageHeader } from '../components/ui/PageHeader';
import { Segmented } from '../components/ui/Toggles';
import { usePageHeaderHeight } from '../hooks/usePageHeaderHeight';

type Tab = 'songs' | 'artists';

/**
 * The Harmonizer (spec §8.7): similar songs to merge and similar artist names to align, one tab each
 * behind the header's "Harmonizer view". Both tabs stay mounted — the inactive one is only `hidden` —
 * so a trip to the other tab keeps each one's scan and selection, and only the shown one hears J / K.
 * The header's controls slot holds the active tab's scan controls, which that tab portals there;
 * each tab reports its group count, which its view option shows once it has scanned.
 */
export default function Harmonizer() {
  const [tab, setTab] = useState<Tab>('songs');
  const [songGroupCount, setSongGroupCount] = useState<number | null>(null);
  const [artistGroupCount, setArtistGroupCount] = useState<number | null>(null);
  // The header element the active tab portals its controls into. Held in state through a callback
  // ref, so the tabs render again with it once it has mounted.
  const [controlsSlot, setControlsSlot] = useState<HTMLElement | null>(null);
  // The header is the root's first child on every render, the first included: it is measured there.
  const pageRef = useRef<HTMLDivElement>(null);
  usePageHeaderHeight(pageRef);

  return (
    // No blur, transform or overflow on this root: the header and the queue's list card stick to <main>.
    <div ref={pageRef} className="flex flex-col">
      <PageHeader
        crumb="LIBRARY"
        title="Harmonizer"
        actions={<div ref={setControlsSlot} className="flex flex-wrap items-center gap-2" />}
      >
        <Segmented
          label="Harmonizer view"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'songs', label: 'Similar songs', count: songGroupCount ?? undefined },
            { value: 'artists', label: 'Similar artists', count: artistGroupCount ?? undefined },
          ]}
        />
      </PageHeader>

      {/* Padding only, no display utility: one would outrank the `hidden` attribute. */}
      <section aria-label="Similar songs" hidden={tab !== 'songs'} className="p-4 lg:px-5 lg:pb-[18px]">
        <SimilarSongsTab
          active={tab === 'songs'}
          controlsSlot={controlsSlot}
          onGroupCountChange={setSongGroupCount}
        />
      </section>
      <section aria-label="Similar artists" hidden={tab !== 'artists'} className="p-4 lg:px-5 lg:pb-[18px]">
        <SimilarArtistsTab
          active={tab === 'artists'}
          controlsSlot={controlsSlot}
          onGroupCountChange={setArtistGroupCount}
        />
      </section>
    </div>
  );
}
