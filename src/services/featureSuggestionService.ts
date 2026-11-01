import { addDoc, collection } from 'firebase/firestore';
import { firestore } from '../lib/firebase';

export const submitFeatureSuggestion = async (suggestion: string): Promise<void> => {
  const trimmedSuggestion = suggestion.trim();
  if (trimmedSuggestion.length < 10 || trimmedSuggestion.length > 2000) {
    throw new Error('Suggestion must be between 10 and 2,000 characters.');
  }

  if (!firestore) {
    throw new Error('Feature suggestions are unavailable right now. Please try again later.');
  }

  await addDoc(collection(firestore, 'featureSuggestions'), {
    suggestion: trimmedSuggestion,
    created_at: new Date().toISOString()
  });
};
