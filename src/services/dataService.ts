import { firestore } from '../lib/firebase';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch
} from 'firebase/firestore';
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
const LOCAL_EMAIL_CREDENTIALS_KEY = 'local_email_credentials';

interface LocalEmailCredential {
  salt: string;
  passwordHash: string;
}

const bytesToHex = (bytes: Uint8Array): string =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

const deriveLocalPasswordHash = async (password: string, salt: string): Promise<string> => {
  const saltBytes = Uint8Array.from(salt.match(/.{2}/g) || [], (byte) => Number.parseInt(byte, 16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const hash = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations: 120_000 },
    key,
    256
  );
  return bytesToHex(new Uint8Array(hash));
};

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
// SERVICE IMPLEMENTATION (FIRESTORE + LOCAL STORAGE)
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

  getLocalProfileByEmail(email: string): Profile | null {
    const normalizedEmail = email.trim().toLowerCase();
    return this.getLocalProfiles().find((profile) => profile.email?.trim().toLowerCase() === normalizedEmail) || null;
  },

  async saveLocalEmailPassword(email: string, password: string): Promise<void> {
    const credentials = getLocal<Record<string, LocalEmailCredential>>(LOCAL_EMAIL_CREDENTIALS_KEY, {});
    const normalizedEmail = email.trim().toLowerCase();
    if (credentials[normalizedEmail]) throw new Error('An account already exists for this email.');

    const salt = bytesToHex(crypto.getRandomValues(new Uint8Array(16)));
    credentials[normalizedEmail] = {
      salt,
      passwordHash: await deriveLocalPasswordHash(password, salt)
    };
    setLocal(LOCAL_EMAIL_CREDENTIALS_KEY, credentials);
  },

  async verifyLocalEmailPassword(email: string, password: string): Promise<boolean> {
    const normalizedEmail = email.trim().toLowerCase();
    const credentials = getLocal<Record<string, LocalEmailCredential>>(LOCAL_EMAIL_CREDENTIALS_KEY, {});
    const credential = credentials[normalizedEmail];
    if (!credential) return false;
    const passwordHash = await deriveLocalPasswordHash(password, credential.salt);
    if (passwordHash.length !== credential.passwordHash.length) return false;
    let difference = 0;
    for (let index = 0; index < passwordHash.length; index += 1) {
      difference |= passwordHash.charCodeAt(index) ^ credential.passwordHash.charCodeAt(index);
    }
    return difference === 0;
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
    if (firestore) {
      const profile = await getDoc(doc(firestore, 'profiles', userId));
      return profile.exists() ? profile.data() as Profile : null;
    }
    const profiles = this.getLocalProfiles();
    return profiles.find(p => p.id === userId) || null;
  },

  async getPublicProfile(userId: string): Promise<PublicProfile | null> {
    if (firestore) {
      const profile = await getDoc(doc(firestore, 'publicProfiles', userId));
      return profile.exists() ? profile.data() as PublicProfile : null;
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
    if (firestore) {
      const batch = writeBatch(firestore);
      batch.set(doc(firestore, 'profiles', profile.id), profile);
      const publicProfile: PublicProfile = {
        id: profile.id,
        name: profile.name,
        username: profile.username,
        created_at: profile.created_at,
        ...(profile.avatar_color ? { avatar_color: profile.avatar_color } : {})
      };
      batch.set(doc(firestore, 'publicProfiles', profile.id), publicProfile);
      await batch.commit();
      return profile;
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
    if (firestore) {
      const [requestSnapshot, offerSnapshot] = await Promise.all([
        getDocs(query(collection(firestore, 'requests'), orderBy('created_at', 'desc'))),
        getDocs(collection(firestore, 'offers'))
      ]);
      const profiles = new Map<string, PublicProfile>();
      const profileIds = [...new Set(requestSnapshot.docs.map((item) => item.data().requester_id as string))];
      await Promise.all(profileIds.map(async (profileId) => {
        const profile = await this.getPublicProfile(profileId);
        if (profile) profiles.set(profileId, profile);
      }));
      const offers = offerSnapshot.docs.map((item) => item.data() as HelpOffer);
      return requestSnapshot.docs
        .map((item) => {
          const request = item.data() as HelpRequest;
          const requestOffers = offers.filter((offer) => offer.request_id === item.id);
          return {
            ...request,
            id: item.id,
            requester: profiles.get(request.requester_id),
            offers_count: requestOffers.length,
            accepted_offer: requestOffers.find((offer) => offer.status === 'Accepted')
          };
        })
        .filter((request) =>
          !request.is_emergency ||
          request.status !== 'Open' ||
          !request.expires_at ||
          new Date(request.expires_at).getTime() > Date.now()
        );
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
    if (firestore) {
      const requestRef = doc(collection(firestore, 'requests'));
      const requester = await this.getPublicProfile(requesterId);
      const newRequest: HelpRequest = {
        id: requestRef.id,
        requester_id: requesterId,
        description: payload.description.trim(),
        details: payload.details?.trim() || null,
        budget_inr: payload.budget_inr ? Number(payload.budget_inr) : null,
        status: 'Open',
        created_at: new Date().toISOString(),
        is_emergency: payload.is_emergency ?? false,
        expires_at: payload.expires_at ?? null,
        offers_count: 0,
        requester: requester || undefined
      };
      await setDoc(requestRef, newRequest);
      return newRequest;
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
    if (firestore) {
      await updateDoc(doc(firestore, 'requests', requestId), { status });
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
    if (firestore) {
      const offers = await getDocs(query(
        collection(firestore, 'offers'),
        where('request_id', '==', requestId),
        orderBy('created_at', 'desc')
      ));
      return Promise.all(offers.docs.map(async (item) => {
        const offer = item.data() as HelpOffer;
        const helper = await this.getPublicProfile(offer.helper_id);
        return {
          ...offer,
          id: item.id,
          helper: helper || undefined,
          helper_contact: offer.status === 'Accepted' && helper ? {
            name: helper.name,
            username: helper.username
          } : undefined
        };
      }));
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
    if (firestore) {
      const ratings = await getDocs(query(
        collection(firestore, 'ratings'),
        where('request_id', '==', requestId),
        orderBy('created_at', 'asc')
      ));
      return ratings.docs.map((item) => ({ ...item.data(), id: item.id }) as HelpRating);
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

    if (firestore) {
      const database = firestore;
      const ratingId = `${requestId}_${raterId}`;
      const ratingRef = doc(database, 'ratings', ratingId);
      const requestRef = doc(database, 'requests', requestId);
      const possibleOfferRefs = [
        doc(database, 'offers', `${requestId}_${rateeId}`),
        doc(database, 'offers', `${requestId}_${raterId}`)
      ];
      return runTransaction(database, async (transaction) => {
        const [requestSnapshot, ratingSnapshot, ...offerSnapshots] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(ratingRef),
          ...possibleOfferRefs.map((offerRef) => transaction.get(offerRef))
        ]);
        if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'Completed') {
          throw new Error('Ratings are available only after a request is completed.');
        }
        const acceptedOffer = offerSnapshots
          .map((offer) => offer.exists() ? offer.data() as HelpOffer : null)
          .find((offer) => offer?.status === 'Accepted');
        const request = requestSnapshot.data() as HelpRequest;
        const isParticipantPair = acceptedOffer && (
          (raterId === request.requester_id && rateeId === acceptedOffer.helper_id) ||
          (raterId === acceptedOffer.helper_id && rateeId === request.requester_id)
        );
        if (!isParticipantPair) throw new Error('Only the requester and accepted helper can rate each other.');
        if (ratingSnapshot.exists()) {
          throw new Error('You have already rated this person for this request.');
        }
        const rating: HelpRating = {
          id: ratingId,
          request_id: requestId,
          rater_id: raterId,
          ratee_id: rateeId,
          score,
          created_at: new Date().toISOString()
        };
        transaction.set(ratingRef, rating);
        return rating;
      });
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
    if (firestore) {
      const requestRef = doc(firestore, 'requests', payload.request_id);
      const helper = await this.getPublicProfile(helperId);
      const offerRef = doc(firestore, 'offers', `${payload.request_id}_${helperId}`);
      return runTransaction(firestore, async (transaction) => {
        const requestSnapshot = await transaction.get(requestRef);
        const existingOffer = await transaction.get(offerRef);
        if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'Open') {
          throw new Error('This request is no longer accepting offers.');
        }
        const request = requestSnapshot.data() as HelpRequest;
        if (request.is_emergency && request.expires_at && new Date(request.expires_at).getTime() <= Date.now()) {
          throw new Error('This urgent help alert has expired.');
        }
        if (existingOffer.exists()) throw new Error('You have already submitted an offer for this request.');
        const offer: HelpOffer = {
          id: offerRef.id,
          request_id: payload.request_id,
          helper_id: helperId,
          message: payload.message.trim(),
          proposed_price_inr: payload.proposed_price_inr ? Number(payload.proposed_price_inr) : null,
          status: 'Pending',
          created_at: new Date().toISOString(),
          helper: helper || undefined
        };
        transaction.set(offerRef, offer);
        return offer;
      });
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
    if (firestore) {
      const database = firestore;
      const requestRef = doc(database, 'requests', requestId);
      const offerRef = doc(database, 'offers', offerId);
      const pendingOffers = await getDocs(query(
        collection(database, 'offers'),
        where('request_id', '==', requestId),
        where('status', '==', 'Pending')
      ));
      await runTransaction(database, async (transaction) => {
        const [requestSnapshot, offerSnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(offerRef)
        ]);
        if (!requestSnapshot.exists() || requestSnapshot.data().status !== 'Open') {
          throw new Error('This request is no longer open.');
        }
        if (!offerSnapshot.exists() || offerSnapshot.data().request_id !== requestId || offerSnapshot.data().status !== 'Pending') {
          throw new Error('This offer is no longer available.');
        }
        const competingOffers = await Promise.all(pendingOffers.docs.map((offer) => transaction.get(offer.ref)));
        competingOffers.forEach((offer) => {
          if (offer.exists() && offer.data().status === 'Pending') {
            transaction.update(offer.ref, { status: offer.id === offerId ? 'Accepted' : 'Declined' });
          }
        });
        transaction.update(requestRef, { status: 'Connected', accepted_offer_id: offerId });
      });
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
      req.accepted_offer_id = offerId;
    }

    setLocal('offers', offers);
    setLocal('requests', requests);
  },

  async declineOffer(offerId: string): Promise<void> {
    if (firestore) {
      await updateDoc(doc(firestore, 'offers', offerId), { status: 'Declined' });
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
    if (!firestore) {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === 'spider_requests' || event.key === 'spider_offers') onUpdate();
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }

    const unsubscribeRequests = onSnapshot(collection(firestore, 'requests'), onUpdate, (error) => {
      console.error('Marketplace request subscription failed:', error);
    });
    const unsubscribeOffers = onSnapshot(collection(firestore, 'offers'), onUpdate, (error) => {
      console.error('Marketplace offer subscription failed:', error);
    });
    return () => {
      unsubscribeRequests();
      unsubscribeOffers();
    };
  },

  // Clear locally stored profiles and marketplace data.
  resetLocalData(): void {
    safeStorage.removeItem('spider_profiles');
    safeStorage.removeItem('spider_requests');
    safeStorage.removeItem('spider_offers');
    safeStorage.removeItem('spider_ratings');
    safeStorage.removeItem(`spider_${LOCAL_EMAIL_CREDENTIALS_KEY}`);
    safeStorage.removeItem('spider_active_user_id');
  }
};
