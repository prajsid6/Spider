import React from 'react';
import { useAuth } from '../context/AuthContext';
import { DataService } from '../services/dataService';
import { X, Database, CheckCircle2, AlertTriangle, RefreshCw, ExternalLink, Code } from 'lucide-react';

interface SupabaseConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onReset: () => void;
}

export const SupabaseConfigModal: React.FC<SupabaseConfigModalProps> = ({
  isOpen,
  onClose,
  onReset
}) => {
  const { isSupabase } = useAuth();

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
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-spider-lg border border-spider-border p-6 sm:p-7 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-spider-border/60">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-spider-soft flex items-center justify-center text-spider-primary border border-spider-border">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-spider-text">
                Database & Backend Status
              </h2>
              <p className="text-xs text-spider-muted">
                Spider works with local browser storage or live Supabase.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            title="Close settings"
            aria-label="Close settings"
            className="p-1.5 rounded-full text-spider-muted hover:text-spider-text hover:bg-spider-lavender transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current State */}
        <div className="mt-5 space-y-4">
          {isSupabase ? (
            <div className="p-4 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Connected to Supabase Cloud</p>
                <p className="text-xs text-emerald-700 mt-0.5">
                  Your environment variables are active. Data is being queried from and written to your PostgreSQL database with RLS policies enabled.
                </p>
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-bold">Running in Local Browser Mode</p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                  No Supabase URL was found in your <code>.env</code> file. Spider is using local browser storage. No sample profiles, requests, or offers are preloaded.
                </p>
              </div>
            </div>
          )}

          {/* Setup Guide */}
          <div className="p-4 rounded-2xl bg-spider-bg border border-spider-border/80">
            <h4 className="text-xs font-bold text-spider-deep uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Code className="w-4 h-4 text-spider-primary" />
              To Connect Live Supabase:
            </h4>
            <ol className="text-xs text-spider-muted space-y-2 list-decimal list-inside leading-relaxed">
              <li>
                Create a project at <a href="https://supabase.com" target="_blank" rel="noreferrer" className="text-spider-primary font-bold underline inline-flex items-center gap-0.5">supabase.com <ExternalLink className="w-3 h-3" /></a>
              </li>
              <li>
                Open the Supabase SQL Editor and run <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">supabase/schema.sql</code>. For existing setups, apply the needed migrations, including <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">supabase/feature_suggestions_migration.sql</code> for the footer suggestion form.
              </li>
              <li>
                Paste your Project URL & Anon Key into <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">.env</code>:
                <pre className="mt-1.5 p-2 bg-spider-deep text-purple-100 rounded-lg text-[11px] font-mono overflow-x-auto">
{`VITE_SUPABASE_URL=https://xyz.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...`}
                </pre>
              </li>
              <li>Enable Google under Supabase Authentication providers and add your app URL to the allowed redirect URLs.</li>
              <li>Enable the Supabase Phone provider and configure an SMS provider for OTP sign-in. See <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">supabase/phone-otp-auth-setup.md</code>.</li>
              <li>For private in-app calls, apply <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">supabase/in_app_call_migration.sql</code>, configure Coturn and deploy the <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">turn-credentials</code> Edge Function. See <code className="bg-white px-1.5 py-0.5 rounded border border-spider-border font-mono text-spider-text">supabase/in-app-calling-setup.md</code>.</li>
              <li>Restart your dev server.</li>
            </ol>
          </div>

          {/* Clear local browser data */}
          {!isSupabase && (
            <div className="pt-2 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-spider-text">Clear Local Data</p>
                <p className="text-[11px] text-spider-muted">Remove profiles and marketplace data from this browser</p>
              </div>
              <button
                onClick={handleResetData}
                title="Clear locally stored app data"
                className="btn-outline py-1.5 px-3 text-xs font-semibold flex items-center gap-1.5 hover:bg-rose-50 hover:text-rose-600 hover:border-rose-200"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                Clear Data
              </button>
            </div>
          )}
        </div>

        <div className="mt-6 pt-4 border-t border-spider-border/50 flex justify-end">
          <button
            onClick={onClose}
            title="Close settings"
            className="btn-primary py-2 px-5 text-xs font-bold"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
