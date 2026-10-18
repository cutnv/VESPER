'use strict';
const { spawnSync } = require('node:child_process');

function parseIds(input) {
  const found = [];
  for (const line of String(input || '').split(/[\r\n,，;；\s]+/)) {
    if (!line) continue;
    const id = /^\d+$/.test(line) ? line : /(?:[?&]id=|\/song\/)(\d+)/.exec(line)?.[1];
    if (id && !found.includes(id)) found.push(id);
  }
  return found.slice(0, 100);
}

function mergeCookies(current, incoming) {
  const values = new Map();
  for (const item of String(current || '').split(';')) {
    const match = /^\s*([^=\s]+)=(.*)$/.exec(item);
    if (match) values.set(match[1], match[2]);
  }
  const list = Array.isArray(incoming) ? incoming : String(incoming || '').split(/;(?=\s*[^;=\s]+=)/);
  for (const item of list) {
    const match = /^\s*([^=\s]+)=([^;]*)/.exec(item);
    if (match && !/^(path|domain|expires|max-age|samesite|secure|httponly)$/i.test(match[1])) values.set(match[1], match[2]);
  }
  return [...values].map(([key, value]) => `${key}=${value}`).join('; ');
}

function classify(track, detail) {
  if (!track || !track.url) return { state: 'unavailable', label: '未取得播放地址', fullCandidate: false };
  if (track.freeTrialInfo && track.freeTrialInfo !== 'null') {
    return { state: 'trial', label: '仅试听', fullCandidate: false };
  }
  if (detail?.dt && track.time && track.time < detail.dt - 5000) {
    return { state: 'short', label: '返回时长偏短', fullCandidate: false };
  }
  return { state: 'candidate', label: '待实际播放', fullCandidate: true };
}

function safeMediaURL(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      (url.port && !['80', '443'].includes(url.port)) ||
      !['163.com', '126.net'].some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`))) {
    throw new Error('音频地址域名不受支持');
  }
  return url;
}

function protect(value, decrypt = false) {
  // Windows DPAPI：凭证绑定当前 Windows 用户，不放进桌面 / OneDrive。
  const operation = decrypt ? 'Unprotect' : 'Protect';
  const script = `Add-Type -AssemblyName System.Security; $b=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $r=[Security.Cryptography.ProtectedData]::${operation}($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($r))`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
    input: Buffer.from(value).toString('base64'), encoding: 'utf8', windowsHide: true, timeout: 10000,
  });
  if (result.status !== 0) throw new Error('Windows 本机凭证保存失败');
  return Buffer.from(result.stdout.trim(), 'base64');
}


module.exports = { parseIds, mergeCookies, classify, safeMediaURL, protect };
