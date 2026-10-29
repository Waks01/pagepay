/**
 * Legacy path helpers.
 *
 * expo-file-system v54 removed the static `FileSystem.cacheDirectory` /
 * `FileSystem.documentDirectory` string properties in favour of the new
 * `Paths` class. Call sites across the app still build paths by string
 * concatenation, so these thin wrappers preserve that contract while
 * targeting the new API. Each returns a trailing-slash-terminated URI so
 * `` `${dir}${name}` `` keeps producing a valid path.
 */

import { Paths } from "expo-file-system";

function withTrailingSlash(uri: string): string {
  return uri.endsWith("/") ? uri : `${uri}/`;
}

/** Cache directory URI, e.g. `file:///data/user/0/.../cache/` */
export const cacheDirectory: string = withTrailingSlash(Paths.cache.uri);

/** Document directory URI, e.g. `file:///data/user/0/.../files/` */
export const documentDirectory: string = withTrailingSlash(Paths.document.uri);
