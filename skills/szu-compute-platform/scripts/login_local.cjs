'use strict';
// Local credential input only. All platform operations use HTTPS APIs.
const http = require('node:http');
const https = require('node:https');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {saveSession} = require('./login_storage.cjs');

if (process.argv.includes('--help')) {
  console.log('SZU loopback credential input (Node.js 18+; built-in modules only)\n' +
    'node login_local.cjs\n' +
    'Environment: SZU_LOGIN_PORT=18763, SZU_LOGIN_TTL_MINUTES=20,\n' +
    'SZU_LOGIN_CONFIG=~/.bita/config.json, SZU_LOGIN_STATUS_DIR=<project directory>,\n' +
    'SZU_LOGIN_TENANT=szdx, SZU_LOGIN_PRODUCT=heros.\n' +
    'Open the printed URL manually. No browser is launched. No compute resources are created.');
  process.exit(0);
}

const ENDPOINT = 'https://console.aicloud.szu.edu.cn';
const CAS = 'https://authserver.szu.edu.cn';
const LOGIN = `${CAS}/authserver/login?service=${encodeURIComponent(ENDPOINT + '/gateway/ram/api/v1/cas/action/login')}`;
const PORT = Number(process.env.SZU_LOGIN_PORT || 18763);
const TTL_MINUTES = Number(process.env.SZU_LOGIN_TTL_MINUTES || 20);
if (!Number.isInteger(PORT) || PORT < 1024 || PORT > 65535 ||
    !Number.isInteger(TTL_MINUTES) || TTL_MINUTES < 1 || TTL_MINUTES > 120) {
  console.error('Invalid login port (1024-65535) or TTL (1-120 minutes)'); process.exit(2);
}
const CONFIG_PATH = path.resolve(process.env.SZU_LOGIN_CONFIG || path.join(os.homedir(), '.bita', 'config.json'));
const STATUS_DIR = process.env.SZU_LOGIN_STATUS_DIR ? path.resolve(process.env.SZU_LOGIN_STATUS_DIR) : null;
const SKILL_ROOT = path.resolve(__dirname, '..');
function insideSkill(value) {
  const relative = path.relative(SKILL_ROOT, value);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..' + path.sep));
}
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
if (insideSkill(CONFIG_PATH) || (STATUS_DIR && insideSkill(STATUS_DIR)) ||
    (STATUS_DIR && samePath(CONFIG_PATH, path.join(STATUS_DIR, 'auth-status.json')))) {
  console.error('Keep credential config and runtime status separate, outside the installed skill'); process.exit(2);
}
const TENANT = process.env.SZU_LOGIN_TENANT || 'szdx';
const PRODUCT = process.env.SZU_LOGIN_PRODUCT || 'heros';
const CONFIGURATION_ID = crypto.createHash('sha256')
  .update(JSON.stringify([TTL_MINUTES, CONFIG_PATH, STATUS_DIR, TENANT, PRODUCT])).digest('hex');
const ORIGIN = `http://127.0.0.1:${PORT}`;
const nonce = crypto.randomBytes(32).toString('hex');
const SESSION_ID = crypto.randomBytes(16).toString('hex');
const expiresAt = Date.now() + TTL_MINUTES * 60 * 1000;
const cookies = new Map();
let busy = false;
let finished = false;
let stopped = false;
let clearMfa = () => {};

function assertActive() {
  if (stopped || Date.now() >= expiresAt) throw Error('登录已取消或到期，请重新启动登录');
}
function invalidate() { stopped = true; cookies.clear(); clearMfa(); }

function writeStatus(values) {
  if (!STATUS_DIR) return;
  try {
    fs.mkdirSync(STATUS_DIR, {recursive: true});
    fs.writeFileSync(path.join(STATUS_DIR, 'auth-status.json'), JSON.stringify({
      session_id: SESSION_ID, configuration_id: CONFIGURATION_ID,
      updated_at: new Date().toISOString(), ...values
    }, null, 2));
  } catch { console.error('AUTH_STATUS_WRITE_FAILED'); }
}

