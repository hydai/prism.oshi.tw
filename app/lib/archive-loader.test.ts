import assert from "node:assert/strict";
import { loadArchiveData } from "./archive-loader";
import type { StreamSummary } from "../types/archive";

// Slim stored format — performances carry no streamTitle/date (derived from
// streams.json at load time) and omit empty notes.
const slimSongs = [
  {
    id: "song-a",
    title: "Alpha",
    originalArtist: "Artist A",
    inheritedTags: ["genre:rock"],
    tags: ["genre:rock"],
    performances: [
      { id: "p-new", streamId: "s-new", videoId: "v2", timestamp: 30, endTimestamp: 90 },
      { id: "p-old", streamId: "s-old", videoId: "v1", timestamp: 10, endTimestamp: null, note: "encore" },
    ],
  },
  {
    id: "song-b",
    title: "Beta",
    originalArtist: "Artist B",
    tags: ["legacy-tag"],
    performances: [
      { id: "p-orphan", streamId: "s-gone", videoId: "v3", timestamp: 0, endTimestamp: null },
    ],
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
  // fires songs and streams together, and no longer requests metadata
  {
    const requested: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const gatedFetch = ((input: RequestInfo | URL) => {
      requested.push(String(input));
      return gate.then(() => ({ ok: true, json: () => Promise.resolve([]) } as Response));
    }) as typeof fetch;

    const pending = loadArchiveData("mizuki", gatedFetch);
    assert.equal(requested.length, 2, "exactly two requests should start together");
    assert.ok(requested.some((u) => u.endsWith("/api/mizuki/songs")));
    assert.ok(requested.some((u) => u.endsWith("/api/mizuki/streams")));
    assert.ok(!requested.some((u) => u.includes("metadata")), "metadata request was removed");
    release();
    await pending.catch(() => undefined);
  }

  // hydrates streamTitle/date from streams by streamId; empty note defaults
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: slimSongs },
      "/api/mizuki/streams": { body: baseStreams },
    });
    const { songs } = await loadArchiveData("mizuki", fetchImpl);
    const [pNew, pOld] = songs.find((s) => s.id === "song-a")!.performances;
    assert.equal(pNew.streamTitle, "New stream");
    assert.equal(pNew.date, "2025-06-01");
    assert.equal(pNew.note, "");
    assert.deepEqual(pNew.inheritedTags, ["genre:rock"]);
    assert.equal(pOld.streamTitle, "Old stream");
    assert.equal(pOld.date, "2023-01-01");
    assert.equal(pOld.note, "encore");
    assert.deepEqual(pOld.inheritedTags, ["genre:rock"]);
  }

  // a performance whose stream is missing keeps a deterministic fallback
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: slimSongs },
      "/api/mizuki/streams": { body: baseStreams },
    });
    const { songs } = await loadArchiveData("mizuki", fetchImpl);
    const orphan = songs.find((s) => s.id === "song-b")!.performances[0];
    assert.equal(orphan.streamTitle, "");
    assert.equal(orphan.date, "1970-01-01");
    assert.deepEqual(orphan.inheritedTags, ["legacy-tag"]);
  }

  // streams are sorted newest first
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: [] },
      "/api/mizuki/streams": { body: baseStreams },
    });
    const { streams } = await loadArchiveData("mizuki", fetchImpl);
    assert.deepEqual(streams.map((s) => s.id), ["s-new", "s-old"]);
  }

  // songs failure rejects
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { reject: true },
      "/api/mizuki/streams": { body: [] },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { ok: false, body: null },
      "/api/mizuki/streams": { body: [] },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }

  // streams failure now rejects too — hydration cannot proceed without it
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: slimSongs },
      "/api/mizuki/streams": { reject: true },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }
  {
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: slimSongs },
      "/api/mizuki/streams": { ok: false, body: null },
    });
    await assert.rejects(() => loadArchiveData("mizuki", fetchImpl));
  }

  // forwards the abort signal to both requests
  {
    const requested: string[] = [];
    const signals: (AbortSignal | undefined)[] = [];
    const controller = new AbortController();
    const fetchImpl = makeFetch(
      {
        "/api/mizuki/songs": { body: [] },
        "/api/mizuki/streams": { body: [] },
      },
      requested,
      signals,
    );
    await loadArchiveData("mizuki", fetchImpl, controller.signal);
    assert.equal(signals.length, 2);
    assert.ok(signals.every((s) => s === controller.signal), "every request should carry the caller's signal");
  }

  console.log("archive-loader tests passed");
  // song.tags is no longer serialized: the exporter omits the derivable union and every
  // empty tag array, so hydration has to rebuild the effective set from what is on the
  // wire. Without this a tagged archive loads with every song untagged.
  {
    const slimmed = [
      {
        id: "song-slim",
        title: "Slim",
        originalArtist: "Artist S",
        inheritedTags: ["genre:rock"],
        performances: [
          { id: "p-slim", streamId: "s-new", videoId: "v9", timestamp: 5, endTimestamp: null, tags: ["language:zh"] },
        ],
      },
      {
        id: "song-untagged",
        title: "Untagged",
        originalArtist: "Artist U",
        performances: [
          { id: "p-untagged", streamId: "s-new", videoId: "v10", timestamp: 6, endTimestamp: null },
        ],
      },
    ];
    const fetchImpl = makeFetch({
      "/api/mizuki/songs": { body: slimmed },
      "/api/mizuki/streams": { body: baseStreams },
    });
    const { songs } = await loadArchiveData("mizuki", fetchImpl);

    const slim = songs.find((s) => s.id === "song-slim")!;
    assert.deepEqual(
      slim.tags,
      ["language:zh", "genre:rock"],
      "the effective union is rebuilt from inheritedTags plus rendition tags",
    );
    assert.deepEqual(slim.inheritedTags, ["genre:rock"]);
    assert.deepEqual(slim.performances[0].tags, ["language:zh"]);

    const untagged = songs.find((s) => s.id === "song-untagged")!;
    assert.deepEqual(untagged.tags, [], "an entirely untagged song hydrates to empty arrays");
    assert.deepEqual(untagged.inheritedTags, []);
    assert.deepEqual(untagged.performances[0].tags, []);
  }

}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
