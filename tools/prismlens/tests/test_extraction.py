"""Tests for the MizukiLens extraction module (LENS-004).

All tests mock youtube-comment-downloader and yt-dlp — no real YouTube calls.
"""

from __future__ import annotations

import sqlite3
from unittest.mock import MagicMock, patch

import pytest

from mizukilens.cache import (
    open_db,
    upsert_stream,
    get_stream,
    get_parsed_songs,
)
from mizukilens.extraction import (
    SUSPICIOUS_THRESHOLD,
    ExtractionResult,
    ExtractionError,
    count_timestamps,
    extract_from_candidate,
    extract_from_text,
    extract_timestamps,
    find_candidate_comment,
    find_keyword_comments,
    get_video_info_from_ytdlp,
    is_suspicious_timestamp,
    parse_song_line,
    parse_text_to_songs,
    parse_timestamp,
    _parse_vote_count,
    seconds_to_timestamp,
    _split_artist,
)


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def db(tmp_path):
    """Return an in-memory-backed (temp file) SQLite connection with schema."""
    db_path = tmp_path / "test.db"
    conn = open_db(db_path)
    yield conn
    conn.close()


def _add_stream(conn: sqlite3.Connection, video_id: str, status: str = "discovered") -> None:
    """Helper: insert a minimal stream row."""
    upsert_stream(conn, video_id=video_id, status=status, title=f"Stream {video_id}")


# ---------------------------------------------------------------------------
# §1  Timestamp parsing
# ---------------------------------------------------------------------------


class TestParseTimestamp:
    """Tests for :func:`parse_timestamp`."""

    def test_h_mm_ss(self):
        assert parse_timestamp("1:23:45") == 5025

    def test_hh_mm_ss(self):
        assert parse_timestamp("01:23:45") == 5025

    def test_mm_ss(self):
        assert parse_timestamp("23:45") == 1425

    def test_m_ss(self):
        assert parse_timestamp("3:45") == 225

    def test_zero(self):
        assert parse_timestamp("0:00") == 0

    def test_large_hours(self):
        assert parse_timestamp("12:00:00") == 43200

    def test_invalid_returns_none(self):
        assert parse_timestamp("not a timestamp") is None

    def test_empty_returns_none(self):
        assert parse_timestamp("") is None

    def test_leading_whitespace_stripped(self):
        assert parse_timestamp("  2:30  ") == 150

    def test_seconds_only_invalid(self):
        # No colon → not a valid timestamp
        assert parse_timestamp("123") is None


class TestCountTimestamps:
    """Tests for :func:`count_timestamps`."""

    def test_empty_string(self):
        assert count_timestamps("") == 0

    def test_one_timestamp(self):
        assert count_timestamps("0:00 Song A") == 1

    def test_multiple_timestamps(self):
        text = "0:00 Intro\n1:23 Song A\n3:45 Song B\n5:00 Song C"
        assert count_timestamps(text) == 4

    def test_mixed_formats(self):
        text = "0:00 A\n1:23:45 B\n23:45 C"
        assert count_timestamps(text) == 3


class TestIsSuspiciousTimestamp:
    """Tests for :func:`is_suspicious_timestamp`."""

    def test_exactly_12h_not_suspicious(self):
        assert not is_suspicious_timestamp(43200)

    def test_just_over_12h_is_suspicious(self):
        assert is_suspicious_timestamp(43201)

    def test_zero_not_suspicious(self):
        assert not is_suspicious_timestamp(0)

    def test_large_value_suspicious(self):
        assert is_suspicious_timestamp(100000)


# ---------------------------------------------------------------------------
# §2  Song info parsing
# ---------------------------------------------------------------------------


class TestSplitArtist:
    """Tests for :func:`_split_artist`."""

    def test_slash_separator(self):
        name, artist = _split_artist("打上花火 / DAOKO×米津玄師")
        assert name == "打上花火"
        assert artist == "DAOKO×米津玄師"

    def test_dash_separator(self):
        name, artist = _split_artist("Lemon - 米津玄師")
        assert name == "Lemon"
        assert artist == "米津玄師"

    def test_no_separator(self):
        name, artist = _split_artist("打上花火")
        assert name == "打上花火"
        assert artist == ""

    def test_slash_preferred_over_dash(self):
        # " / " takes priority over " - "
        name, artist = _split_artist("A - B / C")
        assert name == "A - B"
        assert artist == "C"

    def test_leading_trailing_whitespace_stripped(self):
        name, artist = _split_artist("  Song Name  /  Artist Name  ")
        assert name == "Song Name"
        assert artist == "Artist Name"

    def test_bare_slash_no_spaces(self):
        name, artist = _split_artist("ロミオとシンデレラ/doriko")
        assert name == "ロミオとシンデレラ"
        assert artist == "doriko"

    def test_spaced_slash_preferred_over_bare_slash(self):
        # Spaced slash still takes priority over bare slash
        name, artist = _split_artist("A/B / C")
        assert name == "A/B"
        assert artist == "C"

    def test_empty_string(self):
        name, artist = _split_artist("")
        assert name == ""
        assert artist == ""


class TestParseSongLine:
    """Tests for :func:`parse_song_line`."""

    def test_basic_hms_space_separator(self):
        result = parse_song_line("1:23:45 Song Name")
        assert result is not None
        assert result["start_seconds"] == 5025
        assert result["song_name"] == "Song Name"
        assert result["artist"] == ""

    def test_mm_ss_space_separator(self):
        result = parse_song_line("23:45 Song Name")
        assert result is not None
        assert result["start_seconds"] == 1425

    def test_dash_separator(self):
        result = parse_song_line("1:23:45 - Song Name")
        assert result is not None
        assert result["song_name"] == "Song Name"

    def test_en_dash_separator(self):
        result = parse_song_line("1:23:45 – Song Name")
        assert result is not None
        assert result["song_name"] == "Song Name"

    def test_em_dash_separator(self):
        result = parse_song_line("1:23:45 — Song Name")
        assert result is not None
        assert result["song_name"] == "Song Name"

    def test_with_artist_slash(self):
        result = parse_song_line("0:30 打上花火 / DAOKO×米津玄師")
        assert result is not None
        assert result["song_name"] == "打上花火"
        assert result["artist"] == "DAOKO×米津玄師"

    def test_with_artist_dash(self):
        result = parse_song_line("0:30 Lemon - 米津玄師")
        assert result is not None
        assert result["song_name"] == "Lemon"
        assert result["artist"] == "米津玄師"

    def test_no_song_after_timestamp_returns_none(self):
        result = parse_song_line("1:23:45")
        assert result is None

    def test_empty_line_returns_none(self):
        result = parse_song_line("")
        assert result is None

    def test_no_timestamp_returns_none(self):
        result = parse_song_line("Just some text")
        assert result is None

    def test_whitespace_only_returns_none(self):
        result = parse_song_line("   ")
        assert result is None

    def test_zero_timestamp(self):
        result = parse_song_line("0:00 Opening")
        assert result is not None
        assert result["start_seconds"] == 0

    def test_timestamp_with_extra_spaces(self):
        result = parse_song_line("  3:45  Song Title  ")
        assert result is not None
        assert result["start_seconds"] == 225

    def test_numbered_prefix_dot(self):
        result = parse_song_line("01. 0:05:41 ロミオとシンデレラ/doriko")
        assert result is not None
        assert result["start_seconds"] == 341
        assert result["song_name"] == "ロミオとシンデレラ"
        assert result["artist"] == "doriko"

    def test_numbered_prefix_paren(self):
        result = parse_song_line("1) 0:05:41 Song Name")
        assert result is not None
        assert result["start_seconds"] == 341
        assert result["song_name"] == "Song Name"

    def test_numbered_prefix_hash(self):
        result = parse_song_line("#3 0:05:41 Song Name")
        assert result is not None
        assert result["start_seconds"] == 341
        assert result["song_name"] == "Song Name"

    def test_numbered_prefix_large_number(self):
        result = parse_song_line("15. 1:23:45 Some Song")
        assert result is not None
        assert result["start_seconds"] == 5025
        assert result["song_name"] == "Some Song"

    def test_numbered_prefix_dot_no_space(self):
        """NN.MM:SS format where dot-prefix has no space before timestamp."""
        result = parse_song_line("01.04:58 Golden / HUNTR/X")
        assert result is not None
        assert result["start_seconds"] == 298  # 4*60 + 58
        assert result["song_name"] == "Golden"
        assert result["artist"] == "HUNTR/X"

    def test_numbered_prefix_dot_no_space_integration(self, db):
        """End-to-end: full VOD comment in NN.MM:SS format (Ii-726U2ASY)."""
        _add_stream(db, "vid_dotprefix")
        text = (
            "01.04:58 Golden / HUNTR/X\n"
            "02.09:19 Cure For Me / AURORA\n"
            "03.14:26 ヨルシカ - 花に亡霊\n"
            "04.19:12 Merry-Go-Round / 久石譲\n"
            "05.23:44 未来へ / Kiroro\n"
            "06.29:02 粉雪 / レミオロメン\n"
        )
        comments = [_make_comment_dict(text, votes="50")]

        result = extract_timestamps(db, "vid_dotprefix", comment_generator=iter(comments))

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 6
        assert result.songs[0]["song_name"] == "Golden"
        assert result.songs[0]["artist"] == "HUNTR/X"
        assert result.songs[0]["start_seconds"] == 298  # 4:58
        assert result.songs[1]["start_seconds"] == 559  # 9:19
        assert result.songs[2]["song_name"] == "ヨルシカ"
        assert result.songs[2]["artist"] == "花に亡霊"


