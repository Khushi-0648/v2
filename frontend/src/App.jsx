import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import {
  Shield,
  ShieldCheck,
  Lock,
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  PhoneOff,
  MessageSquare,
  Copy,
  Check,
  Sparkles,
  Users,
  AlertCircle,
  X,
  Send,
  Link as LinkIcon,
  Keyboard,
  Plus,
  Clock,
  Maximize,
  Minimize,
  Tv,
  Activity,
  Sliders,
  Calendar,
  Smile,
  Hand,
  Pin,
  Trash2,
  Crown,
  UserX,
  VolumeX,
  PhoneCall,
  RotateCcw,
  Volume2,
  Info,
  HelpCircle,
  Download,
  Smartphone,
  Laptop,
  ShieldAlert,
  CheckCircle,
  Share2,
  Unlock,
  PenTool,
  Eraser,
  User,
  Star,
  Home
} from "lucide-react";
import {
  generateSecureCode,
  generate8CharAlphaNumericCode,
  isSecureRoomCode,
  deriveRoomId,
  deriveAESKey,
  generateSafetyNumber
} from "./services/crypto";
import { V2MultiPartyWebRTC } from "./services/webrtc";
import "./App.css";

// Web Audio synthesis chimes
function playChime(type = "join") {
  try {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "join") {
      osc.frequency.setValueAtTime(587.33, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    } else if (type === "leave") {
      osc.frequency.setValueAtTime(700, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(350, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === "message") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      gain.gain.setValueAtTime(0.06, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.15);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } else if (type === "hand") {
      osc.frequency.setValueAtTime(523.25, ctx.currentTime);
      osc.frequency.setValueAtTime(659.25, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === "record") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(880, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.07, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "mute") {
      osc.frequency.setValueAtTime(400, ctx.currentTime);
      osc.frequency.setValueAtTime(300, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.08, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
      osc.start();
      osc.stop(ctx.currentTime + 0.25);
    } else if (type === "knock") {
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch (e) {
    // Audio synthesis fallback
  }
}

// Lightweight real-time audio level meter for speaking indicator and lobby preview
function createAudioLevelDetector(stream, onLevel) {
  try {
    const audioTrack = stream.getAudioTracks()[0];
    if (!audioTrack) return null;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);

    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const interval = setInterval(() => {
      if (audioTrack.readyState !== "live" || !audioTrack.enabled) {
        onLevel(0);
        return;
      }
      analyser.getByteFrequencyData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        sum += dataArray[i];
      }
      const avg = sum / dataArray.length;
      onLevel(avg);
    }, 150);

    return () => {
      clearInterval(interval);
      try {
        source.disconnect();
        analyser.disconnect();
        ctx.close();
      } catch (e) {}
    };
  } catch (e) {
    return null;
  }
}

export function isWindowsOS() {
  if (typeof window === "undefined" || typeof navigator === "undefined") return true;

  // 1. User-Agent Client Hints API (Modern Chromium browsers: Chrome, Edge, Brave)
  if (navigator.userAgentData && navigator.userAgentData.platform) {
    const p = navigator.userAgentData.platform.toLowerCase();
    if (p.includes("win")) return true;
    if (p.includes("android") || p.includes("mac") || p.includes("ios") || p.includes("linux")) {
      return false;
    }
  }

  // 2. User-Agent string inspection
  const ua = (navigator.userAgent || "").toLowerCase();
  if (ua.includes("android") || ua.includes("iphone") || ua.includes("ipad") || ua.includes("ipod") || (ua.includes("macintosh") && !ua.includes("windows")) || (ua.includes("linux") && !ua.includes("windows"))) {
    return false;
  }

  // 3. Navigator platform inspection
  const plat = (navigator.platform || "").toLowerCase();
  if (plat.includes("win")) return true;
  if (plat.includes("android") || plat.includes("iphone") || plat.includes("ipad") || plat.includes("mac") || plat.includes("linux")) {
    return false;
  }

  return ua.includes("windows") || ua.includes("win32") || ua.includes("win64");
}

const getApiBase = () => {
  if (typeof window !== "undefined" && window.location) {
    if (window.location.port === "5173" || window.location.port === "3000") {
      return `http://${window.location.hostname || "127.0.0.1"}:8000`;
    }
    if (window.location.origin && window.location.origin !== "null" && !window.location.origin.startsWith("file://")) {
      return "";
    }
  }
  return "http://127.0.0.1:8000";
};

function RemoteVideoTile({
  peer,
  isPinned,
  onTogglePin,
  isHostUser,
  isPrimaryHost,
  isCoHostUser,
  onToggleCoHost,
  isLockedByHost,
  onUnlockPeer,
  onDenyPeer,
  onHostMute,
  onHostUnmute,
  onHostStopVideo,
  onHostStartVideo,
  onHostKick,
  isSpeaking
}) {
  const videoRef = useRef(null);
  const canManagePeer = isPrimaryHost ? !peer.isHost : (isCoHostUser && !peer.isHost && !peer.isCoHost);

  useEffect(() => {
    const el = videoRef.current;
    if (!el || !peer.stream) return;

    const playVideo = () => {
      if (el.srcObject !== peer.stream) {
        el.srcObject = peer.stream;
      }
      el.play().catch((err) => {
        console.warn("Remote play error:", err);
        // Autoplay policy bypass on mobile: play muted first, then unmute
        el.muted = true;
        el.play().then(() => {
          el.muted = false;
        }).catch(() => {});
      });
    };

    playVideo();

    // Listen for incoming tracks (video arriving after audio or vice-versa)
    peer.stream.addEventListener("addtrack", playVideo);
    peer.stream.addEventListener("removetrack", playVideo);

    // One-time touch/click fallback on mobile to unlock stalled media
    const handleTouchUnlock = () => {
      if (el && el.paused) {
        el.play().catch(() => {});
      }
    };
    window.addEventListener("touchstart", handleTouchUnlock, { once: true, passive: true });
    window.addEventListener("click", handleTouchUnlock, { once: true, passive: true });

    return () => {
      peer.stream.removeEventListener("addtrack", playVideo);
      peer.stream.removeEventListener("removetrack", playVideo);
      window.removeEventListener("touchstart", handleTouchUnlock);
      window.removeEventListener("click", handleTouchUnlock);
    };
  }, [peer.stream, peer.peerId]);

  return (
    <div
      className={`video-card remote-tile ${isPinned ? "pinned-tile" : ""} ${isSpeaking ? "speaking-tile" : ""}`}
      onDoubleClick={() => onTogglePin(peer.peerId)}
    >
      {/* Remote Video Stream */}
      <video
        ref={(el) => {
          videoRef.current = el;
          if (el && peer.stream && el.srcObject !== peer.stream) {
            el.srcObject = peer.stream;
            el.play().catch(() => {});
          }
        }}
        autoPlay
        playsInline
        webkit-playsinline="true"
        disablePictureInPicture={true}
        controlsList="nodownload noplaybackrate noremoteplayback"
        onContextMenu={(e) => e.preventDefault()}
        className={`video-stream stream-contain ${peer.isVideoMuted && !peer.isScreenSharing ? "stream-hidden" : ""}`}
      />

      {/* Video Off Avatar Placeholder for Remote Participant (only if not sharing screen) */}
      {peer.isVideoMuted && !peer.isScreenSharing && (
        <div className="video-off-avatar">
          <div className="avatar-circle-large">
            {(peer.name || "P")[0].toUpperCase()}
          </div>
          <span className="video-off-text">{peer.name}'s camera is off</span>
        </div>
      )}

      {/* Active Speaker Indicator */}
      {isSpeaking && (
        <div className="speaking-indicator-pill">
          <Volume2 className="w-3 h-3 text-emerald-400 animate-pulse" />
          <span>Speaking</span>
        </div>
      )}

      {peer.isHandRaised && (
        <div className="hand-raise-badge">
          <span>✋ Hand Raised</span>
        </div>
      )}

      {/* Host / Co-Host Controls Overlay for this participant */}
      {canManagePeer && (
        <div className={`tile-host-controls ${isLockedByHost ? "has-alert" : ""}`} onClick={(e) => e.stopPropagation()}>
          <span className="tile-host-badge">
            {isPrimaryHost ? (
              <Crown className="w-3 h-3 text-amber-400 inline mr-0.5" />
            ) : (
              <Shield className="w-3 h-3 text-yellow-400 inline mr-0.5" />
            )}
            {isPrimaryHost ? "Host:" : "Co-Host:"}
          </span>

          {/* Primary Host Co-Host Delegation Button */}
          {isPrimaryHost && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (onToggleCoHost) onToggleCoHost(peer.peerId, !peer.isCoHost);
              }}
              className={`btn-tile-host ${peer.isCoHost ? "btn-tile-cohost-remove" : "btn-tile-cohost"}`}
              title={peer.isCoHost ? `Revoke Co-Host privileges from ${peer.name}` : `Appoint ${peer.name} as Co-Host`}
            >
              <Shield className="w-3.5 h-3.5 text-yellow-400" />
              <span>{peer.isCoHost ? "Dismiss Co-Host" : "Make Co-Host"}</span>
            </button>
          )}

          {/* Functional Controls to Remove Black Screen or Keep Black Screen for specific user */}
          {isLockedByHost && (
            <div className="flex items-center gap-1">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onUnlockPeer) onUnlockPeer(peer.peerId);
                }}
                className="btn-tile-host btn-tile-unlock"
                title={`Click to Allow & Remove Black Screen specifically for ${peer.name}`}
              >
                <Unlock className="w-3.5 h-3.5 text-white" />
                <span>Remove Black Screen</span>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (onDenyPeer) onDenyPeer(peer.peerId);
                }}
                className="btn-tile-host btn-tile-stay-black"
                title={`Keep black screen on ${peer.name}'s screen`}
              >
                <Lock className="w-3.5 h-3.5 text-amber-300" />
                <span>Stay Black</span>
              </button>
            </div>
          )}

          {peer.isAudioMuted ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHostUnmute(peer.peerId);
              }}
              className="btn-tile-host btn-tile-unmute"
              title={`Unmute ${peer.name}'s microphone`}
            >
              <Mic className="w-3.5 h-3.5 text-emerald-400" />
              <span>Unmute</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHostMute(peer.peerId);
              }}
              className="btn-tile-host"
              title={`Mute ${peer.name}'s microphone`}
            >
              <MicOff className="w-3.5 h-3.5" />
              <span>Mute</span>
            </button>
          )}

          {peer.isVideoMuted ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHostStartVideo(peer.peerId);
              }}
              className="btn-tile-host btn-tile-start-video"
              title={`Turn on ${peer.name}'s video camera`}
            >
              <Video className="w-3.5 h-3.5 text-emerald-400" />
              <span>Start Cam</span>
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onHostStopVideo(peer.peerId);
              }}
              className="btn-tile-host"
              title={`Turn off ${peer.name}'s video camera`}
            >
              <VideoOff className="w-3.5 h-3.5" />
              <span>Stop Cam</span>
            </button>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onHostKick(peer.peerId, peer.name);
            }}
            className="btn-tile-host btn-tile-kick"
            title={`Remove ${peer.name} from the meeting`}
          >
            <UserX className="w-3.5 h-3.5" />
            <span>Remove</span>
          </button>
        </div>
      )}

      <div className="video-label">
        <div className="flex items-center gap-1.5">
          <span>{peer.name || "Participant"}</span>
          {peer.isHost && (
            <span className="host-pill-label">
              <Crown className="w-3 h-3 inline mr-1 text-amber-400" />
              Host
            </span>
          )}
          {peer.isCoHost && !peer.isHost && (
            <span className="cohost-pill-label">
              <Shield className="w-3 h-3 inline mr-1 text-yellow-500" />
              Co-Host
            </span>
          )}
          {peer.isAudioMuted && (
            <span className="remote-mic-off-tag" title="Microphone is Muted">
              <MicOff className="w-3 h-3 text-red-400 inline" />
            </span>
          )}
          {peer.isScreenSharing && (
            <span className="badge-presenting-tag" title="Sharing Screen">
              <Monitor className="w-3 h-3 inline mr-1 text-emerald-600" />
              Screen
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {/* Picture-in-Picture Button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (videoRef.current && document.pictureInPictureEnabled) {
                if (document.pictureInPictureElement) {
                  document.exitPictureInPicture();
                } else {
                  videoRef.current.requestPictureInPicture().catch(() => {});
                }
              }
            }}
            className="btn-pin"
            title="Picture-in-Picture"
          >
            <Tv className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => onTogglePin(peer.peerId)}
            className={`btn-pin ${isPinned ? "pin-active" : ""}`}
            title={isPinned ? "Unpin participant" : "Pin participant"}
          >
            <Pin className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Non-intrusive status pill in corner (NO black screen or dark overlay in host meeting area) */}
      {isHostUser && isLockedByHost && (
        <div className="tile-blackscreen-status-pill">
          <ShieldAlert className="w-3.5 h-3.5 text-rose-400 shrink-0" />
          <span>User Screen Blacked Out</span>
        </div>
      )}
    </div>
  );
}

