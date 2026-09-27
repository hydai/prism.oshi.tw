import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../ui/Button';
import { Dialog } from '../ui/Dialog';
import { TextInput } from '../ui/Fields';

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
  const formId = useId();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    onSubmit(title.trim(), artist.trim());
  };

  return (
    <Dialog
      open
      onClose={onCancel}
      title="Add Song"
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant="primary">
            Add
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="space-y-3">
        <TextInput
          ref={inputRef}
          aria-label="Song title"
          placeholder="Song title *"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
        />
        <TextInput
          aria-label="Original artist"
          placeholder="Original artist"
          value={artist}
          onChange={(e) => setArtist(e.target.value)}
        />
      </form>
    </Dialog>
  );
}