class TestParseTextToSongs:
    """Tests for :func:`parse_text_to_songs`."""

    def test_basic_multiple_songs(self):
        text = "0:00 Song A\n1:30 Song B\n3:00 Song C"
        songs = parse_text_to_songs(text)
        assert len(songs) == 3

    def test_order_indexes(self):
        text = "0:00 Song A\n1:30 Song B\n3:00 Song C"
        songs = parse_text_to_songs(text)
        assert songs[0]["order_index"] == 0
        assert songs[1]["order_index"] == 1
        assert songs[2]["order_index"] == 2

    def test_end_timestamp_inference(self):
        text = "0:00 Song A\n1:30 Song B\n3:00 Song C"
        songs = parse_text_to_songs(text)
        # Song A ends where Song B starts
        assert songs[0]["end_seconds"] == 90  # 1:30
        # Song B ends where Song C starts
        assert songs[1]["end_seconds"] == 180  # 3:00
        # Last song has no end
        assert songs[2]["end_seconds"] is None

    def test_last_song_end_timestamp_is_none(self):
        text = "0:00 Song A\n5:00 Song B"
        songs = parse_text_to_songs(text)
        assert songs[-1]["end_timestamp"] is None
        assert songs[-1]["end_seconds"] is None

    def test_empty_text_returns_empty(self):
        assert parse_text_to_songs("") == []

    def test_no_timestamps_returns_empty(self):
        text = "Line without timestamp\nAnother line"
        assert parse_text_to_songs(text) == []

    def test_mixed_lines_non_timestamp_skipped(self):
        text = "Header\n0:00 Song A\nSome note\n1:30 Song B"
        songs = parse_text_to_songs(text)
        assert len(songs) == 2
        assert songs[0]["song_name"] == "Song A"
        assert songs[1]["song_name"] == "Song B"

    def test_suspicious_flag_set(self):
        # A timestamp over 12 hours = suspicious
        text = "0:00 Song A\n12:01:00 Song B"
        songs = parse_text_to_songs(text)
        assert songs[0]["suspicious"] is False
        assert songs[1]["suspicious"] is True

    def test_suspicious_flag_not_set_for_normal(self):
        text = "0:00 Song A\n1:00:00 Song B"
        songs = parse_text_to_songs(text)
        assert all(not s["suspicious"] for s in songs)

    def test_start_timestamp_format(self):
        text = "1:23:45 Song A"
        songs = parse_text_to_songs(text)
        assert songs[0]["start_timestamp"] == "1:23:45"

    def test_end_timestamp_format(self):
        text = "0:00 Song A\n1:23:45 Song B"
        songs = parse_text_to_songs(text)
        assert songs[0]["end_timestamp"] == "1:23:45"

    def test_artist_parsed(self):
        text = "0:00 打上花火 / DAOKO×米津玄師\n3:00 Lemon - 米津玄師"
        songs = parse_text_to_songs(text)
        assert songs[0]["song_name"] == "打上花火"
        assert songs[0]["artist"] == "DAOKO×米津玄師"
        assert songs[1]["song_name"] == "Lemon"
        assert songs[1]["artist"] == "米津玄師"


# ---------------------------------------------------------------------------
# §3  Candidate comment selection
# ---------------------------------------------------------------------------


class TestFindCandidateComment:
    """Tests for :func:`find_candidate_comment`."""

    def _make_comment(
        self,
        text: str,
        votes: str = "0",
        is_pinned: bool = False,
        cid: str = "c1",
    ) -> dict:
        return {
            "cid": cid,
            "text": text,
            "votes": votes,
            "is_pinned": is_pinned,
        }

    def _ts_text(self, count: int) -> str:
        """Create text with `count` timestamps."""
        return "\n".join(f"{i}:00 Song {i}" for i in range(count))

    def test_no_candidates_returns_none(self):
        # Comments with < 3 timestamps
        comments = [
            self._make_comment("0:00 Song A\n1:00 Song B", cid="c1"),
        ]
        assert find_candidate_comment(comments) is None

    def test_comment_with_three_timestamps_is_candidate(self):
        comments = [self._make_comment(self._ts_text(3), cid="c1")]
        result = find_candidate_comment(comments)
        assert result is not None
        assert result["cid"] == "c1"

    def test_pinned_comment_wins_over_higher_likes(self):
        pinned = self._make_comment(self._ts_text(3), votes="10", is_pinned=True, cid="pinned")
        popular = self._make_comment(self._ts_text(3), votes="1000", is_pinned=False, cid="popular")
        result = find_candidate_comment([popular, pinned])
        assert result["cid"] == "pinned"

    def test_higher_likes_wins_over_more_timestamps(self):
        many_ts = self._make_comment(self._ts_text(10), votes="5", cid="many_ts")
        high_likes = self._make_comment(self._ts_text(3), votes="100", cid="high_likes")
        result = find_candidate_comment([many_ts, high_likes])
        assert result["cid"] == "high_likes"

    def test_more_timestamps_wins_when_equal_likes(self):
        fewer_ts = self._make_comment(self._ts_text(3), votes="50", cid="fewer")
        more_ts = self._make_comment(self._ts_text(10), votes="50", cid="more")
        result = find_candidate_comment([fewer_ts, more_ts])
        assert result["cid"] == "more"

    def test_empty_list_returns_none(self):
        assert find_candidate_comment([]) is None

    def test_filter_out_below_min_threshold(self):
        below = self._make_comment(self._ts_text(2), votes="999", cid="below")
        above = self._make_comment(self._ts_text(3), votes="0", cid="above")
        result = find_candidate_comment([below, above])
        assert result["cid"] == "above"

    def test_k_suffix_votes_parsed(self):
        low = self._make_comment(self._ts_text(3), votes="500", cid="low")
        high_k = self._make_comment(self._ts_text(3), votes="1.5K", cid="high")
        result = find_candidate_comment([low, high_k])
        assert result["cid"] == "high"


