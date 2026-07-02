import { create } from "zustand";
import toast from "react-hot-toast";
import type { Socket } from "socket.io-client";
import { useAuthStore } from "./useAuthStore";
import { SOCKET_EVENTS } from "../constants";

// The other participant in a call. Comes either fully populated (from the
// caller's payload) or as just an id when we only know who's ringing.
export interface CallPeer {
  _id: string;
  fullName?: string;
  profilePic?: string;
}

export type CallStatus = "idle" | "calling" | "ringing" | "in-call";

interface CallStore {
  callStatus: CallStatus;
  peerUser: CallPeer | null;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  peerConnection: RTCPeerConnection | null;
  incomingOffer: RTCSessionDescriptionInit | null;
  isMuted: boolean;
  isCameraOff: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  listenersBound: boolean;
  createPeerConnection: (targetUserId: string) => RTCPeerConnection;
  startCall: (user: CallPeer) => Promise<void>;
  acceptCall: () => Promise<void>;
  rejectCall: () => void;
  endCall: () => void;
  toggleMute: () => void;
  toggleCamera: () => void;
  cleanup: () => void;
  bindCallListeners: (socket: Socket) => void;
}

// STUN servers help the two browsers discover their public network addresses so
// they can connect directly (peer-to-peer). These free Google STUN servers are
// enough for most networks. NOTE: users behind strict NATs/firewalls would also
// need a TURN (relay) server, which costs money to host — left as a next step.
const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

const MEDIA_CONSTRAINTS: MediaStreamConstraints = { video: true, audio: true };

// How long to ring before giving up on an unanswered outgoing call.
const RING_TIMEOUT_MS = 30000;
let ringTimeout: ReturnType<typeof setTimeout> | null = null;

const clearRingTimeout = () => {
  if (ringTimeout) {
    clearTimeout(ringTimeout);
    ringTimeout = null;
  }
};

