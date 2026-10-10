import { useState } from 'react';
import { launchCameraAsync, launchImageLibraryAsync, requestCameraPermissionsAsync } from 'expo-image-picker';

export function useImagePicker() {
  const [picking, setPicking] = useState(false);

  const pickImages = async (): Promise<Array<{ uri: string; name: string; type: string; size: number | null }> | null> => {
    setPicking(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: false,
        allowsMultipleSelection: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets || result.assets.length === 0) {
        console.log("[useImagePicker] pickImages canceled or no asset");
        return null;
      }
      return result.assets.map((asset, i) => {
        const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
        const mimeMap: Record<string, string> = {
          jpg: 'image/jpeg', jpeg: 'image/jpeg',
          png: 'image/png', webp: 'image/webp',
        };
        return {
          uri: asset.uri,
          name: `sow_${Date.now()}_${i}.jpg`,
          type: mimeMap[ext] || (asset.type?.startsWith('image') ? 'image/jpeg' : 'image/jpeg'),
          size: typeof (asset as any).fileSize === 'number' ? (asset as any).fileSize as number : null,
        };
      });
    } finally {
      setPicking(false);
    }
  };

  const pickImage = async (): Promise<{ uri: string; name: string; type: string; size: number | null } | null> => {
    setPicking(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: 'images',
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) {
        console.log("[useImagePicker] pickImage canceled or no asset");
        return null;
      }
      const asset = result.assets[0];
      // expo-image-picker returns asset.type as "image" on some platforms
      // instead of a proper mime type. Derive from the file extension.
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', webp: 'image/webp',
      };
      const picked = {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: mimeMap[ext] || (asset.type?.startsWith('image') ? 'image/jpeg' : 'image/jpeg'),
        size: typeof (asset as any).fileSize === 'number' ? (asset as any).fileSize as number : null,
      };
      console.log("[useImagePicker] pickImage picked", picked);
      return picked;
    } finally {
      setPicking(false);
    }
  };

  const takePhoto = async (): Promise<{ uri: string; name: string; type: string; size: number | null } | null> => {
    setPicking(true);
    try {
      // Request camera permission
      const { status } = await requestCameraPermissionsAsync();
      if (status !== 'granted') {
        console.log("[useImagePicker] takePhoto permission denied");
        return null;
      }

      const result = await launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) {
        console.log("[useImagePicker] takePhoto canceled or no asset");
        return null;
      }
      const asset = result.assets[0];
      // expo-image-picker returns asset.type as "image" on some platforms
      // instead of a proper mime type. Derive from the file extension.
      const ext = (asset.uri.split('.').pop() || 'jpg').toLowerCase();
      const mimeMap: Record<string, string> = {
        jpg: 'image/jpeg', jpeg: 'image/jpeg',
        png: 'image/png', webp: 'image/webp',
      };
      const picked = {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: mimeMap[ext] || (asset.type?.startsWith('image') ? 'image/jpeg' : 'image/jpeg'),
        size: typeof (asset as any).fileSize === 'number' ? (asset as any).fileSize as number : null,
      };
      console.log("[useImagePicker] takePhoto picked", picked);
      return picked;
    } finally {
      setPicking(false);
    }
  };

  return { pickImage, pickImages, takePhoto, picking };
}
