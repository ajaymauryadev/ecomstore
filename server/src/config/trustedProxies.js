import { isIP } from 'node:net';

export function parseTrustedProxies(value = '') {
  if (!value.trim()) return false;
  return value.split(',').map((entry) => {
    const proxy = entry.trim();
    const [address, prefix, extra] = proxy.split('/');
    const family = isIP(address);
    const maxPrefix = family === 4 ? 32 : 128;
    if (!family || address.includes('%') || extra !== undefined || (prefix !== undefined &&
      (!/^[1-9]\d*$/.test(prefix) || Number(prefix) > maxPrefix))) {
      throw new Error('TRUSTED_PROXY_CIDRS must list explicit proxy IP addresses or CIDRs with a nonzero prefix.');
    }
    if (family === 6 && prefix !== undefined && Number(prefix) <= 96 &&
        new URL(`http://[${address}]`).hostname.startsWith('[::ffff:')) {
      throw new Error('TRUSTED_PROXY_CIDRS must use IPv4 CIDR notation for IPv4 proxy ranges.');
    }
    return proxy;
  });
}
