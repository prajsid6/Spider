import { supabase, isSupabaseConfigured } from '../lib/supabase';
import type { Profile, PublicProfile, HelpRequest, HelpOffer, HelpRating, NewRequestPayload, NewOfferPayload } from '../types';

const LEGACY_DEMO_PROFILE_IDS = new Set([
  'user-aarav-1',
  'user-priya-2',
  'user-rohan-3',
  'user-sneha-4'
]);
const LEGACY_DEMO_REQUEST_IDS = new Set(['req-1', 'req-2', 'req-3', 'req-4', 'req-5']);
const LEGACY_DEMO_OFFER_IDS = new Set(['off-1', 'off-2', 'off-3', 'off-4', 'off-5']);
const LEGACY_DEMO_RATING_REQUEST_IDS = LEGACY_DEMO_REQUEST_IDS;

// In-memory fallback for test and non-browser environments
const memoryStore = new Map<string, string>();

const safeStorage = {
  getItem: (key: string): string | null => {
    if (typeof localStorage !== 'undefined') {
      try {
        return localStorage.getItem(key);
      } catch {
        return memoryStore.get(key) || null;
      }
    }
    return memoryStore.get(key) || null;
  },
  setItem: (key: string, value: string): void => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(key, value);
      } catch {
        // fallback
      }
    }
    memoryStore.set(key, value);
  },
  removeItem: (key: string): void => {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.removeItem(key);
      } catch {
        // fallback
      }
    }
    memoryStore.delete(key);
  }
};

