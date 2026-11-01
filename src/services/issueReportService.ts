import { addDoc, collection } from 'firebase/firestore';
import { firestore } from '../lib/firebase';

export interface IssueReport {
  title: string;
  description: string;
}

export const submitIssueReport = async ({ title, description }: IssueReport): Promise<void> => {
  const trimmedTitle = title.trim();
  const trimmedDescription = description.trim();
  if (trimmedTitle.length < 5 || trimmedTitle.length > 120) {
    throw new Error('Issue title must be between 5 and 120 characters.');
  }
  if (trimmedDescription.length < 10 || trimmedDescription.length > 2000) {
    throw new Error('Issue description must be between 10 and 2,000 characters.');
  }
  if (!firestore) {
    throw new Error('Issue reporting is unavailable right now. Please try again later.');
  }

  await addDoc(collection(firestore, 'issueReports'), {
    title: trimmedTitle,
    description: trimmedDescription,
    created_at: new Date().toISOString()
  });
};
