/**
 * V2 Multi-Party Ultra-HD WebRTC Mesh Manager (Zoom-like Architecture)
 * 
 * Features:
 * - Proper SFrame-style header preservation for Encoded Transform (prevents decoder black screen)
 * - Dynamic Screen Sharing track swapping across all peers
 * - Targeted SDP negotiation & Candidate buffering per peer
 * - Ultra-HD 1080p Bitrate allocation
 * - Real-time DataChannel (Chat, Reactions, Raise Hand)
 */

import { encryptChatMessage, decryptChatMessage } from "./crypto";

const VIDEO_HEADER_SIZE = 10; // Preserves H.264/VP8 NAL headers so hardware decoder doesn't stall

export function getAdaptiveBitrate(peerCount = 1, isScreenSharing = false) {
  if (isScreenSharing) {
    return { bitrateBps: 2000000, bitrateKbps: 2000, scaleResolutionDownBy: 1.0, maxFramerate: 30 };
  }
  if (peerCount <= 4) {
    return { bitrateBps: 2500000, bitrateKbps: 2500, scaleResolutionDownBy: 1.0, maxFramerate: 30 };
  } else if (peerCount <= 10) {
    return { bitrateBps: 1000000, bitrateKbps: 1000, scaleResolutionDownBy: 1.5, maxFramerate: 24 };
  } else if (peerCount <= 24) {
    return { bitrateBps: 450000, bitrateKbps: 450, scaleResolutionDownBy: 2.0, maxFramerate: 20 };
  } else {
    // 25 to 50 peers: Highly optimized lightweight stream for flawless multi-peer mesh
    return { bitrateBps: 200000, bitrateKbps: 200, scaleResolutionDownBy: 3.0, maxFramerate: 15 };
  }
}

function boostSdpBitrate(sdp, bitrateKbps = 2500) {
  let modified = sdp;
  if (!modified.includes("b=AS:")) {
    modified = modified.replace(/m=video ([0-9]+) ([A-Z/]+) ([0-9 ]+)/g, (match) => {
      return `${match}\r\nb=AS:${bitrateKbps}\r\nb=TIAS:${bitrateKbps * 1000}`;
    });
  }
  return modified;
}

export class V2MultiPartyWebRTC {
  constructor(config) {
    this.cryptoKey = config.cryptoKey;
    this.participantName = config.participantName || "Participant";
    this.onPeerStreamAdd = config.onPeerStreamAdd;       // (peerId, stream, name, isHost)
    this.onPeerStreamRemove = config.onPeerStreamRemove; // (peerId)
    this.onStatus = config.onStatus;
    this.onChatMessage = config.onChatMessage;           // (msg)
    this.onReaction = config.onReaction;                 // (emoji, peerId, name)
    this.onRaiseHand = config.onRaiseHand;               // (peerId, isRaised, name)
    this.onPeerListUpdate = config.onPeerListUpdate;     // (peersList)
    this.onPeerMediaStatus = config.onPeerMediaStatus;   // (peerId, isAudioMuted, isVideoMuted)
    this.onHostAction = config.onHostAction;             // ({ action, senderName })
    this.onHostChange = config.onHostChange;             // ({ isHost, hostPeerId, hostName })
    this.onRoomLockChange = config.onRoomLockChange;     // (isLocked, by)
    this.onRoomChatDisabled = config.onRoomChatDisabled; // (isChatDisabled, by)
    this.onDisconnect = config.onDisconnect;             // ()
    this.onError = config.onError;
    this.onWaitingRoom = config.onWaitingRoom;           // (data)
    this.onKnockRequest = config.onKnockRequest;         // ({ peerId, name })
    this.onKnockCancelled = config.onKnockCancelled;     // (peerId)
    this.onAdmissionDenied = config.onAdmissionDenied;   // (msg)
    this.onAdmitted = config.onAdmitted;                 // ()
    this.onMeetingEnded = config.onMeetingEnded;         // (msg) - Host permanently terminated meeting
    this.onScreenShareEnded = config.onScreenShareEnded; // () - User stopped sharing screen
    this.onPeerScreenShare = config.onPeerScreenShare;   // (peerId, isSharing, name) - Peer started/stopped screen share
    this.onCoHostChange = config.onCoHostChange;         // ({ targetPeerId, isCoHost, isSelfCoHost, coHosts })
    this.onWhiteboardDraw = config.onWhiteboardDraw;     // (stroke)
    this.onWhiteboardClear = config.onWhiteboardClear;   // ()
    this.onWhiteboardSync = config.onWhiteboardSync;     // (strokes)

    this.myPeerId = null;
    this.isHost = false;
    this.isCoHost = false;
    this.coHosts = new Set();
    this.hostPeerId = null;
    this.isRoomLocked = false;
    this.isChatDisabled = false;
    this.ws = null;
    this.localStream = null;
    this.screenStream = null;
    this.isScreenSharing = false;
    this.isExplicitLeave = false;
    this.e2eeActive = false;

    // Map of peerId -> { pc, stream, name, isHost, isCoHost, candidateQueue, videoSender, dataChannel }
    this.peers = new Map();
  }