export const useCallStore = create<CallStore>((set, get) => ({
  callStatus: "idle",
  peerUser: null,
  localStream: null,
  remoteStream: null,
  peerConnection: null,
  incomingOffer: null,
  isMuted: false,
  isCameraOff: false,
  pendingCandidates: [], // ICE candidates that arrived before remote desc was set
  listenersBound: false,

  /**
   * Build an RTCPeerConnection: wire up ICE-candidate relaying, the remote
   * stream handler, and attach our local audio/video tracks.
   */
  createPeerConnection: (targetUserId) => {
    const socket = useAuthStore.getState().socket;
    const pc = new RTCPeerConnection(ICE_SERVERS);

    // As the browser discovers network routes, send each to the other peer.
    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit(SOCKET_EVENTS.CALL_ICE, {
          toUserId: targetUserId,
          candidate: event.candidate,
        });
      }
    };

    // Fired when the remote peer's media arrives — show it.
    pc.ontrack = (event) => {
      set({ remoteStream: event.streams[0] });
    };

    pc.onconnectionstatechange = () => {
      if (["failed", "closed"].includes(pc.connectionState)) {
        get().cleanup();
      }
    };

    // Add our own camera/mic tracks so the peer can see/hear us.
    const localStream = get().localStream;
    if (localStream) {
      localStream.getTracks().forEach((track) => pc.addTrack(track, localStream));
    }

    set({ peerConnection: pc });
    return pc;
  },

  /**
   * Start a call to another user: grab camera/mic, create an offer, and send it.
   */
  startCall: async (user) => {
    const socket = useAuthStore.getState().socket;
    if (!socket) {
      toast.error("Not connected");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      set({ localStream: stream, peerUser: user, callStatus: "calling", pendingCandidates: [] });

      const pc = get().createPeerConnection(user._id);
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const me = useAuthStore.getState().authUser;
      if (!me) return;
      socket.emit(SOCKET_EVENTS.CALL_OFFER, {
        toUserId: user._id,
        offer,
        caller: { _id: me._id, fullName: me.fullName, profilePic: me.profilePic },
      });

      // Give up if there's no answer within the timeout.
      clearRingTimeout();
      ringTimeout = setTimeout(() => {
        if (get().callStatus === "calling") {
          toast.error("No answer");
          get().endCall();
        }
      }, RING_TIMEOUT_MS);
    } catch {
      toast.error("Could not access camera/microphone");
      get().cleanup();
    }
  },

  /**
   * Accept an incoming call: grab media, apply the stored offer, answer it.
   */
  acceptCall: async () => {
    const socket = useAuthStore.getState().socket;
    const { incomingOffer, peerUser } = get();
    if (!incomingOffer || !peerUser || !socket) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS);
      set({ localStream: stream, callStatus: "in-call", pendingCandidates: [] });

      const pc = get().createPeerConnection(peerUser._id);
      await pc.setRemoteDescription(new RTCSessionDescription(incomingOffer));

      // Apply any ICE candidates that arrived before the remote description.
      for (const candidate of get().pendingCandidates) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit(SOCKET_EVENTS.CALL_ANSWER, { toUserId: peerUser._id, answer });

      set({ incomingOffer: null, pendingCandidates: [] });
    } catch {
      toast.error("Could not access camera/microphone");
      get().rejectCall();
    }
  },

  /** Decline an incoming call and tell the caller. */
  rejectCall: () => {
    const socket = useAuthStore.getState().socket;
    const { peerUser } = get();
    if (socket && peerUser) {
      socket.emit(SOCKET_EVENTS.CALL_REJECT, { toUserId: peerUser._id });
    }
    get().cleanup();
  },

  /** Hang up an active or outgoing call and tell the other side. */
  endCall: () => {
    const socket = useAuthStore.getState().socket;
    const { peerUser } = get();
    if (socket && peerUser) {
      socket.emit(SOCKET_EVENTS.CALL_END, { toUserId: peerUser._id });
    }
    get().cleanup();
  },

  /** Toggle our microphone on/off (the track stays, we just disable it). */
  toggleMute: () => {
    const { localStream, isMuted } = get();
    localStream?.getAudioTracks().forEach((track) => {
      track.enabled = isMuted; // currently muted -> enable, and vice versa
    });
    set({ isMuted: !isMuted });
  },

  /** Toggle our camera on/off. */
  toggleCamera: () => {
    const { localStream, isCameraOff } = get();
    localStream?.getVideoTracks().forEach((track) => {
      track.enabled = isCameraOff;
    });
    set({ isCameraOff: !isCameraOff });
  },

  /** Stop all media tracks, close the connection, and reset call state. */
  cleanup: () => {
    clearRingTimeout();
    const { localStream, peerConnection } = get();
    localStream?.getTracks().forEach((track) => track.stop());
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.ontrack = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
    }
    set({
      callStatus: "idle",
      peerUser: null,
      localStream: null,
      remoteStream: null,
      peerConnection: null,
      incomingOffer: null,
      isMuted: false,
      isCameraOff: false,
      pendingCandidates: [],
    });
  },

  /**
   * Register the socket listeners for all signaling events. Called once the
   * socket is available; guarded so we don't bind twice.
   */
  bindCallListeners: (socket) => {
    if (!socket || get().listenersBound) return;
    set({ listenersBound: true });

    // Someone is calling us.
    socket.on(
      SOCKET_EVENTS.CALL_OFFER,
      ({
        from,
        offer,
        caller,
      }: {
        from: string;
        offer: RTCSessionDescriptionInit;
        caller?: CallPeer;
      }) => {
        // If we're already busy, auto-decline.
        if (get().callStatus !== "idle") {
          socket.emit(SOCKET_EVENTS.CALL_END, { toUserId: from });
          return;
        }
        set({
          callStatus: "ringing",
          peerUser: caller || { _id: from },
          incomingOffer: offer,
        });
      }
    );

    // Our call was answered — apply the answer and connect.
    socket.on(
      SOCKET_EVENTS.CALL_ANSWER,
      async ({ answer }: { answer: RTCSessionDescriptionInit }) => {
        const pc = get().peerConnection;
        if (!pc) return;
        clearRingTimeout(); // they answered — stop the no-answer timer
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        for (const candidate of get().pendingCandidates) {
          await pc.addIceCandidate(new RTCIceCandidate(candidate));
        }
        set({ pendingCandidates: [], callStatus: "in-call" });
      }
    );

    // A network route from the other peer.
    socket.on(
      SOCKET_EVENTS.CALL_ICE,
      async ({ candidate }: { candidate: RTCIceCandidateInit }) => {
        const pc = get().peerConnection;
        if (pc && pc.remoteDescription && pc.remoteDescription.type) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch {
            // ignore malformed/late candidates
          }
        } else {
          // Remote description not set yet — queue it.
          set({ pendingCandidates: [...get().pendingCandidates, candidate] });
        }
      }
    );

    socket.on(SOCKET_EVENTS.CALL_REJECT, () => {
      toast("Call declined");
      get().cleanup();
    });

    socket.on(SOCKET_EVENTS.CALL_END, () => {
      get().cleanup();
    });

    socket.on(SOCKET_EVENTS.CALL_UNAVAILABLE, () => {
      toast.error("User is unavailable");
      get().cleanup();
    });
  },
}));
