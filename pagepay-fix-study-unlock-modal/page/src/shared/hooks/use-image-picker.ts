import { useState } from 'react';
import { launchCameraAsync, launchImageLibraryAsync, MediaType, requestCameraPermissionsAsync } from 'expo-image-picker';

export function useImagePicker() {
  const [picking, setPicking] = useState(false);

  const pickImage = async (): Promise<{ uri: string; name: string; type: string; size: number | null } | null> => {
    setPicking(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: MediaType.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) {
        console.log("[useImagePicker] pickImage canceled or no asset");
        return null;
      }
      const asset = result.assets[0];
      const picked = {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
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
      const picked = {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
        size: typeof (asset as any).fileSize === 'number' ? (asset as any).fileSize as number : null,
      };
      console.log("[useImagePicker] takePhoto picked", picked);
      return picked;
    } finally {
      setPicking(false);
    }
  };

  return { pickImage, takePhoto, picking };
}
