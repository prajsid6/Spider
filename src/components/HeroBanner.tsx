import React from 'react';
import { AlertTriangle, HandHelping, HeartHandshake, IndianRupee, MapPin, PhoneCall, ShieldCheck, UsersRound, Zap } from 'lucide-react';

interface HeroBannerProps {
  onRequestHelp: () => void;
  onEmergencyHelp: () => void;
  onTriggerSOS: () => void;
  isTriggeringSOS: boolean;
  canTriggerSOS: boolean;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  onRequestHelp,
  onEmergencyHelp,
  onTriggerSOS,
  isTriggeringSOS,
  canTriggerSOS
}) => {
  return (
    <div className="relative overflow-hidden border-b border-spider-border bg-gradient-to-br from-white via-spider-surface to-spider-lavender/40">
      <div className="pointer-events-none absolute -right-28 -top-32 h-[28rem] w-[28rem] rounded-full bg-spider-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 left-[28%] h-72 w-72 rounded-full bg-purple-200/30 blur-3xl" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 pb-6">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-8">

          {/* Left copy */}
          <div className="max-w-2xl">
            {/* Tag pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-spider-primary/15 border border-spider-primary/25 text-spider-primary text-xs font-bold mb-4">
              <Zap className="w-3.5 h-3.5" />
              Hanuman Marketplace
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black tracking-tight leading-[1.05] text-spider-text">
              Need help?
              <br />
              <span className="gradient-text">Find your Hanuman.</span>
            </h1>

            <p className="mt-4 text-base text-spider-muted leading-relaxed max-w-lg">
              Post a task, get offers, and connect with your match in Hanuman.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-3 text-xs font-semibold text-spider-muted sm:grid-cols-2">
              <span className="flex items-center gap-1.5">
                <PhoneCall className="h-4 w-4 text-emerald-400" />
                Private calls. Real connections.
              </span>
              <span className="flex items-center gap-1.5">
                <IndianRupee className="h-4 w-4 text-spider-primary" />
                Fair budgets. No surprises.
              </span>
              <span className="flex items-center gap-1.5">
                <MapPin className="h-4 w-4 text-spider-primary" />
                Help nearby. People who care.
              </span>
              <span className="flex items-center gap-1.5">
                <HandHelping className="h-4 w-4 text-spider-primary" />
                Your skills. Your earnings.
              </span>
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                Safer support, when it matters.
              </span>
              <span className="flex items-center gap-1.5">
                <UsersRound className="h-4 w-4 text-spider-primary" />
                One community. Many helping hands.
              </span>
            </div>
          </div>

          {/* CTA block */}
          <div className="lg:shrink-0 w-full lg:w-auto">
            <div className="bg-spider-elevated border border-spider-border rounded-2xl p-5 space-y-3 max-w-sm">
              <div>
                <p className="text-xs font-bold text-spider-muted uppercase tracking-wider mb-1">Ready to get help?</p>
                <p className="text-spider-text font-bold text-sm">Post your task in seconds. Free to post, pay only when connected.</p>
              </div>
              <button
                onClick={onEmergencyHelp}
                title="Alert the community for urgent practical help"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-50 py-3 text-sm font-black text-rose-700 transition-colors hover:bg-rose-100"
              >
                <AlertTriangle className="h-4 w-4" />
                Need help right now?
              </button>
              <button
                onClick={onRequestHelp}
                title="Create a help request"
                className="w-full btn-primary py-3 text-sm font-black tracking-wide shadow-yellow-glow"
              >
                + Post a Help Request
              </button>
              <button
                onClick={onTriggerSOS}
                disabled={!canTriggerSOS || isTriggeringSOS}
                title="Trigger an SOS to nearby opted-in users"
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-rose-300 bg-rose-600 py-3 text-sm font-black text-white transition-colors hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <AlertTriangle className="h-4 w-4" />
                {isTriggeringSOS ? 'Sending SOS...' : 'Trigger SOS'}
              </button>
              <p className="text-center text-[11px] text-spider-muted">
                Notify nearby opted-in people using your saved SOS settings.
              </p>
              <div className="flex items-center justify-center gap-3 border-t border-spider-border/60 pt-3 text-center">
                <HeartHandshake className="h-5 w-5 shrink-0 text-spider-primary" />
                <p className="text-[11px] text-spider-muted">
                  Ask for help or lend a hand in your community
                </p>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
};
