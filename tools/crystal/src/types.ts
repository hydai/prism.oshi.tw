export type Bindings = {
  DB: D1Database;
  TURNSTILE_SITE_KEY: string;
  TURNSTILE_SECRET_KEY: string;
};

export type TicketType = 'bug' | 'feat' | 'ui' | 'other';
export type TicketStatus = 'pending' | 'replied' | 'closed';

export interface TicketRow {
  id: string;
  type: TicketType;
  title: string;
  body: string;
  nickname: string;
  contact: string;
  is_public_reply_allowed: number;
  context_url: string;
  status: TicketStatus;
  admin_reply: string;
  replied_at: string | null;
  submitted_at: string;
  closed_at: string | null;
}

export interface SubmitTicketBody {
  type: TicketType;
  title: string;
  body: string;
  nickname?: string;
  contact?: string;
  is_public_reply_allowed?: boolean;
  context_url?: string;
  turnstile_token: string;
}
