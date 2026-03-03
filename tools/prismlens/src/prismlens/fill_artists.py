"""Auto-fill missing ``originalArtist`` by cross-referencing existing songs.

Many songs appear across multiple livestreams.  When a song entry is missing
its artist but the *same title* already exists elsewhere with an artist, we
can back-fill the empty field automatically.
"""

from __future__ import annotations

import unicodedata
from collections import defaultdict
from dataclasses import dataclass, field


@dataclass
class FillCandidate:
    """One song whose ``originalArtist`` is empty."""

    song_id: str
    title: str
    match_type: str  # "unique" | "ambiguous" | "no_match"
    artists: dict[str, int] = field(default_factory=dict)
    chosen_artist: str | None = None


def normalize_title_for_matching(title: str) -> str:
    """Normalize a song title for fuzzy-ish matching.

    Steps: strip → lowercase → NFKC normalize → collapse whitespace.
    Conservative on purpose — avoids false positives.
    """
    title = title.strip().lower()
    title = unicodedata.normalize("NFKC", title)
    return " ".join(title.split())


def compute_fill_plan(songs: list[dict]) -> list[FillCandidate]:
    """Build a fill plan for songs with empty ``originalArtist``.

    Returns a list of :class:`FillCandidate` objects, one per song missing
    its artist.  Each candidate is classified as ``unique`` (exactly one
    distinct artist found among same-title songs), ``ambiguous`` (multiple
    artists), or ``no_match`` (no other song shares the title).
    """
    # Step 1: index title → artist occurrences from songs WITH artists.
    title_index: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for song in songs:
        artist = song.get("originalArtist", "")
        if artist:
            norm = normalize_title_for_matching(song.get("title", ""))
            title_index[norm][artist] += 1

    # Step 2: classify empty-artist songs.
    candidates: list[FillCandidate] = []
    for song in songs:
        if song.get("originalArtist", "") != "":
            continue  # already has artist

        norm = normalize_title_for_matching(song.get("title", ""))
        artist_counts = dict(title_index.get(norm, {}))

        if not artist_counts:
            match_type = "no_match"
            chosen = None
        elif len(artist_counts) == 1:
            match_type = "unique"
            chosen = next(iter(artist_counts))
        else:
            match_type = "ambiguous"
            chosen = None

        candidates.append(
            FillCandidate(
                song_id=song["id"],
                title=song.get("title", ""),
                match_type=match_type,
                artists=artist_counts,
                chosen_artist=chosen,
            )
        )

    return candidates


def apply_fill_plan(songs: list[dict], candidates: list[FillCandidate]) -> int:
    """Set ``originalArtist`` on songs where ``chosen_artist`` is set.

    Mutates *songs* in place.  Returns the number of songs updated.
    """
    fill_map: dict[str, str] = {
        c.song_id: c.chosen_artist
        for c in candidates
        if c.chosen_artist is not None
    }
    if not fill_map:
        return 0

    count = 0
    for song in songs:
        artist = fill_map.get(song["id"])
        if artist is not None:
            song["originalArtist"] = artist
            count += 1
    return count
