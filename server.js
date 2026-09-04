import http from 'node:http';
import { readFile, mkdir, appendFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const dataDir = path.join(root, 'data');
const leadsFile = path.join(dataDir, 'pilot-interest.ndjson');
const port = Number(process.env.PORT || 3101);
const visits = new Map();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml' };

function clean(value, max = 500) { return typeof value === 'string' ? value.trim().replace(/[<>]/g, '').slice(0, max) : ''; }
function json(res, status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
async function handleLead(req, res) {
  const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now(); const prior = visits.get(ip) || [];
  const recent = prior.filter(t => now - t < 3_600_000); visits.set(ip, recent);
  if (recent.length >= 5) return json(res, 429, { error: 'Please try again later.' });
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > 25_000) return json(res, 413, { error: 'Request too large.' }); }
  let input; try { input = JSON.parse(raw); } catch { return json(res, 400, { error: 'Please check your submission.' }); }
  if (input.website) return json(res, 200, { ok: true });
  const lead = {
    name: clean(input.name, 120), email: clean(input.email, 200).toLowerCase(), company: clean(input.company, 160), title: clean(input.title, 160), companySize: clean(input.companySize, 50), interest: clean(input.interest, 100), question: clean(input.question, 1200), annualHires: clean(input.annualHires, 50), consent: input.consent === true,
    utm: Object.fromEntries(['source','medium','campaign','content','term'].map(k => [k, clean(input.utm?.[k], 200)])), createdAt: new Date().toISOString()
  };
  if (!lead.name || !validEmail(lead.email) || !lead.company || !lead.title || !lead.companySize || !lead.interest || !lead.question || !lead.consent) return json(res, 422, { error: 'Please complete all required fields and consent to pilot updates.' });
  await mkdir(dataDir, { recursive: true }); await appendFile(leadsFile, JSON.stringify(lead) + '\n', { encoding: 'utf8', mode: 0o600 }); recent.push(now);
  json(res, 201, { ok: true });
}
const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'POST' && req.url === '/api/pilot-interest') return handleLead(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Method not allowed.' });
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const file = path.resolve(publicDir, relative); if (!file.startsWith(publicDir)) return json(res, 403, { error: 'Forbidden.' });
    const info = await stat(file); if (!info.isFile()) throw Error('not file');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') return res.end(); res.end(await readFile(file));
  } catch { json(res, 404, { error: 'Not found.' }); }
});
server.listen(port, () => console.log(`Hiring Intelligence running at http://localhost:${port}`));
