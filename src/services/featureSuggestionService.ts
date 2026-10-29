import { addDoc, collection } from 'firebase/firestore';
import { firestore } from '../lib/firebase';

export interface FeatureSuggestion {
  id: string;
  suggestion: string;
  created_at: string;
}

export const submitFeatureSuggestion = async (suggestion: string): Promise<void> => {
  const trimmedSuggestion = suggestion.trim();
  if (trimmedSuggestion.length < 10 || trimmedSuggestion.length > 2000) {
    throw new Error('Suggestion must be between 10 and 2,000 characters.');
  }

  if (firestore) {
    await addDoc(collection(firestore, 'featureSuggestions'), {
      suggestion: trimmedSuggestion,
      created_at: new Date().toISOString()
    });
    return;
  }

  try {
    const stored = localStorage.getItem('spider_feature_suggestions');
    const suggestions: FeatureSuggestion[] = stored ? JSON.parse(stored) : [];
    suggestions.push({
      id: `suggestion-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      suggestion: trimmedSuggestion,
      created_at: new Date().toISOString()
    });
    localStorage.setItem('spider_feature_suggestions', JSON.stringify(suggestions));
  } catch (error) {
    console.error('Could not save feature suggestion locally.', error);
    throw new Error('Could not save your suggestion in this browser.');
  }
};
