/**
 * Phase 3 & 4: Ad Gating Hook
 * 
 * Determines whether ads should be shown based on:
 * - Content type (novels vs study materials)
 * - User tier (free vs premium)
 * - .env configuration
 */

import { useEffect, useState } from 'react';
import { getContentAdGating } from '@/src/shared/api/client';

export interface AdGatingInfo {
  contentId: number;
  contentSource: string | null;
  contentType: string;
  userTier: string;
  isAdFreeContent: boolean;  // True for study materials
  canSkipPreReadAd: boolean;  // Premium can skip on novels
  canSkipPostReadAd: boolean;
  canSkipFeedAds: boolean;
  showPreReadAd: boolean;     // Computed: should ad be shown
  showPostReadAd: boolean;
}

/**
 * Hook to get ad gating information for a specific content
 */
export function useAdGating(contentId: number | null) {
  const [adGating, setAdGating] = useState<AdGatingInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contentId) {
      setLoading(false);
      return;
    }

    let mounted = true;

    async function fetchAdGating() {
      try {
        const data = await getContentAdGating(contentId);
        if (mounted) {
          setAdGating({
            contentId: data.content_id,
            contentSource: data.content_source,
            contentType: data.content_type,
            userTier: data.user_tier,
            isAdFreeContent: data.is_ad_free_content,
            canSkipPreReadAd: data.can_skip_pre_read_ad,
            canSkipPostReadAd: data.can_skip_post_read_ad,
            canSkipFeedAds: data.can_skip_feed_ads,
            showPreReadAd: data.show_pre_read_ad,
            showPostReadAd: data.show_post_read_ad,
          });
          setError(null);
        }
      } catch (err) {
        if (mounted) {
          setError(err instanceof Error ? err.message : 'Failed to load ad gating');
          // Default to showing ads on error (safe default)
          setAdGating({
            contentId: contentId,
            contentSource: null,
            contentType: 'unknown',
            userTier: 'free',
            isAdFreeContent: false,
            canSkipPreReadAd: false,
            canSkipPostReadAd: false,
            canSkipFeedAds: false,
            showPreReadAd: true,
            showPostReadAd: true,
          });
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    }

    fetchAdGating();

    return () => {
      mounted = false;
    };
  }, [contentId]);

  return { adGating, loading, error };
}

/**
 * Helper to determine if any ads should be shown for content
 */
export function shouldShowAnyAds(adGating: AdGatingInfo | null): boolean {
  if (!adGating) return true; // Default to showing ads
  return adGating.showPreReadAd || adGating.showPostReadAd;
}

/**
 * Helper to get ad display message for user
 */
export function getAdMessage(adGating: AdGatingInfo | null): string {
  if (!adGating) return '';
  
  if (adGating.isAdFreeContent) {
    return 'Study materials are ad-free for everyone';
  }
  
  if (adGating.userTier !== 'free') {
    // Premium user
    if (adGating.canSkipPreReadAd) {
      return 'Premium: Skip ads or watch for bonus points';
    }
  }
  
  // Free user on novels
  return 'Watch ads to earn points';
}
