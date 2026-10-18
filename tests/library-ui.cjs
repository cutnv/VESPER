'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');
const snapshots=['player.json','settings.json','favorites.json'].map(name=>{const file=path.join(root,'data',name);return[file,fs.readFileSync(file)];});
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});let savedCollapsed;
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    savedCollapsed=await page.evaluate(()=>localStorage.getItem('playlistsCollapsed'));
    if(process.argv.includes('--live')){
      const data=await page.evaluate(async()=>({playlists:await request('playlists'),suggest:await request('suggest',{keywords:'After'}),albums:await request('subscribed-albums'),artists:await request('followed-artists')}));
      assert.ok(data.suggest.songs.length+data.suggest.artists.length+data.suggest.albums.length>0);
      assert.ok(!data.playlists.playlists.some(p=>p.specialType===5));
      assert.equal(new Set(data.playlists.playlists.map(p=>p.id)).size,data.playlists.playlists.length);
      assert.ok(Array.isArray(data.albums.items)&&Array.isArray(data.artists.items));
      console.log(`PASS: real read-only account: ${data.playlists.playlists.length} unique playlists, ${data.albums.total} albums, ${data.artists.total} artists, partial-query suggestions`);
      await page.locator('#searchInput').fill('After');await page.locator('.suggestion-option[data-kind=songs]').first().waitFor();
      await page.screenshot({path:path.join(__dirname,'library-search.png')});await page.locator('#searchInput').press('Escape');
      for(const[name,total,back]of[['收藏专辑',data.albums.total,'返回收藏专辑'],['关注歌手',data.artists.total,'返回关注歌手']]){
        await page.getByRole('button',{name,exact:true}).click();await page.locator('.entity-card').first().waitFor();
        let count=await page.locator('.entity-card').count();
        while(await page.locator('.scroll-loader').count()){
          await page.locator('#mainContent').evaluate(node=>node.scrollTop=node.scrollHeight);
          await page.waitForFunction(previous=>document.querySelectorAll('.entity-card').length>previous,count);count=await page.locator('.entity-card').count();
        }
        assert.equal(count,total);
        const ids=await page.locator('.entity-card').evaluateAll(nodes=>nodes.map(n=>n.dataset.id));assert.equal(new Set(ids).size,count);
        await page.locator('.entity-card').first().click();await page.locator('.entity-intro').waitFor();
        await page.getByRole('button',{name:back,exact:true}).click();await page.waitForFunction(title=>document.querySelector('.view-title')?.textContent===title,name);
      }
      console.log('PASS: all real collected albums and followed artists paginate without duplicates; cards open detail pages and return to their library');
    }
    const song={id:'999009',name:'After Hours',artists:'The Weeknd',album:'After Hours',cover:'',duration:360000,source:'netease'};
    const album=id=>({id,name:'测试专辑 '+id,artists:'测试歌手',cover:'',count:2});
    const artist={id:'77',name:'测试歌手',albums:2,cover:''};
    let failCollection=false,signedOut=false,releaseOld,oldStarted,albumSubscribed=true,failAlbumWrite=false,failAlbumStatus=false,releaseAlbumWrite,albumWrites=0;const oldReady=new Promise(resolve=>oldStarted=resolve),oldHold=new Promise(resolve=>releaseOld=resolve),suggested=[];
    await page.route('**/api/**',async route=>{
      const name=new URL(route.request().url()).pathname.slice(5),body=route.request().postDataJSON();let result;
      if(name==='bootstrap')result={account:{loggedIn:true,id:'41',nickname:'测试账号'},settings:JSON.parse(snapshots[1][1]),favorites:[],cloudLikes:{status:'ready',owner:'41',ids:[]},local:[{...song,id:'local-test',source:'local',name:'My Afterglow'}],state:{queue:[],current:null,position:0}};
      else if(name==='playlists')result={playlists:[{id:'2',name:'同名歌单',specialType:0},{id:'3',name:'同名歌单',specialType:0}]};
      else if(name==='subscribed-albums')result=signedOut?{items:[],total:0,signedOut:true,more:false}:{items:body.offset?[album('100'),album('102')]:[album('100'),album('101')],total:3,more:!body.offset,nextOffset:body.offset?4:2};
      else if(name==='followed-artists'){if(failCollection)return route.fulfill({status:400,json:{error:'读取失败，请重试'}});result={items:[artist],total:1,more:false,nextOffset:1};}
      else if(name==='album')result={...album(body.id),songs:[song],owner:'41',subscribed:failAlbumStatus?null:albumSubscribed,subscriptionError:failAlbumStatus?'测试状态失败':undefined};
      else if(name==='album-favorite'){albumWrites++;assert.equal(body.owner,'41');await new Promise(resolve=>releaseAlbumWrite=resolve);if(failAlbumWrite)return route.fulfill({status:400,json:{error:'测试收藏失败'}});albumSubscribed=body.enabled;result={id:body.id,enabled:body.enabled,owner:'41'};}
      else if(name==='artist')result={...artist,songs:[song]};
      else if(name==='suggest'){
        suggested.push(body.keywords);if(body.keywords==='old'){oldStarted();await oldHold;}
        if(body.keywords==='offline')return route.fulfill({status:400,json:{error:'测试离线'}});
        result={songs:[{...song,name:body.keywords+' song'}],artists:[artist],albums:[album('100')]};
      }
      else if(name==='search')result={kind:body.kind,songs:[song],artists:[artist],albums:[album('100')],total:1,offset:0};
      else if(name==='likes')result={status:'ready',owner:'41',ids:[]};
      else if(name==='favorites')result={songs:[],total:0,cloudTotal:0,more:false,nextOffset:0};
      else if(name==='state')result={ok:true};
      else return route.fulfill({status:400,json:{error:'Unexpected test request '+name}});
      return route.fulfill({json:result});
    });
    async function releaseWrite(count){for(let i=0;i<200&&albumWrites<count;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(albumWrites,count);releaseAlbumWrite();}
    await page.evaluate(()=>localStorage.setItem('playlistsCollapsed','false'));await page.reload();
    await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    assert.equal(await page.locator('#mainNav button').count(),4);assert.equal(await page.locator('.sidebar-playlist').count(),2);
    assert.equal(await page.getByRole('button',{name:'红心歌曲',exact:true}).count(),1);
    await page.locator('#togglePlaylists').click();assert.equal(await page.locator('#sidebarPlaylists').isVisible(),false);
    await page.locator('#showPlaylists').click();assert.equal(await page.locator('#sidebarPlaylists').isVisible(),false);
    await page.reload();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');assert.equal(await page.locator('#sidebarPlaylists').isVisible(),false);
    await page.locator('#togglePlaylists').click();assert.equal(await page.locator('#sidebarPlaylists').isVisible(),true);
    await page.getByRole('button',{name:'收藏专辑',exact:true}).click();await page.locator('.entity-card').first().waitFor();
    await page.locator('#mainContent').evaluate(node=>node.scrollTop=node.scrollHeight);await page.waitForFunction(()=>document.querySelectorAll('.entity-card').length===3);
    await page.locator('.entity-card[data-id="102"]').click();await page.locator('.entity-intro').waitFor();assert.equal(await page.locator('.entity-intro h1').innerText(),'测试专辑 102');
    const albumAction=page.locator('.toolbar button').last();assert.equal(await albumAction.innerText(),'取消收藏');
    await albumAction.click();await page.waitForFunction(()=>document.querySelector('.toolbar button:last-child')?.disabled);
    assert.equal(await albumAction.isDisabled(),true);await albumAction.evaluate(button=>button.click());await releaseWrite(1);
    await page.waitForFunction(()=>document.querySelector('.toolbar button:last-child')?.textContent==='收藏专辑');assert.equal(await albumAction.getAttribute('aria-pressed'),'false');
    failAlbumWrite=true;await albumAction.click();await page.waitForFunction(()=>document.querySelector('.toolbar button:last-child')?.disabled);await releaseWrite(2);
    await page.getByText('测试收藏失败',{exact:true}).waitFor();assert.equal(await albumAction.innerText(),'收藏专辑');assert.equal(await albumAction.isDisabled(),false);failAlbumWrite=false;
    await albumAction.click();await page.waitForFunction(()=>document.querySelector('.toolbar button:last-child')?.disabled);await releaseWrite(3);
    await page.waitForFunction(()=>document.querySelector('.toolbar button:last-child')?.textContent==='取消收藏');assert.equal(albumWrites,3);
    failAlbumStatus=true;await page.evaluate(()=>loadEntity('album','102','subscribed-albums'));await page.getByRole('button',{name:'重试收藏状态',exact:true}).waitFor();assert.equal(await page.locator('.entity-intro h1').innerText(),'测试专辑 102');
    failAlbumStatus=false;await page.getByRole('button',{name:'重试收藏状态',exact:true}).click();await page.getByRole('button',{name:'取消收藏',exact:true}).waitFor();assert.equal(albumWrites,3);
    await page.getByRole('button',{name:'返回收藏专辑',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='收藏专辑');
    await page.getByRole('button',{name:'关注歌手',exact:true}).click();await page.locator('.artist-card').click();await page.locator('.entity-intro').waitFor();assert.equal(await page.locator('.entity-intro h1').innerText(),'测试歌手');
    await page.getByRole('button',{name:'返回关注歌手',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='关注歌手');
    failCollection=true;await page.getByRole('button',{name:'刷新',exact:true}).click();await page.getByText('读取失败，请重试',{exact:true}).waitFor();
    failCollection=false;await page.getByRole('button',{name:'重新加载',exact:true}).click();await page.locator('.artist-card').waitFor();
    signedOut=true;await page.getByRole('button',{name:'收藏专辑',exact:true}).click();await page.getByRole('button',{name:'扫码登录',exact:true}).waitFor();signedOut=false;
    const input=page.locator('#searchInput');await input.fill('A');await input.fill('Aft');await input.fill('After');
    await page.locator('.suggestion-option[data-kind=albums]').waitFor();assert.deepEqual(suggested,['After']);
    assert.equal(await page.locator('.suggestion-option[data-kind=local]').count(),1);
    await input.press('ArrowUp');assert.equal(await page.locator('.suggestion-all').getAttribute('aria-selected'),'true');
    await input.press('ArrowDown');assert.equal(await page.locator('.suggestion-option[data-kind=local]').getAttribute('aria-selected'),'true');
    await input.press('Escape');assert.equal(await page.locator('#searchSuggestions').isVisible(),false);assert.equal(await input.inputValue(),'After');
    await input.fill('old');await oldReady;await input.fill('new');await page.getByRole('option',{name:'new song',exact:false}).waitFor();releaseOld();await page.waitForTimeout(80);
    assert.equal(await page.locator('.suggestion-option[data-kind=songs] strong').innerText(),'new song');
    await page.locator('.suggestion-option[data-kind=artists]').click();await page.locator('.entity-intro').waitFor();assert.equal(await page.locator('#searchSuggestions').isVisible(),false);
    await page.getByRole('button',{name:'返回搜索',exact:true}).click();await page.getByRole('tab',{name:'歌手',exact:true}).waitFor();assert.equal(await page.getByRole('tab',{name:'歌手',exact:true}).getAttribute('aria-selected'),'true');
    await input.fill('After');await page.locator('.suggestion-option[data-kind=albums]').click();await page.locator('.entity-intro').waitFor();assert.equal(await page.locator('.entity-intro h1').innerText(),'测试专辑 100');
    await input.fill('offline');await page.getByText('匹配提示暂不可用，按 Enter 搜索。',{exact:true}).waitFor();await input.press('Enter');await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='搜索 · offline');assert.equal(await page.locator('#searchSuggestions').isVisible(),false);
    await page.evaluate(()=>{window.selectedSuggestion=null;startFromList=track=>{window.selectedSuggestion=track;};});
    await input.fill('After');await page.locator('.suggestion-option[data-kind=songs]').waitFor();await input.press('ArrowDown');await input.press('ArrowDown');await input.press('Enter');
    assert.equal(await page.evaluate(()=>window.selectedSuggestion.name),'After song');assert.equal(await page.locator('#searchSuggestions').isVisible(),false);
    assert.deepEqual(errors,[]);
    console.log('PASS: collapse/reload persistence, album/artist list-detail-return, pagination dedup, errors and login states, partial/local suggestions, debounce, keyboard/Enter/Escape, stale-response suppression, offline fallback and song dispatch');
    console.log('PASS: album collect/uncollect UI, write failure preservation, pending-click suppression and collection status retry (mock writes only)');
  }finally{
    const page=app.windows()[0];if(page&&savedCollapsed!==undefined)await page.evaluate(value=>value===null?localStorage.removeItem('playlistsCollapsed'):localStorage.setItem('playlistsCollapsed',value),savedCollapsed).catch(()=>{});
    await app.close();for(const[file,bytes]of snapshots)fs.writeFileSync(file,bytes);
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
