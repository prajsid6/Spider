import { firestore } from '../lib/firebase';
import {
  collection,
  documentId,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  setDoc,
  startAfter,
  updateDoc,
  where
} from 'firebase/firestore';
import type { Profile, PublicProfile, HelpRequest, HelpOffer, HelpRating, NewRequestPayload, NewOfferPayload } from '../types';

export interface RequestPageCursor {
  createdAt: string;
  id: string;
}

export interface RequestPage {
  requests: HelpRequest[];
  hasMore: boolean;
  nextCursor: RequestPageCursor | null;
}

const REQUEST_PAGE_SIZE = 24;

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

  ensureLocalDemoData(): void {
    if (firestore) return;

    const now = Date.now();
    const demoProfiles: Profile[] = [
      { id: 'demo-profile-aanya', name: 'Aanya Sharma', username: 'aanya_demo', mobile_number: '', date_of_birth: '', created_at: new Date(now - 4 * 86400000).toISOString(), avatar_color: '#A78BFA' },
      { id: 'demo-profile-kabir', name: 'Kabir Rao', username: 'kabir_demo', mobile_number: '', date_of_birth: '', created_at: new Date(now - 3 * 86400000).toISOString(), avatar_color: '#60A5FA' },
      { id: 'demo-profile-meera', name: 'Meera Nair', username: 'meera_demo', mobile_number: '', date_of_birth: '', created_at: new Date(now - 2 * 86400000).toISOString(), avatar_color: '#F472B6' },
      { id: 'demo-profile-arjun', name: 'Arjun Das', username: 'arjun_demo', mobile_number: '', date_of_birth: '', created_at: new Date(now - 86400000).toISOString(), avatar_color: '#34D399' }
    ];
    const profiles = this.getLocalProfiles();
    const existingProfileIds = new Set(profiles.map((profile) => profile.id));
    const missingProfiles = demoProfiles.filter((profile) => !existingProfileIds.has(profile.id));
    if (missingProfiles.length > 0) setLocal('profiles', [...profiles, ...missingProfiles]);

    const demoRequests: HelpRequest[] = [
      { id: 'demo-request-aanya', requester_id: 'demo-profile-aanya', description: 'Looking for help setting up a small balcony garden', details: 'Need advice on beginner-friendly plants and arranging pots in a sunny balcony.', budget_inr: 500, connection_mode: 'virtual', status: 'Open', created_at: new Date(now - 2 * 3600000).toISOString(), is_demo: true },
      { id: 'demo-request-kabir', requester_id: 'demo-profile-kabir', description: 'Need help carrying a bookshelf to my apartment', details: 'One medium bookshelf, lift available. Meet near the apartment entrance.', budget_inr: 700, connection_mode: 'in_person', status: 'Open', created_at: new Date(now - 5 * 3600000).toISOString(), is_demo: true },
      { id: 'demo-request-meera', requester_id: 'demo-profile-meera', description: 'Would love a quick review of my resume', details: 'Looking for feedback on clarity and formatting before applying for design roles.', budget_inr: 400, connection_mode: 'virtual', status: 'Open', created_at: new Date(now - 9 * 3600000).toISOString(), is_demo: true },
      { id: 'demo-request-arjun', requester_id: 'demo-profile-arjun', description: 'Looking for someone to walk my dog this evening', details: 'Friendly indie dog, about 30 minutes around the neighborhood.', budget_inr: 300, connection_mode: 'in_person', status: 'Open', created_at: new Date(now - 13 * 3600000).toISOString(), is_demo: true }
    ];
    const requests = getLocal<HelpRequest[]>('requests', []);
    const existingRequestIds = new Set(requests.map((request) => request.id));
    const missingRequests = demoRequests.filter((request) => !existingRequestIds.has(request.id));
    if (missingRequests.length > 0) setLocal('requests', [...missingRequests, ...requests]);
  },

  getLocalDemoProfiles(): Profile[] {
    return this.getLocalProfiles().filter((profile) => profile.id.startsWith('demo-profile-'));
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

  async isUsernameAvailable(username: string, excludingUserId: string): Promise<boolean> {
    if (firestore) {
      const profiles = await getDocs(query(
        collection(firestore, 'publicProfiles'),
        where('username', '==', username)
      ));
      return profiles.docs.every((profile) => profile.id === excludingUserId);
    }

    return this.getLocalProfiles().every((profile) =>
      profile.id === excludingUserId || profile.username.toLowerCase() !== username.toLowerCase()
    );
  },

  // Save/Create Profile (e.g. from sign up)
  async saveProfile(profile: Profile): Promise<Profile> {
    const database = firestore;
    if (database) {
      const username = profile.username.trim().toLowerCase();
      if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
        throw new Error('Username must be 3 to 30 letters, numbers, or underscores.');
      }

      const matchingProfiles = await getDocs(query(
        collection(database, 'publicProfiles'),
        where('username', '==', username)
      ));
      if (matchingProfiles.docs.some((existingProfile) => existingProfile.id !== profile.id)) {
        throw new Error('That username is already taken. Choose another one.');
      }

      const profileRef = doc(database, 'profiles', profile.id);
      const publicProfileRef = doc(database, 'publicProfiles', profile.id);
      const usernameClaimRef = doc(database, 'usernameClaims', username);
      const publicProfile: PublicProfile = {
        id: profile.id,
        name: profile.name,
        username,
        created_at: profile.created_at,
        ...(profile.avatar_color ? { avatar_color: profile.avatar_color } : {})
      };

      await runTransaction(database, async (transaction) => {
        const [claimSnapshot, existingPublicProfile] = await Promise.all([
          transaction.get(usernameClaimRef),
          transaction.get(publicProfileRef)
        ]);
        if (claimSnapshot.exists() && claimSnapshot.data().uid !== profile.id) {
          throw new Error('That username is already taken. Choose another one.');
        }

        const previousUsername = existingPublicProfile.exists()
          ? String(existingPublicProfile.data().username || '').toLowerCase()
          : '';
        const previousClaimRef = previousUsername && previousUsername !== username
          ? doc(database, 'usernameClaims', previousUsername)
          : null;
        const previousClaimSnapshot = previousClaimRef
          ? await transaction.get(previousClaimRef)
          : null;

        transaction.set(usernameClaimRef, { uid: profile.id, username });
        transaction.set(profileRef, { ...profile, username });
        transaction.set(publicProfileRef, publicProfile);
        if (previousClaimRef && previousClaimSnapshot?.exists() && previousClaimSnapshot.data().uid === profile.id) {
          transaction.delete(previousClaimRef);
        }
      });
      return { ...profile, username };
    }

    const profiles = this.getLocalProfiles();
    const username = profile.username.trim().toLowerCase();
    if (profiles.some((existingProfile) =>
      existingProfile.id !== profile.id && existingProfile.username.toLowerCase() === username
    )) {
      throw new Error('That username is already taken. Choose another one.');
    }
    const existingIndex = profiles.findIndex(p => p.id === profile.id);
    if (existingIndex >= 0) {
      profiles[existingIndex] = { ...profile, username };
    } else {
      profiles.push({ ...profile, username });
    }
    setLocal('profiles', profiles);
    safeStorage.setItem('spider_active_user_id', profile.id);
    return { ...profile, username };
  },

  // Requests
  async getRequests(): Promise<HelpRequest[]> {
    return (await this.getRequestPage()).requests;
  },

  async getRequestPage(cursor?: RequestPageCursor | null, locality?: string): Promise<RequestPage> {
    if (firestore) {
      const requestConstraints = [
        ...(locality ? [where('locality', '==', locality)] : []),
        orderBy('created_at', 'desc'),
        orderBy(documentId(), 'desc'),
        ...(cursor ? [startAfter(cursor.createdAt, cursor.id)] : []),
        limit(REQUEST_PAGE_SIZE + 1)
      ];
      const requestSnapshot = await getDocs(query(collection(firestore, 'requests'), ...requestConstraints));
      const hasMore = requestSnapshot.docs.length > REQUEST_PAGE_SIZE;
      const requestDocs = requestSnapshot.docs.slice(0, REQUEST_PAGE_SIZE);
      const nextDoc = requestDocs.at(-1);
      const nextCursor = hasMore && nextDoc
        ? { createdAt: String(nextDoc.data().created_at), id: nextDoc.id }
        : null;
      const requestIds = requestDocs.map((item) => item.id);
      const offerSnapshot = requestIds.length
        ? await getDocs(query(
            collection(firestore, 'offers'),
            where('request_id', 'in', requestIds),
            where('status', '==', 'Accepted')
          ))
        : null;
      const profiles = new Map<string, PublicProfile>();
      await Promise.all(requestDocs.map(async (item) => {
        const request = item.data() as HelpRequest;
        if (request.requester) {
          profiles.set(request.requester_id, request.requester);
          return;
        }
        const profile = await this.getPublicProfile(request.requester_id);
        if (profile) profiles.set(request.requester_id, profile);
      }));
      const offers = offerSnapshot?.docs.map((item) => item.data() as HelpOffer) ?? [];
      const acceptedOffers = new Map(offers.map((offer) => [offer.request_id, offer]));
      const requests = requestDocs
        .map((item) => {
          const request = item.data() as HelpRequest;
          return {
            ...request,
            id: item.id,
            requester: profiles.get(request.requester_id),
            offers_count: request.offers_count ?? 0,
            accepted_offer: acceptedOffers.get(item.id)
          };
        })
        .filter((request) =>
          !request.is_emergency ||
          request.status !== 'Open' ||
          !request.expires_at ||
          new Date(request.expires_at).getTime() > Date.now()
        );
      return { requests, hasMore, nextCursor };
    }

    // Local / Demo Mode
    let requests = getLocal<HelpRequest[]>('requests', []);
    if (locality) requests = requests.filter((request) => request.locality === locality);
    requests = requests
      .filter((request) =>
        !request.is_emergency ||
        request.status !== 'Open' ||
        !request.expires_at ||
        new Date(request.expires_at).getTime() > Date.now()
      )
      .filter((request) => !cursor ||
        request.created_at < cursor.createdAt ||
        (request.created_at === cursor.createdAt && request.id < cursor.id)
      )
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
    const profiles = this.getLocalProfiles();
    const offers = getLocal<HelpOffer[]>('offers', []);

    const hasMore = requests.length > REQUEST_PAGE_SIZE;
    const pageRequests = requests.slice(0, REQUEST_PAGE_SIZE);
    const lastRequest = pageRequests.at(-1);
    return {
      requests: pageRequests.map(req => {
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
      }),
      hasMore,
      nextCursor: hasMore && lastRequest
        ? { createdAt: lastRequest.created_at, id: lastRequest.id }
        : null
    };
  },

  async createRequest(requesterId: string, payload: NewRequestPayload): Promise<HelpRequest> {
    const locality = payload.locality?.trim();
    if (locality && locality.length > 80) {
      throw new Error('Locality must be 80 characters or fewer.');
    }
    if (payload.connection_mode === 'in_person' && !locality) {
      throw new Error('Choose a locality for an in-person request.');
    }
    if (firestore) {
      const requestRef = doc(collection(firestore, 'requests'));
      const requester = await this.getPublicProfile(requesterId);
      const newRequest: HelpRequest = {
        id: requestRef.id,
        requester_id: requesterId,
        ...(locality ? { locality } : {}),
        description: payload.description.trim(),
        details: payload.details?.trim() || null,
        budget_inr: payload.budget_inr ? Number(payload.budget_inr) : null,
        connection_mode: payload.connection_mode ?? 'virtual',
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
      ...(locality ? { locality } : {}),
      description: payload.description.trim(),
      details: payload.details?.trim() || null,
      budget_inr: payload.budget_inr ? Number(payload.budget_inr) : null,
      connection_mode: payload.connection_mode ?? 'virtual',
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
        transaction.update(requestRef, { offers_count: (request.offers_count ?? 0) + 1 });
        return offer;
      });
    }

    // Local
    const offers = getLocal<HelpOffer[]>('offers', []);
    const profiles = this.getLocalProfiles();
    const helper = profiles.find(p => p.id === helperId);
    const requests = getLocal<HelpRequest[]>('requests', []);
    const request = requests.find(item => item.id === payload.request_id);
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
    request.offers_count = (request.offers_count ?? 0) + 1;
    setLocal('requests', requests);
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
  subscribeToMarketplace(onUpdate: () => void, requestIds: string[] = [], locality?: string): () => void {
    if (!firestore) {
      const handleStorage = (event: StorageEvent) => {
        if (event.key === 'spider_requests' || event.key === 'spider_offers') onUpdate();
      };
      window.addEventListener('storage', handleStorage);
      return () => window.removeEventListener('storage', handleStorage);
    }

    const requestConstraints = [
      ...(locality ? [where('locality', '==', locality)] : []),
      orderBy('created_at', 'desc'),
      orderBy(documentId(), 'desc'),
      limit(REQUEST_PAGE_SIZE)
    ];
    const unsubscribeRequests = onSnapshot(query(collection(firestore, 'requests'), ...requestConstraints), onUpdate, (error) => {
      console.error('Marketplace request subscription failed:', error);
    });
    const unsubscribeOffers: Array<() => void> = [];
    for (let index = 0; index < requestIds.length; index += 15) {
      const requestIdBatch = requestIds.slice(index, index + 15);
      unsubscribeOffers.push(onSnapshot(
        query(
          collection(firestore, 'offers'),
          where('request_id', 'in', requestIdBatch),
          where('status', 'in', ['Accepted', 'Declined'])
        ),
        onUpdate,
        (error) => {
          console.error('Marketplace offer status subscription failed:', error);
        }
      ));
    }
    return () => {
      unsubscribeRequests();
      unsubscribeOffers.forEach((unsubscribe) => unsubscribe());
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
