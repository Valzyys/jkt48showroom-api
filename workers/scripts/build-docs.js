import { readFile, writeFile } from 'node:fs/promises';
const files = { html: 'index.html', css: 'style.css', script: 'app.js', guide: 'guide.md' };
const assets = {};
for (const [key, file] of Object.entries(files)) assets[key] = await readFile(new URL('../docs/' + file, import.meta.url), 'utf8');
for (const [key,file] of Object.entries({controlHtml:'index.html',controlCss:'style.css',controlScript:'app.js'})) assets[key]=await readFile(new URL('../control/'+file,import.meta.url),'utf8');
const catalog = JSON.parse(await readFile(new URL('../docs/routes.json', import.meta.url), 'utf8'));
const responses = JSON.parse(await readFile(new URL('../docs/response-samples.json', import.meta.url), 'utf8'));
await writeFile(new URL('../src/docs/assets.js', import.meta.url),
  'export const assets = ' + JSON.stringify(assets) + ';\nexport const catalog = ' + JSON.stringify(catalog) + ';\nexport const responses = ' + JSON.stringify(responses) + ';\n');
console.log(`Documentation prepared: ${catalog.routes.length} method/route combinations.`);
