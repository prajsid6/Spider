import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ToastProvider, useToast } from './context/ToastContext';
import { DataService } from './services/dataService';
import type { RequestPageCursor } from './services/dataService';
import { buyEmergencyExtension } from './services/paymentService';
import type { HelpRequest } from './types';
import { BENGALURU_LOCALITIES } from './lib/bengaluruLocalities';
import { Navbar } from './components/Navbar';
import { HeroBanner } from './components/HeroBanner';
import { RequestCard } from './components/RequestCard';
import { CreateRequestModal } from './components/CreateRequestModal';
import { EmergencyHelpModal } from './components/EmergencyHelpModal';
import { SafetySOSModal } from './components/SafetySOSModal';
import { OfferHelpModal } from './components/OfferHelpModal';
import { RequestDetailModal } from './components/RequestDetailModal';
import { AuthModal } from './components/AuthModal';
import { triggerSafetySOS } from './services/safetyAlertService';
import { FeatureSuggestionModal } from './components/FeatureSuggestionModal';
import { ReportIssueModal } from './components/ReportIssueModal';
import {
  Plus,
  RefreshCw,
  AlertCircle,
  ArrowUp,
  Search,
  X
} from 'lucide-react';

const CURRENT_YEAR = new Date().getFullYear();
const CATEGORIES = ['All', 'Coding & Tech', 'Physical Help', 'Academic & Writing', 'Pet Care', 'Language & Lessons'];

type FilterTab = 'all' | 'open' | 'connected' | 'completed' | 'my-requests' | 'my-offers';
type SortOption = 'newest' | 'budget-high' | 'budget-low' | 'most-offers';

