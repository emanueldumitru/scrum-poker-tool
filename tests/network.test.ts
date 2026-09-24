import assert from 'node:assert/strict';
import type { IncomingMessage } from 'node:http';
import type { NetworkInterfaceInfo } from 'node:os';
import { describe, test } from 'node:test';
import { clientIp } from '../src/server/hub.ts';
import { isLocalRequest, shareableAddresses } from '../src/server/network.ts';

const ipv4 = (address: string, internal = false): NetworkInterfaceInfo => ({
  address,
  netmask: '255.255.255.0',
  family: 'IPv4',
  mac: '00:00:00:00:00:00',
  internal,
  cidr: `${address}/24`,
});

describe('shareableAddresses', () => {
  test('keeps LAN and VPN addresses, LAN first; skips loopback, virtual and link-local', () => {
    const found = shareableAddresses({
      lo0: [ipv4('127.0.0.1', true)],
      utun8: [ipv4('10.168.36.51')],
      bridge100: [ipv4('192.168.64.1')],
      en0: [ipv4('192.168.0.146'), { ...ipv4('fe80::1'), family: 'IPv6', scopeid: 0 }],
      en5: [ipv4('169.254.10.2')],
      docker0: [ipv4('172.17.0.1')],
    });
    assert.deepEqual(found, [
      { address: '192.168.0.146', interface: 'en0', kind: 'lan' },
      { address: '10.168.36.51', interface: 'utun8', kind: 'vpn' },
    ]);
  });
});

describe('clientIp', () => {
  const request = (xff: string | undefined) =>
    ({ socket: { remoteAddress: '10.0.0.1' }, headers: xff === undefined ? {} : { 'x-forwarded-for': xff } }) as unknown as IncomingMessage;

  test('ignores X-Forwarded-For unless a proxy is trusted', () => {
    assert.equal(clientIp(request('6.6.6.6'), 0), '10.0.0.1');
  });

  test('uses the address added by the trusted proxy, not the client-supplied prefix', () => {
    assert.equal(clientIp(request('6.6.6.6, 203.0.113.7'), 1), '203.0.113.7');
    assert.equal(clientIp(request('203.0.113.7, 198.51.100.2'), 2), '203.0.113.7');
    assert.equal(clientIp(request(undefined), 1), '10.0.0.1');
    assert.equal(clientIp(request('203.0.113.7'), 2), '10.0.0.1', 'fewer hops than configured');
  });
});

describe('isLocalRequest', () => {
  const request = (remoteAddress: string, host: string) => ({ socket: { remoteAddress }, headers: { host } }) as unknown as IncomingMessage;

  test('only a browser on this computer, using a loopback host name', () => {
    assert.equal(isLocalRequest(request('127.0.0.1', 'localhost:3000'), false), true);
    assert.equal(isLocalRequest(request('::1', '[::1]:3000'), false), true);
    assert.equal(isLocalRequest(request('::ffff:127.0.0.1', '127.0.0.1:3000'), false), true);
    assert.equal(isLocalRequest(request('192.168.0.20', '192.168.0.146:3000'), false), false, 'colleague on the LAN');
    assert.equal(isLocalRequest(request('127.0.0.1', 'evil.example.com:3000'), false), false, 'DNS rebinding');
    assert.equal(isLocalRequest(request('127.0.0.1', 'localhost:3000'), true), false, 'behind a proxy everything looks local');
  });
});