function request(url, method = 'GET', body = null, token = null) {
  assertActive();
  const u = new URL(url);
  if (u.protocol !== 'https:' || ![ENDPOINT, CAS].includes(u.origin) || u.username || u.password) {
    throw Error('Refused untrusted redirect target');
  }
  if (token && u.origin !== ENDPOINT) throw Error('Refused cross-origin token');
  return new Promise((resolve, reject) => {
    const headers = {'User-Agent': 'SZU-Local-Login/1.0'};
    const stored = cookies.get(u.hostname);
    if (stored?.size) headers.Cookie = [...stored].map(([k, v]) => `${k}=${v}`).join('; ');
    if (token) headers.token = token;
    if (body !== null) {
      headers['Content-Type'] = body instanceof URLSearchParams
        ? 'application/x-www-form-urlencoded' : 'application/json';
      body = body instanceof URLSearchParams ? body.toString() : JSON.stringify(body);
      headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(u, {method, headers}, res => {
      if (stopped || Date.now() >= expiresAt) {
        res.destroy(); reject(Error('登录已取消或到期，请重新启动登录')); return;
      }
      if (!cookies.has(u.hostname)) cookies.set(u.hostname, new Map());
      for (const cookie of res.headers['set-cookie'] || []) {
        const first = cookie.split(';')[0], index = first.indexOf('=');
        if (index > 0) cookies.get(u.hostname).set(first.slice(0, index), first.slice(index + 1));
      }
      const chunks = []; let bytes = 0;
      res.on('data', chunk => { bytes += chunk.length;
        if (bytes > 8 * 1024 * 1024) res.destroy(Error('Response too large')); else chunks.push(chunk); });
      res.on('error', () => reject(Error('HTTPS response failed')));
      res.on('end', () => {
        try { assertActive(); } catch (error) { reject(error); return; }
        resolve({status: res.statusCode, headers: res.headers,
          text: Buffer.concat(chunks).toString('utf8'), url: u.href});
      });
    });
    req.on('error', () => reject(Error('HTTPS connection failed')));
    req.setTimeout(20000, () => req.destroy(Error('HTTPS timeout')));
    if (body !== null) req.write(body);
    req.end();
  });
}

function jsonData(response) {
  if (response.status < 200 || response.status >= 300) throw Error(`平台 HTTP ${response.status}`);
  let data;
  try { data = JSON.parse(response.text); } catch { throw Error('平台未返回 JSON'); }
  if (data.message?.code !== 0 || data.data == null) throw Error(`平台业务错误 ${data.message?.code ?? 'unknown'}`);
  return data.data;
}
const profile = token => {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw Error('平台会话格式异常');
  return request(ENDPOINT + '/gateway/ram/api/v1/tenant', 'GET', null, token).then(jsonData);
};

async function saveVerifiedToken(token, expected) {
  const user = await profile(token);
  assertActive();
  if (!user.id || user.id !== expected.id || user.tenantInfo?.name !== expected.tenantInfo?.name ||
      user.tenantInfo?.name !== TENANT || user.productId !== PRODUCT) {
    throw Error('账号或租户校验失败，未保存');
  }
  saveSession(CONFIG_PATH, ENDPOINT, token);
  cookies.clear(); finished = true;
  writeStatus({verified: true, status: 'verified', account_id: user.id, tenant: user.tenantInfo?.name,
    verified_at: new Date().toISOString(), flow: 'login-exchange-and-profile-verification'});
  console.log(`AUTH_VERIFIED_AND_SAVED ${SESSION_ID}`);
  return {ok: true, message: '登录完成，已验证账号并保存受限会话。可以关闭此页。'};
}

async function exchange(user) {
  if (!user.name || !user.pubPassword || !user.tenantInfo?.name || !user.productId) {
    throw Error('账号资料缺少 CLI 登录交换字段');
  }
  const data = jsonData(await request(ENDPOINT + '/gateway/ram/api/v1/tenant/user/login', 'POST', {
    name: user.name, password: user.pubPassword, tenantName: user.tenantInfo.name, productId: user.productId
  }));
  const token = typeof data === 'string' ? data : data.token;
  if (typeof token !== 'string' || !token) throw Error('登录交换未返回有效 token');
  return saveVerifiedToken(token, user);
}

function attributes(tag) {
  const result = {};
  for (const m of tag.matchAll(/([\w:-]+)\s*=\s*(["'])(.*?)\2/gs)) {
    result[m[1]] = m[3].replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }
  return result;
}

async function casLogin(username, password) {
  cookies.clear();
  const initial = await request(LOGIN);
  if (initial.status !== 200) throw Error('CAS 登录表单不可用');
  const form = initial.text.match(/<form\b[^>]*id=["']pwdFromId["'][^>]*>([\s\S]*?)<\/form>/i);
  if (!form) throw Error('CAS 密码登录表单已变化');
  const params = new URLSearchParams(); let salt;
  for (const input of form[1].matchAll(/<input\b[^>]*>/gi)) {
    const a = attributes(input[0]);
    if (a.id === 'pwdEncryptSalt') salt = a.value;
    if (a.type === 'hidden' && a.name) params.set(a.name, a.value || '');
  }
  if (!salt || ![16, 24, 32].includes(Buffer.byteLength(salt)) || !params.get('execution')) {
    throw Error('CAS 加密盐或执行状态缺失');
  }
  const captcha = await request(`${CAS}/authserver/checkNeedCaptcha.htl?${new URLSearchParams({username})}`);
  let challenge;
  try { challenge = JSON.parse(captcha.text); } catch { throw Error('验证码状态响应异常'); }
  if (captcha.status !== 200 || typeof challenge.isNeed !== 'boolean') throw Error('验证码协议已变化');
  if (challenge.isNeed) throw Error('CAS 要求图形验证码，当前输入页尚不支持；未提交密码');
  const alphabet = 'ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678';
  const randomText = n => Array.from(crypto.randomBytes(n), x => alphabet[x % alphabet.length]).join('');
  const cipher = crypto.createCipheriv(`aes-${Buffer.byteLength(salt) * 8}-cbc`, Buffer.from(salt), Buffer.from(randomText(16)));
  const encrypted = Buffer.concat([cipher.update(randomText(64) + password, 'utf8'), cipher.final()]).toString('base64');
  password = '';
  params.set('username', username); params.set('password', encrypted);
  let response = await request(LOGIN, 'POST', params);
  params.delete('password');
  for (let hop = 0; hop < 12; hop++) {
    const u = new URL(response.headers.location || response.url, response.url);
    if (u.protocol !== 'https:' || ![CAS, ENDPOINT].includes(u.origin) || u.username || u.password) {
      throw Error('认证跳转来源不受信任');
    }
    if (u.origin === ENDPOINT) {
      const query = new URLSearchParams(u.search);
      const hash = new URLSearchParams(u.hash.includes('?') ? u.hash.split('?').slice(1).join('?') : u.hash.slice(1));
      const token = query.get('token') || hash.get('token');
      if (token) return exchange(await profile(token));
    }
    if (response.status >= 300 && response.status < 400 && response.headers.location) {
      response = await request(u.href); continue;
    }
    // Log field and script names only: never response bodies, input values, redirects or credentials.
    const fields = [...response.text.matchAll(/<input\b[^>]*>/gi)].map(m => attributes(m[0]).name).filter(Boolean);
    const scripts = [...response.text.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m => new URL(m[1], response.url).pathname);
    console.log(JSON.stringify({stage: 'CAS_CHALLENGE', http: response.status, fields, scripts}));
    if (scripts.includes('/authserver/cusSzuTheme/static/custom/js/reAuth.js')) {
      return require('./login_mfa.cjs').install({server, request, profile, exchange, CAS, ENDPOINT, LOGIN,
        PORT, ORIGIN, expiresAt, sessionId: SESSION_ID, configurationId: CONFIGURATION_ID, initialResponse: response, shutdown,
        invalidate, registerCleanup: cleanup => { clearMfa = cleanup; },
        getState: () => ({busy, finished})});
    }
    throw Error('CAS 未返回已支持的挑战或平台会话，尚未登录；请核对输入及当前认证协议');
  }
  throw Error('CAS 重定向超过上限');
}

const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>深大算力 · 本机凭据输入</title><style>body{font:16px system-ui;max-width:560px;margin:60px auto;padding:20px;background:#f5f6f8;color:#18212e}label,input,select,button{display:block;box-sizing:border-box;width:100%;margin:12px 0}input,select,button{font:inherit;padding:12px}button{background:#1653b8;color:white;border:0;border-radius:6px}p{line-height:1.7}#status{white-space:pre-wrap}</style>
<h1>深大算力 · 本机凭据输入</h1><p>凭据通过本机回环接口提交，后端通过 HTTPS 请求学校和平台 API。密码不写文件、不输出聊天；验证后的会话保存到本机受限配置。</p>
<form id="login"><label>登录方式<select id="mode"><option value="cas">学校统一认证（CAS 密码）</option><option value="cli">已有平台 CLI 凭据（pubPassword）</option></select></label>
<label>账号<input id="username" autocomplete="off" required></label><label>密码 / pubPassword<input id="password" type="password" autocomplete="off" required></label>
<button id="submit">登录并验证</button></form><button id="cancel" type="button">取消并关闭输入服务</button><p id="status">本页 ${TTL_MINUTES} 分钟后失效。请勿把密码或验证码发送到聊天。</p>
<script>document.querySelector('#cancel').onclick=async()=>{try{const r=await fetch('/cancel',{method:'POST',headers:{'Content-Type':'application/json','X-Login-Nonce':nonce},body:'{}'});const j=await r.json();document.querySelector('#status').textContent=j.message;document.querySelector('#login').hidden=true;}catch{document.querySelector('#status').textContent='输入服务已关闭';}};</script>
<script>const nonce=${JSON.stringify(nonce)};document.querySelector('#login').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#submit');b.disabled=true;let p=document.querySelector('#password');let payload={mode:document.querySelector('#mode').value,username:document.querySelector('#username').value,password:p.value};p.value='';document.querySelector('#status').textContent='正在通过 HTTPS 验证…';try{let r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json','X-Login-Nonce':nonce},body:JSON.stringify(payload)});payload.password='';let j=await r.json();document.querySelector('#status').textContent=j.message;b.disabled=j.ok;if(j.needs_mfa)location.reload();}catch{document.querySelector('#status').textContent='输入服务连接失败';b.disabled=false;}finally{payload.password='';}};</script></html>`;

const server = http.createServer(async (req, res) => {
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
  function reply(status, value, type = 'application/json; charset=utf-8') {
    res.writeHead(status, {...headers, 'Content-Type': type});
    res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
  }
  if (req.headers.host !== `127.0.0.1:${PORT}` || Date.now() >= expiresAt) return reply(403, {message: '输入会话已失效'});
  if (req.method === 'GET' && req.url === '/health') return reply(200, {
    kind: 'szu-local-credential-input', ready: !finished && !stopped, busy,
    session_id: SESSION_ID, configuration_id: CONFIGURATION_ID, expires_at: new Date(expiresAt).toISOString()
  });
  if (req.method === 'GET' && req.url === '/') return reply(200, html, 'text/html; charset=utf-8');
  if (req.method !== 'POST' || !['/login', '/cancel'].includes(req.url)) return reply(404, {message: 'Not found'});
  if (req.headers.origin !== ORIGIN || req.headers['x-login-nonce'] !== nonce || req.headers['content-type'] !== 'application/json') {
    return reply(403, {message: '请求来源校验失败'});
  }
  if (req.url === '/cancel') {
    invalidate();
    req.resume(); reply(200, {ok: false, cancelled: true, message: '已取消，本机输入服务即将关闭。'});
    return setTimeout(shutdown, 100, 'cancelled');
  }
  if (busy || finished) return reply(409, {message: '登录正在进行或已经完成'});
  busy = true;
  let text = '', input;
  try {
    for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 8192) throw Error('请求过大'); }
    try { input = JSON.parse(text); } catch { throw Error('请求格式无效'); } text = '';
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        typeof input.username !== 'string' || typeof input.password !== 'string' || !input.username || !input.password) throw Error('请输入账号和密码');
    let result;
    if (input.mode === 'cas') result = await casLogin(input.username, input.password);
    else if (input.mode === 'cli') {
      const data = jsonData(await request(ENDPOINT + '/gateway/ram/api/v1/tenant/user/login', 'POST', {
        name: input.username, password: input.password, tenantName: TENANT, productId: PRODUCT
      }));
      const token = typeof data === 'string' ? data : data.token;
      if (!token || typeof token !== 'string') throw Error('登录交换未返回 token');
      result = await saveVerifiedToken(token, await profile(token));
    } else throw Error('登录方式无效');
    reply(200, result);
    if (finished) setTimeout(() => server.close(() => process.exit(0)), 1500).unref();
  } catch (error) {
    reply(400, {ok: false, message: error.message});
  } finally { if (input && typeof input === 'object') input.password = ''; text = ''; busy = false; }
});
function shutdown(reason = 'closed') {
  invalidate();
  if (!finished) writeStatus({verified: false, status: reason});
  server.close(() => process.exit(0));
  server.closeAllConnections();
  setTimeout(() => process.exit(0), 1000).unref();
}
server.on('error', () => { console.error('LOCAL_INPUT_SERVER_FAILED'); process.exitCode = 1; });
server.listen(PORT, '127.0.0.1', () => {
  writeStatus({verified: false, status: 'awaiting_input'});
  console.log(`LOCAL_INPUT_READY ${ORIGIN} session=${SESSION_ID}`);
});
setTimeout(shutdown, TTL_MINUTES * 60 * 1000, 'expired').unref();