  async start(localStream, roomId, signalingUrl = null, isCreator = false, creatorToken = null, pin = null, exp = null) {
    this.localStream = localStream;

    const trimmedName = (this.participantName || "").trim();
    if (!trimmedName || trimmedName.toLowerCase() === "participant") {
      if (this.onError) {
        this.onError({
          code: "NAME_REQUIRED",
          message: "A display name is mandatory to join this meeting. Please enter your name."
        });
      }
      throw new Error("NAME_REQUIRED: Display name is mandatory.");
    }

    if (!signalingUrl) {
      const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
      let host = window.location.host || "127.0.0.1:8000";
      if (window.location.port === "5173" || window.location.port === "3000") {
        host = `${window.location.hostname || "127.0.0.1"}:8000`;
      }
      signalingUrl = `${proto}//${host}/ws`;
    }

    // Check Insertable Streams support
    const testSender = RTCRtpSender.prototype;
    this.e2eeActive = typeof testSender.createEncodedStreams === "function";

    if (this.e2eeActive) {
      this.onStatus("🔒 Hardware AES-256-GCM E2EE Active (Multi-Peer Mesh)");
    } else {
      this.onStatus("Running standard DTLS-SRTP encryption (Native WebRTC).");
    }

    // Connect to Python Multi-Party WebSocket with creator verification, PIN, and ephemeral exp params
    let fullWsUrl = `${signalingUrl}/${roomId}?name=${encodeURIComponent(this.participantName)}&is_creator=${Boolean(isCreator)}`;
    if (creatorToken) {
      fullWsUrl += `&creator_token=${encodeURIComponent(creatorToken)}`;
    }
    if (pin && pin.trim()) {
      fullWsUrl += `&pin=${encodeURIComponent(pin.trim())}`;
    }
    if (exp) {
      fullWsUrl += `&exp=${encodeURIComponent(exp)}`;
    }
    this.ws = new WebSocket(fullWsUrl);

    this.ws.onopen = () => {
      this.onStatus("Connected to secure conference network. Entering room...");
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleSignalingMessage(msg);
      } catch (err) {
        console.error("Signaling message handling error:", err);
      }
    };

    this.ws.onerror = (e) => {
      console.error("Signaling WebSocket error", e);
      if (this.onError) this.onError("Signaling error. Ensure the server is online.");
    };

