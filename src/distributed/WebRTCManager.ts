import { SyncProtocol } from './SyncProtocol';

export class WebRTCManager {
  peers: Map<string, RTCPeerConnection> = new Map();
  channels: Map<string, RTCDataChannel> = new Map();

  async createPeer(peerId: string, onMessage?: (data: any) => void) {
    const pc = new RTCPeerConnection();
    const dc = pc.createDataChannel('sync');
    dc.onopen = () => console.info('DataChannel open to', peerId);
    dc.onmessage = (ev) => {
      const parsed = SyncProtocol.parse(ev.data);
      onMessage?.(parsed);
    };
    this.peers.set(peerId, pc);
    this.channels.set(peerId, dc);

    pc.onicecandidate = e => {
      // ICE candidates should be exchanged via signalling server; stub logs for now
      console.debug('ICE candidate generated', peerId, e.candidate);
    };

    pc.ondatachannel = ev => {
      const ch = ev.channel;
      ch.onmessage = e => onMessage?.(SyncProtocol.parse(e.data));
    };

    // create offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    return { offer }; // signalling left to caller
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
