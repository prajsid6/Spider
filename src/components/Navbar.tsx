import React, { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { AccountDetailsModal } from './AccountDetailsModal';
import {
  ChevronDown, Database,
  LogOut, Shield, ContactRound
} from 'lucide-react';

interface NavbarProps {
  onOpenAuthModal: () => void;
  onOpenConfigModal: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  onOpenAuthModal,
  onOpenConfigModal
}) => {
  const { currentUser, isFirebase, signOut } = useAuth();
  const { showToast } = useToast();
  const [userDropdownOpen, setUserDropdownOpen] = useState(false);
  const [accountDetailsOpen, setAccountDetailsOpen] = useState(false);

  return (
    <header className="sticky top-0 z-30 bg-spider-surface/95 backdrop-blur-md border-b border-spider-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">

          {/* Logo */}
          <div className="flex items-center gap-3 shrink-0">
            <div className="w-9 h-9 rounded-xl bg-spider-primary flex items-center justify-center shadow-yellow-glow">
              <span className="text-black text-lg font-black">🕷</span>
            </div>
            <div>
              <span className="text-xl font-black tracking-tight text-spider-text">Hanuman</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 shrink-0">
            {import.meta.env.DEV && (
              <button
                onClick={onOpenConfigModal}
                title="Firebase connection and setup"
                className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-spider-elevated border border-spider-border text-xs text-spider-muted hover:border-spider-border/60 transition-colors"
              >
                <span className={`h-1.5 w-1.5 rounded-full ${isFirebase ? 'bg-emerald-400 shadow-[0_0_6px_#22C55E]' : 'bg-amber-400'}`} />
                <Database className="h-3.5 w-3.5" />
                <span>{isFirebase ? 'Firebase' : 'Setup'}</span>
              </button>
            )}

            {/* User Dropdown */}
            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setUserDropdownOpen(!userDropdownOpen)}
                  title="Open your account menu"
                  className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-xl border border-spider-border bg-spider-elevated hover:border-spider-primary/40 transition-all"
                >
                  <div className="w-7 h-7 rounded-lg bg-spider-primary flex items-center justify-center text-black text-xs font-black">
                    {currentUser.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="hidden md:block text-xs font-bold text-spider-text max-w-[90px] truncate">
                    {currentUser.name.split(' ')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-spider-muted" />
                </button>

                {userDropdownOpen && (
                  <div
                    className="absolute right-0 mt-2 w-72 bg-spider-elevated rounded-2xl shadow-spider-lg border border-spider-border py-2 z-50 animate-in fade-in slide-in-from-top-2 duration-150"
                    onClick={() => setUserDropdownOpen(false)}
                  >
                    {/* Profile header */}
                    <div className="px-4 py-3 border-b border-spider-border/50">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-spider-primary flex items-center justify-center text-black text-sm font-black shadow-yellow-glow">
                          {currentUser.name.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-spider-text">{currentUser.name}</p>
                          <p className="text-xs text-spider-muted">@{currentUser.username}</p>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-1.5 text-[11px] text-spider-muted">
                        <Shield className="w-3 h-3 text-emerald-400" />
                        <span className="font-mono">{currentUser.mobile_number || currentUser.email || 'Email sign-in'}</span>
                      </div>
                    </div>

                    <div className="p-1.5 space-y-0.5">
                      <button
                        onClick={() => setAccountDetailsOpen(true)}
                        title="View your account details"
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-spider-text hover:bg-spider-surface rounded-xl transition-colors"
                      >
                        <ContactRound className="w-3.5 h-3.5" />
                        View Account Details
                      </button>
                      <button
                        onClick={() => {
                          setUserDropdownOpen(false);
                          void signOut().catch((error: unknown) => {
                            const message = error instanceof Error ? error.message : 'Could not sign out.';
                            showToast(message, 'error');
                          });
                        }}
                        title="Sign out of your account"
                        className="w-full flex items-center gap-2 px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 rounded-xl transition-colors"
                      >
                        <LogOut className="w-3.5 h-3.5" />
                        Sign Out
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenAuthModal}
                title="Sign in or create an account"
                className="btn-secondary py-2 px-4 text-xs font-bold"
              >
                Sign In
              </button>
            )}
          </div>
        </div>

      </div>
      {accountDetailsOpen && currentUser && (
        <AccountDetailsModal
          profile={currentUser}
          onClose={() => setAccountDetailsOpen(false)}
        />
      )}
    </header>
  );
};
