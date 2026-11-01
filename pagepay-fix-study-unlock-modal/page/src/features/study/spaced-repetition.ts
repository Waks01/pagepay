/**
 * Spaced Repetition System (Leitner Method)
 * Flashcards are categorized into boxes based on performance
 * Cards resurface based on their difficulty level
 */

import * as SecureStore from 'expo-secure-store';

const SRS_PREFIX = 'srs_';
const SRS_INDEX_KEY = 'srs_index';

export type CardDifficulty = 'easy' | 'medium' | 'hard' | 'again';

export type SRSCard = {
  assetId: number;
  cardIndex: number;
  box: number; // 1-5, higher = better mastery
  lastReviewed: string;
  nextReview: string;
  reviewCount: number;
  successRate: number; // 0-100
};

// Review intervals in days for each box
const INTERVALS = {
  1: 1,    // Review tomorrow
  2: 3,    // Review in 3 days
  3: 7,    // Review in 1 week
  4: 14,   // Review in 2 weeks
  5: 30,   // Review in 1 month
};

/**
 * Get SRS index (list of tracked cards)
 */
async function getSRSIndex(): Promise<string[]> {
  try {
    const index = await SecureStore.getItemAsync(SRS_INDEX_KEY);
    return index ? JSON.parse(index) : [];
  } catch {
    return [];
  }
}

/**
 * Update SRS index
 */
async function updateSRSIndex(cardKeys: string[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(SRS_INDEX_KEY, JSON.stringify(cardKeys));
  } catch (error) {
    console.error('Failed to update SRS index:', error);
  }
}

/**
 * Get card key
 */
function getCardKey(assetId: number, cardIndex: number): string {
  return `${SRS_PREFIX}${assetId}_${cardIndex}`;
}

/**
 * Calculate next review date based on box level
 */
function calculateNextReview(box: number): Date {
  const days = INTERVALS[box as keyof typeof INTERVALS] || 1;
  const next = new Date();
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Initialize a new card in the SRS system
 */
export async function initializeCard(assetId: number, cardIndex: number): Promise<void> {
  const key = getCardKey(assetId, cardIndex);
  
  const card: SRSCard = {
    assetId,
    cardIndex,
    box: 1,
    lastReviewed: new Date().toISOString(),
    nextReview: calculateNextReview(1).toISOString(),
    reviewCount: 0,
    successRate: 0,
  };
  
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(card));
    
    const index = await getSRSIndex();
    if (!index.includes(key)) {
      await updateSRSIndex([...index, key]);
    }
  } catch (error) {
    console.error('Failed to initialize SRS card:', error);
  }
}

/**
 * Get SRS data for a specific card
 */
export async function getCard(assetId: number, cardIndex: number): Promise<SRSCard | null> {
  const key = getCardKey(assetId, cardIndex);
  
  try {
    const data = await SecureStore.getItemAsync(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    console.error('Failed to get SRS card:', error);
    return null;
  }
}

/**
 * Update card based on user's difficulty rating
 */
export async function reviewCard(
  assetId: number,
  cardIndex: number,
  difficulty: CardDifficulty
): Promise<SRSCard> {
  let card = await getCard(assetId, cardIndex);
  
  // Initialize if doesn't exist
  if (!card) {
    await initializeCard(assetId, cardIndex);
    card = await getCard(assetId, cardIndex);
    if (!card) throw new Error('Failed to create card');
  }
  
  const now = new Date();
  const wasCorrect = difficulty === 'easy' || difficulty === 'medium';
  
  // Update box level based on difficulty
  let newBox = card.box;
  if (difficulty === 'easy') {
    newBox = Math.min(5, card.box + 2); // Jump 2 boxes
  } else if (difficulty === 'medium') {
    newBox = Math.min(5, card.box + 1); // Jump 1 box
  } else if (difficulty === 'hard') {
    newBox = Math.max(1, card.box - 1); // Drop 1 box
  } else if (difficulty === 'again') {
    newBox = 1; // Reset to box 1
  }
  
  // Update success rate
  const totalReviews = card.reviewCount + 1;
  const previousSuccess = card.successRate * card.reviewCount;
  const newSuccessRate = ((previousSuccess + (wasCorrect ? 100 : 0)) / totalReviews);
  
  // Update card
  const updatedCard: SRSCard = {
    ...card,
    box: newBox,
    lastReviewed: now.toISOString(),
    nextReview: calculateNextReview(newBox).toISOString(),
    reviewCount: totalReviews,
    successRate: Math.round(newSuccessRate),
  };
  
  const key = getCardKey(assetId, cardIndex);
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(updatedCard));
  } catch (error) {
    console.error('Failed to update SRS card:', error);
  }
  
  return updatedCard;
}

/**
 * Get all cards due for review
 */
export async function getDueCards(): Promise<SRSCard[]> {
  const index = await getSRSIndex();
  const now = new Date();
  const dueCards: SRSCard[] = [];
  
  for (const key of index) {
    try {
      const data = await SecureStore.getItemAsync(key);
      if (data) {
        const card: SRSCard = JSON.parse(data);
        const nextReview = new Date(card.nextReview);
        
        if (nextReview <= now) {
          dueCards.push(card);
        }
      }
    } catch (error) {
      console.error('Failed to get card:', error);
    }
  }
  
  return dueCards;
}

/**
 * Get all cards for a specific asset
 */
export async function getAssetCards(assetId: number): Promise<SRSCard[]> {
  const index = await getSRSIndex();
  const assetCards: SRSCard[] = [];
  
  for (const key of index) {
    if (key.startsWith(`${SRS_PREFIX}${assetId}_`)) {
      try {
        const data = await SecureStore.getItemAsync(key);
        if (data) {
          assetCards.push(JSON.parse(data));
        }
      } catch (error) {
        console.error('Failed to get asset card:', error);
      }
    }
  }
  
  return assetCards;
}

/**
 * Get SRS statistics
 */
export async function getStats(): Promise<{
  totalCards: number;
  dueToday: number;
  mastered: number; // box 5
  learning: number; // box 1-2
  reviewing: number; // box 3-4
  averageSuccessRate: number;
}> {
  const index = await getSRSIndex();
  let totalCards = 0;
  let dueToday = 0;
  let mastered = 0;
  let learning = 0;
  let reviewing = 0;
  let totalSuccessRate = 0;
  
  const now = new Date();
  
  for (const key of index) {
    try {
      const data = await SecureStore.getItemAsync(key);
      if (data) {
        const card: SRSCard = JSON.parse(data);
        totalCards++;
        totalSuccessRate += card.successRate;
        
        const nextReview = new Date(card.nextReview);
        if (nextReview <= now) {
          dueToday++;
        }
        
        if (card.box === 5) mastered++;
        else if (card.box <= 2) learning++;
        else reviewing++;
      }
    } catch (error) {
      console.error('Failed to get card stats:', error);
    }
  }
  
  return {
    totalCards,
    dueToday,
    mastered,
    learning,
    reviewing,
    averageSuccessRate: totalCards > 0 ? Math.round(totalSuccessRate / totalCards) : 0,
  };
}

/**
 * Clear all SRS data
 */
export async function clearAllSRS(): Promise<void> {
  const index = await getSRSIndex();
  
  for (const key of index) {
    try {
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.error('Failed to delete SRS card:', error);
    }
  }
  
  try {
    await SecureStore.deleteItemAsync(SRS_INDEX_KEY);
  } catch (error) {
    console.error('Failed to clear SRS index:', error);
  }
}
