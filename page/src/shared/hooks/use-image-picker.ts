import { useState } from 'react';
import { launchCameraAsync, launchImageLibraryAsync, MediaTypeOptions, requestCameraPermissionsAsync } from 'expo-image-picker';

export function useImagePicker() {
  const [picking, setPicking] = useState(false);

  const pickImage = async (): Promise<{ uri: string; name: string; type: string } | null> => {
    setPicking(true);
    try {
      const result = await launchImageLibraryAsync({
        mediaTypes: MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) {
        return null;
      }
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      };
    } finally {
      setPicking(false);
    }
  };

  const takePhoto = async (): Promise<{ uri: string; name: string; type: string } | null> => {
    setPicking(true);
    try {
      // Request camera permission
      const { status } = await requestCameraPermissionsAsync();
      if (status !== 'granted') {
        return null;
      }
      
      const result = await launchCameraAsync({
        allowsEditing: true,
        quality: 0.8,
        base64: false,
      });
      if (result.canceled || !result.assets[0]) {
        return null;
      }
      const asset = result.assets[0];
      return {
        uri: asset.uri,
        name: `sow_${Date.now()}.jpg`,
        type: asset.type || 'image/jpeg',
      };
    } finally {
      setPicking(false);
    }
  };

  return { pickImage, takePhoto, picking };
}
