import { HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { dirname } from 'node:path';
import { loadEnv, secretsOf } from '../config/env.js';
import { logger } from '../log/logger.js';
import { TOOL_VERSION } from '../version.js';
import { Tunnel } from '../extract/tunnel.js';
import { openSnapshot } from '../extract/db.js';
import {
  distinctSectionTypes, fetchAchievements, fetchDiscussionCategories, fetchFiles,
  fetchFolders, fetchHubFiles, fetchHubTheme, fetchMedia, fetchMenuItems, fetchPages,
  fetchPlaylistItems, fetchPlaylists, fetchReplicaLagSeconds, fetchSections,
  fetchSegmentables, fetchSegments, findHubByDomain, MORPH_FILE, MORPH_HUB, MORPH_PAGE,
  MORPH_PLAYLIST, MORPH_SECTION,
} from '../extract/queries.js';
import { buildManifest, pinManifest, unpinnedHeadFor, type HeadObjectFn, type HeadResult, type LegacyGate } from '../extract/manifest.js';
import { readBundle, writeBundle, type Bundle } from '../extract/bundle.js';
import type { Env } from '../config/env.js';

export interface ExtractOptions {
  domain: string;
  outDir: string;
  checkAccess: boolean;
  /** Capture the DB snapshot with an unpinned manifest; no AWS values needed. */
  skipS3: boolean;
}

function s3Head(env: Env): HeadObjectFn {
  const s3 = new S3Client({
    region: env.awsRegion,
    credentials: { accessKeyId: env.awsAccessKeyId, secretAccessKey: env.awsSecretAccessKey },
  });
  return async (bucket, key, versionId) => {
    try {
      const out = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key, ChecksumMode: 'ENABLED', ...(versionId ? { VersionId: versionId } : {}) }));
      return {
        sizeBytes: out.ContentLength ?? 0,
        etag: out.ETag ?? '',
        versionId: out.VersionId ?? null,
        checksumCrc64Nvme: out.ChecksumCRC64NVME ?? null,
        contentType: out.ContentType ?? null,
      };
    } catch {
      return null;
    }
  };
}

/** `extract --s3-only`: pin an unpinned bundle's manifest with the real S3 identity, in place. */
export async function runPinBundle(bundlePath: string): Promise<string> {
  const env = loadEnv('.env', { require: ['s3', 'cdn'] });
  logger.setSecrets(secretsOf(env));
  const bundle = readBundle(bundlePath);
  const missing = await pinManifest(bundle.assets, env.legacyS3Bucket, s3Head(env));
  bundle.assets = bundle.assets.filter((a) => !missing.some((m) => m.key === a.sourceKey));
  bundle.missingAssets = [...bundle.missingAssets, ...missing];
  bundle.header.manifestPinned = true;
  const path = writeBundle(bundle, dirname(bundlePath));
  logger.info('bundle manifest pinned', { path, assets: bundle.assets.length, missingAssets: bundle.missingAssets.length });
  return path;
}

