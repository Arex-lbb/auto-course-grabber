import { sm2 } from 'sm-crypto';

const PUBLIC_KEY = '049121366953ab694e775b71062461b91b1648316ae32d89ad1b59bc6a4b0a5c6184c9851df7e97b6a4948618c1e7a30d740dca436f0556cadce9bc4d67a179eab';

export function encryptQueryParams(data: unknown): string {
  const payload = JSON.stringify({ _t: Date.now(), _d: data });
  const raw = sm2.doEncrypt(payload, PUBLIC_KEY, 1);
  return `04${raw}`;
}
