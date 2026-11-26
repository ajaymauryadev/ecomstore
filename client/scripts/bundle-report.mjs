import { readFile, readdir, writeFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import path from 'node:path';

const root = path.resolve('dist');
const html = await readFile(path.join(root, 'index.html'), 'utf8');
const entry = html.match(/<script[^>]+src="([^"]+\.js)"/)?.[1];
if (!entry) throw new Error('Build the client before generating the bundle report.');
const initial = new Set();
async function visit(file) {
  if (initial.has(file)) return;
  initial.add(file);
  const source = await readFile(path.join(root, file), 'utf8');
  for (const match of source.matchAll(/(?:from|import)\s*["'](\.[^"']+\.js)["']/g)) {
    await visit(path.posix.join(path.posix.dirname(file), match[1]));
  }
}
await visit(entry.replace(/^\//, ''));
const files = await Promise.all((await readdir(path.join(root, 'assets'))).filter((name) => name.endsWith('.js'))
  .map(async (name) => { const bytes = await readFile(path.join(root, 'assets', name));
    return { file: name, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, initial: initial.has('assets/' + name) }; }));
const sum = (rows, key) => rows.reduce((total, row) => total + row[key], 0);
const report = { scope: 'Production JS; initial = entry and recursive static imports; excludes route chunks, CSS and runtime network reads.',
  initialBytes: sum(files.filter((f) => f.initial), 'bytes'), initialGzipBytes: sum(files.filter((f) => f.initial), 'gzipBytes'),
  totalBytes: sum(files, 'bytes'), totalGzipBytes: sum(files, 'gzipBytes'), files };
if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ ...report, files: files.filter((f) => f.initial) }, null, 2));
