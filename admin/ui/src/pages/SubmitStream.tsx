import { useId, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { CreateStreamBody } from '../../../shared/types';
import { api } from '../api/client';
import YouTubeEmbed from '../components/YouTubeEmbed';

function extractVideoId(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname === 'youtu.be') {
      return u.pathname.slice(1);
    }
    return u.searchParams.get('v') ?? '';
  } catch {
    return '';
  }
}

export default function SubmitStream() {
  const navigate = useNavigate();
  const formId = useId();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [youtubeUrl, setYoutubeUrl] = useState('');
  const [videoId, setVideoId] = useState('');
  const [creditAuthor, setCreditAuthor] = useState('');
  const [creditAuthorUrl, setCreditAuthorUrl] = useState('');
  const [creditCommentUrl, setCreditCommentUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUrlChange = (url: string) => {
    setYoutubeUrl(url);
    const id = extractVideoId(url);
    if (id) setVideoId(id);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !date || !videoId.trim()) {
      setError('Title, date, and video ID are required.');
      return;
    }

    setSubmitting(true);
    setError(null);

    const body: CreateStreamBody = {
      title: title.trim(),
      date,
      videoId: videoId.trim(),
      youtubeUrl: youtubeUrl.trim() || `https://www.youtube.com/watch?v=${videoId.trim()}`,
    };

    if (creditAuthor.trim()) {
      body.credit = {
        author: creditAuthor.trim(),
        authorUrl: creditAuthorUrl.trim() || undefined,
        commentUrl: creditCommentUrl.trim() || undefined,
      };
    }

    try {
      await api.createStream(body);
      navigate('/streams');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Submission failed');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h2 className="text-xl font-semibold text-slate-800">Submit Stream</h2>

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
            placeholder="e.g. 歌枠 2024-12-25"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label htmlFor={`${formId}-date`} className="block text-sm font-medium text-slate-700">
            Date <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-date`}
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label htmlFor={`${formId}-youtube-url`} className="block text-sm font-medium text-slate-700">
            YouTube URL
          </label>
          <input
            id={`${formId}-youtube-url`}
            type="url"
            value={youtubeUrl}
            onChange={(e) => handleUrlChange(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..."
            aria-describedby={`${formId}-youtube-url-help`}
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <p id={`${formId}-youtube-url-help`} className="mt-1 text-xs text-slate-500">
            Video ID will be extracted automatically.
          </p>
        </div>

        <div>
          <label htmlFor={`${formId}-video-id`} className="block text-sm font-medium text-slate-700">
            Video ID <span aria-hidden="true" className="text-red-500">*</span>
          </label>
          <input
            id={`${formId}-video-id`}
            type="text"
            value={videoId}
            onChange={(e) => setVideoId(e.target.value)}
            placeholder="Auto-extracted or enter manually"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
        </div>

        {/* Credit section */}
        <div className="border-t border-slate-200 pt-4">
          <h3 className="text-sm font-semibold text-slate-700">Credit (optional)</h3>
          <div className="mt-2 space-y-2">
            <div>
              <label htmlFor={`${formId}-credit-author`} className="block text-xs font-medium text-slate-600">
                Credit author
              </label>
              <input
                id={`${formId}-credit-author`}
                type="text"
                value={creditAuthor}
                onChange={(e) => setCreditAuthor(e.target.value)}
                placeholder="e.g. Timestamp contributor"
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-credit-author-url`} className="block text-xs font-medium text-slate-600">
                Author URL
              </label>
              <input
                id={`${formId}-credit-author-url`}
                type="url"
                value={creditAuthorUrl}
                onChange={(e) => setCreditAuthorUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
            <div>
              <label htmlFor={`${formId}-credit-comment-url`} className="block text-xs font-medium text-slate-600">
                Comment URL
              </label>
              <input
                id={`${formId}-credit-comment-url`}
                type="url"
                value={creditCommentUrl}
                onChange={(e) => setCreditCommentUrl(e.target.value)}
                placeholder="https://..."
                className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {/* Preview */}
        {videoId && (
          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold text-slate-700">Preview</h3>
            <div className="mt-2 aspect-video w-full max-w-md overflow-hidden rounded-md">
              <YouTubeEmbed videoId={videoId} title="Stream preview" />
            </div>
          </div>
        )}

        <div className="flex gap-3 pt-2">
          <button
            type="submit"
            disabled={submitting}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Stream'}
          </button>
          <button
            type="button"
            onClick={() => navigate('/streams')}
            className="rounded-md bg-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-300"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
