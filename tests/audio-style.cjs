'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const{_electron}=require('playwright-core');
function wav(seconds,frequency){const rate=16000,samples=rate*seconds,data=Buffer.alloc(44+samples*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(rate,24);data.writeUInt32LE(rate*2,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(Math.sin(i/rate*frequency*Math.PI*2)*5000),44+i*2);return data;}
const files=new Map(['player.json','settings.json','favorites.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.existsSync(file)?fs.readFileSync(file):null];}));
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env,timeout:45000});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲',{timeout:45000});
  await page.locator('#miniCover').click();
  await page.waitForFunction(()=>document.documentElement.style.getPropertyValue('--cover-mist').startsWith('url('),{timeout:20000});
  const bar=await page.evaluate(()=>{const b=document.getElementById('closeLyrics').getBoundingClientRect(),buttons=[...document.querySelectorAll('[data-window]')].map(x=>{const r=x.getBoundingClientRect();return{center:r.top+r.height/2,svg:!!x.querySelector('svg')};});return{center:b.top+b.height/2,buttons,weight:getComputedStyle(document.querySelector('.lyric-line:not(.credit)')).fontWeight,size:parseFloat(getComputedStyle(document.querySelector('.lyric-line:not(.credit)')).fontSize),settings:getComputedStyle(document.getElementById('settingsButton')).display,queue:getComputedStyle(document.getElementById('queueButton')).display};});
  assert.ok(bar.buttons.every(b=>b.svg&&Math.abs(b.center-bar.center)<2),JSON.stringify(bar));assert.ok(Number(bar.weight)>=650);assert.ok(bar.size>=28);assert.equal(bar.settings,'none');assert.equal(bar.queue,'none');
  const first=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--art-color-0'));
  await page.evaluate(async()=>{const song=await request('song',{input:'29572501'});await updateArtwork(song);});
  const second=await page.evaluate(()=>document.documentElement.style.getPropertyValue('--art-color-0'));assert.notEqual(first,second);
  await page.evaluate(()=>updateArtwork(current));await page.waitForTimeout(500);await page.screenshot({path:path.join(__dirname,'apple-style-player.png'),animations:'disabled'});
  console.log('PASS: real artwork palettes differ, same-row SVG controls, Apple-style typography, player-only minimal controls');
  let trial=false;const audioFiles={a:wav(10,440),b:wav(12,660),c:wav(10,880)};
  await page.route('**/fixture-*.wav',route=>{const id=/fixture-([abc])\.wav/.exec(route.request().url())[1],data=audioFiles[id],range=route.request().headers().range;if(range){const start=Number(/bytes=(\d+)/.exec(range)?.[1]||0);return route.fulfill({status:206,headers:{'Content-Type':'audio/wav','Accept-Ranges':'bytes','Content-Range':`bytes ${start}-${data.length-1}/${data.length}`},body:data.subarray(start)});}return route.fulfill({contentType:'audio/wav',headers:{'Accept-Ranges':'bytes'},body:data});});
  await page.route('**/api/play',route=>{const b=route.request().postDataJSON(),letter={'9900000001':'a','9900000002':'b','9900000003':'c'}[b.id];if(!letter)return route.continue();return route.fulfill({json:{url:'/fixture-'+letter+'.wav',actual:'exhigh',type:'wav',bitrate:256000,trial:trial&&letter==='b'}});});
  await page.route('**/api/lyrics',route=>{if(!route.request().postDataJSON().id.startsWith('990'))return route.continue();return route.fulfill({json:{lines:[{time:0,text:'交叉淡入淡出测试'},{time:2,text:'双音轨重叠播放'},{time:5,text:'暂停与继续保持同步'}],translation:[]}});});
  await page.evaluate(async()=>{await saveSettings({crossfade:4,mode:'loop'});queue=['1','2','3'].map((s,i)=>({id:'990000000'+s,source:'netease',name:'衔接测试 '+s,artists:'测试音轨',duration:(i===1?12:10)*1000,cover:''}));deck.setVolume(settings.volume,true);await playTrack(queue[0]);});
  await page.waitForFunction(()=>deck.prepared?.track?.id==='9900000002'&&deck.spare.readyState>=3,{timeout:10000});
  await page.evaluate(()=>audio.currentTime=5.6);await page.waitForFunction(()=>!!deck.transition,{timeout:10000});await page.waitForTimeout(650);
  const overlap=await page.evaluate(()=>({oldPlaying:!deck.spare.paused,newPlaying:!audio.paused,oldTime:deck.spare.currentTime,newTime:audio.currentTime,oldGain:deck.nodes.get(deck.spare).value,newGain:deck.nodes.get(audio).value,current:current.id}));
  assert.equal(overlap.oldPlaying,true);assert.equal(overlap.newPlaying,true);assert.equal(overlap.current,'9900000002');assert.ok(overlap.oldGain>0&&overlap.oldGain<1,JSON.stringify(overlap));assert.ok(overlap.newGain>0&&overlap.newGain<1,JSON.stringify(overlap));
  await page.locator('#toggle').click();await page.waitForFunction(()=>deck.context.state==='suspended');const paused=await page.evaluate(()=>[audio.currentTime,deck.spare.currentTime]);await page.waitForTimeout(4300);
  const afterPause=await page.evaluate(()=>({times:[audio.currentTime,deck.spare.currentTime],transition:!!deck.transition,paused:audio.paused&&deck.spare.paused}));assert.equal(afterPause.paused,true);assert.equal(afterPause.transition,true);assert.ok(afterPause.times.every((t,i)=>Math.abs(t-paused[i])<.15));
  await page.locator('#toggle').click();await page.waitForFunction(()=>!deck.transition,{timeout:6000});assert.equal(await page.evaluate(()=>deck.spare.paused),true);assert.equal(await page.evaluate(()=>deck.nodes.get(audio).value),1);
  console.log('PASS: two real decoded tones overlap with equal-power gain ramps; pause freezes both tracks and ramp; resume completes the transition');
  await page.waitForFunction(()=>deck.prepared?.track?.id==='9900000003',{timeout:5000});await page.evaluate(()=>audio.currentTime=audio.duration-3.6);await page.waitForFunction(()=>!!deck.transition,{timeout:5000});
  await page.evaluate(()=>{document.getElementById('seek').value=300;document.getElementById('seek').dispatchEvent(new Event('input'));});
  await page.waitForFunction(()=>!deck.transition&&deck.spare.paused&&Math.abs(deck.nodes.get(audio).value-1)<.001,{timeout:1500});
  assert.equal(await page.evaluate(()=>!!deck.transition),false);assert.equal(await page.evaluate(()=>deck.spare.paused),true);assert.equal(await page.evaluate(()=>deck.nodes.get(audio).value),1);
  await page.evaluate(()=>{queue=[];updateQueueCount();});assert.equal(await page.evaluate(()=>deck.prepared),null);
  trial=true;await page.evaluate(async()=>{queue=['1','2'].map(s=>({id:'990000000'+s,source:'netease',name:'试听权限测试 '+s,artists:'测试',duration:10000,cover:''}));await playTrack(queue[0]);});await page.waitForFunction(()=>deck.prepared?.unavailable===true,{timeout:5000});await page.evaluate(()=>audio.currentTime=7);await page.waitForTimeout(500);assert.equal(await page.evaluate(()=>!!deck.transition),false);
  await page.evaluate(async()=>{await saveSettings({crossfade:0});deck.reset();await playTrack(queue[0]);audio.currentTime=7;});await page.waitForTimeout(600);assert.equal(await page.evaluate(()=>deck.prepared),null);assert.equal(await page.evaluate(()=>!!deck.transition),false);
  await page.evaluate(()=>deck.pause());assert.deepEqual(errors,[]);
  console.log('PASS: seeking and queue changes cancel old audio; previews never crossfade; setting 0 disables overlap; no renderer errors');
 }finally{await app.close().catch(()=>{});for(const[file,bytes]of files){if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}}
})().catch(e=>{console.error(e);process.exitCode=1;});
