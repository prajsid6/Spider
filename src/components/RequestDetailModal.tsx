import React, { useState, useEffect } from 'react';
import type { HelpRequest, HelpOffer, HelpRating, PublicProfile } from '../types';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { DataService } from '../services/dataService';
import type { OfferPageCursor } from '../services/dataService';
import { InAppCall } from './InAppCall';
import {
  X,
  AlertTriangle,
  IndianRupee,
  Phone,
  Video,
  MapPin,
  MessageCircle,
  CheckCircle,
  XCircle,
  Sparkles,
  UserCheck,
  CheckCircle2,
  AlertCircle,
  Star
} from 'lucide-react';

interface RequestDetailModalProps {
  request: HelpRequest | null;
  isOpen: boolean;
  onClose: () => void;
  onOpenOfferModal: (req: HelpRequest) => void;
  onUpdate: () => void;
}

export const RequestDetailModal: React.FC<RequestDetailModalProps> = ({
  request,
  isOpen,
  onClose,
  onOpenOfferModal,
  onUpdate
}) => {
  const { currentUser } = useAuth();
  const { showToast } = useToast();
  const [offers, setOffers] = useState<HelpOffer[]>([]);
  const [userOffer, setUserOffer] = useState<HelpOffer | null>(null);
  const [offersCursor, setOffersCursor] = useState<OfferPageCursor | null>(null);
  const [hasMoreOffers, setHasMoreOffers] = useState(false);
  const [ratings, setRatings] = useState<HelpRating[]>([]);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [ratingLoading, setRatingLoading] = useState(false);
  const [justCompletedRequestId, setJustCompletedRequestId] = useState<string | null>(null);
  const [justConnectedRequestId, setJustConnectedRequestId] = useState<string | null>(null);
  const [acceptedOfferOverride, setAcceptedOfferOverride] = useState<HelpOffer | null>(null);
  const [requesterProfile, setRequesterProfile] = useState<PublicProfile | null>(null);
  const [loadingOffers, setLoadingOffers] = useState(false);
  const [loadingMoreOffers, setLoadingMoreOffers] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isRequester = currentUser?.id === request?.requester_id;

  const loadOffersAndContacts = React.useCallback(async () => {
    if (!request) return;
    setLoadingOffers(true);
    setError(null);
    try {
      const [offerPage, submittedOffer] = await Promise.all([
        DataService.getOfferPage(request.id),
        currentUser
          ? DataService.getOfferForRequestByHelper(request.id, currentUser.id)
          : Promise.resolve(null)
      ]);
      setOffers(offerPage.offers);
      setOffersCursor(offerPage.nextCursor);
      setHasMoreOffers(offerPage.hasMore);
      setUserOffer(submittedOffer);
      const accepted = offerPage.offers.find(offer => offer.status === 'Accepted')
        || request.accepted_offer
        || (submittedOffer?.status === 'Accepted' ? submittedOffer : undefined);
      const isParticipant = currentUser?.id === request.requester_id || currentUser?.id === accepted?.helper_id;
      setRatings((request.status === 'Completed' || justCompletedRequestId === request.id) && isParticipant
        ? await DataService.getRatingsForRequest(request.id)
        : []);

      // Only public identity fields are needed here; phone numbers remain private.
      if (request.status === 'Connected' || request.status === 'Completed') {
        const fullRequester = await DataService.getPublicProfile(request.requester_id);
        setRequesterProfile(fullRequester);
      }
    } catch (err: any) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'Could not load offers');
    } finally {
      setLoadingOffers(false);
    }
  }, [request, justCompletedRequestId, currentUser]);

  const loadMoreOffers = async () => {
    if (!request || !offersCursor || loadingMoreOffers) return;
    setLoadingMoreOffers(true);
    try {
      const page = await DataService.getOfferPage(request.id, offersCursor);
      setOffers((current) => {
        const existingIds = new Set(current.map((offer) => offer.id));
        return [...current, ...page.offers.filter((offer) => !existingIds.has(offer.id))];
      });
      setOffersCursor(page.nextCursor);
      setHasMoreOffers(page.hasMore);
    } catch (loadError) {
      console.error('Failed to load older offers:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Could not load more offers.');
    } finally {
      setLoadingMoreOffers(false);
    }
  };

  useEffect(() => {
    if (isOpen && request) {
      loadOffersAndContacts();
    }
  }, [isOpen, request, loadOffersAndContacts]);

  if (!isOpen || !request) return null;

  const effectiveRequestStatus = justCompletedRequestId === request.id
    ? 'Completed'
    : justConnectedRequestId === request.id
      ? 'Connected'
      : request.status;
  const acceptedOffer = acceptedOfferOverride?.request_id === request.id
    ? acceptedOfferOverride
    : offers.find((o) => o.status === 'Accepted') || request.accepted_offer;
  const isAcceptedHelper = currentUser?.id === acceptedOffer?.helper_id;
  const isCompleted = effectiveRequestStatus === 'Completed';
  const isRequestOpen = effectiveRequestStatus === 'Open';
  const totalOffersCount = Math.max(request.offers_count ?? 0, offers.length);
  const rateeId = isRequester ? acceptedOffer?.helper_id : request.requester_id;
  const rateeName = isRequester
    ? acceptedOffer?.helper?.name || 'your helper'
    : request.requester?.name || 'the requester';
  const myRating = ratings.find(rating => rating.rater_id === currentUser?.id);
  const receivedRating = ratings.find(rating => rating.ratee_id === currentUser?.id);

  const handleAcceptOffer = async (offerId: string) => {
    setActionLoading(offerId);
    try {
      const selectedOffer = offers.find((offer) => offer.id === offerId);
      await DataService.acceptOffer(request.id, offerId);
      setJustConnectedRequestId(request.id);
      if (selectedOffer) setAcceptedOfferOverride({ ...selectedOffer, status: 'Accepted' });
      showToast('Offer accepted! You are now connected with the helper 🎉', 'success');
      await loadOffersAndContacts();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || 'Failed to accept offer');
      showToast(err?.message || 'Failed to accept offer', 'error');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDeclineOffer = async (offerId: string) => {
    setActionLoading(offerId);
    try {
      await DataService.declineOffer(offerId);
      showToast('Offer declined', 'info');
      await loadOffersAndContacts();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || 'Failed to decline offer');
    } finally {
      setActionLoading(null);
    }
  };

  const handleMarkCompleted = async () => {
    setActionLoading('complete');
    try {
      await DataService.updateRequestStatus(request.id, 'Completed');
      showToast('Task marked as completed! 🌟', 'success');
      setJustCompletedRequestId(request.id);
      await loadOffersAndContacts();
      onUpdate();
    } catch (err: any) {
      setError(err?.message || 'Failed to update request');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSubmitRating = async () => {
    if (!currentUser || !rateeId || selectedRating === null) return;
    setRatingLoading(true);
    setError(null);
    try {
      await DataService.submitRating(request.id, currentUser.id, rateeId, selectedRating);
      setSelectedRating(null);
      setRatings(await DataService.getRatingsForRequest(request.id));
      showToast('Your rating has been submitted.', 'success');
    } catch (err: any) {
      setError(err?.message || 'Failed to submit your rating.');
    } finally {
      setRatingLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-spider-text/40 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-spider-lg border border-spider-border p-6 sm:p-8 animate-in fade-in zoom-in-95 duration-200 max-h-[90vh] overflow-y-auto">
        
        {/* Close Button */}
        <button
          onClick={onClose}
          title="Close details"
          aria-label="Close details"
          className="absolute top-5 right-5 p-1.5 rounded-full text-spider-muted hover:text-spider-text hover:bg-spider-lavender transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Requester Info & Status */}
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-spider-border/50">
          <div className="flex items-center gap-3">
            <div
              className="w-11 h-11 rounded-2xl flex items-center justify-center text-spider-text text-base font-extrabold shadow-sm"
              style={{ backgroundColor: request.requester?.avatar_color || '#6D28D9' }}
            >
              {request.requester?.name?.charAt(0) || 'U'}
            </div>
            <div>
              <p className="text-sm font-bold text-spider-text">
                {request.requester?.name || 'Anonymous User'}
                {isRequester && (
                  <span className="ml-2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-spider-lavender text-spider-deep">
                    You (Requester)
                  </span>
                )}
              </p>
              <p className="text-xs text-spider-muted">
                @{request.requester?.username || 'user'}
              </p>
              {request.is_demo && (
                <span className="mt-1 inline-flex rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700">
                  Demo profile
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {request.is_emergency && isRequestOpen && (
              <span className="flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-black uppercase tracking-wide text-rose-700">
                <AlertTriangle className="h-3 w-3" />
                {request.expires_at && request.created_at
                  ? `${Math.round((new Date(request.expires_at).getTime() - new Date(request.created_at).getTime()) / 60000)}-minute urgent alert`
                  : 'Urgent alert'}
              </span>
            )}
            {isRequestOpen && (
              <span className="badge-open">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                Open for Offers
              </span>
            )}
            {effectiveRequestStatus === 'Connected' && (
              <span className="badge-connected">
                <UserCheck className="w-3.5 h-3.5" /> Connected
              </span>
            )}
            {isCompleted && (
              <span className="badge-completed">
                <CheckCircle2 className="w-3.5 h-3.5" /> Completed
              </span>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* CONNECTED CELEBRATION & PRIVATE CONTACT CARD */}
        {(effectiveRequestStatus === 'Connected' || isCompleted) && (isRequester || isAcceptedHelper) && (
          <div className="mt-5 p-5 rounded-2xl bg-gradient-to-br from-spider-lavender/70 via-purple-50 to-white border border-spider-border shadow-spider-sm">
            <div className="flex items-center gap-2 text-spider-deep font-extrabold text-sm mb-2">
              <Sparkles className="w-4 h-4 text-spider-primary" />
              <span>
                {isCompleted
                  ? 'Task Completed Successfully! 🌟'
                  : 'You are Connected! In-app calling is available 🎉'}
              </span>
            </div>
            
            <p className="text-xs text-spider-muted mb-4">
              {isRequester
              ? `You accepted the offer from ${acceptedOffer?.helper?.name || 'your helper'}. Call them in Hanuman to coordinate the task.`
              : `Your offer was accepted by ${request.requester?.name || 'the requester'}! Call them in Hanuman to coordinate the task.`}
            </p>

            {/* Username-based contact and private in-app calling */}
            <div className="p-4 rounded-xl bg-white border border-spider-border flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold">
                  <Phone className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs text-spider-muted">Connected with</p>
                  <p className="text-sm font-extrabold text-spider-text">
                    {isRequester
                      ? acceptedOffer?.helper_contact?.name || acceptedOffer?.helper?.name
                      : requesterProfile?.name || request.requester?.name}
                  </p>
                  <p className="text-xs font-mono font-bold text-spider-deep">
                    @{isRequester
                      ? acceptedOffer?.helper_contact?.username || acceptedOffer?.helper?.username || 'user'
                      : requesterProfile?.username || request.requester?.username || 'user'}
                  </p>
                </div>
              </div>
              {acceptedOffer?.id && (
                <InAppCall
                  key={`${request.id}:${acceptedOffer.id}`}
                  requestId={request.id}
                  offerId={acceptedOffer.id}
                  otherUsername={
                    (isRequester
                      ? acceptedOffer.helper_contact?.username || acceptedOffer.helper?.username
                      : requesterProfile?.username || request.requester?.username) || 'user'
                  }
                />
              )}
            </div>

            {/* Requester Mark as Complete button */}
            {isRequester && effectiveRequestStatus === 'Connected' && !isCompleted && (
              <div className="mt-4 pt-3 border-t border-spider-border/50 flex justify-end">
                <button
                  onClick={handleMarkCompleted}
                  disabled={actionLoading === 'complete'}
                  title="Mark the request as complete"
                  className="btn-secondary py-1.5 px-4 text-xs font-bold flex items-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  {actionLoading === 'complete' ? 'Updating...' : 'Mark Task as Completed'}
                </button>
              </div>
            )}
          </div>
        )}

        {isCompleted && (isRequester || isAcceptedHelper) && acceptedOffer && currentUser && (
          <section className="mt-5 rounded-2xl border border-spider-border bg-spider-bg/60 p-4" aria-labelledby="rating-heading">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-spider-primary" />
              <h3 id="rating-heading" className="text-sm font-bold text-spider-text">Rate this experience</h3>
            </div>
            <p className="mt-1 text-xs text-spider-muted">Requester and helper can each rate one another from 1 to 10.</p>

            {myRating && (
              <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs">
                You rated {rateeName}: <strong>{myRating.score}/10</strong>
              </p>
            )}
            {receivedRating && (
              <p className="mt-2 rounded-xl bg-white px-3 py-2 text-xs">
                {isRequester ? acceptedOffer.helper?.name || 'Your helper' : request.requester?.name || 'The requester'} rated you: <strong>{receivedRating.score}/10</strong>
              </p>
            )}

            {loadingOffers && (
              <p className="mt-3 text-xs text-spider-muted">Loading ratings...</p>
            )}
            {!loadingOffers && !myRating && rateeId && (
              <div className="mt-3">
                <p className="text-xs font-semibold">How was {rateeName}?</p>
                <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Choose a rating from 1 to 10">
                  {Array.from({ length: 10 }, (_, index) => index + 1).map(score => (
                    <button
                      key={score}
                      type="button"
                      onClick={() => setSelectedRating(score)}
                      aria-pressed={selectedRating === score}
                      title={`Rate ${score} out of 10`}
                      className={`h-9 w-9 rounded-lg border text-sm font-bold transition-colors ${
                        selectedRating === score
                          ? 'border-spider-primary bg-spider-primary text-black'
                          : 'border-spider-border bg-white hover:border-spider-primary'
                      }`}
                    >
                      {score}
                    </button>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={handleSubmitRating}
                  disabled={selectedRating === null || ratingLoading}
                  className="btn-primary mt-3 px-4 py-2 text-xs"
                >
                  {ratingLoading ? 'Submitting...' : 'Submit rating'}
                </button>
              </div>
            )}
          </section>
        )}

        {/* Main Content */}
        <div className="mt-5 space-y-4">
          <h2 className="text-xl sm:text-2xl font-extrabold text-spider-text leading-snug">
            {request.description}
          </h2>

          <div className="inline-flex items-center gap-2 rounded-xl border border-spider-border bg-spider-soft px-3 py-2 text-xs font-semibold text-spider-text">
            {request.connection_mode === 'in_person' ? <MapPin className="h-4 w-4 text-spider-primary" /> : <Video className="h-4 w-4 text-spider-primary" />}
            {request.connection_mode === 'in_person' ? 'Preferred connection: Meet in person' : 'Preferred connection: Virtual · In-app call'}
          </div>

          {request.details && (
            <div className="p-4 rounded-2xl bg-spider-bg/60 border border-spider-border/60">
              <h4 className="text-xs font-bold text-spider-muted uppercase tracking-wider mb-2">
                Task Details & Instructions
              </h4>
              <p className="text-sm text-spider-text whitespace-pre-wrap leading-relaxed">
                {request.details}
              </p>
            </div>
          )}

          {/* Budget & Metadata Banner */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-spider-soft border border-spider-border/60">
            <div>
              <p className="text-xs text-spider-muted">Proposed Budget</p>
              <div className="flex items-center text-spider-deep font-extrabold text-xl mt-0.5">
                <IndianRupee className="w-5 h-5 text-spider-primary stroke-[2.5]" />
                <span>
                  {request.budget_inr != null
                    ? Number(request.budget_inr).toLocaleString('en-IN')
                    : 'Negotiable / Flexible'}
                </span>
              </div>
            </div>

            <div className="text-right">
              <p className="text-xs text-spider-muted">Offers Received</p>
              <p className="text-base font-extrabold text-spider-text mt-0.5">
                {totalOffersCount} {totalOffersCount === 1 ? 'Helper' : 'Helpers'}
              </p>
            </div>
          </div>
        </div>

        {/* OFFERS SECTION */}
        <div className="mt-7 pt-5 border-t border-spider-border/60">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-spider-text flex items-center gap-2">
              <MessageCircle className="w-4 h-4 text-spider-primary" />
              Offers ({totalOffersCount})
            </h3>

            {/* Offer Help button for non-requesters if open */}
            {!isRequester && isRequestOpen && !userOffer && (
              <button
                onClick={() => onOpenOfferModal(request)}
                title="Send an offer to help"
                className="btn-primary py-1.5 px-3 text-xs font-bold shadow-xs"
              >
                {request.is_emergency ? 'I Can Help Now' : 'Offer Your Help'}
              </button>
            )}
          </div>

          {/* Current user's submitted offer status banner */}
          {!isRequester && userOffer && (
            <div className="mb-4 p-3 rounded-xl bg-purple-50 border border-purple-200 text-xs flex items-center justify-between">
              <div>
                <span className="font-bold text-purple-900">Your Offer Status: </span>
                <span className="capitalize font-semibold text-spider-primary">
                  {userOffer.status}
                </span>
                <span className="text-purple-700 ml-2">
                  (₹{userOffer.proposed_price_inr != null ? Number(userOffer.proposed_price_inr).toLocaleString('en-IN') : 'Negotiable'})
                </span>
              </div>
              {userOffer.status === 'Pending' && (
                <span className="text-[11px] text-purple-600">Awaiting requester's response</span>
              )}
            </div>
          )}

          {/* Offers List */}
          {loadingOffers ? (
            <div className="py-6 text-center text-xs text-spider-muted">
              Loading offers...
            </div>
          ) : offers.length === 0 ? (
            <div className="py-8 text-center rounded-2xl bg-spider-bg/50 border border-dashed border-spider-border/80">
              <p className="text-sm font-semibold text-spider-muted">No offers yet.</p>
              <p className="text-xs text-spider-muted mt-1">
                {isRequester
                  ? 'Your request is visible to the community. Helpers will pitch soon!'
                  : 'Be the first one to offer help and earn!'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {offers.map((offer) => {
                const isThisAccepted = offer.status === 'Accepted';
                const isThisDeclined = offer.status === 'Declined';
                const isNoLongerAvailable = offer.status === 'Pending' && !isRequestOpen;

                return (
                  <div
                    key={offer.id}
                    className={`p-4 rounded-2xl border transition-all ${
                      isThisAccepted
                        ? 'bg-purple-50/60 border-purple-300 ring-1 ring-purple-300'
                        : isThisDeclined || isNoLongerAvailable
                        ? 'bg-gray-50/70 border-gray-200 opacity-60'
                        : 'bg-white border-spider-border/70 hover:border-spider-border'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-8 h-8 rounded-xl flex items-center justify-center text-spider-text text-xs font-bold"
                          style={{ backgroundColor: offer.helper?.avatar_color || '#6D28D9' }}
                        >
                          {offer.helper?.name?.charAt(0) || 'H'}
                        </div>
                        <div>
                          <p className="text-xs font-bold text-spider-text">
                            {offer.helper?.name || 'Helper'}
                            {offer.helper_id === currentUser?.id && (
                              <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-spider-lavender text-spider-deep">
                                You
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-spider-muted">
                            @{offer.helper?.username || 'user'}
                          </p>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="flex items-center text-spider-deep font-extrabold text-sm">
                          <IndianRupee className="w-3.5 h-3.5 text-spider-primary stroke-[2.5]" />
                          <span>
                            {offer.proposed_price_inr != null
                              ? Number(offer.proposed_price_inr).toLocaleString('en-IN')
                              : 'Standard'}
                          </span>
                        </div>
                        <span className="text-[10px] capitalize">
                          {isThisAccepted && (
                            <span className="badge-accepted">Accepted</span>
                          )}
                          {isThisDeclined && (
                            <span className="badge-declined">Declined</span>
                          )}
                          {offer.status === 'Pending' && (
                            <span className={isNoLongerAvailable ? 'badge-declined' : 'badge-pending'}>
                              {isNoLongerAvailable ? 'Request closed' : 'Pending'}
                            </span>
                          )}
                        </span>
                      </div>
                    </div>

                    <p className="mt-2.5 text-xs text-spider-text whitespace-pre-wrap leading-relaxed">
                      {offer.message}
                    </p>

                    {/* Requester Action Buttons on Pending Offers */}
                    {isRequester && isRequestOpen && offer.status === 'Pending' && (
                      <div className="mt-3 pt-3 border-t border-spider-border/50 flex items-center justify-end gap-2">
                        <button
                          onClick={() => handleDeclineOffer(offer.id)}
                          disabled={actionLoading === offer.id}
                          title="Decline this offer"
                          className="btn-outline py-1 px-3 text-xs font-semibold text-rose-600 hover:text-rose-700 hover:bg-rose-50 border-rose-200"
                        >
                          <XCircle className="w-3.5 h-3.5" />
                          Decline
                        </button>
                        <button
                          onClick={() => handleAcceptOffer(offer.id)}
                          disabled={actionLoading === offer.id}
                          title="Accept and connect with this helper"
                          className="btn-primary py-1 px-3.5 text-xs font-bold shadow-xs"
                        >
                          <CheckCircle className="w-3.5 h-3.5" />
                          {actionLoading === offer.id ? 'Connecting...' : 'Accept & Connect'}
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {hasMoreOffers && (
            <div className="mt-4 text-center">
              <button
                type="button"
                onClick={() => void loadMoreOffers()}
                disabled={loadingMoreOffers}
                className="btn-outline py-2 px-4 text-xs font-semibold disabled:opacity-50"
              >
                {loadingMoreOffers ? 'Loading older offers...' : `Load older offers (${Math.max(0, totalOffersCount - offers.length)} remaining)`}
              </button>
            </div>
          )}
        </div>

      </div>
    </div>
  );
};
