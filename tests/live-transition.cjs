'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const{_electron}=require('playwright-core');
const saved=['player.json','settings.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.existsSync(file)?fs.readFileSync(file):null];});
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const instance=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env,timeout:45000});
 try{
  const page=await instance.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲',{timeout:45000});
  await page.locator('#miniCover').click();
  await page.evaluate(async()=>{await saveSettings({crossfade:2,mode:'loop'});const tracks=await Promise.all(['1424460203','29572501'].map(input=>request('song',{input})));queue=tracks;deck.setVolume(settings.volume,true);await playTrack(tracks[0]);});
  await page.waitForFunction(()=>Number.isFinite(audio.duration)&&!audio.paused&&audio.currentTime>.3,{timeout:30000});
  await page.evaluate(()=>audio.currentTime=audio.duration-18);
  await page.waitForFunction(()=>deck.prepared?.track?.id==='29572501'&&deck.spare.readyState>=3,{timeout:25000});
  assert.equal(await page.evaluate(()=>deck.prepared.info.trial),false);
  await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].hide());
  await page.evaluate(()=>audio.currentTime=audio.duration-2.5);
  await page.waitForFunction(()=>!!deck.transition&&current.id==='29572501',{timeout:15000});
  await page.waitForTimeout(350);
  const overlap=await page.evaluate(()=>({oldPlaying:!deck.spare.paused,nextPlaying:!audio.paused,oldGain:deck.nodes.get(deck.spare).value,newGain:deck.nodes.get(audio).value,actual:playInfo.actual,oldTime:deck.spare.currentTime,nextTime:audio.currentTime}));
  assert.ok(overlap.oldPlaying&&overlap.nextPlaying,JSON.stringify(overlap));assert.ok(overlap.oldGain>0&&overlap.oldGain<1&&overlap.newGain>0&&overlap.newGain<1,JSON.stringify(overlap));
  await page.waitForFunction(()=>!deck.transition&&audio.currentTime>1,{timeout:6000});await instance.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].show());await page.locator('#toggle').click();assert.equal(await page.evaluate(()=>deck.spare.paused),true);assert.match(await page.locator('#nowName').innerText(),/Blank Space/);
  assert.deepEqual(errors,[]);console.log('PASS: real After Hours → Blank Space member streams preloaded, decoded and overlapped with a 2-second equal-power crossfade; actual next quality = '+overlap.actual);
 }finally{await instance.close().catch(()=>{});for(const[file,bytes]of saved){if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}}
})().catch(e=>{console.error(e);process.exitCode=1;});