const SpiderApp: React.FC = () => {
  const { currentUser, demoAuthEnabled } = useAuth();
  const { showToast } = useToast();
  const currentUserId = currentUser?.id;
  const [requests, setRequests] = useState<HelpRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreRequests, setLoadingMoreRequests] = useState(false);
  const [hasMoreRequests, setHasMoreRequests] = useState(false);
  const [requestCursor, setRequestCursor] = useState<RequestPageCursor | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filters & State
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('All');
  const [activeLocality, setActiveLocality] = useState('');
  const [currentTab, setCurrentTab] = useState<FilterTab>('all');
  const [sortBy, setSortBy] = useState<SortOption>('newest');

  // Modals
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEmergencyOpen, setIsEmergencyOpen] = useState(false);
  const [isSafetySOSOpen, setIsSafetySOSOpen] = useState(false);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [isIssueReportOpen, setIsIssueReportOpen] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState<HelpRequest | null>(null);
  const [offerTargetRequest, setOfferTargetRequest] = useState<HelpRequest | null>(null);
  const [isTriggeringSOS, setIsTriggeringSOS] = useState(false);

  // Load requests
  const loadRequests = useCallback(async () => {
    setLoading(true);
    setError(null);
    setRequests([]);
    setHasMoreRequests(false);
    setRequestCursor(null);
    try {
      if (demoAuthEnabled) DataService.ensureLocalDemoData();
      const page = await DataService.getRequestPage(null, activeLocality || undefined, currentUserId);
      setRequests(page.requests);
      setHasMoreRequests(page.hasMore);
      setRequestCursor(page.nextCursor);
    } catch (err: any) {
      console.error(err);
      setError('Failed to load help requests.');
    } finally {
      setLoading(false);
    }
  }, [activeLocality, currentUserId, demoAuthEnabled]);

  const refreshRequests = useCallback(async () => {
    try {
      const page = await DataService.getRequestPage(null, activeLocality || undefined, currentUserId);
      setRequests((current) => {
        const refreshedIds = new Set(page.requests.map((request) => request.id));
        const retained = current.filter((request) => !refreshedIds.has(request.id));
        return [...page.requests, ...retained];
      });
      setHasMoreRequests(page.hasMore || Boolean(requestCursor));
      setRequestCursor((current) => current || page.nextCursor);
    } catch (refreshError) {
      console.error('Failed to refresh marketplace requests:', refreshError);
    }
  }, [activeLocality, currentUserId, requestCursor]);

  const loadMoreRequests = useCallback(async () => {
    if (!requestCursor || loadingMoreRequests) return;
    setLoadingMoreRequests(true);
    try {
      const page = await DataService.getRequestPage(requestCursor, activeLocality || undefined, currentUserId);
      setRequests((current) => {
        const existingIds = new Set(current.map((request) => request.id));
        return [...current, ...page.requests.filter((request) => !existingIds.has(request.id))];
      });
      setHasMoreRequests(page.hasMore);
      setRequestCursor(page.nextCursor);
    } catch (pageError) {
      console.error('Failed to load older marketplace requests:', pageError);
      showToast('Could not load older requests. Please try again.', 'error');
    } finally {
      setLoadingMoreRequests(false);
    }
  }, [activeLocality, currentUserId, loadingMoreRequests, requestCursor, showToast]);

  const removeExpiredEmergencyRequests = useCallback(() => {
    const now = Date.now();
    setRequests((currentRequests) => currentRequests.filter((request) =>
      !request.is_emergency ||
      request.status !== 'Open' ||
      !request.expires_at ||
      new Date(request.expires_at).getTime() > now
    ));
  }, []);

  const requestIdsKey = requests.slice(0, 24).map((request) => request.id).join('|');

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const requestId = url.searchParams.get('request');
    if (!requestId) return;
    url.searchParams.delete('request');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
    let active = true;
    void DataService.getRequestById(requestId)
      .then((request) => {
        if (!active) return;
        if (request) {
          setSelectedRequest(request);
        } else {
          showToast('This SOS request is no longer available.', 'info');
        }
      })
      .catch((requestError) => {
        console.error('Could not open SOS request:', requestError);
        if (active) showToast('Could not open the SOS request. Refresh and try again.', 'error');
      });
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    const requestIds = requestIdsKey ? requestIdsKey.split('|') : [];
    const unsubscribe = DataService.subscribeToMarketplace(
      () => { void refreshRequests(); },
      requestIds,
      activeLocality || undefined
    );

    return () => {
      unsubscribe();
    };
  }, [activeLocality, refreshRequests, requestIdsKey]);

  useEffect(() => {
    const activeEmergencyExpiries = requests
      .filter((request) => request.is_emergency && request.status === 'Open' && request.expires_at)
      .map((request) => new Date(request.expires_at || '').getTime())
      .filter((expiresAt) => Number.isFinite(expiresAt));
    if (activeEmergencyExpiries.length === 0) return;

    const nextExpiry = Math.min(...activeEmergencyExpiries);
    const timer = window.setTimeout(removeExpiredEmergencyRequests, Math.max(0, nextExpiry - Date.now() + 50));
    return () => window.clearTimeout(timer);
  }, [requests, removeExpiredEmergencyRequests]);

  const liveEmergencyRequests = useMemo(() =>
    requests
      .filter((request) => request.is_emergency && request.status === 'Open' && request.expires_at)
      .sort((a, b) => new Date(a.expires_at || '').getTime() - new Date(b.expires_at || '').getTime()),
  [requests]);

  const handleExtendAlert = async (request: HelpRequest) => {
    try {
      await buyEmergencyExtension(request.id);
      showToast('Payment successful. Your urgent alert was extended by 5 minutes.', 'success');
      await loadRequests();
    } catch (extensionError) {
      showToast(extensionError instanceof Error ? extensionError.message : 'Could not extend the urgent alert.', 'error');
    }
  };

  const handleTriggerSOS = async (locationAddress: string) => {
    if (!currentUser) {
      throw new Error('Sign in to trigger an SOS.');
    }

    setIsTriggeringSOS(true);
    try {
      const result = await triggerSafetySOS(locationAddress);
      await loadRequests();
      if (result.recipients === 0) {
        showToast('SOS created, but no opted-in people matched your radius. Contact emergency services if you are in danger.', 'error');
      } else {
        showToast(`SOS with your location sent to ${result.recipients} nearby opted-in ${result.recipients === 1 ? 'person' : 'people'}.`, 'success');
      }
    } catch (sosError) {
      throw new Error(sosError instanceof Error ? sosError.message : 'Could not send the SOS alert.');
    } finally {
      setIsTriggeringSOS(false);
    }
  };

  // Filtered & Sorted Requests
  const filteredRequests = useMemo(() => {
    const liveEmergencyIds = new Set(liveEmergencyRequests.map((request) => request.id));
    let result = requests.filter((request) => !liveEmergencyIds.has(request.id));
    if (activeLocality) {
      result = result.filter((request) => request.locality === activeLocality);
    }

    // Search query filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      result = result.filter(
        (r) =>
          r.description.toLowerCase().includes(q) ||
          r.details?.toLowerCase().includes(q) ||
          r.locality?.toLowerCase().includes(q) ||
          r.requester?.name?.toLowerCase().includes(q) ||
          r.requester?.username?.toLowerCase().includes(q)
      );
    }

    // Category filter keywords
    if (activeCategory !== 'All') {
      const cat = activeCategory.toLowerCase();
      result = result.filter((r) => {
        const text = `${r.description} ${r.details || ''}`.toLowerCase();
        if (cat.includes('coding') || cat.includes('tech')) {
          return text.includes('react') || text.includes('python') || text.includes('code') || text.includes('developer') || text.includes('typescript') || text.includes('tech');
        }
        if (cat.includes('physical')) {
          return text.includes('moving') || text.includes('couch') || text.includes('sofa') || text.includes('lift') || text.includes('carry') || text.includes('furniture');
        }
        if (cat.includes('academic') || cat.includes('writing')) {
          return text.includes('latex') || text.includes('paper') || text.includes('thesis') || text.includes('proofreading') || text.includes('research') || text.includes('study');
        }
        if (cat.includes('pet')) {
          return text.includes('dog') || text.includes('cat') || text.includes('pet') || text.includes('simba');
        }
        if (cat.includes('language')) {
          return text.includes('spanish') || text.includes('language') || text.includes('tutor') || text.includes('teach');
        }
        return true;
      });
    }

    // Tab filter
    if (currentTab === 'open') {
      result = result.filter((r) => r.status === 'Open');
    } else if (currentTab === 'connected') {
      result = result.filter((r) => r.status === 'Connected');
    } else if (currentTab === 'completed') {
      result = result.filter((r) => r.status === 'Completed');
    } else if (currentTab === 'my-requests') {
      result = result.filter((r) => r.requester_id === currentUser?.id);
    } else if (currentTab === 'my-offers') {
      result = result.filter((request) =>
        request.user_offer?.helper_id === currentUser?.id ||
        request.accepted_offer?.helper_id === currentUser?.id
      );
    }

    // Sorting
    result.sort((a, b) => {
      if (sortBy === 'newest') {
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      }
      if (sortBy === 'budget-high') {
        return (b.budget_inr || 0) - (a.budget_inr || 0);
      }
      if (sortBy === 'budget-low') {
        return (a.budget_inr || 0) - (b.budget_inr || 0);
      }
      if (sortBy === 'most-offers') {
        return (b.offers_count || 0) - (a.offers_count || 0);
      }
      return 0;
    });

    return result;
  }, [requests, liveEmergencyRequests, searchQuery, activeCategory, activeLocality, currentTab, sortBy, currentUser]);

  // Counts for tabs
  const openCount = requests.filter((r) => r.status === 'Open').length;
  const connectedCount = requests.filter((r) => r.status === 'Connected').length;
  const completedCount = requests.filter((r) => r.status === 'Completed').length;
  const myRequestsCount = currentUser
    ? requests.filter((r) => r.requester_id === currentUser.id).length
    : 0;
  const myOffersCount = currentUser
    ? requests.filter((request) =>
        request.user_offer?.helper_id === currentUser.id ||
        request.accepted_offer?.helper_id === currentUser.id
      ).length
    : 0;

  return (
    <div className="min-h-screen flex flex-col bg-spider-bg text-spider-text">
      
      {/* Top Navbar */}
      <Navbar
        onOpenAuthModal={() => setIsAuthOpen(true)}
      />

      {/* Hero Banner */}
      <HeroBanner
        onRequestHelp={() => setIsCreateOpen(true)}
        onEmergencyHelp={() => setIsEmergencyOpen(true)}
        onTriggerSOS={() => {
          if (!currentUser) {
            showToast('Sign in to trigger an SOS.', 'error');
            return;
          }
          setIsSafetySOSOpen(true);
        }}
        isTriggeringSOS={isTriggeringSOS}
        canTriggerSOS={Boolean(currentUser)}
      />

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">

        {liveEmergencyRequests.length > 0 && (
          <section aria-labelledby="live-emergency-heading" className="mb-7 rounded-2xl border border-rose-300 bg-rose-50/70 p-4 sm:p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 id="live-emergency-heading" className="flex items-center gap-2 text-sm font-black text-rose-800">
                  <AlertCircle className="h-4 w-4" />
                  Urgent help needed now
                </h2>
                <p className="mt-1 text-xs text-rose-700">Live community alerts disappear when their selected timer ends or when help is accepted.</p>
              </div>
              <span className="rounded-full bg-rose-100 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-rose-700">
                {liveEmergencyRequests.length} active {liveEmergencyRequests.length === 1 ? 'alert' : 'alerts'}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              {liveEmergencyRequests.map((request) => (
                <RequestCard
                  key={request.id}
                  request={request}
                  onSelect={(item) => setSelectedRequest(item)}
                  onOfferHelp={(item) => setOfferTargetRequest(item)}
                  onExtendAlert={handleExtendAlert}
                />
              ))}
            </div>
          </section>
        )}

        {/* Request Filters */}
        <div className="grid grid-cols-1 gap-3 pb-6 border-b border-spider-border/60 sm:flex sm:flex-wrap sm:items-end sm:gap-3">
            <label className="block w-full min-w-0 text-[10px] font-bold uppercase tracking-wider text-spider-muted sm:w-auto sm:flex-1 sm:min-w-64 sm:max-w-sm">
              Search requests
              <span className="relative mt-2 block">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-spider-muted" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(event) => setSearchQuery(event.target.value)}
                  placeholder="Try “tutoring” or “moving”"
                  title="Search help requests"
                  className="block w-full rounded-xl border border-spider-border/80 bg-white py-2 pl-9 pr-10 text-sm font-medium normal-case tracking-normal text-spider-text shadow-xs placeholder:font-normal placeholder:text-spider-muted/60 focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    title="Clear search"
                    aria-label="Clear search"
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-spider-muted transition-colors hover:bg-spider-soft hover:text-spider-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            </label>
            <label className="block w-full text-[10px] font-bold uppercase tracking-wider text-spider-muted sm:w-auto">
              Bengaluru locality
              <select
                value={activeLocality}
                onChange={(event) => setActiveLocality(event.target.value)}
                title="Filter requests by Bengaluru locality"
                className="mt-2 block w-full min-w-0 rounded-xl border border-spider-border/80 bg-white px-3 py-2 text-base font-semibold normal-case tracking-normal text-spider-text shadow-xs focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20 sm:w-auto sm:min-w-48 sm:text-xs"
              >
                <option value="">All Bengaluru localities</option>
                {BENGALURU_LOCALITIES.map((area) => <option key={area} value={area}>{area}</option>)}
              </select>
            </label>
            <label className="block w-full text-[10px] font-bold uppercase tracking-wider text-spider-muted sm:w-auto">
              Filter by status
              <select
                value={currentTab}
                onChange={(event) => setCurrentTab(event.target.value as FilterTab)}
                title="Filter requests by status"
                className="mt-2 block w-full min-w-0 rounded-xl border border-spider-border/80 bg-white px-3 py-2 text-base font-semibold normal-case tracking-normal text-spider-text shadow-xs focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20 sm:w-auto sm:min-w-48 sm:text-xs"
              >
                <option value="all">Any Status ({requests.length} loaded)</option>
                <option value="open">Open ({openCount} loaded)</option>
                <option value="connected">Connected ({connectedCount} loaded)</option>
                <option value="completed">Completed ({completedCount} loaded)</option>
                {currentUser && <option value="my-requests">My Requests ({myRequestsCount} loaded)</option>}
                {currentUser && <option value="my-offers">My Offers ({myOffersCount} loaded)</option>}
              </select>
            </label>
            <label className="block w-full text-[10px] font-bold uppercase tracking-wider text-spider-muted sm:w-auto">
              Browse by category
              <select
                value={activeCategory}
                onChange={(event) => setActiveCategory(event.target.value)}
                title="Filter requests by category"
                className="mt-2 block w-full min-w-0 rounded-xl border border-spider-border/80 bg-white px-3 py-2 text-base font-semibold normal-case tracking-normal text-spider-text shadow-xs focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20 sm:w-auto sm:min-w-48 sm:text-xs"
              >
                {CATEGORIES.map((category) => (
                  <option key={category} value={category}>{category}</option>
                ))}
              </select>
            </label>
            <label className="block w-full text-[10px] font-bold uppercase tracking-wider text-spider-muted sm:w-auto">
              Sort by
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortOption)}
                title="Choose how requests are sorted"
                className="mt-2 block w-full min-w-0 rounded-xl border border-spider-border/80 bg-white px-3 py-2 text-base font-semibold normal-case tracking-normal text-spider-text shadow-xs focus:border-spider-primary focus:outline-none focus:ring-2 focus:ring-spider-primary/20 sm:w-auto sm:min-w-48 sm:text-xs"
              >
                <option value="newest">Newest First</option>
                <option value="budget-high">Budget: High to Low</option>
                <option value="budget-low">Budget: Low to High</option>
                <option value="most-offers">Most Offers</option>
              </select>
            </label>
            <button
              onClick={loadRequests}
              title="Refresh requests"
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-spider-border/80 bg-white px-3 text-xs font-semibold text-spider-text shadow-xs transition-colors hover:bg-spider-soft hover:text-spider-primary sm:h-[34px] sm:w-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
        </div>

        {/* Requests Feed */}
        <div className="mt-6">
          <p className="mb-3 text-[11px] text-spider-muted">
            Showing {filteredRequests.length} matches among {requests.length} loaded requests. Search, filters, and sorting apply to loaded requests.
          </p>
          {loading ? (
            <div className="py-20 text-center space-y-3">
              <div className="w-8 h-8 border-3 border-spider-primary border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm font-semibold text-spider-muted">Loading requests...</p>
            </div>
          ) : error ? (
            <div className="p-6 rounded-2xl bg-rose-50 border border-rose-200 text-rose-700 text-center max-w-md mx-auto">
              <AlertCircle className="w-8 h-8 mx-auto mb-2 text-rose-500" />
              <p className="text-sm font-bold">{error}</p>
              <button
                onClick={loadRequests}
                className="mt-3 btn-outline py-1.5 px-4 text-xs font-bold"
                title="Reload requests"
              >
                Retry
              </button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="py-16 px-4 text-center rounded-3xl bg-white border border-dashed border-spider-border/80 max-w-lg mx-auto shadow-spider-sm">
              <div className="w-14 h-14 rounded-2xl bg-spider-lavender text-spider-primary flex items-center justify-center mx-auto mb-3 text-2xl">
                🕸
              </div>
              <h3 className="text-base font-bold text-spider-text">No requests found</h3>
              <p className="text-xs text-spider-muted mt-1 max-w-sm mx-auto">
                {searchQuery || activeCategory !== 'All' || currentTab !== 'all' || activeLocality
                  ? 'No help requests matched your current filters. Try searching for something else or clearing filters.'
                  : 'Be the first to post a help request in your community!'}
              </p>
              <div className="mt-4 flex items-center justify-center gap-2">
                {(searchQuery || activeCategory !== 'All' || currentTab !== 'all' || activeLocality) && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setActiveCategory('All');
                      setCurrentTab('all');
                      setActiveLocality('');
                    }}
                    className="btn-outline py-2 px-4 text-xs font-semibold"
                    title="Remove search and request filters"
                  >
                    Clear Filters
                  </button>
                )}
                {hasMoreRequests && (
                  <button
                    onClick={() => void loadMoreRequests()}
                    disabled={loadingMoreRequests}
                    className="btn-outline py-2 px-4 text-xs font-semibold disabled:opacity-50"
                  >
                    {loadingMoreRequests ? 'Loading...' : 'Load older requests'}
                  </button>
                )}
                <button
                  onClick={() => setIsCreateOpen(true)}
                  className="btn-primary py-2 px-4 text-xs font-bold"
                  title="Post a new help request"
                >
                  <Plus className="w-4 h-4 stroke-[2.5]" />
                  Post a Request
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {filteredRequests.map((req) => (
                <RequestCard
                  key={req.id}
                  request={req}
                  onSelect={(r) => setSelectedRequest(r)}
                  onOfferHelp={(r) => setOfferTargetRequest(r)}
                  onExtendAlert={handleExtendAlert}
                />
              ))}
            </div>
          )}
          {!loading && !error && filteredRequests.length > 0 && hasMoreRequests && (
            <div className="mt-7 text-center">
              <button
                onClick={() => void loadMoreRequests()}
                disabled={loadingMoreRequests}
                className="btn-outline py-2.5 px-5 text-xs font-bold disabled:opacity-50"
              >
                {loadingMoreRequests ? 'Loading older requests...' : 'Load older requests'}
              </button>
            </div>
          )}
        </div>

      </main>

      {/* Footer */}
      <footer className="mt-auto border-t-2 border-spider-primary/50 bg-gradient-to-b from-white to-spider-surface">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-4 py-4 md:grid-cols-[minmax(190px,0.8fr)_2fr] md:items-center">
            <div className="flex items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-spider-primary text-lg font-black text-spider-text shadow-yellow-glow">
                <span aria-hidden="true">🕷</span>
              </div>
              <div>
                <p className="text-sm font-black tracking-tight text-spider-text">Hanuman</p>
                <p className="text-[11px] text-spider-muted">A little help goes a long way.</p>
              </div>
            </div>
            <div>
              <h2 className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.16em] text-spider-muted">How it works</h2>
              <ol className="relative grid gap-1.5 text-[11px] text-spider-muted sm:grid-cols-3 sm:gap-2">
                <span aria-hidden="true" className="absolute bottom-4 left-4 top-4 border-l border-dashed border-spider-primary/30 sm:bottom-auto sm:left-[16.66%] sm:right-[16.66%] sm:top-3.5 sm:border-l-0 sm:border-t" />
                <li className="relative z-10 flex items-center gap-2 rounded-lg border border-spider-border/70 bg-white/90 px-2.5 py-2 shadow-xs">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white bg-spider-primary text-[11px] font-black text-spider-text shadow-yellow-glow">1</span>
                  <span className="leading-snug">Post a task with your budget</span>
                </li>
                <li className="relative z-10 flex items-center gap-2 rounded-lg border border-spider-border/70 bg-white/90 px-2.5 py-2 shadow-xs">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white bg-spider-primary text-[11px] font-black text-spider-text shadow-yellow-glow">2</span>
                  <span className="leading-snug">Choose an offer that works for you</span>
                </li>
                <li className="relative z-10 flex items-center gap-2 rounded-lg border border-spider-border/70 bg-white/90 px-2.5 py-2 shadow-xs">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white bg-spider-primary text-[11px] font-black text-spider-text shadow-yellow-glow">3</span>
                  <span className="leading-snug">Connect privately and get it done</span>
                </li>
              </ol>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-spider-border/60 pt-3 md:col-span-2">
              <div className="flex flex-col items-start gap-2">
                <button
                  type="button"
                  onClick={() => setIsSuggestionOpen(true)}
                  title="Suggest a feature"
                  className="rounded-lg border border-spider-border bg-white px-3 py-1.5 text-[11px] font-bold text-spider-text shadow-xs transition-all hover:border-spider-primary hover:shadow-sm"
                >
                  Suggest a feature
                </button>
                <button
                  type="button"
                  onClick={() => setIsIssueReportOpen(true)}
                  title="Report an issue"
                  className="rounded-lg border border-spider-border bg-white px-3 py-1.5 text-[11px] font-bold text-spider-text shadow-xs transition-all hover:border-rose-300 hover:shadow-sm"
                >
                  Report an issue
                </button>
              </div>
              <button
                type="button"
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                title="Back to the top"
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-spider-muted transition-colors hover:text-spider-text"
              >
                Back to top <ArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="flex flex-col gap-1 border-t border-spider-border/60 py-2.5 text-[10px] text-spider-muted sm:flex-row sm:items-center sm:justify-between">
            <p>© {CURRENT_YEAR} Hanuman Marketplace</p>
            <p className="font-medium">Made for Indians <span className="mx-1.5 text-spider-border">•</span> Developed by Kannadiga</p>
          </div>
        </div>
      </footer>

      {/* Modals */}
      <CreateRequestModal
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => {
          showToast('Help request posted to marketplace! 🚀', 'success');
          loadRequests();
        }}
        onRequireAuth={() => {
          setIsCreateOpen(false);
          setIsAuthOpen(true);
        }}
      />

      <EmergencyHelpModal
        isOpen={isEmergencyOpen}
        onClose={() => setIsEmergencyOpen(false)}
        onSuccess={() => {
          setSearchQuery('');
          setActiveCategory('All');
          setCurrentTab('all');
          showToast('Urgent alert sent to people currently using Hanuman.', 'success');
          loadRequests();
        }}
        onRequireAuth={() => {
          setIsEmergencyOpen(false);
          setIsAuthOpen(true);
        }}
      />

      <SafetySOSModal
        isOpen={isSafetySOSOpen}
        isSending={isTriggeringSOS}
        onClose={() => setIsSafetySOSOpen(false)}
        onSubmit={handleTriggerSOS}
      />

      <FeatureSuggestionModal
        isOpen={isSuggestionOpen}
        onClose={() => setIsSuggestionOpen(false)}
      />

      <ReportIssueModal
        isOpen={isIssueReportOpen}
        onClose={() => setIsIssueReportOpen(false)}
      />

      <OfferHelpModal
        request={offerTargetRequest}
        isOpen={Boolean(offerTargetRequest)}
        onClose={() => setOfferTargetRequest(null)}
        onSuccess={(offer) => {
          showToast('Help offer sent to requester! ✉️', 'success');
          loadRequests();
          if (offerTargetRequest) {
            setSelectedRequest({
              ...offerTargetRequest,
              user_offer: offer,
              offers_count: (offerTargetRequest.offers_count ?? 0) + 1
            });
          }
        }}
        onRequireAuth={() => {
          setOfferTargetRequest(null);
          setIsAuthOpen(true);
        }}
      />

      <RequestDetailModal
        request={selectedRequest}
        isOpen={Boolean(selectedRequest)}
        onClose={() => setSelectedRequest(null)}
        onOpenOfferModal={(req) => {
          setSelectedRequest(null);
          setOfferTargetRequest(req);
        }}
        onUpdate={() => {
          loadRequests();
        }}
      />

      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
      />

    </div>
  );
};

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <SpiderApp />
      </AuthProvider>
    </ToastProvider>
  );
}
