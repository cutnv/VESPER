'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');
const snapshots=['player.json','settings.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.readFileSync(file)];});
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    const handle=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.show();w.focus();return w.getNativeWindowHandle().readBigUInt64LE().toString();});
    async function pointer(action,x,y,dx=0,dy=0){
      const[w,h]=await page.evaluate(()=>[innerWidth,innerHeight]);
      return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'window-pointer.ps1'),'-WindowHandle',handle,'-Action',action,'-X',String(x),'-Y',String(y),'-ViewWidth',String(w),'-ViewHeight',String(h),'-DeltaX',String(dx),'-DeltaY',String(dy)],{encoding:'utf8',windowsHide:true,timeout:10000}));
    }
    const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
    const reset=async()=>{await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setBounds({x:45,y:45,width:1200,height:800});});await page.waitForTimeout(120);};
    async function dragBlank(label,point){
      await reset();const before=await bounds(),[x,y]=await page.evaluate(point);
      await page.evaluate(()=>{window.nativePointerEvents=[];document.addEventListener('pointerdown',e=>window.nativePointerEvents.push({x:e.clientX,y:e.clientY,target:e.target.className}),{once:true,capture:true});});
      const hit=await pointer('Drag',x,y,45,25),after=await bounds(),events=await page.evaluate(()=>window.nativePointerEvents);
      assert.equal(hit.hit,1,`${label} must keep receiving normal mouse and wheel input`);
      assert.ok(Math.abs(after.x-before.x-45)<=2&&Math.abs(after.y-before.y-25)<=2,`${label}: ${JSON.stringify({before,after,hit,events})}`);
      assert.ok(Math.abs(after.width-before.width)<=1&&Math.abs(after.height-before.height)<=1,JSON.stringify({before,after}));
    }
    await dragBlank('library main margin',()=>{const r=$('mainContent').getBoundingClientRect();return[r.x+12,r.y+20];});
    await dragBlank('library heading space',()=>{const r=document.querySelector('.view-header').getBoundingClientRect();return[r.x+r.width/2,r.y+r.height/2];});
    await dragBlank('sidebar section gap',()=>{const nav=$('mainNav').getBoundingClientRect(),heading=document.querySelector('.playlist-heading').getBoundingClientRect();return[nav.width/2,(nav.bottom+heading.top)/2];});
    await dragBlank('footer blank',()=>{const r=document.querySelector('.transport').getBoundingClientRect();return[r.width/2,r.y+3];});
    await reset();
    const mainScroll=await page.locator('#mainContent').evaluate(e=>e.scrollTop),[mx,my]=await page.locator('#mainContent').evaluate(e=>{const r=e.getBoundingClientRect();return[r.x+12,r.y+150];});
    await pointer('Wheel',mx,my);await page.waitForTimeout(180);assert.ok(await page.locator('#mainContent').evaluate(e=>e.scrollTop)>mainScroll,'Library wheel scrolling must still work over blank margins');
    const input=await page.locator('#searchInput').boundingBox();assert.equal((await pointer('Hit',input.x+50,input.y+15)).hit,1);
    await page.evaluate(()=>{settings.playerLayout='split';applyPlayerLayout();setPlayerPage(true);});
    await dragBlank('player left margin',()=>[25,250]);
    await dragBlank('player top space',()=>[innerWidth/2,85]);
    await reset();
    // Check lyric scrolling and controls using the OS pointer, not CDP mouse events.
    await page.waitForSelector('.lyric-line');await page.evaluate(()=>{$('lyrics').scrollTop=150;});
    const lyric=await page.locator('#lyrics').boundingBox();assert.equal((await pointer('Hit',lyric.x+20,lyric.y+lyric.height/2)).hit,1);
    const scroll=await page.locator('#lyrics').evaluate(e=>e.scrollTop);await pointer('Wheel',lyric.x+20,lyric.y+lyric.height/2);await page.waitForTimeout(150);assert.ok(await page.locator('#lyrics').evaluate(e=>e.scrollTop)>scroll);
    for(const selector of['#toggle','#seek','#volume','#mute']){
      const r=await page.locator(selector).boundingBox();assert.equal((await pointer('Hit',r.x+r.width/2,r.y+r.height/2)).hit,1,selector+' must remain interactive');
    }
    let r=await page.locator('#mute').boundingBox(),muted=await page.evaluate(()=>audio.muted),before=await bounds();
    await pointer('Click',r.x+r.width/2,r.y+r.height/2);await page.waitForFunction(value=>audio.muted!==value,muted);assert.deepEqual(await bounds(),before);
    await pointer('Click',r.x+r.width/2,r.y+r.height/2);
    r=await page.locator('[data-window=maximize]').boundingBox();await pointer('Click',r.x+r.width/2,r.y+r.height/2);await page.waitForFunction(()=>nativeWindowState.maximized);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='0'&&getComputedStyle(document.querySelector('.topbar')).opacity==='0');
    await pointer('Move',500,1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.topbar')).opacity==='1');
    await page.evaluate(()=>{window.lastNativeMouse=null;document.addEventListener('mousemove',e=>{window.lastNativeMouse={x:e.clientX,y:e.clientY,target:e.target.className};});});
    const moveResult=await pointer('Move',500,300);await page.waitForTimeout(600);
    assert.equal(await page.locator('.topbar').evaluate(e=>getComputedStyle(e).opacity),'0',JSON.stringify({moveResult,state:await page.evaluate(()=>({mouse:window.lastNativeMouse,classes:document.body.className})),native:await app.evaluate(({screen,BrowserWindow})=>({cursor:screen.getCursorScreenPoint(),content:BrowserWindow.getAllWindows()[0].getContentBounds()}))}));
    const height=await page.evaluate(()=>innerHeight);await pointer('Move',500,height-1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='1');
    r=await page.locator('#volume').boundingBox();await pointer('Click',r.x+r.width*.3,r.y+r.height/2);await page.waitForFunction(()=>Number($('volume').value)<40);assert.equal(await page.locator('.transport').evaluate(e=>getComputedStyle(e).opacity),'1');
    await pointer('Move',500,300);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='0');
    await page.screenshot({path:path.join(__dirname,'native-immersive.png')});
    await pointer('Move',500,1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.topbar')).opacity==='1');
    r=await page.locator('[data-window=maximize]').boundingBox();await pointer('Click',r.x+r.width/2,r.y+r.height/2);await page.waitForFunction(()=>!nativeWindowState.maximized);
    await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='1');
    console.log('PASS: real Windows drags move the window from library/heading/sidebar/footer/player blank areas; native controls remain client areas; library/lyric wheel scrolling and mute work; square-button maximize hides bars, real screen edges reveal them, volume works, moving away hides and restoring brings controls back');
  }finally{await app.close();for(const[file,bytes]of snapshots)fs.writeFileSync(file,bytes);}
})().catch(e=>{console.error(e);process.exitCode=1;});
