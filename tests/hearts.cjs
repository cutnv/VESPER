'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const{startServer,protect}=require('../server.cjs');
const folder=path.join(__dirname,'hearts-'+Date.now());fs.mkdirSync(folder,{recursive:true});
fs.writeFileSync(path.join(folder,'session.dpapi'),protect('MUSIC_U=unit-test-only'));
const legacy=[{id:'777777',source:'netease',name:'旧的本机收藏'},{id:'local-one',source:'local',name:'本地收藏'}];fs.writeFileSync(path.join(folder,'favorites.json'),JSON.stringify(legacy));
let owner='41',failRead=false,failWrite=false,heldRead=null,readStarted=null;const mutations=[];
const idsByOwner=new Map([['41',new Set(Array.from({length:650},(_,i)=>String(10000+i)))],['42',new Set(['90001'])]]);
const orderByOwner=new Map([['41',['10117','10000','10649',...[...idsByOwner.get('41')].reverse().filter(id=>!['10117','10000','10649'].includes(id))]],['42',['90001']]]);
const ordered=()=>{const listed=orderByOwner.get(owner).filter(id=>idsByOwner.get(owner).has(id)),present=new Set(listed);return[...[...idsByOwner.get(owner)].filter(id=>!present.has(id)),...listed];};
const sdk={
 login_status:async()=>({body:{data:{profile:{userId:Number(owner),nickname:'单元测试账号',vipType:11}}}}),
 likelist:async()=>{throw new Error('The unordered likelist must not be used for the collection');},
 user_playlist:async()=>({body:{code:200,playlist:[{id:888,name:'别人的喜欢',specialType:5,creator:{userId:99}},{id:Number(owner)+900,name:'我喜欢的音乐',specialType:5,creator:{userId:Number(owner)}}]}}),
 playlist_detail:async args=>{assert.equal(args.id,String(Number(owner)+900));if(failRead)throw{body:{message:'测试同步失败'}};const ids=ordered();if(readStarted){readStarted();readStarted=null;return new Promise(resolve=>{heldRead=()=>resolve({body:{code:200,playlist:{trackIds:ids.map(id=>({id}))}}});});}return{body:{code:200,playlist:{trackIds:ids.map(id=>({id}))}}};},
 song_detail:async args=>{const ids=args.ids.split(',');assert.ok(ids.length<=200);return{body:{code:200,songs:ids.reverse().map(id=>({id:Number(id),name:'红心 '+id,ar:[{name:'测试歌手'}],al:{name:'测试专辑'},dt:180000}))}};},
 like:async args=>{mutations.push({id:args.id,like:args.like});assert.ok(['true','false'].includes(args.like));if(failWrite)return{body:{code:500,message:'测试更新失败'}};if(args.like==='true')idsByOwner.get(owner).add(args.id);else idsByOwner.get(owner).delete(args.id);return{body:{code:200}};}
};
(async()=>{
 const instance=await startServer({port:0,dataDir:folder,sdk});
 const post=async(name,body={})=>{const r=await fetch(instance.origin+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':instance.token},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};};
 try{
  const first=await post('bootstrap');assert.equal(first.body.cloudLikes.status,'ready');assert.equal(first.body.cloudLikes.ids.length,650);assert.ok(first.body.cloudLikes.ids.includes('10649'));assert.equal(first.body.favorites.length,1);assert.equal(mutations.length,0);
  assert.equal(fs.readFileSync(path.join(folder,'favorites.json'),'utf8'),JSON.stringify(legacy));
  const page=await post('favorites');assert.equal(page.body.cloudTotal,650);assert.equal(page.body.total,651);assert.equal(page.body.songs.length,401);assert.equal(page.body.nextOffset,400);assert.equal(page.body.more,true);
  assert.deepEqual(first.body.cloudLikes.ids,orderByOwner.get('41'));assert.deepEqual(page.body.songs.slice(0,400).map(t=>t.id),orderByOwner.get('41').slice(0,400));
  const second=await post('favorites',{offset:400});assert.equal(second.body.songs.length,250);assert.equal(second.body.more,false);assert.deepEqual(second.body.songs.map(t=>t.id),orderByOwner.get('41').slice(400));
  const playlist=await post('playlist',{id:'941'});assert.equal(playlist.body.songs.length,400);assert.deepEqual(playlist.body.songs.map(t=>t.id),orderByOwner.get('41').slice(0,400));
  const last=await post('favorites',{offset:600});assert.equal(last.body.songs.length,50);assert.equal(last.body.more,false);
  assert.deepEqual(last.body.songs.map(t=>t.id),orderByOwner.get('41').slice(600));
  const original=orderByOwner.get('41');orderByOwner.set('41',[...original.slice(17),...original.slice(0,17)]);await post('likes',{force:true});assert.deepEqual((await post('favorites')).body.songs.slice(0,400).map(t=>t.id),orderByOwner.get('41').slice(0,400));
  const track={id:'10000',source:'netease',name:'测试红心'};
  const remove=await post('favorite',{track,enabled:false});assert.equal(remove.body.enabled,false);assert.equal(mutations.at(-1).like,'false');assert.ok(!(await post('likes')).body.ids.includes('10000'));
  const add=await post('favorite',{track,enabled:true});assert.equal(add.body.enabled,true);assert.equal(mutations.at(-1).like,'true');assert.equal((await post('favorites')).body.songs[0].id,track.id);const calls=mutations.length;await post('favorite',{track,enabled:true});assert.equal(mutations.length,calls);
  failWrite=true;const failed=await post('favorite',{track,enabled:false});assert.equal(failed.status,400);assert.ok((await post('likes')).body.ids.includes(track.id));failWrite=false;
  failRead=true;const badSync=await post('likes',{force:true});assert.equal(badSync.body.status,'error');assert.ok(badSync.body.ids.includes(track.id));assert.equal((await post('favorites',{force:true})).status,400);failRead=false;
  let started;const whenStarted=new Promise(resolve=>{started=resolve;});readStarted=started;
  const staleRefresh=post('likes',{force:true});await whenStarted;
  const laterTrack={id:'999999',source:'netease',name:'刷新期间新增红心'};await post('favorite',{track:laterTrack,enabled:true});heldRead();await staleRefresh;assert.ok((await post('likes')).body.ids.includes('999999'));
  owner='42';await post('account');const switched=await post('likes');assert.deepEqual(switched.body.ids,['90001']);assert.equal(switched.body.owner,'42');
  await post('logout');assert.equal((await post('likes')).body.status,'signedout');assert.equal((await post('favorite',{track,enabled:true})).status,400);
  console.log('PASS: 650 hearts in exact cloud-playlist order across pages despite shuffled detail responses; cloud reordering refreshes, new likes go first, confirmed add/unlike, failed writes, stale-refresh race, local isolation, account switch and logout');
 }finally{instance.server.closeAllConnections();await instance.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