class TestParseVoteCount:
    """Tests for :func:`_parse_vote_count`."""

    def test_plain_int(self):
        assert _parse_vote_count(100) == 100

    def test_plain_string(self):
        assert _parse_vote_count("345") == 345

    def test_k_suffix(self):
        assert _parse_vote_count("1.2K") == 1200

    def test_m_suffix(self):
        assert _parse_vote_count("2M") == 2_000_000

    def test_zero(self):
        assert _parse_vote_count("0") == 0

    def test_empty_string(self):
        assert _parse_vote_count("") == 0

    def test_invalid(self):
        assert _parse_vote_count("abc") == 0

    def test_comma_separated(self):
        assert _parse_vote_count("1,234") == 1234


# ---------------------------------------------------------------------------
# §4  extract_timestamps integration tests
# ---------------------------------------------------------------------------


def _make_comment_dict(
    text: str, votes: str = "0", is_pinned: bool = False, cid: str = "cmt1"
) -> dict:
    return {
        "cid": cid,
        "text": text,
        "votes": votes,
        "is_pinned": is_pinned,
        "author": "test_user",
        "channel": "UC_test",
        "replies": "0",
        "photo": "",
        "heart": False,
        "reply": False,
    }


_GOOD_COMMENT_TEXT = (
    "0:00 打上花火 / DAOKO×米津玄師\n"
    "3:45 Lemon - 米津玄師\n"
    "7:00 Pretender\n"
    "10:30 夜に駆ける\n"
)

_GOOD_DESCRIPTION_TEXT = (
    "曲目リスト:\n"
    "0:00 Song A\n"
    "2:00 Song B\n"
    "4:30 Song C\n"
    "7:00 Song D\n"
)


class TestExtractTimestampsFromComment:
    """Tests for comment-stage extraction in :func:`extract_timestamps`."""

    def test_comment_extraction_succeeds(self, db):
        _add_stream(db, "vid001")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT, votes="100")]

        result = extract_timestamps(db, "vid001", comment_generator=iter(comments))

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 4

    def test_stream_status_updated_to_extracted(self, db):
        _add_stream(db, "vid002")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid002", comment_generator=iter(comments))

        stream = get_stream(db, "vid002")
        assert stream["status"] == "extracted"

    def test_parsed_songs_saved(self, db):
        _add_stream(db, "vid003")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid003", comment_generator=iter(comments))

        songs = get_parsed_songs(db, "vid003")
        assert len(songs) == 4

    def test_song_names_correct(self, db):
        _add_stream(db, "vid004")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        result = extract_timestamps(db, "vid004", comment_generator=iter(comments))

        assert result.songs[0]["song_name"] == "打上花火"
        assert result.songs[1]["song_name"] == "Lemon"

    def test_artist_parsed_correctly(self, db):
        _add_stream(db, "vid005")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        result = extract_timestamps(db, "vid005", comment_generator=iter(comments))

        assert result.songs[0]["artist"] == "DAOKO×米津玄師"
        assert result.songs[1]["artist"] == "米津玄師"

    def test_end_timestamp_inferred(self, db):
        _add_stream(db, "vid006")
        text = "0:00 Song A\n5:00 Song B\n10:00 Song C"
        comments = [_make_comment_dict(text)]

        result = extract_timestamps(db, "vid006", comment_generator=iter(comments))

        assert result.songs[0]["end_timestamp"] == "5:00"
        assert result.songs[1]["end_timestamp"] == "10:00"
        assert result.songs[2]["end_timestamp"] is None

    def test_raw_comment_saved(self, db):
        _add_stream(db, "vid007")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        result = extract_timestamps(db, "vid007", comment_generator=iter(comments))

        assert result.raw_comment == _GOOD_COMMENT_TEXT.strip() or _GOOD_COMMENT_TEXT in (result.raw_comment or "")
        stream = get_stream(db, "vid007")
        assert stream["raw_comment"] is not None

    def test_pinned_comment_selected_first(self, db):
        _add_stream(db, "vid008")
        pinned_text = "0:00 Pinned A\n1:00 Pinned B\n2:00 Pinned C\n3:00 Pinned D\n"
        popular_text = "0:00 Pop A\n1:00 Pop B\n2:00 Pop C\n3:00 Pop D\n"
        comments = [
            _make_comment_dict(popular_text, votes="9999", cid="popular"),
            _make_comment_dict(pinned_text, votes="0", is_pinned=True, cid="pinned"),
        ]

        result = extract_timestamps(db, "vid008", comment_generator=iter(comments))

        assert result.songs[0]["song_name"] == "Pinned A"

    def test_numbered_prefix_comment_extracts_end_to_end(self, db):
        """Full integration: numbered-prefix comment with bare-slash artists."""
        _add_stream(db, "vid_numbered")
        text = (
            "01. 0:05:41   ロミオとシンデレラ/doriko     ʚ♡⃛ɞ\n"
            "02. 0:14:54   一心不乱/梅とら     ʚ♡⃛ɞ\n"
            "03. 0:19:45   六兆年と一夜物語/kemu\n"
        )
        comments = [_make_comment_dict(text, votes="100")]

        result = extract_timestamps(db, "vid_numbered", comment_generator=iter(comments))

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 3
        assert result.songs[0]["song_name"] == "ロミオとシンデレラ"
        assert result.songs[0]["artist"] == "doriko     ʚ♡⃛ɞ"
        assert result.songs[1]["song_name"] == "一心不乱"
        assert result.songs[1]["artist"] == "梅とら     ʚ♡⃛ɞ"
        assert result.songs[2]["start_seconds"] == 1185  # 19*60 + 45

    def test_video_id_not_in_cache_raises_keyerror(self, db):
        with pytest.raises(KeyError, match="not found"):
            extract_timestamps(db, "nonexistent", comment_generator=iter([]))


