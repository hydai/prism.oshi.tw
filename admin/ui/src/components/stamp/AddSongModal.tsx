import { useEffect, useRef, useState } from 'react';

/** Adds one song at the player's current position; the caller supplies the timestamp. */
export function AddSongModal({
  onSubmit,
  onCancel,
}: {
  onSubmit: (title: string, artist: string) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), artist.trim());
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/40">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl"
      >
        <h3 className="text-lg font-semibold text-slate-800">Add Song</h3>
        <div className="mt-4 space-y-3">
          <input
            ref={inputRef}
            type="text"
            aria-label="Song title"
            placeholder="Song title *"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            required
          />
          <input
            type="text"
            aria-label="Original artist"
            placeholder="Original artist"
            value={artist}
            onChange={(e) => setArtist(e.target.value)}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            Add
          </button>
        </div>
      </form>
    </div>
  );
}
