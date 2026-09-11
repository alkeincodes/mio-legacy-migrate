import { describe, expect, it } from 'vitest';
import { cdnUrlFor, isPlaybackVariant, isPosterVariant, variantsOf } from '../../src/extract/mediaPaths.js';
import type { LegacyMedia } from '../../src/extract/queries.js';

function media(overrides: Partial<LegacyMedia> = {}): LegacyMedia {
  return {
    id: 91234,
    model_type: 'App\\File',
    model_id: 5,
    uuid: 'b2b4b0f2-0000-0000-0000-000000000000',
    collection_name: 'default',
    name: 'hero',
    file_name: 'hero.png',
    mime_type: 'image/png',
    disk: 's3',
    conversions_disk: null,
    size: 1024,
    generated_conversions: null,
    custom_properties: null,
    responsive_images: null,
    order_column: 1,
    ...overrides,
  };
}

describe('variantsOf', () => {
  it('derives the original key from media.id and file_name', () => {
    const [original] = variantsOf(media());
    expect(original).toEqual({
      variant: 'original',
      disk: 's3',
      key: '91234/hero.png',
      fileName: 'hero.png',
    });
  });

  it('derives a conversion key as id/conversions/basename-conversion.ext', () => {
    const variants = variantsOf(
      media({ generated_conversions: JSON.stringify({ optimized_thumbnail: true }) }),
    );
    expect(variants.map((v) => v.key)).toEqual([
      '91234/hero.png',
      '91234/conversions/hero-optimized_thumbnail.png',
    ]);
  });

  it('skips conversions recorded as not generated', () => {
    const variants = variantsOf(
      media({
        generated_conversions: JSON.stringify({ optimized_thumbnail: true, thumb: false }),
      }),
    );
    expect(variants.map((v) => v.variant)).toEqual(['original', 'optimized_thumbnail']);
  });

  it('uses conversions_disk for conversions when it is set', () => {
    const variants = variantsOf(
      media({
        conversions_disk: 's3-conversions',
        generated_conversions: JSON.stringify({ thumb: true }),
      }),
    );
    expect(variants[0]?.disk).toBe('s3');
    expect(variants[1]?.disk).toBe('s3-conversions');
  });

  it('handles a file name with no extension without emitting a trailing dot', () => {
    const variants = variantsOf(
      media({ file_name: 'README', generated_conversions: JSON.stringify({ thumb: true }) }),
    );
    expect(variants[1]?.key).toBe('91234/conversions/README-thumb');
  });

  it('tolerates malformed generated_conversions JSON by returning only the original', () => {
    expect(variantsOf(media({ generated_conversions: 'not json' })).map((v) => v.variant)).toEqual([
      'original',
    ]);
  });
});

describe('cdnUrlFor', () => {
  it('swaps the s3 prefix for the cdn prefix', () => {
    expect(
      cdnUrlFor(
        '91234/hero.png',
        'https://legacy-bucket.s3.amazonaws.com',
        'https://cdn.legacy.example.com',
      ),
    ).toBe('https://cdn.legacy.example.com/91234/hero.png');
  });

  it('percent-encodes a hash in the key the way the legacy helper does', () => {
    expect(
      cdnUrlFor('91234/a#b.png', 'https://s3.example.com', 'https://cdn.example.com'),
    ).toBe('https://cdn.example.com/91234/a%23b.png');
  });
});

describe('variant classification', () => {
  it('recognises the playback and poster variants', () => {
    expect(isPlaybackVariant('original')).toBe(true);
    expect(isPlaybackVariant('optimized_thumbnail')).toBe(false);
    expect(isPosterVariant('optimized_thumbnail')).toBe(true);
    expect(isPosterVariant('thumb')).toBe(true);
    expect(isPosterVariant('original')).toBe(false);
  });
});
