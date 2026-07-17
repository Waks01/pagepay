import { useState, useEffect } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  FadeInDown,
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';

type SowUploadCardProps = {
  uploading: boolean;
  uploadProgress?: number;
  examType: string | null;
  onExamTypeChange: (examType: string | null) => void;
  onUploadText: (text: string, examType: string | null) => Promise<void>;
  onUploadImage: (examType: string | null) => Promise<void>;
  onTakePhoto: (examType: string | null) => Promise<void>;
  onUploadDocument: (examType: string | null) => Promise<void>;
};

const AnimatedTouchable = Animated.createAnimatedComponent(TouchableOpacity);

// Animated upload icon with pulse effect
function AnimatedUploadIcon({ uploading, progress, tokens }: { uploading: boolean; progress?: number; tokens: any }) {
  const scale = useSharedValue(1);
  const rotate = useSharedValue(0);

  useEffect(() => {
    if (uploading) {
      scale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 600, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
      rotate.value = withRepeat(
        withTiming(360, { duration: 2000, easing: Easing.linear }),
        -1,
        false
      );
    } else if (progress === 100) {
      // Success animation
      scale.value = withSequence(
        withSpring(1.3, { damping: 8, stiffness: 200 }),
        withSpring(1, { damping: 12, stiffness: 300 })
      );
      rotate.value = withTiming(0, { duration: 200 });
    } else {
      scale.value = withTiming(1, { duration: 200 });
      rotate.value = withTiming(0, { duration: 200 });
    }
  }, [uploading, progress]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { scale: scale.value },
      { rotate: `${rotate.value}deg` },
    ],
  }));

  if (progress === 100) {
    return (
      <Animated.View style={animatedStyle}>
        <Ionicons name="checkmark-circle" size={24} color={tokens.mint} />
      </Animated.View>
    );
  }

  return (
    <Animated.View style={animatedStyle}>
      <Ionicons name="cloud-upload-outline" size={24} color={tokens.mint} />
    </Animated.View>
  );
}

