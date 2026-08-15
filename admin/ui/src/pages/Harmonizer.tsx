import { useState } from 'react';
import type { AuthUser } from '../../../shared/types';
import SimilarArtistsTab from '../components/harmonizer/SimilarArtistsTab';
import SimilarSongsTab from '../components/harmonizer/SimilarSongsTab';

type Tab = 'songs' | 'artists';

export default function Harmonizer({ user: _user }: { user: AuthUser }) {
  const [tab, setTab] = useState<Tab>('songs');

  return (
    <div>
      <h1 className="mb-4 text-2xl font-bold text-slate-800">Harmonizer</h1>
      <p className="mb-6 text-sm text-slate-500">
        Merge duplicate song records without losing performances, and fix artist naming inconsistencies.
      </p>

      {/* Tab switcher */}
      <div className="mb-6 flex border-b border-slate-200">
        <button
          onClick={() => setTab('songs')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'songs'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Similar Songs
        </button>
        <button
          onClick={() => setTab('artists')}
          className={`px-4 py-2 text-sm font-medium ${
            tab === 'artists'
              ? 'border-b-2 border-blue-600 text-blue-600'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          Similar Artists
        </button>
      </div>

      {tab === 'songs' ? <SimilarSongsTab /> : <SimilarArtistsTab />}
    </div>
  );
}
