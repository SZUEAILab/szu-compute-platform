'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {execFileSync} = require('node:child_process');

function restrictFile(file) {
  if (process.platform !== 'win32') { fs.chmodSync(file, 0o600); return; }
  const sid = execFileSync('powershell.exe', ['-NoProfile', '-Command',
    '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value'],
  {encoding: 'utf8', windowsHide: true}).trim();
  if (!/^S-1-[0-9-]+$/.test(sid)) throw Error('无法取得当前用户 SID，未保存会话');
  execFileSync('icacls.exe', [file, '/inheritance:r', '/grant:r', `*${sid}:(F)`],
    {stdio: 'ignore', windowsHide: true});
}

function saveSession(configPath, endpoint, token) {
  if (typeof token !== 'string' || !token || /[\r\n]/.test(token)) throw Error('会话 token 无效，未保存');
  const directory = path.dirname(configPath);
  fs.mkdirSync(directory, {recursive: true});
  let config = {};
  try { if (fs.existsSync(configPath)) config = JSON.parse(fs.readFileSync(configPath, 'utf8').replace(/^\uFEFF/, '')); }
  catch { throw Error('现有认证配置无法解析，未覆盖'); }
  const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  if (!object(config) || (config.auths !== undefined && !object(config.auths))) {
    throw Error('现有认证配置结构异常，未覆盖');
  }
  config.auths ||= {};
  if (config.auths[endpoint] !== undefined && !object(config.auths[endpoint])) {
    throw Error('现有 endpoint 配置结构异常，未覆盖');
  }
  config.auths[endpoint] = {...config.auths[endpoint], auth: Buffer.from(token, 'utf8').toString('base64')};
  const temporary = path.join(directory, `.szu-login-${crypto.randomBytes(12).toString('hex')}.tmp`);
  let descriptor;
  try {
    // Restrict the empty temporary file before writing any credential.
    descriptor = fs.openSync(temporary, 'wx', 0o600);
    restrictFile(temporary);
    fs.writeFileSync(descriptor, JSON.stringify(config, null, 2), 'utf8');
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor); descriptor = undefined;
    fs.renameSync(temporary, configPath);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = {saveSession};
