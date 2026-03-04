import type { SubmitTicketBody, TicketType } from './types';

const VALID_TYPES = new Set<string>(['bug', 'feat', 'ui', 'other']);

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

  return { ok: errors.length === 0, errors };
}
