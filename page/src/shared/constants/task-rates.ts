/** Frontend task rate constants.

 *  These values mirror the backend `TASK_BASE_RATES_KOB` mapping and
 *  are used as a local fallback when the `/api/v1/config/platform`
 *  endpoint is unreachable. They should be kept in sync with
 *  `backend/app/constants/task_rates.py`.
 */

export type TaskRateMap = Record<string, number>;

export const TASK_BASE_RATES_KOB: TaskRateMap = {
  youtube_subscribe: 15_000,
  youtube_like: 5_000,
  youtube_watch: 10_000,
  youtube_comment: 30_000,
  youtube_share: 10_000,
  instagram_follow: 15_000,
  instagram_like: 5_000,
  instagram_comment: 30_000,
  instagram_repost: 10_000,
  tiktok_follow: 15_000,
  tiktok_like: 5_000,
  tiktok_comment: 30_000,
  tiktok_share: 10_000,
  twitter_follow: 15_000,
  twitter_like: 5_000,
  twitter_retweet: 10_000,
  twitter_comment: 30_000,
  twitter_share: 10_000,
  facebook_follow: 15_000,
  facebook_like: 5_000,
  linkedin_follow: 15_000,
  linkedin_like: 5_000,
  linkedin_comment: 30_000,
  pinterest_follow: 15_000,
  pinterest_like: 5_000,
  pinterest_repin: 10_000,
  pinterest_comment: 30_000,
  telegram_join: 10_000,
  telegram_view: 5_000,
  snapchat_add_friend: 15_000,
  snapchat_view_story: 5_000,
  reddit_follow: 15_000,
  reddit_upvote: 5_000,
  reddit_comment: 30_000,
  discord_join_server: 10_000,
  discord_verify: 5_000,
  discord_message: 30_000,
};

export const YOUTUBE_TASK_TYPES = [
  'subscribe',
  'like',
  'watch',
  'comment',
] as const;

export type YoutubeTaskType = typeof YOUTUBE_TASK_TYPES[number];
