import fs from 'node:fs';
import path from 'node:path';

const dist = path.join(process.cwd(), 'dist');

for (const page of ['about', 'directory']) {
  const source = path.join(dist, page, 'index.html');
  const destination = path.join(dist, `${page}.html`);
  fs.copyFileSync(source, destination);
}
