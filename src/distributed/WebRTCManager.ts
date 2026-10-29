import { SyncProtocol } from './SyncProtocol';

type SignalMessage = {
  type: 'offer' | 'answer' | 'ice' | 'announce';
  from: string;
  to?: string;
  sdp?: any;
  candidate?: any;
  payload?: any;
};

export class WebRTCManager {
  peers: Map<string, RTCPeerConnection> = new Map();
  channels: Map<string, RTCDataChannel> = new Map();
  ws?: WebSocket;
  localId: string;

  constructor(options: { signallingUrl?: string; localId?: string } = {}) {
    this.localId = options.localId || `node-${Math.random().toString(36).slice(2, 9)}`;
    if (options.signallingUrl) this.connectSignalling(options.signallingUrl);
  }

  connectSignalling(url: string) {
    try {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        console.info('Connected to signalling', url);
        // announce presence
        this.ws!.send(JSON.stringify({ type: 'announce', from: this.localId }));
      };
      this.ws.onmessage = (ev) => {
        try {
          const msg: SignalMessage = JSON.parse(ev.data as string);
          if (msg.from === this.localId) return; // ignore our own messages
          this.handleSignal(msg).catch(err => console.warn('handleSignal', err));
        } catch (e) {
          console.warn('Invalid signalling message', e);
        }
      };
      this.ws.onerror = (e) => console.warn('Signalling WS error', e);
      this.ws.onclose = () => console.info('Signalling WS closed');
    } catch (err) {
      console.warn('Failed to connect signalling', err);
    }
  }

  private async handleSignal(msg: SignalMessage) {
    if (msg.type === 'offer' && msg.sdp && msg.from) {
      // incoming offer -> create peer, set remote, answer
      const pc = await this.setupPeer(msg.from, undefined);
      await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.sendSignal({ type: 'answer', from: this.localId, to: msg.from, sdp: pc.localDescription });
    } else if (msg.type === 'answer' && msg.sdp && msg.from) {
      const pc = this.peers.get(msg.from);
      if (pc) await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
    } else if (msg.type === 'ice' && msg.candidate && msg.from) {
      const pc = this.peers.get(msg.from);
      if (pc) {
        try {
          await pc.addIceCandidate(msg.candidate);
        } catch (e) {
          console.warn('Failed to add ICE candidate', e);
        }
      }
    }
  }

  private sendSignal(msg: SignalMessage) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify(msg));
  }

  private async setupPeer(peerId: string, onMessage?: (data: any) => void) {
    if (this.peers.has(peerId)) return this.peers.get(peerId)!;
    const pc = new RTCPeerConnection();

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.sendSignal({ type: 'ice', from: this.localId, to: peerId, candidate: e.candidate });
      }
    };

    pc.ondatachannel = (ev) => {
      const ch = ev.channel;
      ch.onopen = () => console.info('DataChannel open (inbound) from', peerId);
      ch.onmessage = (e) => onMessage?.(SyncProtocol.parse(e.data));
      this.channels.set(peerId, ch);
    };

    // create an outbound channel if we are initiating
    const dc = pc.createDataChannel('sync');
    dc.onopen = () => console.info('DataChannel open (outbound) to', peerId);
    dc.onmessage = (ev) => onMessage?.(SyncProtocol.parse(ev.data));
    this.channels.set(peerId, dc);

    this.peers.set(peerId, pc);
    return pc;
  }

  async createPeer(peerId: string, onMessage?: (data: any) => void) {
    const pc = await this.setupPeer(peerId, onMessage);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    // send offer via signalling server
    this.sendSignal({ type: 'offer', from: this.localId, to: peerId, sdp: pc.localDescription });
    return { offer: pc.localDescription };
  }

  async acceptAnswer(peerId: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peers.get(peerId);
    if (!pc) throw new Error('Unknown peer');
    await pc.setRemoteDescription(answer);
  }

  send(peerId: string, msg: any) {
    const ch = this.channels.get(peerId);
    if (!ch || ch.readyState !== 'open') return false;
    ch.send(SyncProtocol.serialize(msg));
    return true;
  }
}
