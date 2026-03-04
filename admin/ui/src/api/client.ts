import type {
  AuthUser,
  Song,
  Stream,
  ListResponse,
  PaginatedResponse,
  DashboardStats,
  CreateSongBody,
  UpdateSongBody,
  CreateStreamBody,
  Status,
  StatusUpdateBody,
  StampPerformance,
  StreamWithPending,
  StampStats,
  FetchDurationResponse,
  CreateStampPerformanceBody,
  UpdateTimestampsBody,
  UpdateSongDetailsBody,
  PasteImportBody,
  PasteImportResponse,
  StreamDetail,
  DiscoverStreamsResponse,
  ImportStreamsBody,
  ImportStreamsResponse,
  ExtractResponse,
  ExtractImportBody,
  ExtractImportResponse,
  BulkApproveResponse,
  NovaSubmission,
  NovaStatus,
  NovaVodSubmission,
  NovaVodSong,
  StreamerInfo,
  CrystalTicket,
  CrystalTicketStatus,
} from '../../../shared/types';

// --- Streamer selection (module-level) ---

const STREAMER_STORAGE_KEY = 'prism_admin_streamer';

let _currentStreamer = localStorage.getItem(STREAMER_STORAGE_KEY) || 'mizuki';
const _listeners = new Set<(s: string) => void>();

export function getCurrentStreamer(): string {
  return _currentStreamer;
}

export function setCurrentStreamer(slug: string): void {
  _currentStreamer = slug;
  localStorage.setItem(STREAMER_STORAGE_KEY, slug);
  _listeners.forEach((fn) => fn(slug));
}

