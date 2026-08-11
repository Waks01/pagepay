/**
 * Offline storage for study assets
 * Caches unlocked content locally for offline access
 */

import * as SecureStore from 'expo-secure-store';

const CACHE_PREFIX = 'study_asset_';
const CACHE_INDEX_KEY = 'study_asset_index';

type CachedAsset = {
  assetId: number;
  content: unknown;
  unlockedAt: string;
  materialId: number;
};

/**
 * Get cached asset index (list of cached asset IDs)
 */
async function getCacheIndex(): Promise<number[]> {
  try {
    const index = await SecureStore.getItemAsync(CACHE_INDEX_KEY);
    return index ? JSON.parse(index) : [];
  } catch {
    return [];
  }
}

/**
 * Update cache index
 */
async function updateCacheIndex(assetIds: number[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(CACHE_INDEX_KEY, JSON.stringify(assetIds));
  } catch (error) {
    console.error('Failed to update cache index:', error);
  }
}

/**
 * Cache an unlocked asset
 */
export async function cacheAsset(
  assetId: number,
  content: unknown,
  materialId: number
): Promise<void> {
  try {
    const cached: CachedAsset = {
      assetId,
      content,
      unlockedAt: new Date().toISOString(),
      materialId,
    };
    
    await SecureStore.setItemAsync(
      `${CACHE_PREFIX}${assetId}`,
      JSON.stringify(cached)
    );
    
    // Update index
    const index = await getCacheIndex();
    if (!index.includes(assetId)) {
      await updateCacheIndex([...index, assetId]);
    }
  } catch (error) {
    console.error('Failed to cache asset:', error);
    // Don't throw - caching is optional
  }
}

/**
 * Get cached asset
 */
export async function getCachedAsset(assetId: number): Promise<CachedAsset | null> {
  try {
    const cached = await SecureStore.getItemAsync(`${CACHE_PREFIX}${assetId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error('Failed to get cached asset:', error);
    return null;
  }
}

/**
 * Check if asset is cached
 */
export async function isAssetCached(assetId: number): Promise<boolean> {
  try {
    const cached = await SecureStore.getItemAsync(`${CACHE_PREFIX}${assetId}`);
    return cached !== null;
  } catch {
    return false;
  }
}

/**
 * Get all cached assets
 */
export async function getAllCachedAssets(): Promise<CachedAsset[]> {
  try {
    const index = await getCacheIndex();
    const assets: CachedAsset[] = [];
    
    for (const assetId of index) {
      const cached = await getCachedAsset(assetId);
      if (cached) {
        assets.push(cached);
      }
    }
    
    return assets;
  } catch (error) {
    console.error('Failed to get all cached assets:', error);
    return [];
  }
}

/**
 * Clear cache for a specific asset
 */
export async function clearAssetCache(assetId: number): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${CACHE_PREFIX}${assetId}`);
    
    // Update index
    const index = await getCacheIndex();
    await updateCacheIndex(index.filter(id => id !== assetId));
  } catch (error) {
    console.error('Failed to clear asset cache:', error);
  }
}

/**
 * Clear all cached assets
 */
export async function clearAllCache(): Promise<void> {
  try {
    const index = await getCacheIndex();
    
    for (const assetId of index) {
      await SecureStore.deleteItemAsync(`${CACHE_PREFIX}${assetId}`);
    }
    
    await SecureStore.deleteItemAsync(CACHE_INDEX_KEY);
  } catch (error) {
    console.error('Failed to clear all cache:', error);
  }
}

/**
 * Get cache size (number of cached assets)
 */
export async function getCacheSize(): Promise<number> {
  try {
    const index = await getCacheIndex();
    return index.length;
  } catch {
    return 0;
  }
}
