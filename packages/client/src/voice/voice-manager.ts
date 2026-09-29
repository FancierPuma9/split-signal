import type { IceServerConfig, RtcPayload } from '@split-signal/shared';

export type MicState = 'off' | 'requesting' | 'on' | 'muted' | 'blocked' | 'unsupported';

export interface VoiceSnapshot {
  mic: MicState;
  peers: Array<{ id: string; state: RTCPeerConnectionState }>;
}

interface Peer {
  id: string;
  epoch: number;
  pc: RTCPeerConnection;
  audio: HTMLAudioElement;
  pendingIce: RTCIceCandidateInit[];
}

/**
 * Peer-to-peer voice, driven entirely by the server: it opens connections to exactly the peers in
 * the latest comms.peers list and closes everything else. It never connects to anyone on its own.
 *
 * Each connection has one audio transceiver in sendrecv mode from the start, so turning the mic on
 * later (or muting) only swaps the outgoing track and never needs renegotiation.
 */
export class VoiceManager {
  private readonly listeners = new Set<() => void>();
  private readonly peers = new Map<string, Peer>();
  private selfId: string | null = null;
  private transport: ((to: string, data: RtcPayload) => void) | null = null;
  private iceServers: RTCIceServer[] = [];
  private stream: MediaStream | null = null;
  private mic: MicState = 'off';
  private snapshotCache: VoiceSnapshot = { mic: 'off', peers: [] };

  /** Our player id in the room, which decides who makes the offer. */
  setSelf(playerId: string | null): void {
    this.selfId = playerId;
  }

  /** How signaling reaches the server (the game socket). */
  setTransport(send: ((to: string, data: RtcPayload) => void) | null): void {
    this.transport = send;
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** Stable between changes, for useSyncExternalStore. */
  getSnapshot = (): VoiceSnapshot => this.snapshotCache;

  setIceServers(servers: IceServerConfig[]): void {
    this.iceServers = servers;
  }

  /** Asks for the microphone once. Voice still works receive-only if it's refused. */
  async requestMic(): Promise<void> {
    if (this.mic !== 'off') return;
    if (!navigator.mediaDevices?.getUserMedia) return this.setMic('unsupported');
    this.setMic('requesting');
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      this.setMic('on');
      for (const peer of this.peers.values()) void this.attachTrack(peer.pc);
    } catch {
      this.setMic('blocked');
    }
  }

  /** The microphone, if access was granted (for recording clips). */
  getMicStream(): MediaStream | null {
    return this.mic === 'on' || this.mic === 'muted' ? this.stream : null;
  }

  setMuted(muted: boolean): void {
    const track = this.stream?.getAudioTracks()[0];
    if (!track || (this.mic !== 'on' && this.mic !== 'muted')) return;
    track.enabled = !muted;
    this.setMic(muted ? 'muted' : 'on');
  }

  /** Applies the server's peer list: connect to new peers, drop missing ones. */
  setPeers(list: ReadonlyArray<{ id: string; epoch: number }>): void {
    const wanted = new Map(list.map((p) => [p.id, p.epoch]));
    for (const [id, peer] of this.peers) {
      if (wanted.get(id) !== peer.epoch) this.closePeer(id);
    }
    for (const [id, epoch] of wanted) {
      if (!this.peers.has(id)) this.openPeer(id, epoch);
    }
    this.emit();
  }

  async handleSignal(from: string, data: RtcPayload): Promise<void> {
    const peer = this.peers.get(from);
    if (!peer) return;
    const { pc } = peer;
    try {
      if (data.kind === 'ice') {
        if (pc.remoteDescription) await pc.addIceCandidate(data.candidate);
        else peer.pendingIce.push(data.candidate);
      } else if (data.kind === 'offer') {
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        const transceiver = pc.getTransceivers()[0];
        if (transceiver) transceiver.direction = 'sendrecv';
        await this.attachTrack(pc);
        await this.flushIce(peer);
        await pc.setLocalDescription(await pc.createAnswer());
        this.sendLocalDescription(peer);
      } else {
        await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushIce(peer);
      }
    } catch (error) {
      console.warn('[voice] signaling failed with', from, error);
    }
  }

  /** Drops every connection (leaving the room). The mic stays granted for next time. */
  closeAll(): void {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.emit();
  }

  private openPeer(id: string, epoch: number): void {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = true;
    audio.hidden = true;
    document.body.append(audio);
    const peer: Peer = { id, epoch, pc, audio, pendingIce: [] };
    this.peers.set(id, peer);

    pc.ontrack = (event) => {
      audio.srcObject = event.streams[0] ?? new MediaStream([event.track]);
      audio.play().catch(() => {
        // Autoplay can be refused before any user gesture; joining a room counts as one.
      });
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate) return;
      this.transport?.(id, {
        kind: 'ice',
        candidate: {
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
        },
      });
    };
    pc.onconnectionstatechange = () => this.emit();

    // The lower id makes the offer, so exactly one side does.
    if (this.selfId !== null && this.selfId < id) void this.makeOffer(peer);
  }

  private async makeOffer(peer: Peer): Promise<void> {
    try {
      peer.pc.addTransceiver('audio', { direction: 'sendrecv' });
      await this.attachTrack(peer.pc);
      await peer.pc.setLocalDescription(await peer.pc.createOffer());
      this.sendLocalDescription(peer);
    } catch (error) {
      console.warn('[voice] could not create an offer for', peer.id, error);
    }
  }

  private sendLocalDescription(peer: Peer): void {
    const description = peer.pc.localDescription;
    if (!description?.sdp || (description.type !== 'offer' && description.type !== 'answer'))
      return;
    this.transport?.(peer.id, { kind: description.type, sdp: description.sdp });
  }

  private async attachTrack(pc: RTCPeerConnection): Promise<void> {
    const sender = pc.getTransceivers()[0]?.sender;
    const track = this.stream?.getAudioTracks()[0] ?? null;
    if (sender && sender.track !== track) await sender.replaceTrack(track);
  }

  private async flushIce(peer: Peer): Promise<void> {
    const pending = peer.pendingIce.splice(0);
    for (const candidate of pending) await peer.pc.addIceCandidate(candidate);
  }

  private closePeer(id: string): void {
    const peer = this.peers.get(id);
    if (!peer) return;
    this.peers.delete(id);
    peer.pc.onconnectionstatechange = null;
    peer.pc.close();
    peer.audio.srcObject = null;
    peer.audio.remove();
  }

  private setMic(mic: MicState): void {
    this.mic = mic;
    this.emit();
  }

  private emit(): void {
    this.snapshotCache = {
      mic: this.mic,
      peers: [...this.peers.values()].map((p) => ({ id: p.id, state: p.pc.connectionState })),
    };
    for (const listener of this.listeners) listener();
  }
}
