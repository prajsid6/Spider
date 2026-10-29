import { beforeEach, describe, expect, it } from 'vitest';
import { DataService } from './dataService';
import type { Profile } from '../types';

const testProfiles: Profile[] = [
  {
    id: 'test-user-requester',
    name: 'Test Requester',
    username: 'test_requester',
    mobile_number: '+91 98765 43210',
    date_of_birth: '1998-05-14',
    created_at: '2026-10-15T10:00:00Z'
  },
  {
    id: 'test-user-helper',
    name: 'Test Helper',
    username: 'test_helper',
    mobile_number: '+91 98220 11223',
    date_of_birth: '2001-09-22',
    created_at: '2026-10-18T14:30:00Z'
  },
  {
    id: 'test-user-second-helper',
    name: 'Second Helper',
    username: 'second_helper',
    mobile_number: '+91 97654 99887',
    date_of_birth: '1995-12-03',
    created_at: '2026-10-20T09:15:00Z'
  }
];

describe('Spider DataService & Marketplace Logic', () => {
  beforeEach(async () => {
    DataService.resetLocalData();
    for (const profile of testProfiles) await DataService.saveProfile(profile);
  });

  it('starts without seeded profiles, requests, or offers', async () => {
    expect(await DataService.getRequests()).toEqual([]);
    expect(DataService.getLocalProfiles().map((profile) => profile.id)).toEqual(
      testProfiles.map((profile) => profile.id)
    );
    expect(await DataService.getOffersForRequest('req-1')).toEqual([]);
  });

  it('finds local demo accounts by normalized phone digits', () => {
    expect(DataService.getLocalProfileByPhone('+91 98765 43210')?.id).toBe(testProfiles[0].id);
    expect(DataService.getLocalProfileByPhone('+919999999999')).toBeNull();
    expect(() => DataService.setLocalActiveUser('missing-user')).toThrow('Local demo account was not found.');
  });

  it('can create a new help request', async () => {
    const user = DataService.getCurrentUser();
    expect(user).toBeDefined();

    const newRequest = await DataService.createRequest(user!.id, {
      description: 'Need help assembling my standing desk',
      details: 'Have all parts ready in living room',
      budget_inr: 750
    });

    expect(newRequest.id).toBeDefined();
    expect(newRequest.status).toBe('Open');
    expect(newRequest.budget_inr).toBe(750);
    expect(newRequest.requester_id).toBe(user!.id);
    expect((await DataService.getRequests()).some((request) => request.id === newRequest.id)).toBe(true);
  });

  it('creates urgent requests and hides expired alerts', async () => {
    const requester = testProfiles[0];
    const activeAlert = await DataService.createRequest(requester.id, {
      description: 'Need urgent help with a flat tyre',
      details: 'Area / landmark: Indiranagar',
      is_emergency: true,
      expires_at: new Date(Date.now() + 3 * 60 * 1000).toISOString()
    });

    expect(activeAlert.is_emergency).toBe(true);
    expect(new Date(activeAlert.expires_at!).getTime()).toBeGreaterThan(Date.now());
    expect((await DataService.getRequests()).some((request) => request.id === activeAlert.id)).toBe(true);

    const expiredAlert = await DataService.createRequest(requester.id, {
      description: 'Need urgent help with a flat tyre',
      is_emergency: true,
      expires_at: new Date(Date.now() - 1000).toISOString()
    });

    expect((await DataService.getRequests()).some((request) => request.id === expiredAlert.id)).toBe(false);
    await expect(DataService.createOffer(testProfiles[1].id, {
      request_id: expiredAlert.id,
      message: 'I can help now.'
    })).rejects.toThrow('expired');
  });

  it('accepts one offer, declines competitors, and unlocks username-based contact', async () => {
    const request = await DataService.createRequest(testProfiles[0].id, {
      description: 'Need math tutoring on calculus for college midterm',
      budget_inr: 1000
    });
    const acceptedOffer = await DataService.createOffer(testProfiles[1].id, {
      request_id: request.id,
      message: 'I have a Masters in Applied Math. Can tutor tonight.',
      proposed_price_inr: 1000
    });
    const competingOffer = await DataService.createOffer(testProfiles[2].id, {
      request_id: request.id,
      message: 'I can do it for ₹900 right now.',
      proposed_price_inr: 900
    });

    await DataService.acceptOffer(request.id, acceptedOffer.id);

    const updatedRequest = (await DataService.getRequests()).find((item) => item.id === request.id);
    const offers = await DataService.getOffersForRequest(request.id);
    expect(updatedRequest?.status).toBe('Connected');
    expect(offers.find((offer) => offer.id === acceptedOffer.id)?.status).toBe('Accepted');
    expect(offers.find((offer) => offer.id === competingOffer.id)?.status).toBe('Declined');
    const helperContact = offers.find((offer) => offer.id === acceptedOffer.id)?.helper_contact;
    expect(helperContact?.username).toBe(testProfiles[1].username);
    expect(helperContact).not.toHaveProperty('mobile_number');
  });

  it('prevents duplicate offers from the same helper on the same request', async () => {
    const request = await DataService.createRequest(testProfiles[0].id, {
      description: 'Help moving a heavy wooden desk',
      budget_inr: 500
    });
    const offer = {
      request_id: request.id,
      message: 'I can help you lift it.'
    };

    await DataService.createOffer(testProfiles[1].id, offer);
    await expect(DataService.createOffer(testProfiles[1].id, {
      ...offer,
      message: 'Second offer attempt'
    })).rejects.toThrow('already submitted');
  });

  it('can mark a request as completed', async () => {
    const request = await DataService.createRequest(testProfiles[0].id, {
      description: 'Help organize my work desk'
    });

    await DataService.updateRequestStatus(request.id, 'Completed');

    const updated = (await DataService.getRequests()).find((item) => item.id === request.id);
    expect(updated?.status).toBe('Completed');
  });

  it('lets both participants rate each other once after completion', async () => {
    const request = await DataService.createRequest(testProfiles[0].id, {
      description: 'Need a short tutoring session'
    });
    const offer = await DataService.createOffer(testProfiles[1].id, {
      request_id: request.id,
      message: 'Happy to help with tutoring.'
    });
    await DataService.acceptOffer(request.id, offer.id);
    await DataService.updateRequestStatus(request.id, 'Completed');

    const requesterRating = await DataService.submitRating(request.id, testProfiles[0].id, testProfiles[1].id, 9);
    const helperRating = await DataService.submitRating(request.id, testProfiles[1].id, testProfiles[0].id, 8);

    expect(requesterRating.score).toBe(9);
    expect(helperRating.score).toBe(8);
    await expect(DataService.submitRating(request.id, testProfiles[0].id, testProfiles[1].id, 10))
      .rejects.toThrow('already rated');
  });

  it('rejects invalid scores and ratings for unfinished or unrelated users', async () => {
    const unfinishedRequest = await DataService.createRequest(testProfiles[0].id, {
      description: 'Unfinished request for rating checks'
    });
    const completedRequest = await DataService.createRequest(testProfiles[0].id, {
      description: 'Completed request for rating checks'
    });
    const acceptedOffer = await DataService.createOffer(testProfiles[1].id, {
      request_id: completedRequest.id,
      message: 'I can help with this request.'
    });
    await DataService.acceptOffer(completedRequest.id, acceptedOffer.id);
    await DataService.updateRequestStatus(completedRequest.id, 'Completed');

    await expect(DataService.submitRating(unfinishedRequest.id, testProfiles[0].id, testProfiles[1].id, 7))
      .rejects.toThrow('only after a request is completed');
    await expect(DataService.submitRating(completedRequest.id, testProfiles[0].id, testProfiles[1].id, 11))
      .rejects.toThrow('whole number from 1 to 10');
    await expect(DataService.submitRating(completedRequest.id, testProfiles[0].id, testProfiles[2].id, 7))
      .rejects.toThrow('Only the requester and accepted helper can rate each other.');
  });
});
