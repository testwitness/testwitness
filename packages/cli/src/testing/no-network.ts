// Test helper for the "no network" promise: while installed, every way a Node process can open a connection or
// resolve a name is replaced by a function that records the attempt and throws. A test file installs it at the top
// and asserts at the end that nothing was recorded. hook-safety.test.ts proves the guard itself trips.
//
// What is patched: net.Socket.prototype.connect (under http, https, tls, http2 and fetch's TCP), dns.lookup and
// dns.promises.lookup, the dns resolve functions, dgram.createSocket and global fetch. Child processes are covered
// separately: the hook starts only git, with local subcommands (hook-safety.test.ts traces them).
import type * as Net from 'node:net';
import type * as Dns from 'node:dns';
import type * as Dgram from 'node:dgram';
import { createRequire, syncBuiltinESMExports } from 'node:module';

const require = createRequire(import.meta.url);

export interface NetworkGuard {
  /** Every blocked attempt so far, as "what: detail". */
  attempts(): string[];
  restore(): void;
}

export function installNetworkGuard(): NetworkGuard {
  const net = require('node:net') as typeof Net;
  const dns = require('node:dns') as typeof Dns;
  const dgram = require('node:dgram') as typeof Dgram;
  const seen: string[] = [];
  const undo: Array<() => void> = [];
  const deny = (what: string) =>
    function denied(...args: unknown[]): never {
      const detail = args
        .filter((a) => typeof a === 'string' || typeof a === 'number' || (typeof a === 'object' && a !== null))
        .slice(0, 2)
        .map((a) => (typeof a === 'object' ? JSON.stringify(a, (_k, v: unknown) => (typeof v === 'function' ? undefined : v))?.slice(0, 120) : String(a)))
        .join(' ');
      seen.push(`${what}: ${detail}`);
      throw new Error(`network access is disabled in this test (${what} ${detail})`);
    };
  const patch = (obj: object, key: string, what: string): void => {
    const target = obj as Record<string, unknown>;
    const original = target[key];
    if (typeof original !== 'function') return;
    target[key] = deny(what);
    undo.push(() => (target[key] = original));
  };
  patch(net.Socket.prototype, 'connect', 'net.connect');
  for (const fn of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'resolveTxt', 'resolveSrv', 'resolveMx', 'reverse']) {
    patch(dns, fn, `dns.${fn}`);
    patch(dns.promises, fn, `dns.promises.${fn}`);
  }
  patch(dgram, 'createSocket', 'dgram.createSocket');
  patch(globalThis, 'fetch', 'fetch');
  syncBuiltinESMExports();
  return {
    attempts: () => [...seen],
    restore: () => {
      for (const u of undo.reverse()) u();
      syncBuiltinESMExports();
    },
  };
}
