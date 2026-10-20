'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const {install} = require('../skills/szu-compute-platform/scripts/login_mfa.cjs');

// Synthetic official responses only. No school/platform request or real config access.
async function fixture({send = {res: 'wechat_success'}, verify = {code: 'reAuth_success'}, type = '4',
  callback = true, sendError = false, blockVerify = false} = {}) {
  const server = http.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const PORT = server.address().port, ORIGIN = `http://127.0.0.1:${PORT}`;
  const CAS = 'https://authserver.szu.edu.cn', ENDPOINT = 'https://console.aicloud.szu.edu.cn';
  const service = ENDPOINT + '/gateway/ram/api/v1/cas/action/login';
  const LOGIN = CAS + '/authserver/login?service=' + encodeURIComponent(service);
  const trace = [], state = {exchanged: false, invalidated: false};
  let cleanup = () => {}, releaseVerify, verificationStarted;
  const started = new Promise(resolve => { verificationStarted = resolve; });
  const response = data => ({status: 200, headers: {}, text: JSON.stringify(data), url: CAS + '/authserver/reAuth'});
  install({server, PORT, ORIGIN, CAS, ENDPOINT, LOGIN, expiresAt: Date.now() + 60000,
    getState: () => ({busy: false, finished: false}),
    registerCleanup: fn => { cleanup = fn; }, invalidate: () => { state.invalidated = true; cleanup(); },
    initialResponse: {status: 200, headers: {}, url: CAS + '/authserver/reAuth', text:
      '<script>var reAuthParams = ' + JSON.stringify({service, reAuthType: type,
        isMultifactor: true, reAuthUserId: 'fixture-user'}) + ';</script>'},
    request: async (url, method, fields) => {
      trace.push({url, method});
      if (url.endsWith('/getDynamicCodeByReauth.do')) {
        assert.equal(fields.get('authCodeTypeName'), 'reAuthWChatDynamicCodeType');
        if (sendError) throw Error('synthetic HTTPS connection failed');
        return response(send);
      }
      if (url.endsWith('/reAuthSubmit.do')) {
        assert.equal(fields.get('skipTmpReAuth'), 'false');
        assert.equal(fields.get('service'), service); assert.equal(fields.get('reAuthType'), '4');
        assert.equal(fields.get('isMultifactor'), 'true'); assert.equal(fields.get('password'), '');
        verificationStarted();
        if (blockVerify) await new Promise(resolve => { releaseVerify = resolve; });
        return response(verify);
      }
      assert.equal(url, LOGIN);
      return callback ? {status: 302, headers: {location: ENDPOINT + '/#/login?token=fixture-session'}, url, text: ''}
        : {status: 200, headers: {}, url, text: 'No platform session'};
    },
    profile: async token => { assert.equal(token, 'fixture-session'); return {id: 'fixture-account'}; },
    exchange: async () => { state.exchanged = true; return {ok: true, message: 'verified'}; },
  });
  const html = await (await fetch(ORIGIN)).text();
  const nonce = JSON.parse(html.match(/const csrf=("[a-f0-9]+")/)[1]);
  const post = async (route, body = {}) => {
    const result = await fetch(ORIGIN + route, {method: 'POST', headers: {Origin: ORIGIN,
      'Content-Type': 'application/json', 'X-Login-Nonce': nonce}, body: JSON.stringify(body)});
    return {status: result.status, data: await result.json()};
  };
  await post('/mfa/status');
  return {trace, state, post, started, release: () => releaseVerify(),
    close: () => { cleanup(); server.closeAllConnections(); return new Promise(resolve => server.close(resolve)); }};
}

test('recently sent code uses existing challenge and keeps server cooldown on page refresh', async () => {
  const f = await fixture({send: {res: 'code_time_fail', codeTime: 80}});
  try {
    assert.equal((await f.post('/mfa/send')).data.sent, true);
    const status = await f.post('/mfa/status');
    assert.ok(status.data.resend_after > 0 && status.data.resend_after <= 80);
    assert.equal((await f.post('/mfa/send')).status, 400);
    assert.equal(f.trace.filter(x => x.url.endsWith('/getDynamicCodeByReauth.do')).length, 1);
  } finally { await f.close(); }
});

test('send timeout also enforces cooldown without replaying official send request', async () => {
  const f = await fixture({sendError: true});
  try {
    assert.equal((await f.post('/mfa/send')).status, 400);
    assert.ok((await f.post('/mfa/status')).data.resend_after > 0);
    await f.post('/mfa/send');
    assert.equal(f.trace.length, 1);
  } finally { await f.close(); }
});

test('expired CAS challenge is invalidated and cannot be submitted again', async () => {
  const f = await fixture({verify: {code: 'reAuth_unauthorized'}});
  try {
    assert.equal((await f.post('/mfa/verify', {code: '123456'})).status, 400);
    assert.equal(f.state.invalidated, true);
    assert.equal((await f.post('/mfa/status')).data.needs_mfa, false);
    await f.post('/mfa/verify', {code: '123456'});
    assert.equal(f.trace.length, 1); assert.equal(f.state.exchanged, false);
  } finally { await f.close(); }
});

test('missing verification status cannot trigger callback, and unknown status alone is not success', async () => {
  for (const verify of [{}, {code: 'new-unknown-code'}]) {
    const f = await fixture({verify, callback: false});
    try {
      assert.equal((await f.post('/mfa/verify', {code: '123456'})).status, 400);
      assert.equal(f.state.exchanged, false);
      assert.equal(f.trace.length, verify.code ? 2 : 1);
    } finally { await f.close(); }
  }
});

test('five submissions limit attempts while retaining the original challenge for retries', async () => {
  const f = await fixture({verify: {code: 'reAuth_failed'}});
  try {
    for (let i = 0; i < 6; i++) assert.equal((await f.post('/mfa/verify', {code: '123456'})).status, 400);
    assert.equal(f.trace.length, 5); assert.equal(f.state.exchanged, false);
  } finally { await f.close(); }
});

test('unsupported challenge stops without sending or submitting any dynamic code', async () => {
  const f = await fixture({type: '3'});
  try {
    assert.equal((await f.post('/mfa/status')).data.needs_mfa, false);
    assert.equal((await f.post('/mfa/send')).status, 400);
    assert.equal(f.trace.length, 0);
  } finally { await f.close(); }
});

test('primitive JSON input is rejected without terminating the input service', async () => {
  const f = await fixture();
  try {
    for (const payload of ['not-an-object', 7, true, null]) {
      assert.equal((await f.post('/mfa/verify', payload)).status, 400);
    }
    assert.equal((await f.post('/mfa/status')).data.needs_mfa, true);
    assert.equal(f.trace.length, 0);
  } finally { await f.close(); }
});

test('cancelling in-flight verification prevents exchange even if CAS later returns success', async () => {
  const f = await fixture({blockVerify: true});
  try {
    const pending = f.post('/mfa/verify', {code: '123456'});
    await f.started;
    assert.equal((await f.post('/mfa/cancel')).data.cancelled, true);
    f.release();
    assert.equal((await pending).status, 400);
    assert.equal(f.state.exchanged, false);
  } finally { await f.close(); }
});