// Helper to get or init localStorage
function getLocal<T>(key: string, defaultValue: T): T {
  try {
    const raw = safeStorage.getItem(`spider_${key}`);
    if (!raw) {
      safeStorage.setItem(`spider_${key}`, JSON.stringify(defaultValue));
      return defaultValue;
    }
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

function setLocal<T>(key: string, value: T): void {
  try {
    safeStorage.setItem(`spider_${key}`, JSON.stringify(value));
  } catch (e) {
    console.error('Local storage error', e);
  }
}

function removeLegacyDemoData(): void {
  const profiles = getLocal<Profile[]>('profiles', []);
  const requests = getLocal<HelpRequest[]>('requests', []);
  const offers = getLocal<HelpOffer[]>('offers', []);
  const ratings = getLocal<HelpRating[]>('ratings', []);
  const cleanProfiles = profiles.filter((profile) => !LEGACY_DEMO_PROFILE_IDS.has(profile.id));
  const cleanRequests = requests.filter((request) => !LEGACY_DEMO_REQUEST_IDS.has(request.id));
  const cleanOffers = offers.filter((offer) =>
    !LEGACY_DEMO_OFFER_IDS.has(offer.id) && !LEGACY_DEMO_REQUEST_IDS.has(offer.request_id)
  );
  const cleanRatings = ratings.filter((rating) => !LEGACY_DEMO_RATING_REQUEST_IDS.has(rating.request_id));

  if (cleanProfiles.length !== profiles.length) setLocal('profiles', cleanProfiles);
  if (cleanRequests.length !== requests.length) setLocal('requests', cleanRequests);
  if (cleanOffers.length !== offers.length) setLocal('offers', cleanOffers);
  if (cleanRatings.length !== ratings.length) setLocal('ratings', cleanRatings);
  if (LEGACY_DEMO_PROFILE_IDS.has(safeStorage.getItem('spider_active_user_id') || '')) {
    safeStorage.removeItem('spider_active_user_id');
  }
}

removeLegacyDemoData();

// ==============================================================================
// SERVICE IMPLEMENTATION (SUPABASE + LOCAL STORAGE)
// ==============================================================================

export const DataService = {
  // Profiles
  getLocalProfiles(): Profile[] {
    return getLocal<Profile[]>('profiles', []);
  },

  getCurrentUser(): Profile | null {
    const profiles = this.getLocalProfiles();
    const activeId = safeStorage.getItem('spider_active_user_id');
    return activeId ? profiles.find(p => p.id === activeId) || null : null;
  },

  getLocalProfileByPhone(phone: string): Profile | null {
    const digits = phone.replace(/\D/g, '');
    return this.getLocalProfiles().find((profile) => profile.mobile_number.replace(/\D/g, '') === digits) || null;
  },

  setLocalActiveUser(userId: string): void {
    if (!this.getLocalProfiles().some((profile) => profile.id === userId)) {
      throw new Error('Local demo account was not found.');
    }
    safeStorage.setItem('spider_active_user_id', userId);
  },

  clearActiveUser(): void {
    safeStorage.removeItem('spider_active_user_id');
  },

  async getProfileById(userId: string): Promise<Profile | null> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();
      if (!error && data) return data as Profile;
    }
    const profiles = this.getLocalProfiles();
    return profiles.find(p => p.id === userId) || null;
  },

  async getPublicProfile(userId: string): Promise<PublicProfile | null> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('public_profiles')
        .select('id, name, username, created_at')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return data as PublicProfile | null;
    }

    const profile = await this.getProfileById(userId);
    if (!profile) return null;
    return {
      id: profile.id,
      name: profile.name,
      username: profile.username,
      created_at: profile.created_at,
      avatar_color: profile.avatar_color
    };
  },

  // Save/Create Profile (e.g. from sign up)
  async saveProfile(profile: Profile): Promise<Profile> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .upsert(profile)
        .select()
        .single();
      if (error) throw error;
      return data as Profile;
    }

    const profiles = this.getLocalProfiles();
    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = profile;
    } else {
      profiles.push(profile);
    }
    setLocal('profiles', profiles);
    safeStorage.setItem('spider_active_user_id', profile.id);
    return profile;
  },

  // Requests
  async getRequests(): Promise<HelpRequest[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('help_requests')
          .select(`
            *,
            requester:public_profiles (id, name, username, created_at),
            offers:help_offers (id, status, helper_id, message, proposed_price_inr, created_at)
          `)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((item: any) => ({
            ...item,
            offers_count: item.offers?.length || 0,
            accepted_offer: item.offers?.find((o: any) => o.status === 'Accepted')
          })).filter((request: HelpRequest) =>
            !request.is_emergency ||
            request.status !== 'Open' ||
            !request.expires_at ||
            new Date(request.expires_at).getTime() > Date.now()
          ) as HelpRequest[];
        }
      } catch (e) {
        console.warn('Supabase fetch failed, falling back to local storage', e);
      }
    }

    // Local / Demo Mode
    const requests = getLocal<HelpRequest[]>('requests', []);
    const profiles = this.getLocalProfiles();
    const offers = getLocal<HelpOffer[]>('offers', []);

    return requests.filter(req =>
      !req.is_emergency ||
      req.status !== 'Open' ||
      !req.expires_at ||
      new Date(req.expires_at).getTime() > Date.now()
    ).map(req => {
      const requester = profiles.find(p => p.id === req.requester_id);
      const reqOffers = offers.filter(o => o.request_id === req.id);
      const accepted = reqOffers.find(o => o.status === 'Accepted');

      return {
        ...req,
        offers_count: reqOffers.length,
        requester: requester
          ? {
              id: requester.id,
              name: requester.name,
              username: requester.username,
              created_at: requester.created_at,
              avatar_color: requester.avatar_color
            }
          : undefined,
        accepted_offer: accepted
      };
    });
  },

  async createRequest(requesterId: string, payload: NewRequestPayload): Promise<HelpRequest> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('help_requests')
        .insert({
          requester_id: requesterId,
          description: payload.description.trim(),
          details: payload.details?.trim() || null,
          budget_inr: payload.budget_inr || null,
          status: 'Open',
          is_emergency: payload.is_emergency ?? false,
          expires_at: payload.expires_at ?? null
        })
        .select(`
          *,
          requester:public_profiles (id, name, username, created_at)
        `)
        .single();

      if (error) throw error;
      return data as HelpRequest;
    }

    // Local
    const requests = getLocal<HelpRequest[]>('requests', []);
    const profiles = this.getLocalProfiles();
    const requester = profiles.find(p => p.id === requesterId);

    const newReq: HelpRequest = {
      id: `req-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      requester_id: requesterId,
      description: payload.description.trim(),
      details: payload.details?.trim() || null,
      budget_inr: payload.budget_inr ? Number(payload.budget_inr) : null,
      status: 'Open',
      created_at: new Date().toISOString(),
      is_emergency: payload.is_emergency ?? false,
      expires_at: payload.expires_at ?? null,
      offers_count: 0,
      requester: requester
        ? {
            id: requester.id,
            name: requester.name,
            username: requester.username,
            created_at: requester.created_at,
            avatar_color: requester.avatar_color
          }
        : undefined
    };

    requests.unshift(newReq);
    setLocal('requests', requests);
    return newReq;
  },

  async updateRequestStatus(requestId: string, status: HelpRequest['status']): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from('help_requests')
        .update({ status })
        .eq('id', requestId);
      if (error) throw error;
      return;
    }

    const requests = getLocal<HelpRequest[]>('requests', []);
    const target = requests.find(r => r.id === requestId);
    if (target) {
      target.status = status;
      setLocal('requests', requests);
    }
  },

  // Offers
  async getOffersForRequest(requestId: string): Promise<HelpOffer[]> {
    if (isSupabaseConfigured() && supabase) {
      try {
        const { data, error } = await supabase
          .from('help_offers')
          .select(`
            *,
            helper:public_profiles (id, name, username, created_at)
          `)
          .eq('request_id', requestId)
          .order('created_at', { ascending: false });

        if (!error && data) {
          return data.map((item: any) => ({
            ...item,
            helper_contact: item.status === 'Accepted' && item.helper ? {
              name: item.helper.name,
              username: item.helper.username
            } : undefined
          })) as HelpOffer[];
        }
      } catch (e) {
        console.warn('Supabase offers query failed, falling back to local', e);
      }
    }

    // Local
    const offers = getLocal<HelpOffer[]>('offers', []);
    const profiles = this.getLocalProfiles();

    return offers
      .filter(o => o.request_id === requestId)
      .map(off => {
        const helper = profiles.find(p => p.id === off.helper_id);
        return {
          ...off,
          helper: helper
            ? {
                id: helper.id,
                name: helper.name,
                username: helper.username,
                created_at: helper.created_at,
                avatar_color: helper.avatar_color
              }
            : undefined,
          helper_contact: off.status === 'Accepted' && helper ? {
            name: helper.name,
            username: helper.username
          } : undefined
        };
      });
  },

  async getRatingsForRequest(requestId: string): Promise<HelpRating[]> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('help_ratings')
        .select('*')
        .eq('request_id', requestId)
        .order('created_at', { ascending: true });

      if (error) throw error;
      return data as HelpRating[];
    }

    return getLocal<HelpRating[]>('ratings', [])
      .filter(rating => rating.request_id === requestId);
  },

  async submitRating(requestId: string, raterId: string, rateeId: string, score: number): Promise<HelpRating> {
    if (!Number.isInteger(score) || score < 1 || score > 10) {
      throw new Error('Rating must be a whole number from 1 to 10.');
    }
    if (raterId === rateeId) {
      throw new Error('You cannot rate yourself.');
    }

    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('help_ratings')
        .insert({
          request_id: requestId,
          rater_id: raterId,
          ratee_id: rateeId,
          score
        })
        .select('*')
        .single();

      if (error) throw error;
      return data as HelpRating;
    }

    const requests = getLocal<HelpRequest[]>('requests', []);
    const request = requests.find(item => item.id === requestId);
    if (!request || request.status !== 'Completed') {
      throw new Error('Ratings are available only after a request is completed.');
    }

    const acceptedOffer = getLocal<HelpOffer[]>('offers', [])
      .find(offer => offer.request_id === requestId && offer.status === 'Accepted');
    const isParticipantPair = acceptedOffer && (
      (raterId === request.requester_id && rateeId === acceptedOffer.helper_id) ||
      (raterId === acceptedOffer.helper_id && rateeId === request.requester_id)
    );
    if (!isParticipantPair) {
      throw new Error('Only the requester and accepted helper can rate each other.');
    }

    const ratings = getLocal<HelpRating[]>('ratings', []);
    if (ratings.some(rating => rating.request_id === requestId && rating.rater_id === raterId)) {
      throw new Error('You have already rated this person for this request.');
    }

    const rating: HelpRating = {
      id: `rating-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      request_id: requestId,
      rater_id: raterId,
      ratee_id: rateeId,
      score,
      created_at: new Date().toISOString()
    };
    ratings.push(rating);
    setLocal('ratings', ratings);
    return rating;
  },

  async createOffer(helperId: string, payload: NewOfferPayload): Promise<HelpOffer> {
    if (isSupabaseConfigured() && supabase) {
      const { data, error } = await supabase
        .from('help_offers')
        .insert({
          request_id: payload.request_id,
          helper_id: helperId,
          message: payload.message.trim(),
          proposed_price_inr: payload.proposed_price_inr || null,
          status: 'Pending'
        })
        .select(`
          *,
          helper:public_profiles (id, name, username, created_at)
        `)
        .single();

      if (error) throw error;
      return data as HelpOffer;
    }

    // Local
    const offers = getLocal<HelpOffer[]>('offers', []);
    const profiles = this.getLocalProfiles();
    const helper = profiles.find(p => p.id === helperId);
    const request = getLocal<HelpRequest[]>('requests', [])
      .find(item => item.id === payload.request_id);
    if (!request || request.status !== 'Open') {
      throw new Error('This request is no longer accepting offers.');
    }
    if (request.is_emergency && request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
      throw new Error('This urgent help alert has expired.');
    }

    // Check if offer already exists for this helper on this request
    const existing = offers.find(o => o.request_id === payload.request_id && o.helper_id === helperId);
    if (existing) {
      throw new Error('You have already submitted an offer for this request.');
    }

    const newOffer: HelpOffer = {
      id: `off-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      request_id: payload.request_id,
      helper_id: helperId,
      message: payload.message.trim(),
      proposed_price_inr: payload.proposed_price_inr ? Number(payload.proposed_price_inr) : null,
      status: 'Pending',
      created_at: new Date().toISOString(),
      helper: helper
        ? {
            id: helper.id,
            name: helper.name,
            username: helper.username,
            created_at: helper.created_at,
            avatar_color: helper.avatar_color
          }
        : undefined
    };

    offers.push(newOffer);
    setLocal('offers', offers);
    return newOffer;
  },

  async acceptOffer(requestId: string, offerId: string): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      // Supabase trigger automatically sets request to Connected and declines other offers
      const { error } = await supabase
        .from('help_offers')
        .update({ status: 'Accepted' })
        .eq('id', offerId);
      if (error) throw error;
      return;
    }

    // Local logic (replicates trigger)
    const offers = getLocal<HelpOffer[]>('offers', []);
    const requests = getLocal<HelpRequest[]>('requests', []);

    // 1. Mark accepted offer
    offers.forEach(o => {
      if (o.request_id === requestId) {
        if (o.id === offerId) {
          o.status = 'Accepted';
        } else if (o.status === 'Pending') {
          o.status = 'Declined';
        }
      }
    });

    // 2. Mark request as Connected
    const req = requests.find(r => r.id === requestId);
    if (req) {
      req.status = 'Connected';
    }

    setLocal('offers', offers);
    setLocal('requests', requests);
  },

  async declineOffer(offerId: string): Promise<void> {
    if (isSupabaseConfigured() && supabase) {
      const { error } = await supabase
        .from('help_offers')
        .update({ status: 'Declined' })
        .eq('id', offerId);
      if (error) throw error;
      return;
    }

    const offers = getLocal<HelpOffer[]>('offers', []);
    const offer = offers.find(o => o.id === offerId);
    if (offer) {
      offer.status = 'Declined';
      setLocal('offers', offers);
    }
  },

  // Realtime updates subscription
  subscribeToMarketplace(onUpdate: () => void): () => void {
    if (!isSupabaseConfigured() || !supabase) {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === 'spider_requests' || event.key === 'spider_offers') onUpdate();
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }

    const channel = supabase
      .channel('schema-db-changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'help_requests' },
        () => onUpdate()
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'help_offers' },
        () => onUpdate()
      )
      .subscribe();

    return () => {
      if (supabase) {
        supabase.removeChannel(channel);
      }
    };
  },

  // Clear locally stored profiles and marketplace data.
  resetLocalData(): void {
    safeStorage.removeItem('spider_profiles');
    safeStorage.removeItem('spider_requests');
    safeStorage.removeItem('spider_offers');
    safeStorage.removeItem('spider_ratings');
    safeStorage.removeItem('spider_active_user_id');
  }
};
