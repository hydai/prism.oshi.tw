import type { AuroraSong } from '../components/SongListEditor';

/** Only apply a lookup if the user has not changed the song it described. */
export function applyDuration(songs: AuroraSong[], expected: AuroraSong, durationSec: number): AuroraSong[] {
  return songs.map((song) => (
    song.id === expected.id
    && song.name === expected.name
    && song.artist === expected.artist
    && song.startSeconds === expected.startSeconds
    && song.endSeconds === expected.endSeconds
      ? { ...song, endSeconds: song.startSeconds + durationSec }
      : song
  ));
}
