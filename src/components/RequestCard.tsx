import React, { useEffect, useState } from 'react';
import type { HelpRequest } from '../types';
import { useAuth } from '../context/AuthContext';
import { AlertTriangle, IndianRupee, MessageCircle, Clock, CheckCircle2, UserCheck, ArrowRight, Zap, Timer, MapPin, Video } from 'lucide-react';

// Format relative date
const formatTimeAgo = (isoDate: string) => {
  try {
    const diffMs = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${Math.max(1, mins)}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  } catch {
    return 'Recently';
  }
};

interface RequestCardProps {
  request: HelpRequest;
  onSelect: (req: HelpRequest) => void;
  onOfferHelp: (req: HelpRequest) => void;
  onExtendAlert: (req: HelpRequest) => void;
}

export const RequestCard: React.FC<RequestCardProps> = ({
  request,
  onSelect,
  onOfferHelp,
  onExtendAlert
}) => {
  const { currentUser } = useAuth();
  const initialSecondsRemaining = request.expires_at
    ? Math.max(0, Math.ceil((new Date(request.expires_at).getTime() - new Date(request.created_at).getTime()) / 1000))
    : 0;
  const [secondsRemaining, setSecondsRemaining] = useState(initialSecondsRemaining);
  const isRequester = currentUser?.id === request.requester_id;
  const isLiveEmergency = Boolean(request.is_emergency && request.status === 'Open' && request.expires_at);

  useEffect(() => {
    setSecondsRemaining(request.expires_at
      ? Math.max(0, Math.ceil((new Date(request.expires_at).getTime() - Date.now()) / 1000))
      : 0);
    if (!isLiveEmergency) return;
    const timer = window.setInterval(() => {
      setSecondsRemaining((remaining) => Math.max(0, remaining - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [request.expires_at, isLiveEmergency]);

  const remainingLabel = `${Math.floor(secondsRemaining / 60)}:${String(secondsRemaining % 60).padStart(2, '0')}`;

  const statusBadge = () => {
    switch (request.status) {
      case 'Open':
        return (
          <span className="badge-open">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            Open
          </span>
        );
      case 'Connected':
        return (
          <span className="badge-connected">
            <UserCheck className="w-3.5 h-3.5" />
            Connected
          </span>
        );
      case 'Completed':
        return (
          <span className="badge-completed">
            <CheckCircle2 className="w-3.5 h-3.5" />
            Done
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div
      onClick={() => onSelect(request)}
      title="Open request details"
      className={`card p-5 cursor-pointer group relative overflow-hidden flex flex-col justify-between ${
        isLiveEmergency ? 'border-rose-300 bg-rose-50/50 shadow-[0_8px_24px_rgba(225,29,72,0.12)]' : ''
      }`}
    >
      {/* Hover accent stripe */}
      <div className={`absolute top-0 left-0 w-full h-0.5 ${
        isLiveEmergency ? 'bg-rose-500' : 'bg-gradient-to-r from-spider-primary/0 via-spider-primary to-spider-primary/0 opacity-0 group-hover:opacity-100'
      } transition-opacity duration-300`} />

      <div>
        {/* Header Row */}
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* Avatar */}
            <div className="w-9 h-9 rounded-xl bg-spider-border flex items-center justify-center text-spider-text text-xs font-black border border-spider-border/60 group-hover:border-spider-primary/30 transition-colors">
              {request.requester?.name?.charAt(0).toUpperCase() || 'U'}
            </div>
            <div className="min-w-0">
              <p className="max-w-[180px] truncate text-xs font-bold leading-tight text-spider-text transition-colors group-hover:text-spider-primary sm:max-w-none">
                {request.requester?.name || 'Anonymous'}
                {isRequester && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-md text-[10px] font-bold bg-spider-primary/20 text-spider-primary">
                    You
                  </span>
                )}
              </p>
              <p className="text-[11px] text-spider-muted">@{request.requester?.username || 'user'}</p>
              {request.is_demo && (
                <span className="mt-1 inline-flex rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">
                  Demo
                </span>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {isLiveEmergency && (
              <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2 py-1 text-[10px] font-black uppercase tracking-wide text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                Urgent · {remainingLabel}
              </span>
            )}
            <span className="text-[11px] text-spider-muted flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {formatTimeAgo(request.created_at)}
            </span>
            {statusBadge()}
          </div>
        </div>

        {/* Description */}
        <h3 className="text-sm font-bold text-spider-text leading-snug line-clamp-2 group-hover:text-spider-primary/90 transition-colors">
          {request.description}
        </h3>
        <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-spider-soft px-2.5 py-1 text-[10px] font-semibold text-spider-muted">
          {request.connection_mode === 'in_person' ? <MapPin className="h-3 w-3" /> : <Video className="h-3 w-3" />}
          {request.connection_mode === 'in_person' ? 'Meet in person' : 'Virtual · In-app call'}
        </p>
        {request.locality && (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] font-semibold text-spider-muted">
            <MapPin className="h-3 w-3 shrink-0" />
            {request.locality}, Bengaluru
          </p>
        )}

        {/* Details preview */}
        {request.details && (
          <p className="mt-1.5 text-xs text-spider-muted line-clamp-2 leading-relaxed">
            {request.details}
          </p>
        )}
      </div>

      {/* Footer */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-spider-border/50 pt-3.5">
      <div className="flex min-w-0 items-center gap-3">
          {/* Budget */}
          <div className="flex items-center gap-1 font-black text-spider-primary text-sm">
            <IndianRupee className="w-3.5 h-3.5 stroke-[2.5]" />
            <span>
              {request.budget_inr != null
                ? Number(request.budget_inr).toLocaleString('en-IN')
                : 'Flexible'}
            </span>
          </div>
          {/* Offers count */}
          <span className="text-xs text-spider-muted flex items-center gap-1">
            <MessageCircle className="w-3.5 h-3.5" />
            {request.offers_count || 0} {request.offers_count === 1 ? 'offer' : 'offers'}
          </span>
        </div>

        {/* Action */}
        {isRequester && isLiveEmergency ? (
          <button
            onClick={(event) => {
              event.stopPropagation();
              onExtendAlert(request);
            }}
            title="Extend this urgent alert by 5 minutes for ₹25"
            className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-rose-300 bg-white px-2.5 py-2 text-[11px] font-bold text-rose-700 transition-colors hover:bg-rose-100 sm:py-1.5"
          >
            <Timer className="h-3.5 w-3.5" />
            Buy 5 more mins · ₹25
          </button>
        ) : isRequester ? (
          <span className="text-xs font-bold text-spider-muted flex items-center gap-1 group-hover:text-spider-text transition-colors">
            Manage <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
          </span>
        ) : request.status === 'Open' ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onOfferHelp(request);
            }}
            title="Send an offer to help"
            className="btn-primary min-h-10 py-2 px-3.5 text-xs font-bold sm:py-1.5"
          >
            <Zap className="w-3.5 h-3.5 stroke-[2.5]" />
            Offer Help
          </button>
        ) : (
          <span className="text-xs font-medium text-spider-muted flex items-center gap-1">
            View <ArrowRight className="w-3 h-3" />
          </span>
        )}
      </div>
    </div>
  );
};
