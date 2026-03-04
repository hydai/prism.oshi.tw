import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import type { AuthUser } from '../../shared/types';
import { api } from './api/client';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import SongsList from './pages/SongsList';
import SongDetail from './pages/SongDetail';
import StreamsList from './pages/StreamsList';
import SubmitSong from './pages/SubmitSong';
import SubmitStream from './pages/SubmitStream';
import StampEditor from './pages/StampEditor';
import StreamDetailPage from './pages/StreamDetail';
import Pipeline from './pages/Pipeline';
import NovaSubmissions from './pages/NovaSubmissions';
import NovaVodSubmissions from './pages/NovaVodSubmissions';
import CrystalTickets from './pages/CrystalTickets';

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .me()
      .then(setUser)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Failed to authenticate');
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-slate-500">Loading...</div>
      </div>
    );
  }

  if (error || !user) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-center">
          <h1 className="text-xl font-semibold text-slate-800">Authentication Required</h1>
          <p className="mt-2 text-slate-500">{error ?? 'Unable to verify identity.'}</p>
        </div>
      </div>
    );
  }

  return (
    <Layout user={user}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/songs" element={<SongsList user={user} />} />
        <Route path="/songs/:id" element={<SongDetail user={user} />} />
        <Route path="/streams" element={<StreamsList user={user} />} />
        <Route path="/streams/:id" element={<StreamDetailPage user={user} />} />
        <Route path="/submit/song" element={<SubmitSong />} />
        <Route path="/submit/stream" element={<SubmitStream />} />
        <Route path="/stamp" element={<StampEditor user={user} />} />
        <Route path="/pipeline" element={<Pipeline user={user} />} />
        <Route path="/nova" element={<NovaSubmissions user={user} />} />
        <Route path="/nova/vods" element={<NovaVodSubmissions user={user} />} />
        <Route path="/crystal" element={<CrystalTickets user={user} />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}