export function onStreamerChange(fn: (s: string) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

// --- API client ---

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Inject ?streamer= into all /api/ paths */
function withStreamer(path: string): string {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}streamer=${encodeURIComponent(_currentStreamer)}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = path.startsWith('/api/') ? withStreamer(path) : path;
  const res = await fetch(url, {
    ...init,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...init?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    // Try to extract JSON error message
    let message = body || res.statusText;
    try {
      const json = JSON.parse(body);
      if (json.error) message = json.error;
    } catch {
      // Use raw body
    }
    throw new ApiError(res.status, message);
  }

  return res.json() as Promise<T>;
}

export const api = {
  // Auth
  me: () => request<AuthUser>('/api/me'),

  // Streamers
  listStreamers: () => request<{ data: StreamerInfo[] }>('/api/streamers'),

  // Dashboard
  stats: () => request<DashboardStats>('/api/stats'),

  // Songs
  listSongs: (params?: {
    status?: string;
    search?: string;
    page?: number;
    pageSize?: number;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
  }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.search) sp.set('search', params.search);
    if (params?.page) sp.set('page', String(params.page));
    if (params?.pageSize) sp.set('pageSize', String(params.pageSize));
    if (params?.sortBy) sp.set('sortBy', params.sortBy);
    if (params?.sortDir) sp.set('sortDir', params.sortDir);
    const qs = sp.toString();
    return request<PaginatedResponse<Song>>(`/api/songs${qs ? `?${qs}` : ''}`);
  },

  getSong: (id: string) => request<Song>(`/api/songs/${id}`),

  createSong: (body: CreateSongBody) =>
    request<Song>('/api/songs', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateSong: (id: string, body: UpdateSongBody) =>
    request<Song>(`/api/songs/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  updateSongStatus: (id: string, body: StatusUpdateBody) =>
    request<Song>(`/api/songs/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // Streams
  listStreams: (params?: { status?: string; search?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.search) sp.set('search', params.search);
    const qs = sp.toString();
    return request<ListResponse<Stream>>(`/api/streams${qs ? `?${qs}` : ''}`);
  },

  createStream: (body: CreateStreamBody) =>
    request<Stream>('/api/streams', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updateStreamStatus: (id: string, body: StatusUpdateBody) =>
    request<Stream>(`/api/streams/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // Stamp editor — extended
  listStampStreams: () =>
    request<ListResponse<StreamWithPending>>('/api/stamp/streams'),

  stampStats: () => request<StampStats>('/api/stamp/stats'),

  clearAllEndTimestamps: (streamId: string) =>
    request<{ ok: boolean; cleared: number }>(`/api/streams/${streamId}/end-timestamps`, {
      method: 'DELETE',
    }),

  fetchPerformanceDuration: (perfId: string) =>
    request<FetchDurationResponse>(`/api/performances/${perfId}/fetch-duration`, {
      method: 'POST',
    }),

  // Stamp editor
  listStreamPerformances: (streamId: string) =>
    request<ListResponse<StampPerformance>>(`/api/streams/${streamId}/performances`),

  createStampPerformance: (streamId: string, body: CreateStampPerformanceBody) =>
    request<{ songId: string; performanceId: string }>(`/api/streams/${streamId}/performances`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  updatePerformanceStatus: (id: string, status: Status) =>
    request<{ ok: boolean }>(`/api/performances/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),

  updatePerformanceTimestamps: (id: string, body: UpdateTimestampsBody) =>
    request<{ ok: boolean }>(`/api/performances/${id}/timestamps`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updatePerformanceDetails: (id: string, body: UpdateSongDetailsBody) =>
    request<{ ok: boolean }>(`/api/performances/${id}/details`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  deletePerformance: (id: string) =>
    request<{ ok: boolean }>(`/api/performances/${id}`, {
      method: 'DELETE',
    }),

  // Bulk approve
  approveAllForStream: (streamId: string) =>
    request<BulkApproveResponse>(`/api/streams/${streamId}/approve-all`, {
      method: 'POST',
    }),

  // Paste import
  pasteImport: (streamId: string, body: PasteImportBody) =>
    request<PasteImportResponse>(`/api/streams/${streamId}/paste-import`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Stream detail
  getStreamDetail: (streamId: string) =>
    request<StreamDetail>(`/api/streams/${streamId}/detail`),

  // Performance note
  updatePerformanceNote: (id: string, note: string) =>
    request<{ ok: boolean }>(`/api/performances/${id}/note`, {
      method: 'PATCH',
      body: JSON.stringify({ note }),
    }),

  // Pipeline
  discoverStreams: () =>
    request<DiscoverStreamsResponse>('/api/pipeline/discover', {
      method: 'POST',
    }),

  importStreams: (body: ImportStreamsBody) =>
    request<ImportStreamsResponse>('/api/pipeline/import-streams', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  extractTimestamps: (streamId: string) =>
    request<ExtractResponse>('/api/pipeline/extract', {
      method: 'POST',
      body: JSON.stringify({ streamId }),
    }),

  extractImport: (body: ExtractImportBody) =>
    request<ExtractImportResponse>('/api/pipeline/extract-import', {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  // Nova submissions
  listNovaSubmissions: (params?: { status?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    const qs = sp.toString();
    return request<ListResponse<NovaSubmission>>(`/api/nova/submissions${qs ? `?${qs}` : ''}`);
  },

  updateNovaSubmission: (id: string, body: Record<string, string | number>) =>
    request<NovaSubmission>(`/api/nova/submissions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  updateNovaStatus: (id: string, body: { status: NovaStatus; reviewer_note?: string }) =>
    request<NovaSubmission>(`/api/nova/submissions/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  // Nova VOD submissions
  listNovaVods: (params?: { status?: string; streamer?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.streamer) sp.set('streamer', params.streamer);
    const qs = sp.toString();
    return request<ListResponse<NovaVodSubmission>>(`/api/nova/vods${qs ? `?${qs}` : ''}`);
  },

  getNovaVod: (id: string) =>
    request<NovaVodSubmission & { songs: NovaVodSong[] }>(`/api/nova/vods/${id}`),

  updateNovaVodStatus: (id: string, body: { status: NovaStatus; reviewer_note?: string }) =>
    request<NovaVodSubmission>(`/api/nova/vods/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),

  updateNovaVod: (id: string, body: Record<string, string>) =>
    request<NovaVodSubmission>(`/api/nova/vods/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  // Crystal tickets
  listCrystalTickets: (params?: { status?: string; type?: string }) => {
    const sp = new URLSearchParams();
    if (params?.status) sp.set('status', params.status);
    if (params?.type) sp.set('type', params.type);
    const qs = sp.toString();
    return request<ListResponse<CrystalTicket>>(`/api/crystal/tickets${qs ? `?${qs}` : ''}`);
  },

  getCrystalTicket: (id: string) =>
    request<CrystalTicket>(`/api/crystal/tickets/${id}`),

  replyCrystalTicket: (id: string, admin_reply: string) =>
    request<CrystalTicket>(`/api/crystal/tickets/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify({ admin_reply }),
    }),

  updateCrystalTicketStatus: (id: string, status: CrystalTicketStatus) =>
    request<CrystalTicket>(`/api/crystal/tickets/${id}/status`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    }),
};

export { ApiError };
