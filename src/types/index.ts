export type RequestStatus = 'Open' | 'Connected' | 'Completed';
export type OfferStatus = 'Pending' | 'Accepted' | 'Declined';

export interface Profile {
  id: string;
  name: string;
  username: string;
  email?: string;
  mobile_number: string;
  date_of_birth: string; // YYYY-MM-DD
  created_at: string;
  avatar_color?: string;
}

export interface PublicProfile {
  id: string;
  name: string;
  username: string;
  created_at: string;
  avatar_color?: string;
}

export interface HelpRequest {
  id: string;
  requester_id: string;
  description: string;
  details?: string | null;
  budget_inr?: number | null;
  status: RequestStatus;
  created_at: string;
  is_emergency?: boolean;
  expires_at?: string | null;
  accepted_offer_id?: string;
  // Joined or calculated fields
  requester?: PublicProfile;
  offers_count?: number;
  accepted_offer?: HelpOffer;
}

export interface HelpOffer {
  id: string;
  request_id: string;
  helper_id: string;
  message: string;
  proposed_price_inr?: number | null;
  status: OfferStatus;
  created_at: string;
  // Joined fields
  helper?: PublicProfile;
  helper_contact?: {
    name: string;
    username: string;
  };
}

export interface HelpRating {
  id: string;
  request_id: string;
  rater_id: string;
  ratee_id: string;
  score: number;
  created_at: string;
}

export interface NewRequestPayload {
  description: string;
  details?: string;
  budget_inr?: number;
  is_emergency?: boolean;
  expires_at?: string;
}

export interface NewOfferPayload {
  request_id: string;
  message: string;
  proposed_price_inr?: number;
}
