'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const {spawn} = require('node:child_process');

test('full local CAS/MFA flow preserves cookies, submits password once, exchanges A for B and saves B', {timeout: 12000}, async () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'szu-login-integration-'));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const origin = `http://127.0.0.1:${port}`, config = path.join(temp, 'config.json');
  const child = spawn(process.execPath, ['--require', path.join(__dirname, 'fixtures/login_https.cjs'),
    path.join(__dirname, '../skills/szu-compute-platform/scripts/login_local.cjs')], {
    env: {...process.env, SZU_LOGIN_PORT: String(port), SZU_LOGIN_CONFIG: config, SZU_LOGIN_STATUS_DIR: temp,
      SZU_LOGIN_TENANT: 'szdx', SZU_LOGIN_PRODUCT: 'heros', SZU_LOGIN_TTL_MINUTES: '1'},
    stdio: 'pipe', windowsHide: true,
  });
  let stdout = '', stderr = '', exited = false;
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => { stderr += b; });
  const exit = new Promise(resolve => child.on('exit', code => { exited = true; resolve(code); }));
  const post = async (route, payload, nonce) => {
    const res = await fetch(origin + route, {method: 'POST', headers: {Origin: origin,
      'Content-Type': 'application/json', 'X-Login-Nonce': nonce}, body: JSON.stringify(payload)});
    return {status: res.status, data: await res.json()};
  };
  try {
    for (let i = 0; i < 60 && !stdout.includes('LOCAL_INPUT_READY'); i++) {
      if (exited) throw Error('Fixture child failed before input readiness');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const initialHealth = await (await fetch(origin + '/health')).json();
    let html = await (await fetch(origin)).text();
    let nonce = JSON.parse(html.match(/const nonce=("[a-f0-9]+")/)[1]);
    const login = await post('/login', {mode: 'cas', username: 'fixture-school-user', password: 'fixture-password'}, nonce);
    assert.equal(login.data.needs_mfa, true);
    html = await (await fetch(origin)).text();
    assert.equal((await (await fetch(origin + '/health')).json()).session_id, initialHealth.session_id);
    assert.ok(html.includes('发送验证码')); assert.ok(html.includes('type="password"'));
    nonce = JSON.parse(html.match(/const csrf=("[a-f0-9]+")/)[1]);
    assert.equal((await post('/mfa/send', {}, nonce)).data.sent, true);
    assert.equal((await post('/mfa/verify', {code: '000000'}, nonce)).status, 400);
    assert.equal(fs.existsSync(config), false);
    const success = await post('/mfa/verify', {code: '123456'}, nonce);
    assert.equal(success.data.ok, true);
    const saved = JSON.parse(fs.readFileSync(config, 'utf8'));
    assert.equal(Buffer.from(saved.auths['https://console.aicloud.szu.edu.cn'].auth, 'base64').toString(), 'fixture-token-b');
    const status = JSON.parse(fs.readFileSync(path.join(temp, 'auth-status.json')));
    assert.equal(status.verified, true); assert.equal(status.session_id, initialHealth.session_id);
    assert.equal(await exit, 0);
    assert.equal(stderr, '');
    assert.deepEqual(JSON.parse(stdout.match(/FIXTURE_COUNTS (\{[^\n]+\})/)[1]),
      {passwords: 1, verifications: 2, sends: 1, profiles: 2, exchanges: 1});
    for (const secret of ['fixture-password', 'fixture-pub-password', 'fixture-token-a', 'fixture-token-b', 'fixture-cas-cookie', '123456']) {
      assert.ok(!stdout.includes(secret)); assert.ok(!JSON.stringify(success).includes(secret));
    }
  } finally {
    if (!exited) { child.kill(); await exit; }
    // This directory is the literal mkdtemp result and contains synthetic test files only.
    fs.rmSync(temp, {recursive: true, force: true});
  }
});
