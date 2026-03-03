"""Tests for fill-artists: auto-fill missing originalArtist from existing songs."""

from __future__ import annotations

from copy import deepcopy

import pytest

from mizukilens.fill_artists import (
    FillCandidate,
    apply_fill_plan,
    compute_fill_plan,
    normalize_title_for_matching,
)


# ===========================================================================
# normalize_title_for_matching
# ===========================================================================

class TestNormalizeTitleForMatching:
    def test_lowercase(self):
        assert normalize_title_for_matching("Hello World") == "hello world"

    def test_strip(self):
        assert normalize_title_for_matching("  hello  ") == "hello"

    def test_nfkc_fullwidth(self):
        # Fullwidth Latin "Ｈｅｌｌｏ" → "hello"
        assert normalize_title_for_matching("Ｈｅｌｌｏ") == "hello"

    def test_cjk_preserved(self):
        assert normalize_title_for_matching("紅蓮華") == "紅蓮華"

    def test_collapse_spaces(self):
        assert normalize_title_for_matching("hello   world") == "hello world"

    def test_empty_string(self):
        assert normalize_title_for_matching("") == ""

    def test_mixed_cjk_and_latin(self):
        assert normalize_title_for_matching("  aLIEz  ") == "aliez"


# ===========================================================================
# compute_fill_plan
# ===========================================================================

def _song(sid: str, title: str, artist: str = "") -> dict:
    """Build a minimal song dict."""
    return {"id": sid, "title": title, "originalArtist": artist, "performances": []}


class TestComputeFillPlan:
    def test_unique_match(self):
        songs = [
            _song("s1", "aLIEz", "澤野弘之"),
            _song("s2", "aLIEz"),  # missing artist
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 1
        c = plan[0]
        assert c.song_id == "s2"
        assert c.match_type == "unique"
        assert c.chosen_artist == "澤野弘之"
        assert c.artists == {"澤野弘之": 1}

    def test_ambiguous_match(self):
        songs = [
            _song("s1", "Let it go", "Idina Menzel"),
            _song("s2", "Let it go", "Frozen Cast"),
            _song("s3", "Let it go"),  # missing
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 1
        c = plan[0]
        assert c.match_type == "ambiguous"
        assert c.chosen_artist is None
        assert set(c.artists.keys()) == {"Idina Menzel", "Frozen Cast"}

    def test_no_match(self):
        songs = [
            _song("s1", "Unravel", "TK"),
            _song("s2", "completely unique title"),  # missing, no match
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 1
        c = plan[0]
        assert c.match_type == "no_match"
        assert c.chosen_artist is None
        assert c.artists == {}

    def test_already_has_artist_skipped(self):
        songs = [
            _song("s1", "Idol", "YOASOBI"),
            _song("s2", "Idol", "YOASOBI"),  # has artist, should NOT appear
        ]
        plan = compute_fill_plan(songs)
        assert plan == []

    def test_case_insensitive(self):
        songs = [
            _song("s1", "ALIEZ", "澤野弘之"),
            _song("s2", "aliez"),  # missing
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 1
        assert plan[0].match_type == "unique"
        assert plan[0].chosen_artist == "澤野弘之"

    def test_multiple_songs_missing(self):
        songs = [
            _song("s1", "紅蓮華", "LiSA"),
            _song("s2", "紅蓮華"),   # missing
            _song("s3", "紅蓮華"),   # also missing
            _song("s4", "Unknown"),  # no match
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 3
        unique = [c for c in plan if c.match_type == "unique"]
        no_match = [c for c in plan if c.match_type == "no_match"]
        assert len(unique) == 2
        assert len(no_match) == 1
        assert all(c.chosen_artist == "LiSA" for c in unique)

    def test_occurrence_count(self):
        songs = [
            _song("s1", "夜に駆ける", "YOASOBI"),
            _song("s2", "夜に駆ける", "YOASOBI"),
            _song("s3", "夜に駆ける"),  # missing
        ]
        plan = compute_fill_plan(songs)
        assert len(plan) == 1
        assert plan[0].artists == {"YOASOBI": 2}

    def test_empty_songs_list(self):
        assert compute_fill_plan([]) == []

    def test_all_artists_filled(self):
        songs = [
            _song("s1", "Idol", "YOASOBI"),
            _song("s2", "紅蓮華", "LiSA"),
        ]
        assert compute_fill_plan(songs) == []


# ===========================================================================
# apply_fill_plan
# ===========================================================================

class TestApplyFillPlan:
    def test_applies_chosen_artist(self):
        songs = [_song("s1", "aLIEz"), _song("s2", "Unravel")]
        candidates = [
            FillCandidate("s1", "aLIEz", "unique", {"澤野弘之": 1}, "澤野弘之"),
        ]
        count = apply_fill_plan(songs, candidates)
        assert count == 1
        assert songs[0]["originalArtist"] == "澤野弘之"

    def test_skips_none_chosen(self):
        songs = [_song("s1", "Let it go")]
        candidates = [
            FillCandidate("s1", "Let it go", "ambiguous",
                          {"A": 1, "B": 1}, None),
        ]
        count = apply_fill_plan(songs, candidates)
        assert count == 0
        assert songs[0]["originalArtist"] == ""

    def test_returns_count(self):
        songs = [_song("s1", "a"), _song("s2", "b"), _song("s3", "c")]
        candidates = [
            FillCandidate("s1", "a", "unique", {"X": 1}, "X"),
            FillCandidate("s2", "b", "unique", {"Y": 1}, "Y"),
            FillCandidate("s3", "c", "no_match", {}, None),
        ]
        assert apply_fill_plan(songs, candidates) == 2

    def test_only_mutates_original_artist(self):
        songs = [_song("s1", "title1")]
        songs[0]["tags"] = ["rock"]
        original = deepcopy(songs)

        candidates = [
            FillCandidate("s1", "title1", "unique", {"Artist": 1}, "Artist"),
        ]
        apply_fill_plan(songs, candidates)

        assert songs[0]["originalArtist"] == "Artist"
        assert songs[0]["title"] == original[0]["title"]
        assert songs[0]["id"] == original[0]["id"]
        assert songs[0]["tags"] == original[0]["tags"]

    def test_empty_candidates(self):
        songs = [_song("s1", "a")]
        assert apply_fill_plan(songs, []) == 0
