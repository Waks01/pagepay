import { useCallback, useState, useEffect } from 'react';
import { useFocusEffect, useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useMaterials, useUploadSow, useUploadSowImage, useUploadSowDocument, useClaimQuizBonus } from '@/src/features/study/hooks/use-study';
import { useImagePicker } from '@/src/shared/hooks/use-image-picker';
import { useDocumentPicker } from '@/src/shared/hooks/use-document-picker';
import { SowUploadCard } from '@/components/study/SowUploadCard';
import { AssetBrowser } from '@/components/study/AssetBrowser';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { PrimaryButton } from '@/components/PrimaryButton';
import { SkeletonPage } from '@/components/skeletons';
import { Skeleton } from '@/components/Skeleton';
import { cacheAsset, getCachedAsset } from '@/src/features/study/storage';
import { saveLastRoute, getLastRoute } from '@/src/shared/lib/screen-memory';

const STUDY_ROUTE_MEMORY_KEY = 'pagepay_study_selected_material';

// Error categorization helper
function categorizeError(message: string, operation: string, t: (key: string, params?: Record<string, unknown>) => string): string {
  if (message.includes('Network') || message.includes('fetch')) {
    return t('study.errors.server_starting');
  }
  if (message.includes('401') || message.includes('Unauthorized')) {
    return t('study.errors.session_expired');
  }
  if (message.includes('413') || message.includes('too large') || message.includes('size')) {
    return t('study.errors.file_too_large');
  }
  if (message.includes('format') || message.includes('type') || message.includes('invalid')) {
    return t('study.errors.invalid_format');
  }
  if (message.includes('quota') || message.includes('limit')) {
    return t('study.errors.rate_limit');
  }
  if (message.includes('500') || message.includes('Internal')) {
    return t('study.errors.server_error');
  }
  return t('study.errors.generic', { operation, message });
}

type AssetInfo = {
  id: number;
  type: string;
  points_to_unlock: number;
  created_at: string;
};

type MaterialDetail = {
  id: number;
  title: string;
  exam_type: string | null;
  parsed_structure: Record<string, unknown> | null;
  assets: AssetInfo[];
  created_at: string;
};