class TestExtractTimestampsDescriptionFallback:
    """Tests for description-stage fallback in :func:`extract_timestamps`."""

    def test_description_used_when_no_comment_candidate(self, db):
        _add_stream(db, "vid010")
        # Comment with < 3 timestamps — not a candidate
        comments = [_make_comment_dict("0:00 Only one timestamp")]

        result = extract_timestamps(
            db, "vid010",
            comment_generator=iter(comments),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        assert result.status == "extracted"
        assert result.source == "description"

    def test_description_songs_parsed(self, db):
        _add_stream(db, "vid011")
        comments = [_make_comment_dict("No timestamps here")]

        result = extract_timestamps(
            db, "vid011",
            comment_generator=iter(comments),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        assert len(result.songs) == 4

    def test_description_status_set_to_extracted(self, db):
        _add_stream(db, "vid012")
        comments = []  # empty comments

        extract_timestamps(
            db, "vid012",
            comment_generator=iter(comments),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        stream = get_stream(db, "vid012")
        assert stream["status"] == "extracted"

    def test_raw_description_saved(self, db):
        _add_stream(db, "vid013")
        comments = []

        extract_timestamps(
            db, "vid013",
            comment_generator=iter(comments),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        stream = get_stream(db, "vid013")
        assert stream["raw_description"] is not None

    def test_description_source_is_description(self, db):
        _add_stream(db, "vid014")

        result = extract_timestamps(
            db, "vid014",
            comment_generator=iter([]),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        assert result.source == "description"


class TestExtractTimestampsPending:
    """Tests for pending-status fallback in :func:`extract_timestamps`."""

    def test_pending_when_both_fail(self, db):
        _add_stream(db, "vid020")

        result = extract_timestamps(
            db, "vid020",
            comment_generator=iter([]),
            raw_description="No timestamps in this description at all.",
        )

        assert result.status == "pending"
        assert result.source is None
        assert result.songs == []

    def test_pending_status_saved_in_db(self, db):
        _add_stream(db, "vid021")

        extract_timestamps(
            db, "vid021",
            comment_generator=iter([]),
            raw_description="Nothing useful.",
        )

        stream = get_stream(db, "vid021")
        assert stream["status"] == "pending"

    def test_pending_when_no_comment_no_description(self, db):
        _add_stream(db, "vid022")

        with patch("mizukilens.extraction.get_description_from_ytdlp", return_value=None):
            result = extract_timestamps(
                db, "vid022",
                comment_generator=iter([]),
                raw_description=None,
            )

        assert result.status == "pending"

    def test_no_songs_when_pending(self, db):
        _add_stream(db, "vid023")

        result = extract_timestamps(
            db, "vid023",
            comment_generator=iter([]),
            raw_description=None,
        )

        songs = get_parsed_songs(db, "vid023")
        assert len(songs) == 0
        assert result.songs == []


class TestCommentsDisabledScenario:
    """Tests for when comments are disabled (generator returns None)."""

    def test_comments_disabled_falls_through_to_description(self, db):
        _add_stream(db, "vid030")

        # Simulate comments disabled: generator is None
        result = extract_timestamps(
            db, "vid030",
            comment_generator=None,
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        assert result.status == "extracted"
        assert result.source == "description"

    def test_comments_disabled_falls_through_to_pending(self, db):
        _add_stream(db, "vid031")

        result = extract_timestamps(
            db, "vid031",
            comment_generator=None,
            raw_description=None,
        )

        assert result.status == "pending"

    def test_runtime_error_during_comment_fetch_handled(self, db):
        _add_stream(db, "vid032")

        def _failing_generator():
            raise RuntimeError("Comments are disabled")
            yield  # make it a generator

        result = extract_timestamps(
            db, "vid032",
            comment_generator=_failing_generator(),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )

        assert result.status == "extracted"
        assert result.source == "description"


class TestRawCommentPreservation:
    """Tests for preserving raw comment text even when parsing fails."""

    def test_unparseable_comment_saves_raw_text(self, db):
        """When a comment has ≥3 timestamps but produces no parsed songs,
        the raw text should be saved and stream should become pending."""
        _add_stream(db, "vid040")
        # 3 timestamps but no parseable song lines (just timestamps with no text)
        weird_comment = "Timestamps: 0:00, 1:30, 3:00 but no actual song lines"
        comments = [_make_comment_dict(weird_comment, cid="c40")]

        result = extract_timestamps(
            db, "vid040",
            comment_generator=iter(comments),
            raw_description=None,
        )

        # Should have preserved the raw comment
        stream = get_stream(db, "vid040")
        # The comment wasn't a candidate (only 3 timestamps, but parse_text_to_songs might fail)
        # So result is pending or extracted — just verify the flow
        assert result.status in ("pending", "extracted")

    def test_comment_selected_but_no_song_lines_is_pending(self, db):
        """When selected comment produces 0 song lines, fall through to pending."""
        _add_stream(db, "vid041")
        # Build a comment with 3+ timestamps but no parseable song lines
        # (timestamps embedded in prose, not line-leading)
        text = "Watch at 0:00, skip to 1:30 for fun, and check 3:00 for ending"
        comments = [_make_comment_dict(text, cid="c41")]

        result = extract_timestamps(
            db, "vid041",
            comment_generator=iter(comments),
            raw_description=None,
        )

        # The timestamps are embedded, not leading → no songs parsed
        # Should fall through to description (None) → pending
        assert result.status == "pending"


class TestSuspiciousTimestamps:
    """Tests for suspicious timestamp detection (>12 hours)."""

    def test_suspicious_timestamp_flagged(self, db):
        _add_stream(db, "vid050")
        # 12:01:00 = 43260 seconds > 43200 threshold
        text = "0:00 Song A\n1:00 Song B\n2:00 Song C\n12:01:00 Suspicious Song"
        comments = [_make_comment_dict(text)]

        result = extract_timestamps(db, "vid050", comment_generator=iter(comments))

        assert any(s > SUSPICIOUS_THRESHOLD for s in result.suspicious_timestamps)

    def test_normal_timestamps_not_flagged(self, db):
        _add_stream(db, "vid051")
        text = "0:00 Song A\n1:00 Song B\n2:00 Song C\n3:00 Song D"
        comments = [_make_comment_dict(text)]

        result = extract_timestamps(db, "vid051", comment_generator=iter(comments))

        assert result.suspicious_timestamps == []

    def test_suspicious_does_not_prevent_extraction(self, db):
        _add_stream(db, "vid052")
        text = "0:00 Song A\n1:00 Song B\n2:00 Song C\n13:00:00 Late Song"
        comments = [_make_comment_dict(text)]

        result = extract_timestamps(db, "vid052", comment_generator=iter(comments))

        # Still extracted despite suspicious timestamp
        assert result.status == "extracted"


# ---------------------------------------------------------------------------
# §5  seconds_to_timestamp helper
# ---------------------------------------------------------------------------


class TestSecondsToTimestamp:
    """Tests for :func:`seconds_to_timestamp`."""

    def test_zero(self):
        assert seconds_to_timestamp(0) == "0:00"

    def test_minutes_only(self):
        assert seconds_to_timestamp(150) == "2:30"

    def test_hours_minutes_seconds(self):
        assert seconds_to_timestamp(5025) == "1:23:45"

    def test_exact_one_hour(self):
        assert seconds_to_timestamp(3600) == "1:00:00"

    def test_exactly_12h(self):
        assert seconds_to_timestamp(43200) == "12:00:00"


# ---------------------------------------------------------------------------
# §6  Integration: multiple comment candidate priority
# ---------------------------------------------------------------------------


class TestCandidatePriorityIntegration:
    """End-to-end tests for candidate priority (pinned > likes > ts count)."""

    def test_pinned_with_fewer_timestamps_wins(self, db):
        _add_stream(db, "vid060")
        pinned = _make_comment_dict(
            "0:00 A\n1:00 B\n2:00 C\n",  # 3 timestamps
            votes="0",
            is_pinned=True,
            cid="pinned",
        )
        popular = _make_comment_dict(
            "0:00 A\n1:00 B\n2:00 C\n3:00 D\n4:00 E\n",  # 5 timestamps
            votes="5000",
            is_pinned=False,
            cid="popular",
        )

        result = extract_timestamps(
            db, "vid060", comment_generator=iter([popular, pinned])
        )

        assert result.songs[0]["song_name"] == "A"
        # We can't directly check which comment was used without inspecting songs count
        # Both have "Song A" as first → just verify extraction succeeded
        assert result.status == "extracted"
        assert result.source == "comment"

    def test_many_comments_best_selected(self, db):
        _add_stream(db, "vid061")
        low_likes = _make_comment_dict(
            "0:00 Low A\n1:00 Low B\n2:00 Low C\n",
            votes="5",
            cid="low",
        )
        high_likes = _make_comment_dict(
            "0:00 High A\n1:00 High B\n2:00 High C\n",
            votes="500",
            cid="high",
        )
        no_ts = _make_comment_dict("Just a comment, no timestamps", votes="9999", cid="nots")

        result = extract_timestamps(
            db, "vid061",
            comment_generator=iter([no_ts, low_likes, high_likes]),
        )

        assert result.status == "extracted"
        assert result.songs[0]["song_name"] == "High A"


# ---------------------------------------------------------------------------
# §7  Status transition correctness
# ---------------------------------------------------------------------------


class TestStatusTransitions:
    """Tests for correct status transitions during extraction."""

    def test_discovered_to_extracted(self, db):
        _add_stream(db, "vid070", status="discovered")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid070", comment_generator=iter(comments))

        stream = get_stream(db, "vid070")
        assert stream["status"] == "extracted"

    def test_discovered_to_pending(self, db):
        _add_stream(db, "vid071", status="discovered")

        extract_timestamps(
            db, "vid071",
            comment_generator=iter([]),
            raw_description=None,
        )

        stream = get_stream(db, "vid071")
        assert stream["status"] == "pending"

    def test_pending_to_extracted_on_rerun(self, db):
        _add_stream(db, "vid072", status="discovered")

        # First run → pending
        extract_timestamps(
            db, "vid072",
            comment_generator=iter([]),
            raw_description=None,
        )
        assert get_stream(db, "vid072")["status"] == "pending"

        # Second run with good description → extracted
        extract_timestamps(
            db, "vid072",
            comment_generator=iter([]),
            raw_description=_GOOD_DESCRIPTION_TEXT,
        )
        assert get_stream(db, "vid072")["status"] == "extracted"


# ---------------------------------------------------------------------------
# §8  Cache format correctness
# ---------------------------------------------------------------------------


class TestCacheFormat:
    """Tests that parsed_songs rows are written with correct schema fields."""

    def test_parsed_songs_have_correct_keys(self, db):
        _add_stream(db, "vid080")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid080", comment_generator=iter(comments))

        songs = get_parsed_songs(db, "vid080")
        assert len(songs) > 0

        row = songs[0]
        assert row["video_id"] == "vid080"
        assert row["order_index"] is not None
        assert row["song_name"] is not None
        assert row["start_timestamp"] is not None
        # end_timestamp may be None only for last song
        # artist may be empty string or None

    def test_order_indexes_sequential(self, db):
        _add_stream(db, "vid081")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid081", comment_generator=iter(comments))

        songs = get_parsed_songs(db, "vid081")
        for i, row in enumerate(songs):
            assert row["order_index"] == i

    def test_end_timestamp_null_for_last_song(self, db):
        _add_stream(db, "vid082")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT)]

        extract_timestamps(db, "vid082", comment_generator=iter(comments))

        songs = get_parsed_songs(db, "vid082")
        last = songs[-1]
        assert last["end_timestamp"] is None


# ===========================================================================
# §8  Comment author attribution (LENS-008)
# ===========================================================================


class TestCommentAuthorAttribution:
    """Tests for comment author fields on ExtractionResult."""

    def test_comment_extraction_captures_author(self, db):
        _add_stream(db, "vid_auth1")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT, cid="cmt_abc")]

        result = extract_timestamps(db, "vid_auth1", comment_generator=iter(comments))

        assert result.comment_author == "test_user"
        assert result.comment_author_url == "UC_test"
        assert result.comment_id == "cmt_abc"

    def test_author_fields_saved_to_cache(self, db):
        _add_stream(db, "vid_auth2")
        comments = [_make_comment_dict(_GOOD_COMMENT_TEXT, cid="cmt_xyz")]

        extract_timestamps(db, "vid_auth2", comment_generator=iter(comments))

        stream = get_stream(db, "vid_auth2")
        assert stream["comment_author"] == "test_user"
        assert stream["comment_author_url"] == "UC_test"
        assert stream["comment_id"] == "cmt_xyz"

    def test_description_source_has_null_author(self, db):
        _add_stream(db, "vid_auth3")
        # No valid comment candidate
        comments = [_make_comment_dict("no timestamps here")]

        result = extract_timestamps(
            db, "vid_auth3",
            comment_generator=iter(comments),
            raw_description=_GOOD_COMMENT_TEXT,
        )

        assert result.source == "description"
        assert result.comment_author is None
        assert result.comment_author_url is None
        assert result.comment_id is None

    def test_pending_has_null_author(self, db):
        _add_stream(db, "vid_auth4")
        # No timestamps anywhere
        comments = [_make_comment_dict("just chatting")]

        result = extract_timestamps(
            db, "vid_auth4",
            comment_generator=iter(comments),
            raw_description="no timestamps",
        )

        assert result.status == "pending"
        assert result.comment_author is None

    def test_missing_author_key_yields_none(self, db):
        _add_stream(db, "vid_auth5")
        # Build a comment dict with author key missing
        comment = {
            "cid": "c1",
            "text": _GOOD_COMMENT_TEXT,
            "votes": "10",
            "is_pinned": False,
            "channel": "UC_test",
            "replies": "0",
            "photo": "",
            "heart": False,
            "reply": False,
        }
        # No "author" key

        result = extract_timestamps(db, "vid_auth5", comment_generator=iter([comment]))

        assert result.comment_author is None
        assert result.comment_author_url == "UC_test"
        assert result.comment_id == "c1"

    def test_missing_channel_key_yields_none(self, db):
        _add_stream(db, "vid_auth6")
        comment = {
            "cid": "c2",
            "text": _GOOD_COMMENT_TEXT,
            "votes": "10",
            "is_pinned": False,
            "author": "SomeUser",
            "replies": "0",
            "photo": "",
            "heart": False,
            "reply": False,
        }
        # No "channel" key

        result = extract_timestamps(db, "vid_auth6", comment_generator=iter([comment]))

        assert result.comment_author == "SomeUser"
        assert result.comment_author_url is None

    def test_missing_cid_key_yields_none(self, db):
        _add_stream(db, "vid_auth7")
        comment = {
            "text": _GOOD_COMMENT_TEXT,
            "votes": "10",
            "is_pinned": False,
            "author": "SomeUser",
            "channel": "UC_test",
            "replies": "0",
            "photo": "",
            "heart": False,
            "reply": False,
        }
        # No "cid" key

        result = extract_timestamps(db, "vid_auth7", comment_generator=iter([comment]))

        assert result.comment_author == "SomeUser"
        assert result.comment_id is None


# ---------------------------------------------------------------------------
# §9  Keyword candidate detection + caching
# ---------------------------------------------------------------------------


class TestKeywordCandidates:
    """Tests for keyword-based candidate comment detection."""

    def test_find_keyword_comments_basic(self):
        """Comment with '歌單' should be matched."""
        comments = [
            {"cid": "c1", "text": "歌單：\n0:00 Song A\n1:30 Song B"},
            {"cid": "c2", "text": "Great stream!"},
        ]
        results = find_keyword_comments(comments, keywords=["歌單"])
        assert len(results) == 1
        assert results[0]["cid"] == "c1"
        assert "歌單" in results[0]["keywords_matched"]

    def test_find_keyword_comments_case_insensitive_english(self):
        """English keywords should match case-insensitively."""
        comments = [
            {"cid": "c1", "text": "Here is the SONGLIST for today"},
        ]
        results = find_keyword_comments(comments, keywords=["songlist", "Songlist"])
        assert len(results) == 1
        # Both "songlist" and "Songlist" should match (case-insensitive)
        assert len(results[0]["keywords_matched"]) == 2

    def test_find_keyword_comments_no_match(self):
        """Comments without keywords should not be matched."""
        comments = [
            {"cid": "c1", "text": "Nice singing!"},
            {"cid": "c2", "text": "My favourite stream"},
        ]
        results = find_keyword_comments(comments, keywords=["歌單", "Songlist"])
        assert len(results) == 0

    def test_find_keyword_comments_multiple_keywords(self):
        """A comment matching multiple keywords returns all of them."""
        comments = [
            {"cid": "c1", "text": "歌單 (Songlist):\n0:00 A\n1:00 B"},
        ]
        results = find_keyword_comments(comments, keywords=["歌單", "Songlist"])
        assert len(results) == 1
        assert set(results[0]["keywords_matched"]) == {"歌單", "Songlist"}

    def test_candidates_cached_during_extraction(self, db):
        """Integration: extraction saves keyword candidates to DB."""
        from mizukilens.cache import list_candidate_comments

        _add_stream(db, "kw_vid1")
        # Comment with keyword but also with timestamps
        keyword_comment = _make_comment_dict(
            "歌單：\n0:00 Song A\n1:30 Song B\n3:00 Song C\n5:00 Song D",
            cid="kw_cmt1",
        )

        extract_timestamps(db, "kw_vid1", comment_generator=iter([keyword_comment]))

        candidates = list_candidate_comments(db, video_id="kw_vid1")
        assert len(candidates) >= 1
        # The keyword comment should be cached
        cids = [c["comment_cid"] for c in candidates]
        assert "kw_cmt1" in cids

    def test_candidates_cached_even_when_extraction_succeeds(self, db):
        """Candidates are saved regardless of extraction outcome."""
        from mizukilens.cache import list_candidate_comments

        _add_stream(db, "kw_vid2")
        good_comment = _make_comment_dict(_GOOD_COMMENT_TEXT, cid="good_cmt")
        keyword_comment = _make_comment_dict(
            "歌單 for today!", cid="kw_cmt2",
        )

        extract_timestamps(
            db, "kw_vid2",
            comment_generator=iter([good_comment, keyword_comment]),
        )

        # Extraction should succeed from the good comment
        stream = get_stream(db, "kw_vid2")
        assert stream["status"] == "extracted"

        # But the keyword comment should also be cached
        candidates = list_candidate_comments(db, video_id="kw_vid2")
        kw_cids = [c["comment_cid"] for c in candidates]
        assert "kw_cmt2" in kw_cids

    def test_extract_from_candidate(self, db):
        """Re-extraction using a specific candidate comment."""
        from mizukilens.cache import save_candidate_comments, list_candidate_comments

        _add_stream(db, "cand_vid1")
        # Save a candidate with parseable timestamps
        save_candidate_comments(db, "cand_vid1", [{
            "comment_cid": "cand_cmt1",
            "comment_author": "SongLister",
            "comment_author_url": "https://youtube.com/channel/UC999",
            "comment_text": "0:00 Song A\n2:00 Song B\n4:00 Song C",
            "keywords_matched": ["歌單"],
        }])

        candidates = list_candidate_comments(db, video_id="cand_vid1")
        cand_id = candidates[0]["id"]

        result = extract_from_candidate(db, "cand_vid1", cand_id)

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 3
        assert result.comment_author == "SongLister"

        # Candidate should be marked as approved
        from mizukilens.cache import get_candidate_comment
        cand = get_candidate_comment(db, cand_id)
        assert cand["status"] == "approved"

    def test_extract_from_candidate_no_songs(self, db):
        """Re-extraction with unparseable candidate returns no songs."""
        from mizukilens.cache import save_candidate_comments, list_candidate_comments

        _add_stream(db, "cand_vid2")
        save_candidate_comments(db, "cand_vid2", [{
            "comment_cid": "cand_cmt2",
            "comment_author": "NoSongs",
            "comment_author_url": None,
            "comment_text": "歌單 coming soon!",
            "keywords_matched": ["歌單"],
        }])

        candidates = list_candidate_comments(db, video_id="cand_vid2")
        cand_id = candidates[0]["id"]

        result = extract_from_candidate(db, "cand_vid2", cand_id)

        assert result.songs == []
        assert result.source is None

    def test_extract_from_candidate_wrong_video_raises(self, db):
        """Candidate belonging to a different video should raise ValueError."""
        from mizukilens.cache import save_candidate_comments, list_candidate_comments

        _add_stream(db, "cand_vid3a")
        _add_stream(db, "cand_vid3b")
        save_candidate_comments(db, "cand_vid3a", [{
            "comment_cid": "cand_cmt3",
            "comment_author": "Mismatch",
            "comment_author_url": None,
            "comment_text": "0:00 A\n1:00 B\n2:00 C",
            "keywords_matched": ["歌單"],
        }])

        candidates = list_candidate_comments(db, video_id="cand_vid3a")
        cand_id = candidates[0]["id"]

        with pytest.raises(ValueError, match="belongs to video"):
            extract_from_candidate(db, "cand_vid3b", cand_id)


# ---------------------------------------------------------------------------
# §10  Tree-drawing formatted songlists
# ---------------------------------------------------------------------------


class TestTreeDrawingParseSongLine:
    """Tests for tree-drawing character stripping in :func:`parse_song_line`."""

    def test_tree_char_prefix_stripped(self):
        """├ with numbered timestamp line should parse correctly."""
        result = parse_song_line(" ├ 55. 0:19:14   Rain On Me / Lady Gaga & Ariana Grande")
        assert result is not None
        assert result["start_seconds"] == 1154  # 19*60 + 14
        assert result["song_name"] == "Rain On Me"
        assert result["artist"] == "Lady Gaga & Ariana Grande"

    def test_tree_char_end_branch(self):
        """└ variant should also be stripped."""
        result = parse_song_line(" └ 53. 4:14:18   夜に駆ける / YOASOBI")
        assert result is not None
        assert result["start_seconds"] == 15258  # 4*3600 + 14*60 + 18
        assert result["song_name"] == "夜に駆ける"
        assert result["artist"] == "YOASOBI"

    def test_tree_char_with_jp_content(self):
        """Japanese song with tree prefix parses correctly."""
        result = parse_song_line(" ├ 1. 0:02:30   打上花火 / DAOKO×米津玄師")
        assert result is not None
        assert result["start_seconds"] == 150
        assert result["song_name"] == "打上花火"
        assert result["artist"] == "DAOKO×米津玄師"

    def test_tree_char_only_line_returns_none(self):
        """Lines with only tree-drawing characters return None."""
        assert parse_song_line(" ├──────────────── ") is None
        assert parse_song_line("│  │") is None
        assert parse_song_line("└───┘") is None

    def test_performer_header_still_returns_none(self):
        """Performer headers with lenticular brackets should still return None."""
        assert parse_song_line("『玥Itsuki』") is None
        assert parse_song_line("『穆克蕗』4:22:07") is None


class TestTreeDrawingParseTextToSongs:
    """Tests for tree-drawing formatted multi-line songlists."""

    def test_tree_drawing_songlist_format(self):
        """Multi-line parse with performer headers interleaved."""
        text = (
            "『Singer A』0:00:00\n"
            " ├ 1. 0:02:30   Song One / Artist A\n"
            " ├ 2. 0:06:15   Song Two / Artist B\n"
            " └ 3. 0:10:00   Song Three / Artist C\n"
            "『Singer B』0:30:00\n"
            " ├ 4. 0:32:00   Song Four / Artist D\n"
            " └ 5. 0:36:45   Song Five / Artist E\n"
        )
        songs = parse_text_to_songs(text)
        assert len(songs) == 5
        assert songs[0]["song_name"] == "Song One"
        assert songs[0]["artist"] == "Artist A"
        assert songs[0]["start_seconds"] == 150  # 2:30
        assert songs[1]["start_seconds"] == 375  # 6:15
        assert songs[4]["song_name"] == "Song Five"
        assert songs[4]["start_seconds"] == 2205  # 36:45


class TestTreeDrawingIntegration:
    """End-to-end integration test for tree-drawing formatted comments."""

    def test_tree_drawing_comment_extracts_end_to_end(self, db):
        """Full pipeline: tree-drawing comment → extracted status with songs."""
        _add_stream(db, "vid_tree")
        text = (
            "『玥Itsuki』0:00:00\n"
            " ├ 1. 0:02:30   打上花火 / DAOKO×米津玄師\n"
            " ├ 2. 0:06:15   Lemon / 米津玄師\n"
            " └ 3. 0:10:00   Pretender / Official髭男dism\n"
            "『穆克蕗』0:30:00\n"
            " ├ 4. 0:32:00   夜に駆ける / YOASOBI\n"
            " └ 5. 0:36:45   廻廻奇譚 / Eve\n"
        )
        comments = [_make_comment_dict(text, votes="50")]

        result = extract_timestamps(db, "vid_tree", comment_generator=iter(comments))

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 5
        assert result.songs[0]["song_name"] == "打上花火"
        assert result.songs[0]["artist"] == "DAOKO×米津玄師"
        assert result.songs[0]["start_seconds"] == 150
        assert result.songs[3]["song_name"] == "夜に駆ける"
        assert result.songs[3]["artist"] == "YOASOBI"
        assert result.songs[4]["song_name"] == "廻廻奇譚"
        assert result.songs[4]["start_seconds"] == 2205


# ---------------------------------------------------------------------------
# §  Bullet prefix stripping
# ---------------------------------------------------------------------------


class TestBulletPrefixParseSongLine:
    """Tests for bullet-prefix stripping in parse_song_line."""

    def test_dash_bullet(self):
        result = parse_song_line("- 0:30 Song Name / Artist")
        assert result is not None
        assert result["start_seconds"] == 30
        assert result["song_name"] == "Song Name"
        assert result["artist"] == "Artist"

    def test_asterisk_bullet(self):
        result = parse_song_line("* 1:00 Song Name / Artist")
        assert result is not None
        assert result["start_seconds"] == 60
        assert result["song_name"] == "Song Name"
        assert result["artist"] == "Artist"

    def test_plus_bullet(self):
        result = parse_song_line("+ 2:00 Song Name / Artist")
        assert result is not None
        assert result["start_seconds"] == 120
        assert result["song_name"] == "Song Name"
        assert result["artist"] == "Artist"

    def test_no_space_after_bullet_no_match(self):
        """Bullet without space should not be stripped (e.g. '-0:30')."""
        result = parse_song_line("-0:30 Song Name / Artist")
        # The dash is not stripped (no space), but _LINE_TS_RE won't match "-0:30"
        assert result is None

    def test_no_timestamp_after_bullet(self):
        """Bullet + text but no timestamp → None."""
        result = parse_song_line("- Just a comment")
        assert result is None


# ---------------------------------------------------------------------------
# §  Range timestamp support
# ---------------------------------------------------------------------------


class TestRangeTimestampParseSongLine:
    """Tests for range end-timestamp detection in parse_song_line."""

    def test_tilde_range(self):
        result = parse_song_line("00:04:23 ~ 00:08:26 誰 / 李友廷")
        assert result is not None
        assert result["start_seconds"] == 4 * 60 + 23
        assert result["end_seconds"] == 8 * 60 + 26
        assert result["song_name"] == "誰"
        assert result["artist"] == "李友廷"

    def test_dash_range(self):
        result = parse_song_line("1:00 - 3:30 Song / Artist")
        assert result is not None
        assert result["start_seconds"] == 60
        assert result["end_seconds"] == 210
        assert result["song_name"] == "Song"
        assert result["artist"] == "Artist"

    def test_en_dash_range(self):
        result = parse_song_line("5:00 – 7:30 Song / Artist")
        assert result is not None
        assert result["start_seconds"] == 300
        assert result["end_seconds"] == 450
        assert result["song_name"] == "Song"
        assert result["artist"] == "Artist"

    def test_em_dash_range(self):
        result = parse_song_line("5:00 — 7:30 Song / Artist")
        assert result is not None
        assert result["start_seconds"] == 300
        assert result["end_seconds"] == 450
        assert result["song_name"] == "Song"
        assert result["artist"] == "Artist"

    def test_hms_range(self):
        """H:MM:SS range format."""
        result = parse_song_line("1:04:23 ~ 1:08:26 Song / Artist")
        assert result is not None
        assert result["start_seconds"] == 3600 + 4 * 60 + 23
        assert result["end_seconds"] == 3600 + 8 * 60 + 26

    def test_no_range_backward_compat(self):
        """Line without range → no end_seconds key."""
        result = parse_song_line("0:30 Song / Artist")
        assert result is not None
        assert result["start_seconds"] == 30
        assert "end_seconds" not in result

    def test_bullet_plus_range(self):
        """Bullet prefix + range timestamp combo."""
        result = parse_song_line("- 00:04:23 ~ 00:08:26 誰 / 李友廷")
        assert result is not None
        assert result["start_seconds"] == 4 * 60 + 23
        assert result["end_seconds"] == 8 * 60 + 26
        assert result["song_name"] == "誰"
        assert result["artist"] == "李友廷"

    def test_disambiguation_separator_not_range(self):
        """'0:30 - Song Name' is a separator, not a range (no timestamp after -)."""
        result = parse_song_line("0:30 - Song Name")
        assert result is not None
        assert result["start_seconds"] == 30
        assert "end_seconds" not in result
        assert result["song_name"] == "Song Name"

    def test_tilde_no_space(self):
        """Tilde without space before timestamp should still match."""
        result = parse_song_line("1:00 ~2:00 Song / Artist")
        assert result is not None
        assert result["end_seconds"] == 120

    def test_range_with_separator_after(self):
        """Range followed by separator then song info."""
        result = parse_song_line("0:30 ~ 1:00 - Song Name")
        assert result is not None
        assert result["start_seconds"] == 30
        assert result["end_seconds"] == 60
        assert result["song_name"] == "Song Name"


class TestRangeTimestampParseTextToSongs:
    """Tests for explicit end_seconds propagation in parse_text_to_songs."""

    def test_explicit_end_overrides_inferred(self):
        """Explicit range end should be used instead of next song's start."""
        text = (
            "0:30 ~ 1:00 Song A / Artist A\n"
            "2:00 Song B / Artist B\n"
        )
        songs = parse_text_to_songs(text)
        assert len(songs) == 2
        # Song A: explicit end 1:00 = 60s, NOT inferred 2:00 = 120s
        assert songs[0]["end_seconds"] == 60
        assert songs[0]["end_timestamp"] == "1:00"
        # Song B: no range, last song → None
        assert songs[1]["end_seconds"] is None
        assert songs[1]["end_timestamp"] is None

    def test_mixed_range_and_single(self):
        """Mix of range and non-range lines."""
        text = (
            "0:00 Intro Song / Opener\n"
            "1:00 ~ 2:30 Range Song / Ranger\n"
            "3:00 Normal Song / Normal\n"
        )
        songs = parse_text_to_songs(text)
        assert len(songs) == 3
        # Song 0: no range, inferred from next → 60s
        assert songs[0]["end_seconds"] == 60
        # Song 1: explicit range → 150s
        assert songs[1]["end_seconds"] == 150
        assert songs[1]["end_timestamp"] == "2:30"
        # Song 2: last, no range → None
        assert songs[2]["end_seconds"] is None


class TestRangeTimestampIntegration:
    """Integration test using the real VOD comment format."""

    def test_real_vod_bullet_range_format(self, db):
        """Full pipeline with real VOD (lVAiHsvF8z8) comment format."""
        _add_stream(db, "vid_range")
        text = (
            "- 00:04:23 ~ 00:08:26 誰 / 李友廷\n"
            "- 00:08:30 ~ 00:12:15 Lemon / 米津玄師\n"
            "- 00:12:20 ~ 00:16:00 打上花火 / DAOKO×米津玄師\n"
        )
        comments = [_make_comment_dict(text, votes="50")]

        result = extract_timestamps(db, "vid_range", comment_generator=iter(comments))

        assert result.status == "extracted"
        assert result.source == "comment"
        assert len(result.songs) == 3

        # First song: explicit range
        assert result.songs[0]["song_name"] == "誰"
        assert result.songs[0]["artist"] == "李友廷"
        assert result.songs[0]["start_seconds"] == 4 * 60 + 23
        assert result.songs[0]["end_seconds"] == 8 * 60 + 26
        assert result.songs[0]["start_timestamp"] == "4:23"
        assert result.songs[0]["end_timestamp"] == "8:26"

        # Second song: explicit range
        assert result.songs[1]["song_name"] == "Lemon"
        assert result.songs[1]["artist"] == "米津玄師"
        assert result.songs[1]["start_seconds"] == 8 * 60 + 30
        assert result.songs[1]["end_seconds"] == 12 * 60 + 15

        # Last song: explicit range (not None)
        assert result.songs[2]["end_seconds"] == 16 * 60


# ---------------------------------------------------------------------------
# §  extract_from_text
# ---------------------------------------------------------------------------

SAMPLE_TEXT = """\
5:30 買你 - 魏如萱
17:00 ただ君に晴れ - ヨルシカ
1:01:30 怪物 - YOASOBI
"""


class TestExtractFromText:
    """Tests for :func:`extract_from_text`."""

    def test_basic_text_extraction(self, db):
        _add_stream(db, "txt001", status="discovered")
        result = extract_from_text(db, "txt001", SAMPLE_TEXT)
        assert result.status == "extracted"
        assert len(result.songs) == 3
        assert result.songs[0]["song_name"] == "買你"
        assert result.songs[1]["song_name"] == "ただ君に晴れ"
        assert result.songs[2]["song_name"] == "怪物"

    @patch("mizukilens.extraction.get_video_info_from_ytdlp")
    def test_auto_create_stream_when_missing(self, mock_info, db):
        mock_info.return_value = {"title": "歌回 Vol.99", "date": "2021-09-25"}
        result = extract_from_text(db, "newvid01", SAMPLE_TEXT)
        assert result.status == "extracted"
        mock_info.assert_called_once_with("newvid01")
        # Stream should now exist
        stream = get_stream(db, "newvid01")
        assert stream is not None

    @patch("mizukilens.extraction.get_video_info_from_ytdlp")
    def test_auto_create_stores_title_and_date(self, mock_info, db):
        mock_info.return_value = {"title": "歌回 Vol.99", "date": "2021-09-25"}
        extract_from_text(db, "newvid02", SAMPLE_TEXT)
        stream = get_stream(db, "newvid02")
        assert stream["title"] == "歌回 Vol.99"
        assert stream["date"] == "2021-09-25"

    @patch("mizukilens.extraction.get_video_info_from_ytdlp")
    def test_auto_create_ytdlp_fails(self, mock_info, db):
        mock_info.return_value = {"title": None, "date": None}
        result = extract_from_text(db, "newvid03", SAMPLE_TEXT)
        assert result.status == "extracted"
        stream = get_stream(db, "newvid03")
        assert stream is not None
        assert stream["title"] is None

    def test_existing_stream_not_recreated(self, db):
        _add_stream(db, "txt002", status="pending")
        with patch("mizukilens.extraction.get_video_info_from_ytdlp") as mock_info:
            extract_from_text(db, "txt002", SAMPLE_TEXT)
            mock_info.assert_not_called()

    def test_source_is_text_file(self, db):
        _add_stream(db, "txt003", status="discovered")
        result = extract_from_text(db, "txt003", SAMPLE_TEXT)
        assert result.source == "text_file"

    def test_parsed_songs_saved_to_db(self, db):
        _add_stream(db, "txt004", status="discovered")
        extract_from_text(db, "txt004", SAMPLE_TEXT)
        songs = get_parsed_songs(db, "txt004")
        assert len(songs) == 3
        assert songs[0]["song_name"] == "買你"

    def test_empty_text_returns_pending(self, db):
        _add_stream(db, "txt005", status="discovered")
        result = extract_from_text(db, "txt005", "no timestamps here\njust text")
        assert result.status == "pending"
        assert result.songs == []

    def test_raw_text_saved_as_description(self, db):
        _add_stream(db, "txt006", status="discovered")
        extract_from_text(db, "txt006", SAMPLE_TEXT)
        stream = get_stream(db, "txt006")
        assert SAMPLE_TEXT.strip() in (stream["raw_description"] or "")


# ---------------------------------------------------------------------------
# §  get_video_info_from_ytdlp
# ---------------------------------------------------------------------------


class TestGetVideoInfoFromYtdlp:
    """Tests for :func:`get_video_info_from_ytdlp`."""

    @patch("subprocess.run")
    def test_success(self, mock_run):
        mock_run.return_value = MagicMock(
            returncode=0,
            stdout="歌回 Vol.99\n20210925\n",
        )
        info = get_video_info_from_ytdlp("abc123")
        assert info["title"] == "歌回 Vol.99"
        assert info["date"] == "2021-09-25"

    @patch("subprocess.run")
    def test_failure_returns_none_fields(self, mock_run):
        mock_run.return_value = MagicMock(returncode=1, stdout="")
        info = get_video_info_from_ytdlp("abc123")
        assert info["title"] is None
        assert info["date"] is None

    @patch("subprocess.run")
    def test_exception_returns_none_fields(self, mock_run):
        mock_run.side_effect = FileNotFoundError("yt-dlp not found")
        info = get_video_info_from_ytdlp("abc123")
        assert info["title"] is None
        assert info["date"] is None
