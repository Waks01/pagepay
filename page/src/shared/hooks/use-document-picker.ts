import { useState } from 'react';
import * as DocumentPicker from 'expo-document-picker';

export function useDocumentPicker() {
  const [picking, setPicking] = useState(false);

  const pickDocument = async (): Promise<{ uri: string; name: string; type: string } | null> => {
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'text/plain', 'text/markdown'],
        copyToCacheDirectory: true,
      });
      if (result.canceled || !result.assets[0]) {
        return null;
      }
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        name: asset.name,
        type: asset.mimeType || 'application/octet-stream',
      };
    } finally {
      setPicking(false);
    }
  };

  return { pickDocument, picking };
}
