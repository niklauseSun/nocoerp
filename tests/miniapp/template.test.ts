// @vitest-environment node
import { readFileSync, existsSync } from 'node:fs';
import { expect, it } from 'vitest';
it('declares existing native pages and binds loop collections as WXML expressions', () => {
  const root = new URL('../../miniapp/', import.meta.url);
  const manifest = JSON.parse(readFileSync(new URL('app.json', root), 'utf8'));
  for (const page of manifest.pages) {
    for (const extension of ['js', 'json', 'wxml'])
      expect(existsSync(new URL(`${page}.${extension}`, root))).toBe(true);
    const markup = readFileSync(new URL(`${page}.wxml`, root), 'utf8');
    for (const [, collection] of markup.matchAll(/wx:for="([^"]*)"/g))
      expect(collection).toMatch(/^\{\{.+\}\}$/);
    const source = readFileSync(new URL(`${page}.js`, root), 'utf8');
    for (const [, handler] of markup.matchAll(
      /bind(?:tap|input|change)="([^"]+)"/g,
    ))
      expect(source).toMatch(new RegExp(`\\b${handler}\\([^)]*\\)\\s*\\{`));
  }
});
