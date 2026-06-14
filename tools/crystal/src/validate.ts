import type { SubmitTicketBody, TicketType } from './types';

const VALID_TYPES = new Set<string>(['bug', 'feat', 'ui', 'other']);

// Server-side maximum lengths for user-submitted ticket fields, measured on the
// trimmed value in UTF-16 code units (matches HTML maxlength and the rest of the
// codebase). Single source of truth — form-page.ts imports these to drive the
// client-side maxlength attributes so the two cannot drift. Refs #27.
export const TICKET_FIELD_LIMITS = {
  title: 200,
  nickname: 50,
  body: 5000,
  contact: 200,
  context_url: 500,
} as const;

// Chinese labels used to build a field-specific over-length error message.
const FIELD_LABELS: Record<keyof typeof TICKET_FIELD_LIMITS, string> = {
  title: '標題',
  body: '描述',
  nickname: '暱稱',
  contact: '聯絡方式',
  context_url: '來源連結',
};

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

export function validateTicket(body: SubmitTicketBody): ValidationResult {
  const errors: string[] = [];

  if (!body.title || !body.title.trim()) {
    errors.push('標題為必填');
  }

  if (!body.body || !body.body.trim()) {
    errors.push('描述為必填');
  }

  if (!body.type || !VALID_TYPES.has(body.type)) {
    errors.push('類型無效，請選擇 bug / feat / ui / other');
  }

  if (!body.turnstile_token) {
    errors.push('請完成驗證');
  }

  // When public reply is NOT allowed, contact is required
  if (!body.is_public_reply_allowed && (!body.contact || !body.contact.trim())) {
    errors.push('不公開回覆時，聯絡方式為必填（讓我們能回覆你）');
  }

  // Length caps: the form's maxlength is client-only and trivially bypassed by a
  // direct API call, so enforce per-field maximums here too. Measured on the
  // trimmed value (= what gets stored) in UTF-16 code units. Refs #27.
  for (const field of Object.keys(TICKET_FIELD_LIMITS) as (keyof typeof TICKET_FIELD_LIMITS)[]) {
    const value = (body[field] ?? '').trim();
    const limit = TICKET_FIELD_LIMITS[field];
    if (value.length > limit) {
      errors.push(`${FIELD_LABELS[field]}長度上限為 ${limit} 字`);
    }
  }

  return { ok: errors.length === 0, errors };
}
