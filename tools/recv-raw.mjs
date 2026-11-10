// Тимчасовий локальний приймач: сторінка hsc.gov.ua у справжньому браузері
// надсилає сюди байти схем (POST /<name>.jpg), бо curl і headless отримують 403.
// Використання: node tools/recv-raw.mjs [centerId=6841]
import http from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const centerId = process.argv[2] ?? '6841';
const outDir = path.resolve('data/raw', centerId);
await mkdir(outDir, { recursive: true });

http
  .createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    const name = path.basename(req.url ?? '');
    if (req.method !== 'POST' || !/^\d+_\d+\.jpg$/.test(name)) return res.writeHead(400).end('bad');
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const buf = Buffer.concat(chunks);
    if (buf[0] !== 0xff || buf[1] !== 0xd8) return res.writeHead(422).end('not jpeg');
    await writeFile(path.join(outDir, name), buf);
    console.log(name, buf.length);
    res.writeHead(200).end(String(buf.length));
  })
  .listen(8765, '127.0.0.1', () => console.log('listening 8765'));
