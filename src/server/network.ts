/**
 * Addresses under which colleagues on the same network can reach this computer, used for the
 * startup banner and for "Invite players" when the host opened the app on localhost.
 */
import type { IncomingMessage } from 'node:http';
import os from 'node:os';

export interface ShareableAddress {
  address: string;
  interface: string;
  kind: 'lan' | 'vpn';
}

const VPN = /^(utun|tun|tap|ppp|ipsec|wg|gpd|zt|tailscale)/i;
// Virtual adapters (containers, VMs, AirDrop, IPv6 tunnels) that colleagues cannot reach.
const VIRTUAL = /^(lo|bridge|vmnet|docker|br-|veth|vboxnet|virbr|podman|cni|lima|awdl|llw|anpi|gif|stf|vethernet)/i;

export function shareableAddresses(interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces()): ShareableAddress[] {
  const found: ShareableAddress[] = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (VIRTUAL.test(name)) continue;
    for (const info of list ?? []) {
      if (info.family !== 'IPv4' || info.internal || info.address.startsWith('169.254.')) continue;
      found.push({ address: info.address, interface: name, kind: VPN.test(name) ? 'vpn' : 'lan' });
    }
  }
  // Local network first: it is the address colleagues in the same office can use.
  return found.sort((a, b) => Number(a.kind === 'vpn') - Number(b.kind === 'vpn'));
}

export function isLoopbackHost(host: string): boolean {
  return host === '127.0.0.1' || host === '::1' || host === 'localhost';
}

/**
 * True only for a browser on this very computer talking to a loopback Host header. The Host check
 * defeats DNS-rebinding pages; behind a proxy every request looks local, so it is disabled there.
 */
export function isLocalRequest(req: IncomingMessage, trustProxy: boolean): boolean {
  if (trustProxy) return false;
  const remote = req.socket.remoteAddress ?? '';
  const fromLoopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  return fromLoopback && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? '');
}
