import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
// expo-file-system v54+ moved these methods out of the root export: the
// root re-exports them only to throw in runtime ("This method will throw
// in runtime"). The legacy subpath is the working implementation, so the
// copy/cache path must import from it.
import * as FileSystem from 'expo-file-system/legacy';

import { cacheDirectory } from '@/src/shared/lib/file-paths';

export function useDocumentPicker() {
  const [picking, setPicking] = useState(false);

  const pickDocument = async (): Promise<{ uri: string; name: string; type: string; size: number | null } | null> => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'text/markdown'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) {
        console.log("[useDocumentPicker] pickDocument canceled or no asset");
        return null;
      }
      const asset = result.assets[0];
      
      let uri = asset.uri;
      let name = asset.name;
      let size = typeof asset.size === 'number' ? asset.size : null;
      
      if (uri.startsWith('content://')) {
        const cachedUri = cacheDirectory + name;
        try {
          await FileSystem.copyAsync({
            from: uri,
            to: cachedUri,
          });
          uri = cachedUri;
          const info = await FileSystem.getInfoAsync(uri);
          if (info.exists && info.size) {
            size = info.size;
          }
        } catch (copyError) {
          console.error('[useDocumentPicker] copy failed:', copyError);
        }
      }
      
      const picked = {
        uri,
        name,
        type: asset.mimeType || 'application/octet-stream',
        size,
      };
      console.log("[useDocumentPicker] pickDocument picked", picked);
      return picked;
    } finally {
      setPicking(false);
    }
  };

  return { pickDocument, picking };
}
