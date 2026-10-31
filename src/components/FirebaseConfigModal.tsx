import React from 'react';
import { AlertTriangle, CheckCircle2, Code, Database, ExternalLink, RefreshCw, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { DataService } from '../services/dataService';

interface FirebaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReset: () => void;
}

export const FirebaseConfigModal: React.FC<FirebaseConfigModalProps> = ({
  isOpen,
  onClose,
  onReset
}) => {
  const { isFirebase } = useAuth();

  if (!isOpen) return null;

  const handleResetData = () => {
    if (window.confirm('Clear all locally stored profiles, requests, offers, and ratings from this browser? This cannot be undone.')) {
      DataService.resetLocalData();
      onReset();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-spider-text/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-spider-lg border border-spider-border p-6 sm:p-7">
        <div className="flex items-center justify-between pb-4 border-b border-spider-border/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-spider-soft flex items-center justify-center text-spider-primary border border-spider-border">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-spider-text">Database & Backend Status</h2>
              <p className="text-xs text-spider-muted">Hanuman works with local browser storage or Firebase.</p>
            </div>
          </div>
          <button onClick={onClose} title="Close settings" aria-label="Close settings" className="p-1.5 rounded-full text-spider-muted hover:text-spider-text hover:bg-spider-lavender transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mt-5 space-y-4">
          {isFirebase ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Connected to Firebase</p>
                <p className="text-xs text-emerald-700 mt-0.5">Firebase Authentication and Cloud Firestore are configured for this app.</p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Running in Local Browser Mode</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">Add the Firebase web app settings to your ignored <code>.env</code> file and restart the dev server to connect Firebase.</p>
              </div>
            </div>
          )}

          <div className="p-4 rounded-2xl bg-spider-bg border border-spider-border/80">
            <h4 className="text-xs font-bold text-spider-deep uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Code className="w-4 h-4 text-spider-primary" />
              Firebase setup
            </h4>
            <ol className="text-xs text-spider-muted space-y-2 list-decimal list-inside leading-relaxed">
              <li>Create a Firebase project and register a Web app in the <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-spider-primary font-bold underline inline-flex items-center gap-0.5">Firebase Console <ExternalLink className="w-3 h-3" /></a>.</li>
              <li>Enable Google and Email/Password in Authentication and create a Cloud Firestore database.</li>
              <li>Copy the web app values into the <code>.env</code> file using the keys in <code>.env.example</code>. These web config values are public; secure data with Firebase Rules.</li>
              <li>Deploy <code>firestore.rules</code>, <code>database.rules.json</code>, and Cloud Functions with the Firebase CLI. Configure Functions secrets as described in <code>firebase/README.md</code>.</li>
              <li>Restart the development server after saving configuration.</li>
            </ol>
          </div>

          {!isFirebase && (
            <div className="pt-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-spider-text">Clear Local Data</p>
                <p className="text-[11px] text-spider-muted">Remove profiles and marketplace data from this browser</p>
              </div>
              <button onClick={handleResetData} title="Clear locally stored app data" className="btn-outline py-1.5 px-3 text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200">
                <RefreshCw className="w-3.5 h-3.5" />
                Clear Data
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-spider-border/50 flex justify-end">
          <button onClick={onClose} title="Close settings" className="btn-primary py-2 px-5 text-xs font-bold">Close</button>
        </div>
      </div>
    </div>
  );
};
