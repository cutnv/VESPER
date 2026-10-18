'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const{_electron}=require('playwright-core');
const saved=['player.json','settings.json','favorites.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.existsSync(file)?fs.readFileSync(file):null];});
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const instance=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env,timeout:45000});
 try{
  const page=await instance.firstWindow(),errors=[];let fakeWrites=0,failWrite=false,failSync=false;page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/favorite',route=>{fakeWrites++;const body=route.request().postDataJSON();if(failWrite)return route.fulfill({status:400,json:{error:'测试：云端更新失败'}});return route.fulfill({json:{id:body.track.id,enabled:body.enabled,owner:accountId}});});
  await page.route('**/api/likes',route=>failSync?route.fulfill({json:{status:'error',ids:null,owner:accountId,error:'测试：红心同步失败'}}):route.continue());
  await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲'&&cloudLikesStatus==='ready',{timeout:45000});
  const model=await page.evaluate(()=>({ids:[...cloudLikeIds],owner:account.id,local:favorites.length}));const accountId=model.owner;assert.ok(model.ids.length>0,'Real cloud liked songs should not be empty');
  await page.evaluate(()=>{window.removeEventListener('focus',syncHeartsOnReturn);document.removeEventListener('visibilitychange',syncHeartsOnReturn);});
  assert.equal(await page.locator('#searchForm kbd').count(),0);assert.equal(await page.locator('.toolbar>span').count(),0);
  for(const width of[1040,1460]){await instance.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setBounds({x:20,y:20,width,height:800}),width);await page.waitForTimeout(100);const drift=await page.locator('#searchForm').evaluate(e=>{const r=e.getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2);});assert.ok(drift<1,'Search center drift '+drift);}
  await page.locator('[data-view=favorites]').click();await page.waitForFunction(()=>document.querySelector('.view-subtitle')?.textContent.includes('网易云红心'));
  assert.match(await page.locator('.view-subtitle').innerText(),new RegExp(String(model.ids.length)));assert.equal(await page.locator('.song-table tbody tr').count(),Math.min(400,model.ids.length)+model.local);
  await page.evaluate(()=>{window.actualPlayTrack=playTrack;playTrack=async()=>{};});await page.getByRole('button',{name:'播放全部',exact:true}).click();assert.equal(await page.evaluate(()=>queue.length),Math.min(400,model.ids.length)+model.local);assert.equal(await page.locator('#queueCount').innerText(),String(Math.min(400,model.ids.length)+model.local));
  await page.locator('#closeLyrics').click();await page.evaluate(()=>{playTrack=window.actualPlayTrack;delete window.actualPlayTrack;});
  const cloudRows=page.locator('.table-actions [data-heart-source=netease]');assert.ok(await cloudRows.count()>0);for(const heart of await cloudRows.all())assert.equal(await heart.getAttribute('aria-pressed'),'true');
  await page.mouse.move(20,75);await page.screenshot({path:path.join(__dirname,'cloud-hearts.png'),animations:'disabled'});
  if(model.ids.length>400){await page.locator('#mainContent').evaluate(node=>node.scrollTop=node.scrollHeight);await page.waitForFunction(()=>document.querySelectorAll('.song-table tbody tr').length>400);assert.equal(await page.locator('.song-table tbody tr').count(),Math.min(800,model.ids.length)+model.local);}
  const target=await page.evaluate(async()=>request('song',{input:[...cloudLikeIds].at(-1)}));
  await page.route('**/api/search',route=>route.fulfill({json:{songs:[target],total:1,offset:0}}));
  await page.locator('#searchInput').fill('红心状态核对');await page.locator('#searchInput').press('Enter');await page.locator('.song-table tbody tr').first().waitFor();
  const rowHeart=page.locator('.table-actions [data-heart-source=netease]').first();assert.equal(await rowHeart.getAttribute('aria-pressed'),'true');
  await page.evaluate(track=>{current=track;updateCurrentUI();},target);assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'true');await page.locator('#miniCover').click();assert.equal(await page.locator('#nowFavorite').getAttribute('aria-pressed'),'true');
  await page.locator('#nowFavorite').click();await page.waitForFunction(()=>document.getElementById('favorite').getAttribute('aria-pressed')==='false');assert.equal(await rowHeart.getAttribute('aria-pressed'),'false');
  await page.locator('#nowFavorite').click();await page.waitForFunction(()=>document.getElementById('favorite').getAttribute('aria-pressed')==='true');
  failWrite=true;await page.locator('#nowFavorite').click();await page.waitForFunction(()=>!document.getElementById('nowFavorite').disabled);assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'true');assert.match(await page.locator('#toast').innerText(),/更新失败/);failWrite=false;
  await page.locator('#closeLyrics').click();failSync=true;await page.locator('[data-view=favorites]').click();await page.getByRole('heading',{name:'红心同步失败',exact:true}).waitFor();assert.equal(await page.locator('.song-table').count(),0);assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'mixed');
  failSync=false;await page.getByRole('button',{name:'重新同步',exact:true}).click();await page.locator('.song-table tbody tr').first().waitFor();assert.equal(await page.locator('#favorite').getAttribute('aria-pressed'),'true');
  const after=await page.evaluate(async()=>request('likes',{force:true}));assert.ok(after.ids.includes(target.id));assert.equal(fakeWrites,3);assert.deepEqual(errors,[]);
  console.log('PASS: '+model.ids.length+' real cloud hearts restored; own list/search/footer/player agree; mocked writes stay in sync, failures retain state, failed sync is not empty, recovery works; no cloud account mutations');
 }finally{await instance.close().catch(()=>{});for(const[file,bytes]of saved){if(bytes)fs.writeFileSync(file,bytes);else if(fs.existsSync(file))fs.unlinkSync(file);}}
})().catch(e=>{console.error(e);process.exitCode=1;});
