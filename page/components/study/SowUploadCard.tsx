import { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';

import { Fonts, PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { PagePaySpinner } from '@/components/PagePaySpinner';

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
    return <PagePaySpinner size={18} />;
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
  const { t } = useTranslation();
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
    { value: 'jamb', label: t('study.sow_upload.exam_types.jamb') },
    { value: 'waec', label: t('study.sow_upload.exam_types.waec') },
    { value: 'neco', label: t('study.sow_upload.exam_types.neco') },
    { value: 'nabteb', label: t('study.sow_upload.exam_types.nabteb') },
    { value: 'custom', label: t('study.sow_upload.exam_types.custom') },
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
      accessibilityLabel={t('study.sow_upload.a11y_card')}
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
            {t('study.sow_upload.title')}
          </Text>
          <Text style={[styles.subtitle, { color: tokens.inkMuted }]}>
            {t('study.sow_upload.subtitle')}
          </Text>
        </View>
      </View>

      <View style={styles.chipsRow}>
        {examTypes.map((et) => (
          <TouchableOpacity
            key={et.value}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel={t('study.sow_upload.exam_chip_a11y', { label: et.label })}
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
        placeholder={t('study.sow_upload.placeholder')}
        placeholderTextColor={tokens.inkFaint}
        multiline
        numberOfLines={3}
        value={text}
        onChangeText={setText}
        editable={!uploading}
        textAlignVertical="top"
        accessibilityLabel={t('study.sow_upload.input_a11y')}
        accessibilityHint={t('study.sow_upload.input_hint')}
      />

      {text.length > 0 && (
        <Text
          style={[
            styles.charCountText,
            { color: !isValid ? tokens.signal : tokens.inkMuted },
          ]}
        >
          {t('study.sow_upload.char_count', {
            count: charCount.toLocaleString(),
            max: maxChars.toLocaleString(),
          })}
          {charCount < minChars && ` ${t('study.sow_upload.char_min', { min: minChars })}`}
          {charCount > maxChars && ` ${t('study.sow_upload.char_exceeds')}`}
        </Text>
      )}

      {uploading && uploadProgress !== 100 && (
        <View style={styles.progressRow}>
          <UploadStatusIcon uploading={uploading} progress={uploadProgress} tokens={tokens} />
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={[styles.progressText, { color: tokens.inkMuted }]}>
              {uploadProgress !== undefined && uploadProgress < 100
                ? t('study.sow_upload.processing', { percent: uploadProgress })
                : t('study.sow_upload.processing_ellipsis')}
            </Text>
            <View
              style={[styles.progressBarTrack, { backgroundColor: tokens.border }]}
              accessibilityRole="progressbar"
              accessibilityValue={{ now: uploadProgress ?? 0, min: 0, max: 100 }}
            >
              <View
                style={[
                  styles.progressBarFill,
                  {
                    backgroundColor: tokens.mint,
                    width: `${Math.max(0, Math.min(100, uploadProgress ?? 0))}%`,
                  },
                ]}
              />
            </View>
          </View>
        </View>
      )}

      {uploadProgress === 100 && !uploading && (
        <View
          style={[styles.successRow, { backgroundColor: tokens.mintSoft }]}
          accessibilityLabel={t('study.sow_upload.success_a11y')}
          accessibilityRole="alert"
        >
          <Ionicons name="checkmark-circle" size={16} color={tokens.mint} accessibilityLabel="" />
          <Text style={[styles.successText, { color: tokens.mint }]}>{t('study.sow_upload.success')}</Text>
        </View>
      )}

      <PrimaryButton
        title={uploading ? t('study.sow_upload.submit_busy') : t('study.sow_upload.submit')}
        onPress={handleTextSubmit}
        loading={uploading}
        disabled={!isValid || uploading}
        style={styles.submit}
      />

      <View style={styles.modeRow}>
        <ModeButton
          icon="document"
          label={t('study.sow_upload.doc')}
          onPress={() => handleIconPress(() => onUploadDocument(examType))}
          disabled={uploading}
          tokens={tokens}
          a11y={t('study.sow_upload.doc_a11y')}
        />
        <ModeButton
          icon="images"
          label={t('study.sow_upload.image')}
          onPress={() => handleIconPress(() => onUploadImage(examType))}
          disabled={uploading}
          tokens={tokens}
          a11y={t('study.sow_upload.image_a11y')}
        />
        <ModeButton
          icon="camera"
          label={t('study.sow_upload.camera')}
          onPress={() => handleIconPress(() => onTakePhoto(examType))}
          disabled={uploading}
          tokens={tokens}
          a11y={t('study.sow_upload.camera_a11y')}
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
  a11y,
}: {
  icon: 'document' | 'images' | 'camera';
  label: string;
  onPress: () => void;
  disabled: boolean;
  tokens: any;
  a11y: string;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={a11y}
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
  progressBarTrack: {
    height: 6,
    borderRadius: 999,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    borderRadius: 999,
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