export default function StudyScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const materialsQ = useMaterials();
  const [selectedMaterialId, setSelectedMaterialId] = useState<number | null>(null);
  const [selectedMaterial, setSelectedMaterial] = useState<MaterialDetail | null>(null);
  const [unlockedAssets, setUnlockedAssets] = useState<Record<number, unknown>>({});
  const [generatingType, setGeneratingType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [bonusNotification, setBonusNotification] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | undefined>(undefined);
  const [studySessionId, setStudySessionId] = useState<number | null>(null);
  const [studyDuration, setStudyDuration] = useState<number>(0);
  const [examType, setExamType] = useState<string | null>(null);

  // Load cached assets on mount
  useEffect(() => {
    if (selectedMaterial) {
      loadCachedAssets(selectedMaterial.id);
      startStudySession(selectedMaterial.id);
    }
    
    return () => {
      if (studySessionId) {
        endStudySession(studySessionId);
      }
    };
  }, [selectedMaterial]);

  // Restore last selected material on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getLastRoute();
      if (saved && saved.startsWith('/study/materials/')) {
        const id = Number(saved.split('/').pop());
        if (!cancelled && !isNaN(id)) {
          handleMaterialPress(id);
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Persist selected material to route memory
  useEffect(() => {
    if (selectedMaterialId) {
      saveLastRoute(`/study/materials/${selectedMaterialId}`);
    }
  }, [selectedMaterialId]);

  const loadCachedAssets = async (materialId: number) => {
    try {
      if (!selectedMaterial) return;
      
      for (const asset of selectedMaterial.assets) {
        if (!(asset.id in unlockedAssets)) {
          const cached = await getCachedAsset(asset.id);
          if (cached && cached.materialId === materialId) {
            setUnlockedAssets((prev) => ({ ...prev, [asset.id]: cached.content }));
          }
        }
      }
    } catch (error) {
      if (__DEV__) console.error('Failed to load cached assets:', error);
    }
  };

  const startStudySession = async (materialId: number) => {
    try {
      const res = await apiFetch('/api/v1/study/session/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_id: materialId }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setStudySessionId(data.session_id);
      }
    } catch (error) {
      if (__DEV__) console.error('Failed to start study session:', error);
      // Don't throw - session tracking is optional
    }
  };

  const endStudySession = async (sessionId: number) => {
    try {
      const res = await apiFetch('/api/v1/study/session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setStudyDuration(data.duration_seconds);
      }
    } catch (error) {
      if (__DEV__) console.error('Failed to end study session:', error);
    }
  };

  const handleBack = () => {
    // End session when leaving material view
    if (studySessionId) {
      endStudySession(studySessionId);
      setStudySessionId(null);
    }
    setSelectedMaterialId(null);
    setSelectedMaterial(null);
  };

  const meQ = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      const res = await apiFetch('/api/v1/auth/me');
      if (!res.ok) throw new Error('Failed');
      return res.json() as Promise<{ points_balance: number }>;
    },
  });

  const uploadMutation = useUploadSow();
  const uploadImageMutation = useUploadSowImage();
  const uploadDocumentMutation = useUploadSowDocument();
  const { pickImage, takePhoto } = useImagePicker();
  const { pickDocument } = useDocumentPicker();
  const claimBonusMutation = useClaimQuizBonus();

  const handleUploadText = async (text: string, examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      // Client-side validation
      if (text.trim().length < 10) {
        throw new Error(t('study.errors.text_too_short'));
      }
      if (text.length > 50000) {
        throw new Error(t('study.errors.text_too_long'));
      }
      
      // Simulate initial progress
      setUploadProgress(20);
      const result = await uploadMutation.mutateAsync({ text, exam_type: examType });
      setUploadProgress(80);
      setSelectedMaterialId(result.material_id);
      const res = await apiFetch(`/api/v1/study/materials/${result.material_id}`);
      if (res.ok) {
        setSelectedMaterial(await res.json());
      }
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(undefined), 2000);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : 'Upload failed';
      const specificError = categorizeError(message, 'upload text', t);
      setError(specificError);
      setRetryAction(() => () => handleUploadText(text, examType));
    }
  };

  const handleUploadImage = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await pickImage();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }
      
      // Client-side file validation
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (file.uri && file.uri.startsWith('file://')) {
        // Check file size (only possible for local files)
        // Note: React Native doesn't provide direct file size access
        // This is a placeholder - actual implementation would need native module
      }
      
      // Validate file type
      const validTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
      if (file.type && !validTypes.includes(file.type.toLowerCase())) {
        throw new Error(t('study.errors.invalid_file_type'));
      }
      
      setUploadProgress(20);
      const result = await uploadImageMutation.mutateAsync({ file: { uri: file.uri, name: file.name, type: file.type }, exam_type: examType });
      setUploadProgress(80);
      setSelectedMaterialId(result.material_id);
      const res = await apiFetch(`/api/v1/study/materials/${result.material_id}`);
      if (res.ok) {
        setSelectedMaterial(await res.json());
      }
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(undefined), 2000);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : 'Upload failed';
      const specificError = categorizeError(message, 'image upload', t);
      setError(specificError);
      setRetryAction(() => () => handleUploadImage(examType));
    }
  };

  const handleTakePhoto = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await takePhoto();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }
      setUploadProgress(20);
      const result = await uploadImageMutation.mutateAsync({ file: { uri: file.uri, name: file.name, type: file.type }, exam_type: examType });
      setUploadProgress(80);
      setSelectedMaterialId(result.material_id);
      const res = await apiFetch(`/api/v1/study/materials/${result.material_id}`);
      if (res.ok) {
        setSelectedMaterial(await res.json());
      }
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(undefined), 2000);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : 'Upload failed';
      const specificError = categorizeError(message, 'photo upload', t);
      setError(specificError);
      setRetryAction(() => () => handleTakePhoto(examType));
    }
  };

  const handleUploadDocument = async (examType: string | null) => {
    setError(null);
    setRetryAction(null);
    setUploadProgress(0);
    try {
      const file = await pickDocument();
      if (!file) {
        setUploadProgress(undefined);
        return;
      }
      
      // Client-side file validation
      const validTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/msword'];
      if (file.type && !validTypes.includes(file.type.toLowerCase())) {
        throw new Error(t('study.errors.invalid_format'));
      }
      
      // Validate file extension as fallback
      const validExtensions = ['.pdf', '.docx', '.doc'];
      const hasValidExtension = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
      if (!hasValidExtension) {
        throw new Error(t('study.errors.invalid_format'));
      }
      
      setUploadProgress(20);
      const result = await uploadDocumentMutation.mutateAsync({ file: { uri: file.uri, name: file.name, type: file.type }, exam_type: examType });
      setUploadProgress(80);
      setSelectedMaterialId(result.material_id);
      const res = await apiFetch(`/api/v1/study/materials/${result.material_id}`);
      if (res.ok) {
        setSelectedMaterial(await res.json());
      }
      setUploadProgress(100);
      setTimeout(() => setUploadProgress(undefined), 2000);
    } catch (err) {
      setUploadProgress(undefined);
      const message = err instanceof Error ? err.message : 'Upload failed';
      const specificError = categorizeError(message, 'document upload', t);
      setError(specificError);
      setRetryAction(() => () => handleUploadDocument(examType));
    }
  };

  const handleGenerateAsset = async (materialId: number, assetType: string, count = 5) => {
    setGeneratingType(assetType);
    setError(null);
    setRetryAction(null);
    try {
      const res = await apiFetch('/api/v1/study/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ material_id: materialId, asset_type: assetType, count }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(err.detail || 'Generation failed');
      }
      const detailRes = await apiFetch(`/api/v1/study/materials/${materialId}`);
      if (detailRes.ok) {
        setSelectedMaterial(await detailRes.json());
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Generation failed';
      const specificError = categorizeError(message, `${assetType} generation`, t);
      setError(specificError);
      setRetryAction(() => () => handleGenerateAsset(materialId, assetType, count));
    } finally {
      setGeneratingType(null);
    }
  };

  const handleQuizComplete = async (assetId: number, score: number) => {
    try {
      const result = await claimBonusMutation.mutateAsync({ asset_id: assetId, score });
      if (result.bonus_awarded) {
        setBonusNotification(`+${result.bonus_points} pts! Score: ${score}%`);
        setTimeout(() => setBonusNotification(null), 4000);
      }
      qc.invalidateQueries({ queryKey: ['me'] });
    } catch {
      // silent fail — bonus is optional
    }
  };

  const handleUnlock = async (assetId: number, method: 'points' | 'ad') => {
    setError(null);
    setRetryAction(null);
    const res = await apiFetch('/api/v1/study/unlock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ asset_id: assetId, method }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ detail: res.statusText }));
      const message = err.detail || 'Unlock failed';
      const specificError = categorizeError(message, 'unlock', t);
      throw new Error(specificError);
    }
    const data = await res.json();
    if (data.unlocked && data.content) {
      setUnlockedAssets((prev) => ({ ...prev, [assetId]: data.content }));
      
      // Cache the unlocked asset for offline access
      if (selectedMaterialId) {
        try {
          await cacheAsset(assetId, data.content, selectedMaterialId);
        } catch (error) {
          if (__DEV__) console.error('Failed to cache unlocked asset:', error);
          // Don't throw - caching is optional
        }
      }
    }
    qc.invalidateQueries({ queryKey: ['me'] });
    return data;
  };

  const handleMaterialPress = async (materialId: number) => {
    setSelectedMaterialId(materialId);
    const res = await apiFetch(`/api/v1/study/materials/${materialId}`);
    if (res.ok) {
      const materialData = await res.json();
      setSelectedMaterial(materialData);
      
      // Load already unlocked assets from backend response
      const unlockedFromBackend: Record<number, unknown> = {};
      for (const asset of materialData.assets) {
        if (asset.unlocked && asset.content) {
          unlockedFromBackend[asset.id] = asset.content;
        }
      }
      setUnlockedAssets(unlockedFromBackend);
    } else {
      const data = await res.json().catch(() => ({}));
      setSelectedMaterial(null);
      setError(typeof data?.detail === 'string' ? data.detail : 'Failed to load material.');
    }
  };

  const handleChatPress = (materialId: number) => {
    router.push(`/study/chat/${materialId}`);
  };

  const materials = materialsQ.data ?? [];
  const balance = meQ.data?.points_balance ?? 0;
  const isLoading = materialsQ.isLoading;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={
          <RefreshControl refreshing={materialsQ.isFetching} onRefresh={() => qc.invalidateQueries({ queryKey: ['study', 'materials'] })} tintColor={tokens.mint} />
        }
      >
        <View style={styles.header}>
          <Text style={[styles.headline, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {selectedMaterial ? selectedMaterial.title : t('study.title')}
          </Text>
          {selectedMaterial && (
            <Text style={[styles.subline, { color: tokens.inkMuted }]}>
              {t('study.assets_generated', { count: selectedMaterial.assets.length })}
            </Text>
          )}
        </View>

        {error && (
          <View 
            style={[styles.errorBanner, { backgroundColor: tokens.signalSoft, borderColor: tokens.signal }]}
            accessibilityRole="alert"
            accessibilityLabel={`Error: ${error}`}
          >
            <Ionicons name="alert-circle-outline" size={18} color={tokens.signal} accessibilityLabel="" />
            <Text style={[styles.errorText, { color: tokens.signal }]}>{error}</Text>
            {retryAction && (
              <TouchableOpacity 
                onPress={retryAction} 
                style={[styles.retryBtn, { backgroundColor: tokens.signal }]}
                accessibilityRole="button"
                accessibilityLabel={t('study.retry')}
              >
                <Ionicons name="reload-outline" size={14} color="#fff" accessibilityLabel="" />
                <Text style={styles.retryText}>{t('study.retry')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity 
              onPress={() => {
                setError(null);
                setRetryAction(null);
              }}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel={t('study.dismiss')}
            >
              <Ionicons name="close" size={16} color={tokens.signal} accessibilityLabel="" />
            </TouchableOpacity>
          </View>
        )}

        {bonusNotification && (
          <View 
            style={[styles.bonusBanner, { backgroundColor: tokens.mintSoft, borderColor: tokens.mint }]}
            accessibilityRole="alert"
            accessibilityLabel={`Bonus earned: ${bonusNotification}`}
          >
            <Ionicons name="trophy-outline" size={18} color={tokens.mint} accessibilityLabel="" />
            <Text style={[styles.bonusText, { color: tokens.mint }]}>{bonusNotification}</Text>
            <TouchableOpacity 
              onPress={() => setBonusNotification(null)} 
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Dismiss bonus notification"
            >
              <Ionicons name="close" size={16} color={tokens.mint} accessibilityLabel="" />
            </TouchableOpacity>
          </View>
        )}

        {selectedMaterial ? (
          <View style={styles.detailView}>
            <View style={styles.detailActions}>
              <TouchableOpacity
                onPress={handleBack}
                style={[styles.backBtn, { borderColor: tokens.border }]}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel={t('study.all_materials')}
              >
                <Ionicons name="arrow-back" size={18} color={tokens.mint} accessibilityLabel="" />
                <Text style={[styles.backText, { color: tokens.mint }]}>{t('study.all_materials')}</Text>
              </TouchableOpacity>
              <View style={styles.chatBtn}>
                <PrimaryButton
                  title={t('study.chat_ai')}
                  onPress={() => handleChatPress(selectedMaterial.id)}
                />
              </View>
            </View>

            {selectedMaterial.parsed_structure && (
              <View style={[styles.outlineCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}>
                <Text style={[styles.outlineTitle, { color: tokens.ink }]}>{t('study.topics_covered')}</Text>
                {Object.entries(selectedMaterial.parsed_structure as Record<string, unknown>).length > 0 && (
                  <View style={styles.outlineList}>
                    {((selectedMaterial.parsed_structure as Record<string, unknown>).topics as Array<Record<string, unknown>> | undefined) &&
                 Array.isArray((selectedMaterial.parsed_structure as Record<string, unknown>).topics) &&
                 ((selectedMaterial.parsed_structure as Record<string, unknown>).topics as Array<Record<string, unknown>>).map((topic: Record<string, unknown>, idx: number) => (
                      <View key={idx} style={styles.outlineItem}>
                        <View style={[styles.outlineDot, { backgroundColor: tokens.mint }]} />
                        <Text style={[styles.outlineText, { color: tokens.ink }]}>
                          {String(topic.name)}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </View>
            )}

            <AssetBrowser
              assets={selectedMaterial.assets}
              userBalance={balance}
              onUnlock={handleUnlock}
              unlockedAssets={unlockedAssets}
              onQuizComplete={handleQuizComplete}
            />

            <View style={styles.generateRow}>
              <GenerateButton
                label={t('study.generate.mcqs')}
                icon="help-circle-outline"
                assetType="mcq"
                onPress={() => handleGenerateAsset(selectedMaterial.id, 'mcq', 5)}
                loading={generatingType === 'mcq'}
                tokens={tokens}
              />
              <GenerateButton
                label={t('study.generate.flashcards')}
                icon="albums-outline"
                assetType="flashcard"
                onPress={() => handleGenerateAsset(selectedMaterial.id, 'flashcard', 8)}
                loading={generatingType === 'flashcard'}
                tokens={tokens}
              />
              <GenerateButton
                label={t('study.generate.essays')}
                icon="document-text-outline"
                assetType="essay"
                onPress={() => handleGenerateAsset(selectedMaterial.id, 'essay', 3)}
                loading={generatingType === 'essay'}
                tokens={tokens}
              />
            </View>
          </View>
        ) : (
          <View style={styles.listView}>
            <SowUploadCard
              uploading={uploadMutation.isPending || uploadImageMutation.isPending || uploadDocumentMutation.isPending}
              uploadProgress={uploadProgress}
              examType={examType}
              onExamTypeChange={setExamType}
              onUploadText={handleUploadText}
              onUploadImage={handleUploadImage}
              onTakePhoto={handleTakePhoto}
              onUploadDocument={handleUploadDocument}
            />

            <TouchableOpacity
              onPress={() => router.push('/study/exam-mode')}
              style={[styles.examModeBtn, { backgroundColor: tokens.mint }]}
              accessibilityRole="button"
              accessibilityLabel="Start exam mode"
            >
              <Ionicons name="school-outline" size={20} color={tokens.mintText} />
              <Text style={[styles.examModeBtnText, { color: tokens.mintText }]}>Exam Mode</Text>
              <Ionicons name="chevron-forward" size={18} color={tokens.mintText} />
            </TouchableOpacity>

            <TouchableOpacity
              onPress={() => router.push('/study/srs-dashboard')}
              style={[styles.examModeBtn, { backgroundColor: tokens.card, borderColor: tokens.border, borderWidth: 1 }]}
              accessibilityRole="button"
              accessibilityLabel="Review dashboard"
            >
              <Ionicons name="repeat-outline" size={20} color={tokens.mint} />
              <Text style={[styles.examModeBtnText, { color: tokens.mint }]}>Review Due</Text>
              <Ionicons name="chevron-forward" size={18} color={tokens.mint} />
            </TouchableOpacity>

            {isLoading ? (
              <View style={styles.stateBlock}>
                <SkeletonPage count={3} header={false} />
              </View>
            ) : materials.length > 0 ? (
              <View style={styles.materialList}>
                <Text style={[styles.listTitle, { color: tokens.ink }]}>{t('study.your_materials')}</Text>
                {materials.map((m) => (
                  <TouchableOpacity
                    key={m.id}
                    onPress={() => handleMaterialPress(m.id)}
                    activeOpacity={0.7}
                    style={[styles.materialCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
                    accessibilityRole="button"
                    accessibilityLabel={`${m.title}, ${m.exam_type || 'custom'}, ${m.asset_types.join(', ')}, created ${new Date(m.created_at).toLocaleDateString()}`}
                    accessibilityHint="Open this study material"
                  >
                    <View style={[styles.materialIcon, { backgroundColor: tokens.mintSoft }]}>
                      <Ionicons name="book-outline" size={20} color={tokens.mint} accessibilityLabel="" />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={[styles.materialTitle, { color: tokens.ink }]} numberOfLines={1}>
                        {m.title}
                      </Text>
                      <Text style={[styles.materialMeta, { color: tokens.inkMuted }]}>
                        {(m.exam_type ? m.exam_type.toUpperCase() : 'CUSTOM')} · {m.asset_types.join(', ')} · {new Date(m.created_at).toLocaleDateString()}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={tokens.inkMuted} accessibilityLabel="" />
                  </TouchableOpacity>
                ))}
              </View>
            ) : (
              <View style={[styles.stateBlock, { borderColor: tokens.border }]}>
                <Ionicons name="school-outline" size={32} color={tokens.mint} />
                <Text style={[styles.stateText, { color: tokens.inkMuted }]}>
                  {t('study.upload_first')}
                </Text>
              </View>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function GenerateButton({
  label,
  icon,
  assetType,
  onPress,
  loading,
  tokens,
}: {
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  assetType: string;
  onPress: () => void;
  loading: boolean;
  tokens: (typeof PagePay)['light'];
}) {
  if (loading) {
    return (
      <View
        style={[
          styles.genBtn, 
          { 
            borderColor: tokens.border,
            backgroundColor: tokens.paper,
          }
        ]}
      >
        <View style={styles.genBtnShimmer}>
          <Skeleton width={20} height={20} borderRadius={10} />
          <Skeleton width={50} height={12} borderRadius={4} />
        </View>
      </View>
    );
  }

  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={loading}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={loading ? `Generating ${label}` : `Generate ${label}`}
      accessibilityState={{ disabled: loading, busy: loading }}
      accessibilityHint={`Generate new ${label} study materials`}
      style={[
        styles.genBtn, 
        { 
          borderColor: tokens.mint,
          backgroundColor: tokens.mintSoft,
        }
      ]}
    >
      <Ionicons name={icon} size={16} color={tokens.mint} accessibilityLabel="" />
      <Text style={[styles.genText, { color: tokens.mint, fontWeight: '600' }]} numberOfLines={1}>
        {label}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  header: {
    paddingTop: 8,
    paddingBottom: 16,
    gap: 4,
  },
  headline: {
    fontSize: 28,
    lineHeight: 34,
    letterSpacing: -0.5,
  },
  subline: {
    fontSize: 14,
    lineHeight: 20,
  },
  listView: {
    gap: 20,
  },
  detailView: {
    gap: 16,
  },
  detailActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  backText: {
    fontSize: 13,
    fontWeight: '600',
  },
  chatBtn: {
    flex: 1,
  },
  outlineCard: {
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  outlineTitle: {
    fontSize: 14,
    fontWeight: '600',
  },
  outlineList: {
    gap: 6,
  },
  outlineItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  outlineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  outlineText: {
    fontSize: 14,
    lineHeight: 18,
  },
  generateRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  genBtn: {
    minWidth: 42,
    flex: 1,
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingVertical: 5,
    paddingHorizontal: 2,
    borderRadius: 12,
    borderWidth: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 2,
  },
  genBtnShimmer: {
    alignItems: 'center',
    gap: 4,
  },
  genText: {
    fontSize: 13,
    letterSpacing: -0.2,
    textAlign: 'center',
  },
  materialList: {
    gap: 10,
  },
  listTitle: {
    fontSize: 18,
    fontWeight: '600',
    marginBottom: 4,
  },
  materialCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 14,
  },
  materialIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  materialTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  materialMeta: {
    fontSize: 12,
  },
  examModeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 14,
    marginBottom: 16,
  },
  examModeBtnText: {
    fontSize: 15,
    fontWeight: '700',
  },
  stateBlock: {
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 32,
    alignItems: 'center',
    gap: 8,
  },
  stateText: {
    fontSize: 13,
    textAlign: 'center',
  },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  errorText: {
    flex: 1,
    fontSize: 13,
    lineHeight: 18,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 8,
    marginRight: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  bonusBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderRadius: 12,
    borderWidth: 1,
    padding: 12,
  },
  bonusText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
  },
});
