'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const {resizeBounds}=require('../window-resize.cjs');
assert.deepEqual(resizeBounds({x:100,y:100,width:1200,height:800},'nw',500,500,[1020,720]),{x:280,y:180,width:1020,height:720});
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core'),file=path.join(root,'data/player.json'),saved=fs.readFileSync(file);
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
 const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
 try{
  const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
  const handle=await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setAlwaysOnTop(true);w.show();w.focus();return w.getNativeWindowHandle().readBigUInt64LE().toString();});
  const bounds=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getBounds());
  async function drag(x,y,dx,dy){const[w,h]=await page.evaluate(()=>[innerWidth,innerHeight]);execFileSync('powershell.exe',['-NoProfile','-ExecutionPolicy','Bypass','-File',path.join(__dirname,'window-pointer.ps1'),'-WindowHandle',handle,'-Action','Drag','-X',String(x),'-Y',String(y),'-ViewWidth',String(w),'-ViewHeight',String(h),'-DeltaX',String(dx),'-DeltaY',String(dy)],{windowsHide:true,timeout:10000});}
  for(const direction of['n','s','e','w','ne','nw','se','sw']){
   await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:50,y:50,width:1150,height:800}));await page.waitForTimeout(120);
   const box=await page.locator('.resize-'+direction).boundingBox(),before=await bounds();assert.ok(box);
   const dx=direction.includes('w')?35:direction.includes('e')?-35:0,dy=direction.includes('n')?35:direction.includes('s')?-35:0;
   await drag(box.x+box.width/2,box.y+box.height/2,dx,dy);const after=await bounds();
   if(dx)assert.ok(after.width<before.width,JSON.stringify({direction,before,after}));
   if(dy)assert.ok(after.height<before.height,JSON.stringify({direction,before,after}));
   if(direction.includes('w'))assert.ok(Math.abs(after.x+after.width-before.x-before.width)<=2);
   if(direction.includes('n'))assert.ok(Math.abs(after.y+after.height-before.y-before.height)<=2);
   assert.equal(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].isResizable()),false);
  }
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setBounds({x:50,y:50,width:1150,height:800}));await page.waitForTimeout(120);
  const corner=await page.locator('.resize-nw').boundingBox();await drag(corner.x+8,corner.y+8,500,500);const minimum=await bounds();
  // Win32 frame changes can round the outer bounds by two DIPs at fractional scaling.
  assert.ok(minimum.width>=1020&&minimum.width<=1022&&minimum.height>=720&&minimum.height<=722,JSON.stringify(minimum));assert.deepEqual(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getMinimumSize()),[1020,720]);
  await page.locator('[data-window=maximize]').click();await page.waitForFunction(()=>nativeWindowState.maximized);assert.equal(await page.locator('.resize-e').isVisible(),false);
  console.log('PASS: real Windows input resizes all four edges and corners, anchors opposite edges, enforces minimum size, releases native resize capture and retains square-button maximize');
 }finally{await app.close();fs.writeFileSync(file,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
