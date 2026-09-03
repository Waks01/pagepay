/**
 * Offline storage for study assets and materials
 * Caches unlocked content and material metadata locally for offline access
 */

import * as SecureStore from "expo-secure-store";
import * as FileSystem from "expo-file-system";

const CACHE_PREFIX = "study_asset_";
const CACHE_INDEX_KEY = "study_asset_index";
const MATERIAL_CACHE_PREFIX = "study_material_";
const MATERIAL_CACHE_INDEX_KEY = "study_material_index";
const MATERIAL_FILE_DIR = FileSystem.cacheDirectory + "study_files/";

type CachedAsset = {
  assetId: number;
  content: unknown;
  unlockedAt: string;
  materialId: number;
};

type CachedMaterial = {
  id: number;
  title: string;
  exam_type: string | null;
  asset_types: string[];
  created_at: string;
  cachedAt: string;
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
    console.error("Failed to update cache index:", error);
  }
}

/**
 * Cache an unlocked asset
 */
export async function cacheAsset(
  assetId: number,
  content: unknown,
  materialId: number,
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
      JSON.stringify(cached),
    );

    // Update index
    const index = await getCacheIndex();
    if (!index.includes(assetId)) {
      await updateCacheIndex([...index, assetId]);
    }
  } catch (error) {
    console.error("Failed to cache asset:", error);
    // Don't throw - caching is optional
  }
}

/**
 * Get cached asset
 */
export async function getCachedAsset(
  assetId: number,
): Promise<CachedAsset | null> {
  try {
    const cached = await SecureStore.getItemAsync(`${CACHE_PREFIX}${assetId}`);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Failed to get cached asset:", error);
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
    console.error("Failed to get all cached assets:", error);
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
    await updateCacheIndex(index.filter((id) => id !== assetId));
  } catch (error) {
    console.error("Failed to clear asset cache:", error);
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
    console.error("Failed to clear all cache:", error);
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

// ── Material metadata cache ──────────────────────────────────────────

async function getMaterialCacheIndex(): Promise<number[]> {
  try {
    const index = await SecureStore.getItemAsync(MATERIAL_CACHE_INDEX_KEY);
    return index ? JSON.parse(index) : [];
  } catch {
    return [];
  }
}

async function updateMaterialCacheIndex(materialIds: number[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(
      MATERIAL_CACHE_INDEX_KEY,
      JSON.stringify(materialIds),
    );
  } catch (error) {
    console.error("Failed to update material cache index:", error);
  }
}

export async function cacheMaterialMetadata(material: {
  id: number;
  title: string;
  exam_type: string | null;
  asset_types: string[];
  created_at: string;
}): Promise<void> {
  try {
    const cached: CachedMaterial = {
      id: material.id,
      title: material.title,
      exam_type: material.exam_type,
      asset_types: material.asset_types || [],
      created_at: material.created_at,
      cachedAt: new Date().toISOString(),
    };

    await SecureStore.setItemAsync(
      `${MATERIAL_CACHE_PREFIX}${material.id}`,
      JSON.stringify(cached),
    );

    const index = await getMaterialCacheIndex();
    if (!index.includes(material.id)) {
      await updateMaterialCacheIndex([...index, material.id]);
    }
  } catch (error) {
    console.error("Failed to cache material metadata:", error);
  }
}

export async function getCachedMaterialMetadata(
  materialId: number,
): Promise<CachedMaterial | null> {
  try {
    const cached = await SecureStore.getItemAsync(
      `${MATERIAL_CACHE_PREFIX}${materialId}`,
    );
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    console.error("Failed to get cached material metadata:", error);
    return null;
  }
}

export async function getAllCachedMaterialMetadata(): Promise<
  CachedMaterial[]
> {
  try {
    const index = await getMaterialCacheIndex();
    const materials: CachedMaterial[] = [];

    for (const materialId of index) {
      const cached = await getCachedMaterialMetadata(materialId);
      if (cached) {
        materials.push(cached);
      }
    }

    return materials;
  } catch (error) {
    console.error("Failed to get all cached materials:", error);
    return [];
  }
}

export async function clearMaterialCache(materialId: number): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(`${MATERIAL_CACHE_PREFIX}${materialId}`);

    const index = await getMaterialCacheIndex();
    await updateMaterialCacheIndex(index.filter((id) => id !== materialId));
  } catch (error) {
    console.error("Failed to clear material cache:", error);
  }
}

export async function clearAllMaterialCache(): Promise<void> {
  try {
    const index = await getMaterialCacheIndex();

    for (const materialId of index) {
      await SecureStore.deleteItemAsync(
        `${MATERIAL_CACHE_PREFIX}${materialId}`,
      );
    }

    await SecureStore.deleteItemAsync(MATERIAL_CACHE_INDEX_KEY);
  } catch (error) {
    console.error("Failed to clear all material cache:", error);
  }
}

// ── Original file bytes cache ────────────────────────────────────────

function ensureMaterialFileDir(): void {
  const dir = new FileSystem.Directory(FileSystem.Paths.cache, "study_files");
  if (!dir.exists) {
    dir.create({ intermediates: true });
  }
}

export async function cacheMaterialFile(
  materialId: number,
  base64Data: string,
  mimeType: string,
): Promise<void> {
  try {
    ensureMaterialFileDir();
    const ext = mimeType.split("/")[1]?.split(";")[0] || "bin";
    const dir = new FileSystem.Directory(FileSystem.Paths.cache, "study_files");
    const file = new FileSystem.File(dir, `${materialId}.${ext}`);

    // Convert base64 to Uint8Array and write
    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    file.write(bytes);
  } catch (error) {
    console.error("Failed to cache material file:", error);
  }
}

export async function getCachedMaterialFileUri(
  materialId: number,
  mimeType?: string | null,
): Promise<string | null> {
  try {
    const dir = new FileSystem.Directory(FileSystem.Paths.cache, "study_files");
    if (!dir.exists) return null;

    const files = dir.list();
    const matchingFile = files.find(
      (item) =>
        item instanceof FileSystem.File &&
        item.name.startsWith(`${materialId}.`),
    );
    if (!matchingFile) return null;

    return matchingFile.uri;
  } catch (error) {
    console.error("Failed to get cached material file:", error);
    return null;
  }
}

export async function isMaterialFileCached(
  materialId: number,
): Promise<boolean> {
  try {
    const uri = await getCachedMaterialFileUri(materialId);
    return uri !== null;
  } catch {
    return false;
  }
}

export async function clearMaterialFileCache(
  materialId: number,
): Promise<void> {
  try {
    const uri = await getCachedMaterialFileUri(materialId);
    if (uri) {
      const file = new FileSystem.File(uri);
      file.delete();
    }
  } catch (error) {
    console.error("Failed to clear material file cache:", error);
  }
}

export async function clearAllMaterialFileCache(): Promise<void> {
  try {
    const dir = new FileSystem.Directory(FileSystem.Paths.cache, "study_files");
    if (dir.exists) {
      dir.delete();
    }
  } catch (error) {
    console.error("Failed to clear all material file cache:", error);
  }
}
