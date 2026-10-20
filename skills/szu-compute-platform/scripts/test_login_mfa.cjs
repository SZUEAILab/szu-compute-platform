'use strict';
// Synthetic local-only verification. No requests reach school/platform services.
const assert = require('node:assert/strict');
const http = require('node:http');
const {install} = require('./login_mfa.cjs');

(async () => {
  const server = http.createServer((req, res) => { res.writeHead(404); res.end(); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const PORT = server.address().port, ORIGIN = `http://127.0.0.1:${PORT}`;
  const CAS = 'https://authserver.szu.edu.cn', ENDPOINT = 'https://console.aicloud.szu.edu.cn';
  const service = ENDPOINT + '/gateway/ram/api/v1/cas/action/login';
  const LOGIN = CAS + '/authserver/login?service=' + encodeURIComponent(service);
  let sends = 0, submissions = 0, exchanged = false;
  const response = data => ({status: 200, headers: {}, text: JSON.stringify(data), url: CAS + '/authserver/reAuth'});
  try {
    const result = install({server, CAS, ENDPOINT, LOGIN, PORT, ORIGIN,
      expiresAt: Date.now() + 60000, getState: () => ({busy: false, finished: false}),
      initialResponse: {status: 200, headers: {}, url: CAS + '/authserver/reAuth', text:
        '<script>var reAuthParams = ' + JSON.stringify({service, reAuthType: '4', isMultifactor: true, reAuthUserId: 'synthetic-user'}) + ';</script>'},
      request: async (url, method, fields) => {
        if (url.endsWith('/dynamicCode/getDynamicCodeByReauth.do')) {
          sends++; assert.equal(method, 'POST');
          assert.equal(fields.get('authCodeTypeName'), 'reAuthWChatDynamicCodeType');
          assert.equal(fields.get('userName'), 'synthetic-user');
          return response({res: 'wechat_success'});
        }
        if (url.endsWith('/reAuthCheck/reAuthSubmit.do')) {
          submissions++; assert.equal(method, 'POST');
          assert.equal(fields.get('password'), ''); assert.equal(fields.get('service'), service);
          assert.equal(fields.get('reAuthType'), '4'); assert.equal(fields.get('isMultifactor'), 'true');
          assert.equal(fields.get('dynamicCode'), '123456');
          return response({code: submissions === 1 ? 'reAuth_failed' : 'reAuth_success'});
        }
        assert.equal(url, LOGIN);
        return {status: 302, headers: {location: ENDPOINT + '/index.html#/home?token=synthetic-token'}, text: '', url};
      },
      profile: async token => { assert.equal(token, 'synthetic-token'); return {id: 'synthetic-account'}; },
      exchange: async user => { assert.equal(user.id, 'synthetic-account'); exchanged = true; return {ok: true, message: 'verified'}; }
    });
    assert.equal(result.needs_mfa, true);
    const html = await (await fetch(ORIGIN)).text();
    const csrf = JSON.parse(/const csrf=("[a-f0-9]+");/.exec(html)[1]);
    const post = (route, body = {}, nonce = csrf) => fetch(ORIGIN + route, {
      method: 'POST', headers: {Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Login-Nonce': nonce},
      body: JSON.stringify(body)
    });
    assert.equal((await post('/mfa/send', {}, 'wrong')).status, 403);
    assert.equal(sends, 0);
    const status = await (await post('/mfa/status')).json();
    assert.equal(status.needs_mfa, true);
    const health = await (await fetch(ORIGIN + '/health')).json();
    assert.equal(health.has_mfa_parameters, true);
    assert.ok(!JSON.stringify(health).includes('synthetic-user'));
    assert.equal((await (await post('/mfa/send')).json()).sent, true);
    assert.equal((await post('/mfa/send')).status, 400);
    assert.equal(sends, 1);
    assert.equal((await post('/mfa/verify', {code: '123456'})).status, 400);
    assert.equal(exchanged, false);
    assert.equal((await (await post('/mfa/verify', {code: '123456'})).json()).ok, true);
    assert.equal(exchanged, true);
    console.log('PASS: MFA state, CSRF, WeChat code route, duplicate-send protection, failed verification, successful callback and exchange');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