    this.ws.onclose = () => {
      this.onStatus("Disconnected from conference.");
      if (this.onDisconnect && !this.isExplicitLeave) {
        this.onDisconnect();
      }
    };
  }

  createPeerConnection(targetPeerId, targetName, isHost = false, isCoHost = false) {
    if (this.peers.has(targetPeerId)) {
      const p = this.peers.get(targetPeerId);
      if (isHost !== undefined) p.isHost = !!isHost;
      if (isCoHost !== undefined) p.isCoHost = !!isCoHost;
      return p;
    }

    const pcConfig = {
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" },
        { urls: "stun:stun2.l.google.com:19302" },
        { urls: "stun:stun3.l.google.com:19302" }
      ],
      sdpSemantics: "unified-plan"
    };

    if (this.e2eeActive) {
      pcConfig.encodedInsertableStreams = true;
    }

    const pc = new RTCPeerConnection(pcConfig);
    const peerObj = {
      pc,
      stream: new MediaStream(),
      name: targetName || `User-${targetPeerId.substring(0, 4)}`,
      isHost: !!isHost,
      isCoHost: !!isCoHost,
      candidateQueue: [],
      videoSender: null,
      dataChannel: null
    };

    // 1. Add active audio & video tracks
    const activeVideoTrack = (this.isScreenSharing && this.screenStream)
      ? this.screenStream.getVideoTracks()[0]
      : (this.localStream ? this.localStream.getVideoTracks()[0] : null);

    const activeAudioTrack = this.localStream ? this.localStream.getAudioTracks()[0] : null;

    if (activeAudioTrack) {
      const audioSender = pc.addTrack(activeAudioTrack, this.localStream);
      if (this.e2eeActive) {
        this.setupSenderEncryption(audioSender);
      }
    }

    if (activeVideoTrack) {
      const videoSender = pc.addTrack(activeVideoTrack, this.localStream);
      peerObj.videoSender = videoSender;
      this.applyHighBitrateParameters(videoSender);
      if (this.e2eeActive) {
        this.setupSenderEncryption(videoSender);
      }
    }

    // 2. Incoming remote tracks
    pc.ontrack = (event) => {
      if (this.e2eeActive && event.receiver) {
        this.setupReceiverDecryption(event.receiver);
      }

      if (event.streams && event.streams[0]) {
        peerObj.stream = event.streams[0];
      } else if (event.track) {
        // Ensure track is in peerObj.stream
        if (!peerObj.stream.getTracks().some((t) => t.id === event.track.id)) {
          peerObj.stream.addTrack(event.track);
        }
      }

      if (this.onPeerStreamAdd) {
        // Create a new stream wrapper containing all tracks to ensure React state re-renders video
        const freshStream = new MediaStream(peerObj.stream.getTracks());
        this.onPeerStreamAdd(targetPeerId, freshStream, peerObj.name, peerObj.isHost, peerObj.isCoHost);
      }
    };

    // 3. Candidate generation
    pc.onicecandidate = (event) => {
      if (event.candidate && this.ws && this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({
          type: "candidate",
          targetPeerId,
          candidate: event.candidate
        }));
      }
    };

    // 4. Data channel handling
    pc.ondatachannel = (event) => {
      peerObj.dataChannel = event.channel;
      this.setupDataChannel(event.channel, targetPeerId, peerObj.name);
    };

    // 5. Connection state monitoring - remove peer if connection failed or closed
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === "failed" || state === "closed") {
        this.removePeer(targetPeerId);
      }
    };

    pc.oniceconnectionstatechange = () => {
      const iceState = pc.iceConnectionState;
      if (iceState === "failed" || iceState === "closed") {
        this.removePeer(targetPeerId);
      }
    };

    this.peers.set(targetPeerId, peerObj);
    this.notifyPeerList();
    return peerObj;
  }

  removePeer(peerId) {
    if (this.peers.has(peerId)) {
      const p = this.peers.get(peerId);
      try {
        if (p.dataChannel) p.dataChannel.close();
        if (p.pc) p.pc.close();
        if (p.stream) {
          p.stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {
        // ignore close errors
      }
      this.peers.delete(peerId);
      if (this.onPeerStreamRemove) {
        this.onPeerStreamRemove(peerId);
      }
      this.notifyPeerList();
      this.adaptMeshBitrate();
    }
  }

  setupDataChannel(channel, peerId, peerName) {
    channel.onmessage = async (event) => {
      // Security Policy: Reject any binary or file sharing transfer payloads
      if (typeof event.data !== "string") {
        console.warn("Security Alert: Blocked incoming non-text binary transfer from peer:", peerId);
        return;
      }

      try {
        const decryptedText = await decryptChatMessage(event.data, this.cryptoKey);
        // Additional check: reject payload if it contains base64 file data or file transfer signals
        if (decryptedText.startsWith("data:") || decryptedText.startsWith("__FILE_SHARE__")) {
          console.warn("Security Alert: Blocked file sharing transfer payload.");
          return;
        }

        if (this.onChatMessage) {
          this.onChatMessage({
            sender: peerName,
            text: decryptedText,
            timestamp: new Date().toLocaleTimeString()
          });
        }
      } catch (err) {
        console.error("Failed to decrypt chat message from peer:", err);
      }
    };
  }

  notifyPeerList() {
    if (this.onPeerListUpdate) {
      const list = Array.from(this.peers.entries()).map(([pid, pdata]) => ({
        peerId: pid,
        name: pdata.name,
        isHost: !!pdata.isHost,
        isCoHost: !!pdata.isCoHost
      }));
      this.onPeerListUpdate(list);
    }
  }

  async handleSignalingMessage(msg) {
    const { type, sdp, candidate, peers, myPeerId, emoji, isRaised } = msg;
    const senderPeerId = msg.senderPeerId || msg.peerId || msg.offenderPeerId;
    const senderName = msg.senderName || msg.name || msg.participantName || msg.offenderName;

    if (type === "waiting-room") {
      this.onStatus("Asking to be let in... Waiting for host admission.");
      if (this.onWaitingRoom) {
        this.onWaitingRoom(msg);
      }
      return;
    }

    if (type === "knock-request") {
      if (this.onKnockRequest) {
        this.onKnockRequest({ peerId: msg.peerId, name: msg.name });
      }
      return;
    }

    if (type === "knock-cancelled") {
      if (this.onKnockCancelled) {
        this.onKnockCancelled(msg.peerId);
      }
      return;
    }

    if (type === "admission-denied") {
      this.onStatus("The host did not allow you into this meeting.");
      if (this.onAdmissionDenied) {
        this.onAdmissionDenied(msg.message || "Entry denied by host.");
      }
      return;
    }

    if (type === "room-welcome") {
      this.myPeerId = myPeerId;
      this.isHost = !!msg.isHost;
      this.isCoHost = !!msg.isCoHost;
      this.coHosts = new Set(msg.coHosts || []);
      this.hostPeerId = msg.hostPeerId;
      this.isRoomLocked = Boolean(msg.isLocked);
      this.isChatDisabled = Boolean(msg.isChatDisabled);
      if (this.onHostChange) {
        this.onHostChange({
          isHost: this.isHost,
          hostPeerId: msg.hostPeerId
        });
      }
      if (this.onCoHostChange) {
        this.onCoHostChange({
          targetPeerId: this.myPeerId,
          isCoHost: this.isCoHost,
          isSelfCoHost: this.isCoHost,
          coHosts: Array.from(this.coHosts)
        });
      }
      if (msg.whiteboardStrokes && this.onWhiteboardSync) {
        this.onWhiteboardSync(msg.whiteboardStrokes);
      }
      if (this.onRoomLockChange && msg.isLocked !== undefined) {
        this.onRoomLockChange(this.isRoomLocked, "Host");
      }
      if (this.onRoomChatDisabled && msg.isChatDisabled !== undefined) {
        this.onRoomChatDisabled(this.isChatDisabled, "Host");
      }
      if (msg.wasAdmitted && this.onAdmitted) {
        this.onAdmitted();
      }
      if (msg.waitingPeers && msg.waitingPeers.length > 0 && this.onKnockRequest) {
        msg.waitingPeers.forEach((wp) => this.onKnockRequest(wp));
      }
      this.onStatus(`Joined room as ${this.participantName}. Syncing participants...`);

      // If existing peers are in the room, connect to all of them
      if (peers && peers.length > 0) {
        const adaptive = getAdaptiveBitrate(peers.length + 1, this.isScreenSharing);
        for (const p of peers) {
          const peerObj = this.createPeerConnection(p.peerId, p.name, p.isHost, p.isCoHost);
          const dc = peerObj.pc.createDataChannel("chat");
          peerObj.dataChannel = dc;
          this.setupDataChannel(dc, p.peerId, p.name);

          const offer = await peerObj.pc.createOffer({
            offerToReceiveAudio: true,
            offerToReceiveVideo: true
          });
          const boostedSdp = boostSdpBitrate(offer.sdp, adaptive.bitrateKbps);
          await peerObj.pc.setLocalDescription(new RTCSessionDescription({ type: "offer", sdp: boostedSdp }));
          this.ws.send(JSON.stringify({
            type: "offer",
            targetPeerId: p.peerId,
            sdp: boostedSdp,
            isHost: this.isHost
          }));
        }
        this.adaptMeshBitrate();
      } else {
        this.onStatus("You are in the meeting. Waiting for others to join...");
      }
    } else if (type === "peer-joined") {
      this.onStatus(`${senderName || "Participant"} joined the meeting!`);
      this.createPeerConnection(senderPeerId, senderName, msg.isHost, msg.isCoHost);
      this.adaptMeshBitrate();
    } else if (type === "offer") {
      let peerObj = this.peers.get(senderPeerId);
      if (!peerObj) {
        peerObj = this.createPeerConnection(senderPeerId, senderName, msg.isHost, msg.isCoHost);
      }

      await peerObj.pc.setRemoteDescription(new RTCSessionDescription({ type: "offer", sdp }));
      await this.flushCandidateQueue(peerObj);

      const answer = await peerObj.pc.createAnswer();
      const adaptive = getAdaptiveBitrate(Math.max(1, this.peers.size), this.isScreenSharing);
      const boostedAnswerSdp = boostSdpBitrate(answer.sdp, adaptive.bitrateKbps);
      await peerObj.pc.setLocalDescription(new RTCSessionDescription({ type: "answer", sdp: boostedAnswerSdp }));

      this.ws.send(JSON.stringify({
        type: "answer",
        targetPeerId: senderPeerId,
        sdp: boostedAnswerSdp
      }));
    } else if (type === "answer") {
      const peerObj = this.peers.get(senderPeerId);
      if (peerObj) {
        await peerObj.pc.setRemoteDescription(new RTCSessionDescription({ type: "answer", sdp }));
        await this.flushCandidateQueue(peerObj);
      }
    } else if (type === "candidate") {
      const peerObj = this.peers.get(senderPeerId);
      if (peerObj) {
        if (peerObj.pc.remoteDescription && peerObj.pc.remoteDescription.type) {
          try {
            await peerObj.pc.addIceCandidate(new RTCIceCandidate(candidate));
          } catch (e) {
            console.error("Error adding candidate:", e);
          }
        } else {
          peerObj.candidateQueue.push(candidate);
        }
      }
    } else if (type === "peer-left") {
      this.onStatus(`${senderName || "Participant"} left the meeting.`);
      this.removePeer(senderPeerId);
    } else if (type === "peer-media-status") {
      if (this.peers.has(senderPeerId)) {
        const p = this.peers.get(senderPeerId);
        p.isAudioMuted = msg.isAudioMuted;
        p.isVideoMuted = msg.isVideoMuted;
      }
      if (this.onPeerMediaStatus) {
        this.onPeerMediaStatus(senderPeerId, msg.isAudioMuted, msg.isVideoMuted);
      }
    } else if (type === "peer-screen-share") {
      if (this.peers.has(senderPeerId)) {
        const p = this.peers.get(senderPeerId);
        p.isScreenSharing = Boolean(msg.isSharing);
      }
      if (this.onPeerScreenShare) {
        this.onPeerScreenShare(senderPeerId, Boolean(msg.isSharing), senderName);
      }
    } else if (type === "reaction") {
      if (this.onReaction) this.onReaction(emoji, senderPeerId, senderName);
    } else if (type === "raise-hand") {
      if (this.onRaiseHand) this.onRaiseHand(senderPeerId, isRaised, senderName);
    } else if (type === "host-mute-mic") {
      this.toggleAudio(false);
      this.broadcastMediaStatus(true, !this.isVideoEnabled());
      if (this.onHostAction) {
        this.onHostAction({ action: "mute-mic", senderName });
      }
    } else if (type === "host-unmute-mic") {
      this.toggleAudio(true);
      this.broadcastMediaStatus(false, !this.isVideoEnabled());
      if (this.onHostAction) {
        this.onHostAction({ action: "unmute-mic", senderName });
      }
    } else if (type === "host-stop-video") {
      this.toggleVideo(false);
      this.broadcastMediaStatus(!this.isAudioEnabled(), true);
      if (this.onHostAction) {
        this.onHostAction({ action: "stop-video", senderName });
      }
    } else if (type === "host-start-video") {
      this.toggleVideo(true);
      this.broadcastMediaStatus(!this.isAudioEnabled(), false);
      if (this.onHostAction) {
        this.onHostAction({ action: "start-video", senderName });
      }
    } else if (type === "host-mute-all") {
      this.toggleAudio(false);
      this.broadcastMediaStatus(true, !this.isVideoEnabled());
      if (this.onHostAction) {
        this.onHostAction({ action: "mute-all", senderName });
      }
    } else if (type === "host-unmute-all") {
      this.toggleAudio(true);
      this.broadcastMediaStatus(false, !this.isVideoEnabled());
      if (this.onHostAction) {
        this.onHostAction({ action: "unmute-all", senderName });
      }
    } else if (type === "host-stop-all-video") {
      this.toggleVideo(false);
      this.broadcastMediaStatus(!this.isAudioEnabled(), true);
      if (this.onHostAction) {
        this.onHostAction({ action: "stop-all-video", senderName });
      }
    } else if (type === "host-start-all-video") {
      this.toggleVideo(true);
      this.broadcastMediaStatus(!this.isAudioEnabled(), false);
      if (this.onHostAction) {
        this.onHostAction({ action: "start-all-video", senderName });
      }
    } else if (type === "host-kick-user") {
      if (this.onHostAction) {
        this.onHostAction({ action: "kick", senderName });
      }
      this.cleanup();
    } else if (type === "host-changed") {
      this.hostPeerId = msg.newHostPeerId;
      this.isHost = Boolean(msg.newHostPeerId && this.myPeerId === msg.newHostPeerId);
      this.peers.forEach((p, pid) => {
        p.isHost = (pid === msg.newHostPeerId);
      });
      this.notifyPeerList();
      if (msg.newHostPeerId) {
        this.onStatus(`👑 Host active: ${msg.newHostName || "Host"}`);
      } else {
        this.onStatus("ℹ️ Original host left the call. Room running in guest mode.");
      }
      if (this.onHostChange) {
        this.onHostChange({
          isHost: this.isHost,
          hostPeerId: msg.newHostPeerId,
          hostName: msg.newHostName
        });
      }
    } else if (type === "room-lock-changed") {
      this.isRoomLocked = Boolean(msg.isLocked);
      this.onStatus(msg.isLocked ? "🔒 Meeting has been locked by the host." : "🔓 Meeting has been unlocked.");
      if (this.onRoomLockChange) {
        this.onRoomLockChange(this.isRoomLocked, msg.by);
      }
    } else if (type === "room-chat-disabled") {
      this.isChatDisabled = Boolean(msg.isChatDisabled);
      this.onStatus(msg.isChatDisabled ? `🔒 Chat has been disabled by ${msg.by || "host"}.` : `💬 Chat has been enabled by ${msg.by || "host"}.`);
      if (this.onRoomChatDisabled) {
        this.onRoomChatDisabled(this.isChatDisabled, msg.by);
      }
    } else if (type === "security-alert") {
      this.onStatus(`🚨 ${msg.alert}`);
      if (this.onSecurityAlert) {
        this.onSecurityAlert({ ...(msg.event || {}), ...msg });
      }
    } else if (type === "host-unlocked-session") {
      this.onStatus(msg.message || "The host has authorized your session. Video resumed.");
      if (this.onHostUnlockedSession) {
        this.onHostUnlockedSession(msg);
      }
    } else if (type === "host-denied-unlock") {
      this.onStatus(msg.message || "The host did not grant permission to remove the black screen.");
      if (this.onHostDeniedUnlock) {
        this.onHostDeniedUnlock(msg);
      }
    } else if (type === "security-lockout") {
      this.onStatus(`🚨 ${msg.message}`);
      if (this.onError) {
        this.onError({
          code: "IP_LOCKED_OUT",
          remainingSeconds: msg.remainingSeconds,
          message: msg.message
        });
      }
    } else if (type === "error") {
      this.onStatus(`⚠️ ${msg.message || "An error occurred."}`);
      if (this.onError) {
        this.onError({
          code: msg.code || "SERVER_ERROR",
          message: msg.message || "An error occurred."
        });
      }
    } else if (type === "cohost-updated") {
      const { targetPeerId, isCoHost, coHosts } = msg;
      if (coHosts && Array.isArray(coHosts)) {
        this.coHosts = new Set(coHosts);
      } else if (isCoHost) {
        this.coHosts.add(targetPeerId);
      } else {
        this.coHosts.delete(targetPeerId);
      }
      if (this.peers.has(targetPeerId)) {
        this.peers.get(targetPeerId).isCoHost = Boolean(isCoHost);
      }
      if (targetPeerId === this.myPeerId) {
        this.isCoHost = Boolean(isCoHost);
        this.onStatus(isCoHost ? "🛡️ You are now a Co-Host of this meeting." : "ℹ️ Your Co-Host role was removed.");
      } else {
        this.onStatus(`🛡️ ${msg.targetName || "Participant"} is ${isCoHost ? "now a Co-Host" : "no longer a Co-Host"}.`);
      }
      this.notifyPeerList();
      if (this.onCoHostChange) {
        this.onCoHostChange({
          targetPeerId,
          isCoHost: Boolean(isCoHost),
          isSelfCoHost: this.isCoHost,
          coHosts: Array.from(this.coHosts)
        });
      }
    } else if (type === "whiteboard-draw") {
      if (this.onWhiteboardDraw && msg.stroke) {
        this.onWhiteboardDraw(msg.stroke);
      }
    } else if (type === "whiteboard-clear") {
      if (this.onWhiteboardClear) {
        this.onWhiteboardClear();
      }
    } else if (type === "whiteboard-sync") {
      if (this.onWhiteboardSync && msg.strokes) {
        this.onWhiteboardSync(msg.strokes);
      }
    } else if (type === "meeting-ended") {
      this.onStatus("The meeting was ended by the host. Ephemeral tokens and room destroyed.");
      if (this.onMeetingEnded) {
        this.onMeetingEnded(msg);
      }
      this.cleanup();
    } else if (type === "error") {
      this.onStatus(`Error: ${msg.message}`);
      if (this.onError) this.onError(msg);
    }
  }

  hostUnlockPeer(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-unlock-peer",
        targetPeerId
      }));
    }
  }

  hostDenyUnlockPeer(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-deny-unlock-peer",
        targetPeerId
      }));
    }
  }

  sendSecurityEvent(eventType, details = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: "security-event",
          eventType,
          platform: "windows",
          participantName: this.participantName || "Participant",
          peerId: this.myPeerId,
          details
        }));
      } catch (err) {
        console.error("Failed to send security event over websocket:", err);
      }
    }
  }

  hostEndMeeting() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-end-meeting"
      }));
    }
  }

  toggleRoomLock(isLocked) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-toggle-lock",
        isLocked: Boolean(isLocked)
      }));
    }
  }

  toggleChatDisabled(isChatDisabled) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-toggle-chat",
        isChatDisabled: Boolean(isChatDisabled)
      }));
    }
  }

  async flushCandidateQueue(peerObj) {
    while (peerObj.candidateQueue.length > 0) {
      const cand = peerObj.candidateQueue.shift();
      try {
        await peerObj.pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (err) {
        console.warn("Error adding queued candidate:", err);
      }
    }
  }

  async sendChatMessage(text) {
    const encryptedBase64 = await encryptChatMessage(text, this.cryptoKey);
    this.peers.forEach((peerObj) => {
      if (peerObj.dataChannel && peerObj.dataChannel.readyState === "open") {
        try {
          peerObj.dataChannel.send(encryptedBase64);
        } catch (e) {
          console.warn("Could not send chat to peer:", e);
        }
      }
    });
  }

  sendReaction(emoji) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "reaction",
        emoji
      }));
    }
  }

  sendRaiseHand(isRaised) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "raise-hand",
        isRaised
      }));
    }
  }

  async applyHighBitrateParameters(sender, explicitBps = null) {
    if (!sender || !sender.track || sender.track.kind !== "video") return;
    try {
      const peerCount = Math.max(1, this.peers.size);
      const adaptive = getAdaptiveBitrate(peerCount, this.isScreenSharing);
      const bps = explicitBps || adaptive.bitrateBps;
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = bps;
      params.encodings[0].maxFramerate = adaptive.maxFramerate;
      params.encodings[0].scaleResolutionDownBy = this.isScreenSharing ? 1.0 : adaptive.scaleResolutionDownBy;
      await sender.setParameters(params);
    } catch (err) {
      console.warn("Failed to set video parameters:", err);
    }
  }

  adaptMeshBitrate() {
    const peerCount = Math.max(1, this.peers.size);
    const adaptive = getAdaptiveBitrate(peerCount, this.isScreenSharing);
    for (const peerObj of this.peers.values()) {
      if (peerObj && peerObj.videoSender) {
        this.applyHighBitrateParameters(peerObj.videoSender, adaptive.bitrateBps).catch(() => {});
      }
    }
  }

  setupSenderEncryption(sender) {
    try {
      if (typeof sender.createEncodedStreams !== "function") return;
      const senderStreams = sender.createEncodedStreams();
      const transformStream = new TransformStream({
        transform: async (frame, controller) => {
          try {
            const raw = new Uint8Array(frame.data);
            const isVideo = frame.type !== undefined;
            const headerSize = isVideo ? Math.min(VIDEO_HEADER_SIZE, raw.length) : 1;

            if (raw.length <= headerSize) {
              controller.enqueue(frame);
              return;
            }

            const header = raw.slice(0, headerSize);
            const payload = raw.slice(headerSize);

            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            const encrypted = await window.crypto.subtle.encrypt(
              { name: "AES-GCM", iv },
              this.cryptoKey,
              payload
            );

            const combined = new Uint8Array(header.length + iv.length + encrypted.byteLength);
            combined.set(header, 0);
            combined.set(iv, header.length);
            combined.set(new Uint8Array(encrypted), header.length + iv.length);

            frame.data = combined.buffer;
            controller.enqueue(frame);
          } catch (err) {
            controller.enqueue(frame);
          }
        }
      });
      senderStreams.readable.pipeThrough(transformStream).pipeTo(senderStreams.writable);
    } catch (e) {
      console.warn("Sender transform warning:", e);
    }
  }

  setupReceiverDecryption(receiver) {
    try {
      if (typeof receiver.createEncodedStreams !== "function") return;
      const receiverStreams = receiver.createEncodedStreams();
      const transformStream = new TransformStream({
        transform: async (frame, controller) => {
          try {
            const raw = new Uint8Array(frame.data);
            const isVideo = frame.type !== undefined;
            const headerSize = isVideo ? Math.min(VIDEO_HEADER_SIZE, raw.length) : 1;

            if (raw.length <= headerSize + 12) {
              controller.enqueue(frame);
              return;
            }

            const header = raw.slice(0, headerSize);
            const iv = raw.slice(headerSize, headerSize + 12);
            const ciphertext = raw.slice(headerSize + 12);

            const decrypted = await window.crypto.subtle.decrypt(
              { name: "AES-GCM", iv },
              this.cryptoKey,
              ciphertext
            );

            const restored = new Uint8Array(header.length + decrypted.byteLength);
            restored.set(header, 0);
            restored.set(new Uint8Array(decrypted), header.length);

            frame.data = restored.buffer;
            controller.enqueue(frame);
          } catch (err) {
            controller.enqueue(frame);
          }
        }
      });
      receiverStreams.readable.pipeThrough(transformStream).pipeTo(receiverStreams.writable);
    } catch (e) {
      console.warn("Receiver transform warning:", e);
    }
  }

  isAudioEnabled() {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      return audioTrack ? audioTrack.enabled : false;
    }
    return false;
  }

  isVideoEnabled() {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      return videoTrack ? videoTrack.enabled : false;
    }
    return false;
  }

  broadcastMediaStatus(isAudioMuted, isVideoMuted) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: "peer-media-status",
          isAudioMuted,
          isVideoMuted
        }));
      } catch (e) {
        console.warn("Failed to broadcast media status:", e);
      }
    }
  }

  toggleAudio(enabled) {
    if (this.localStream) {
      const audioTrack = this.localStream.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = enabled;
        this.broadcastMediaStatus(!enabled, !this.isVideoEnabled());
        return audioTrack.enabled;
      }
    }
    return false;
  }

  toggleVideo(enabled) {
    if (this.localStream) {
      const videoTrack = this.localStream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = enabled;
        this.broadcastMediaStatus(!this.isAudioEnabled(), !enabled);
        return videoTrack.enabled;
      }
    }
    return false;
  }

  async toggleScreenShare() {
    if (this.isScreenSharing) {
      await this.stopScreenShare();
      return false;
    }
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        if (this.onStatus) {
          this.onStatus("Screen sharing is not supported on this browser.");
        }
        return false;
      }

      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: 30, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: true
      });

      const screenTrack = stream.getVideoTracks()[0];
      if (!screenTrack) {
        return false;
      }

      this.screenStream = stream;
      this.isScreenSharing = true;

      // Handle user clicking browser's floating "Stop sharing" chrome banner
      screenTrack.onended = () => {
        this.stopScreenShare();
      };

      // Replace video track on all active peer connections
      for (const peerObj of this.peers.values()) {
        try {
          let sender = peerObj.videoSender;
          if (!sender && peerObj.pc) {
            sender = peerObj.pc.getSenders().find((s) => s.track && s.track.kind === "video");
            if (sender) peerObj.videoSender = sender;
          }
          if (sender) {
            await sender.replaceTrack(screenTrack);
            this.applyHighBitrateParameters(sender, 2000000);
          }
        } catch (err) {
          console.warn("Failed replacing video track for peer during screen share:", err);
        }
      }

      this.broadcastScreenShare(true);
      if (this.onStatus) {
        this.onStatus("🖥️ Screen sharing active.");
      }
      return true;
    } catch (err) {
      if (err.name !== "NotAllowedError") {
        console.warn("Screen share request failed:", err);
      }
      return false;
    }
  }

  async stopScreenShare() {
    if (this.screenStream) {
      try {
        this.screenStream.getTracks().forEach((t) => t.stop());
      } catch (e) {}
      this.screenStream = null;
    }
    this.isScreenSharing = false;

    // Restore local camera video track on all peer connections
    const camTrack = this.localStream ? this.localStream.getVideoTracks()[0] : null;
    for (const peerObj of this.peers.values()) {
      try {
        let sender = peerObj.videoSender;
        if (!sender && peerObj.pc) {
          sender = peerObj.pc.getSenders().find((s) => s.track && s.track.kind === "video");
          if (sender) peerObj.videoSender = sender;
        }
        if (sender && camTrack) {
          await sender.replaceTrack(camTrack);
          this.applyHighBitrateParameters(sender);
        }
      } catch (err) {
        console.warn("Failed restoring camera track on peer:", err);
      }
    }

    this.adaptMeshBitrate();
    this.broadcastScreenShare(false);
    if (this.onScreenShareEnded) {
      this.onScreenShareEnded();
    }
    if (this.onStatus) {
      this.onStatus("Screen sharing ended.");
    }
  }

  broadcastScreenShare(isSharing) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({
          type: "peer-screen-share",
          isSharing
        }));
      } catch (e) {
        console.warn("Failed to broadcast screen share status:", e);
      }
    }
  }

  hostMuteUser(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-mute-mic",
        targetPeerId
      }));
    }
  }

  hostUnmuteUser(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-unmute-mic",
        targetPeerId
      }));
    }
  }

  hostStopVideoUser(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-stop-video",
        targetPeerId
      }));
    }
  }

  hostStartVideoUser(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-start-video",
        targetPeerId
      }));
    }
  }

  hostMuteAll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-mute-all"
      }));
    }
  }

  hostUnmuteAll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-unmute-all"
      }));
    }
  }

  hostStopAllVideo() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-stop-all-video"
      }));
    }
  }

  hostStartAllVideo() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-start-all-video"
      }));
    }
  }

  hostKickUser(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-kick-user",
        targetPeerId
      }));
    }
    if (this.peers.has(targetPeerId)) {
      const p = this.peers.get(targetPeerId);
      if (p.pc) p.pc.close();
      this.peers.delete(targetPeerId);
    }
    if (this.onPeerStreamRemove) {
      this.onPeerStreamRemove(targetPeerId);
    }
    this.notifyPeerList();
  }

  hostAdmitPeer(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-admit-peer",
        targetPeerId
      }));
    }
  }

  hostDenyPeer(targetPeerId) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-deny-peer",
        targetPeerId
      }));
    }
  }

  hostAdmitAll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-admit-all"
      }));
    }
  }

  assignCoHost(targetPeerId, isCoHost) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "host-assign-cohost",
        targetPeerId,
        isCoHost: Boolean(isCoHost)
      }));
    }
  }

  sendWhiteboardDraw(stroke) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "whiteboard-draw",
        stroke
      }));
    }
  }

  sendWhiteboardClear() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "whiteboard-clear"
      }));
    }
  }

  requestWhiteboardSync() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "whiteboard-request-sync"
      }));
    }
  }

  cancelKnock() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: "cancel-knock"
      }));
    }
  }

  cleanup() {
    this.isExplicitLeave = true;
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      try {
        this.ws.send(JSON.stringify({ type: "peer-leave" }));
      } catch (e) {}
    }

    this.peers.forEach((peerObj) => {
      try {
        if (peerObj.dataChannel) peerObj.dataChannel.close();
        if (peerObj.pc) peerObj.pc.close();
        if (peerObj.stream) {
          peerObj.stream.getTracks().forEach((t) => t.stop());
        }
      } catch (e) {}
    });
    this.peers.clear();

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }
    if (this.localStream) {
      this.localStream.getTracks().forEach((t) => t.stop());
      this.localStream = null;
    }
    if (this.screenStream) {
      this.screenStream.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
    }
  }
}
