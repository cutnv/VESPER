'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');
process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');
const file=path.join(root,'data/player.json'),saved=fs.existsSync(file)?fs.readFileSync(file):null;
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
  try{
    const page=await app.firstWindow(),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    await page.route('**/api/lyrics',route=>route.fulfill({json:{
      lines:Array.from({length:12},(_,i)=>({time:i*10,text:i===5?'This is a longer lyric that wraps across multiple lines to verify that the entire main lyric stays aligned with the center of the album cover.':'测试歌词 '+i})),
      translation:[{time:0,text:'First translated lyric'},{time:50,text:'多行歌词的翻译，仅放在正文下方，不影响正文居中'}]
    }}));
    await page.evaluate(async()=>{
      audio.pause();audio.removeAttribute('src');playSerial++;
      settings.playerLayout='split';applyPlayerLayout();
      await loadLyrics({source:'netease',id:'9900099'},playSerial);
      setPlayerPage(true);await document.fonts.ready;
    });
    let worst=0;
    async function check(label){
      for(const size of[18,30])for(const index of[0,5,11]){
        await page.evaluate(({size,index})=>{
          settings.lyricSize=size;applySettings();restoredPosition=index*10;lastLyric=-1;
          updateLyrics();centerCurrentLyric('instant');
        },{size,index});
        await page.waitForFunction(()=>{
          const r=document.querySelector('.lyric-line.active .lyric-text')?.getBoundingClientRect();
          return r&&Math.abs(r.top+r.height/2-innerHeight/2)<2;
        });
        const value=await page.evaluate(()=>{
          const center=id=>{const r=document.querySelector(id).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2};};
          const cover=center('#nowCover'),lyric=center('.lyric-line.active .lyric-text'),play=center('#toggle');
          const details=document.querySelector('.now-details').getBoundingClientRect(),footer=document.querySelector('.transport').getBoundingClientRect();
          return{cover:cover.y-innerHeight/2,lyric:lyric.y-innerHeight/2,play:play.x-innerWidth/2,detailsBottom:details.bottom,footerTop:footer.top,viewport:[innerWidth,innerHeight]};
        });
        for(const key of['cover','lyric','play']){
          worst=Math.max(worst,Math.abs(value[key]));
          assert.ok(Math.abs(value[key])<2,`${label}, font ${size}, line ${index}, ${key}: ${JSON.stringify(value)}`);
        }
        assert.ok(value.detailsBottom<value.footerTop,`${label}: song details overlap playback controls`);
      }
    }
    for(const[width,height]of[[1040,720],[1460,960]]){
      await app.evaluate(({BrowserWindow},bounds)=>BrowserWindow.getAllWindows()[0].setBounds(bounds),{x:20,y:20,width,height});
      await page.waitForTimeout(180);await check(`${width}x${height}`);
    }
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].maximize());
    await page.waitForFunction(()=>nativeWindowState.maximized);await check('maximized');
    await page.evaluate(()=>{restoredPosition=0;lastLyric=-1;updateLyrics();centerCurrentLyric('instant');});
    await page.screenshot({path:path.join(__dirname,'alignment.png'),animations:'disabled'});
    await page.evaluate(()=>window.desktop.control('fullscreen'));
    await page.waitForFunction(()=>nativeWindowState.fullscreen);await page.mouse.move(400,400);
    await page.waitForTimeout(450);await check('fullscreen hidden');
    await page.mouse.move(400,1);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.topbar')).opacity==='1');
    await check('fullscreen top revealed');
    await page.mouse.move(400,await page.evaluate(()=>innerHeight-1));
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='1');
    await check('fullscreen bottom revealed');
    await page.evaluate(()=>window.desktop.control('fullscreen'));
    await page.waitForFunction(()=>!nativeWindowState.fullscreen);
    for(const layout of['cover','split']){
      await page.evaluate(layout=>{settings.playerLayout=layout;applyPlayerLayout();setPlayerPage(false);},layout);
      const drift=await page.locator('#toggle').evaluate(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2-innerWidth/2;});
      assert.ok(Math.abs(drift)<2,`${layout} main page play drift ${drift}`);
      await page.evaluate(()=>setPlayerPage(true));
      const playerDrift=await page.locator('#toggle').evaluate(e=>{const r=e.getBoundingClientRect();return r.x+r.width/2-innerWidth/2;});
      assert.ok(Math.abs(playerDrift)<2,`${layout} player play drift ${playerDrift}`);
    }
    assert.deepEqual(errors,[]);
    console.log(`PASS: album image and main lyric share the viewport horizontal axis; play button shares the vertical axis. Normal, maximized, fullscreen hidden/revealed, fonts 18/30, first/multiline/final lyrics. Worst drift ${worst.toFixed(2)} CSS px.`);
  }finally{await app.close();if(saved)fs.writeFileSync(file,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
