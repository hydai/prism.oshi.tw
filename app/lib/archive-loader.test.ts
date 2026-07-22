import assert from "node:assert/strict";
import { loadArchiveData } from "./archive-loader";
import type { ArchiveSong, StreamSummary } from "../types/archive";

const baseSongs: ArchiveSong[] = [
  {
    id: "song-a",
    title: "Alpha",
    originalArtist: "Artist A",
    tags: [],
    performances: [],
  },
  {
    id: "song-b",
    title: "Beta",
    originalArtist: "Artist B",
    tags: [],
    performances: [],
  },
];

const baseStreams: StreamSummary[] = [
  { id: "s-old", title: "Old stream", date: "2023-01-01", videoId: "v1" },
  { id: "s-new", title: "New stream", date: "2025-06-01", videoId: "v2" },
];

interface FakeRoute {
  ok?: boolean;
  body?: unknown;
  reject?: boolean;
}

function makeFetch(routes: Record<string, FakeRoute>, requested: string[] = [], signals: (AbortSignal | undefined)[] = []) {
  return ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    requested.push(url);
    signals.push(init?.signal ?? undefined);
    const route = Object.entries(routes).find(([suffix]) => url.endsWith(suffix))?.[1];
    if (!route) return Promise.reject(new Error(`no route for ${url}`));
    if (route.reject) return Promise.reject(new Error("network down"));
    return Promise.resolve({
      ok: route.ok ?? true,
      json: () => Promise.resolve(route.body),
    } as Response);
  }) as typeof fetch;
}

async function run() {
  // fires all three requests in the same tick (no waterfall)
  {
    const requested: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedFetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return gate.then(() => ({ ok: true, json: () => Promise.resolve([]) } as Response));
    }) as typeof fetch;

    const pending = loadArchiveData("mizuki", gatedFetch);
    assert.equal(requested.length, 3, "all three requests should start before any response resolves");
    assert.ok(requested.some((u) => u.endsWith("/api/mizuki/songs")));
    assert.ok(requested.some((u) => u.endsWith("/api/mizuki/metadata")));
    assert.ok(requested.some((u) => u.endsWith("/api/mizuki/streams")));
    release();
    await pending.catch(() => undefined);
  }

  // merges album art from metadata into songs (albumArtUrl and albumArtUrls.small)
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: baseSongs },
      "/api/mizuki/metadata": {
        body: {
          songMetadata: [
            { songId: "song-a", albumArtUrl: "art-a" },
            { songId: "song-b", albumArtUrls: { small: "art-b-small" } },
          ],
          artistInfo: [],
        },
      },
      "/api/mizuki/streams": { body: [] },
    });
    const result = await loadArchiveData("mizuki", fetchImpl);
    assert.equal(result.songs[0].albumArtUrl, "art-a");
    assert.equal(result.songs[1].albumArtUrl, "art-b-small");
  }

  // songs still load when the metadata request fails
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: baseSongs },
      "/api/mizuki/metadata": { reject: true },
      "/api/mizuki/streams": { body: [] },
    });
    const result = await loadArchiveData("mizuki", fetchImpl);
    assert.equal(result.songs.length, 2);
    assert.equal(result.songs[0].albumArtUrl, undefined);
  }

  // songs still load when the metadata response is not ok
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: baseSongs },
      "/api/mizuki/metadata": { ok: false, body: null },
      "/api/mizuki/streams": { body: [] },
    });
    const result = await loadArchiveData("mizuki", fetchImpl);
    assert.equal(result.songs.length, 2);
  }

  // streams degrade to empty on failure
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: baseSongs },
      "/api/mizuki/metadata": { body: { songMetadata: [], artistInfo: [] } },
      "/api/mizuki/streams": { reject: true },
    });
    const result = await loadArchiveData("mizuki", fetchImpl);
    assert.deepEqual(result.streams, []);
  }

  // streams are sorted newest first
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: [] },
      "/api/mizuki/metadata": { body: { songMetadata: [], artistInfo: [] } },
      "/api/mizuki/streams": { body: baseStreams },
    });
    const result = await loadArchiveData("mizuki", fetchImpl);
    assert.deepEqual(result.streams.map((s) => s.id), ["s-new", "s-old"]);
  }

  // rejects when the songs request fails
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { reject: true },
      "/api/mizuki/metadata": { body: { songMetadata: [], artistInfo: [] } },
      "/api/mizuki/streams": { body: [] },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }

  // rejects when the songs response is not ok
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { ok: false, body: null },
      "/api/mizuki/metadata": { body: { songMetadata: [], artistInfo: [] } },
      "/api/mizuki/streams": { body: [] },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }

  // forwards the abort signal to every request
  {
    const requested: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const fetchImpl = makeFetch(
      {
        "/api/mizuki/songs": { body: [] },
        "/api/mizuki/metadata": { body: { songMetadata: [], artistInfo: [] } },
        "/api/mizuki/streams": { body: [] },
      },
      requested,
      signals,
    );
    await loadArchiveData("mizuki", fetchImpl, controller.signal);
    assert.equal(signals.length, 3);
    assert.ok(signals.every((s) => s === controller.signal), "every request should carry the caller's signal");
  }

  console.log("archive-loader tests passed");
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
