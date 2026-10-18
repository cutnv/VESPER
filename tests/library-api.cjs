'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {startServer,protect}=require('../server.cjs');
const folder=path.join(__dirname,'library-api-'+Date.now());fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'session.dpapi'),protect('MUSIC_U=library-unit-test'));
const album=id=>({id,name:'专辑 '+id,artists:[{name:'测试歌手'}],picUrl:'',size:9});
const artist=id=>({id,name:'歌手 '+id,picUrl:'',albumSize:3});
let owner=41,fail=false,subscribed=true,failAlbumStatus=false,failAlbumWrite=false,holdAlbumWrite=null;const calls=[];
const sdk={
  login_status:async()=>({body:{data:{profile:{userId:owner,nickname:'测试账号'}}}}),
  likelist:async()=>({body:{code:200,ids:[]}}),
  user_playlist:async()=>({body:{code:200,playlist:[{id:1,name:'我喜欢的音乐',specialType:5},{id:2,name:'同名歌单'},{id:2,name:'重复 ID'},{id:3,name:'同名歌单'}]}}),
  playlist_detail:async()=>({body:{code:200,playlist:{trackIds:[]}}}),
  album_sublist:async args=>{calls.push(['album',args.offset]);if(fail)return{body:{code:500,message:'failed'}};return{body:{code:200,count:42,hasMore:args.offset===0,data:Array.from({length:args.offset===0?40:2},(_,i)=>album(100+args.offset+i))}};},
  album:async args=>({body:{code:200,album:album(args.id),songs:[]}}),
  album_detail_dynamic:async()=>({body:failAlbumStatus?{code:500}:{code:200,isSub:subscribed}}),
  album_sub:async args=>{calls.push(['album-sub',args.id,args.t]);if(holdAlbumWrite)await holdAlbumWrite;if(failAlbumWrite)return{body:{code:500,message:'测试收藏失败'}};subscribed=args.t===1;return{body:{code:200}};},
  artist_sublist:async args=>{calls.push(['artist',args.offset]);return{body:{code:200,count:1,hasMore:false,data:[artist(77),artist(77)]}};},
  search_suggest:async args=>{calls.push(['suggest',args.keywords]);if(fail)throw{body:{message:'匹配接口测试失败'}};return{body:{result:{songs:[{id:9,name:'After Hours',artists:[{name:'The Weeknd'}],album:{name:'After Hours'},duration:360000}],artists:[artist(77)],albums:[album(100)]}}};}
};
(async()=>{
  const instance=await startServer({port:0,dataDir:folder,sdk});
  async function post(name,body={}){const r=await fetch(instance.origin+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':instance.token},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
  try{
    await post('bootstrap');
    const playlists=(await post('playlists')).body.playlists;
    assert.deepEqual(playlists.map(p=>p.id),['2','3']);assert.equal(playlists[0].name,playlists[1].name,'Distinct same-name playlists must remain');
    const first=(await post('subscribed-albums')).body;assert.equal(first.items.length,40);assert.equal(first.total,42);assert.equal(first.more,true);assert.equal(first.nextOffset,40);
    const last=(await post('subscribed-albums',{offset:first.nextOffset})).body;assert.equal(last.items[0].id,'140');assert.equal(last.items.length,2);assert.equal(last.more,false);
    const artists=(await post('followed-artists')).body;assert.equal(artists.items.length,1);assert.equal(artists.items[0].id,'77');assert.equal(artists.nextOffset,2);
    const suggested=(await post('suggest',{keywords:' Ａｆｔｅｒ '})).body;assert.equal(suggested.songs[0].name,'After Hours');assert.equal(suggested.songs[0].source,'netease');assert.equal(suggested.artists[0].id,'77');assert.equal(suggested.albums[0].artists,'测试歌手');assert.deepEqual(calls.at(-1),['suggest','After']);
    const before=calls.length;assert.deepEqual((await post('suggest',{keywords:'  '})).body,{songs:[],artists:[],albums:[]});assert.equal(calls.length,before);
    fail=true;assert.equal((await post('subscribed-albums')).status,400);assert.equal((await post('suggest',{keywords:'After'})).status,400);fail=false;
    let detail=(await post('album',{id:'100'})).body;assert.equal(detail.subscribed,true);assert.equal(detail.owner,'41');
    let saved=await post('album-favorite',{id:'100',enabled:false,owner:'41'});assert.equal(saved.status,200);assert.deepEqual(saved.body,{id:'100',enabled:false,owner:'41'});assert.deepEqual(calls.at(-1),['album-sub','100',2]);
    assert.equal((await post('album',{id:'100'})).body.subscribed,false);
    await post('album-favorite',{id:'100',enabled:true,owner:'41'});assert.deepEqual(calls.at(-1),['album-sub','100',1]);assert.equal((await post('album',{id:'100'})).body.subscribed,true);
    failAlbumWrite=true;saved=await post('album-favorite',{id:'100',enabled:false,owner:'41'});assert.equal(saved.status,400);assert.equal(saved.body.error,'测试收藏失败');assert.equal(subscribed,true);failAlbumWrite=false;
    failAlbumStatus=true;detail=(await post('album',{id:'100'})).body;assert.equal(detail.id,'100');assert.equal(detail.subscribed,null);assert.match(detail.subscriptionError,/状态读取失败/);failAlbumStatus=false;
    const writesBefore=calls.length;
    for(const body of[{id:'bad',enabled:true,owner:'41'},{id:'100',enabled:'false',owner:'41'},{id:'100',enabled:true,owner:'42'}])assert.equal((await post('album-favorite',body)).status,400);
    assert.equal(calls.length,writesBefore);
    let release;holdAlbumWrite=new Promise(resolve=>release=resolve);const pending=post('album-favorite',{id:'100',enabled:false,owner:'41'});
    while(calls.length===writesBefore)await new Promise(resolve=>setTimeout(resolve,5));
    owner=42;await post('account');release();assert.equal((await pending).status,400);holdAlbumWrite=null;
    await post('logout');const count=calls.length;
    assert.equal((await post('album-favorite',{id:'100',enabled:true,owner:'42'})).status,400);
    detail=(await post('album',{id:'100'})).body;assert.equal(detail.subscribed,false);assert.equal(detail.owner,null);
    for(const name of['subscribed-albums','followed-artists']){const r=(await post(name)).body;assert.equal(r.signedOut,true);assert.deepEqual(r.items,[]);}assert.equal(calls.length,count);
    console.log('PASS: duplicate IDs and liked playlist removed, distinct same-name playlists preserved, album/artist subscriptions with pagination, normalized partial-query suggestions, failures and signed-out state');
    console.log('PASS: album collection status, collect/uncollect SDK parameters, failure preservation, unknown status, input validation, account switch and signed-out protection');
  }finally{instance.server.closeAllConnections();await instance.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
