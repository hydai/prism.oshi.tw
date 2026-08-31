'use client';

import ArchivePageView from './ArchivePageView';
import { ArchiveDataProvider } from './archive-data-context';
import { ArchiveFiltersProvider } from './archive-filters-context';
import { ArchiveUiProvider } from './archive-ui-context';

export default function Home() {
  return (
    <ArchiveDataProvider>
      <ArchiveUiProvider>
        <ArchiveFiltersProvider>
          <ArchivePageView />
        </ArchiveFiltersProvider>
      </ArchiveUiProvider>
    </ArchiveDataProvider>
  );
}
