import type { LegacyMedia } from './queries.js';

export interface MediaVariant {
  variant: string;
  disk: string;
  key: string;
  fileName: string;
}

/**
 * Spatie's stock DefaultPathGenerator, which searchie uses unmodified:
 *   original    {media.id}/{file_name}
 *   conversion  {media.id}/conversions/{basename}-{conversionName}.{ext}
 */
export function variantsOf(media: LegacyMedia): MediaVariant[] {
  const out: MediaVariant[] = [
    {
      variant: 'original',
      disk: media.disk,
      key: `${media.id}/${media.file_name}`,
      fileName: media.file_name,
    },
  ];

  let generated: Record<string, unknown> = {};
  if (media.generated_conversions) {
    try {
      const parsed: unknown = JSON.parse(media.generated_conversions);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        generated = parsed as Record<string, unknown>;
      }
    } catch {
      return out;
    }
  }

  const dot = media.file_name.lastIndexOf('.');
  const base = dot > 0 ? media.file_name.slice(0, dot) : media.file_name;
  const ext = dot > 0 ? media.file_name.slice(dot) : '';
  const conversionsDisk = media.conversions_disk ?? media.disk;

  for (const [name, wasGenerated] of Object.entries(generated)) {
    if (wasGenerated !== true) continue;
    const fileName = `${base}-${name}${ext}`;
    out.push({
      variant: name,
      disk: conversionsDisk,
      key: `${media.id}/conversions/${fileName}`,
      fileName,
    });
  }
  return out;
}

/** The legacy cdn_url_function: escape '#', then swap the s3 prefix for the cdn prefix. */
export function cdnUrlFor(key: string, s3Url: string, cdnUrl: string): string {
  const full = `${s3Url.replace(/\/$/, '')}/${key}`;
  return full.split('#').join('%23').split(s3Url.replace(/\/$/, '')).join(cdnUrl.replace(/\/$/, ''));
}

const POSTER_VARIANTS = new Set([
  'optimized_thumbnail',
  'optimized_thumbnail_small',
  'thumb',
  'optimized_image',
  'optimized_image_small',
]);

/** The rendition a video node plays. Legacy stores the playable file as the original. */
export function isPlaybackVariant(variant: string): boolean {
  return variant === 'original';
}

export function isPosterVariant(variant: string): boolean {
  return POSTER_VARIANTS.has(variant);
}
