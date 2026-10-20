'use strict';
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {spawn, spawnSync} = require('node:child_process');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'szu-login-service-test-'));
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const script = path.join(__dirname, 'login_local.cjs');
  const config = path.join(root, 'config.json');
  const statusPath = path.join(root, 'auth-status.json');
  fs.writeFileSync(statusPath, JSON.stringify({verified: true, session_id: 'old-session', verified_at: '2000-01-01T00:00:00Z'}));
  const env = {...process.env, SZU_LOGIN_PORT: String(port), SZU_LOGIN_TTL_MINUTES: '1',
    SZU_LOGIN_CONFIG: config, SZU_LOGIN_STATUS_DIR: root};
  const child = spawn(process.execPath, [script], {env, windowsHide: true, stdio: 'pipe'});
  let exited = false;
  const exit = new Promise(resolve => child.once('exit', code => { exited = true; resolve(code); }));
  child.stdout.resume(); child.stderr.resume();
  const origin = `http://127.0.0.1:${port}`;
  try {
    let health;
    for (let i = 0; i < 40; i++) {
      try { health = await (await fetch(origin + '/health')).json(); break; } catch {}
      if (exited) throw Error('Local input process exited during startup');
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(health?.ready, true);
    const initial = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(initial.verified, false);
    assert.equal(initial.status, 'awaiting_input');
    assert.equal(initial.session_id, health.session_id);
    assert.notEqual(initial.session_id, 'old-session');
    const page = await fetch(origin);
    assert.equal(page.headers.get('cache-control'), 'no-store');
    assert.ok(page.headers.get('content-security-policy').includes("frame-ancestors 'none'"));
    const html = await page.text();
    const nonce = JSON.parse(/const nonce=("[a-f0-9]+");/.exec(html)[1]);
    let response = await fetch(origin + '/login', {method: 'POST',
      headers: {'Content-Type': 'application/json'}, body: '{}'});
    assert.equal(response.status, 403);
    response = await fetch(origin + '/login', {method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Login-Nonce': nonce}, body: '{'});
    assert.equal(response.status, 400);
    for (const payload of ['not-an-object', true, 7, null]) {
      response = await fetch(origin + '/login', {method: 'POST',
        headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Login-Nonce': nonce}, body: JSON.stringify(payload)});
      assert.equal(response.status, 400);
    }
    assert.equal((await (await fetch(origin + '/health')).json()).ready, true);
    assert.equal(fs.existsSync(config), false);
    response = await fetch(origin + '/cancel', {method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json', 'X-Login-Nonce': nonce}, body: '{}'});
    assert.equal((await response.json()).cancelled, true);
    const code = await Promise.race([exit, new Promise((_, reject) => {
      const timer = setTimeout(() => reject(Error('Cancel did not stop input service')), 4000); timer.unref();
    })]);
    assert.equal(code, 0);
    const final = JSON.parse(fs.readFileSync(statusPath, 'utf8'));
    assert.equal(final.verified, false);
    assert.equal(final.status, 'cancelled');
    assert.equal(final.session_id, health.session_id);
    assert.deepEqual(fs.readdirSync(root), ['auth-status.json']);
    const invalid = spawnSync(process.execPath, [script], {env: {...env, SZU_LOGIN_PORT: '0'}, encoding: 'utf8', windowsHide: true});
    assert.equal(invalid.status, 2);
    const collision = spawnSync(process.execPath, [script], {env: {...env, SZU_LOGIN_CONFIG: statusPath}, encoding: 'utf8', windowsHide: true});
    assert.equal(collision.status, 2);
    assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).status, 'cancelled');
    console.log('PASS: input service startup, stale status invalidation and session binding, no-store headers, source/nonce validation, malformed input, cancel/exit, invalid port; no real authentication');
  } finally {
    if (!exited) { child.kill(); await exit; }
    if (fs.existsSync(statusPath)) fs.unlinkSync(statusPath);
    fs.rmdirSync(root);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
