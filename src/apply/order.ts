import type { CatalogNode } from '../map/catalog.js';
import type { PlanPage } from '../map/plan.js';

export type StageName =
  | 'hub' | 'branding' | 'tags' | 'segments' | 'accessRules' | 'folders' | 'assets'
  | 'playlists' | 'pageDrafts' | 'pageTrees' | 'removals' | 'navigation' | 'spaces' | 'achievements';

/**
 * The single executable order from spec 6.5. Tags precede segments because a
 * has_tag condition is compiled by slug at create time; segments come early because
 * assets, playlists and pages attach to their rules; every page is created as an
 * empty draft before any tree is written, so mutually linked pages need no
 * ordering; achievements come last because they reference pages and playlists.
 */
export const APPLY_ORDER: StageName[] = [
  'hub', 'branding', 'tags', 'segments', 'accessRules', 'folders', 'assets',
  'playlists', 'pageDrafts', 'pageTrees', 'removals', 'navigation', 'spaces', 'achievements',
];

/** Fail-closed: a restricted section with no mapped rule keeps the page unpublished. */
export function shouldPublish(page: PlanPage, mappedRuleTargets: Set<string>): boolean {
  return page.restrictedSectionNodeIds.every((id) => mappedRuleTargets.has(id));
}

export interface RefResolver {
  asset(legacyMediaId: number, variant: string): { url: string } | { pending: true };
  playlist(legacyPlaylistId: number): string | null;
  /** The V3 file id of a verified asset, for file cards; null while it is pending. */
  file?(legacyMediaId: number): string | null;
}

const ASSET_REF = /^ledger:\/\/asset\/(\d+)\/(.+)$/;
const PLAYLIST_REF = /^ledger:\/\/playlist\/(\d+)$/;

/** Rewrites the placeholders the mapper emitted into resolved V3 values. Pure. */
export function resolveRefs(tree: CatalogNode, resolver: RefResolver): CatalogNode {
  const walk = (node: CatalogNode): CatalogNode => {
    const next: CatalogNode = { ...node };

    if (typeof node.value === 'string') {
      const match = ASSET_REF.exec(node.value);
      if (match) {
        const resolved = resolver.asset(Number(match[1]), match[2] ?? 'original');
        next.value = 'url' in resolved ? resolved.url : '';
      }
    }

    if (node.dataSource?.id) {
      const match = PLAYLIST_REF.exec(node.dataSource.id);
      const assetMatch = ASSET_REF.exec(node.dataSource.id);
      if (match) {
        const id = resolver.playlist(Number(match[1]));
        next.dataSource = id === null
          ? { type: node.dataSource.type }
          : { type: node.dataSource.type, id };
      } else if (assetMatch) {
        const id = resolver.file?.(Number(assetMatch[1])) ?? null;
        if (id === null) delete next.dataSource;
        else next.dataSource = { type: node.dataSource.type, id };
      }
    }

    const action = node.settings?.['action'] as { type?: string; value?: string } | undefined;
    if (action && typeof action.value === 'string') {
      const playlist = PLAYLIST_REF.exec(action.value);
      const asset = ASSET_REF.exec(action.value);
      if (playlist) {
        const id = resolver.playlist(Number(playlist[1]));
        // A playlist opens from the hub's content page; the id is passed as the route's query.
        next.settings = { ...node.settings, action: { ...action, type: 'page', value: id === null ? '/content' : `/content?playlist=${id}` } };
      } else if (asset) {
        const resolved = resolver.asset(Number(asset[1]), asset[2] ?? 'original');
        next.settings = { ...node.settings, action: { ...action, type: 'url', value: 'url' in resolved ? resolved.url : '' } };
      }
    }

    if (node.children) next.children = node.children.map(walk);
    return next;
  };
  return walk(tree);
}