export function SowUploadCard({
  uploading,
  uploadProgress,
  examType,
  onExamTypeChange,
  onUploadText,
  onUploadImage,
  onTakePhoto,
  onUploadDocument,
}: SowUploadCardProps) {
  const [text, setText] = useState('');
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  
  const maxChars = 50000;
  const minChars = 10;
  const charCount = text.length;
  const isValid = charCount >= minChars && charCount <= maxChars;

  const handleTextSubmit = async () => {
    if (!text.trim() || uploading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await onUploadText(text.trim(), examType);
      setText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      // error handled by parent
    }
  };

  const handleIconPress = async (action: () => Promise<void>) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      await action();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }
  };

  const examTypes = [
    { value: 'jamb', label: 'JAMB' },
    { value: 'waec', label: 'WAEC' },
    { value: 'neco', label: 'NECO' },
    { value: 'nabteb', label: 'NABTEB' },
    { value: 'custom', label: 'Custom' },
  ];

  return (
    <Animated.View 
      entering={FadeInDown.duration(500).springify().damping(20).stiffness(200)}
      style={[styles.card, { backgroundColor: tokens.card, borderColor: tokens.border }]}
    >
      <View style={styles.headerRow} accessibilityLabel="Upload Scheme of Work">
        <AnimatedUploadIcon uploading={uploading} progress={uploadProgress} tokens={tokens} />
        <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
          Upload Study Material
        </Text>
      </View>
      <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
        Paste text, upload a photo, or attach a PDF. AI will structure it into topics and generate study assets.
      </Text>

      <View style={styles.examTypeRow}>
        <Text style={[styles.examTypeLabel, { color: tokens.inkMuted }]}>Exam type:</Text>
        <View style={styles.examTypeButtons}>
          {examTypes.map((et) => (
            <TouchableOpacity
              key={et.value}
              onPress={() => onExamTypeChange(examType === et.value ? null : et.value)}
              style={[
                styles.examTypeBtn,
                { 
                  borderColor: examType === et.value ? tokens.mint : tokens.border,
                  backgroundColor: examType === et.value ? tokens.mintSoft : 'transparent',
                }
              ]}
              accessibilityRole="button"
              accessibilityState={{ selected: examType === et.value }}
            >
              <Text style={[
                styles.examTypeBtnText,
                { color: examType === et.value ? tokens.mint : tokens.inkMuted }
              ]}>
                {et.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <TextInput
        style={[styles.textInput, { backgroundColor: tokens.paper, borderColor: tokens.border, color: tokens.ink }]}
        placeholder="Paste your SOW / syllabus text here..."
        placeholderTextColor={tokens.inkMuted}
        multiline
        numberOfLines={4}
        value={text}
        onChangeText={setText}
        editable={!uploading}
        textAlignVertical="top"
        accessibilityLabel="Scheme of work text input"
        accessibilityHint="Enter or paste your scheme of work text"
      />
      
      {text.length > 0 && (
        <View style={styles.charCounter}>
          <Text style={[
            styles.charCountText, 
            { 
              color: !isValid ? tokens.signal : charCount > maxChars * 0.9 ? tokens.inkMuted : tokens.inkMuted
            }
          ]}>
            {charCount.toLocaleString()} / {maxChars.toLocaleString()} characters
            {charCount < minChars && ` (min ${minChars})`}
            {charCount > maxChars && ' (exceeds limit)'}
          </Text>
        </View>
      )}

      {uploading && uploadProgress !== 100 && (
        <Animated.View entering={FadeInDown.duration(300)} style={styles.progressRow}>
          <ActivityIndicator size="small" color={tokens.mint} />
          <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
            Processing{uploadProgress !== undefined && uploadProgress < 100 ? ` ${uploadProgress}%` : '...'}
          </Text>
        </Animated.View>
      )}

      {uploadProgress === 100 && (
        <Animated.View 
          entering={FadeInDown.duration(400).springify()}
          style={[styles.successRow, { backgroundColor: tokens.mintSoft }]}
          accessibilityLabel="Upload successful"
          accessibilityRole="alert"
        >
          <Ionicons name="checkmark-circle" size={18} color={tokens.mint} accessibilityLabel="" />
          <Text style={[styles.successText, { color: tokens.mint }]}>Upload successful!</Text>
        </Animated.View>
      )}

      <View style={styles.buttonRow}>
        <View style={styles.uploadTextBtn}>
          <PrimaryButton
            title={uploading ? 'Processing...' : 'Upload Text'}
            onPress={handleTextSubmit}
            loading={uploading}
            disabled={!isValid || uploading}
          />
        </View>
        <View style={styles.iconButtons}>
          <AnimatedIconButton 
            icon="document"
            label="Doc"
            onPress={() => handleIconPress(() => onUploadDocument(examType))}
            disabled={uploading}
            tokens={tokens}
          />
          <AnimatedIconButton 
            icon="images"
            label="Image"
            onPress={() => handleIconPress(() => onUploadImage(examType))}
            disabled={uploading}
            tokens={tokens}
          />
          <AnimatedIconButton 
            icon="camera"
            label="Photo"
            onPress={() => handleIconPress(() => onTakePhoto(examType))}
            disabled={uploading}
            tokens={tokens}
          />
        </View>
      </View>
    </Animated.View>
  );
}

// Animated icon button with spring press effect
function AnimatedIconButton({ 
  icon, 
  label,
  onPress, 
  disabled, 
  tokens 
}: { 
  icon: keyof typeof Ionicons.glyphMap; 
  label: string;
  onPress: () => void; 
  disabled: boolean; 
  tokens: any;
}) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  const handlePress = () => {
    scale.value = withSequence(
      withTiming(0.9, { duration: 80 }),
      withSpring(1, { damping: 12, stiffness: 400 })
    );
    onPress();
  };

  const accessibilityLabels: Record<string, string> = {
    'document': 'Upload document (PDF or Word)',
    'images': 'Choose image from library',
    'camera': 'Take photo with camera',
  };

  return (
    <AnimatedTouchable
      onPress={handlePress}
      disabled={disabled}
      activeOpacity={1}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabels[icon] || 'Upload option'}
      accessibilityState={{ disabled }}
      style={[
        styles.iconBtn, 
        { borderColor: tokens.border, opacity: disabled ? 0.5 : 1 },
        animatedStyle,
      ]}
    >
      <Ionicons name={icon} size={20} color={tokens.mint} accessibilityLabel="" />
      <Text style={[styles.iconBtnLabel, { color: tokens.mint }]} numberOfLines={1}>
        {label}
      </Text>
    </AnimatedTouchable>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 20,
    gap: 12,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 18,
    letterSpacing: -0.3,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 18,
  },
  examTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  examTypeLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
  examTypeButtons: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  examTypeBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  examTypeBtnText: {
    fontSize: 12,
    fontWeight: '600',
  },
  textInput: {
    borderRadius: 12,
    borderWidth: 1,
    padding: 14,
    fontSize: 14,
    minHeight: 100,
    fontFamily: 'normal',
  },
  charCounter: {
    alignItems: 'flex-end',
    marginTop: -8,
  },
  charCountText: {
    fontSize: 11,
    fontWeight: '500',
  },
  progressRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 4,
  },
  progressText: {
    fontSize: 13,
  },
  successRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  successText: {
    fontSize: 13,
    fontWeight: '600',
  },
  buttonRow: {
    gap: 10,
  },
  uploadTextBtn: {
    marginBottom: 8,
  },
  iconButtons: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'space-between',
  },
  iconBtn: {
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 6,
    borderRadius: 12,
    borderWidth: 1,
  },
  iconBtnLabel: {
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
});
