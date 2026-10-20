'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {execFileSync} = require('node:child_process');
const {saveSession} = require('./login_storage.cjs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'szu-login-storage-test-'));
const configPath = path.join(root, 'config.json');
const endpoint = 'https://console.aicloud.szu.edu.cn';
try {
  const original = {custom: 'keep', auths: {'https://example.invalid': {auth: 'keep'}, [endpoint]: {extra: 'keep'}}};
  fs.writeFileSync(configPath, JSON.stringify(original));
  saveSession(configPath, endpoint, 'synthetic-session');
  const result = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  assert.equal(result.custom, 'keep');
  assert.deepEqual(result.auths['https://example.invalid'], original.auths['https://example.invalid']);
  assert.equal(result.auths[endpoint].extra, 'keep');
  assert.equal(Buffer.from(result.auths[endpoint].auth, 'base64').toString(), 'synthetic-session');
  if (process.platform === 'win32') {
    const acl = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
      '$ErrorActionPreference="Stop"; $a=[System.IO.File]::GetAccessControl($env:SZU_TEST_CONFIG); @{protected=$a.AreAccessRulesProtected; identities=@($a.Access | ForEach-Object {$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}); sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value} | ConvertTo-Json -Compress'],
    {encoding: 'utf8', env: {...process.env, SZU_TEST_CONFIG: configPath}, windowsHide: true}));
    assert.equal(acl.protected, true);
    assert.ok(acl.identities.length > 0 && acl.identities.every(sid => sid === acl.sid));
  } else assert.equal(fs.statSync(configPath).mode & 0o777, 0o600);
  const valid = fs.readFileSync(configPath, 'utf8');
  assert.throws(() => saveSession(configPath, endpoint, 'bad\nsession'));
  assert.equal(fs.readFileSync(configPath, 'utf8'), valid);
  for (const invalid of ['not json', 'null', '{"auths":[]}']) {
    fs.writeFileSync(configPath, invalid);
    assert.throws(() => saveSession(configPath, endpoint, 'synthetic-session'));
    assert.equal(fs.readFileSync(configPath, 'utf8'), invalid);
  }
  assert.deepEqual(fs.readdirSync(root), ['config.json']);
  console.log('PASS: atomic session merge, file permissions, invalid input preservation, temporary-file cleanup');
} finally {
  // Remove only exact files this test created, then its own empty temporary directory.
  if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  fs.rmdirSync(root);
}
