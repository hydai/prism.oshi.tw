import { formatSubscriberCount } from '../shared/format';
import type {
  BulkFetchSubscribersResponse,
  BulkFetchSubscribersResult,
} from '../shared/types';
import {
  fetchChannelInfos,
  YOUTUBE_CHANNEL_BATCH_SIZE,
  type ChannelInfo,
} from './youtube';

export interface SubscriberRefreshRow {
  id: string;
  display_name: string;
  youtube_channel_id: string;
}

interface SubscriberUpdate {
  submission: SubscriberRefreshRow;
  info: ChannelInfo;
  subscriberCount: string;
}

function failure(
  submission: SubscriberRefreshRow,
  error: string,
): BulkFetchSubscribersResult {
  return {
    id: submission.id,
    display_name: submission.display_name,
    subscriber_count: null,
    avatar_url: null,
    error,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

export async function refreshSubscriberCounts(
  db: D1Database,
  apiKey: string,
  submissions: SubscriberRefreshRow[],
): Promise<BulkFetchSubscribersResponse> {
  const channelIds = [...new Set(submissions.map((submission) => submission.youtube_channel_id))];
  const channelIdBatches: string[][] = [];
  for (let offset = 0; offset < channelIds.length; offset += YOUTUBE_CHANNEL_BATCH_SIZE) {
    channelIdBatches.push(channelIds.slice(offset, offset + YOUTUBE_CHANNEL_BATCH_SIZE));
  }

  const channelBatchResults = await Promise.allSettled(
    channelIdBatches.map((batch) => fetchChannelInfos(apiKey, batch)),
  );
  const infoByChannelId = new Map<string, ChannelInfo>();
  const errorByChannelId = new Map<string, string>();
  channelBatchResults.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      const requestedIds = new Set(channelIdBatches[index] ?? []);
      if (result.value.some((info) => !requestedIds.has(info.channelId))) {
        for (const channelId of requestedIds) {
          errorByChannelId.set(channelId, 'Channel identity mismatch');
        }
        return;
      }
      for (const info of result.value) infoByChannelId.set(info.channelId, info);
      return;
    }
    const message = errorMessage(result.reason);
    for (const channelId of channelIdBatches[index] ?? []) {
      errorByChannelId.set(channelId, message);
    }
  });

  const resultBySubmissionId = new Map<string, BulkFetchSubscribersResult>();
  const updates: SubscriberUpdate[] = [];
  for (const submission of submissions) {
    const fetchError = errorByChannelId.get(submission.youtube_channel_id);
    if (fetchError !== undefined) {
      resultBySubmissionId.set(submission.id, failure(submission, fetchError));
      continue;
    }
    const info = infoByChannelId.get(submission.youtube_channel_id);
    if (info === undefined) {
      resultBySubmissionId.set(submission.id, failure(submission, 'Hidden or not found'));
      continue;
    }
    updates.push({
      submission,
      info,
      subscriberCount: formatSubscriberCount(info.subscriberCount),
    });
  }

  const verifiedAt = new Date().toISOString();
  let updateResults: D1Result<{ id: string }>[] = [];
  if (updates.length > 0) {
    const statements = updates.map(({ submission, info, subscriberCount }) => (
      db.prepare(`
        UPDATE submissions
        SET subscriber_count = ?, avatar_url = ?,
            youtube_channel_verified_id = ?, youtube_channel_verified_at = ?
        WHERE id = ? AND youtube_channel_id = ?
        RETURNING id
      `).bind(
        subscriberCount,
        info.avatarUrl,
        info.channelId,
        verifiedAt,
        submission.id,
        submission.youtube_channel_id,
      )
    ));
    try {
      updateResults = await db.batch<{ id: string }>(statements);
    } catch (error) {
      const message = errorMessage(error);
      for (const { submission } of updates) {
        resultBySubmissionId.set(submission.id, failure(submission, message));
      }
    }
  }

  updateResults.forEach((result, index) => {
    const update = updates[index]!;
    const { submission, info, subscriberCount } = update;
    if (result.results[0]?.id !== submission.id) {
      resultBySubmissionId.set(
        submission.id,
        failure(submission, 'Channel ID changed during refresh'),
      );
      return;
    }
    resultBySubmissionId.set(submission.id, {
      id: submission.id,
      display_name: submission.display_name,
      subscriber_count: subscriberCount,
      avatar_url: info.avatarUrl,
    });
  });

  const results = submissions.map((submission) => resultBySubmissionId.get(submission.id)!);
  const updated = results.filter((result) => result.error === undefined).length;
  return { updated, failed: results.length - updated, results };
}
