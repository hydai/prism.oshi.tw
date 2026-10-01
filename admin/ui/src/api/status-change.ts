import type { Status } from '../../../shared/types';

/**
 * Sends a status change, and makes sure of a failure before it is reported. A change the worker made whose answer
 * was lost on the way back (a dropped connection, a timeout, a gateway error) would otherwise read as failed, and
 * the page would learn that it went through only from a Retry (the worker answers a change to the status a record
 * already has as done, writing nothing). So when `send` fails, `readBack` reads the record: one that already has
 * `status` is the change done, and is returned in place of the answer. Otherwise, or when the read fails as well,
 * the change's own failure is thrown, for the page to report with its Retry.
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
