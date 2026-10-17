// Regenera la lista de archivos que el service worker guarda para uso sin conexión.
// Uso: node tools/precache.mjs   (ejecútalo si añades, renombras o borras archivos de la app)
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const html = readFileSync(join(root, 'index.html'), 'utf8');
const version = (html.match(/BRUJULA-VERSION-([\d.]+)/) || [])[1];
if (!version) throw new Error('index.html no tiene el marcador BRUJULA-VERSION-x.y.z');

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const p = join(dir, name);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
const pick = (dir, re) => walk(join(root, dir)).filter((p) => re.test(p)).map((p) => './' + relative(root, p).split('\\').join('/'));

const files = [
  './', './index.html', './manifest.webmanifest', './icon.svg', './actualizar.html',
  `./css/brujula.css?v=${version}`, `./js/app.js?v=${version}`,
  ...pick('js', /\.js$/).filter((p) => p !== './js/app.js'),
  ...pick('assets', /\.(woff2|svg)$/),
  ...pick('icons', /\.(png|svg)$/),
].sort((a, b) => (a.length - b.length) || a.localeCompare(b));

const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const block = `// PRECACHE:START (lo regenera tools/precache.mjs)\nconst SHELL = [\n${files.map((f) => `  '${f}',`).join('\n')}\n];\n// PRECACHE:END`;
let next = sw.replace(/\/\/ PRECACHE:START[\s\S]*?\/\/ PRECACHE:END/, block);
next = next.replace(/const VERSION = '[\d.]+';/, `const VERSION = '${version}';`);
writeFileSync(join(root, 'sw.js'), next);
console.log(`sw.js: ${files.length} archivos, versión ${version}`);
