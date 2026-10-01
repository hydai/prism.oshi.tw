import type { CreateStreamBody, StreamCredit } from '../../../shared/types';

/**
 * What the Submit Stream form checks and sends, kept out of the page so the page is only layout and focus.
 * The rules are the worker's (`parseCreateStreamBody`, admin/src/parse.ts): a title, a date as YYYY-MM-DD
 * and a video ID that are not empty after trim. Two more come from the form itself. The links are checked
 * here because the form is `noValidate`, which turns off the check the browser makes on a `url` input:
 * each is a full http or https URL, or empty. And a credit link needs a credit author, because the worker
 * stores a credit by its author and a link without one would be dropped without a word.
 */

/** The form as typed: each field is the text in its input. */
export interface StreamDraft {
  title: string;
  date: string;
  youtubeUrl: string;
  videoId: string;
  creditAuthor: string;
  creditAuthorUrl: string;
  creditCommentUrl: string;
}

export const BLANK_STREAM: StreamDraft = {
  title: '',
  date: '',
  youtubeUrl: '',
  videoId: '',
  creditAuthor: '',
  creditAuthorUrl: '',
  creditCommentUrl: '',
};

interface StreamCheck {
  /** What each field says is wrong with it, or `null`. */
  titleError: string | null;
  dateError: string | null;
  youtubeUrlError: string | null;
  videoIdError: string | null;
  creditAuthorError: string | null;
  creditAuthorUrlError: string | null;
  creditCommentUrlError: string | null;
  /** Nothing to fix: the request can go. */
  valid: boolean;
}

const TITLE_ERROR = 'Enter a title.';
const DATE_EMPTY_ERROR = 'Enter the stream date.';
const DATE_FORMAT_ERROR = 'Enter the date as YYYY-MM-DD.';
const VIDEO_ID_ERROR = 'Enter the video ID.';
const LINK_ERROR = 'Enter a full URL, starting with http:// or https://.';
const CREDIT_AUTHOR_ERROR = 'Enter the credit author, or clear the links.';

/** The date the worker stores: exactly four digits of year. A browser's date input can give five or six. */
const DATE_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/** A link the page can use: an absolute http or https URL. Nothing else is a link to a video or a credit. */
function isWebLink(text: string): boolean {
  try {
    const { protocol } = new URL(text);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

/** A link field is optional: only text that is there has to be a link. */
function linkError(text: string): string | null {
  const link = text.trim();
  return link === '' || isWebLink(link) ? null : LINK_ERROR;
}

function dateError(text: string): string | null {
  const date = text.trim();
  if (date === '') return DATE_EMPTY_ERROR;
  return DATE_FORMAT.test(date) ? null : DATE_FORMAT_ERROR;
}

/** Checks the whole form as typed. */
export function checkStream(draft: StreamDraft): StreamCheck {
  const hasAuthor = draft.creditAuthor.trim() !== '';
  const hasCreditLink = draft.creditAuthorUrl.trim() !== '' || draft.creditCommentUrl.trim() !== '';
  const errors = {
    titleError: draft.title.trim() === '' ? TITLE_ERROR : null,
    dateError: dateError(draft.date),
    youtubeUrlError: linkError(draft.youtubeUrl),
    videoIdError: draft.videoId.trim() === '' ? VIDEO_ID_ERROR : null,
    creditAuthorError: hasCreditLink && !hasAuthor ? CREDIT_AUTHOR_ERROR : null,
    creditAuthorUrlError: linkError(draft.creditAuthorUrl),
    creditCommentUrlError: linkError(draft.creditCommentUrl),
  };
  return { ...errors, valid: Object.values(errors).every((error) => error === null) };
}

/** The credit of a stream: its author, and the links that were typed. Nothing, when there is no author. */
function creditOf(draft: StreamDraft): StreamCredit | undefined {
  const author = draft.creditAuthor.trim();
  if (author === '') return undefined;
  const authorUrl = draft.creditAuthorUrl.trim();
  const commentUrl = draft.creditCommentUrl.trim();
  return {
    author,
    ...(authorUrl === '' ? {} : { authorUrl }),
    ...(commentUrl === '' ? {} : { commentUrl }),
  };
}

/**
 * The request for a form that checked out. Everything is trimmed, because the worker stores the text as
 * sent; the stream's URL is what was typed, or the watch URL of the video ID when nothing was; `credit`
 * is left off when there is no author.
 */
export function streamRequest(draft: StreamDraft): CreateStreamBody {
  const videoId = draft.videoId.trim();
  const credit = creditOf(draft);
  return {
    title: draft.title.trim(),
    date: draft.date.trim(),
    videoId,
    youtubeUrl: draft.youtubeUrl.trim() || `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`,
    ...(credit === undefined ? {} : { credit }),
  };
}
