/**
 * The VOD snapshot publication workflow as a mounted Hono sub-app.
 *
 * All ten routes stay curator-only and every response stays `private,
 * no-store`. The two things this file owns that index.ts used to repeat ten
 * times over:
 *
 *   - ONE `.onError`, so a vod-export domain error is rendered by
 *     `vodExportErrorResponse` instead of by a per-route try/catch. Hono copies
 *     a sub-app's error handler onto each of its routes when the sub-app is
 *     mounted with `app.route()`, so these errors are answered here and never
 *     reach the root app.onError generic `{ error, code }` contract.
 *   - ONE cache-control middleware.
 *
 * Body parsing here is deliberately NOT `http.ts`'s `readJsonBody`: vod-export
 * owns its own error contract, so the control-recovery POST hands an unparsable
 * body to the domain validator as `null` and lets it raise the vod-export error
 * the UI already knows how to read.
 */
import { Hono } from 'hono';
import { requireCurator } from '../auth';
import { getRouteParam } from '../http';
import type { AuthUser } from '../../shared/types';
import {
  downloadVodExportCandidate,
  generateVodExportPreviewApi,
  getVodExportCandidateApi,
  getVodExportRepairRecord,
  vodExportErrorResponse,
  vodExportPreviewApiResponse,
} from './api';
import { runVodExportMaintenance } from './maintenance';
import {
  getVodExportStatus,
  inspectVodExportControlRecoveryState,
  manuallyRecoverVodExportControl,
  publishVodExportCandidate,
  reconcileVodExportPublication,
  requireExporterBuildId,
  type VodExportPublicationBindings,
} from './publication';

type Bindings = VodExportPublicationBindings & {
  CURATOR_EMAILS: string;
  CF_VERSION_METADATA: WorkerVersionMetadata;
};

type Variables = {
  user: AuthUser;
};

const vodExportRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

vodExportRoutes.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'private, no-store');
});

vodExportRoutes.onError((error) => vodExportErrorResponse(error));

vodExportRoutes.get('/status', requireCurator, async (c) => {
  const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
  return c.json(await getVodExportStatus(c.env, buildId));
});

vodExportRoutes.post('/preview', requireCurator, async (c) => {
  const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
  return vodExportPreviewApiResponse(await generateVodExportPreviewApi(c.env, buildId));
});

vodExportRoutes.get('/candidates/:id/download', requireCurator, async (c) => {
  return await downloadVodExportCandidate(c.env, getRouteParam(c, 'id'));
});

vodExportRoutes.get('/candidates/:id', requireCurator, async (c) => {
  const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
  return vodExportPreviewApiResponse(
    await getVodExportCandidateApi(c.env, getRouteParam(c, 'id'), buildId),
  );
});

vodExportRoutes.get('/repair/:entity/:rowId', requireCurator, async (c) => {
  const entity = getRouteParam(c, 'entity');
  if (entity !== 'performance' && entity !== 'song' && entity !== 'vod' && entity !== 'streamer') {
    return c.json({ error: 'Repair record not found', code: 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' }, 404);
  }
  const rowIdText = getRouteParam(c, 'rowId');
  if (!/^[1-9][0-9]*$/.test(rowIdText)) {
    return c.json({ error: 'Repair record not found', code: 'VOD_EXPORT_REPAIR_RECORD_NOT_FOUND' }, 404);
  }
  return c.json(await getVodExportRepairRecord(c.env, entity, Number(rowIdText)));
});

vodExportRoutes.post('/candidates/:id/publish', requireCurator, async (c) => {
  const buildId = requireExporterBuildId(c.env.CF_VERSION_METADATA);
  const result = await publishVodExportCandidate(
    c.env,
    getRouteParam(c, 'id'),
    buildId,
    c.get('user').email,
  );
  return c.json(result);
});

vodExportRoutes.post('/reconcile', requireCurator, async (c) => {
  return c.json(await reconcileVodExportPublication(c.env));
});

vodExportRoutes.get('/control-recovery', requireCurator, async (c) => {
  return c.json(await inspectVodExportControlRecoveryState(c.env.VOD_EXPORT_PRIVATE));
});

vodExportRoutes.post('/control-recovery', requireCurator, async (c) => {
  const body = await c.req.json<unknown>().catch(() => null);
  return c.json(await manuallyRecoverVodExportControl(
    c.env,
    body,
    c.get('user').email,
  ));
});

vodExportRoutes.post('/maintenance', requireCurator, async (c) => {
  return c.json(await runVodExportMaintenance(c.env));
});

export default vodExportRoutes;
