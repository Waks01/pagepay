/**
 * Task templates for sponsor and admin task creation.
 *
 * Each template defines a recommended configuration for a specific
 * task_type within a category. The sponsor/admin create screens can
 * use these as starting points or quick-select options.
 */

export type TaskTemplate = {
  task_type: string;
  label: string;
  description: string;
  suggested_proof_type: 'screenshot' | 'link' | 'text' | 'photo' | 'video' | 'none';
  suggested_time_limit_minutes: number | null;
  suggested_reward_kobo: number;
  instructions_template: string;
};

export type CategoryTemplate = {
  category: string;
  label: string;
  icon: string;
  templates: TaskTemplate[];
};

export const TASK_TEMPLATES: CategoryTemplate[] = [
  {
    category: 'social_media',
    label: 'Social Media',
    icon: 'people-outline',
    templates: [
      {
        task_type: 'twitter_follow',
        label: 'Follow on Twitter/X',
        description: 'Follow the sponsor account on Twitter/X',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Open Twitter/X and search for @{account}\n2. Click "Follow"\n3. Take a screenshot showing you are following',
      },
      {
        task_type: 'twitter_like',
        label: 'Like a Tweet',
        description: 'Like a specific tweet from the sponsor',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 5000,
        instructions_template: '1. Open the tweet at {url}\n2. Click the heart icon to like\n3. Take a screenshot showing the liked tweet',
      },
      {
        task_type: 'twitter_retweet',
        label: 'Retweet',
        description: 'Retweet a post to your timeline',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 8000,
        instructions_template: '1. Open the tweet at {url}\n2. Click the retweet icon\n3. Take a screenshot showing the retweet',
      },
      {
        task_type: 'twitter_comment',
        label: 'Comment on a Tweet',
        description: 'Leave a comment on a tweet',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 3,
        suggested_reward_kobo: 10000,
        instructions_template: '1. Open the tweet at {url}\n2. Click "Reply" and type: "{comment}"\n3. Submit and take a screenshot',
      },
      {
        task_type: 'instagram_follow',
        label: 'Follow on Instagram',
        description: 'Follow the sponsor Instagram account',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Open Instagram and search for @{account}\n2. Tap "Follow"\n3. Take a screenshot showing you are following',
      },
      {
        task_type: 'instagram_like',
        label: 'Like a Post',
        description: 'Like a specific Instagram post',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 5000,
        instructions_template: '1. Open the post at {url}\n2. Double-tap or tap the heart icon\n3. Take a screenshot showing the liked post',
      },
      {
        task_type: 'instagram_comment',
        label: 'Comment on a Post',
        description: 'Leave a comment on an Instagram post',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 3,
        suggested_reward_kobo: 10000,
        instructions_template: '1. Open the post at {url}\n2. Tap "Add a comment..." and type: "{comment}"\n3. Post and take a screenshot',
      },
      {
        task_type: 'tiktok_follow',
        label: 'Follow on TikTok',
        description: 'Follow the sponsor TikTok account',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Open TikTok and search for @{account}\n2. Tap "Follow"\n3. Take a screenshot showing you are following',
      },
      {
        task_type: 'youtube_subscribe',
        label: 'Subscribe to YouTube Channel',
        description: 'Subscribe to the sponsor YouTube channel',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Open YouTube and go to {url}\n2. Click "Subscribe"\n3. Take a screenshot showing the subscribed state',
      },
      {
        task_type: 'youtube_like',
        label: 'Like a YouTube Video',
        description: 'Like a specific YouTube video',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 5000,
        instructions_template: '1. Open the video at {url}\n2. Click the like button\n3. Take a screenshot showing the liked video',
      },
      {
        task_type: 'youtube_comment',
        label: 'Comment on a Video',
        description: 'Leave a comment on a YouTube video',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 3,
        suggested_reward_kobo: 10000,
        instructions_template: '1. Open the video at {url}\n2. Scroll to comments and type: "{comment}"\n3. Submit and take a screenshot',
      },
      {
        task_type: 'facebook_like',
        label: 'Like a Facebook Page',
        description: 'Like the sponsor Facebook page',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 10000,
        instructions_template: '1. Open Facebook and go to {url}\n2. Click "Like"\n3. Take a screenshot showing the liked page',
      },
      {
        task_type: 'linkedin_follow',
        label: 'Follow on LinkedIn',
        description: 'Follow the sponsor LinkedIn company page',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 12000,
        instructions_template: '1. Open LinkedIn and go to {url}\n2. Click "Follow"\n3. Take a screenshot showing you are following',
      },
      {
        task_type: 'telegram_join',
        label: 'Join Telegram Channel',
        description: 'Join the sponsor Telegram channel or group',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 10000,
        instructions_template: '1. Open Telegram and join {url}\n2. Take a screenshot showing you are a member',
      },
    ],
  },
  {
    category: 'engagement',
    label: 'Engagement',
    icon: 'heart-outline',
    templates: [
      {
        task_type: 'youtube_watch',
        label: 'Watch a Video',
        description: 'Watch a YouTube video for a minimum duration',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 5,
        suggested_reward_kobo: 8000,
        instructions_template: '1. Open the video at {url}\n2. Watch for at least {duration} seconds\n3. Take a screenshot showing the video playing',
      },
      {
        task_type: 'tiktok_share',
        label: 'Share a TikTok',
        description: 'Share a TikTok video to your profile',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 8000,
        instructions_template: '1. Open the TikTok at {url}\n2. Tap "Share" and select "Share to your profile"\n3. Take a screenshot',
      },
      {
        task_type: 'twitter_share',
        label: 'Share a Tweet',
        description: 'Retweet or quote-tweet a post',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 8000,
        instructions_template: '1. Open the tweet at {url}\n2. Click retweet/quote\n3. Take a screenshot showing the shared post',
      },
      {
        task_type: 'instagram_repost',
        label: 'Share an Instagram Post',
        description: 'Share an Instagram post to your story',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 8000,
        instructions_template: '1. Open the post at {url}\n2. Tap "Share" and select "Add to Story"\n3. Take a screenshot',
      },
      {
        task_type: 'snapchat_view_story',
        label: 'View Snapchat Story',
        description: 'View the sponsor Snapchat story',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 6000,
        instructions_template: '1. Open Snapchat and add {account}\n2. View their story\n3. Take a screenshot',
      },
      {
        task_type: 'reddit_upvote',
        label: 'Upvote a Reddit Post',
        description: 'Upvote a specific Reddit post',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 2,
        suggested_reward_kobo: 5000,
        instructions_template: '1. Open the post at {url}\n2. Click the upvote arrow\n3. Take a screenshot showing the upvoted post',
      },
    ],
  },
  {
    category: 'website',
    label: 'Website',
    icon: 'globe-outline',
    templates: [
      {
        task_type: 'website_visit',
        label: 'Visit Website',
        description: 'Visit a website and stay for a minimum time',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 3,
        suggested_reward_kobo: 5000,
        instructions_template: '1. Open {url} in your browser\n2. Stay on the page for at least 30 seconds\n3. Take a screenshot of the page',
      },
      {
        task_type: 'website_signup',
        label: 'Sign Up on Website',
        description: 'Create an account on the sponsor website',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 5,
        suggested_reward_kobo: 20000,
        instructions_template: '1. Go to {url}\n2. Complete the signup form\n3. Take a screenshot of the confirmation/account page',
      },
    ],
  },
  {
    category: 'app',
    label: 'App',
    icon: 'phone-portrait-outline',
    templates: [
      {
        task_type: 'app_download',
        label: 'Download App',
        description: 'Download and open the sponsor mobile app',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 3,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Download the app from {store_url}\n2. Open the app\n3. Take a screenshot of the home screen',
      },
      {
        task_type: 'app_review',
        label: 'Leave App Review',
        description: 'Leave a positive review on the app store',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 5,
        suggested_reward_kobo: 25000,
        instructions_template: '1. Open the app store page at {url}\n2. Tap "Write a Review"\n3. Leave a positive review and take a screenshot',
      },
    ],
  },
  {
    category: 'content_creation',
    label: 'Content Creation',
    icon: 'create-outline',
    templates: [
      {
        task_type: 'written_review',
        label: 'Write a Review',
        description: 'Write a short review or testimonial',
        suggested_proof_type: 'text',
        suggested_time_limit_minutes: 10,
        suggested_reward_kobo: 20000,
        instructions_template: 'Write a 2-3 sentence review about your experience with {product}. Be honest and specific.',
      },
      {
        task_type: 'photo_upload',
        label: 'Upload a Photo',
        description: 'Take and upload a photo showing product usage',
        suggested_proof_type: 'photo',
        suggested_time_limit_minutes: 5,
        suggested_reward_kobo: 15000,
        instructions_template: 'Take a clear photo showing you using {product}. The photo should be well-lit and show the product clearly.',
      },
      {
        task_type: 'video_upload',
        label: 'Upload a Video',
        description: 'Record and upload a short demo video',
        suggested_proof_type: 'video',
        suggested_time_limit_minutes: 10,
        suggested_reward_kobo: 30000,
        instructions_template: 'Record a 30-60 second video demonstrating {product}. Speak clearly and show the key features.',
      },
    ],
  },
  {
    category: 'surveys',
    label: 'Surveys',
    icon: 'clipboard-outline',
    templates: [
      {
        task_type: 'survey',
        label: 'Complete Survey',
        description: 'Fill out a survey questionnaire',
        suggested_proof_type: 'screenshot',
        suggested_time_limit_minutes: 10,
        suggested_reward_kobo: 15000,
        instructions_template: '1. Open the survey at {url}\n2. Answer all questions honestly\n3. Take a screenshot of the completion confirmation',
      },
    ],
  },
  {
    category: 'data_collection',
    label: 'Data Collection',
    icon: 'server-outline',
    templates: [
      {
        task_type: 'custom',
        label: 'Custom Task',
        description: 'A custom data collection task',
        suggested_proof_type: 'text',
        suggested_time_limit_minutes: null,
        suggested_reward_kobo: 10000,
        instructions_template: 'Complete the custom task as described. Submit proof of completion.',
      },
    ],
  },
  {
    category: 'other',
    label: 'Other',
    icon: 'ellipsis-horizontal-circle-outline',
    templates: [
      {
        task_type: 'custom',
        label: 'Custom Task',
        description: 'A custom task not fitting other categories',
        suggested_proof_type: 'text',
        suggested_time_limit_minutes: null,
        suggested_reward_kobo: 10000,
        instructions_template: 'Complete the task as described. Submit proof of completion.',
      },
    ],
  },
];

/**
 * Get all available task types across all categories.
 */
export function getAllTaskTypes(): { task_type: string; label: string; category: string }[] {
  return TASK_TEMPLATES.flatMap((cat) =>
    cat.templates.map((t) => ({
      task_type: t.task_type,
      label: t.label,
      category: cat.category,
    }))
  );
}

/**
 * Get templates for a specific category.
 */
export function getTemplatesForCategory(category: string): TaskTemplate[] {
  const cat = TASK_TEMPLATES.find((c) => c.category === category);
  return cat?.templates || [];
}

/**
 * Get a single template by task_type.
 */
export function getTemplateByType(task_type: string): TaskTemplate | undefined {
  for (const cat of TASK_TEMPLATES) {
    const found = cat.templates.find((t) => t.task_type === task_type);
    if (found) return found;
  }
  return undefined;
}
