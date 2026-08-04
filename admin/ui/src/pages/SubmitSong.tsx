import { useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreateSongBody, CreatePerformanceBody } from '../../../shared/types';
import { api } from '../api/client';
import TagPicker from '../components/TagPicker';

interface PerformanceForm {
  clientId: string;
  streamId: string;
  date: string;
  streamTitle: string;
  videoId: string;
  timestamp: string;
  endTimestamp: string;
  note: string;
}

const emptyPerformance: Omit<PerformanceForm, 'clientId'> = {
  streamId: '',
  date: '',
  streamTitle: '',
  videoId: '',
  timestamp: '0',
  endTimestamp: '',
  note: '',
};

export default function SubmitSong() {
  const navigate = useNavigate();
  const formId = useId();
  const [title, setTitle] = useState('');
  const [originalArtist, setOriginalArtist] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [performances, setPerformances] = useState<PerformanceForm[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const performanceIdPrefix = useId();
  const nextPerformanceId = useRef(0);

  const addPerformance = () => {
    const clientId = `${performanceIdPrefix}-${nextPerformanceId.current++}`;
    setPerformances((previous) => [...previous, { ...emptyPerformance, clientId }]);
  };

  const updatePerformance = (idx: number, field: keyof PerformanceForm, value: string) => {
    setPerformances((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  };

  const removePerformance = (idx: number) => {
    setPerformances((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !originalArtist.trim()) {
      setError('Title and artist are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const perfBodies: CreatePerformanceBody[] = [];
    for (const performance of performances) {
      const streamId = performance.streamId.trim();
      const videoId = performance.videoId.trim();
      if (!streamId || !videoId) continue;

      perfBodies.push({
        songId: '', // filled by API
        streamId,
        date: performance.date,
        streamTitle: performance.streamTitle,
        videoId,
        timestamp: parseInt(performance.timestamp, 10) || 0,
        endTimestamp: performance.endTimestamp
          ? parseInt(performance.endTimestamp, 10)
          : null,
        note: performance.note,
      });
    }

    const body: CreateSongBody = {
      title: title.trim(),
      originalArtist: originalArtist.trim(),
      tags,
      performances: perfBodies.length > 0 ? perfBodies : undefined,
    };

    try {
      await api.createSong(body);
      navigate('/songs');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-800">Submit Song</h2>

      <form onSubmit={handleSubmit} className="mt-4 space-y-4">
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div>
          <label htmlFor={`${formId}-title`} className="block text-sm font-medium text-slate-700">
            Title <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-title`}
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label htmlFor={`${formId}-artist`} className="block text-sm font-medium text-slate-700">
            Original Artist <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-artist`}
            type="text"
            value={originalArtist}
            onChange={(e) => setOriginalArtist(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-700">Tags</label>
          <div className="mt-1 rounded-md border border-slate-300 bg-slate-50 p-3">
            <TagPicker value={tags} onChange={setTags} recommendedScope="song" compact />
          </div>
        </div>

        {/* Performances */}
        <div className="border-t border-slate-200 pt-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">Performances</h3>
            <button
              type="button"
              onClick={addPerformance}
              className="text-sm text-blue-600 hover:underline"
            >
              + Add Performance
            </button>
          </div>

          {performances.map((perf, idx) => (
            <div key={perf.clientId} className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3 space-y-2">
              <div className="flex justify-between">
                <span className="text-xs font-medium text-slate-500">Performance #{idx + 1}</span>
                <button
                  type="button"
                  onClick={() => removePerformance(idx)}
                  className="text-xs text-red-500 hover:underline"
                >
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor={`${perf.clientId}-stream-id`} className="block text-xs font-medium text-slate-600">
                    Stream ID
                  </label>
                  <input
                    id={`${perf.clientId}-stream-id`}
                    type="text"
                    placeholder="Stream ID"
                    value={perf.streamId}
                    onChange={(e) => updatePerformance(idx, 'streamId', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${perf.clientId}-stream-title`} className="block text-xs font-medium text-slate-600">
                    Stream title
                  </label>
                  <input
                    id={`${perf.clientId}-stream-title`}
                    type="text"
                    placeholder="Stream title"
                    value={perf.streamTitle}
                    onChange={(e) => updatePerformance(idx, 'streamTitle', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${perf.clientId}-video-id`} className="block text-xs font-medium text-slate-600">
                    Video ID
                  </label>
                  <input
                    id={`${perf.clientId}-video-id`}
                    type="text"
                    placeholder="Video ID"
                    value={perf.videoId}
                    onChange={(e) => updatePerformance(idx, 'videoId', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${perf.clientId}-date`} className="block text-xs font-medium text-slate-600">
                    Date
                  </label>
                  <input
                    id={`${perf.clientId}-date`}
                    type="date"
                    value={perf.date}
                    onChange={(e) => updatePerformance(idx, 'date', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${perf.clientId}-start`} className="block text-xs font-medium text-slate-600">
                    Start (seconds)
                  </label>
                  <input
                    id={`${perf.clientId}-start`}
                    type="number"
                    placeholder="Start (seconds)"
                    value={perf.timestamp}
                    onChange={(e) => updatePerformance(idx, 'timestamp', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
                <div>
                  <label htmlFor={`${perf.clientId}-end`} className="block text-xs font-medium text-slate-600">
                    End (seconds, optional)
                  </label>
                  <input
                    id={`${perf.clientId}-end`}
                    type="number"
                    placeholder="End (seconds, optional)"
                    value={perf.endTimestamp}
                    onChange={(e) => updatePerformance(idx, 'endTimestamp', e.target.value)}
                    className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                  />
                </div>
              </div>
              <div>
                <label htmlFor={`${perf.clientId}-note`} className="block text-xs font-medium text-slate-600">
                  Note (optional)
                </label>
                <input
                  id={`${perf.clientId}-note`}
                  type="text"
                  placeholder="Note (optional)"
                  value={perf.note}
                  onChange={(e) => updatePerformance(idx, 'note', e.target.value)}
                  className="mt-1 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                />
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Song'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/songs')}
            className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
