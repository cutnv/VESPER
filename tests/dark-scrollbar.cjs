'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');
const saved=['player.json','settings.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.readFileSync(file)];});
const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
 try{
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
  const handle=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.show();w.focus();return w.getNativeWindowHandle().readBigUInt64LE().toString();});
  const colors=await page.evaluate(()=>{const root=getComputedStyle(document.documentElement),body=getComputedStyle(document.body),title=getComputedStyle(document.querySelector('.song-text strong'));return{scheme:root.colorScheme,background:body.backgroundColor,ink:root.getPropertyValue('--ink').trim(),muted:root.getPropertyValue('--muted').trim(),opacity:Number(getComputedStyle($('homeBackdrop')).opacity),scroll:getComputedStyle($('mainContent')).scrollbarColor,fontSize:title.fontSize,fontWeight:title.fontWeight};});
  assert.equal(colors.scheme,'dark');assert.equal(colors.fontSize,'13px');assert.equal(colors.fontWeight,'600');assert.equal(colors.opacity,.3);assert.equal(colors.scroll,'auto');
  const hex=value=>value.slice(1).match(/../g).map(v=>parseInt(v,16)),background=colors.background.match(/\d+/g).slice(0,3).map(Number),brightest=background.map(v=>v*(1-colors.opacity)+255*colors.opacity);
  assert.ok(contrast(hex(colors.ink),brightest)>=4.5);assert.ok(contrast(hex(colors.muted),brightest)>=4.5);
  const pointer=async(action,x,y,dx=0,dy=0)=>{const[w,h]=await page.evaluate(()=>[innerWidth,innerHeight]);return JSON.parse(execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'window-pointer.ps1'),'-WindowHandle',handle,'-Action',action,'-X',String(x),'-Y',String(y),'-ViewWidth',String(w),'-ViewHeight',String(h),'-DeltaX',String(dx),'-DeltaY',String(dy)],{encoding:'utf8',windowsHide:true,timeout:10000}));};
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  for(const mode of['normal','maximized']){
   if(mode==='maximized')await page.evaluate(()=>window.desktop.control('maximize'));
   else await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setBounds({x:45,y:45,width:1200,height:800});});
   await page.waitForFunction(mode=>nativeWindowState.maximized===(mode==='maximized'),mode);await page.waitForTimeout(150);
   await page.locator('#mainContent').evaluate(e=>e.scrollTop=0);
   await page.mouse.move(30,75);await page.waitForFunction(()=>!document.body.classList.contains('main-scrollbar-visible'));
   assert.equal(await page.locator('#mainContent').evaluate(e=>getComputedStyle(e,'::-webkit-scrollbar-thumb').backgroundColor),'rgba(0, 0, 0, 0)');
   if(mode==='normal'){
    const idle=await page.locator('#mainContent').evaluate(e=>{const r=e.getBoundingClientRect(),x=r.right-3,y=r.top+r.height/2;return{x,y,covered:!!document.elementFromPoint(x,y)?.closest('.resize-e')};});assert.equal(idle.covered,true);
    const beforeIdle=await bounds();await pointer('Drag',idle.x,idle.y,-35,0);assert.ok((await bounds()).width<beforeIdle.width,'Idle list edge must resize even when songs overflow');
    assert.equal(await page.evaluate(()=>document.body.classList.contains('main-scrollbar-visible')),false,'Resizing must not reveal and capture the scrollbar');
   }
   const stableWidth=await page.locator('#mainContent').evaluate(e=>e.clientWidth);
   await page.mouse.move(500,220);await page.mouse.wheel(0,120);await page.waitForFunction(()=>document.body.classList.contains('main-scrollbar-visible')&&document.getElementById('mainContent').scrollTop>0);
   const point=await page.locator('#mainContent').evaluate(e=>{const r=e.getBoundingClientRect(),width=e.offsetWidth-e.clientWidth,x=r.right-width/2,y=r.top+width+8,target=document.elementFromPoint(x,y);return{x,y,width,covered:!!target?.closest('.resize-grip'),scrollbarRight:r.right,viewport:innerWidth};});
   assert.ok(point.width>=20,'Scrollbar must provide a wider drag target');assert.equal(point.covered,false);
   assert.equal(await page.locator('#mainContent').evaluate(e=>e.clientWidth),stableWidth,'Revealing the scrollbar must not shift the list');
   await pointer('Move',point.x,point.y);await page.waitForTimeout(1600);assert.equal(await page.evaluate(()=>document.body.classList.contains('main-scrollbar-visible')),true,'Hover must keep the scrollbar visible');
   assert.ok(Math.abs(point.scrollbarRight-point.viewport)<1,'Scrollbar must be flush with the right edge');
   for(const inset of[1,3,6])assert.equal((await pointer('Hit',point.viewport-inset,point.y)).hit,1,mode+' scrollbar right edge must not resize at inset '+inset);
   const before=await bounds(),hit=await pointer('Drag',point.x,point.y,0,180);
   assert.equal(hit.hit,1,'Scrollbar must use client hit testing');
   await page.waitForTimeout(500);const scrolled=await page.locator('#mainContent').evaluate(e=>({top:e.scrollTop,height:e.clientHeight,classes:document.body.className}));assert.ok(scrolled.top>scrolled.height,JSON.stringify({mode,point,scrolled,before,after:await bounds()}));
   assert.deepEqual(await bounds(),before,'Scrollbar dragging must not move or resize the window');
   await page.mouse.move(30,75);await page.screenshot({path:path.join(__dirname,`dark-${mode}.png`)});
   await page.waitForFunction(()=>!document.body.classList.contains('main-scrollbar-visible'));
   assert.equal(await page.locator('#mainContent').evaluate(e=>e.clientWidth),stableWidth,'Hiding the scrollbar must not shift the list');
  }
  await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.unmaximize();w.setBounds({x:45,y:45,width:1200,height:800});});await page.waitForFunction(()=>!nativeWindowState.maximized);await page.waitForTimeout(150);
  await page.evaluate(()=>{window.gripDown=null;document.addEventListener('pointerdown',e=>{window.gripDown={x:e.clientX,y:e.clientY,target:e.target.className};},{once:true,capture:true});});
  const before=await bounds(),width=await page.evaluate(()=>innerWidth),topHit=await pointer('Drag',width-5,32,-35,0);const after=await bounds();assert.ok(after.width<before.width,JSON.stringify({before,after,topHit,dom:await page.evaluate(()=>{const e=document.querySelector('.resize-e'),r=e.getBoundingClientRect();return{down:window.gripDown,classes:document.body.className,rect:[r.x,r.y,r.width,r.height],target:document.elementFromPoint(innerWidth-5,32)?.className};})}));
  const lower=await page.evaluate(()=>({width:innerWidth,height:innerHeight})),beforeLower=await bounds();await pointer('Drag',lower.width-5,lower.height-40,-30,0);assert.ok((await bounds()).width<beforeLower.width,'Right bottom rail must still resize the window');
  assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isResizable()),false,'Native edge capture must be off after the resize gesture');
  await page.locator('#settingsButton').click();assert.equal(await page.locator('#settingsDialog').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(21, 29, 40)');await page.locator('[data-close-dialog=settingsDialog]').click();
  assert.deepEqual(errors,[]);
  console.log(`PASS: idle right edge resizes with overflowing lists; wheel reveals a wide dark scrollbar; hover pins visibility; native dragging leaves bounds unchanged in normal/maximized windows; automatic hiding preserves layout and restores resize grips; readable contrast ${contrast(hex(colors.muted),brightest).toFixed(2)}:1`);
 }finally{await app.close();for(const[file,bytes]of saved)fs.writeFileSync(file,bytes);}
})().catch(e=>{console.error(e);process.exitCode=1;});
