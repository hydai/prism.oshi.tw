import type { Status } from '../../../shared/types';

/**
 * Sends a status change, and makes sure of a failure before it is reported. The worker refuses a change to the
 * status a record already has (a 400, "Cannot transition from approved to approved"), so a change it made whose
 * answer was lost on the way back (a dropped connection, a timeout, a gateway error) would fail again on every
 * Retry, and the page would never learn that it went through. So when `send` fails, `readBack` reads the record:
 * one that already has `status` is the change done, and is returned in place of the answer. Otherwise, or when the
 * read fails as well, the change's own failure is thrown, for the page to report with its Retry.
 */
export async function sendStatusChange<Answer extends { status: Status }>(
  status: Status,
  send: () => Promise<Answer>,
  readBack: () => Promise<Answer>,
): Promise<Answer> {
  try {
    return await send();
  } catch (failure) {
    const current = await readBack().catch(() => null);
    if (current?.status === status) return current;
    throw failure;
  }
}
