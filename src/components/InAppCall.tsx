import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Volume2 } from 'lucide-react';
import { httpsCallable } from 'firebase/functions';
import { child, onChildAdded, push, ref, remove, set, type DatabaseReference } from 'firebase/database';
import { auth, functions, realtimeDatabase } from '../lib/firebase';
import { useToast } from '../context/ToastContext';

interface InAppCallProps {
  requestId: string;
  offerId: string;
  otherUsername: string;
}

type CallStatus = 'idle' | 'incoming' | 'connecting' | 'active';
type CallSignalType = 'call-offer' | 'call-answer' | 'ice-candidate' | 'call-hangup' | 'call-decline';
type CallSignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};
type CallSignal = {
  type: CallSignalType;
  callId: string;
  senderId: string;
  createdAt: number;
  payload: CallSignalPayload;
};

export const InAppCall: React.FC<InAppCallProps> = ({ requestId, offerId, otherUsername }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<CallStatus>('idle');
  const [channelReady, setChannelReady] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const signalPathRef = useRef<DatabaseReference | null>(null);
  const signalRecordsRef = useRef<Map<string, CallSignal>>(new Map());
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<string | null>(null);
  const statusRef = useRef(status);
  const incomingOfferRef = useRef<RTCSessionDescriptionInit | null>(null);
  const pendingCandidatesRef = useRef<Array<{ callId: string; candidate: RTCIceCandidateInit }>>([]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    if (!realtimeDatabase || !functions) {
      setChannelReady(false);
      setError('In-app calling requires Firebase to be configured. Check the Firebase calling setup.');
      return;
    }

    const audioElement = remoteAudio.current;
    const signalPath = ref(realtimeDatabase, `callSignals/${requestId}/${offerId}`);
    signalPathRef.current = signalPath;

    const cleanupCallSignals = async (callId: string) => {
      const currentSignals = Array.from(signalRecordsRef.current.entries())
        .filter(([, signal]) => signal.callId === callId);
      await Promise.all(currentSignals.map(async ([key]) => {
        await remove(child(signalPath, key));
        signalRecordsRef.current.delete(key);
      }));
    };

    const addPendingCandidates = async (peer: RTCPeerConnection, callId: string) => {
      const candidates = pendingCandidatesRef.current.filter((item) => item.callId === callId);
      pendingCandidatesRef.current = pendingCandidatesRef.current.filter((item) => item.callId !== callId);
      await Promise.all(candidates.map(({ candidate }) => peer.addIceCandidate(candidate)));
    };

    const unsubscribe = onChildAdded(signalPath, (snapshot) => {
      const signal = snapshot.val() as CallSignal | null;
      if (!signal || !signal.type || !signal.callId || !signal.senderId) return;
      signalRecordsRef.current.set(snapshot.key ?? '', signal);
      if (signal.senderId === auth?.currentUser?.uid) return;

      if (signal.type === 'call-offer' && statusRef.current === 'idle' && signal.payload?.description) {
        callIdRef.current = signal.callId;
        incomingOfferRef.current = signal.payload.description;
        setError('');
        setStatus('incoming');
      } else if (signal.type === 'call-answer') {
        const peer = peerRef.current;
        if (peer && signal.callId === callIdRef.current && signal.payload?.description) {
          void peer.setRemoteDescription(signal.payload.description)
            .then(() => addPendingCandidates(peer, signal.callId))
            .catch((answerError: unknown) => setError(answerError instanceof Error ? answerError.message : 'Could not connect the call.'));
        }
      } else if (signal.type === 'ice-candidate' && signal.payload?.candidate) {
        const peer = peerRef.current;
        if (peer && signal.callId === callIdRef.current && peer.remoteDescription) {
          void peer.addIceCandidate(signal.payload.candidate).catch((candidateError: unknown) => {
            setError(candidateError instanceof Error ? candidateError.message : 'Call connection failed.');
          });
        } else {
          pendingCandidatesRef.current.push({ callId: signal.callId, candidate: signal.payload.candidate });
        }
      } else if (signal.type === 'call-hangup' || signal.type === 'call-decline') {
        if (signal.callId === callIdRef.current) {
          callIdRef.current = null;
          incomingOfferRef.current = null;
          peerRef.current?.close();
          peerRef.current = null;
          localStreamRef.current?.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          if (remoteAudio.current) remoteAudio.current.srcObject = null;
          setStatus('idle');
          if (signal.type === 'call-hangup') {
            showToast('The other person ended the call.', 'info');
          } else {
            setError('The other person declined the call.');
          }
          void cleanupCallSignals(signal.callId).catch(() => {
            setError('Could not clean up Firebase call signals.');
          });
        }
      }
    }, () => {
      setChannelReady(false);
      setError('Could not connect to call service. Check the Firebase Realtime Database setup.');
    });

    setChannelReady(true);

    return () => {
      const currentCallId = callIdRef.current;
      if (currentCallId) {
        const senderId = auth?.currentUser?.uid;
        if (senderId) {
          const signalRef = push(signalPath);
          if (signalRef.key) {
            const signal: CallSignal = {
              type: 'call-hangup',
              callId: currentCallId,
              senderId,
              createdAt: Date.now(),
              payload: {}
            };
            void set(signalRef, signal).then(() => {
              signalRecordsRef.current.set(signalRef.key as string, signal);
              window.setTimeout(() => {
                void cleanupCallSignals(currentCallId).catch(() => undefined);
              }, 1500);
            }).catch(() => undefined);
          }
        }
      }
      unsubscribe();
      signalPathRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (audioElement) audioElement.srcObject = null;
      setChannelReady(false);
    };
  }, [requestId, offerId, showToast]);

  const getIceServers = async () => {
    if (!functions) {
      throw new Error('In-app calling requires Firebase Functions to be configured.');
    }
    try {
      const getTurnCredentials = httpsCallable(functions, 'getTurnCredentials');
      const result = await getTurnCredentials({ requestId, offerId });
      const data = result.data as { iceServers?: RTCIceServer[] } | undefined;
      if (!data?.iceServers?.length) {
        throw new Error('Call connection settings are unavailable. Check the Firebase calling setup.');
      }
      return data.iceServers;
    } catch (turnError) {
      if (turnError instanceof Error && turnError.message.includes('Firebase')) throw turnError;
      throw new Error('Could not get TURN credentials from Firebase. Check the Firebase Functions setup.');
    }
  };

  const publishSignal = async (
    type: CallSignalType,
    callId: string,
    payload: CallSignalPayload
  ) => {
    const senderId = auth?.currentUser?.uid;
    const signalPath = signalPathRef.current;
    if (!senderId) throw new Error('You must be signed in with Firebase to place a call.');
    if (!signalPath) throw new Error('In-app calling requires a configured Firebase Realtime Database.');

    const signalRef = push(signalPath);
    if (!signalRef.key) throw new Error('Could not create a Firebase call signal.');
    const signal: CallSignal = { type, callId, senderId, createdAt: Date.now(), payload };
    await set(signalRef, signal);
    signalRecordsRef.current.set(signalRef.key, signal);
  };

  const cleanupCallSignals = async (callId: string) => {
    const signalPath = signalPathRef.current;
    if (!signalPath) return;
    const currentSignals = Array.from(signalRecordsRef.current.entries())
      .filter(([, signal]) => signal.callId === callId);
    await Promise.all(currentSignals.map(async ([key]) => {
      await remove(child(signalPath, key));
      signalRecordsRef.current.delete(key);
    }));
  };

  const startCall = async () => {
    if (!realtimeDatabase || !signalPathRef.current) {
      setError('In-app calling requires a configured Firebase project and Realtime Database.');
      return;
    }
    setError('');
    const callId = crypto.randomUUID();
    callIdRef.current = callId;
    setStatus('connecting');
    try {
      const iceServers = await getIceServers();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const peer = new RTCPeerConnection({ iceServers });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (remoteAudio.current) remoteAudio.current.srcObject = event.streams[0];
      };
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void publishSignal('ice-candidate', callId, { candidate: event.candidate.toJSON() })
          .catch(() => setError('Could not send Firebase call connection data.'));
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setStatus('active');
        if (peer.connectionState === 'failed') setError('Could not connect the call. Check your network and try again.');
      };
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      await publishSignal('call-offer', callId, { description: peer.localDescription ?? undefined });
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not start the Firebase call.');
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      callIdRef.current = null;
      setStatus('idle');
    }
  };

  const answerCall = async () => {
    if (!realtimeDatabase || !callIdRef.current || !incomingOfferRef.current) return;
    setError('');
    setStatus('connecting');
    try {
      const iceServers = await getIceServers();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const peer = new RTCPeerConnection({ iceServers });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (remoteAudio.current) remoteAudio.current.srcObject = event.streams[0];
      };
      const callId = callIdRef.current;
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void publishSignal('ice-candidate', callId, { candidate: event.candidate.toJSON() })
          .catch(() => setError('Could not send Firebase call connection data.'));
      };
      peer.onconnectionstatechange = () => {
        if (peer.connectionState === 'connected') setStatus('active');
        if (peer.connectionState === 'failed') setError('Could not connect the call. Check your network and try again.');
      };
      await peer.setRemoteDescription(incomingOfferRef.current);
      const candidates = pendingCandidatesRef.current.filter((item) => item.callId === callId);
      pendingCandidatesRef.current = pendingCandidatesRef.current.filter((item) => item.callId !== callId);
      await Promise.all(candidates.map(({ candidate }) => peer.addIceCandidate(candidate)));
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      await publishSignal('call-answer', callId, { description: peer.localDescription ?? undefined });
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not answer the Firebase call.');
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      setStatus('incoming');
    }
  };

  const endCall = async (decline = false) => {
    const callId = callIdRef.current;
    if (callId) {
      try {
        await publishSignal(decline ? 'call-decline' : 'call-hangup', callId, {});
        window.setTimeout(() => {
          void cleanupCallSignals(callId).catch(() => {
            setError('Could not clean up Firebase call signals.');
          });
        }, 1500);
      } catch {
        setError('Could not send Firebase call signals.');
      }
    }
    callIdRef.current = null;
    incomingOfferRef.current = null;
    peerRef.current?.close();
    peerRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    if (remoteAudio.current) remoteAudio.current.srcObject = null;
    setStatus('idle');
    setMuted(false);
  };

  const toggleMute = () => {
    const nextMuted = !muted;
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !nextMuted;
    });
    setMuted(nextMuted);
  };

  return (
    <div className="flex flex-col items-start gap-2">
      <audio ref={remoteAudio} autoPlay />
      {status === 'idle' && (
        <button onClick={() => void startCall()} disabled={!channelReady} className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold disabled:opacity-50">
          <Phone className="h-3.5 w-3.5" />
          Call @{otherUsername}
        </button>
      )}
      {status === 'incoming' && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-spider-text">Incoming call from @{otherUsername}</span>
          <button onClick={() => void answerCall()} className="btn-primary flex items-center gap-1.5 py-1.5 px-3 text-xs font-bold">
            <Phone className="h-3.5 w-3.5" /> Answer
          </button>
          <button onClick={() => void endCall(true)} className="btn-outline flex items-center gap-1.5 py-1.5 px-3 text-xs">
            <PhoneOff className="h-3.5 w-3.5" /> Decline
          </button>
        </div>
      )}
      {(status === 'connecting' || status === 'active') && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold text-spider-text" aria-live="polite">
            {status === 'active' ? `In call with @${otherUsername}` : 'Connecting call...'}
          </span>
          {status === 'active' && (
            <button onClick={toggleMute} className="btn-outline flex items-center gap-1.5 py-1.5 px-3 text-xs">
              <Volume2 className="h-3.5 w-3.5" /> {muted ? 'Unmute' : 'Mute'}
            </button>
          )}
          <button onClick={() => void endCall()} className="btn-outline flex items-center gap-1.5 py-1.5 px-3 text-xs text-rose-700">
            <PhoneOff className="h-3.5 w-3.5" /> End call
          </button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-rose-700">{error}</p>}
    </div>
  );
};
