import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';

const dir = mkdtempSync(join(tmpdir(), 'cavemem-smoke-'));
const { MemoryStore } = await import('./packages/core/dist/index.js');
const { defaultSettings } = await import('./packages/config/dist/index.js');

const settings = defaultSettings;
const store = new MemoryStore({ dbPath: join(dir, 'data.db'), settings });

store.startSession({ id: 's1', ide: 'test', cwd: process.cwd() });

const text = "Please just go ahead and run the build at /tmp/out.log using the command `pnpm build`. I think maybe we could fix the issue.";
const id = store.addObservation({ session_id: 's1', kind: 'note', content: text });
console.log('inserted id=', id);

const [compressed] = store.getObservations([id], { expand: false });
const [expanded] = store.getObservations([id], { expand: true });
console.log('ORIG  :', text);
console.log('COMP  :', compressed.content);
console.log('EXPAND:', expanded.content);

const hasPath = compressed.content.includes('/tmp/out.log');
const hasCmd = compressed.content.includes('`pnpm build`');
console.log('preserved path=', hasPath, 'cmd=', hasCmd);

const hits = await store.search('build');
console.log('search hits=', hits.length);
for (const h of hits) console.log(' hit:', h);

const id2 = store.addObservation({ session_id: 's1', kind: 'note', content: 'keep this <private>secret</private> out.' });
const [p] = store.getObservations([id2], { expand: true });
console.log('private ->', JSON.stringify(p.content));
console.log('private leak=', p.content.includes('secret'));

const tl = store.timeline('s1');
console.log('timeline n=', tl.length);

store.close();
rmSync(dir, { recursive: true, force: true });
