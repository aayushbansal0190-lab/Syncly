import { useEffect, useRef } from "react";
import { useCallStore } from "../store/useCallStore";
import { useAuthStore } from "../store/useAuthStore";
import { Phone, PhoneOff, Mic, MicOff, Video, VideoOff } from "lucide-react";

// Renders all call UI as a full-screen overlay, driven by the call store's
// state machine. Always mounted (near the app root) so an incoming call can pop
// up regardless of which page the user is on.
const VideoCall = () => {
  const {
    callStatus,
    peerUser,
    localStream,
    remoteStream,
    isMuted,
    isCameraOff,
    acceptCall,
    rejectCall,
    endCall,
    toggleMute,
    toggleCamera,
    bindCallListeners,
  } = useCallStore();
  const { socket } = useAuthStore();

  const localVideoRef = useRef<HTMLVideoElement>(null);
  const remoteVideoRef = useRef<HTMLVideoElement>(null);

  // Bind signaling listeners once the socket is connected.
  useEffect(() => {
    if (socket) bindCallListeners(socket);
  }, [socket, bindCallListeners]);

  // Attach the media streams to their <video> elements whenever they change.
  useEffect(() => {
    if (localVideoRef.current && localStream) {
      localVideoRef.current.srcObject = localStream;
    }
  }, [localStream]);

  useEffect(() => {
    if (remoteVideoRef.current && remoteStream) {
      remoteVideoRef.current.srcObject = remoteStream;
    }
  }, [remoteStream]);

  if (callStatus === "idle") return null;

  // Incoming call: simple accept/reject dialog.
  if (callStatus === "ringing") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
        <div className="bg-base-100 rounded-2xl p-6 w-80 text-center shadow-xl">
          <div className="avatar">
            <div className="size-20 rounded-full mx-auto">
              <img src={peerUser?.profilePic || "/avatar.png"} alt={peerUser?.fullName} />
            </div>
          </div>
          <h3 className="mt-4 text-lg font-semibold">{peerUser?.fullName || "Someone"}</h3>
          <p className="text-sm text-base-content/70">Incoming video call…</p>
          <div className="mt-6 flex justify-center gap-6">
            <button
              onClick={rejectCall}
              className="btn btn-circle btn-error text-white"
              title="Decline"
            >
              <PhoneOff />
            </button>
            <button
              onClick={acceptCall}
              className="btn btn-circle btn-success text-white"
              title="Accept"
            >
              <Phone />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Outgoing ("calling") or connected ("in-call") share the same layout.
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black">
      <div className="relative flex-1 overflow-hidden">
        {/* Remote video fills the screen once connected. */}
        <video
          ref={remoteVideoRef}
          autoPlay
          playsInline
          className="w-full h-full object-cover bg-zinc-900"
        />

        {callStatus === "calling" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-white">
            <div className="avatar">
              <div className="size-24 rounded-full">
                <img src={peerUser?.profilePic || "/avatar.png"} alt={peerUser?.fullName} />
              </div>
            </div>
            <h3 className="mt-4 text-xl font-semibold">{peerUser?.fullName}</h3>
            <p className="text-white/70">Calling…</p>
          </div>
        )}

        {/* Our own camera, small, in the corner. Muted to avoid echo. */}
        <video
          ref={localVideoRef}
          autoPlay
          playsInline
          muted
          className="absolute bottom-4 right-4 w-32 sm:w-44 rounded-lg border border-white/20 object-cover"
        />
      </div>

      {/* Call controls */}
      <div className="flex items-center justify-center gap-6 py-6 bg-black">
        <button
          onClick={toggleMute}
          className={`btn btn-circle ${isMuted ? "btn-error text-white" : "btn-neutral"}`}
          title={isMuted ? "Unmute" : "Mute"}
        >
          {isMuted ? <MicOff /> : <Mic />}
        </button>
        <button
          onClick={endCall}
          className="btn btn-circle btn-error text-white"
          title="End call"
        >
          <PhoneOff />
        </button>
        <button
          onClick={toggleCamera}
          className={`btn btn-circle ${isCameraOff ? "btn-error text-white" : "btn-neutral"}`}
          title={isCameraOff ? "Turn camera on" : "Turn camera off"}
        >
          {isCameraOff ? <VideoOff /> : <Video />}
        </button>
      </div>
    </div>
  );
};
export default VideoCall;
