/* What the host knows about its own data that a `_profile.json` cannot say.
 *
 * The page needs nothing here: every bundled dataset describes itself with a `_profile.json`. A local
 * `demo/host.local.ts`, when present, replaces this file in the full build (`npm run demo`, never `demo:public`):
 * that is the place for data whose profile is code (several json dialects, folded spines) or whose ids need a
 * matching rule. Same shape, same export name.
 */
import type { GraphNode, GraphProfile } from 'glassbrain';

export interface DemoHost {
  /** Profile for data without a `_profile.json`; without it such data uses `defineProfile({ id })`. */
  profile?: GraphProfile;
  /** How the code view names that profile. */
  profileName?: string;
  /** `diffModels` key: which nodes in two versions are "the same one" (default: equal ids). */
  matchKey?: (node: GraphNode) => string;
  /** `diffModels` ignore: fields that change between versions without the node changing (provenance and the like). */
  ignore?: string[];
}

export const HOST: DemoHost = {};
