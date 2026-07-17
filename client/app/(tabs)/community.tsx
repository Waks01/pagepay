import { useCallback, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { apiFetch } from '@/src/shared/api/client';
import { useCommunityFeed, useToggleLike, useUploadCommunityNote } from '@/src/features/community/hooks/use-community';
import type { CommunityFeedItem } from '@/src/features/community/api';
import { PagePay } from '@/constants/theme';
import { useEffectiveScheme } from '@/src/shared/hooks/use-effective-scheme';
import { SkeletonPage } from '@/components/skeletons';

type Filters = 'all' | 'my_courses' | 'popular' | 'recent';

export default function CommunityScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const scheme = useEffectiveScheme();
  const tokens = PagePay[scheme];
  const qc = useQueryClient();

  const [filter, setFilter] = useState<Filters>('all');
  const [showUpload, setShowUpload] = useState(false);
  const [uploadTitle, setUploadTitle] = useState('');
  const [uploadContent, setUploadContent] = useState('');
  const [uploadCourse, setUploadCourse] = useState('');
  const [refreshing, setRefreshing] = useState(false);

  const FILTERS: { key: Filters; label: string }[] = [
    { key: 'all', label: t('community.filter_all') },
    { key: 'my_courses', label: t('community.filter_my_courses') },
    { key: 'popular', label: t('community.filter_popular') },
    { key: 'recent', label: t('community.filter_recent') },
  ];

  const sort = filter === 'popular' ? 'popular' : 'recent';
  const courseCode = filter === 'my_courses' ? undefined : undefined;

  const feedQ = useCommunityFeed({
    sort,
    limit: 20,
    offset: 0,
  });

  const likeMutation = useToggleLike();
  const uploadMutation = useUploadCommunityNote();

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['community', 'feed'] });
    setRefreshing(false);
  }, [qc]);

  const handleLike = useCallback(async (noteId: number) => {
    try {
      await likeMutation.mutateAsync(noteId);
    } catch {
      // silent
    }
  }, [likeMutation]);

  const handleUpload = useCallback(async () => {
    if (!uploadTitle.trim() || !uploadContent.trim()) return;
    try {
      await uploadMutation.mutateAsync({
        title: uploadTitle.trim(),
        content: uploadContent.trim(),
        course_code: uploadCourse.trim() || undefined,
      });
      setUploadTitle('');
      setUploadContent('');
      setUploadCourse('');
      setShowUpload(false);
    } catch {
      // silent
    }
  }, [uploadMutation, uploadTitle, uploadContent, uploadCourse]);

  const notes = feedQ.data ?? [];

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: tokens.paper }}>
      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={tokens.mint} />}
      >
        <View style={[styles.header, { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 8 }]}>
          <Text style={[styles.title, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]}>
            {t('community.title')}
          </Text>
          <TouchableOpacity
            onPress={() => setShowUpload(!showUpload)}
            style={[styles.uploadBtn, { backgroundColor: tokens.mint }]}
            activeOpacity={0.7}
          >
            <Ionicons name="add" size={20} color={tokens.mintText} />
          </TouchableOpacity>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingHorizontal: 16, marginBottom: 12 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {FILTERS.map((f) => (
              <TouchableOpacity
                key={f.key}
                onPress={() => setFilter(f.key)}
                activeOpacity={0.7}
                style={[
                  styles.chip,
                  {
                    backgroundColor: filter === f.key ? tokens.mint : tokens.card,
                    borderColor: filter === f.key ? tokens.mint : tokens.border,
                  },
                ]}
              >
                <Text style={[styles.chipText, { color: filter === f.key ? tokens.mintText : tokens.ink }]}>
                  {f.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </ScrollView>

        {showUpload && (
          <View style={[styles.uploadCard, { backgroundColor: tokens.card, borderColor: tokens.border, marginHorizontal: 16, marginBottom: 12 }]}>
            <Text style={[styles.uploadTitle, { color: tokens.ink }]}>{t('community.share_note')}</Text>
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, borderColor: tokens.border, color: tokens.ink }]}
              placeholder={t('community.title_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={uploadTitle}
              onChangeText={setUploadTitle}
            />
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, borderColor: tokens.border, color: tokens.ink, minHeight: 80 }]}
              placeholder={t('community.content_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={uploadContent}
              onChangeText={setUploadContent}
              multiline
              textAlignVertical="top"
            />
            <TextInput
              style={[styles.input, { backgroundColor: tokens.paper, borderColor: tokens.border, color: tokens.ink }]}
              placeholder={t('community.course_placeholder')}
              placeholderTextColor={tokens.inkMuted}
              value={uploadCourse}
              onChangeText={setUploadCourse}
            />
            <TouchableOpacity
              onPress={handleUpload}
              disabled={uploadMutation.isPending}
              style={[styles.submitBtn, { backgroundColor: tokens.mint, opacity: uploadMutation.isPending ? 0.6 : 1 }]}
              activeOpacity={0.7}
            >
              <Text style={[styles.submitText, { color: tokens.mintText }]}>
                {uploadMutation.isPending ? t('community.posting') : t('community.post_button')}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        {feedQ.isLoading ? (
          <SkeletonPage count={3} header={false} />
        ) : notes.length === 0 ? (
          <View style={{ paddingVertical: 48, alignItems: 'center', paddingHorizontal: 32 }}>
            <Ionicons name="people-outline" size={40} color={tokens.mint} />
            <Text style={[styles.emptyText, { color: tokens.inkMuted, marginTop: 8 }]}>
              {t('community.empty_title')}
            </Text>
          </View>
        ) : (
          <View style={{ paddingHorizontal: 16, gap: 12, paddingBottom: 48 }}>
            {notes.map((note: CommunityFeedItem) => (
              <View
                key={note.id}
                style={[styles.noteCard, { backgroundColor: tokens.card, borderColor: tokens.border }]}
              >
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.noteTitle, { color: tokens.ink, fontFamily: 'SpaceGrotesk_700Bold' }]} numberOfLines={2}>
                      {note.title}
                    </Text>
                    <Text style={[styles.noteMeta, { color: tokens.inkMuted }]}>
                      {note.author_name ?? t('community.anonymous')}
                      {note.course_code ? ` · ${note.course_code}` : ''}
                      {note.university ? ` · ${note.university}` : ''}
                    </Text>
                    <Text style={[styles.noteDate, { color: tokens.inkMuted }]}>
                      {new Date(note.created_at).toLocaleDateString()}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => handleLike(note.id)}
                    activeOpacity={0.7}
                    style={[styles.likeBtn, { borderColor: tokens.border }]}
                  >
                    <Ionicons
                      name={note.is_liked ? 'heart' : 'heart-outline'}
                      size={18}
                      color={note.is_liked ? tokens.signal : tokens.inkMuted}
                    />
                    <Text style={[styles.likeCount, { color: note.is_liked ? tokens.signal : tokens.inkMuted }]}>
                      {note.likes_count}
                    </Text>
                  </TouchableOpacity>
                </View>
                <Text style={[styles.noteContent, { color: tokens.ink }]} numberOfLines={4}>
                  {note.content}
                </Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    fontSize: 24,
    letterSpacing: -0.5,
  },
  uploadBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
  },
  chipText: {
    fontSize: 13,
    fontWeight: '600',
  },
  uploadCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 10,
  },
  uploadTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  submitBtn: {
    paddingVertical: 12,
    borderRadius: 12,
    alignItems: 'center',
  },
  submitText: {
    fontSize: 14,
    fontWeight: '700',
  },
  noteCard: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 16,
    gap: 8,
  },
  noteTitle: {
    fontSize: 15,
    lineHeight: 20,
  },
  noteMeta: {
    fontSize: 12,
    lineHeight: 16,
  },
  noteDate: {
    fontSize: 11,
    lineHeight: 14,
    marginTop: 2,
  },
  noteContent: {
    fontSize: 13,
    lineHeight: 18,
    marginTop: 4,
  },
  likeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  likeCount: {
    fontSize: 12,
    fontWeight: '600',
  },
  emptyText: {
    fontSize: 14,
    textAlign: 'center',
  },
});
