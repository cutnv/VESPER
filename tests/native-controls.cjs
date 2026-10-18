'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const{_electron}=require('playwright-core');
const files=['player.json','settings.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.existsSync(file)?fs.readFileSync(file):null];});
function wav(){const rate=8000,samples=rate*60,data=Buffer.alloc(44+samples*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);return data;}
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
const launch=()=>_electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env,timeout:45000});
(async()=>{
 let instance=await launch();
 try{
  const page=await instance.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲',{timeout:45000});
  if(process.argv.includes('--status-only')){console.log(JSON.stringify(await page.evaluate(()=>window.desktop.getShortcuts())));return;}
  await instance.evaluate(({BrowserWindow})=>{const win=BrowserWindow.getAllWindows()[0],native=win.setThumbarButtons.bind(win);global.cloudTuneThumbnailHistory=[];win.setThumbarButtons=buttons=>{global.cloudTuneThumbnailButtons=buttons;const accepted=native(buttons);global.cloudTuneThumbnailHistory.push({accepted,tooltips:buttons.map(b=>b.tooltip),icons:buttons.map(b=>!b.icon.isEmpty()),flags:buttons.map(b=>b.flags)});return accepted;};});
  const data=wav();await page.route('**/native-controls.wav',route=>route.fulfill({contentType:'audio/wav',body:data}));
  await page.route('**/api/play',route=>{if(!route.request().postDataJSON().id.startsWith('991'))return route.continue();return route.fulfill({json:{url:'/native-controls.wav',actual:'exhigh',type:'wav',bitrate:128000,trial:false}});});
  await page.route('**/api/lyrics',route=>{if(!route.request().postDataJSON().id.startsWith('991'))return route.continue();return route.fulfill({json:{lines:[],translation:[]}});});
  await page.evaluate(async()=>{await saveSettings({crossfade:0});queue=['1','2','3'].map(s=>({id:'991000000'+s,name:'原生控制测试 '+s,source:'netease',artists:'测试音轨',duration:60000,cover:''}));deck.setVolume(settings.volume,true);await playTrack(queue[0]);});
  await page.waitForFunction(()=>!audio.paused&&audio.currentTime>.1);
  let thumbnail=await instance.evaluate(()=>global.cloudTuneThumbnailHistory.at(-1));assert.equal(thumbnail.accepted,true);assert.deepEqual(thumbnail.tooltips,['上一首','暂停','下一首']);assert.ok(thumbnail.icons.every(Boolean));
  await instance.evaluate(()=>global.cloudTuneThumbnailButtons[1].click());await page.waitForFunction(()=>audio.paused);await page.waitForTimeout(100);thumbnail=await instance.evaluate(()=>global.cloudTuneThumbnailHistory.at(-1));assert.equal(thumbnail.tooltips[1],'播放');
  await instance.evaluate(()=>global.cloudTuneThumbnailButtons[1].click());await page.waitForFunction(()=>!audio.paused);
  await instance.evaluate(()=>global.cloudTuneThumbnailButtons[2].click());await page.waitForFunction(()=>current.id==='9910000002'&&!audio.paused);
  await instance.evaluate(()=>global.cloudTuneThumbnailButtons[0].click());await page.waitForFunction(()=>current.id==='9910000001'&&!audio.paused);
  await page.locator('#toggle').click();console.log('PASS: Windows accepted three real thumbnail buttons; icons, play/pause tooltips and all three control callbacks work');
  await page.locator('#settingsButton').click();await page.locator('#shortcutNext').click();await page.locator('#shortcutNext').press('Control+Alt+F11');await page.locator('#shortcutPrevious').click();await page.locator('#shortcutPrevious').press('Control+Alt+F9');await page.locator('#shortcutToggle').click();await page.locator('#shortcutToggle').press('Control+Alt+F10');
  await page.locator('#shortcutsEnabled').check();await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('已保存'));
  const saved=JSON.parse(fs.readFileSync(path.join(root,'data/settings.json'),'utf8')).shortcuts;assert.equal(saved.next,'Control+Alt+F11');assert.equal(saved.previous,'Control+Alt+F9');assert.equal(saved.toggle,'Control+Alt+F10');
  await page.locator('#shortcutNext').click();await page.locator('#shortcutNext').press('Control+Alt+F9');await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('不能使用相同'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/settings.json'),'utf8')).shortcuts.next,'Control+Alt+F11');
  assert.equal(await instance.evaluate(({globalShortcut})=>globalShortcut.register('Control+Alt+F12',()=>{})),true);
  await page.locator('#shortcutNext').click();await page.locator('#shortcutNext').press('Control+Alt+F12');await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('占用'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'data/settings.json'),'utf8')).shortcuts.next,'Control+Alt+F11');
  await instance.evaluate(({globalShortcut})=>globalShortcut.unregister('Control+Alt+F12'));
  await page.locator('#shortcutNext').click();await page.locator('#shortcutNext').press('Control+Alt+F11');await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('已保存'));
  await page.screenshot({path:path.join(__dirname,'shortcut-settings.png'),animations:'disabled'});
  await page.locator('[data-close-dialog=settingsDialog]').click();await page.waitForFunction(async()=>Object.values((await window.desktop.getShortcuts()).registered).every(Boolean));
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].minimize());
  const send=key=>execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'send-hotkey.ps1'),'-KeyCode',String(key)],{windowsHide:true,timeout:10000});
  send(122);await page.waitForFunction(()=>current.id==='9910000002'&&!audio.paused,{timeout:5000});
  send(120);await page.waitForFunction(()=>current.id==='9910000001'&&!audio.paused,{timeout:5000});
  send(121);await page.waitForFunction(()=>audio.paused,{timeout:5000});
  assert.equal(await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isMinimized()),true);
  console.log('PASS: custom global shortcuts receive real Windows key events while minimized; duplicate/conflict errors preserve saved bindings');
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].restore());
  await page.locator('#settingsButton').click();await page.locator('#shortcutsEnabled').uncheck();await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('已关闭'));await page.locator('[data-close-dialog=settingsDialog]').click();assert.ok(Object.values((await page.evaluate(()=>window.desktop.getShortcuts())).registered).every(value=>!value));
  await page.locator('#settingsButton').click();await page.locator('#shortcutsEnabled').check();await page.locator('#saveShortcuts').click();await page.waitForFunction(()=>document.getElementById('shortcutsStatus').textContent.includes('已保存'));await page.locator('[data-close-dialog=settingsDialog]').click();
  assert.deepEqual(errors,[]);await instance.close();instance=await launch();const reopened=await instance.firstWindow();await reopened.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲',{timeout:45000});
  const state=await reopened.evaluate(()=>window.desktop.getShortcuts());assert.equal(state.config.next,'Control+Alt+F11');assert.ok(Object.values(state.registered).every(Boolean));
  console.log('PASS: disable/enable, persistence and actual shortcut re-registration after restart');
 }finally{await instance.close().catch(()=>{});for(const[file,bytes]of files){if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}}
})().catch(error=>{console.error(error);process.exitCode=1;});