export async function runExtract(options: ExtractOptions): Promise<string> {
  // --check-access opens the tunnel and runs one SELECT, so it needs only the replica values.
  const env = loadEnv('.env', {
    require: options.checkAccess ? [] : options.skipS3 ? ['cdn'] : ['s3', 'cdn'],
  });
  logger.setSecrets(secretsOf(env));

  const tunnel = await Tunnel.open(env);
  try {
    let session;
    try {
      session = await openSnapshot(env, tunnel.localPort);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ER_ACCESS_DENIED_ERROR') {
        throw new Error(
          `the replica refused the login for LEGACY_DB_USER "${env.legacyDbUser}" (ER_ACCESS_DENIED_ERROR). The tunnel is fine; the read-replica user is inactive, the password is wrong, or .env names a different user than the one Atanas issued.`,
        );
      }
      throw error;
    }
    const captureStartedAt = new Date().toISOString();
    const replicaLagSeconds = await fetchReplicaLagSeconds(session);

    const hub = await findHubByDomain(session, options.domain);
    if (!hub) throw new Error(`no hub with domain "${options.domain}" on the replica`);

    if (options.checkAccess) {
      logger.info('extract --check-access: replica reachable and the hub resolves', {
        legacyHubId: hub.id,
        replicaLagSeconds,
      });
      await session.end();
      return '';
    }

    const theme = await fetchHubTheme(session, hub);
    const pages = await fetchPages(session, hub.id);
    const sections = await fetchSections(session, hub.id);
    const menuItems = await fetchMenuItems(session, hub.id);
    const sectionTypes = await distinctSectionTypes(session, hub.id);

    const referencedPlaylistIds = [
      ...sections.filter((s) => s.model_type === MORPH_PLAYLIST && s.model_id !== null).map((s) => s.model_id!),
      ...menuItems.filter((m) => m.model_type === MORPH_PLAYLIST && m.model_id !== null).map((m) => m.model_id!),
    ];
    const playlists = await fetchPlaylists(session, hub.id, referencedPlaylistIds);
    const playlistItems = await fetchPlaylistItems(session, playlists.map((p) => p.id));

    const referencedFileIds = [
      ...playlistItems.map((i) => i.file_id),
      ...sections.filter((s) => s.model_type === MORPH_FILE && s.model_id !== null).map((s) => s.model_id!),
    ];
    const hubFiles = await fetchHubFiles(session, hub.id);
    const files = await fetchFiles(session, [
      ...new Set([...referencedFileIds, ...hubFiles.map((hf) => hf.file_id)]),
    ]);
    const folders = await fetchFolders(
      session,
      files.map((f) => f.folder_id).filter((id): id is number => id !== null),
    );

    // Page decoration (a section's image, a page's featured image) is Spatie
    // media owned by the section or page, not by a File. A playlist's own
    // thumbnail is its `featured-images` media (ThumbnailService::COLLECTION).
    const media = await fetchMedia(session, [
      { modelType: MORPH_HUB, modelId: hub.id },
      ...files.map((f) => ({ modelType: MORPH_FILE, modelId: f.id })),
      ...sections.map((s) => ({ modelType: MORPH_SECTION, modelId: s.id })),
      ...pages.map((p) => ({ modelType: MORPH_PAGE, modelId: p.id })),
      ...playlists.map((p) => ({ modelType: MORPH_PLAYLIST, modelId: p.id })),
    ]);

    const discussionCategories = await fetchDiscussionCategories(session, hub.id);
    const achievements = await fetchAchievements(session, hub.id);
    const segmentables = await fetchSegmentables(session, hub.id);
    const segmentIds = [
      ...sections.map((s) => s.segment_id).filter((id): id is number => id !== null),
      ...menuItems.map((m) => m.segment_id).filter((id): id is number => id !== null),
      ...discussionCategories.map((d) => d.segment_id).filter((id): id is number => id !== null),
      ...segmentables.map((s) => s.segment_id),
    ];
    const { segments, groups, conditions } = await fetchSegments(session, segmentIds);

    // A file's gates are the gates of every section that references it.
    const fileGates = new Map<number, LegacyGate[]>();
    for (const section of sections) {
      if (section.model_type !== MORPH_FILE || section.model_id === null) continue;
      const gates: LegacyGate[] = [];
      if (section.segment_id !== null) gates.push({ kind: 'segment', segmentId: section.segment_id });
      for (const link of segmentables) {
        if (link.segmentable_id === section.id) gates.push({ kind: 'segment', segmentId: link.segment_id });
      }
      fileGates.set(section.model_id, [...(fileGates.get(section.model_id) ?? []), ...gates]);
    }

    const head = options.skipS3 ? unpinnedHeadFor(media) : s3Head(env);

    const { entries, missing } = await buildManifest(
      {
        files, media, hubFiles,
        playlistItems: playlistItems.map((i) => ({ file_id: i.file_id, playlist_id: i.playlist_id })),
        publicPlaylistIds: new Set(playlists.filter((p) => p.privacy === 'public').map((p) => p.id)),
        fileGates,
        bucket: options.skipS3 ? '' : env.legacyS3Bucket,
        // Without the S3 URL the CDN URL is the CDN base plus the key, which is what the prefix swap yields anyway.
        s3Url: options.skipS3 ? env.legacyCdnUrl : env.legacyS3Url,
        cdnUrl: env.legacyCdnUrl,
      },
      head,
    );

    const bundle: Bundle = {
      header: {
        bundleSchemaVersion: 1,
        toolVersion: TOOL_VERSION,
        legacyHubId: hub.id,
        legacyHubDomain: options.domain,
        sourceHost: env.legacyDbHost,
        captureStartedAt,
        captureEndedAt: new Date().toISOString(),
        replicaLagSeconds,
        distinctSectionTypes: sectionTypes,
        manifestPinned: !options.skipS3,
        legacyCdnUrl: env.legacyCdnUrl,
        legacyS3Url: options.skipS3 ? env.legacyCdnUrl : env.legacyS3Url,
      },
      hub, theme, pages, sections, menuItems, playlists, playlistItems, files,
      hubFiles, folders, media, discussionCategories, achievements,
      segments, segmentGroups: groups, segmentConditions: conditions, segmentables,
      assets: entries, missingAssets: missing,
    };

    await session.end();
    const path = writeBundle(bundle, options.outDir);
    logger.info('bundle written', {
      path, pages: pages.length, sections: sections.length,
      assets: entries.length, missingAssets: missing.length,
    });
    return path;
  } finally {
    await tunnel.close();
  }
}
