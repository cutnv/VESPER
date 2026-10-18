'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core'),file=path.join(root,'data/player.json'),saved=fs.readFileSync(file);
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
 try{
  const page=await app.firstWindow();page.setDefaultTimeout(8000);await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
  const handle=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.show();w.focus();return w.getNativeWindowHandle().readBigUInt64LE().toString();});
  const info=()=>app.evaluate(({BrowserWindow,screen})=>{const w=BrowserWindow.getAllWindows()[0];return{bounds:w.getBounds(),work:screen.getDisplayMatching(w.getBounds()).workArea,screen:screen.getDisplayMatching(w.getBounds()).bounds,max:w.isMaximized(),resizable:w.isResizable()};});
  const covers=(r,area)=>r.x<=area.x+2&&r.y<=area.y+2&&r.x+r.width>=area.x+area.width-2&&r.y+r.height>=area.y+area.height-2&&Math.abs(r.width-area.width)<=32&&Math.abs(r.height-area.height)<=32;
  for(let i=0;i<2;i++){
   await page.locator('[data-window=maximize]').click();await page.waitForFunction(()=>nativeWindowState.maximized);await page.waitForTimeout(150);
   const max=await info();assert.ok(covers(max.bounds,max.work),JSON.stringify(max));
   await page.locator('[data-window=maximize]').click();await page.waitForFunction(()=>!nativeWindowState.maximized);assert.equal((await info()).resizable,false);
  }
  // Native titlebar double-click follows the Windows system maximize route.
  const box=await page.locator('.brand').boundingBox(),view=await page.evaluate(()=>[innerWidth,innerHeight]);execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'window-pointer.ps1'),'-WindowHandle',handle,'-Action','DoubleClick','-X',String(box.x+box.width/2),'-Y',String(box.y+box.height/2),'-ViewWidth',String(view[0]),'-ViewHeight',String(view[1])],{windowsHide:true,timeout:10000});await page.waitForFunction(()=>nativeWindowState.maximized);const native=await info();assert.ok(covers(native.bounds,native.work),JSON.stringify(native));
  await page.locator('[data-window=maximize]').click();await page.waitForFunction(()=>!nativeWindowState.maximized);
  await page.keyboard.press('F11');await page.waitForFunction(()=>nativeWindowState.fullscreen);const full=await info();assert.ok(covers(full.bounds,full.screen),JSON.stringify(full));
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!nativeWindowState.fullscreen);assert.equal((await info()).resizable,false);
  console.log('PASS: square button repeatedly reaches actual monitor work-area dimensions; native titlebar double-click maximizes; F11 reaches monitor dimensions; restoring returns scrollbar edge protection');
 }finally{await app.close();fs.writeFileSync(file,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
