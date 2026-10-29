import React, { useEffect, useRef, useState } from 'react';
import { Phone, PhoneOff, Volume2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useToast } from '../context/ToastContext';

interface InAppCallProps {
  requestId: string;
  offerId: string;
  otherUsername: string;
}

type CallStatus = 'idle' | 'incoming' | 'connecting' | 'active';
type CallSignal = {
  callId: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

export const InAppCall: React.FC<InAppCallProps> = ({ requestId, offerId, otherUsername }) => {
  const { showToast } = useToast();
  const [status, setStatus] = useState<CallStatus>('idle');
  const [channelReady, setChannelReady] = useState(false);
  const [error, setError] = useState('');
  const [muted, setMuted] = useState(false);
  const remoteAudio = useRef<HTMLAudioElement>(null);
  const channelRef = useRef<ReturnType<NonNullable<typeof supabase>['channel']> | null>(null);
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
    if (!supabase) return;
    const client = supabase;
    const audioElement = remoteAudio.current;
    const channel = client.channel(`spider-call:${requestId}:${offerId}`, {
      config: { private: true, broadcast: { self: false } }
    });
    channelRef.current = channel;

    const addPendingCandidates = async (peer: RTCPeerConnection, callId: string) => {
      const candidates = pendingCandidatesRef.current.filter((item) => item.callId === callId);
      pendingCandidatesRef.current = pendingCandidatesRef.current.filter((item) => item.callId !== callId);
      await Promise.all(candidates.map(({ candidate }) => peer.addIceCandidate(candidate)));
    };

    channel
      .on('broadcast', { event: 'call-offer' }, ({ payload }) => {
        const signal = payload as CallSignal;
        if (statusRef.current === 'idle' && signal.callId && signal.description) {
          callIdRef.current = signal.callId;
          incomingOfferRef.current = signal.description;
          setError('');
          setStatus('incoming');
        }
      })
      .on('broadcast', { event: 'call-answer' }, ({ payload }) => {
        const signal = payload as CallSignal;
        const peer = peerRef.current;
        if (peer && signal.callId === callIdRef.current && signal.description) {
          void peer.setRemoteDescription(signal.description)
            .then(() => addPendingCandidates(peer, signal.callId))
            .catch((answerError: unknown) => setError(answerError instanceof Error ? answerError.message : 'Could not connect the call.'));
        }
      })
      .on('broadcast', { event: 'ice-candidate' }, ({ payload }) => {
        const signal = payload as CallSignal;
        if (!signal.callId || !signal.candidate) return;
        const peer = peerRef.current;
        if (peer && signal.callId === callIdRef.current && peer.remoteDescription) {
          void peer.addIceCandidate(signal.candidate).catch((candidateError: unknown) => {
            setError(candidateError instanceof Error ? candidateError.message : 'Call connection failed.');
          });
        } else {
          pendingCandidatesRef.current.push({ callId: signal.callId, candidate: signal.candidate });
        }
      })
      .on('broadcast', { event: 'call-hangup' }, ({ payload }) => {
        const signal = payload as CallSignal;
        if (signal.callId && signal.callId === callIdRef.current) {
          callIdRef.current = null;
          incomingOfferRef.current = null;
          peerRef.current?.close();
          peerRef.current = null;
          localStreamRef.current?.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          if (remoteAudio.current) remoteAudio.current.srcObject = null;
          setStatus('idle');
          showToast('The other person ended the call.', 'info');
        }
      })
      .on('broadcast', { event: 'call-decline' }, ({ payload }) => {
        const signal = payload as CallSignal;
        if (signal.callId && signal.callId === callIdRef.current) {
          callIdRef.current = null;
          incomingOfferRef.current = null;
          peerRef.current?.close();
          peerRef.current = null;
          localStreamRef.current?.getTracks().forEach((track) => track.stop());
          localStreamRef.current = null;
          if (remoteAudio.current) remoteAudio.current.srcObject = null;
          setStatus('idle');
          setError('The other person declined the call.');
        }
      })
      .subscribe((state) => {
        if (state === 'SUBSCRIBED') setChannelReady(true);
        if (state === 'CHANNEL_ERROR' || state === 'TIMED_OUT' || state === 'CLOSED') {
          setChannelReady(false);
          setError('Could not connect to call service. Check the Supabase calling setup.');
        }
      });

    return () => {
      if (callIdRef.current) {
        void channel.send({
          type: 'broadcast',
          event: 'call-hangup',
          payload: { callId: callIdRef.current }
        });
      }
      channelRef.current = null;
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      if (audioElement) audioElement.srcObject = null;
      void client.removeChannel(channel);
    };
  }, [requestId, offerId, showToast]);

  const startCall = async () => {
    if (!supabase || !channelRef.current) {
      setError('In-app calling requires a configured Supabase project.');
      return;
    }
    setError('');
    const callId = crypto.randomUUID();
    callIdRef.current = callId;
    setStatus('connecting');
    try {
      const peer = await (async () => {
        const { data, error: turnError } = await supabase.functions.invoke('turn-credentials', {
          body: { requestId, offerId }
        });
        if (turnError) throw new Error('Calling is not configured yet. Please try again later.');
        if (!data?.iceServers?.length) throw new Error('Call connection settings are unavailable.');
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        localStreamRef.current = stream;
        const connection = new RTCPeerConnection({ iceServers: data.iceServers });
        peerRef.current = connection;
        stream.getTracks().forEach((track) => connection.addTrack(track, stream));
        connection.ontrack = (event) => {
          if (remoteAudio.current) remoteAudio.current.srcObject = event.streams[0];
        };
        connection.onicecandidate = (event) => {
          if (!event.candidate) return;
          void channelRef.current?.send({
            type: 'broadcast',
            event: 'ice-candidate',
            payload: { callId, candidate: event.candidate.toJSON() }
          }).then((result) => {
            if (result !== 'ok') setError('Could not send call connection data.');
          }).catch(() => setError('Could not send call connection data.'));
        };
        connection.onconnectionstatechange = () => {
          if (connection.connectionState === 'connected') setStatus('active');
          if (connection.connectionState === 'failed') setError('Could not connect the call. Check your network and try again.');
        };
        return connection;
      })();
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      const result = await channelRef.current.send({
        type: 'broadcast',
        event: 'call-offer',
        payload: { callId, description: peer.localDescription }
      });
      if (result !== 'ok') throw new Error('Could not start the call.');
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not start the call.');
      peerRef.current?.close();
      peerRef.current = null;
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      callIdRef.current = null;
      setStatus('idle');
    }
  };

  const answerCall = async () => {
    if (!supabase || !callIdRef.current || !incomingOfferRef.current) return;
    setError('');
    setStatus('connecting');
    try {
      const { data, error: turnError } = await supabase.functions.invoke('turn-credentials', {
        body: { requestId, offerId }
      });
      if (turnError) throw new Error('Calling is not configured yet. Please try again later.');
      if (!data?.iceServers?.length) throw new Error('Call connection settings are unavailable.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      const peer = new RTCPeerConnection({ iceServers: data.iceServers });
      peerRef.current = peer;
      stream.getTracks().forEach((track) => peer.addTrack(track, stream));
      peer.ontrack = (event) => {
        if (remoteAudio.current) remoteAudio.current.srcObject = event.streams[0];
      };
      const callId = callIdRef.current;
      peer.onicecandidate = (event) => {
        if (!event.candidate) return;
        void channelRef.current?.send({
          type: 'broadcast',
          event: 'ice-candidate',
          payload: { callId, candidate: event.candidate.toJSON() }
        }).then((result) => {
          if (result !== 'ok') setError('Could not send call connection data.');
        }).catch(() => setError('Could not send call connection data.'));
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
      const result = await channelRef.current?.send({
        type: 'broadcast',
        event: 'call-answer',
        payload: { callId, description: peer.localDescription }
      });
      if (result !== 'ok') throw new Error('Could not answer the call.');
    } catch (callError) {
      setError(callError instanceof Error ? callError.message : 'Could not answer the call.');
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
      await channelRef.current?.send({
        type: 'broadcast',
        event: decline ? 'call-decline' : 'call-hangup',
        payload: { callId }
      });
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
