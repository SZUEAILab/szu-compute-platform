'use strict';
// MFA handler. Session credentials remain in the login process memory.
const crypto = require('node:crypto');

exports.install = function install(context) {
  const {server, request, profile, exchange, CAS, ENDPOINT, LOGIN, PORT, ORIGIN, expiresAt, getState} = context;
  const csrf = crypto.randomBytes(32).toString('hex');
  const oldHandlers = server.listeners('request');
  let params = null, busy = false, nextSendAt = 0, completed = false, initializationDone = false, attempts = 0;
  let invalidated = false;
  const clearSession = () => { invalidated = true; params = null; };
  if (context.registerCleanup) context.registerCleanup(clearSession);
  function readParameter(html, key) {
    const quoted = new RegExp('(?:["\\\']?' + key + '["\\\']?)\\s*:\\s*("(?:\\\\.|[^"\\\\])*"|true|false|-?\\d+|null)').exec(html);
    if (!quoted) return undefined;
    try { return JSON.parse(quoted[1]); } catch { return undefined; }
  }
  async function follow(response, capture = false) {
    for (let hop = 0; hop < 12; hop++) {
      if (invalidated || Date.now() >= expiresAt) throw Error('登录已取消或到期，请重新启动登录');
      const u = new URL(response.headers.location || response.url, response.url);
      if (u.protocol !== 'https:' || ![CAS, ENDPOINT].includes(u.origin) || u.username || u.password) {
        throw Error('认证跳转来源不受信任');
      }
      if (u.origin === ENDPOINT) {
        const q = new URLSearchParams(u.search);
        const h = new URLSearchParams(u.hash.includes('?') ? u.hash.slice(u.hash.indexOf('?') + 1) : u.hash.slice(1));
        const token = q.get('token') || h.get('token');
        if (token) {
          const result = await exchange(await profile(token));
          completed = true; params = null;
          return result;
        }
      }
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        response = await request(u.href); continue;
      }
      if (capture) {
        if (response.status !== 200 || new URL(response.url).origin !== CAS) throw Error('二次认证页面来源或状态异常');
        const index = response.text.indexOf('reAuthParams');
        if (index < 0) throw Error('现有会话未返回二次认证参数，可能已经失效');
        // Parse only data literals for the exact fields used by the official MFA API.
        const block = response.text.slice(index, index + 20000);
        const parsed = {};
        for (const key of ['service', 'reAuthType', 'isMultifactor', 'reAuthUserId', 'noneAuthType']) {
          parsed[key] = readParameter(block, key);
        }
        if (!parsed.reAuthType || !parsed.reAuthUserId || !['true', 'false'].includes(String(parsed.isMultifactor))) {
          const names = [...block.matchAll(/["']?([A-Za-z][A-Za-z0-9_]*)["']?\s*:/g)].map(m => m[1]);
          console.log(JSON.stringify({stage: 'MFA_PARAMETER_SCHEMA', names: [...new Set(names)].slice(0, 100),
            parsed_fields: Object.keys(parsed).filter(key => parsed[key] !== undefined)}));
          throw Error('二次认证参数格式需要继续适配；尚未发送验证码');
        }
        const service = new URL(parsed.service);
        if (service.href !== ENDPOINT + '/gateway/ram/api/v1/cas/action/login') {
          throw Error('二次认证回调地址校验失败');
        }
        if (String(parsed.reAuthType) !== '4' || String(parsed.noneAuthType) === '1') {
          throw Error('当前脚本仅支持企业微信验证码认证，尚未发送验证码');
        }
        params = parsed;
        console.log(JSON.stringify({stage: 'MFA_SESSION_READY', type: String(params.reAuthType)}));
        return {ok: false, needs_mfa: true, message: String(params.reAuthType) === '4'
          ? '已保留当前登录会话。请点击发送验证码，然后填写企业微信收到的动态码。'
          : '已保留当前二次认证会话。'};
      }
      throw Error('CAS 验证后尚未返回平台会话');
    }
    throw Error('CAS 重定向超过上限');
  }
  let initialization = followRequest();
  async function followRequest() {
    try { return await follow(context.initialResponse || await request(LOGIN), true); }
    catch (error) { return {ok: false, message: error.message}; }
    finally { initializationDone = true; }
  }
  const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<title>深大算力 · 二次认证</title><style>body{font:16px system-ui;max-width:560px;margin:60px auto;padding:20px;background:#f5f6f8;color:#18212e}p{line-height:1.7}button,input{font:inherit;padding:12px;display:block;box-sizing:border-box;width:100%;margin:16px 0}button{background:#1653b8;color:white;border:0;border-radius:6px}#status{white-space:pre-wrap}</style>
<h1>深大算力 · 二次认证</h1><p>继续使用本次 CAS 登录会话。动态码仅在本机提交，后端通过学校官方 HTTPS 接口验证。</p>
<button id="send">发送验证码</button><form id="verify"><label>动态码<input id="code" type="password" autocomplete="off" inputmode="numeric" required></label><button id="submit">验证并继续</button></form><button id="cancel">取消并关闭输入服务</button><p id="status">正在确认当前会话…</p>
<script>const csrf=${JSON.stringify(csrf)};const status=document.querySelector('#status');let sentUntil=0;async function api(route,payload={}){let r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json','X-Login-Nonce':csrf},body:JSON.stringify(payload)});return r.json();}
document.querySelector('#send').onclick=async()=>{const b=document.querySelector('#send');b.disabled=true;status.textContent='正在发送…';try{let j=await api('/mfa/send');status.textContent=j.message;if(j.resend_after)sentUntil=Date.now()+j.resend_after*1000;else b.disabled=false;}catch{status.textContent='连接失败';b.disabled=false;}};
document.querySelector('#cancel').onclick=async()=>{try{let j=await api('/mfa/cancel');status.textContent=j.message;document.querySelector('#verify').hidden=true;document.querySelector('#send').disabled=true;}catch{status.textContent='输入服务已关闭';}};
document.querySelector('#verify').onsubmit=async e=>{e.preventDefault();const b=document.querySelector('#submit');b.disabled=true;let c=document.querySelector('#code');let code=c.value;c.value='';status.textContent='正在验证…';try{let pending=api('/mfa/verify',{code});code='';let j=await pending;status.textContent=j.message;if(j.ok){document.querySelector('#send').disabled=true;document.querySelector('#verify').hidden=true;}else b.disabled=false;}catch{status.textContent='连接失败';b.disabled=false;}finally{code='';}};
setInterval(()=>{if(sentUntil){let left=Math.ceil((sentUntil-Date.now())/1000);let b=document.querySelector('#send');b.textContent=left>0?'重新发送（'+left+'秒）':'发送验证码';if(left<=0){b.disabled=false;sentUntil=0;}}},1000);
api('/mfa/status').then(j=>{status.textContent=j.message;if(j.resend_after)sentUntil=Date.now()+j.resend_after*1000;document.querySelector('#send').disabled=!j.needs_mfa||Boolean(j.resend_after);});</script></html>`;

  async function handler(req, res) {
    const handled = ['/', '/health', '/mfa/status', '/mfa/send', '/mfa/verify', '/mfa/cancel'].includes(req.url);
    if (!handled) return oldHandlers.forEach(handler => handler(req, res));
    const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"};
    const reply = (status, value, type = 'application/json; charset=utf-8') => {
      res.writeHead(status, {...headers, 'Content-Type': type});
      res.end(type.startsWith('application/json') ? JSON.stringify(value) : value);
    };
    if (req.headers.host !== `127.0.0.1:${PORT}` || Date.now() >= expiresAt) return reply(403, {message: '输入会话已失效'});
    if (req.method === 'GET' && req.url === '/') return reply(200, html, 'text/html; charset=utf-8');
    if (req.method === 'GET' && req.url === '/health') return reply(200, {
      kind: 'szu-local-credential-input', ready: !completed && !invalidated, busy, stage: 'mfa', initialization_done: initializationDone,
      has_mfa_parameters: Boolean(params), type: params ? String(params.reAuthType) : null,
      configuration_id: context.configurationId || null,
      session_id: context.sessionId || null,
      expires_at: new Date(expiresAt).toISOString()
    });
    if (req.method !== 'POST' || !['/mfa/status', '/mfa/send', '/mfa/verify', '/mfa/cancel'].includes(req.url)) return reply(405, {message: 'Method not allowed'});
    if (req.headers.origin !== ORIGIN || req.headers['x-login-nonce'] !== csrf || req.headers['content-type'] !== 'application/json') {
      return reply(403, {message: '请求来源校验失败'});
    }
    if (req.url === '/mfa/cancel') {
      clearSession(); if (context.invalidate) context.invalidate(); req.resume();
      reply(200, {ok: false, cancelled: true, message: '已取消，本机输入服务即将关闭。'});
      if (context.shutdown) setTimeout(context.shutdown, 100, 'cancelled');
      return;
    }
    if (busy || getState().busy || completed) return reply(409, {message: '验证正在进行或已完成'});
    let input, text = '';
    busy = true;
    try {
      for await (const chunk of req) { text += chunk; if (Buffer.byteLength(text) > 4096) throw Error('请求过大'); }
      try { input = JSON.parse(text); } catch { throw Error('请求格式无效'); } text = '';
      if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('请求格式无效');
      const initial = await initialization;
      if (req.url === '/mfa/status') return reply(200, {...initial, needs_mfa: Boolean(params),
        ...(invalidated ? {message: '本次 CAS 会话已失效，请取消并重新启动登录'} : {}),
        resend_after: Math.max(0, Math.ceil((nextSendAt - Date.now()) / 1000))});
      if (invalidated) throw Error('登录已取消或到期，请重新启动登录');
      if (!params) throw Error(initial.message);
      const type = String(params.reAuthType);
      if (req.url === '/mfa/send') {
        if (Date.now() < nextSendAt) throw Error('请稍候再发送，避免重复请求');
        if (type !== '4') throw Error('当前脚本仅支持企业微信验证码认证');
        nextSendAt = Date.now() + 120000;
        const response = await request(CAS + '/authserver/dynamicCode/getDynamicCodeByReauth.do', 'POST',
          new URLSearchParams({userName: String(params.reAuthUserId), authCodeTypeName: 'reAuthWChatDynamicCodeType'}));
        let data; try { data = JSON.parse(response.text); } catch { throw Error('发送验证码响应异常'); }
        if (response.status !== 200 || !data || !['success', 'wechat_success', 'other_success', 'code_time_fail'].includes(data.res)) {
          throw Error('学校未确认验证码发送，请检查企业微信并等待发送间隔结束');
        }
        const seconds = Number(data.codeTime);
        nextSendAt = Date.now() + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 300) : 120) * 1000;
        return reply(200, {ok: false, sent: true, resend_after: Math.ceil((nextSendAt - Date.now()) / 1000),
          message: data.res === 'code_time_fail' ? '请使用最近已发送的企业微信验证码。' : '验证码已发送，请查看企业微信并在此输入。'});
      }
      if (typeof input.code !== 'string' || !/^[0-9A-Za-z]{4,12}$/.test(input.code)) throw Error('请输入有效动态码');
      if (attempts >= 5) throw Error('本次会话验证码验证已达 5 次，请取消并重新启动登录');
      attempts++;
      const fields = new URLSearchParams({service: params.service, reAuthType: type,
        isMultifactor: String(params.isMultifactor), password: '', dynamicCode: type === '10' ? '' : input.code,
        uuid: '', answer1: '', answer2: '', otpCode: type === '10' ? input.code : '', skipTmpReAuth: 'false'});
      input.code = '';
      let response;
      try { response = await request(CAS + '/authserver/reAuthCheck/reAuthSubmit.do', 'POST', fields); }
      finally { fields.set('dynamicCode', ''); fields.set('otpCode', ''); }
      let data; try { data = JSON.parse(response.text); } catch { throw Error('二次认证响应异常'); }
      if (response.status !== 200 || !data || typeof data.code !== 'string') throw Error('二次认证响应状态异常，尚未确认登录');
      if (data.code === 'reAuth_unauthorized') {
        clearSession(); if (context.invalidate) context.invalidate();
        throw Error('CAS 会话已失效，请取消并重新启动登录');
      }
      if (data.code === 'reAuth_failed') {
        throw Error('动态码未通过验证，请检查有效期和输入');
      }
      const result = await follow(await request(LOGIN));
      reply(200, result);
      if (completed) setTimeout(() => {
        if (context.shutdown) context.shutdown(); else server.close();
      }, 1500).unref();
    } catch (error) { reply(400, {ok: false, message: error.message,
      resend_after: Math.max(0, Math.ceil((nextSendAt - Date.now()) / 1000))}); }
    finally { if (input && typeof input === 'object') input.code = ''; text = ''; busy = false; }
  }
  server.removeAllListeners('request');
  server.on('request', handler);
  console.log('MFA_HANDLER_INSTALLED_SESSION_PRESERVED');
  return {ok: false, needs_mfa: true, message: '已进入二次认证，请在此页继续填写验证码。'};
};
