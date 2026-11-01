/**
 * ImageSegment — renders an <img> from the slice body. Uses
 * `expo-image` (already in the project) for caching + performance.
 *
 * v3 §2.3 says the v1 approach is to hot-link OpenStax directly
 * (zero infra), with a proxy fallback (chunk 5) coming later. The
 * proxy URL is constructed lazily: if the upstream looks like an
 * OpenStax / archive URL we route it through the backend proxy so
 * we can swap to a CDN or rewrite paths in one place; everything
 * else (e.g. a self-hosted asset) goes direct.
 *
 * Max height is capped at 240 so a giant diagram doesn't push the
 * reader's vertical scroll past one screen. Images wider than the
 * column scale down via `contentFit: 'contain'`.
 *
 * If the image fails to load we show a placeholder box with the
 * alt text — better than nothing-rendering, and gives a
 * hint to the user that the slice is missing media.
 */

import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';

import { API_URL } from '@/src/shared/api/client';

type ImageSegmentProps = {
  src: string;
  alt: string;
};

// Hosts we route through the backend proxy. Whitelist, not blacklist:
// the proxy is open to whitelisted hosts only, so we mirror the
// server's allowlist here. Adding a host means updating both this
// set and `app/routers/images.py:ALLOWED_HOSTS`.
const PROXIED_HOSTS: ReadonlySet<string> = new Set([
  'openstax.org',
  'www.openstax.org',
  'cnx.org',
  'www.cnx.org',
  'archive.cnx.org',
  'flickr.com',
  'live.staticflickr.com',
  'upload.wikimedia.org',
]);

/**
 * If the src is on a proxied host, return the proxy URL. Otherwise
 * return the src unchanged. Failures here are non-fatal: an
 * exception in the URL builder means we render the raw src, which
 * the network layer can still try to load.
 */
function maybeProxied(src: string): string {
  try {
    const u = new URL(src);
    if (!PROXIED_HOSTS.has(u.hostname.toLowerCase())) return src;
    // We always go through the proxy — hot-linking directly would
    // skip our cache. The proxy is cheap (a HIT is a ~5ms disk read)
    // and the cost of NOT routing through is that a future
    // upstream change (OpenStax path rewrite) silently breaks every
    // reader session.
    const proxyUrl = `${API_URL}/api/v1/content/images/proxy?url=${encodeURIComponent(src)}`;
    return proxyUrl;
  } catch {
    return src;
  }
}

function ImageSegmentImpl({ src, alt }: ImageSegmentProps) {
  const [failed, setFailed] = useState(false);
  const proxiedSrc = maybeProxied(src);

  if (failed) {
    return (
      <View style={styles.placeholder}>
        <Text style={styles.placeholderEmoji}>🖼️</Text>
        <Text style={styles.placeholderAlt}>{alt || 'image'}</Text>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Image
        source={{ uri: proxiedSrc }}
        style={styles.image}
        contentFit="contain"
        accessibilityLabel={alt}
        onError={() => setFailed(true)}
        // Cache to disk; expo-image defaults are in-memory, but a
        // re-open of the same slice should not re-download.
        cachePolicy="memory-disk"
      />
    </View>
  );
}

export const ImageSegment = memo(ImageSegmentImpl);

const styles = StyleSheet.create({
  wrap: {
    marginVertical: 12,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: 'transparent',
  },
  image: {
    width: '100%',
    height: 240,
  },
  placeholder: {
    height: 120,
    marginVertical: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 16,
    gap: 4,
  },
  placeholderEmoji: {
    fontSize: 24,
  },
  placeholderAlt: {
    fontSize: 12,
    lineHeight: 16,
    textAlign: 'center',
  },
});
