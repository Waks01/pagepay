import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system';

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
        const cachedUri = FileSystem.cacheDirectory + name;
        try {
          await FileSystem.copyAsync({
            from: uri,
            to: cachedUri,
          });
          uri = cachedUri;
          const info = await FileSystem.getInfoAsync(uri, { size: true });
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
