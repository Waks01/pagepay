import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';

import { Fonts, PagePay } from '@/constants/theme';
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

// Upload-status icon — kept static (the editorial direction trades the
// old pulse/rotate for a calmer fade). Reads the upload state from
// `uploading` / `progress` only.
function UploadStatusIcon({ uploading, progress, tokens }: { uploading: boolean; progress?: number; tokens: any }) {
  if (progress === 100) {
    return <Ionicons name="checkmark-circle" size={22} color={tokens.mint} />;
  }
  if (uploading) {
    return <ActivityIndicator size="small" color={tokens.mint} />;
  }
  return <Ionicons name="cloud-upload-outline" size={22} color={tokens.mint} />;
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
      entering={FadeInDown.duration(400)}
      style={[
        styles.card,
        {
          borderColor: tokens.borderStrong,
          backgroundColor: tokens.card,
          // Faint mint gradient at the top edge — reads as a dropzone.
          // We can't use StyleSheet.create for this because `tokens`
          // resolves at runtime per scheme.
        },
      ]}
      accessibilityLabel="Upload Scheme of Work"
    >
      <View
        style={[
          styles.gradientOverlay,
          { backgroundColor: tokens.mintFaint },
        ]}
        pointerEvents="none"
      />

      <View style={styles.lead}>
        <View style={[styles.leadIcon, { backgroundColor: tokens.mint }]}>
          <Ionicons name="cloud-upload-outline" size={22} color={tokens.mintText} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={[styles.title, { color: tokens.ink, fontFamily: Fonts.editorialSemiBold as string }]}>
            Upload your syllabus
          </Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            Drop a photo, PDF, or paste text. We'll parse the topics, generate quizzes, and unlock spaced-repetition cards.
          </Text>
        </View>
      </View>

      <View style={styles.chipsRow}>
        {examTypes.map((et) => (
          <TouchableOpacity
            key={et.value}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={`Exam type ${et.label}`}
            accessibilityState={{ selected: examType === et.value }}
            onPress={() => onExamTypeChange(examType === et.value ? null : et.value)}
            style={[
              styles.chip,
              {
                backgroundColor: examType === et.value ? tokens.mintSoft : tokens.paper2,
                borderColor: examType === et.value ? tokens.mint : tokens.border,
              },
            ]}
          >
            <Text
              style={[
                styles.chipText,
                { color: examType === et.value ? tokens.mint : tokens.inkMuted },
              ]}
            >
              {et.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <TextInput
        style={[styles.textInput, { backgroundColor: tokens.card, borderColor: tokens.border, color: tokens.ink }]}
        placeholder="Paste your scheme of work or syllabus text…"
        placeholderTextColor={tokens.inkFaint}
        multiline
        numberOfLines={3}
        value={text}
        onChangeText={setText}
        editable={!uploading}
        textAlignVertical="top"
        accessibilityLabel="Scheme of work text input"
        accessibilityHint="Enter or paste your scheme of work text"
      />

      {text.length > 0 && (
        <Text
          style={[
            styles.charCountText,
            { color: !isValid ? tokens.signal : tokens.inkMuted },
          ]}
        >
          {charCount.toLocaleString()} / {maxChars.toLocaleString()} characters
          {charCount < minChars && ` (min ${minChars})`}
          {charCount > maxChars && ' (exceeds limit)'}
        </Text>
      )}

      {uploading && uploadProgress !== 100 && (
        <View style={styles.progressRow}>
          <UploadStatusIcon uploading={uploading} progress={uploadProgress} tokens={tokens} />
          <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
            Processing{uploadProgress !== undefined && uploadProgress < 100 ? ` ${uploadProgress}%` : '…'}
          </Text>
        </View>
      )}

      {uploadProgress === 100 && (
        <View
          style={[styles.successRow, { backgroundColor: tokens.mintSoft }]}
          accessibilityLabel="Upload successful"
          accessibilityRole="alert"
        >
          <Ionicons name="checkmark-circle" size={16} color={tokens.mint} accessibilityLabel="" />
          <Text style={[styles.successText, { color: tokens.mint }]}>Upload successful!</Text>
        </View>
      )}

      <PrimaryButton
        title={uploading ? 'Processing…' : 'Upload text'}
        onPress={handleTextSubmit}
        loading={uploading}
        disabled={!isValid || uploading}
        style={styles.submit}
      />

      <View style={styles.modeRow}>
        <ModeButton
          icon="document"
          label="PDF / Doc"
          onPress={() => handleIconPress(() => onUploadDocument(examType))}
          disabled={uploading}
          tokens={tokens}
        />
        <ModeButton
          icon="images"
          label="Image"
          onPress={() => handleIconPress(() => onUploadImage(examType))}
          disabled={uploading}
          tokens={tokens}
        />
        <ModeButton
          icon="camera"
          label="Camera"
          onPress={() => handleIconPress(() => onTakePhoto(examType))}
          disabled={uploading}
          tokens={tokens}
        />
      </View>
    </Animated.View>
  );
}

// Press-scale icon button used for the three upload-mode tiles.
// Kept light: a Pressable with a manual transform (no reanimated) so
// the bundle stays smaller and the visual change is minimal.
function ModeButton({
  icon,
  label,
  onPress,
  disabled,
  tokens,
}: {
  icon: 'document' | 'images' | 'camera';
  label: string;
  onPress: () => void;
  disabled: boolean;
  tokens: any;
}) {
  const accessibilityLabels: Record<string, string> = {
    document: 'Upload document (PDF or Word)',
    images: 'Choose image from library',
    camera: 'Take photo with camera',
  };
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabels[icon] || 'Upload option'}
      accessibilityState={{ disabled }}
      style={[
        styles.modeBtn,
        {
          backgroundColor: tokens.card,
          borderColor: tokens.border,
          opacity: disabled ? 0.5 : 1,
        },
      ]}
    >
      <Ionicons name={icon} size={18} color={tokens.mint} />
      <Text style={[styles.modeLabel, { color: tokens.mint }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    padding: 20,
    gap: 14,
    overflow: 'hidden',
    position: 'relative',
  },
  gradientOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: 80,
    opacity: 0.55,
  },
  lead: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 14,
  },
  leadIcon: {
    width: 44,
    height: 44,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  title: {
    fontSize: 19,
    letterSpacing: -0.3,
    margin: 0,
  },
  subtitle: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 6,
    flexWrap: 'wrap',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: 'transparent',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  textInput: {
    borderRadius: 8,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    minHeight: 88,
    fontFamily: 'normal',
  },
  charCountText: {
    fontSize: 11,
    fontWeight: '500',
    marginTop: -8,
    textAlign: 'right',
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
  submit: {
    marginTop: 2,
  },
  modeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  modeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 12,
    paddingHorizontal: 10,
    borderRadius: 8,
    borderWidth: 1,
  },
  modeLabel: {
    fontSize: 12,
    fontWeight: '500',
    textAlign: 'center',
  },
});
