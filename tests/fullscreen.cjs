'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');const file=path.join(root,'data/player.json'),saved=fs.readFileSync(file);
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
  try{
    const page=await app.firstWindow();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    const bars=()=>page.evaluate(()=>['.topbar','.transport'].map(selector=>{const node=document.querySelector(selector);return{opacity:getComputedStyle(node).opacity,inert:node.inert};}));
    const hidden=async()=>{await page.waitForFunction(()=>['.topbar','.transport'].every(selector=>getComputedStyle(document.querySelector(selector)).opacity==='0'));assert.deepEqual(await bars(),[{opacity:'0',inert:true},{opacity:'0',inert:true}]);};
    await page.locator('#miniCover').click();
    // Use the same square button as the user, rather than setting fullscreen directly.
    await page.locator('[data-window=maximize]').click();await page.waitForFunction(()=>nativeWindowState.maximized);assert.equal(await page.evaluate(()=>nativeWindowState.fullscreen),false);
    for(const layout of['split','cover'])for(const mode of['maximized','fullscreen']){
      await page.evaluate(layout=>{settings.playerLayout=layout;applyPlayerLayout();hideScreenControls();},layout);
      if(mode==='fullscreen'){await page.keyboard.press('F11');await page.waitForFunction(()=>nativeWindowState.fullscreen);}
      await page.mouse.move(400,400);await hidden();
      // Merely hovering where a hidden button sits must not reveal a bar.
      await page.mouse.move(500,30);await page.waitForTimeout(250);await hidden();
      await page.mouse.move(500,1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.topbar')).opacity==='1');
      assert.deepEqual(await bars(),[{opacity:'1',inert:false},{opacity:'0',inert:true}]);
      await page.mouse.move(500,35);await page.waitForTimeout(450);assert.equal((await bars())[0].opacity,'1');
      await page.mouse.move(400,350);
      // Continuous movement in the middle must not repeatedly reset the hide delay.
      for(let i=0;i<8;i++){await page.mouse.move(400+i*3,350);await page.waitForTimeout(70);}await hidden();
      const height=await page.evaluate(()=>innerHeight);
      await page.mouse.move(500,height-1);await page.waitForFunction(()=>getComputedStyle(document.querySelector('.transport')).opacity==='1');
      assert.deepEqual(await bars(),[{opacity:'0',inert:true},{opacity:'1',inert:false}]);
      const volume=page.locator('#volume'),box=await volume.boundingBox();
      await page.mouse.move(box.x+box.width*.3,box.y+box.height/2);await page.waitForTimeout(450);assert.equal((await bars())[1].opacity,'1');
      const before=await page.evaluate(()=>audio.muted);await page.locator('#mute').click();assert.equal(await page.evaluate(()=>audio.muted),!before);await page.locator('#mute').click();
      await page.mouse.move(400,400);await hidden();
      await page.screenshot({path:path.join(__dirname,`immersive-${mode}-${layout}.png`)});
      if(mode==='fullscreen'){await page.keyboard.press('Escape');await page.waitForFunction(()=>!nativeWindowState.fullscreen);}
    }
    await page.evaluate(()=>setPlayerPage(false));assert.deepEqual(await bars(),[{opacity:'1',inert:false},{opacity:'1',inert:false}]);
    await page.evaluate(()=>setPlayerPage(true));await hidden();
    await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].unmaximize());await page.waitForFunction(()=>!nativeWindowState.maximized);
    assert.deepEqual(await bars(),[{opacity:'1',inert:false},{opacity:'1',inert:false}]);
    console.log('PASS: square-button maximize and F11 fullscreen hide both complete bars in both player layouts; only edges reveal; controls work, middle movement hides, hidden controls are inert, library and normal window restore controls');
  }finally{await app.close();fs.writeFileSync(file,saved);}
})().catch(e=>{console.error(e);process.exitCode=1;});