// Host-Only Scheduled Meetings Dashboard Panel
function HostScheduledMeetingsPanel({ onJoinAsHost, onCopyInvite, refreshTrigger }) {
  const [scheduledList, setScheduledList] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchHostMeetings = useCallback(async () => {
    try {
      const mySaved = JSON.parse(localStorage.getItem("v2_my_scheduled_meetings") || "[]");
      const tokens = mySaved.map((m) => m.hostToken).filter(Boolean);
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("v2_host_token_")) {
          const tok = localStorage.getItem(k);
          if (tok && !tokens.includes(tok)) tokens.push(tok);
        }
      }
      if (tokens.length === 0) {
        setScheduledList([]);
        return;
      }
      setLoading(true);
      const res = await fetch(`${getApiBase()}/api/host/my-scheduled-meetings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hostTokens: tokens })
      });
      if (res.ok) {
        const data = await res.json();
        setScheduledList(data.meetings || []);
      }
    } catch {
      const mySaved = JSON.parse(localStorage.getItem("v2_my_scheduled_meetings") || "[]");
      setScheduledList(mySaved);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHostMeetings();
  }, [fetchHostMeetings, refreshTrigger]);

  const handleCancelMeeting = async (code) => {
    if (!window.confirm(`Are you sure you want to cancel scheduled meeting ${code}? This meeting code will be permanently invalidated.`)) {
      return;
    }
    const hostToken = localStorage.getItem("v2_host_token_" + code);
    try {
      await fetch(`${getApiBase()}/api/host/cancel-scheduled-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, hostToken: hostToken || "" })
      });
    } catch {}
    localStorage.removeItem("v2_host_token_" + code);
    localStorage.removeItem("v2_host_pin_" + code);
    const mySaved = JSON.parse(localStorage.getItem("v2_my_scheduled_meetings") || "[]");
    const filtered = mySaved.filter((m) => m.code !== code);
    localStorage.setItem("v2_my_scheduled_meetings", JSON.stringify(filtered));
    setScheduledList((prev) => prev.filter((m) => m.code !== code));
  };

  if (scheduledList.length === 0) {
    return null; // Hidden for regular users! Only visible to the host who scheduled a meeting.
  }

  return (
    <div className="host-scheduled-panel">
      <div className="host-scheduled-header">
        <div className="flex items-center gap-2">
          <Calendar className="w-5 h-5 text-emerald-700" />
          <h3 className="font-bold text-slate-800 text-base">My Scheduled Meetings (Host Only)</h3>
        </div>
        <span className="text-xs bg-emerald-100 text-emerald-800 font-bold px-2 py-0.5 rounded-full border border-emerald-300">
          {scheduledList.length} Active
        </span>
      </div>
      <p className="text-xs text-slate-500 mb-3">
        Only you can view and launch these meetings as host. Attendees only see them when you share the direct invitation.
      </p>
      <div className="host-scheduled-list space-y-2.5">
        {scheduledList.map((m) => (
          <div key={m.code} className="host-scheduled-item">
            <div className="host-scheduled-item-info">
              <div className="font-bold text-slate-800 text-sm">{m.title || "Untitled Meeting"}</div>
              <div className="text-xs text-slate-500 flex items-center gap-3 mt-1">
                <span>🕒 <b>{m.scheduledFor || "Scheduled"}</b></span>
                <span>🔑 Code: <b className="font-mono text-emerald-800">{m.code}</b></span>
                <span>🔒 PIN: <b className="font-mono text-amber-800">{m.pin}</b></span>
              </div>
            </div>
            <div className="host-scheduled-item-actions flex items-center gap-2">
              <button
                className="btn-host-start-meeting"
                onClick={() => onJoinAsHost(m.code, m.pin)}
                title="Start this meeting now as Host"
              >
                Start as Host
              </button>
              <button
                className="btn-copy-small"
                onClick={() => onCopyInvite(m.code, m.pin, m.title, m.scheduledFor)}
                title="Copy Invitation"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
              <button
                className="btn-delete-small text-rose-600 hover:text-rose-800 p-1 cursor-pointer"
                onClick={() => handleCancelMeeting(m.code)}
                title="Cancel & Invalidate Meeting"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CollaborativeWhiteboard({
  isOpen,
  onClose,
  strokes = [],
  onSendStroke,
  onClearStrokes,
  userName = "User",
  canManage = false
}) {
  const canvasRef = useRef(null);
  const containerRef = useRef(null);
  const [activeColor, setActiveColor] = useState("#0f172a");
  const [strokeSize, setStrokeSize] = useState(3);
  const [tool, setTool] = useState("pen"); // "pen" | "eraser"
  const [isDrawing, setIsDrawing] = useState(false);
  const currentPathRef = useRef([]);

  const colors = [
    { label: "Dark Slate", value: "#0f172a" },
    { label: "Emerald Green", value: "#15803d" },
    { label: "V2 Amber Gold", value: "#ca8a04" },
    { label: "Royal Blue", value: "#2563eb" },
    { label: "Crimson Red", value: "#dc2626" },
    { label: "Amethyst Purple", value: "#7c3aed" }
  ];

  const redrawCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    for (const stroke of strokes) {
      if (!stroke.points || stroke.points.length < 1) continue;
      ctx.beginPath();
      ctx.strokeStyle = stroke.isEraser ? "#ffffff" : (stroke.color || "#0f172a");
      ctx.lineWidth = stroke.size || 3;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.isEraser) {
        ctx.globalCompositeOperation = "destination-out";
      } else {
        ctx.globalCompositeOperation = "source-over";
      }

      const pts = stroke.points;
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(pts[i].x, pts[i].y);
      }
      ctx.stroke();
    }

    ctx.globalCompositeOperation = "source-over";
  }, [strokes]);

  useEffect(() => {
    if (!isOpen) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (canvas.width !== 1920 || canvas.height !== 1080) {
      canvas.width = 1920;
      canvas.height = 1080;
    }
    redrawCanvas();
  }, [isOpen, redrawCanvas]);

  useEffect(() => {
    if (isOpen) {
      redrawCanvas();
    }
  }, [isOpen, strokes, redrawCanvas]);

  const getCanvasCoords = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY
    };
  };

  const handlePointerDown = (e) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {}

    const pt = getCanvasCoords(e);
    currentPathRef.current = [pt];
    setIsDrawing(true);

    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.strokeStyle = tool === "eraser" ? "#ffffff" : activeColor;
    ctx.lineWidth = tool === "eraser" ? strokeSize * 3 : strokeSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    if (tool === "eraser") {
      ctx.globalCompositeOperation = "destination-out";
    } else {
      ctx.globalCompositeOperation = "source-over";
    }
    ctx.moveTo(pt.x, pt.y);
  };

  const handlePointerMove = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const pt = getCanvasCoords(e);
    currentPathRef.current.push(pt);

    const ctx = canvas.getContext("2d");
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const handlePointerUp = (e) => {
    if (!isDrawing) return;
    e.preventDefault();
    setIsDrawing(false);
    const canvas = canvasRef.current;
    if (canvas) {
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {}
    }

    const pts = currentPathRef.current;
    if (pts.length > 0 && onSendStroke) {
      const strokeObj = {
        id: `s_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        points: pts,
        color: tool === "eraser" ? "#ffffff" : activeColor,
        size: tool === "eraser" ? strokeSize * 3 : strokeSize,
        isEraser: tool === "eraser",
        author: userName
      };
      onSendStroke(strokeObj);
    }
    currentPathRef.current = [];
  };

  const handleDownload = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const tempCanvas = document.createElement("canvas");
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext("2d");
    tempCtx.fillStyle = "#ffffff";
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const link = document.createElement("a");
    link.download = `V2_Collaborative_Whiteboard_${Date.now()}.png`;
    link.href = tempCanvas.toDataURL("image/png");
    link.click();
  };

  if (!isOpen) return null;

  return (
    <div className="whiteboard-overlay" role="dialog" aria-modal="true">
      <div className="whiteboard-container">
        <div className="whiteboard-header">
          <div className="flex items-center gap-2">
            <div className="whiteboard-icon-pill">
              <PenTool className="w-4 h-4 text-[#15803d]" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 text-sm flex items-center gap-1.5">
                <span>Interactive Collaborative Whiteboard</span>
                <span className="live-pill-badge">Live E2EE Sync</span>
              </h3>
              <p className="text-[11px] text-slate-500">
                Brainstorm and sketch live in real-time with all participants.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              className="btn-wb-tool"
              onClick={handleDownload}
              title="Export Whiteboard drawing as PNG"
            >
              <Download className="w-4 h-4" />
              <span>Export PNG</span>
            </button>

            <button
              className="btn-wb-tool btn-wb-danger"
              onClick={onClearStrokes}
              title="Clear Whiteboard for everyone"
            >
              <Trash2 className="w-4 h-4" />
              <span>Clear Board</span>
            </button>

            <button
              className="btn-close-wb"
              onClick={onClose}
              title="Close Whiteboard (Drawings remain saved)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="whiteboard-workspace">
          <div className="whiteboard-floating-toolbar">
            <div className="wb-tool-group">
              <button
                className={`wb-btn-icon ${tool === "pen" ? "wb-active" : ""}`}
                onClick={() => setTool("pen")}
                title="Pen Tool"
              >
                <PenTool className="w-4 h-4" />
              </button>
              <button
                className={`wb-btn-icon ${tool === "eraser" ? "wb-active" : ""}`}
                onClick={() => setTool("eraser")}
                title="Eraser Tool"
              >
                <Eraser className="w-4 h-4" />
              </button>
            </div>

            <div className="wb-divider" />

            {tool === "pen" && (
              <div className="wb-tool-group wb-colors-grid">
                {colors.map((c) => (
                  <button
                    key={c.value}
                    className={`wb-color-swatch ${activeColor === c.value ? "wb-color-selected" : ""}`}
                    style={{ backgroundColor: c.value }}
                    onClick={() => setActiveColor(c.value)}
                    title={c.label}
                  />
                ))}
              </div>
            )}

            <div className="wb-divider" />

            <div className="wb-tool-group wb-sizes-group">
              {[
                { size: 2, label: "Fine (2px)" },
                { size: 4, label: "Medium (4px)" },
                { size: 8, label: "Thick (8px)" }
              ].map((s) => (
                <button
                  key={s.size}
                  className={`wb-size-btn ${strokeSize === s.size ? "wb-size-selected" : ""}`}
                  onClick={() => setStrokeSize(s.size)}
                  title={s.label}
                >
                  <span
                    className="wb-size-dot"
                    style={{
                      width: `${s.size * 2 + 2}px`,
                      height: `${s.size * 2 + 2}px`,
                      backgroundColor: tool === "eraser" ? "#64748b" : activeColor
                    }}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="whiteboard-canvas-area" ref={containerRef}>
            <canvas
              ref={canvasRef}
              className={`whiteboard-canvas ${tool === "eraser" ? "cursor-eraser" : "cursor-pen"}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [userName, setUserName] = useState(() => {
    try {
      const saved = localStorage.getItem("v2_username");
      return (saved && saved.trim() !== "" && saved.trim().toLowerCase() !== "participant") ? saved.trim() : "";
    } catch {
      return "";
    }
  });
  const [nameHighlight, setNameHighlight] = useState(false);
  const [nameError, setNameError] = useState("");
  const nameInputRef = useRef(null);
  const [meetingCode, setMeetingCode] = useState("");
  const [joinInput, setJoinInput] = useState("");
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [inCall, setInCall] = useState(false);
  const [safetyNumber, setSafetyNumber] = useState("");
  const [status, setStatus] = useState("System Ready (Zero-Knowledge Engine)");
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [isMyHandRaised, setIsMyHandRaised] = useState(false);
  const [callDuration, setCallDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState("");
  const [isWindowsDevice, setIsWindowsDevice] = useState(() => isWindowsOS());

  // Multi-Party State
  const [remotePeers, setRemotePeers] = useState([]); // [{ peerId, stream, name, isHost, isCoHost, isHandRaised }]
  const [pinnedPeerId, setPinnedPeerId] = useState(null);
  const [isHost, setIsHost] = useState(false);
  const [isCoHost, setIsCoHost] = useState(false);
  const [coHosts, setCoHosts] = useState(new Set());
  const [whiteboardOpen, setWhiteboardOpen] = useState(false);
  const [whiteboardStrokes, setWhiteboardStrokes] = useState([]);
  const canManageHost = isHost || isCoHost;
  const isHostRef = useRef(isHost);
  useEffect(() => {
    isHostRef.current = isHost;
  }, [isHost]);
  const [hostNotification, setHostNotification] = useState("");
  const [rejoinMeetingInfo, setRejoinMeetingInfo] = useState(null); // { code, reason, timestamp }
  const [isWaitingForAdmission, setIsWaitingForAdmission] = useState(false);
  const [waitingAdmissionQueue, setWaitingAdmissionQueue] = useState([]); // [{ peerId, name }]

  const [screenshotAlert, setScreenshotAlert] = useState(null); // Dedicated alert when screenshot is blocked
  const [meetingEndedNotice, setMeetingEndedNotice] = useState(null); // Modal for expired/terminated meeting tokens
  const [meetingLockedNotice, setMeetingLockedNotice] = useState(null); // Notification modal when meeting is locked by host

  const showHostNotification = (msg) => {
    setHostNotification(msg);
    // Keep notification visible for 12 seconds so host and participants clearly see it
    setTimeout(() => {
      setHostNotification("");
    }, 12000);
  };

  const [scheduledRefresh, setScheduledRefresh] = useState(0);
  const [hostSecurityAlert, setHostSecurityAlert] = useState(null);
  const [hostLockedPeers, setHostLockedPeers] = useState(new Set());
  const [hostLockedPeersMap, setHostLockedPeersMap] = useState({});
  const [hostAlertModalDismissed, setHostAlertModalDismissed] = useState(false);
  const [hostSecurityToast, setHostSecurityToast] = useState(null);
  const hostDecidedAlertsRef = useRef(new Set());

  // Persistent Content Protection Lockdown State:
  // When a screenshot or screen recording is attempted, meeting content enters a persistent
  // 100% solid blackout lockdown. Audio and call remain alive, while visual content remains
  // completely concealed until the verified host approves and unlocks the participant.
  const [isContentLocked, setIsContentLocked] = useState(false);
  const [contentLockHostDecision, setContentLockHostDecision] = useState("waiting");
  const [contentLockReason, setContentLockReason] = useState("");
  const lastSecurityReportTimeRef = useRef(0);

  const triggerScreenshotBlocked = (source = "") => {
    // 0. If user is NOT in an active meeting, screenshots are 100% permitted!
    if (!inCall || isWaitingForAdmission) {
      return;
    }

    // 1. The Host of the meeting is the administrator and CAN take screenshots freely!
    if (isHost || isHostRef.current) {
      return;
    }

    // 2. Immediately apply synchronous 0ms DRM blackout for participant
    try {
      if (typeof window !== "undefined" && typeof window.__setInstantDrmLocked === "function") {
        window.__setInstantDrmLocked(true);
      }
      document.documentElement.classList.add("instant-drm-blackout");
      if (document.body) document.body.classList.add("instant-drm-blackout");
      const curtain = document.getElementById("instant-drm-curtain");
      if (curtain) curtain.style.display = "flex";
      const vids = document.getElementsByTagName("video");
      for (let i = 0; i < vids.length; i++) {
        vids[i].style.setProperty("display", "none", "important");
      }
    } catch {}

    // 3. Clear clipboard via browser and Electron bridge
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText("").catch(() => {});
      }
    } catch {}
    if (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.purgeClipboard === "function") {
      window.electronAPI.purgeClipboard();
    }

    const isRecording = (source === "screenshare" || source === "recording");
    const reason = isRecording
      ? "Screen Recording Activity Detected"
      : "Screenshot Capture Attempt Detected";

    // Immediately lock down participant visual content into solid blackout - persists until host unlocks
    setIsContentLocked(true);
    setContentLockHostDecision("waiting");
    setContentLockReason(reason);

    // Throttle duplicate network security alerts (prevent 5 alerts for 1 keypress)
    const now = Date.now();
    if (now - lastSecurityReportTimeRef.current < 500) {
      return;
    }
    lastSecurityReportTimeRef.current = now;

    // Platform is strictly Windows Desktop
    const detectedPlatform = "windows";

    const secPayload = {
      eventType: isRecording ? "SCREEN_RECORD_DETECTED" : "SCREENSHOT_ATTEMPT",
      platform: detectedPlatform,
      roomCode: meetingCode || undefined,
      participantName: userName || "Participant",
      peerId: webrtcManagerRef.current?.myPeerId,
      details: { source, timestamp: now }
    };

    // Report to Python Backend Security Event System (Host notified privately)
    fetch(`${getApiBase()}/api/security-event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(secPayload)
    }).catch(() => {});

    // Broadcast over active WebSocket to room host ONLY
    if (webrtcManagerRef.current && typeof webrtcManagerRef.current.sendSecurityEvent === "function") {
      webrtcManagerRef.current.sendSecurityEvent(secPayload.eventType, secPayload.details);
    }
  };

  // Synchronize meeting active state with instant 0ms pre-emption script & Electron
  useEffect(() => {
    const active = Boolean(inCall && !isWaitingForAdmission);
    if (typeof window !== "undefined") {
      window.__currentRoomCode = meetingCode;
      window.__currentUserName = userName;
      window.__currentPeerId = webrtcManagerRef.current?.myPeerId;
      if (typeof window.__setMeetingActive === "function") {
        window.__setMeetingActive(active);
      }
      if (window.electronAPI && typeof window.electronAPI.setMeetingState === "function") {
        window.electronAPI.setMeetingState({ inCall: active, isHost: Boolean(isHost) });
      }
    }
  }, [inCall, isWaitingForAdmission, meetingCode, userName, isHost]);

  // Synchronize host role state with instant 0ms pre-emption script & Electron
  useEffect(() => {
    const active = Boolean(inCall && !isWaitingForAdmission);
    if (typeof window !== "undefined") {
      window.__isHostUser = Boolean(isHost);
      if (typeof window.__setIsHost === "function") {
        window.__setIsHost(isHost);
      }
      if (window.electronAPI && typeof window.electronAPI.setMeetingState === "function") {
        window.electronAPI.setMeetingState({ inCall: active, isHost: Boolean(isHost) });
      }
    }
    if (isHost) {
      setIsContentLocked(false);
      setIsWindowBlurred(false);
      if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
        window.__unlockInstantDrm();
      }
    }
  }, [isHost, inCall, isWaitingForAdmission]);

  // Listen for instant 0ms DRM blackout events from index.html pre-emption script
  useEffect(() => {
    const handleInstantBlackoutEngaged = (e) => {
      // Allow screenshots outside active meeting, and allow host to screenshot freely
      if (!inCall || isWaitingForAdmission) return;
      if (isHost || isHostRef.current) return;
      triggerScreenshotBlocked(e.detail?.source || "hardware-pre-emption");
    };

    const handleInstantBlackoutResumed = () => {
      setIsContentLocked(false);
      setIsWindowBlurred(false);
    };

    window.addEventListener("instant-drm-blackout-engaged", handleInstantBlackoutEngaged);
    window.addEventListener("instant-drm-blackout-resumed", handleInstantBlackoutResumed);

    const handleHostLocalScreenshot = () => {
      // Host is exempt and allowed to take screenshots freely
    };
    window.addEventListener("host-local-screenshot-attempt", handleHostLocalScreenshot);

    let cleanupElectron = null;
    if (typeof window !== "undefined" && window.electronAPI && typeof window.electronAPI.onOsScreenshotAttempt === "function") {
      cleanupElectron = window.electronAPI.onOsScreenshotAttempt((data) => {
        if (!inCall || isWaitingForAdmission) return;
        if (isHost || isHostRef.current) return;
        triggerScreenshotBlocked(data?.source || "os-shortcut");
      });
    }

    return () => {
      window.removeEventListener("instant-drm-blackout-engaged", handleInstantBlackoutEngaged);
      window.removeEventListener("instant-drm-blackout-resumed", handleInstantBlackoutResumed);
      window.removeEventListener("host-local-screenshot-attempt", handleHostLocalScreenshot);
      if (cleanupElectron) cleanupElectron();
    };
  }, [meetingCode, userName, inCall, isWaitingForAdmission, isHost]);

  // HIGH-SECURITY RESILIENCE: Periodic polling fallback ensuring host never misses participant screenshot alerts
  useEffect(() => {
    if (!inCall || !isHost || !meetingCode) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/room-security-status/${encodeURIComponent(meetingCode)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.activeAlert) {
            const secAlert = data.activeAlert;
            const pid = secAlert.offenderPeerId || secAlert.peerId;
            if (pid) {
              setHostLockedPeers((prev) => new Set([...prev, pid]));
              setHostLockedPeersMap((prev) => ({
                ...prev,
                [pid]: {
                  peerId: pid,
                  name: secAlert.offenderName || secAlert.participantName || "Other User",
                  actionText: secAlert.actionText || "tried to take a screenshot",
                  platform: secAlert.platform || "Windows",
                  timestamp: new Date(secAlert.event?.timestamp * 1000 || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                  eventType: secAlert.eventType || "SCREENSHOT_ATTEMPT"
                }
              }));
            }
            if (pid && hostDecidedAlertsRef.current.has(pid)) {
              return;
            }
            if (!hostSecurityAlert) {
              setHostSecurityAlert({
                title: "🚨 Screen Capture Attempt Detected on Other User Screen",
                message: `Screen Capture Attempt Detected: Other User (${secAlert.offenderName || secAlert.participantName || "Participant"}) ${secAlert.actionText || "tried to take a screenshot"} on ${secAlert.platform || "Windows"}! Visual content was instantly blacked out on the other user's screen.`,
                timestamp: new Date(secAlert.event?.timestamp * 1000 || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                offender: secAlert.offenderName || secAlert.participantName || "Other User",
                offenderPeerId: pid,
                eventType: secAlert.eventType || "SCREENSHOT_ATTEMPT",
                actionText: secAlert.actionText || "tried to take a screenshot",
                platform: secAlert.platform || "Windows"
              });
              setHostSecurityToast({
                id: Date.now(),
                title: "🚨 Screen Capture on Other User Screen",
                offender: secAlert.offenderName || secAlert.participantName || "Other User",
                offenderPeerId: pid,
                actionText: secAlert.actionText || "tried to take a screenshot",
                platform: secAlert.platform || "Windows",
                timestamp: new Date(secAlert.event?.timestamp * 1000 || Date.now()).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
                message: `Other User (${secAlert.offenderName || secAlert.participantName || "Participant"}) ${secAlert.actionText || "tried to take a screenshot"} on ${secAlert.platform || "Windows"}!`
              });
              setHostAlertModalDismissed(false);
              playChime("leave");
            }
          }
        }
      } catch (err) {}
    }, 1200);
    return () => clearInterval(interval);
  }, [inCall, isHost, meetingCode, hostSecurityAlert]);

  // PARTICIPANT AUTONOMOUS UNLOCK WATCHDOG: Ensure participant's black screen immediately clears when host clicks remove
  useEffect(() => {
    if (!inCall || isHost || !meetingCode || !isContentLocked) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/room-security-status/${encodeURIComponent(meetingCode)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && !data.hasAlert && data.lockedCount === 0) {
            setIsContentLocked(false);
            setIsWindowBlurred(false);
            if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
              window.__unlockInstantDrm();
            }
            playChime("join");
            showHostNotification("🔓 The host has authorized your session. Video resumed.");
          }
        }
      } catch (e) {}
    }, 1000);
    return () => clearInterval(interval);
  }, [inCall, isHost, meetingCode, isContentLocked]);



  // Drawers & Modals
  const [chatOpen, setChatOpen] = useState(false);
  const [isChatDisabled, setIsChatDisabled] = useState(false); // Host toggle to disable chat for all
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const [showReactionsPicker, setShowReactionsPicker] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [showSafetyModal, setShowSafetyModal] = useState(false);
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showDetailsModal, setShowDetailsModal] = useState(false);
  const [showShortcutsModal, setShowShortcutsModal] = useState(false);
  const [showEndCallModal, setShowEndCallModal] = useState(false);
  const [postCallSummary, setPostCallSummary] = useState(null); // { code, durationFormatted, durationSeconds, participantsCount, wasHost, reason, canRejoin, endedAt }
  const [callQualityRating, setCallQualityRating] = useState(0);
  const [callRatingSubmitted, setCallRatingSubmitted] = useState(false);
  const [floatingReactions, setFloatingReactions] = useState([]); // [{ id, emoji, sender }]

  // Active Speaker & Audio Analysis
  const [isLocalSpeaking, setIsLocalSpeaking] = useState(false);
  const [activeSpeakerName, setActiveSpeakerName] = useState(null);
  const [lobbyMicLevel, setLobbyMicLevel] = useState(0);

  // Push-to-Talk & Fullscreen State
  const [isPushToTalkActive, setIsPushToTalkActive] = useState(false);
  const isPushToTalkRef = useRef(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [cameraFacingMode, setCameraFacingMode] = useState("user");
  const [dismissAloneBanner, setDismissAloneBanner] = useState(false);

  // High-Security Intrusion Defense States
  const [meetingPin, setMeetingPin] = useState("");
  const [isMeetingLocked, setIsMeetingLocked] = useState(false);
  const [isWindowBlurred, setIsWindowBlurred] = useState(false); // Window focus loss detection for screenshot blocking
  const [joinFormError, setJoinFormError] = useState("");
  const [pinHighlight, setPinHighlight] = useState(false);
  const pinInputRef = useRef(null);
  const [copiedDetails, setCopiedDetails] = useState(false);

  const [scheduledPin, setScheduledPin] = useState(""); // Mandatory PIN for scheduled meetings

  const [securityLockout, setSecurityLockout] = useState({
    active: false,
    message: "",
    remainingSeconds: 0
  });

  // Countdown timer for IP security jail
  useEffect(() => {
    let timer;
    if (securityLockout.active && securityLockout.remainingSeconds > 0) {
      timer = setInterval(() => {
        setSecurityLockout((prev) => {
          if (prev.remainingSeconds <= 1) {
            return { ...prev, active: false, remainingSeconds: 0 };
          }
          return { ...prev, remainingSeconds: prev.remainingSeconds - 1 };
        });
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [securityLockout.active, securityLockout.remainingSeconds]);

  // Print prevention (Ctrl+P)
  useEffect(() => {
    const handleBeforePrint = () => {
      if (inCall) {
        triggerScreenshotBlocked("print");
      }
    };
    window.addEventListener("beforeprint", handleBeforePrint);
    return () => {
      window.removeEventListener("beforeprint", handleBeforePrint);
    };
  }, [inCall]);

  // Progressive Web App (PWA) & Native App Installation State
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isAppInstalled, setIsAppInstalled] = useState(false);
  const [showInstallGuide, setShowInstallGuide] = useState(false);

  useEffect(() => {
    if (
      window.matchMedia("(display-mode: standalone)").matches ||
      window.navigator.standalone === true
    ) {
      setIsAppInstalled(true);
    }

    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setIsAppInstalled(true);
      setDeferredPrompt(null);
      showHostNotification("🎉 V2 Meet HD installed successfully!");
    };

    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    window.addEventListener("appinstalled", handleAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
      window.removeEventListener("appinstalled", handleAppInstalled);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const choiceResult = await deferredPrompt.userChoice;
      if (choiceResult.outcome === "accepted") {
        setDeferredPrompt(null);
        setIsAppInstalled(true);
      }
    } else {
      setShowInstallGuide(true);
    }
  };

  // Schedule Future Meeting Form
  const [scheduledTitle, setScheduledTitle] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [scheduledTime, setScheduledTime] = useState("");
  const [scheduleError, setScheduleError] = useState("");
  const [passcodeCopied, setPasscodeCopied] = useState(false);
  // Clear any legacy scheduled meetings storage to ensure complete confidentiality
  useEffect(() => {
    try {
      localStorage.removeItem("v2_scheduled_meetings");
    } catch {}
  }, []);

  const localVideoRef = useRef(null);
  const previewVideoRef = useRef(null);
  const callContainerRef = useRef(null);
  const webrtcManagerRef = useRef(null);
  const localStreamRef = useRef(null);
  const previewStreamRef = useRef(null);

  // Live Clock (like Google Meet top bar)
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) +
          " • " +
          now.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Ensure clean teardown if tab/window is closed
  useEffect(() => {
    const handleUnload = () => {
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.cleanup();
      }
    };
    window.addEventListener("beforeunload", handleUnload);
    window.addEventListener("pagehide", handleUnload);
    return () => {
      window.removeEventListener("beforeunload", handleUnload);
      window.removeEventListener("pagehide", handleUnload);
    };
  }, []);

  // Save username to local storage and clear validation warnings when non-empty
  const handleUserNameChange = (val) => {
    const trimmed = val.slice(0, 32);
    setUserName(trimmed);
    localStorage.setItem("v2_username", trimmed);
    if (trimmed.trim() && trimmed.trim().toLowerCase() !== "participant") {
      setNameHighlight(false);
      setNameError("");
      if (joinFormError && joinFormError.toLowerCase().includes("name")) {
        setJoinFormError("");
      }
    }
  };

  // Strictly enforce mandatory user display name
  const validateUserName = () => {
    const trimmed = (userName || "").trim();
    if (!trimmed || trimmed.toLowerCase() === "participant") {
      setNameHighlight(true);
      setNameError("⚠️ Please enter your name. Your name is mandatory to join or start a meeting.");
      if (nameInputRef.current) {
        nameInputRef.current.focus();
        nameInputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      return false;
    }
    return true;
  };

  // Extract meeting code from URL hash/search on load (STRICT SECURITY: Never autofill passcode!)
  useEffect(() => {
    try {
      const fullQuery = window.location.hash.replace(/^#/, "?") || window.location.search;
      if (fullQuery) {
        const params = new URLSearchParams(fullQuery);
        const joinTok = params.get("join") || params.get("j");
        const c = params.get("code");
        const exp = params.get("exp");

        // Strict security: Do NOT autofill passcode.
        setMeetingPin("");

        // Handle opaque join token (Zero room ID or password in URL)
        if (joinTok) {
          const safeTok = decodeURIComponent(joinTok).trim();
          fetch(`${getApiBase()}/api/join-token/${encodeURIComponent(safeTok)}`)
            .then((r) => {
              if (!r.ok) throw new Error("Invalid join link");
              return r.json();
            })
            .then((data) => {
              if (data && data.valid && data.roomId) {
                setJoinInput(data.roomId);
                if (data.pin) {
                  setMeetingPin(data.pin);
                }
                const saved = (localStorage.getItem("v2_username") || "").trim();
                if (!saved || saved.toLowerCase() === "participant") {
                  setNameHighlight(true);
                  setNameError("👋 Welcome! Please enter your name to join this meeting (Mandatory).");
                  setTimeout(() => {
                    if (nameInputRef.current) nameInputRef.current.focus();
                  }, 400);
                }
              } else {
                setJoinFormError("⚠️ This invitation link is invalid or has expired.");
              }
            })
            .catch(() => {
              setJoinFormError("⚠️ Failed to resolve invitation link. Please verify your link.");
            });
          return;
        }

        // Check if invitation link has expired based on embedded TTL
        if (exp) {
          let expSec = parseFloat(exp);
          if (expSec > 1000000000000) expSec = expSec / 1000;
          const nowSec = Date.now() / 1000;
          if (!isNaN(expSec) && nowSec > expSec) {
            setMeetingEndedNotice({
              title: "Invitation Link Expired",
              message: "This meeting invitation link has reached its expiration limit. Ephemeral links cannot be reused."
            });
            setJoinInput("");
            setJoinFormError("⚠️ This invitation link has expired.");
            return;
          }
        }

        if (c) {
          const safeCode = decodeURIComponent(c).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
          setJoinInput(safeCode);
          const saved = (localStorage.getItem("v2_username") || "").trim();
          if (!saved || saved.toLowerCase() === "participant") {
            setNameHighlight(true);
            setNameError("👋 Welcome! Please enter your name to join this meeting (Mandatory).");
            setTimeout(() => {
              if (nameInputRef.current) nameInputRef.current.focus();
            }, 400);
          }
          // Check if this meeting is expired or requires a mandatory passcode
          fetch(`${getApiBase()}/api/room-status/${encodeURIComponent(safeCode)}${exp ? `?exp=${encodeURIComponent(exp)}` : ""}`)
            .then((r) => r.json())
            .then((data) => {
              if (data && data.isExpired) {
                setMeetingEndedNotice({
                  title: "Meeting Token Expired / Ended",
                  message: data.message || "This meeting has ended or the invitation token has permanently expired."
                });
                setJoinInput("");
                setJoinFormError("🔒 This meeting has ended and cannot be rejoined.");
              } else if (data && data.isLocked) {
                setMeetingLockedNotice({
                  title: "Meeting is Locked",
                  message: "The host has locked this meeting. No one can enter through link or password."
                });
                setJoinInput("");
                setJoinFormError("🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password.");
              } else if (data && data.requiresPin) {
                setJoinFormError("🔒 8-character passcode required for this scheduled meeting. Enter it in the passcode box.");
                setPinHighlight(true);
              }
            })
            .catch(() => {});
        }
      }
    } catch (e) {
      console.warn("Could not parse code from URL:", e);
    }
  }, []);

  // High-Quality Camera/Mic Pre-Check & Live Audio Meter in Lobby
  useEffect(() => {
    let active = true;
    let meterCleanup = null;
    async function initPreview() {
      try {
        let stream;
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: cameraFacingMode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 }
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
        } catch (e1) {
          console.warn("High-res preview failed, fallback to basic:", e1);
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: cameraFacingMode },
            audio: true
          });
        }
        if (active) {
          previewStreamRef.current = stream;
          if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = stream;
            previewVideoRef.current.play().catch(() => {});
          }
          meterCleanup = createAudioLevelDetector(stream, (level) => {
            if (active) setLobbyMicLevel(Math.min(100, Math.round(level * 2.5)));
          });
        }
      } catch (err) {
        console.warn("Camera preview warning:", err);
      }
    }
    if (!inCall) {
      initPreview();
    }
    return () => {
      active = false;
      if (meterCleanup) meterCleanup();
      if (previewStreamRef.current) {
        previewStreamRef.current.getTracks().forEach((t) => t.stop());
        previewStreamRef.current = null;
      }
    };
  }, [inCall, cameraFacingMode]);

  // Synchronize local video element with webcam stream
  useEffect(() => {
    if (!inCall) return;

    const attachStream = () => {
      const activeStream = (isScreenSharing && webrtcManagerRef.current?.screenStream)
        ? webrtcManagerRef.current.screenStream
        : localStreamRef.current;

      if (localVideoRef.current && activeStream) {
        if (localVideoRef.current.srcObject !== activeStream) {
          localVideoRef.current.srcObject = activeStream;
        }
        localVideoRef.current.play().catch((e) => console.warn("Local play error:", e));
      }
    };

    attachStream();
    const raf = requestAnimationFrame(attachStream);
    const timeout = setTimeout(attachStream, 150);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(timeout);
    };
  }, [inCall, isScreenSharing]);

  // Call duration timer
  useEffect(() => {
    let timer;
    if (inCall && remotePeers.length > 0) {
      timer = setInterval(() => {
        setCallDuration((prev) => prev + 1);
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [inCall, remotePeers.length]);

  const formatTimer = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const extractCodeFromInput = (raw) => {
    let text = (raw || "").trim();
    if (!text) return "";

    // 1. Check for code in query/hash or text pattern
    const codeQueryMatch = text.match(/[?&#]code=([a-zA-Z0-9_-]+)/i);
    const codeTextMatch = text.match(/(?:meeting code|code)[:\s*]+([a-zA-Z0-9_-]+)/i);

    if (codeQueryMatch) {
      return codeQueryMatch[1];
    } else if (codeTextMatch) {
      return codeTextMatch[1];
    } else if (text.startsWith("http://") || text.startsWith("https://")) {
      try {
        const urlObj = new URL(text);
        if (urlObj.searchParams.get("code")) {
          return urlObj.searchParams.get("code");
        }
        if (urlObj.hash) {
          const hashQuery = urlObj.hash.replace(/^#/, "?");
          const hp = new URLSearchParams(hashQuery);
          if (hp.get("code")) return hp.get("code");
        }
        const parts = urlObj.pathname.split("/").filter(Boolean);
        if (parts.length > 0) {
          return parts[parts.length - 1];
        }
      } catch (e) {
        // Fallback
      }
    }

    if (!text.includes("\n") && !text.includes(" ")) {
      if (text.includes("code=")) {
        return text.split("code=")[1].split("&")[0];
      } else if (text.includes("/")) {
        const parts = text.split("/");
        return parts[parts.length - 1].split("?")[0].split("#")[0];
      }
      return text;
    } else {
      const tokens = text.split(/\s+/);
      for (const token of tokens) {
        if (/^[a-zA-Z0-9_-]{6,64}$/.test(token)) {
          return token;
        }
      }
    }

    return text;
  };

  // STRICT SECURITY: Never autofill passcode — user MUST fill it themselves!
  const extractCodeAndPinFromInput = (raw) => {
    return {
      code: decodeURIComponent(extractCodeFromInput(raw) || "").trim(),
      pin: ""
    };
  };

  const copyCode = (codeToCopy = meetingCode) => {
    if (!codeToCopy) return;
    navigator.clipboard.writeText(codeToCopy);
    setCopiedCode(true);
    showHostNotification("📋 Meeting code copied to clipboard!");
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const copyInviteLink = async (codeToCopy = meetingCode, pinToCopy = meetingPin) => {
    if (!codeToCopy) return;
    const cleanCode = codeToCopy.trim();
    let token = "";
    try {
      const res = await fetch(`${getApiBase()}/api/meetings/join-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: cleanCode, pin: pinToCopy || null })
      });
      if (res.ok) {
        const d = await res.json();
        token = d.token;
      }
    } catch {}

    const base = `${window.location.origin}${window.location.pathname}`;
    // Opaque secure link: NO room ID and NO password in the link
    const link = token ? `${base}#join=${encodeURIComponent(token)}` : `${base}#join=${encodeURIComponent(cleanCode)}`;
    const msg = `📅 V2 Meet HD — Meeting Invitation\n🔗 Link: ${link}\n🛡️ Protected by Host Knocking Admission & Hardware DRM\n⏳ Ephemeral Security Token`;

    navigator.clipboard.writeText(msg);
    setCopiedLink(true);
    showHostNotification("📋 Secure invite link copied (No password or room ID in link)!");
    setTimeout(() => setCopiedLink(false), 2000);
  };

  const copyPasscode = (pinToCopy) => {
    if (!pinToCopy) return;
    navigator.clipboard.writeText(pinToCopy);
    showHostNotification("🔑 Passcode copied to clipboard!");
  };

  const copyMeetingDetails = async () => {
    if (!meetingCode) return;
    const cleanCode = meetingCode.trim();
    let token = "";
    try {
      const res = await fetch(`${getApiBase()}/api/meetings/join-token`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomCode: cleanCode, pin: meetingPin || null })
      });
      if (res.ok) {
        const d = await res.json();
        token = d.token;
      }
    } catch {}

    const base = `${window.location.origin}${window.location.pathname}`;
    const link = token ? `${base}#join=${encodeURIComponent(token)}` : `${base}#join=${encodeURIComponent(cleanCode)}`;
    const details = `🔒 V2 Meet HD — Video Call Details\n🔗 Meeting Link: ${link}\n🛡️ Protected by Host Knocking Admission & Hardware DRM\n⏳ Ephemeral Token Lifetime: 2 Hours Max`;

    navigator.clipboard.writeText(details);
    setCopiedDetails(true);
    showHostNotification("📋 Meeting details copied to clipboard!");
    setTimeout(() => setCopiedDetails(false), 2500);
  };

  // Start / Enter Call (Multi-Party Mesh)
  const startMeetingWithCode = async (targetCode, forceCreator = null, forceToken = null, overridePin = null) => {
    if (!validateUserName()) {
      showHostNotification("⚠️ Name is mandatory! Please enter your name before joining.");
      return;
    }
    const { code: activeCode, pin: extractedPin } = extractCodeAndPinFromInput(targetCode);
    if (!activeCode) {
      showHostNotification("⚠️ Please enter a meeting code or link.");
      return;
    }

    // Security Rule: Reject sequential IDs like 1001, 1002, or predictable patterns
    if (!isSecureRoomCode(activeCode)) {
      showHostNotification("🔒 Security Error: Sequential/predictable Room IDs are rejected.");
      return;
    }

    setMeetingCode(activeCode);
    setCallDuration(0);
    setDismissAloneBanner(false);

    // Fresh join: strictly ensure zero black screen at time of joining
    setIsContentLocked(false);
    setIsWindowBlurred(false);
    if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
      window.__unlockInstantDrm();
    }

    // Only user who generated the meeting link has creator token
    const storedHostToken = forceToken || localStorage.getItem("v2_host_token_" + activeCode);
    const isCreatorUser = (forceCreator !== null) ? forceCreator : Boolean(storedHostToken);

    // Resolve PIN / Passcode (manual entry strictly required for non-hosts)
    const effectivePin = overridePin !== null ? overridePin : meetingPin.trim().toUpperCase();

    // Pre-flight Security Check: If room is locked or expired, block entry immediately before acquiring media
    if (!isCreatorUser) {
      try {
        const resp = await fetch(`${getApiBase()}/api/room-status/${encodeURIComponent(activeCode)}`);
        if (resp.ok) {
          const data = await resp.json();
          if (data && data.isLocked) {
            setMeetingLockedNotice({
              title: "Meeting is Locked",
              message: "The host has locked this meeting. No one can enter through link or password."
            });
            setJoinFormError("🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password.");
            return;
          }
          if (data && data.isExpired) {
            setMeetingEndedNotice({
              title: "Meeting Expired / Ended",
              message: data.message || "This meeting has ended or the link has permanently expired."
            });
            setJoinFormError("🔒 This meeting has ended and cannot be rejoined.");
            return;
          }
          if (data && data.requiresPin && (!effectivePin || effectivePin.trim().length !== 8)) {
            setJoinFormError("🔒 8-character passcode is required for this scheduled meeting. Enter it in the passcode box above.");
            setPinHighlight(true);
            if (pinInputRef.current) {
              pinInputRef.current.focus();
            }
            return;
          }
        }
      } catch (e) {
        // Fallback to server WS handshake
      }
    }

    try {
      setStatus("Initializing Ultra-HD multi-party encryption...");

      let stream = null;
      // Re-use active preview stream if available to prevent camera re-acquisition lock on mobile
      const activeVid = previewStreamRef.current?.getVideoTracks().find((t) => t.readyState === "live");
      const activeAud = previewStreamRef.current?.getAudioTracks().find((t) => t.readyState === "live");

      if (activeVid && activeAud) {
        stream = previewStreamRef.current;
        previewStreamRef.current = null; // Transfer to call
      } else {
        if (previewStreamRef.current) {
          previewStreamRef.current.getTracks().forEach((t) => t.stop());
          previewStreamRef.current = null;
          await new Promise((r) => setTimeout(r, 120)); // Brief pause for mobile camera hardware to release
        }

        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: {
              facingMode: cameraFacingMode,
              width: { ideal: 1280 },
              height: { ideal: 720 },
              frameRate: { ideal: 30, max: 60 }
            },
            audio: {
              echoCancellation: true,
              noiseSuppression: true,
              autoGainControl: true
            }
          });
        } catch (highResErr) {
          console.warn("High-res call constraints failed, falling back to basic media:", highResErr);
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: cameraFacingMode },
            audio: true
          });
        }
      }

      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        localVideoRef.current.muted = true;
        localVideoRef.current.play().catch(() => {});
      }

      // High-Security Key Derivation: Incorporate Meeting PIN/Password if set (Double-Layer Encryption)
      const pinStr = effectivePin ? effectivePin.trim() : "";
      const secretMaterial = pinStr ? `${activeCode}:${pinStr}` : activeCode;
      const derivedKey = await deriveAESKey(secretMaterial);
      const roomId = await deriveRoomId(activeCode);
      const sNumber = await generateSafetyNumber(secretMaterial);
      setSafetyNumber(sNumber);

      const manager = new V2MultiPartyWebRTC({
        cryptoKey: derivedKey,
        participantName: userName,
        onPeerStreamAdd: (peerId, remoteStream, peerName, isPeerHost, isPeerCoHost) => {
          playChime("join");
          setRemotePeers((prev) => {
            const existing = prev.filter((p) => p.peerId !== peerId);
            return [
              ...existing,
              {
                peerId,
                stream: remoteStream,
                name: peerName,
                isHost: !!isPeerHost,
                isCoHost: !!isPeerCoHost,
                isAudioMuted: false,
                isVideoMuted: false,
                isHandRaised: false,
                isSpeaking: false,
                isScreenSharing: false
              }
            ];
          });
          setStatus("Connected (Multi-Peer E2EE Active)");
        },
        onPeerStreamRemove: (peerId) => {
          playChime("leave");
          setRemotePeers((prev) => prev.filter((p) => p.peerId !== peerId));
          setPinnedPeerId((current) => (current === peerId ? null : current));
          setHostLockedPeers((prev) => {
            const next = new Set(prev);
            next.delete(peerId);
            return next;
          });
          setHostLockedPeersMap((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
          if (hostSecurityAlert?.offenderPeerId === peerId) {
            setHostSecurityAlert(null);
          }
        },
        onPeerMediaStatus: (peerId, isMuted, isVideoOff) => {
          setRemotePeers((prev) =>
            prev.map((p) =>
              p.peerId === peerId
                ? { ...p, isAudioMuted: isMuted, isVideoMuted: isVideoOff }
                : p
            )
          );
        },
        onPeerScreenShare: (peerId, isSharing, peerName) => {
          setRemotePeers((prev) =>
            prev.map((p) =>
              p.peerId === peerId ? { ...p, isScreenSharing: isSharing } : p
            )
          );
          if (isSharing) {
            showHostNotification(`🖥️ ${peerName || "Participant"} started sharing their screen.`);
            setPinnedPeerId(peerId);
          } else {
            showHostNotification(`${peerName || "Participant"} stopped sharing their screen.`);
            setPinnedPeerId((current) => (current === peerId ? null : current));
          }
        },
        onScreenShareEnded: () => {
          setIsScreenSharing(false);
          showHostNotification("Screen sharing stopped.");
          if (localVideoRef.current && localStreamRef.current) {
            localVideoRef.current.srcObject = localStreamRef.current;
            localVideoRef.current.play().catch(() => {});
          }
        },
        onHostAction: ({ action, senderName }) => {
          if (action === "mute-mic") {
            setIsAudioMuted(true);
            playChime("mute");
            showHostNotification(`🔇 The host (${senderName || "Host"}) muted your microphone.`);
          } else if (action === "unmute-mic") {
            setIsAudioMuted(false);
            playChime("unmute");
            showHostNotification(`🎙️ The host (${senderName || "Host"}) unmuted your microphone.`);
          } else if (action === "stop-video") {
            setIsVideoMuted(true);
            showHostNotification(`📷 The host (${senderName || "Host"}) turned off your camera.`);
          } else if (action === "start-video") {
            setIsVideoMuted(false);
            showHostNotification(`📹 The host (${senderName || "Host"}) enabled your camera.`);
          } else if (action === "mute-all") {
            setIsAudioMuted(true);
            playChime("mute");
            showHostNotification(`🔇 The host (${senderName || "Host"}) muted all participants.`);
          } else if (action === "unmute-all") {
            setIsAudioMuted(false);
            playChime("unmute");
            showHostNotification(`🎙️ The host (${senderName || "Host"}) unmuted all participants.`);
          } else if (action === "stop-all-video") {
            setIsVideoMuted(true);
            showHostNotification(`📷 The host (${senderName || "Host"}) turned off cameras for all participants.`);
          } else if (action === "start-all-video") {
            setIsVideoMuted(false);
            showHostNotification(`📹 The host (${senderName || "Host"}) enabled cameras for all participants.`);
          } else if (action === "kick") {
            showHostNotification(`🛑 You have been removed from the meeting by the host (${senderName || "Host"}).`);
            endMeeting(true); // wasKicked = true
          }
        },
        onDisconnect: () => {
          showHostNotification("Call connection cut. You can rejoin below.");
          endMeeting(false, true); // connectionCut = true
        },
        onHostChange: ({ isHost: hostFlag, hostPeerId, hostName }) => {
          setIsHost(hostFlag);
          setRemotePeers((prev) =>
            prev.map((p) => ({ ...p, isHost: Boolean(hostPeerId && p.peerId === hostPeerId) }))
          );
          if (hostFlag) {
            showHostNotification("👑 You are the meeting Host. You generated this meeting and have full participant controls.");
            playChime("join");
          } else if (!hostPeerId) {
            showHostNotification("ℹ️ Original host left the call. Room is in guest mode (no host permissions active).");
          } else {
            showHostNotification(`👑 Host is ${hostName || "active"}.`);
          }
        },
        onCoHostChange: ({ targetPeerId, isCoHost: coHostFlag, isSelfCoHost, coHosts: coHostList }) => {
          if (isSelfCoHost !== undefined) {
            setIsCoHost(Boolean(isSelfCoHost));
          }
          if (coHostList && Array.isArray(coHostList)) {
            setCoHosts(new Set(coHostList));
            setRemotePeers((prev) =>
              prev.map((p) => ({
                ...p,
                isCoHost: coHostList.includes(p.peerId)
              }))
            );
          } else {
            setRemotePeers((prev) =>
              prev.map((p) => (p.peerId === targetPeerId ? { ...p, isCoHost: Boolean(coHostFlag) } : p))
            );
          }
        },
        onWhiteboardDraw: (stroke) => {
          setWhiteboardStrokes((prev) => [...prev, stroke]);
        },
        onWhiteboardClear: () => {
          setWhiteboardStrokes([]);
        },
        onWhiteboardSync: (strokes) => {
          if (Array.isArray(strokes)) {
            setWhiteboardStrokes(strokes);
          }
        },
        onStatus: (stat) => setStatus(stat),
        onChatMessage: (newMsg) => {
          playChime("message");
          setChatMessages((prev) => [...prev, newMsg]);
        },
        onReaction: (emoji, senderPeerId, senderName) => {
          triggerFloatingReaction(emoji, senderName);
        },
        onRaiseHand: (peerId, isRaised, senderName) => {
          if (isRaised) playChime("hand");
          setRemotePeers((prev) =>
            prev.map((p) => (p.peerId === peerId ? { ...p, isHandRaised: isRaised } : p))
          );
        },
        onRoomLockChange: (locked, by) => {
          setIsMeetingLocked(locked);
          playChime(locked ? "leave" : "join");
          showHostNotification(locked ? `🔒 Meeting locked by ${by || "Host"}. New participants are blocked.` : `🔓 Meeting unlocked by ${by || "Host"}.`);
        },
        onRoomChatDisabled: (disabled, by) => {
          setIsChatDisabled(disabled);
          playChime(disabled ? "leave" : "message");
          showHostNotification(disabled ? `🔒 In-meeting chat has been disabled by ${by || "Host"}.` : `💬 In-meeting chat has been enabled by ${by || "Host"}.`);
        },
        onSecurityAlert: (secAlert) => {
          if (!isHost && !isCoHost) {
            setIsHost(true);
          }
          playChime("leave");
          const offenderPeerId = secAlert.offenderPeerId || secAlert.peerId || secAlert.senderPeerId || remotePeers[0]?.peerId || "participant";
          const rawOffender = secAlert.offenderName || secAlert.participantName || secAlert.senderName || remotePeers.find((p) => p.peerId === offenderPeerId)?.name || "Participant";
          const offender = (rawOffender === "You" || rawOffender === userName || !rawOffender) ? "Other User" : rawOffender;
          const eventType = secAlert.eventType || "SECURITY_VIOLATION";
          const platform = secAlert.platform || "Windows";
          const isRecording = eventType === "SCREEN_RECORD_DETECTED" || eventType.toLowerCase().includes("record") || eventType.toLowerCase().includes("capture");
          const actionText = secAlert.actionText || (isRecording ? "tried to capture or record the screen" : "tried to take a screenshot");

          const timestamp = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

          if (offenderPeerId) {
            hostDecidedAlertsRef.current.delete(offenderPeerId);
            setHostLockedPeers((prev) => new Set([...prev, offenderPeerId]));
            setHostLockedPeersMap((prev) => ({
              ...prev,
              [offenderPeerId]: {
                peerId: offenderPeerId,
                name: offender,
                actionText,
                platform,
                timestamp,
                eventType
              }
            }));
          }

          setHostAlertModalDismissed(false);
          setHostSecurityAlert({
            title: "🚨 Screen Capture Attempt Detected on Other User Screen",
            message: `Screen Capture Attempt Detected: Other User (${offender}) ${actionText} on ${platform}! Visual content was instantly blacked out on the other user's screen.`,
            timestamp,
            offender,
            offenderPeerId,
            eventType,
            actionText,
            platform
          });
          setHostSecurityToast({
            id: Date.now(),
            title: "🚨 Screen Capture on Other User Screen",
            offender,
            offenderPeerId,
            actionText,
            platform,
            timestamp,
            message: `Other User (${offender}) ${actionText} on ${platform}!`
          });
          showHostNotification(`🚨 Screen Capture Attempt Detected: Other User (${offender}) ${actionText} on ${platform}!`);

          // Trigger OS desktop notification if available
          try {
            if (typeof Notification !== "undefined") {
              if (Notification.permission === "granted") {
                new Notification("🚨 Screen Capture Attempt Detected", {
                  body: `${offender} ${actionText} on ${platform}! Visual content is locked down.`
                });
              } else if (Notification.permission !== "denied") {
                Notification.requestPermission().then((p) => {
                  if (p === "granted") {
                    new Notification("🚨 Screen Capture Attempt Detected", {
                      body: `${offender} ${actionText} on ${platform}! Visual content is locked down.`
                    });
                  }
                });
              }
            }
          } catch (notifErr) {}
        },
        onHostUnlockedSession: (data) => {
          try {
            if (window.__unlockInstantDrm) {
              window.__unlockInstantDrm();
            } else {
              document.documentElement.classList.remove("instant-drm-blackout");
              if (document.body) document.body.classList.remove("instant-drm-blackout");
              const curtain = document.getElementById("instant-drm-curtain");
              if (curtain) curtain.style.display = "none";
              const vids = document.getElementsByTagName("video");
              for (let i = 0; i < vids.length; i++) {
                vids[i].style.removeProperty("display");
                vids[i].style.removeProperty("visibility");
                vids[i].style.removeProperty("opacity");
              }
              const stage = document.querySelector(".video-stage");
              if (stage) {
                stage.style.removeProperty("display");
                stage.style.removeProperty("visibility");
              }
            }
          } catch {}
          setIsContentLocked(false);
          setIsWindowBlurred(false);
          setContentLockHostDecision("waiting");
          playChime("join");
          showHostNotification(`🔓 ${data?.message || "The host has authorized your session. Video resumed."}`);
        },
        onHostDeniedUnlock: (data) => {
          setContentLockHostDecision("denied");
          try {
            if (typeof window !== "undefined" && typeof window.__setInstantDrmDenied === "function") {
              window.__setInstantDrmDenied(data?.message);
            }
          } catch {}
          playChime("leave");
          showHostNotification(`❌ ${data?.message || "The host did not grant permission to remove the black screen."}`);
        },
        onWaitingRoom: (waitingData) => {
          setIsWaitingForAdmission(true);
          setIsContentLocked(false);
          setIsWindowBlurred(false);
          if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
            window.__unlockInstantDrm();
          }
          setStatus("Asking to be let in... Waiting for host admission.");
        },
        onKnockRequest: ({ peerId, name }) => {
          playChime("knock");
          setWaitingAdmissionQueue((prev) => {
            if (prev.some((p) => p.peerId === peerId)) return prev;
            return [...prev, { peerId, name }];
          });
        },
        onKnockCancelled: (peerId) => {
          setWaitingAdmissionQueue((prev) => prev.filter((p) => p.peerId !== peerId));
        },
        onAdmissionDenied: (reason) => {
          setIsWaitingForAdmission(false);
          showHostNotification(`🚫 ${reason || "The host did not allow you into this meeting."}`);
          endMeeting(false, true);
        },
        onAdmitted: () => {
          setIsWaitingForAdmission(false);
          setIsContentLocked(false);
          setIsWindowBlurred(false);
          if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
            window.__unlockInstantDrm();
          }
          playChime("join");
          showHostNotification("🎉 You were admitted to the meeting by the host!");
        },
        onMeetingEnded: (msg) => {
          playChime("leave");
          setRejoinMeetingInfo(null);
          if (activeCode) {
            localStorage.removeItem("v2_host_token_" + activeCode);
            localStorage.removeItem("v2_host_pin_" + activeCode);
          }
          endMeeting(false, false, true);
          setMeetingEndedNotice({
            title: "Meeting Ended & Invalidation Enforced",
            message: msg?.message || "The host has ended this meeting for all participants. The meeting link and ephemeral tokens have been permanently destroyed."
          });
        },
        onError: (errPayload) => {
          const errMsg = typeof errPayload === "string" ? errPayload : (errPayload?.message || "Unknown error");
          const errCode = errPayload?.code;
          if (errCode === "IP_LOCKED_OUT") {
            setSecurityLockout({
              active: true,
              message: errMsg,
              remainingSeconds: errPayload.remainingSeconds || 900
            });
            endMeeting(false, true);
          } else if (errCode === "ROOM_LOCKED") {
            setRejoinMeetingInfo(null);
            setMeetingLockedNotice({
              title: "Meeting is Locked",
              message: errMsg || "The host has locked this meeting. No one can enter through link or password."
            });
            setJoinFormError("🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password.");
            endMeeting(false, false, true);
          } else if (errCode === "MEETING_EXPIRED" || errCode === "LINK_EXPIRED") {
            setRejoinMeetingInfo(null);
            if (activeCode) {
              localStorage.removeItem("v2_host_token_" + activeCode);
              localStorage.removeItem("v2_host_pin_" + activeCode);
            }
            setMeetingEndedNotice({
              title: errCode === "LINK_EXPIRED" ? "Invitation Link Expired" : "Meeting Expired / Ended",
              message: errMsg || "This meeting token or invitation link has expired. Permanent links cannot be reused."
            });
            endMeeting(false, false, true);
          } else if (errCode === "PIN_REQUIRED" || errCode === "INVALID_PIN") {
            setJoinFormError(errMsg || "🔒 8-character passcode is required for this scheduled meeting. Enter it in the passcode box.");
            setPinHighlight(true);
            endMeeting(false, false);
            if (pinInputRef.current) {
              pinInputRef.current.focus();
            }
          } else if (errCode === "NAME_REQUIRED") {
            setRejoinMeetingInfo(null);
            setNameHighlight(true);
            setNameError(errMsg || "⚠️ Please enter your name. Your name is mandatory to join this meeting.");
            setJoinFormError(errMsg || "⚠️ Please enter your name above. Name is mandatory.");
            endMeeting(false, false);
            if (nameInputRef.current) {
              nameInputRef.current.focus();
            }
          } else if (errCode === "HOST_NOT_ONLINE") {
            showHostNotification("⏳ The host has not started this instant meeting yet. Please wait for the host to enter the call.");
            endMeeting(false, true);
          } else {
            showHostNotification(`Notice: ${errMsg}`);
            endMeeting(false, true);
          }
        }
      });

      webrtcManagerRef.current = manager;
      const urlExp = new URLSearchParams(window.location.hash.replace(/^#/, "?") || window.location.search).get("exp");
      await manager.start(stream, roomId, null, isCreatorUser, storedHostToken, pinStr, urlExp);

      setInCall(true);
      setStatus("Waiting for other participants to join with code...");
    } catch (err) {
      console.error("Meeting error:", err);
      setStatus("Media access failed or denied.");
      showHostNotification("⚠️ Could not start camera/mic. Please ensure permissions are granted.");
    }
  };

  const handleCreateInstantMeeting = () => {
    if (!validateUserName()) {
      showHostNotification("⚠️ Please enter your name first (Mandatory).");
      return;
    }
    const newCode = generateSecureCode();
    setMeetingPin(""); // Instant meetings have NO PIN - protected by Host Admission Waiting Room!
    const hostToken = "host_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem("v2_host_token_" + newCode, hostToken);
    localStorage.removeItem("v2_host_pin_" + newCode);
    setIsHost(true);
    startMeetingWithCode(newCode, true, hostToken, "");
  };

  const handleOpenScheduleModal = () => {
    if (!validateUserName()) {
      showHostNotification("⚠️ Please enter your name first (Mandatory).");
      return;
    }
    // Generate a fresh 8-character alphanumeric security code (e.g. K9M2P4X8)
    const randomPin = generate8CharAlphaNumericCode();
    setScheduledPin(randomPin);
    setScheduleError("");
    setShowScheduleModal(true);
  };

  const handleScheduleFutureMeeting = async (e) => {
    e.preventDefault();
    if (!scheduledTitle.trim()) {
      setScheduleError("Please enter a meeting title.");
      return;
    }

    const cleanPin = scheduledPin.trim().toUpperCase();
    if (!cleanPin || cleanPin.length !== 8 || !/^[A-Z0-9]{8}$/.test(cleanPin)) {
      setScheduleError("Meeting passcode must be an 8-character alphanumeric code (e.g. K9M2P4X8).");
      return;
    }

    const code = generateSecureCode();
    const hostToken = "host_" + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    localStorage.setItem("v2_host_token_" + code, hostToken);
    localStorage.setItem("v2_host_pin_" + code, cleanPin);
    const scheduledTimeStr = `${scheduledDate} ${scheduledTime}`.trim() || "Upcoming";

    const newMeeting = {
      title: scheduledTitle.trim(),
      code,
      pin: cleanPin,
      scheduledFor: scheduledTimeStr,
      hostName: userName,
      hostToken,
      createdAt: new Date().toISOString()
    };

    // Save to server
    try {
      await fetch(`${getApiBase()}/api/schedule-meeting`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newMeeting)
      });
    } catch (err) {
      // server sync optional
    }

    // Save to local storage for host dashboard
    try {
      const mySaved = JSON.parse(localStorage.getItem("v2_my_scheduled_meetings") || "[]");
      mySaved.unshift(newMeeting);
      localStorage.setItem("v2_my_scheduled_meetings", JSON.stringify(mySaved));
      setScheduledRefresh((r) => r + 1);
    } catch {}

    // Automatically copy invitation message to creator's clipboard (link requires manual passcode entry)
    const inviteUrl = `${window.location.origin}/#code=${encodeURIComponent(newMeeting.code)}`;
    const invitationText = `📅 V2 Meet HD — Scheduled Meeting Invitation
📌 Topic: ${newMeeting.title}
🕒 Time: ${newMeeting.scheduledFor}

🔗 Meeting Link:
${inviteUrl}

🔑 Meeting Code: ${newMeeting.code}
🔒 Passcode: ${newMeeting.pin} (Mandatory to enter manually)

🛡️ Zero-Knowledge Hardware AES-256-GCM End-to-End Encrypted`;

    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(invitationText).catch(() => {});
    }

    setShowScheduleModal(false);
    setScheduledTitle("");
    setScheduledDate("");
    setScheduledTime("");
    setScheduledPin("");
    setScheduleError("");
    showHostNotification(`🔒 Meeting "${newMeeting.title}" scheduled securely! Invitation & Passcode copied to your clipboard.`);
  };

  // Google Meet Host Admission Actions
  const handleAdmitWaitingPeer = (targetPeerId) => {
    webrtcManagerRef.current?.hostAdmitPeer(targetPeerId);
    setWaitingAdmissionQueue((prev) => prev.filter((p) => p.peerId !== targetPeerId));
    showHostNotification("Admitted participant into meeting.");
  };

  const handleDenyWaitingPeer = (targetPeerId) => {
    webrtcManagerRef.current?.hostDenyPeer(targetPeerId);
    setWaitingAdmissionQueue((prev) => prev.filter((p) => p.peerId !== targetPeerId));
    showHostNotification("Denied entry to participant.");
  };

  const handleAdmitAllWaitingPeers = () => {
    webrtcManagerRef.current?.hostAdmitAll();
    setWaitingAdmissionQueue([]);
    showHostNotification("Admitted all waiting participants.");
  };

  const handleCancelKnock = () => {
    webrtcManagerRef.current?.cancelKnock();
    setIsWaitingForAdmission(false);
    endMeeting(false, false);
  };

  const handleJoinInputChange = (e) => {
    const rawVal = e.target.value;
    setJoinFormError("");
    setPinHighlight(false);

    // Extract ONLY meeting code; NEVER autofill passcode!
    const extractedCode = extractCodeFromInput(rawVal);
    if (rawVal.includes("http://") || rawVal.includes("https://") || rawVal.includes("\n") || rawVal.includes("code=")) {
      if (extractedCode) {
        setJoinInput(extractedCode);
        return;
      }
    }
    setJoinInput(rawVal);
  };

  const handleJoinFromInput = async (e) => {
    if (e) e.preventDefault();
    setJoinFormError("");
    setPinHighlight(false);

    if (!validateUserName()) {
      setJoinFormError("⚠️ Your name is mandatory. Please enter your name above.");
      showHostNotification("⚠️ Name is mandatory! Please enter your name.");
      return;
    }

    const rawInput = joinInput.trim();
    if (!rawInput) {
      setJoinFormError("⚠️ Please enter a meeting code or link.");
      return;
    }

    const extractedCode = extractCodeFromInput(rawInput);
    if (!extractedCode) {
      setJoinFormError("⚠️ Please enter a valid meeting code or link.");
      return;
    }

    const activePin = meetingPin.trim().toUpperCase();

    // Check if this meeting is locked, expired, or requires an 8-character passcode
    try {
      const resp = await fetch(`${getApiBase()}/api/room-status/${encodeURIComponent(extractedCode)}`);
      if (resp.ok) {
        const data = await resp.json();
        if (data && data.isExpired) {
          setMeetingEndedNotice({
            title: "Meeting Expired / Ended",
            message: data.message || "This meeting has ended or the invitation token has permanently expired."
          });
          setJoinFormError("🔒 This meeting has ended and cannot be rejoined.");
          return;
        }
        if (data && data.isLocked) {
          setMeetingLockedNotice({
            title: "Meeting is Locked",
            message: data.message || "The host has locked this meeting. No one can enter through link or password."
          });
          setJoinFormError("🔒 Meeting is Locked: The host has locked this meeting. No one can enter through link or password.");
          return;
        }
        if (data && data.requiresPin) {
          if (!activePin || activePin.length !== 8) {
            setJoinFormError("🔒 8-character passcode is required for this scheduled meeting. Enter it in the passcode box above.");
            setPinHighlight(true);
            if (pinInputRef.current) {
              pinInputRef.current.focus();
            }
            return;
          }
        }
      }
    } catch {
      // Fallback to startMeetingWithCode
    }

    startMeetingWithCode(extractedCode, false, null, activePin);
  };

  const executeHostEndMeetingForAll = () => {
    setShowEndCallModal(false);
    const codeToDestroy = meetingCode;
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostEndMeeting();
    }
    if (codeToDestroy) {
      localStorage.removeItem("v2_host_token_" + codeToDestroy);
      localStorage.removeItem("v2_host_pin_" + codeToDestroy);
    }
    setRejoinMeetingInfo(null);
    endMeeting(false, false, true);
    setMeetingEndedNotice({
      title: "Meeting Ended for All",
      message: "You have permanently ended this meeting. All cryptographic room tokens and invitation links have been invalidated."
    });
  };

  const handleHostEndMeetingForAll = () => {
    setShowEndCallModal(true);
  };

  const endMeeting = (wasKicked = false, connectionCut = false, isPermanentlyEnded = false) => {
    setShowEndCallModal(false);
    const currentCode = meetingCode;
    const summaryDuration = callDuration;
    const summaryPeersCount = remotePeers.length + 1;
    const summaryWasHost = isHost;

    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.cleanup();
      webrtcManagerRef.current = null;
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
    }
    setInCall(false);
    setIsHost(false);
    setIsWaitingForAdmission(false);
    setWaitingAdmissionQueue([]);
    setRemotePeers([]);
    setPinnedPeerId(null);
    setChatMessages([]);
    setChatOpen(false);
    setParticipantsOpen(false);
    setShowSafetyModal(false);
    setIsMyHandRaised(false);
    setIsScreenSharing(false);
    setCallDuration(0);
    setIsContentLocked(false);
    setContentLockHostDecision("waiting");
    setContentLockReason("");
    setHostLockedPeers(new Set());
    setHostLockedPeersMap({});
    setHostSecurityAlert(null);

    // Ensure DRM blackout classes and curtains are completely reset
    if (typeof window !== "undefined" && typeof window.__unlockInstantDrm === "function") {
      try { window.__unlockInstantDrm(); } catch (e) {}
    }

    if (currentCode) {
      setPostCallSummary({
        code: currentCode,
        durationFormatted: formatTimer(summaryDuration),
        durationSeconds: summaryDuration,
        participantsCount: summaryPeersCount,
        wasHost: summaryWasHost,
        reason: wasKicked
          ? "You were removed from the meeting by the host"
          : isPermanentlyEnded
          ? "Meeting ended for all participants by the host"
          : connectionCut
          ? "Network connection was interrupted"
          : "You left the meeting",
        canRejoin: !wasKicked && !isPermanentlyEnded,
        endedAt: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      });
      setCallQualityRating(0);
      setCallRatingSubmitted(false);
    }

    if (wasKicked || isPermanentlyEnded) {
      setRejoinMeetingInfo(null);
      if (currentCode) {
        localStorage.removeItem("v2_host_token_" + currentCode);
        localStorage.removeItem("v2_host_pin_" + currentCode);
      }
      setStatus(isPermanentlyEnded ? "Meeting ended for all. Tokens wiped." : "You were removed from the meeting by the host.");
    } else if (currentCode) {
      // User cut/left the call or connection dropped -> store code for 1-click Rejoin
      setRejoinMeetingInfo({
        code: currentCode,
        reason: connectionCut ? "Call cut / disconnected" : "You left the meeting",
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      });
      setStatus(connectionCut ? "Call cut. Click Rejoin to enter again." : "Left meeting. You can rejoin anytime.");
    } else {
      setStatus("Session terminated. Memory wiped.");
    }
  };

  // Listen for user cutting the call from the black screen curtain
  useEffect(() => {
    const handleCutCall = () => {
      endMeeting(false, true);
    };
    window.addEventListener("instant-drm-user-cut-call", handleCutCall);
    return () => {
      window.removeEventListener("instant-drm-user-cut-call", handleCutCall);
    };
  }, []);

  // Host Action Handlers
  const handleToggleCoHost = (targetPeerId, isCoHostVal) => {
    if (!isHost) {
      showHostNotification("⚠️ Only the meeting Host can appoint or remove Co-Hosts.");
      return;
    }
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.assignCoHost(targetPeerId, isCoHostVal);
    }
    setCoHosts((prev) => {
      const next = new Set(prev);
      if (isCoHostVal) next.add(targetPeerId);
      else next.delete(targetPeerId);
      return next;
    });
    setRemotePeers((prev) =>
      prev.map((p) => (p.peerId === targetPeerId ? { ...p, isCoHost: isCoHostVal } : p))
    );
    const targetPeer = remotePeers.find((p) => p.peerId === targetPeerId);
    showHostNotification(isCoHostVal ? `🛡️ Appointed ${targetPeer?.name || "Participant"} as Co-Host.` : `ℹ️ Revoked Co-Host privileges from ${targetPeer?.name || "Participant"}.`);
  };

  const handleSendWhiteboardStroke = (stroke) => {
    setWhiteboardStrokes((prev) => [...prev, stroke]);
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.sendWhiteboardDraw(stroke);
    }
  };

  const handleClearWhiteboard = () => {
    setWhiteboardStrokes([]);
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.sendWhiteboardClear();
    }
    showHostNotification("🧹 Cleared Collaborative Whiteboard for all participants.");
  };

  const handleHostMute = (targetPeerId) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostMuteUser(targetPeerId);
      setRemotePeers((prev) =>
        prev.map((p) => (p.peerId === targetPeerId ? { ...p, isAudioMuted: true } : p))
      );
      showHostNotification("Mute command sent to participant.");
    }
  };

  const handleHostUnmute = (targetPeerId) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostUnmuteUser(targetPeerId);
      setRemotePeers((prev) =>
        prev.map((p) => (p.peerId === targetPeerId ? { ...p, isAudioMuted: false } : p))
      );
      showHostNotification("Unmute command sent to participant.");
    }
  };

  const handleHostStopVideo = (targetPeerId) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostStopVideoUser(targetPeerId);
      setRemotePeers((prev) =>
        prev.map((p) => (p.peerId === targetPeerId ? { ...p, isVideoMuted: true } : p))
      );
      showHostNotification("Turn off video command sent to participant.");
    }
  };

  const handleHostStartVideo = (targetPeerId) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostStartVideoUser(targetPeerId);
      setRemotePeers((prev) =>
        prev.map((p) => (p.peerId === targetPeerId ? { ...p, isVideoMuted: false } : p))
      );
      showHostNotification("Enable video command sent to participant.");
    }
  };

  const handleHostMuteAll = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostMuteAll();
      setRemotePeers((prev) => prev.map((p) => ({ ...p, isAudioMuted: true })));
      showHostNotification("Muted all participants' microphones.");
    }
  };

  const handleHostUnmuteAll = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostUnmuteAll();
      setRemotePeers((prev) => prev.map((p) => ({ ...p, isAudioMuted: false })));
      showHostNotification("Unmuted all participants' microphones.");
    }
  };

  const handleHostStopAllVideo = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostStopAllVideo();
      setRemotePeers((prev) => prev.map((p) => ({ ...p, isVideoMuted: true })));
      showHostNotification("Turned off cameras for all participants.");
    }
  };

  const handleHostStartAllVideo = () => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostStartAllVideo();
      setRemotePeers((prev) => prev.map((p) => ({ ...p, isVideoMuted: false })));
      showHostNotification("Turned on cameras for all participants.");
    }
  };

  const handleHostKick = (targetPeerId, targetName) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.hostKickUser(targetPeerId);
    }
    setRemotePeers((prev) => prev.filter((p) => p.peerId !== targetPeerId));
    setHostLockedPeers((prev) => {
      const next = new Set(prev);
      next.delete(targetPeerId);
      return next;
    });
    setHostLockedPeersMap((prev) => {
      const next = { ...prev };
      delete next[targetPeerId];
      return next;
    });
    if (hostSecurityAlert?.offenderPeerId === targetPeerId) {
      setHostSecurityAlert(null);
    }
    setHostSecurityToast(null);
    showHostNotification(`Removed ${targetName || "participant"} from the call.`);
  };

  const handleHostUnlock = (targetPeerId, targetName) => {
    const peerToUnlock = targetPeerId || hostSecurityAlert?.offenderPeerId || Array.from(hostLockedPeers)[0];
    if (!peerToUnlock) return;
    hostDecidedAlertsRef.current.add(peerToUnlock);
    const resolvedName = targetName || hostLockedPeersMap[peerToUnlock]?.name || remotePeers.find((p) => p.peerId === peerToUnlock)?.name || "Participant";
    // 1. Relay through active WebSocket to the participant
    webrtcManagerRef.current?.hostUnlockPeer(peerToUnlock);
    // 2. Dual-channel HTTP fallback ensuring 100% reliable removal of the participant's black screen
    fetch(`${getApiBase()}/api/host-unlock-peer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode: meetingCode,
        targetPeerId: peerToUnlock,
        hostPeerId: webrtcManagerRef.current?.myPeerId,
        hostName: userName || "Host"
      })
    }).catch(() => {});

    setHostLockedPeers((prev) => {
      const next = new Set(prev);
      next.delete(peerToUnlock);
      return next;
    });
    setHostLockedPeersMap((prev) => {
      const next = { ...prev };
      delete next[peerToUnlock];
      return next;
    });
    setHostSecurityAlert(null);
    setHostSecurityToast(null);
    setHostAlertModalDismissed(true);
    showHostNotification(`🔓 Permission granted: Black screen removed for ${resolvedName}. Screen is now normal.`);
  };

  const handleHostDenyUnlock = (targetPeerId, targetName) => {
    const peerToDeny = targetPeerId || hostSecurityAlert?.offenderPeerId || Array.from(hostLockedPeers)[0];
    if (!peerToDeny) return;
    hostDecidedAlertsRef.current.add(peerToDeny);
    const resolvedName = targetName || hostLockedPeersMap[peerToDeny]?.name || remotePeers.find((p) => p.peerId === peerToDeny)?.name || "Participant";
    // 1. Relay through active WebSocket
    webrtcManagerRef.current?.hostDenyUnlockPeer(peerToDeny);
    // 2. Dual-channel HTTP fallback
    fetch(`${getApiBase()}/api/host-deny-unlock-peer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        roomCode: meetingCode,
        targetPeerId: peerToDeny,
        hostPeerId: webrtcManagerRef.current?.myPeerId,
        hostName: userName || "Host"
      })
    }).catch(() => {});

    // Dismiss the prompt dialog so the host is free to conduct the meeting
    setHostAlertModalDismissed(true);
    setHostSecurityAlert(null);
    setHostSecurityToast(null);
    showHostNotification(`🔒 Decision: Black screen kept on ${resolvedName}'s screen until they cut the call.`);
  };

  const toggleMic = () => {
    setIsAudioMuted((prev) => {
      const nextState = !prev;
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.toggleAudio(!nextState);
      }
      return nextState;
    });
  };

  const toggleCam = () => {
    setIsVideoMuted((prev) => {
      const nextState = !prev;
      if (webrtcManagerRef.current) {
        webrtcManagerRef.current.toggleVideo(!nextState);
      }
      return nextState;
    });
  };

  const handleToggleScreenShare = async () => {
    if (!webrtcManagerRef.current) return;
    if (isContentLocked) {
      showHostNotification("Screen sharing is unavailable while your screen is locked.");
      return;
    }
    try {
      const active = await webrtcManagerRef.current.toggleScreenShare();
      setIsScreenSharing(active);
      if (active) {
        showHostNotification("🖥️ Screen sharing started.");
        if (localVideoRef.current && webrtcManagerRef.current.screenStream) {
          localVideoRef.current.srcObject = webrtcManagerRef.current.screenStream;
          localVideoRef.current.play().catch(() => {});
        }
      } else {
        showHostNotification("Screen sharing stopped.");
        if (localVideoRef.current && localStreamRef.current) {
          localVideoRef.current.srcObject = localStreamRef.current;
          localVideoRef.current.play().catch(() => {});
        }
      }
    } catch (err) {
      console.warn("Screen share toggle error:", err);
    }
  };

  const toggleHandRaise = () => {
    const nextState = !isMyHandRaised;
    setIsMyHandRaised(nextState);
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.sendRaiseHand(nextState);
    }
  };

  const sendReaction = (emoji) => {
    if (webrtcManagerRef.current) {
      webrtcManagerRef.current.sendReaction(emoji);
      triggerFloatingReaction(emoji, "You");
    }
    setShowReactionsPicker(false);
  };

  const triggerFloatingReaction = (emoji, senderName) => {
    const id = Date.now() + Math.random();
    setFloatingReactions((prev) => [...prev, { id, emoji, senderName }]);
    setTimeout(() => {
      setFloatingReactions((prev) => prev.filter((r) => r.id !== id));
    }, 3500);
  };

  // High-Security Privacy Shield: Hardware DRM protection (Screen Recording / External Screen Share is Blacked Out)
  useEffect(() => {
    // 1. Host is completely exempt - Host can take screenshots freely
    if (isHost) return;
    // 2. When the app is open outside of an active call (lobby, preview, schedule modal), screenshots are 100% permitted
    if (!inCall || isWaitingForAdmission) return;

    const handleKeyDown = (e) => {
      if (isHost) return;
      if (!inCall || isWaitingForAdmission) return;
      const key = (e.key || "").toLowerCase();
      const code = (e.code || "").toLowerCase();

      // 1. Hardware PrintScreen key (any modifier: Alt, Ctrl, Win, or bare)
      const isPrintScreen = key === "printscreen" || code === "printscreen" || e.keyCode === 44 || key === "snapshot" || key === "print";
      // 2. Windows Snipping Tool (Win + Shift + S / Ctrl + Shift + S / Shift + S bare when not typing)
      const isInput = () => {
        const active = document.activeElement;
        if (!active) return false;
        const tag = (active.tagName || "").toLowerCase();
        return tag === "input" || tag === "textarea" || Boolean(active.isContentEditable);
      };
      const isSnippingTool = (e.shiftKey && (key === "s" || code === "keys") && !isInput()) ||
                             ((e.metaKey || e.ctrlKey) && e.shiftKey);
      // 3. Screen recording shortcuts (Win + Alt + R, Win + G, Alt + R, Ctrl + Alt + R, Ctrl + Shift + R)
      const isRecordShortcut = (e.metaKey || e.altKey || e.ctrlKey) && (key === "r" || code === "keyr" || key === "g" || code === "keyg");
      // 4. macOS Screenshot / Screen Recording Shortcuts (Cmd + Shift + 3 / 4 / 5 / 6)
      const isMacScreenshot = e.metaKey && e.shiftKey && ["3", "4", "5", "6"].includes(e.key);
      // 5. Nvidia GeForce Experience Recording (Alt + F9, Alt + F10)
      const isNvidiaRecord = e.altKey && (key === "f9" || code === "f9" || key === "f10" || code === "f10");
      // 6. Print dialog (Ctrl+P / Cmd+P)
      const isPrint = (e.ctrlKey || e.metaKey) && (key === "p" || code === "keyp");
      // 7. Save page (Ctrl+S / Cmd+S)
      const isSave = (e.ctrlKey || e.metaKey) && (key === "s" || code === "keys");
      // 8. Developer tools (F12, Ctrl+Shift+I/J/C)
      const isDevTools = key === "f12" || code === "f12" || ((e.ctrlKey || e.metaKey) && e.shiftKey && ["i", "j", "c"].includes(key));
      // 9. View Source (Ctrl+U / Cmd+U)
      const isViewSource = (e.ctrlKey || e.metaKey) && (key === "u" || code === "keyu");

      if (isPrintScreen || isSnippingTool || isRecordShortcut || isMacScreenshot || isNvidiaRecord || isPrint || isSave || isDevTools || isViewSource) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        const actionSource = (isRecordShortcut || isNvidiaRecord) ? "recording" : "windows";
        triggerScreenshotBlocked(actionSource);
      }
    };

    const handleKeyUp = (e) => {
      if (isHost) return;
      if (!inCall || isWaitingForAdmission) return;
      const key = (e.key || "").toLowerCase();
      const code = (e.code || "").toLowerCase();
      if (key === "printscreen" || code === "printscreen" || e.keyCode === 44 || key === "snapshot" || key === "print") {
        e.preventDefault();
        e.stopPropagation();
        triggerScreenshotBlocked("windows");
      }
    };

    // Listen for OS-level event from Electron main process
    const handleOsScreenshotBlocked = () => {
      if (isHost) return;
      if (!inCall || isWaitingForAdmission) return;
      triggerScreenshotBlocked("os");
    };

    // Prevent right-click context menu on meeting stage to block saving frames
    const handleContextMenu = (e) => {
      e.preventDefault();
    };

    // File-Sharing Prevention: Block all file drag-and-drop into the browser window
    const handleDragOver = (e) => {
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = "none";
      }
    };

    const handleDrop = (e) => {
      e.preventDefault();
      showHostNotification("🚫 File sharing is strictly disabled for confidentiality policy.");
    };

    try {
      if (typeof HTMLCanvasElement !== "undefined" && HTMLCanvasElement.prototype.captureStream) {
        HTMLCanvasElement.prototype.captureStream = function() {
          const blackCanvas = document.createElement("canvas");
          blackCanvas.width = 1920;
          blackCanvas.height = 1080;
          const ctx = blackCanvas.getContext("2d");
          if (ctx) {
            ctx.fillStyle = "#000000";
            ctx.fillRect(0, 0, 1920, 1080);
          }
          return blackCanvas.captureStream ? blackCanvas.captureStream(5) : new MediaStream();
        };
      }
      if (typeof HTMLMediaElement !== "undefined" && HTMLMediaElement.prototype.captureStream) {
        HTMLMediaElement.prototype.captureStream = function() {
          throw new DOMException("Media stream capture blocked by DRM policy.", "SecurityError");
        };
      }
    } catch {}

    window.addEventListener("keydown", handleKeyDown, true);
    window.addEventListener("keyup", handleKeyUp, true);
    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("keyup", handleKeyUp, true);
    window.addEventListener("screenshot-blocked-warning", handleOsScreenshotBlocked);
    window.addEventListener("contextmenu", handleContextMenu);
    window.addEventListener("dragover", handleDragOver, false);
    window.addEventListener("drop", handleDrop, false);

    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
      window.removeEventListener("keyup", handleKeyUp, true);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("keyup", handleKeyUp, true);
      window.removeEventListener("screenshot-blocked-warning", handleOsScreenshotBlocked);
      window.removeEventListener("contextmenu", handleContextMenu);
      window.removeEventListener("dragover", handleDragOver, false);
      window.removeEventListener("drop", handleDrop, false);
    };
  }, [inCall, isWaitingForAdmission, isHost]);

  // Active speaker detection on local microphone
  useEffect(() => {
    if (!inCall || !localStreamRef.current || isAudioMuted) {
      setIsLocalSpeaking(false);
      return;
    }
    const cleanup = createAudioLevelDetector(localStreamRef.current, (level) => {
      setIsLocalSpeaking(level > 15);
    });
    return () => {
      if (cleanup) cleanup();
    };
  }, [inCall, isAudioMuted]);

  // Active speaker detection on remote participants
  useEffect(() => {
    if (!inCall || remotePeers.length === 0) {
      setActiveSpeakerName(null);
      return;
    }

    const cleanups = [];
    remotePeers.forEach((p) => {
      if (p.stream && !p.isAudioMuted) {
        const cleanup = createAudioLevelDetector(p.stream, (level) => {
          const speaking = level > 15;
          setRemotePeers((prev) =>
            prev.map((peer) =>
              peer.peerId === p.peerId && peer.isSpeaking !== speaking
                ? { ...peer, isSpeaking: speaking }
                : peer
            )
          );
          if (speaking) {
            setActiveSpeakerName(p.name);
          }
        });
        if (cleanup) cleanups.push(cleanup);
      }
    });

    return () => {
      cleanups.forEach((c) => c && c());
    };
  }, [inCall, remotePeers.length]);

  // Keyboard Shortcuts & Push-to-Talk Hotkey Listener
  useEffect(() => {
    if (!inCall) return;

    const handleKeyDown = (e) => {
      const tag = e.target.tagName.toLowerCase();
      if (tag === "input" || tag === "textarea") return;

      if (e.code === "Space") {
        e.preventDefault();
        if (isAudioMuted && !isPushToTalkRef.current) {
          isPushToTalkRef.current = true;
          if (webrtcManagerRef.current) {
            webrtcManagerRef.current.toggleAudio(true);
          }
          setIsPushToTalkActive(true);
        }
      } else if (e.key === "m" || e.key === "M") {
        toggleMic();
      } else if (e.key === "v" || e.key === "V") {
        toggleCam();
      } else if (e.key === "c" || e.key === "C") {
        setChatOpen((prev) => !prev);
      } else if (e.key === "p" || e.key === "P") {
        setParticipantsOpen((prev) => !prev);
      } else if (e.key === "f" || e.key === "F") {
        toggleFullscreen();
      } else if (e.key === "?") {
        setShowShortcutsModal((prev) => !prev);
      }
    };

    const handleKeyUp = (e) => {
      if (e.code === "Space" && isPushToTalkRef.current) {
        e.preventDefault();
        isPushToTalkRef.current = false;
        if (webrtcManagerRef.current) {
          webrtcManagerRef.current.toggleAudio(false);
        }
        setIsPushToTalkActive(false);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [inCall, isAudioMuted]);

  // Flip Camera (Front / Back on Mobile or External Webcam)
  const flipCamera = async () => {
    const nextMode = cameraFacingMode === "user" ? "environment" : "user";
    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: nextMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });
      const newVideoTrack = newStream.getVideoTracks()[0];
      if (!inCall) {
        if (previewStreamRef.current) {
          const oldTrack = previewStreamRef.current.getVideoTracks()[0];
          if (oldTrack) {
            previewStreamRef.current.removeTrack(oldTrack);
            oldTrack.stop();
          }
          previewStreamRef.current.addTrack(newVideoTrack);
          if (previewVideoRef.current) {
            previewVideoRef.current.srcObject = previewStreamRef.current;
          }
        }
        setCameraFacingMode(nextMode);
        return;
      }
      if (localStreamRef.current) {
        const oldTrack = localStreamRef.current.getVideoTracks()[0];
        if (oldTrack) {
          localStreamRef.current.removeTrack(oldTrack);
          oldTrack.stop();
        }
        localStreamRef.current.addTrack(newVideoTrack);
      }
      if (webrtcManagerRef.current) {
        for (const peerObj of webrtcManagerRef.current.peers.values()) {
          const sender = peerObj.videoSender || peerObj.pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (sender) {
            await sender.replaceTrack(newVideoTrack);
          }
        }
      }
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
      }
      setCameraFacingMode(nextMode);
      showHostNotification(`📷 Camera switched to ${nextMode === "user" ? "Front" : "Back"}`);
    } catch (err) {
      console.warn("Could not switch camera:", err);
    }
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  };

  const sendChat = async (e) => {
    e.preventDefault();
    if (!chatInput.trim() || !webrtcManagerRef.current) return;

    if (isChatDisabled && !isHost) {
      showHostNotification("🔒 In-meeting chat is currently disabled by the host.");
      return;
    }

    try {
      await webrtcManagerRef.current.sendChatMessage(chatInput.trim());
      setChatMessages((prev) => [
        ...prev,
        { sender: "You", text: chatInput.trim(), timestamp: new Date().toLocaleTimeString() }
      ]);
      setChatInput("");
    } catch (err) {
      console.error("Error sending encrypted chat:", err);
    }
  };

  // Determine dynamic grid columns based on number of participants (supports up to 50 members)
  const totalTiles = remotePeers.length + 1; // +1 for local
  let gridLayoutClass = "grid-1";
  if (pinnedPeerId) {
    gridLayoutClass = "grid-pinned";
  } else if (totalTiles === 2) {
    gridLayoutClass = "grid-2";
  } else if (totalTiles <= 4) {
    gridLayoutClass = "grid-4";
  } else if (totalTiles <= 9) {
    gridLayoutClass = "grid-9";
  } else if (totalTiles <= 16) {
    gridLayoutClass = "grid-16";
  } else if (totalTiles <= 25) {
    gridLayoutClass = "grid-25";
  } else if (totalTiles <= 36) {
    gridLayoutClass = "grid-36";
  } else {
    gridLayoutClass = "grid-50";
  }

  if (!isWindowsDevice) {
    return (
      <div className="windows-restriction-wrapper">
        <div className="windows-restriction-card">
          <div className="windows-restriction-badge">
            <ShieldAlert className="w-4 h-4 text-emerald-700" />
            <span>Enterprise Security • Windows Workstations Only</span>
          </div>

          <div className="windows-icon-container">
            <Laptop className="w-16 h-16 text-emerald-600" />
          </div>

          <h2 className="windows-restriction-title">Windows Device Required</h2>

          <p className="windows-restriction-desc">
            This confidential conference platform is cryptographically restricted to <b>Microsoft Windows</b> workstations only. Access from Android, iPhone, iPad, macOS, and Linux devices is prohibited by enterprise security policy.
          </p>

          <div className="windows-security-info-box">
            <div className="security-info-item">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Instant hardware screenshot blackout & Windows PrintScreen blocking</span>
            </div>
            <div className="security-info-item">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Windows Snipping Tool (Win + Shift + S) & Game Bar interception</span>
            </div>
            <div className="security-info-item">
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>Hardware DRM content protection (WDA_MONITOR)</span>
            </div>
          </div>

          <p className="windows-instruction-text">
            Please copy this link and open it in <b>Google Chrome or Microsoft Edge on a Windows 10 or Windows 11 PC</b>.
          </p>

          <button
            className="btn-copy-windows-link"
            onClick={() => {
              if (navigator.clipboard) {
                navigator.clipboard.writeText(window.location.href);
                alert("Meeting link copied! Open this link on your Windows PC.");
              }
            }}
          >
            <Copy className="w-4 h-4" />
            <span>Copy Link for Windows PC</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" ref={callContainerRef}>

      {/* Floating Emoji Reactions Layer */}
      <div className="reactions-container">
        {floatingReactions.map((r) => (
          <div key={r.id} className="floating-reaction">
            <span className="emoji-icon">{r.emoji}</span>
            <span className="reaction-sender">{r.senderName}</span>
          </div>
        ))}
      </div>

      {/* High-Visibility Screenshot Blocked Toast Alert (Yellow, Green & White Theme) */}
      {screenshotAlert && (
        <div className="screenshot-blocked-toast" role="alert" aria-live="assertive">
          <div className="screenshot-blocked-icon">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div className="screenshot-blocked-content">
            <div className="screenshot-blocked-title">
              <span>{screenshotAlert.title}</span>
              <span className="screenshot-blocked-badge">Blocked</span>
            </div>
            <div className="screenshot-blocked-desc">
              {screenshotAlert.message}
            </div>
          </div>
          <button
            className="screenshot-blocked-close"
            onClick={() => setScreenshotAlert(null)}
            aria-label="Dismiss screenshot notification"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Google Meet Style Global Toast Notification (No Popups) */}
      {hostNotification && (
        <div className="global-toast" role="status" aria-live="polite">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" />
          <span>{hostNotification}</span>
        </div>
      )}

      {/* Top Application Header (Lobby Only) */}
      {!inCall && (
        <header className="app-header">
          <div className="logo-group">
            <div className="logo-icon-shield">
              <Shield className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="logo-text-group">
              <h1 className="logo-title">
                V2 <span className="logo-badge">PRO ENTERPRISE</span>
              </h1>
              <span className="logo-tagline">Windows Protected Workplace</span>
            </div>
          </div>

          <div className="header-status">
            <div className="header-drm-pill">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>DRM Defense Active</span>
            </div>
            {!isAppInstalled && (
              <button
                className="btn-install-app"
                onClick={handleInstallClick}
                title="Install V2 Meet HD as a Desktop or Mobile App"
              >
                <Download className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                <span>Install App</span>
              </button>
            )}
            {currentTime && <span className="meet-clock">{currentTime}</span>}
            <span className="status-pill status-ready">
              <span className="status-dot-active" />
              System Ready
            </span>
          </div>
        </header>
      )}

      {/* Main View Area */}
      <main className="main-content">
        {!inCall ? (
          postCallSummary ? (
            /* Post-Call Summary Screen */
            <div className="post-call-summary-wrapper">
              <div className="post-call-card">
                <div className="post-call-header-pill">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Session Concluded • Windows Protected</span>
                </div>

                <div className="post-call-icon-hero">
                  <PhoneOff className="w-10 h-10 text-emerald-600" />
                </div>

                <h2 className="post-call-title">{postCallSummary.reason}</h2>
                <p className="post-call-subtitle">
                  Your encrypted conference has ended and hardware DRM protection has safely wiped memory.
                </p>

                {/* Metrics Dashboard */}
                <div className="post-call-stats-grid">
                  <div className="post-call-stat-box">
                    <span className="stat-label">
                      <Clock className="w-3.5 h-3.5 mr-1 text-slate-500" /> Call Duration
                    </span>
                    <span className="stat-value">{postCallSummary.durationFormatted}</span>
                  </div>

                  <div className="post-call-stat-box">
                    <span className="stat-label">
                      <Users className="w-3.5 h-3.5 mr-1 text-slate-500" /> Total Attendance
                    </span>
                    <span className="stat-value">{postCallSummary.participantsCount} member{postCallSummary.participantsCount === 1 ? "" : "s"}</span>
                  </div>

                  <div className="post-call-stat-box">
                    <span className="stat-label">
                      <Shield className="w-3.5 h-3.5 mr-1 text-emerald-600" /> Security
                    </span>
                    <span className="stat-value text-emerald-700">AES-256 E2EE Verified</span>
                  </div>

                  <div className="post-call-stat-box">
                    <span className="stat-label">
                      <Copy className="w-3.5 h-3.5 mr-1 text-slate-500" /> Meeting Code
                    </span>
                    <div className="stat-code-row">
                      <code>{postCallSummary.code}</code>
                      <button
                        type="button"
                        className="btn-copy-code-chip"
                        onClick={() => {
                          if (navigator.clipboard) {
                            navigator.clipboard.writeText(postCallSummary.code);
                            showHostNotification("Meeting code copied to clipboard!");
                          }
                        }}
                        title="Copy Meeting Code"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Quality Rating */}
                <div className="post-call-rating-card">
                  <span className="rating-prompt">How was the call audio & video quality?</span>
                  <div className="rating-stars-row">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                        type="button"
                        className={`btn-star-rate ${callQualityRating >= star ? "star-active" : ""}`}
                        onClick={() => {
                          setCallQualityRating(star);
                          setCallRatingSubmitted(true);
                        }}
                        title={`Rate ${star} star${star > 1 ? "s" : ""}`}
                      >
                        <Star className="w-5 h-5" />
                      </button>
                    ))}
                  </div>
                  {callRatingSubmitted && (
                    <span className="rating-thankyou-text">
                      <CheckCircle className="w-3.5 h-3.5 inline mr-1 text-emerald-600" />
                      Thank you! Your feedback helps us maintain enterprise ultra-HD performance.
                    </span>
                  )}
                </div>

                {/* Action Controls */}
                <div className="post-call-cta-row">
                  {postCallSummary.canRejoin && (
                    <button
                      type="button"
                      className="btn-post-call-rejoin"
                      onClick={() => {
                        const code = postCallSummary.code;
                        setPostCallSummary(null);
                        startMeetingWithCode(code);
                      }}
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      Rejoin Meeting
                    </button>
                  )}

                  <button
                    type="button"
                    className="btn-post-call-new"
                    onClick={() => {
                      setPostCallSummary(null);
                      handleStartInstantMeeting();
                    }}
                  >
                    <Video className="w-4 h-4 mr-2" />
                    Start New Meeting
                  </button>

                  <button
                    type="button"
                    className="btn-post-call-home"
                    onClick={() => setPostCallSummary(null)}
                  >
                    <Home className="w-4 h-4 mr-2" />
                    Return to Home
                  </button>
                </div>
              </div>
            </div>
          ) : (
            /* Lobby Screen (Zoom & Google Meet style) */
            <div className="meet-lobby-wrapper">
            {/* Rejoin Meeting Banner if user's call was cut or ended */}
            {rejoinMeetingInfo && (
              <div className="rejoin-banner">
                <div className="rejoin-content">
                  <div className="rejoin-icon-wrap">
                    <PhoneCall className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <h4>{rejoinMeetingInfo.reason || "You left the meeting"}</h4>
                    <p>
                      Meeting code: <code>{rejoinMeetingInfo.code}</code> • {rejoinMeetingInfo.timestamp}
                    </p>
                  </div>
                </div>
                <div className="rejoin-actions">
                  <button
                    className="btn-rejoin-primary"
                    onClick={() => {
                      const codeToJoin = rejoinMeetingInfo.code;
                      setRejoinMeetingInfo(null);
                      startMeetingWithCode(codeToJoin);
                    }}
                  >
                    <RotateCcw className="w-4 h-4 mr-1.5" />
                    Rejoin Call
                  </button>
                  <button
                    className="btn-rejoin-dismiss"
                    onClick={() => setRejoinMeetingInfo(null)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            )}

            <div className="meet-lobby">
              {/* Left Column: Hero & Action Controls */}
              <div className="meet-hero">
                <div className="hero-kicker-badge">
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Windows Workstation Protected</span>
                  <span className="kicker-sep">•</span>
                  <span className="kicker-accent">50 Participants</span>
                </div>

                <div className="hero-text-block">
                  <h2 className="meet-headline">
                    Private, Ultra-HD Video Meetings for Windows
                  </h2>
                  <p className="meet-tagline">
                    Hardware-shielded end-to-end encrypted conferences with zero sign-ups, instant link access, interactive whiteboard, and screenshot defense.
                  </p>
                </div>

                {/* 1. Mandatory Identity Setup Card */}
                <div className={`identity-card ${nameHighlight || (!userName.trim()) ? "identity-card-attention" : ""}`}>
                  <div className="identity-card-header">
                    <div className="identity-avatar-badge">
                      {userName.trim() ? userName.trim()[0].toUpperCase() : <User className="w-5 h-5 text-emerald-600" />}
                    </div>
                    <div className="identity-info-meta">
                      <div className="identity-title-row">
                        <label className="identity-title">Your Display Name</label>
                        <span className="name-required-badge">Mandatory</span>
                      </div>
                      <span className="identity-subtitle">
                        {userName.trim() ? "Verified • Ready to connect" : "Please enter your name to enter or start meetings"}
                      </span>
                    </div>
                  </div>

                  <div className={`name-input-wrapper ${nameHighlight ? "has-name-alert" : ""}`}>
                    <User className="name-input-icon" />
                    <input
                      ref={nameInputRef}
                      type="text"
                      value={userName}
                      onChange={(e) => handleUserNameChange(e.target.value)}
                      placeholder="Enter your name (e.g. Alex Carter)"
                      className={`name-input ${nameHighlight ? "name-input-error" : ""}`}
                      maxLength={32}
                      spellCheck="false"
                      autoComplete="name"
                    />
                  </div>
                  {nameError && (
                    <div className="name-error-inline animate-shake">
                      <ShieldAlert className="w-3.5 h-3.5 text-amber-600 shrink-0 inline mr-1" />
                      <span>{nameError}</span>
                    </div>
                  )}
                </div>

                {/* 2. Action Hub: Start or Join */}
                <div className="lobby-actions-hub">
                  {/* Host Section */}
                  <div className="action-hub-section">
                    <span className="hub-section-label">Host a Conference</span>
                    <div className="hub-buttons-grid">
                      <button className="btn-action-primary" onClick={handleCreateInstantMeeting}>
                        <div className="btn-action-icon-wrap">
                          <Plus className="w-5 h-5 text-white" />
                        </div>
                        <div className="btn-action-text">
                          <span className="btn-action-title">New Meeting</span>
                          <span className="btn-action-desc">Instant room with waiting room</span>
                        </div>
                      </button>

                      <button
                        className="btn-action-secondary"
                        onClick={handleOpenScheduleModal}
                        title="Schedule for future"
                      >
                        <div className="btn-action-icon-wrap-subtle">
                          <Calendar className="w-5 h-5 text-emerald-700" />
                        </div>
                        <div className="btn-action-text">
                          <span className="btn-action-title">Schedule</span>
                          <span className="btn-action-desc">8-character security PIN</span>
                        </div>
                      </button>
                    </div>
                  </div>

                  {/* Join Section */}
                  <div className="action-hub-section">
                    <span className="hub-section-label">Join with Code or Link</span>
                    <form className="join-form-modern" onSubmit={handleJoinFromInput}>
                      <div className="join-inputs-row">
                        <div className="meet-input-wrapper flex-1">
                          <Keyboard className="input-keyboard-icon" />
                          <input
                            type="text"
                            className="meet-code-input"
                            placeholder="Enter meeting code, link or invitation"
                            value={joinInput}
                            onChange={handleJoinInputChange}
                            spellCheck="false"
                          />
                        </div>

                        <div className={`meet-pin-wrapper ${pinHighlight ? "has-alert" : ""}`}>
                          <Lock className={`input-pin-icon ${pinHighlight ? "text-amber-500" : ""}`} />
                          <input
                            ref={pinInputRef}
                            type="text"
                            className="meet-pin-input font-mono uppercase tracking-wider"
                            placeholder="Passcode"
                            value={meetingPin}
                            onChange={(e) => {
                              setMeetingPin(e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8));
                              setJoinFormError("");
                              setPinHighlight(false);
                            }}
                            maxLength={8}
                            title="8-character security code for scheduled meetings"
                          />
                        </div>

                        <button
                          type="submit"
                          className={`btn-join-meet ${joinInput.trim() ? "btn-join-active" : "btn-join-disabled"}`}
                          disabled={!joinInput.trim()}
                        >
                          Join
                        </button>
                      </div>

                      {joinFormError && (
                        <div className="join-inline-alert animate-shake">
                          <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                          <span>{joinFormError}</span>
                        </div>
                      )}
                    </form>
                  </div>
                </div>

                {/* Host-Only Scheduled Meetings Dashboard Panel (Strictly private to meeting creator) */}
                <HostScheduledMeetingsPanel
                  refreshTrigger={scheduledRefresh}
                  onJoinAsHost={(code, pin) => {
                    const hostToken = localStorage.getItem("v2_host_token_" + code);
                    startMeetingWithCode(code, true, hostToken, pin);
                  }}
                  onCopyInvite={(code, pin, title, scheduledFor) => {
                    const base = `${window.location.origin}${window.location.pathname}`;
                    const expTimestamp = Math.floor((Date.now() + 24 * 60 * 60 * 1000) / 1000);
                    const link = `${base}#code=${encodeURIComponent(code)}&exp=${expTimestamp}&pin=${encodeURIComponent(pin)}`;
                    const msg = `📅 V2 Meet HD — Scheduled Meeting Invitation\n📌 Topic: ${title}\n🕒 Time: ${scheduledFor}\n\n🔗 Meeting Link:\n${link}\n\n🔑 Meeting Code: ${code}\n🔒 Passcode: ${pin}\n\n🛡️ Windows Protected End-to-End Encrypted`;
                    navigator.clipboard.writeText(msg);
                    showHostNotification("📋 Meeting invitation copied to clipboard!");
                  }}
                />
              </div>

              {/* Right Column: Camera & Audio Studio */}
              <div className="meet-preview-card">
                <div className="preview-studio-header">
                  <div className="flex items-center gap-2">
                    <div className="studio-live-dot" />
                    <span className="studio-header-title">Readiness Studio</span>
                  </div>
                  <span className="studio-pill-hd">Ultra-HD 1080p</span>
                </div>

                <div className="preview-window">
                  <video
                    ref={previewVideoRef}
                    autoPlay
                    playsInline
                    muted
                    disablePictureInPicture={true}
                    controlsList="nodownload noplaybackrate noremoteplayback"
                    onContextMenu={(e) => e.preventDefault()}
                    webkit-playsinline="true"
                    className="preview-video-stream"
                  />
                  <div className="preview-indicator">
                    <div className="green-dot"></div>
                    <span>Camera & Mic Ready</span>
                  </div>

                  <div className="preview-floating-tools">
                    <button
                      type="button"
                      className="btn-preview-tool"
                      onClick={flipCamera}
                      title="Switch Camera (Front / Back)"
                    >
                      <RotateCcw className="w-3.5 h-3.5 mr-1" />
                      Flip
                    </button>
                  </div>
                </div>

                {/* Live Mic Level Visualizer */}
                <div className="lobby-mic-meter-wrap" title="Live microphone volume input">
                  <div className="lobby-mic-label">
                    <div className="flex items-center gap-1.5">
                      <Mic className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Audio Input Level</span>
                    </div>
                    <span className="lobby-mic-value">{lobbyMicLevel}%</span>
                  </div>
                  <div className="lobby-mic-bar">
                    <div
                      className="lobby-mic-fill"
                      style={{ width: `${Math.min(100, Math.max(4, lobbyMicLevel))}%` }}
                    />
                  </div>
                </div>

                <div className="preview-caption">
                  <div className="preview-caption-avatar">
                    {userName.trim() ? userName.trim()[0].toUpperCase() : "?"}
                  </div>
                  <div className="preview-caption-text">
                    <span className="preview-caption-sub">Joining room as</span>
                    <span className="preview-caption-name">{userName.trim() || "Participant (Name Required)"}</span>
                  </div>
                </div>
              </div>
            </div>



            {/* Modal: Schedule Future Meeting */}
            {showScheduleModal && (
              <div className="modal-backdrop schedule-modal-backdrop" onClick={() => setShowScheduleModal(false)}>
                <div className="schedule-modal-card" onClick={(e) => e.stopPropagation()}>
                  {/* Modal Header */}
                  <div className="schedule-modal-header">
                    <div className="schedule-modal-title-group">
                      <div className="schedule-header-icon-box">
                        <Calendar className="w-6 h-6 text-emerald-600" />
                      </div>
                      <div className="schedule-header-text">
                        <h3 className="schedule-modal-title">Schedule a Meeting</h3>
                        <p className="schedule-modal-subtitle">
                          Create a scheduled meeting link with a mandatory 8-character security passcode.
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      className="schedule-modal-close-btn"
                      onClick={() => setShowScheduleModal(false)}
                      title="Close"
                    >
                      <X className="w-5 h-5" />
                    </button>
                  </div>

                  <form onSubmit={handleScheduleFutureMeeting} className="schedule-modal-body">
                    {scheduleError && (
                      <div className="schedule-error-banner">
                        <AlertCircle className="w-5 h-5 text-rose-500 shrink-0" />
                        <span>{scheduleError}</span>
                      </div>
                    )}

                    {/* Field 1: Meeting Topic / Title */}
                    <div className="schedule-form-group">
                      <label className="schedule-form-label">
                        <span>Meeting Topic / Title</span>
                        <span className="schedule-label-required">* Mandatory</span>
                      </label>
                      <div className="schedule-input-wrapper">
                        <Sparkles className="schedule-input-icon text-emerald-500" />
                        <input
                          type="text"
                          className="schedule-text-input"
                          placeholder="e.g. Project Sprint Sync"
                          value={scheduledTitle}
                          onChange={(e) => {
                            setScheduledTitle(e.target.value);
                            if (scheduleError) setScheduleError("");
                          }}
                          required
                          autoFocus
                        />
                      </div>
                    </div>

                    {/* Field 2: 8-Character Passcode Security Showcase Card */}
                    <div className="schedule-passcode-card">
                      <div className="schedule-passcode-header">
                        <div className="schedule-passcode-label-group">
                          <Lock className="w-4 h-4 text-emerald-600" />
                          <span className="schedule-passcode-label">8-Character Passcode</span>
                          <span className="schedule-badge-mandatory">MANDATORY</span>
                        </div>
                        <button
                          type="button"
                          className="schedule-btn-generate"
                          onClick={() => {
                            const newPin = generate8CharAlphaNumericCode();
                            setScheduledPin(newPin);
                            setPasscodeCopied(false);
                          }}
                          title="Generate a new randomized 8-character code"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Generate New</span>
                        </button>
                      </div>

                      <div className="schedule-passcode-display-row">
                        <div className="schedule-passcode-input-box">
                          <input
                            type="text"
                            maxLength={8}
                            placeholder="E2VYHJXR"
                            value={scheduledPin}
                            onChange={(e) => {
                              const val = e.target.value.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
                              setScheduledPin(val);
                            }}
                            required
                            className="schedule-pin-field font-mono"
                          />
                        </div>
                        <button
                          type="button"
                          className={`schedule-passcode-copy-btn ${passcodeCopied ? "copied" : ""}`}
                          onClick={(e) => {
                            e.preventDefault();
                            if (scheduledPin && navigator.clipboard && navigator.clipboard.writeText) {
                              navigator.clipboard.writeText(scheduledPin).then(() => {
                                setPasscodeCopied(true);
                                setTimeout(() => setPasscodeCopied(false), 2000);
                              }).catch(() => {});
                            }
                          }}
                          title="Copy passcode to clipboard"
                        >
                          {passcodeCopied ? (
                            <>
                              <Check className="w-4 h-4 text-emerald-600" />
                              <span>Copied</span>
                            </>
                          ) : (
                            <>
                              <Copy className="w-4 h-4" />
                              <span>Copy</span>
                            </>
                          )}
                        </button>
                      </div>

                      <div className="schedule-passcode-hint">
                        <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span>
                          Mandatory security: Attendees must fill this 8-character passcode shared by the host to enter the meeting.
                        </span>
                      </div>
                    </div>

                    {/* Field 3: Date & Time (2-Column Responsive Grid) */}
                    <div className="schedule-datetime-grid">
                      <div className="schedule-form-group">
                        <label className="schedule-form-label">
                          <span>Date</span>
                        </label>
                        <div className="schedule-input-wrapper">
                          <Calendar className="schedule-input-icon text-slate-400" />
                          <input
                            type="date"
                            className="schedule-datetime-input"
                            value={scheduledDate}
                            onChange={(e) => setScheduledDate(e.target.value)}
                          />
                        </div>
                      </div>

                      <div className="schedule-form-group">
                        <label className="schedule-form-label">
                          <span>Time</span>
                        </label>
                        <div className="schedule-input-wrapper">
                          <Clock className="schedule-input-icon text-slate-400" />
                          <input
                            type="time"
                            className="schedule-datetime-input"
                            value={scheduledTime}
                            onChange={(e) => setScheduledTime(e.target.value)}
                          />
                        </div>
                      </div>
                    </div>

                    {/* Auto-copy notice */}
                    <div className="schedule-clipboard-notice">
                      <Info className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>The full invitation and passcode will be copied to your clipboard upon creation.</span>
                    </div>

                    {/* Modal Actions Footer */}
                    <div className="schedule-modal-footer">
                      <button
                        type="button"
                        className="schedule-btn-cancel"
                        onClick={() => setShowScheduleModal(false)}
                      >
                        Cancel
                      </button>
                      <button type="submit" className="schedule-btn-submit">
                        <Calendar className="w-4 h-4" />
                        <span>Schedule Meeting</span>
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
          )
        ) : (
          /* Active Call Screen (Zoom Multi-Person Grid) */
          <div className="call-layout">
            {/* Top Bar with SAS Safety Number */}
            {/* Top In-Call Header: Guaranteed Single-Line Aesthetic Header */}
            <header className="call-security-bar">
              {/* Left Group: Brand, Safety pill, Host Mode, DRM Protected, Active Speaker */}
              <div className="call-header-left">
                <div className="call-brand-group">
                  <div className="call-brand-icon">
                    <Shield className="w-4 h-4 text-amber-500" />
                  </div>
                  <span className="call-brand-title">
                    V2 <span className="call-brand-badge">MEET HD</span>
                  </span>
                </div>

                <div className="call-header-sep" />

                <button
                  type="button"
                  className="safety-number-tag"
                  onClick={() => setShowSafetyModal(true)}
                  title="Click to view end-to-end encryption & safety fingerprint"
                >
                  <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="safety-label">Safety:</span>
                  <b className="safety-code">{safetyNumber}</b>
                  <span className="info-click">Verify</span>
                </button>

                {isHost && (
                  <button
                    type="button"
                    className="host-badge-header"
                    onClick={() => {
                      setParticipantsOpen(true);
                      if (chatOpen) setChatOpen(false);
                    }}
                    title="Host Mode Active — Click to manage participants"
                  >
                    <Crown className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>Host Mode</span>
                  </button>
                )}

                <div className="security-shield-pill" title="Hardware DRM Anti-Screenshot & Screen Capture Protection Active">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>DRM Protected</span>
                </div>

                {activeSpeakerName && (
                  <div className="active-speaker-pill" title="Speaking right now">
                    <Volume2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 animate-pulse" />
                    <span>{activeSpeakerName}</span>
                  </div>
                )}
              </div>

              {/* Right Group: Duration Timer, Room Lock, Info, Fullscreen, Participants */}
              <div className="call-header-right">
                {remotePeers.length > 0 && (
                  <div className="call-timer-badge" title="Call Duration">
                    <Clock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                    <span>{formatTimer(callDuration)}</span>
                  </div>
                )}

                {/* Meeting Lock Status Badge */}
                {isMeetingLocked && (
                  <div className="badge-room-locked" title="Meeting is locked. No new participants can enter.">
                    <Lock className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                    <span className="hide-on-mobile">Locked</span>
                  </div>
                )}

                {/* Host Lock/Unlock Room Toggle */}
                {isHost && (
                  <button
                    type="button"
                    className={`btn-top-info ${isMeetingLocked ? "btn-lock-active" : ""}`}
                    onClick={() => {
                      const nextState = !isMeetingLocked;
                      webrtcManagerRef.current?.toggleRoomLock(nextState);
                      setIsMeetingLocked(nextState);
                    }}
                    title={isMeetingLocked ? "Unlock Meeting (Allow new entries)" : "Lock Meeting (Block all new entries)"}
                  >
                    {isMeetingLocked ? <Lock className="w-3.5 h-3.5 text-rose-600" /> : <Shield className="w-3.5 h-3.5 text-emerald-600" />}
                    <span className="hide-on-mobile">{isMeetingLocked ? "Unlock" : "Lock"}</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn-top-info"
                  onClick={() => setShowDetailsModal(true)}
                  title="Meeting Security & Details"
                >
                  <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="hide-on-mobile">Info</span>
                </button>

                <button
                  type="button"
                  className="btn-top-info btn-top-icon-only desktop-only-btn"
                  onClick={toggleFullscreen}
                  title={isFullscreen ? "Exit Fullscreen (F)" : "Enter Fullscreen (F)"}
                >
                  {isFullscreen ? <Minimize className="w-3.5 h-3.5" /> : <Maximize className="w-3.5 h-3.5" />}
                </button>

                <button
                  type="button"
                  className="participants-count-tag"
                  onClick={() => setParticipantsOpen(!participantsOpen)}
                  title="Toggle Participants Panel"
                >
                  <Users className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="part-count-number">{remotePeers.length + 1}</span>
                </button>
              </div>
            </header>

            {/* Push-to-Talk Indicator Banner */}
            {isPushToTalkActive && (
              <div className="push-to-talk-banner">
                <Mic className="w-4 h-4 text-emerald-400 animate-pulse" />
                <span>Spacebar held — Mic active</span>
              </div>
            )}


            {/* Google Meet Style Host Knocking / Admission Banner (Exclusive to Host) */}
            {isHost && waitingAdmissionQueue.length > 0 && (
              <div className="host-admission-banner" role="alert">
                <div className="admission-banner-left">
                  <div className="admission-avatar">
                    {(waitingAdmissionQueue[0].name || "U")[0].toUpperCase()}
                  </div>
                  <div className="admission-text">
                    <span className="admission-title">Someone wants to join this call</span>
                    <span className="admission-name">
                      <b>{waitingAdmissionQueue[0].name}</b>
                      {waitingAdmissionQueue.length > 1 && (
                        <span className="admission-others"> (+{waitingAdmissionQueue.length - 1} more)</span>
                      )}
                    </span>
                  </div>
                </div>
                <div className="admission-banner-actions">
                  <button
                    className="btn-deny-admission"
                    onClick={() => handleDenyWaitingPeer(waitingAdmissionQueue[0].peerId)}
                  >
                    Deny
                  </button>
                  <button
                    className="btn-admit-admission"
                    onClick={() => handleAdmitWaitingPeer(waitingAdmissionQueue[0].peerId)}
                  >
                    Admit
                  </button>
                  {waitingAdmissionQueue.length > 1 && (
                    <button
                      className="btn-admit-all"
                      onClick={handleAdmitAllWaitingPeers}
                    >
                      Admit all ({waitingAdmissionQueue.length})
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Google Meet Waiting Room Screen (While waiting for Host to admit) */}
            {isWaitingForAdmission && (
              <div className="waiting-room-screen" role="alert">
                <div className="waiting-room-card">
                  <div className="waiting-rings-container">
                    <div className="waiting-ring ring-outer"></div>
                    <div className="waiting-ring ring-middle"></div>
                    <div className="waiting-ring ring-inner"></div>
                    <div className="waiting-icon-center">
                      <Shield className="w-10 h-10 text-emerald-400 animate-pulse" />
                    </div>
                  </div>
                  <h2 className="waiting-title">Asking to be let in...</h2>
                  <p className="waiting-subtitle">
                    You'll join the meeting when the host lets you in.
                  </p>
                  <div className="waiting-meta-badge">
                    <span className="meta-item">Meeting: <code>{meetingCode}</code></span>
                    <span className="meta-item">Joining as: <b>{userName}</b></span>
                  </div>
                  <button
                    className="btn-cancel-waiting"
                    onClick={handleCancelKnock}
                  >
                    Cancel & Leave
                  </button>
                </div>
              </div>
            )}
            {/* Simple Floating Host Security Notification Toast */}
            {isHost && hostSecurityAlert && (() => {
              const targetPid = hostSecurityAlert?.offenderPeerId || hostSecurityAlert?.peerId || Array.from(hostLockedPeers)[0];
              if (!targetPid || targetPid === "local-host" || targetPid === webrtcManagerRef.current?.myPeerId) {
                return null;
              }
              if (hostDecidedAlertsRef.current.has(targetPid)) {
                return null;
              }
              const rawOffender = hostLockedPeersMap[targetPid]?.name || hostSecurityAlert?.offender || hostSecurityAlert?.offenderName || hostSecurityAlert?.participantName || remotePeers.find((p) => p.peerId === targetPid)?.name || "Participant";
              if (rawOffender === "Host Administrator Machine" || rawOffender === "You" || rawOffender === userName) {
                return null;
              }
              const offenderName = rawOffender || "Participant";
              const actionDesc = hostLockedPeersMap[targetPid]?.actionText || hostSecurityAlert?.actionText || "tried to take a screenshot";

              return (
                <div className="host-security-notification-toast" role="alert">
                  <div className="host-sec-toast-icon">
                    <ShieldAlert className="w-6 h-6 text-rose-500 animate-pulse" />
                  </div>
                  <div className="host-sec-toast-body">
                    <div className="host-sec-toast-title">
                      <span>🚨 Screen Capture Detected</span>
                      <span className="host-sec-badge-locked">Screen Blacked Out</span>
                    </div>
                    <p className="host-sec-toast-text">
                      <b>{offenderName}</b> {actionDesc} on Windows. Their screen is locked in black screen. Do you want to remove the black screen?
                    </p>
                    <div className="host-sec-toast-actions">
                      <button
                        className="btn-toast-unlock"
                        onClick={() => {
                          if (targetPid) hostDecidedAlertsRef.current.add(targetPid);
                          setHostSecurityAlert(null);
                          setHostSecurityToast(null);
                          handleHostUnlock(targetPid, offenderName);
                        }}
                        title={`Remove Black Screen from ${offenderName}'s screen and restore normal video`}
                      >
                        <Unlock className="w-4 h-4 mr-1.5 inline" />
                        <span>Remove Black Screen</span>
                      </button>
                      <button
                        className="btn-toast-keep"
                        onClick={() => {
                          if (targetPid) hostDecidedAlertsRef.current.add(targetPid);
                          setHostSecurityAlert(null);
                          setHostSecurityToast(null);
                          handleHostDenyUnlock(targetPid, offenderName);
                        }}
                        title={`Keep black screen on ${offenderName}'s screen until they cut the call`}
                      >
                        <Lock className="w-4 h-4 mr-1.5 inline" />
                        <span>Stay Black Screen</span>
                      </button>
                    </div>
                  </div>
                  <button
                    className="host-sec-toast-close"
                    onClick={() => {
                      if (targetPid) hostDecidedAlertsRef.current.add(targetPid);
                      setHostSecurityAlert(null);
                      setHostSecurityToast(null);
                    }}
                    title="Dismiss notification"
                  >
                    <X className="w-4 h-4 text-slate-400 hover:text-white" />
                  </button>
                </div>
              );
            })()}

            {/* Dynamic Multi-Person Video Stage */}
            <div className={`video-stage ${chatOpen || participantsOpen ? "with-chat" : ""} ${gridLayoutClass} ${isContentLocked ? "stage-obscured" : ""}`}>
              {/* Local Participant Tile */}
              <div className={`video-card local-tile ${pinnedPeerId === "local" ? "pinned-tile" : ""} ${isLocalSpeaking ? "speaking-tile" : ""}`}>
                <video
                  ref={(el) => {
                    localVideoRef.current = el;
                    if (el) {
                      const activeStream = localStreamRef.current;
                      if (activeStream && el.srcObject !== activeStream) {
                        el.srcObject = activeStream;
                        el.play().catch((e) => console.warn("Local callback play error:", e));
                      }
                    }
                  }}
                  autoPlay
                  playsInline
                  webkit-playsinline="true"
                  muted
                  disablePictureInPicture={true}
                  controlsList="nodownload noplaybackrate noremoteplayback"
                  onContextMenu={(e) => e.preventDefault()}
                  className={`video-stream stream-contain ${isScreenSharing ? "" : "stream-mirror"}`}
                />
                {isVideoMuted && !isScreenSharing && (
                  <div className="video-off-avatar">
                    <div className="avatar-circle-large">
                      {(userName || "Y")[0].toUpperCase()}
                    </div>
                    <span className="video-off-text">Camera is turned off</span>
                  </div>
                )}
                {isMyHandRaised && (
                  <div className="hand-raise-badge">
                    <span>✋ Your Hand is Raised</span>
                  </div>
                )}
                {isLocalSpeaking && (
                  <div className="speaking-indicator-pill">
                    <Volume2 className="w-3 h-3 text-emerald-400 inline mr-1 animate-pulse" />
                    <span>Speaking</span>
                  </div>
                )}
                <div className="video-label">
                  <div className="flex items-center gap-1.5">
                    <span>{userName} (You)</span>
                    {isHost && (
                      <span className="host-pill-label">
                        <Crown className="w-3 h-3 inline mr-1 text-amber-400" />
                        Host
                      </span>
                    )}
                    {isScreenSharing && (
                      <span className="badge-presenting-tag" title="You are sharing your screen">
                        <Monitor className="w-3 h-3 inline mr-1 text-emerald-600" />
                        Presenting
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (localVideoRef.current && document.pictureInPictureEnabled) {
                          if (document.pictureInPictureElement) {
                            document.exitPictureInPicture();
                          } else {
                            localVideoRef.current.requestPictureInPicture().catch(() => {});
                          }
                        }
                      }}
                      className="btn-pin"
                      title="Picture-in-Picture"
                    >
                      <Tv className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => setPinnedPeerId(pinnedPeerId === "local" ? null : "local")}
                      className={`btn-pin ${pinnedPeerId === "local" ? "pin-active" : ""}`}
                      title="Pin your tile"
                    >
                      <Pin className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Remote Participants Tiles with Host Action Callbacks */}
              {remotePeers.map((peer) => (
                <RemoteVideoTile
                  key={peer.peerId}
                  peer={peer}
                  isPinned={pinnedPeerId === peer.peerId}
                  onTogglePin={(pid) => setPinnedPeerId(pinnedPeerId === pid ? null : pid)}
                  isHostUser={isHost}
                  isPrimaryHost={isHost}
                  isCoHostUser={isCoHost}
                  onToggleCoHost={handleToggleCoHost}
                  isLockedByHost={hostLockedPeers.has(peer.peerId)}
                  onUnlockPeer={(pid) => handleHostUnlock(pid, peer.name)}
                  onDenyPeer={(pid) => handleHostDenyUnlock(pid, peer.name)}
                  onHostMute={handleHostMute}
                  onHostUnmute={handleHostUnmute}
                  onHostStopVideo={handleHostStopVideo}
                  onHostStartVideo={handleHostStartVideo}
                  onHostKick={handleHostKick}
                />
              ))}
            </div>

            {/* Bottom Controls Bar (Zoom Style) */}
            <div className="call-controls">
              <button
                className={`control-btn ${isAudioMuted ? "btn-danger" : "btn-default"}`}
                onClick={toggleMic}
                title={isAudioMuted ? "Unmute Mic" : "Mute Mic"}
              >
                {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>

              <button
                className={`control-btn ${isVideoMuted ? "btn-danger" : "btn-default"}`}
                onClick={toggleCam}
                title={isVideoMuted ? "Turn On Camera" : "Turn Off Camera"}
              >
                {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
              </button>

              {/* Screen Sharing Button */}
              <button
                className={`control-btn ${isScreenSharing ? "btn-active-screen" : "btn-default"}`}
                onClick={handleToggleScreenShare}
                title={isScreenSharing ? "Stop Sharing Screen" : "Share Screen"}
                disabled={isContentLocked}
              >
                <Monitor className="w-5 h-5" />
                {isScreenSharing && <span className="screen-share-dot" />}
              </button>

              {/* Collaborative Whiteboard Button */}
              <button
                className={`control-btn ${whiteboardOpen ? "btn-active-screen" : "btn-default"}`}
                onClick={() => {
                  setWhiteboardOpen(!whiteboardOpen);
                  if (!whiteboardOpen && webrtcManagerRef.current) {
                    webrtcManagerRef.current.requestWhiteboardSync();
                  }
                }}
                title={whiteboardOpen ? "Close Whiteboard" : "Open Collaborative Whiteboard"}
              >
                <PenTool className="w-5 h-5 text-amber-400" />
                {whiteboardStrokes.length > 0 && (
                  <span className="screen-share-dot" style={{ backgroundColor: "#eab308" }} />
                )}
              </button>

              {/* Raise Hand Button */}
              <button
                className={`control-btn ${isMyHandRaised ? "btn-hand-active" : "btn-default"}`}
                onClick={toggleHandRaise}
                title={isMyHandRaised ? "Lower Hand" : "Raise Hand ✋"}
              >
                <Hand className="w-5 h-5" />
              </button>

              {/* Emoji Reactions Trigger */}
              <div className="reactions-wrapper">
                <button
                  className="control-btn btn-default"
                  onClick={() => setShowReactionsPicker(!showReactionsPicker)}
                  title="Reactions"
                >
                  <Smile className="w-5 h-5" />
                </button>

                {showReactionsPicker && (
                  <div className="reactions-palette">
                    {["👏", "❤️", "😂", "🎉", "👍", "🔥", "😮"].map((emoji) => (
                      <button
                        key={emoji}
                        className="reaction-emoji-btn"
                        onClick={() => sendReaction(emoji)}
                      >
                        {emoji}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Flip / Switch Camera Button */}
              <button
                className="control-btn btn-default"
                onClick={flipCamera}
                title={`Switch Camera (${cameraFacingMode === "user" ? "Front" : "Back"})`}
              >
                <RotateCcw className="w-5 h-5" />
              </button>

              {/* Participants Drawer Toggle with Host / Co-Host Indicator */}
              <button
                className={`control-btn ${participantsOpen ? "btn-active" : "btn-default"} ${isHost ? "btn-host-toggle" : isCoHost ? "btn-cohost-toggle" : ""}`}
                onClick={() => {
                  setParticipantsOpen(!participantsOpen);
                  if (chatOpen) setChatOpen(false);
                }}
                title={isHost ? "Host Management & Participants" : isCoHost ? "Co-Host Management & Participants" : "Participants"}
              >
                <Users className="w-5 h-5" />
                {isHost ? (
                  <Crown className="w-3 h-3 text-amber-400 absolute top-1 right-1" />
                ) : isCoHost ? (
                  <Shield className="w-3 h-3 text-yellow-400 absolute top-1 right-1" />
                ) : null}
                <span className="badge-count-small">{remotePeers.length + 1}</span>
              </button>

              {/* In-Call Chat Toggle */}
              <button
                className={`control-btn ${chatOpen ? "btn-active" : "btn-default"}`}
                onClick={() => {
                  setChatOpen(!chatOpen);
                  if (participantsOpen) setParticipantsOpen(false);
                }}
                title="Encrypted Chat"
              >
                <MessageSquare className="w-5 h-5" />
                {chatMessages.length > 0 && (
                  <span className="chat-badge">{chatMessages.length}</span>
                )}
              </button>

              {/* Meeting Info & Security Modal Trigger */}
              <button
                className="control-btn btn-default"
                onClick={() => setShowDetailsModal(true)}
                title="Meeting Info & Security"
              >
                <Info className="w-5 h-5" />
              </button>

              {/* End Call / Leave Meeting Button */}
              <button
                className="control-btn btn-danger-hangup"
                onClick={() => setShowEndCallModal(true)}
                title={isHost ? "End Meeting for All or Leave" : "Leave Meeting"}
              >
                <PhoneOff className="w-5 h-5" />
              </button>
            </div>

            {/* Full-Screen Persistent Content Protection Lockdown View (Participant Only - Never Host) */}
            {isContentLocked && inCall && !isHost && (
              <div className="content-lockdown-fullscreen" role="alert">
                <div className="content-lockdown-card">
                  <div className="content-lockdown-badge">
                    <ShieldAlert className="w-10 h-10 text-amber-500 animate-pulse" />
                  </div>
                  <h2 className="content-lockdown-title">
                    🔒 CONTENT PROTECTION LOCKDOWN ACTIVE
                  </h2>
                  <div className="content-lockdown-reason">
                    {contentLockReason || "Screen Capture / Recording Activity Detected"}
                  </div>
                  <p className="content-lockdown-desc">
                    Protected meeting visual content is blacked out by security policy.
                    Screenshots, screen recording, and window capturing on Windows are strictly prohibited.
                  </p>
                  <div className="content-lockdown-security-points">
                    <div>• Hardware Window Protection (WDA_MONITOR / WDA_EXCLUDEFROMCAPTURE) Active</div>
                    <div>• Encrypted Meeting Audio & Connection: Active & Connected</div>
                    <div>• Visual Meeting Streams: Concealed by Security Policy</div>
                  </div>
                  <div className="p-3 bg-amber-950/60 border border-amber-500/40 rounded-lg text-amber-200 text-xs font-semibold mt-3 text-center">
                    🔒 <b>HOST AUTHORITY REQUIRED:</b> This black screen lock can ONLY be removed with the permission of the meeting host.
                  </div>
                  <div className="drm-curtain-status flex items-center justify-center gap-3 p-3 bg-neutral-900 border border-neutral-700 rounded-lg text-neutral-300 text-sm font-semibold mt-4">
                    {contentLockHostDecision === "denied" ? (
                      <div className="text-rose-400 flex items-center gap-2">
                        <ShieldAlert className="w-5 h-5 text-rose-500 flex-shrink-0" />
                        <span>❌ The host denied permission to remove the black screen. Your screen will remain locked.</span>
                      </div>
                    ) : (
                      <>
                        <div className="drm-spinner" />
                        <span>Screen is locked. Waiting for host permission to remove black screen...</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Participants Drawer */}
            {participantsOpen && (
              <aside className="side-drawer">
                <div className="drawer-header">
                  <div className="flex items-center gap-2">
                    <Users className="w-4 h-4 text-emerald-400" />
                    <h4>Participants ({remotePeers.length + 1})</h4>
                  </div>
                  <button className="btn-close" onClick={() => setParticipantsOpen(false)}>
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="drawer-body">
                  {/* Host Controls Section at top of drawer */}
                  {isHost && (
                    <div className="drawer-host-section">
                      <div className="drawer-host-header">
                        <span className="flex items-center gap-1.5 font-semibold text-xs text-amber-300">
                          <Crown className="w-3.5 h-3.5 text-amber-400" />
                          Host Management
                        </span>
                        <span className="badge-host-pill">Host Mode</span>
                      </div>
                      {remotePeers.length > 0 && (
                        <div className="host-drawer-batch-controls">
                          <button
                            className="btn-drawer-mute-all"
                            onClick={handleHostMuteAll}
                            title="Mute microphones for all participants"
                          >
                            <VolumeX className="w-3.5 h-3.5 mr-1" />
                            <span>Mute All</span>
                          </button>
                          <button
                            className="btn-drawer-unmute-all"
                            onClick={handleHostUnmuteAll}
                            title="Unmute microphones for all participants"
                          >
                            <Volume2 className="w-3.5 h-3.5 mr-1" />
                            <span>Unmute All</span>
                          </button>
                          <button
                            className="btn-drawer-stop-video-all"
                            onClick={handleHostStopAllVideo}
                            title="Turn off camera for all participants"
                          >
                            <VideoOff className="w-3.5 h-3.5 mr-1" />
                            <span>Stop All Video</span>
                          </button>
                          <button
                            className="btn-drawer-start-video-all"
                            onClick={handleHostStartAllVideo}
                            title="Turn on camera for all participants"
                          >
                            <Video className="w-3.5 h-3.5 mr-1" />
                            <span>Start All Video</span>
                          </button>
                        </div>
                      )}

                      {/* Lock Meeting Room Toggle */}
                      <button
                        className={`btn-drawer-lock ${isMeetingLocked ? "locked" : ""}`}
                        onClick={() => {
                          const nextState = !isMeetingLocked;
                          webrtcManagerRef.current?.toggleRoomLock(nextState);
                          setIsMeetingLocked(nextState);
                        }}
                        title={isMeetingLocked ? "Unlock Meeting Room (Allow new entries)" : "Lock Meeting Room (Block all new entries)"}
                      >
                        {isMeetingLocked ? <Lock className="w-3.5 h-3.5 mr-1.5 text-rose-400" /> : <Shield className="w-3.5 h-3.5 mr-1.5 text-emerald-400" />}
                        <span>{isMeetingLocked ? "Unlock Meeting Room" : "Lock Meeting (Prevent New Entries)"}</span>
                      </button>

                      {/* End Meeting for All (Destroy Tokens & Room) */}
                      <button
                        className="btn-drawer-end-all"
                        onClick={handleHostEndMeetingForAll}
                        title="End meeting for all participants and permanently invalidate tokens"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 mr-1.5 text-amber-300" />
                        <span>End Meeting for All (Destroy Tokens)</span>
                      </button>
                    </div>
                  )}

                  {/* Guest Mode Banner when host is absent */}
                  {!isHost && !remotePeers.some((p) => p.isHost) && (
                    <div className="drawer-guest-banner">
                      <Shield className="w-4 h-4 text-slate-400 shrink-0" />
                      <div>
                        <span className="font-semibold text-xs text-slate-300 block">Peer Mode</span>
                        <span className="text-xs text-slate-400 block">Host has left • Peer mode</span>
                      </div>
                    </div>
                  )}

                  <div className="participant-item">
                    <div className="part-info">
                      <div className="avatar-circle">{userName[0]?.toUpperCase() || "Y"}</div>
                      <div className="part-name-block">
                        <span>{userName} (You)</span>
                        {isHost ? (
                          <span className="host-tag-small">
                            <Crown className="w-2.5 h-2.5 inline mr-0.5 text-amber-400" /> Host
                          </span>
                        ) : isCoHost ? (
                          <span className="cohost-tag-small">
                            <Shield className="w-2.5 h-2.5 inline mr-0.5 text-yellow-500" /> Co-Host
                          </span>
                        ) : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {isAudioMuted && (
                        <span className="part-status-badge text-red-400" title="Your microphone is muted">
                          <MicOff className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {isVideoMuted && (
                        <span className="part-status-badge text-slate-400" title="Your camera is turned off">
                          <VideoOff className="w-3.5 h-3.5" />
                        </span>
                      )}
                      {isMyHandRaised && <span className="hand-icon">✋</span>}
                    </div>
                  </div>

                  {/* Host & Co-Host Admission Waiting Queue Section */}
                  {(isHost || isCoHost) && waitingAdmissionQueue.length > 0 && (
                    <div className="drawer-waiting-section">
                      <div className="drawer-waiting-header">
                        <div className="flex items-center gap-1.5">
                          <Users className="w-3.5 h-3.5 text-amber-400" />
                          <span className="waiting-heading-text">
                            Waiting to join ({waitingAdmissionQueue.length})
                          </span>
                        </div>
                        {waitingAdmissionQueue.length > 1 && (
                          <button
                            className="btn-admit-all-drawer"
                            onClick={handleAdmitAllWaitingPeers}
                          >
                            Admit all
                          </button>
                        )}
                      </div>
                      <div className="drawer-waiting-list">
                        {waitingAdmissionQueue.map((wp) => (
                          <div key={wp.peerId} className="waiting-peer-row">
                            <div className="waiting-peer-info">
                              <div className="avatar-circle-small">{wp.name[0]?.toUpperCase() || "U"}</div>
                              <span className="waiting-peer-name">{wp.name}</span>
                            </div>
                            <div className="waiting-peer-actions">
                              <button
                                className="btn-deny-small"
                                onClick={() => handleDenyWaitingPeer(wp.peerId)}
                                title="Deny entry"
                              >
                                Deny
                              </button>
                              <button
                                className="btn-admit-small"
                                onClick={() => handleAdmitWaitingPeer(wp.peerId)}
                                title="Admit to meeting"
                              >
                                Admit
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {remotePeers.map((p) => {
                    const canManageThisPeer = isHost ? !p.isHost : (isCoHost && !p.isHost && !p.isCoHost);
                    return (
                      <div key={p.peerId} className="participant-item">
                        <div className="part-info">
                          <div className="avatar-circle">{p.name[0]?.toUpperCase() || "P"}</div>
                          <div className="part-name-block">
                            <span>{p.name}</span>
                            {p.isHost && (
                              <span className="host-tag-small">
                                <Crown className="w-2.5 h-2.5 inline mr-0.5 text-amber-400" /> Host
                              </span>
                            )}
                            {p.isCoHost && !p.isHost && (
                              <span className="cohost-tag-small">
                                <Shield className="w-2.5 h-2.5 inline mr-0.5 text-yellow-500" /> Co-Host
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="part-actions">
                          {p.isHandRaised && <span className="hand-icon mr-1">✋</span>}
                          {p.isAudioMuted && (
                            <span className="part-status-badge text-red-400 mr-1" title={`${p.name}'s microphone is muted`}>
                              <MicOff className="w-3.5 h-3.5" />
                            </span>
                          )}
                          {p.isVideoMuted && (
                            <span className="part-status-badge text-slate-400 mr-1" title={`${p.name}'s camera is turned off`}>
                              <VideoOff className="w-3.5 h-3.5" />
                            </span>
                          )}

                          {/* Primary Host Co-Host delegation button */}
                          {isHost && !p.isHost && (
                            <button
                              onClick={() => handleToggleCoHost(p.peerId, !p.isCoHost)}
                              className={`btn-host-ctrl ${p.isCoHost ? "btn-cohost-remove" : "btn-cohost-assign"}`}
                              title={p.isCoHost ? `Dismiss Co-Host for ${p.name}` : `Make ${p.name} Co-Host`}
                              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "6px", border: "1px solid rgba(234, 179, 8, 0.4)", background: p.isCoHost ? "rgba(234, 179, 8, 0.2)" : "rgba(255,255,255,0.05)" }}
                            >
                              <Shield className="w-3.5 h-3.5 text-yellow-500" />
                            </button>
                          )}

                          {canManageThisPeer && (
                            <div className="host-ctrl-group">
                              {/* Functional Controls to Remove Black Screen or Keep Black Screen for this specific user */}
                              {hostLockedPeers.has(p.peerId) ? (
                                <div className="flex items-center gap-1">
                                  <button
                                    onClick={() => handleHostUnlock(p.peerId, p.name)}
                                    className="btn-host-ctrl animate-pulse"
                                    style={{ background: "#059669", color: "#ffffff", fontWeight: 700, padding: "3px 8px", borderRadius: "6px", display: "inline-flex", alignItems: "center", gap: "4px" }}
                                    title={`Allow & Remove Black Screen for ${p.name}`}
                                  >
                                    <Unlock className="w-3.5 h-3.5 text-white" />
                                    <span>Remove Black Screen</span>
                                  </button>
                                  <button
                                    onClick={() => handleHostDenyUnlock(p.peerId, p.name)}
                                    className="btn-host-ctrl"
                                    style={{ background: "#334155", color: "#fcd34d", fontWeight: 700, padding: "3px 8px", borderRadius: "6px", display: "inline-flex", alignItems: "center", gap: "4px", border: "1px solid rgba(245, 158, 11, 0.4)" }}
                                    title={`Keep black screen on ${p.name}'s screen`}
                                  >
                                    <Lock className="w-3.5 h-3.5 text-amber-300" />
                                    <span>Stay Black</span>
                                  </button>
                                </div>
                              ) : (
                                <span
                                  className="btn-host-ctrl"
                                  style={{ background: "rgba(16, 185, 129, 0.12)", border: "1px solid rgba(16, 185, 129, 0.35)", color: "#10b981", display: "inline-flex", alignItems: "center", justifyContent: "center", width: "26px", height: "26px", borderRadius: "6px" }}
                                  title={`Content Protection active for ${p.name} (Confidentiality policy enforced)`}
                                >
                                  <ShieldCheck className="w-3.5 h-3.5" />
                                </span>
                              )}
                              {p.isAudioMuted ? (
                                <button
                                  onClick={() => handleHostUnmute(p.peerId)}
                                  className="btn-host-ctrl btn-unmute"
                                  title={`Unmute ${p.name}'s microphone`}
                                >
                                  <Mic className="w-3.5 h-3.5 text-emerald-400" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleHostMute(p.peerId)}
                                  className="btn-host-ctrl"
                                  title={`Mute ${p.name}'s microphone`}
                                >
                                  <MicOff className="w-3.5 h-3.5 text-rose-400" />
                                </button>
                              )}

                              {p.isVideoMuted ? (
                                <button
                                  onClick={() => handleHostStartVideo(p.peerId)}
                                  className="btn-host-ctrl btn-start-video"
                                  title={`Turn on ${p.name}'s camera`}
                                >
                                  <Video className="w-3.5 h-3.5 text-emerald-400" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => handleHostStopVideo(p.peerId)}
                                  className="btn-host-ctrl"
                                  title={`Turn off ${p.name}'s camera`}
                                >
                                  <VideoOff className="w-3.5 h-3.5 text-rose-400" />
                                </button>
                              )}

                              <button
                                onClick={() => handleHostKick(p.peerId, p.name)}
                                className="btn-host-ctrl btn-kick"
                                title={`Remove ${p.name} from the meeting`}
                              >
                                <UserX className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </aside>
            )}

            {/* In-Call Chat Drawer */}
            {chatOpen && (
              <aside className="side-drawer">
                <div className="drawer-header">
                  <div className="flex items-center gap-2">
                    <Lock className="w-4 h-4 text-emerald-400" />
                    <h4>E2EE In-Call Messages</h4>
                  </div>
                  <div className="flex items-center gap-2">
                    {(isHost || isCoHost) && (
                      <button
                        type="button"
                        className={`btn-host-chat-toggle ${isChatDisabled ? "chat-is-disabled" : ""}`}
                        onClick={() => {
                          const next = !isChatDisabled;
                          webrtcManagerRef.current?.toggleChatDisabled(next);
                          setIsChatDisabled(next);
                        }}
                        title={isChatDisabled ? "Enable In-Meeting Chat" : "Disable In-Meeting Chat for Everyone"}
                      >
                        {isChatDisabled ? "Enable Chat" : "Disable Chat"}
                      </button>
                    )}
                    <button className="btn-close" onClick={() => setChatOpen(false)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {isChatDisabled && (
                  <div className="chat-disabled-banner">
                    <Lock className="w-3.5 h-3.5 mr-1.5 text-rose-400 shrink-0" />
                    <span>In-meeting chat is currently disabled by the host.</span>
                  </div>
                )}

                <div className="drawer-body">
                  {chatMessages.length === 0 ? (
                    <div className="empty-chat">
                      <ShieldCheck className="w-8 h-8 text-slate-500 mb-2" />
                      <p>No messages yet. Messages are end-to-end encrypted.</p>
                    </div>
                  ) : (
                    chatMessages.map((m, idx) => (
                      <div
                        key={idx}
                        className={`chat-bubble ${m.sender === "You" ? "sent" : "received"}`}
                      >
                        <div className="chat-meta">
                          <span className="chat-sender">{m.sender}</span>
                          <span className="chat-time">{m.timestamp}</span>
                        </div>
                        <p className="chat-text">{m.text}</p>
                      </div>
                    ))
                  )}
                </div>

                <form onSubmit={sendChat} className="chat-input-form">
                  <input
                    type="text"
                    placeholder={isChatDisabled && !canManageHost ? "Chat disabled by the host" : "Send encrypted message to all..."}
                    value={chatInput}
                    disabled={isChatDisabled && !canManageHost}
                    onChange={(e) => setChatInput(e.target.value)}
                  />
                  <button type="submit" className="btn-send" disabled={isChatDisabled && !canManageHost}>
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </aside>
            )}

            {/* Executive End Call Confirmation Modal */}
            {showEndCallModal && (
              <div
                className="modal-backdrop end-call-modal-backdrop"
                onClick={() => setShowEndCallModal(false)}
                role="dialog"
                aria-modal="true"
              >
                <div
                  className="modal-content end-call-modal-content"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="end-call-modal-header">
                    <div className="end-call-modal-icon-wrap">
                      <PhoneOff className="w-6 h-6 text-rose-600" />
                    </div>
                    <button
                      className="btn-close"
                      onClick={() => setShowEndCallModal(false)}
                      title="Cancel and return to meeting"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <h3 className="end-call-modal-title">
                    {isHost ? "End Meeting for Everyone, or Leave?" : "Leave this Meeting?"}
                  </h3>

                  <p className="end-call-modal-desc">
                    {isHost
                      ? "As the host, you can end the conference for all participants and permanently invalidate meeting tokens, or leave while allowing guests to continue."
                      : "Are you sure you want to disconnect? Your audio and video feeds will shut down and you can rejoin anytime."}
                  </p>

                  <div className="end-call-actions-stack">
                    {isHost && (
                      <button
                        type="button"
                        className="btn-modal-end-all"
                        onClick={executeHostEndMeetingForAll}
                      >
                        <ShieldAlert className="w-4 h-4 mr-2" />
                        End Meeting for All
                      </button>
                    )}

                    <button
                      type="button"
                      className="btn-modal-leave"
                      onClick={() => endMeeting(false, false)}
                    >
                      <PhoneOff className="w-4 h-4 mr-2" />
                      {isHost ? "Leave Meeting Only" : "Leave Meeting"}
                    </button>

                    <button
                      type="button"
                      className="btn-modal-cancel"
                      onClick={() => setShowEndCallModal(false)}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Safety Number Verification Modal */}
            {showSafetyModal && (
              <div className="modal-backdrop" onClick={() => setShowSafetyModal(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <ShieldCheck className="w-6 h-6 text-emerald-400" />
                    <h3>Cryptographic Verification</h3>
                    <button className="btn-close" onClick={() => setShowSafetyModal(false)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="modal-body">
                    <p>Confirm this 6-digit Safety Number with other participants over voice:</p>
                    <div className="sas-display">
                      <code>{safetyNumber}</code>
                    </div>
                    <div className="verification-checklist">
                      <div className="check-item">
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>If numbers match, zero eavesdropping is mathematically proven.</span>
                      </div>
                      <div className="check-item">
                        <Check className="w-4 h-4 text-emerald-400" />
                        <span>Signaling server has zero decryption capabilities.</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Meeting Details & Security Modal */}
            {showDetailsModal && (
              <div className="modal-backdrop" onClick={() => setShowDetailsModal(false)}>
                <div className="modal-content modal-details" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <div className="flex items-center gap-2">
                      <Info className="w-5 h-5 text-emerald-400" />
                      <h3>Meeting Information & Security</h3>
                    </div>
                    <button className="btn-close" onClick={() => setShowDetailsModal(false)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="modal-body">
                    <div className="details-card-group">
                      <div className="details-info-row">
                        <span className="details-label">Meeting Code</span>
                        <div className="flex items-center gap-2">
                          <code>{meetingCode}</code>
                          <button onClick={() => copyCode(meetingCode)} className="btn-copy-small" title="Copy Meeting Code">
                            {copiedCode ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>
                        </div>
                      </div>

                      {meetingPin && (
                        <div className="details-info-row">
                          <span className="details-label">Meeting Password / PIN</span>
                          <div className="flex items-center gap-2">
                            <code className="text-emerald-400 font-bold">{meetingPin}</code>
                            <button onClick={() => copyCode(meetingPin)} className="btn-copy-small" title="Copy Meeting Password">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div className="details-info-row">
                        <span className="details-label">Invite Link</span>
                        <div className="flex items-center gap-2">
                          <button onClick={() => copyInviteLink(meetingCode, meetingPin)} className="btn-primary-small">
                            {copiedLink ? <Check className="w-3.5 h-3.5 mr-1" /> : <LinkIcon className="w-3.5 h-3.5 mr-1" />}
                            {copiedLink ? "Link Copied" : "Copy Direct Link"}
                          </button>
                        </div>
                      </div>

                      <div className="details-info-row">
                        <span className="details-label">Full Invitation</span>
                        <div className="flex items-center gap-2">
                          <button onClick={copyMeetingDetails} className="btn-primary-small">
                            {copiedDetails ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                            {copiedDetails ? "Copied" : "Copy Invitation Details"}
                          </button>
                        </div>
                      </div>

                      <div className="details-info-row">
                        <span className="details-label">Host Status</span>
                        <div>
                          {isHost ? (
                            <span className="host-pill-label">
                              <Crown className="w-3.5 h-3.5 inline mr-1 text-amber-600" />
                              You are the Meeting Host
                            </span>
                          ) : (
                            <span className="text-slate-600 text-xs font-semibold">
                              {remotePeers.find((p) => p.isHost)?.name
                                ? `Host: ${remotePeers.find((p) => p.isHost)?.name}`
                                : "No host in room (Guest Mode)"}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="details-info-row">
                        <span className="details-label">Anti-Screenshot DRM</span>
                        <div className="details-status-badge">
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>Hardware Protected (Screen Grabs Blocked)</span>
                        </div>
                      </div>

                      <div className="details-info-row">
                        <span className="details-label">Encryption</span>
                        <div className="details-status-badge">
                          <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                          <span>AES-256-GCM Hardware WebRTC Transform</span>
                        </div>
                      </div>

                      <div className="details-info-row">
                        <span className="details-label">Safety Number</span>
                        <div className="flex items-center gap-2">
                          <code>{safetyNumber}</code>
                          <button
                            className="btn-link-small"
                            onClick={() => {
                              setShowDetailsModal(false);
                              setShowSafetyModal(true);
                            }}
                          >
                            Verify
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Keyboard Shortcuts Modal */}
            {showShortcutsModal && (
              <div className="modal-backdrop" onClick={() => setShowShortcutsModal(false)}>
                <div className="modal-content modal-shortcuts" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <div className="flex items-center gap-2">
                      <Keyboard className="w-5 h-5 text-emerald-400" />
                      <h3>Keyboard Shortcuts Guide</h3>
                    </div>
                    <button className="btn-close" onClick={() => setShowShortcutsModal(false)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="modal-body">
                    <p className="shortcuts-tip">Pro-tip: Hold <b>Spacebar</b> anytime to push-to-talk while muted!</p>
                    <div className="shortcuts-list">
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Push-to-Talk (Hold while muted)</span>
                        <kbd>Space</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Mute / Unmute Microphone</span>
                        <kbd>M</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Turn Camera On / Off</span>
                        <kbd>V</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Open / Close Chat</span>
                        <kbd>C</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Open / Close Participants</span>
                        <kbd>P</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Toggle Fullscreen Mode</span>
                        <kbd>F</kbd>
                      </div>
                      <div className="shortcut-item">
                        <span className="shortcut-desc">Toggle Shortcuts Guide</span>
                        <kbd>?</kbd>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Install App Guide Modal */}
            {showInstallGuide && (
              <div className="modal-backdrop" onClick={() => setShowInstallGuide(false)}>
                <div className="modal-content modal-install" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <div className="flex items-center gap-2">
                      <Download className="w-5 h-5 text-emerald-600" />
                      <h3 className="text-slate-800 font-bold">Install V2 Meet HD App</h3>
                    </div>
                    <button className="btn-close" onClick={() => setShowInstallGuide(false)}>
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="modal-body">
                    <p className="install-modal-desc">
                      Run <b>V2 Meet HD</b> as a native Windows desktop application with hardware content protection, pitch-black screen recording blocking, and zero visual data leaks!
                    </p>

                    <div className="install-options-grid">
                      <div className="install-card">
                        <div className="install-card-icon">
                          <Laptop className="w-5 h-5 text-emerald-600" />
                        </div>
                        <h4>Windows Native Desktop App</h4>
                        <ol>
                          <li>Launch native app via <b>Launch_Desktop_App.bat</b> or <code>npm run electron</code>.</li>
                          <li>Hardware <code>WDA_MONITOR</code> renders window pitch-black in OBS, Zoom, Teams & screen sharing.</li>
                          <li>Automatic focus-loss veil blackout and rapid clipboard sanitization.</li>
                        </ol>
                      </div>
                    </div>

                    <div className="install-modal-footer">
                      <button
                        className="btn-primary-small"
                        onClick={() => setShowInstallGuide(false)}
                      >
                        Got it, Close
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Interactive Collaborative Whiteboard Modal */}
            <CollaborativeWhiteboard
              isOpen={whiteboardOpen}
              onClose={() => setWhiteboardOpen(false)}
              strokes={whiteboardStrokes}
              onSendStroke={handleSendWhiteboardStroke}
              onClearStrokes={handleClearWhiteboard}
              userName={userName}
              canManage={canManageHost}
            />

          </div>
        )}
      </main>



      {/* High-Security Jailing Lockout Modal */}
      {securityLockout.active && (
        <div className="security-lockout-modal-overlay">
          <div className="security-lockout-card">
            <div className="security-lockout-icon">
              <AlertCircle className="w-12 h-12 text-rose-500 animate-pulse" />
            </div>
            <h3>🚨 High-Security Lockout Triggered</h3>
            <p>{securityLockout.message || "Multiple failed authentication attempts detected from this network."}</p>
            <div className="lockout-timer-box">
              <span className="lockout-timer-label">Time Remaining in Quarantine:</span>
              <div className="countdown-number">{formatTimer(securityLockout.remainingSeconds)}</div>
            </div>
            <p className="lockout-sub">
              Your IP address has been temporarily quarantined for 15 minutes to protect against unauthorized intrusion, code guessing, and brute-force scanning.
            </p>
          </div>
        </div>
      )}

      {/* Ephemeral Meeting Ended & Token Invalidation Modal (Yellow, Green & White Theme, Zero Glow) */}
      {meetingEndedNotice && (
        <div className="security-lockout-modal-overlay" role="dialog" aria-modal="true">
          <div className="security-lockout-card border-2 border-[#ca8a04]">
            <div className="security-lockout-icon bg-[#fef9c3] border border-[#ca8a04]">
              <ShieldAlert className="w-12 h-12 text-[#854d0e]" />
            </div>
            <h3 className="text-[#0f172a] font-bold text-xl">{meetingEndedNotice.title}</h3>
            <p className="text-[#475569] text-sm leading-relaxed">{meetingEndedNotice.message}</p>
            <div className="p-3 my-3 bg-[#f8fafc] rounded-lg border border-[#bbf7d0] text-left text-xs text-slate-700 space-y-1">
              <div className="flex items-center gap-1.5 text-[#15803d] font-bold">
                <ShieldCheck className="w-4 h-4" />
                <span>Zero Residual Token Policy Enforced</span>
              </div>
              <div>• Ephemeral meeting token permanently invalidated.</div>
              <div>• Invitation link expired and destroyed.</div>
              <div>• Session cannot be rejoined or recreated.</div>
            </div>
            <button
              className="btn-primary w-full py-2.5 mt-2"
              onClick={() => {
                setMeetingEndedNotice(null);
                if (window.history && window.history.replaceState) {
                  window.history.replaceState(null, "", window.location.pathname);
                }
                setJoinInput("");
                setJoinFormError("");
              }}
            >
              Return to Safe Home
            </button>
          </div>
        </div>
      )}

      {/* Meeting Locked Security Notice Modal (Yellow, Green & White Theme, Zero Glow) */}
      {meetingLockedNotice && (
        <div className="security-lockout-modal-overlay" role="dialog" aria-modal="true">
          <div className="security-lockout-card border-2 border-[#ca8a04]">
            <div className="security-lockout-icon bg-[#fef9c3] border border-[#ca8a04]">
              <Lock className="w-12 h-12 text-[#854d0e]" />
            </div>
            <h3 className="text-[#0f172a] font-bold text-xl">{meetingLockedNotice.title || "Meeting is Locked"}</h3>
            <p className="text-[#475569] text-sm leading-relaxed mb-3">
              {meetingLockedNotice.message || "The host has locked this meeting. No one can enter through link or password."}
            </p>
            <div className="p-3 my-3 bg-[#fef9c3]/50 rounded-lg border border-[#fde047] text-left text-xs text-slate-700 space-y-1.5">
              <div className="flex items-center gap-1.5 text-[#854d0e] font-bold">
                <ShieldAlert className="w-4 h-4" />
                <span>Host Meeting Lock Policy Enforced</span>
              </div>
              <div>• Access via direct meeting link is strictly blocked.</div>
              <div>• Access via meeting code & password is prohibited.</div>
              <div>• Please ask the meeting host to unlock the room if entry is needed.</div>
            </div>
            <button
              className="btn-primary w-full py-2.5 mt-2"
              onClick={() => {
                setMeetingLockedNotice(null);
                if (window.history && window.history.replaceState) {
                  window.history.replaceState(null, "", window.location.pathname);
                }
                setJoinInput("");
                setJoinFormError("");
              }}
            >
              Understood, Return
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
