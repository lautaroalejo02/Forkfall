import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { analyzeImpact, classifyEntry } from '../lib/impact.js';

const git = (cwd, ...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
const write = (root, file, text) => {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
};

test('follows aliases, layouts and HTTP calls from a change to the screens it reaches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ff-impact-'));
  git(root, 'init', '-q');
  write(root, 'tsconfig.json', '{ // comment\n "compilerOptions": { "paths": { "@/*": ["./src/*"] } } }');
  write(root, 'src/lib/price.ts', 'export function price(x: number) { return x; }\n');
  write(root, 'src/app/api/total/route.ts', "import { price } from '@/lib/price';\nexport function GET() { return price(1); }\n");
  write(root, 'src/components/total.tsx', "export function Total() { fetch('/api/total'); return null; }\n");
  write(root, 'src/app/cart/page.tsx', "import { Total } from '../../components/total';\nexport default function Page() { return Total(); }\n");
  write(root, 'src/app/about/page.tsx', 'export default function About() { return null; }\n');
  git(root, 'add', '-A');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  write(root, 'src/lib/price.ts', 'export function price(x: number) { return x * 2; }\n');
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qam', 'double prices');

  const r = analyzeImpact({ repo: root });
  assert.deepEqual(r.changed.map((c) => [c.file, c.symbols]), [['src/lib/price.ts', ['price']]]);
  const routes = r.entries.map((e) => `${e.kind} ${e.route}`);
  assert.ok(routes.includes('api /api/total'));
  assert.ok(routes.includes('page /cart'), 'page reached through a fetch to the affected API');
  assert.ok(!routes.includes('page /about'));
});

test('classifies Next.js and static entry points', () => {
  assert.deepEqual(classifyEntry('src/app/(shop)/listings/[id]/page.tsx'), { kind: 'page', route: '/listings/[id]', file: 'src/app/(shop)/listings/[id]/page.tsx' });
  assert.equal(classifyEntry('app/api/x/route.ts').kind, 'api');
  assert.equal(classifyEntry('public/cart.html').route, '/cart.html');
  assert.equal(classifyEntry('src/lib/util.ts'), null);
});
