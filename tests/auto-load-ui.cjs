'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.join(__dirname,'..');process.env.TEMP=path.join(root,'temp');process.env.TMP=process.env.TEMP;
const {_electron}=require('playwright-core');
const saved=['player.json','settings.json','favorites.json'].map(name=>[path.join(root,'data',name),fs.readFileSync(path.join(root,'data',name))]);
(async()=>{
  const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;
  const app=await _electron.launch({executablePath:path.join(root,'node_modules/electron/dist/electron.exe'),args:['.'],cwd:root,env});
  try{
    const page=await app.firstWindow(),errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');
    let paging=false,failNext=false,emptyNext=false,stalledNext=false,holdNext=null,held=false;
    const calls=[],song=i=>({id:String(1000+i),source:'netease',name:'测试歌曲 '+i,artists:'测试歌手',album:'测试专辑',cover:'',duration:180000});
    const album=i=>({id:String(1000+i),name:'测试专辑 '+i,artists:'测试歌手',cover:''}),artist=i=>({id:String(1000+i),name:'测试歌手 '+i,cover:''});
    await page.route('**/api/**',async route=>{
      const name=new URL(route.request().url()).pathname.slice(5),body=route.request().postDataJSON();let result;
      if(name==='bootstrap')result={account:{loggedIn:true,id:'41',nickname:'测试账号'},settings:JSON.parse(saved[1][1]),state:{queue:[],current:null,position:0},cloudLikes:{status:'ready',owner:'41',ids:[]},favorites:[],local:[]};
      else if(name==='playlists')result={playlists:[]};
      else if(name==='likes')result={status:'ready',owner:'41',ids:[]};
      else if(name==='local')result={songs:[]};
      else if(name==='state')result={ok:true};
      else if(['subscribed-albums','followed-artists','playlist','favorites','search'].includes(name)){
        const offset=body.offset||0,total=paging?85:0;calls.push({name,kind:body.kind,offset});
        if(offset&&holdNext){const pending=holdNext;holdNext=null;held=true;await pending;}
        if(offset&&failNext){failNext=false;return route.fulfill({status:400,json:{error:'测试网络中断'}});}
        const count=offset&&emptyNext?0:Math.max(0,Math.min(40,total-offset));emptyNext=false;
        const kind=name==='subscribed-albums'?'albums':name==='followed-artists'?'artists':body.kind||'songs';
        const items=Array.from({length:count},(_,i)=>({songs:song,albums:album,artists:artist}[kind])(offset&&stalledNext?i:offset+i));
        const nextOffset=offset&&stalledNext?offset:offset+count;stalledNext=false;
        result=name==='search'?{kind,[kind]:items,total,offset}:name==='playlist'?{id:'2',name:'测试歌单',cover:'',songs:items,total,offset}:name==='favorites'?{songs:items,total,cloudTotal:total,more:nextOffset<total,nextOffset}:{items,total,more:nextOffset<total,nextOffset};
      }else return route.fulfill({status:400,json:{error:'Unexpected test API '+name}});
      return route.fulfill({json:result});
    });
    await page.reload();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='红心歌曲');paging=true;
    async function open(type,kind){calls.length=0;await page.evaluate(async({type,kind})=>{if(type==='playlist')await loadPlaylist('2');else if(type==='favorites')await showFavorites(false,false);else if(type==='search'){$('searchInput').value='分页测试';await search(false,kind);}else await showCollection(type);},{type,kind});}
    const bottom=()=>page.locator('#mainContent').evaluate(node=>{node.scrollTop=node.scrollHeight;return node.scrollTop;});
    const countIs=(selector,count)=>page.waitForFunction(({selector,count})=>document.querySelectorAll(selector).length===count,{selector,count});
    for(const[type,kind]of[['subscribed-albums'],['followed-artists'],['playlist'],['favorites'],['search','songs'],['search','albums'],['search','artists']]){
      const selector=type==='subscribed-albums'||type==='followed-artists'||kind==='albums'||kind==='artists'?'.entity-card':'.song-table tbody tr';
      await open(type,kind);await countIs(selector,40);assert.equal(await page.getByRole('button',{name:/加载更多/}).count(),0);
      const position=await bottom();await countIs(selector,80);
      assert.ok(Math.abs(await page.locator('#mainContent').evaluate(node=>node.scrollTop)-position)<=2,'Appending must preserve scroll position');
      await bottom();await countIs(selector,85);assert.equal(await page.locator('.scroll-loader').count(),0);
      const ids=await page.locator(selector).evaluateAll(nodes=>nodes.map(node=>node.dataset.id||node.dataset.key));assert.equal(new Set(ids).size,85);
      assert.deepEqual(calls.filter(call=>call.name===type).map(call=>call.offset),[0,40,80]);
    }
    await open('subscribed-albums');failNext=true;await bottom();await page.locator('.scroll-loader button').waitFor();assert.equal(await page.locator('.entity-card').count(),40);
    await page.locator('.scroll-loader button').click();await countIs('.entity-card',80);assert.deepEqual(calls.map(call=>call.offset),[0,40,40]);
    await open('subscribed-albums');stalledNext=true;await bottom();await page.waitForFunction(()=>!document.querySelector('.scroll-loader'));assert.equal(await page.locator('.entity-card').count(),40);assert.deepEqual(calls.map(call=>call.offset),[0,40]);
    await open('search','songs');emptyNext=true;await bottom();await page.waitForFunction(()=>!document.querySelector('.scroll-loader'));assert.equal(await page.locator('.song-table tbody tr').count(),40);
    let release;holdNext=new Promise(resolve=>release=resolve);await open('followed-artists');await bottom();
    for(let i=0;i<200&&!held;i++)await new Promise(resolve=>setTimeout(resolve,5));assert.equal(held,true);
    for(let i=0;i<3;i++){await page.locator('#mainContent').evaluate(node=>node.scrollTop=0);await bottom();}
    assert.deepEqual(calls.map(call=>call.offset),[0,40]);
    await page.evaluate(()=>showList('local'));release();await page.waitForFunction(()=>document.querySelector('.view-title')?.textContent==='本地音乐');
    await page.waitForTimeout(120);assert.equal(await page.locator('.entity-card').count(),0);assert.equal(await page.locator('.scroll-loader').count(),0);assert.deepEqual(errors,[]);
    console.log('PASS: albums, artists, playlists, favorites and all search types scroll through pages; no more buttons, stable scroll, unique rows, exhaustion, retry, stalled/empty page protection, one in-flight request and safe navigation');
  }finally{await app.close();for(const[file,bytes]of saved)fs.writeFileSync(file,bytes);}
})().catch(error=>{console.error(error);process.exitCode=1;});
