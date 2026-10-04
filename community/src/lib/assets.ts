import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
export function asset(name: string) {
  const hash=createHash('sha256').update(readFileSync(resolve('public',name))).digest('hex').slice(0,12);
  const at=name.lastIndexOf('.');
  return `/assets/${name.slice(0,at)}.${hash}${name.slice(at)}`;
}
