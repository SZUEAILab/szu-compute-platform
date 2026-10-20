'use strict';
// Preloaded ONLY by the integration test child; no real HTTPS is performed.
const https = require('node:https');
const {EventEmitter} = require('node:events');
const {Readable} = require('node:stream');
const assert = require('node:assert/strict');
const CAS = 'https://authserver.szu.edu.cn', PLATFORM = 'https://console.aicloud.szu.edu.cn';
const service = PLATFORM + '/gateway/ram/api/v1/cas/action/login';
let passwords = 0, verifications = 0, sends = 0, profiles = 0, exchanges = 0, resumed = false;
const user = {id: 'fixture-id', name: 'fixture-platform-user', productId: 'heros',
  pubPassword: 'fixture-pub-password', tenantInfo: {id: 'fixture-tenant', name: 'szdx'}};
function answer(url, options, raw) {
  const u = new URL(url), headers = options.headers;
  const fields = new URLSearchParams(raw);
  const json = data => ({status: 200, text: JSON.stringify(data)});
  const platform = data => json({message: {code: 0}, data});
  if (u.origin === PLATFORM) {
    assert.ok(!headers.Cookie?.includes('fixture-cas-cookie'));
    if (u.pathname === '/gateway/ram/api/v1/cas/action/login') {
      return {status: 302, headers: {location: PLATFORM + '/#/login?token=fixture-token-a'}};
    }
    if (u.pathname === '/gateway/ram/api/v1/tenant') {
      profiles++; assert.ok(['fixture-token-a', 'fixture-token-b'].includes(headers.token));
      return platform(user);
    }
    assert.equal(u.pathname, '/gateway/ram/api/v1/tenant/user/login'); exchanges++;
    assert.deepEqual(JSON.parse(raw), {name: user.name, password: user.pubPassword, tenantName: 'szdx', productId: 'heros'});
    return platform({token: 'fixture-token-b'});
  }
  assert.equal(u.origin, CAS); assert.equal(headers.token, undefined);
  if (u.pathname === '/authserver/checkNeedCaptcha.htl') return json({isNeed: false});
  if (u.pathname === '/authserver/login' && options.method === 'GET') {
    if (resumed) {
      assert.match(headers.Cookie, /CASSESSION=fixture-cas-cookie/);
      assert.match(headers.Cookie, /MFASTATE=fixture-mfa-cookie/);
      return {status: 302, headers: {location: service + '?ticket=fixture-ticket'}};
    }
    return {status: 200, headers: {'set-cookie': ['CASSESSION=fixture-cas-cookie; Path=/authserver; Secure']}, text:
      '<form id="pwdFromId"><input type="hidden" name="execution" value="fixture-execution"><input type="hidden" id="pwdEncryptSalt" value="1234567890123456"></form>'};
  }
  if (u.pathname === '/authserver/login') {
    passwords++; assert.equal(passwords, 1); assert.equal(fields.get('username'), 'fixture-school-user');
    assert.equal(fields.get('execution'), 'fixture-execution');
    assert.ok(fields.get('password') && fields.get('password') !== 'fixture-password');
    return {status: 302, headers: {location: CAS + '/authserver/reAuthCheck/reAuthView.do'}};
  }
  if (u.pathname === '/authserver/reAuthCheck/reAuthView.do') {
    return {status: 200, headers: {'set-cookie': ['MFASTATE=fixture-mfa-cookie; Path=/authserver; Secure']}, text:
      '<script src="/authserver/cusSzuTheme/static/custom/js/reAuth.js"></script><script>var reAuthParams = ' +
      JSON.stringify({service, reAuthType: '4', isMultifactor: true, reAuthUserId: 'fixture-reauth-user'}) + ';</script>'};
  }
  assert.match(headers.Cookie, /CASSESSION=fixture-cas-cookie/);
  assert.match(headers.Cookie, /MFASTATE=fixture-mfa-cookie/);
  if (u.pathname === '/authserver/dynamicCode/getDynamicCodeByReauth.do') {
    sends++; assert.equal(fields.get('authCodeTypeName'), 'reAuthWChatDynamicCodeType');
    return json({res: 'wechat_success', codeTime: 120});
  }
  assert.equal(u.pathname, '/authserver/reAuthCheck/reAuthSubmit.do'); verifications++;
  assert.equal(fields.get('service'), service); assert.equal(fields.get('skipTmpReAuth'), 'false');
  if (fields.get('dynamicCode') !== '123456') return json({code: 'reAuth_failed'});
  resumed = true; return json({code: 'reAuth_success'});
}
https.request = (url, options, callback) => {
  const req = new EventEmitter(); let body = '';
  req.write = value => { body += value; }; req.setTimeout = () => req;
  req.destroy = () => req.emit('error', Error('fixture request cancelled'));
  req.end = () => queueMicrotask(() => {
    try {
      const a = answer(url, options, body), res = Readable.from([Buffer.from(a.text || '')]);
      res.statusCode = a.status; res.headers = a.headers || {}; callback(res);
    } catch (error) { console.error('FIXTURE_ASSERTION_FAILED', error.message); req.emit('error', error); }
  });
  return req;
};
process.on('exit', () => console.log('FIXTURE_COUNTS ' + JSON.stringify({passwords, verifications, sends, profiles, exchanges})));
