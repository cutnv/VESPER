'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const{startServer,parseId,isTrial,safeMediaURL,parseLRC,validatedSettings}=require('./server.cjs');
const{interpretLyrics}=require('./server.cjs');assert.equal(interpretLyrics({nolyric:true}).instrumental,true);assert.equal(interpretLyrics({lrc:{lyric:'[99:00.00]纯音乐，请欣赏'}}).instrumental,true);assert.equal(interpretLyrics({uncollected:true}).instrumental,false);assert.equal(interpretLyrics({lrc:{lyric:'[00:00.00]这是一句普通歌词'}}).instrumental,false);
assert.equal(parseId('https://music.163.com/#/song?id=123&userid=88'),'123');
assert.equal(parseId('https://music.163.com/#/playlist?id=999','playlist'),'999');
assert.equal(parseId('https://music.163.com/#/playlist?id=999'),null);
assert.equal(parseId('https://music.163.com/song/123/'),'123');
assert.equal(isTrial({freeTrialInfo:{start:0,end:30000}}),true);
assert.equal(isTrial({freeTrialInfo:null}),false);assert.equal(isTrial({freeTrialInfo:'null'}),false);
assert.deepEqual(parseLRC('[ar:test]\n[00:01.50][00:02.50]hello\n[01:00.00]world'),[{time:1.5,text:'hello'},{time:2.5,text:'hello'},{time:60,text:'world'}]);
assert.equal(validatedSettings({volume:200,quality:'fake'}).volume,1);assert.equal(validatedSettings({quality:'fake'}).quality,'lossless');
assert.equal(validatedSettings({crossfade:0}).crossfade,0);assert.equal(validatedSettings({crossfade:8}).crossfade,8);assert.equal(validatedSettings({crossfade:-1}).crossfade,4);
const vm=require('node:vm'),appearance={window:{}};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'appearance.js'),'utf8'),appearance);
const palette=appearance.window.ArtworkColors.extract([255,0,0,255,255,0,0,255,255,0,0,255,0,0,255,255]);assert.equal(palette[0].join(','),'255,0,0');assert.ok(appearance.window.ArtworkColors.dark([255,200,100]).every(v=>v<=110));
assert.throws(()=>safeMediaURL('http://127.0.0.1/a'));assert.throws(()=>safeMediaURL('https://music.126.net.evil.com/a'));
function wav(){const samples=8000*8,data=Buffer.alloc(44+samples*2);data.write('RIFF',0);data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(8000,24);data.writeUInt32LE(16000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);return data;}
async function post(origin,token,name,body={}){const r=await fetch(origin+'/api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':token},body:JSON.stringify(body)});return{status:r.status,body:await r.json()};}
(async()=>{
  const folder=path.join(__dirname,'tests','check-'+Date.now());fs.mkdirSync(folder,{recursive:true});
  const instance=await startServer({port:0,dataDir:folder,skipKey:true,sdk:{song_url_v1:async()=>({body:{data:[{url:'https://m701.music.126.net/sample.mp3',level:'exhigh',type:'mp3',br:320000,freeTrialInfo:null}]}}),lyric:async()=>({body:{lrc:{lyric:'[00:01]测试'}}})}});
  try{
    const{origin,token}=instance;
    const background=await fetch(origin+'/home-background.jpg');assert.equal(background.headers.get('content-type'),'image/jpeg');assert.deepEqual(Buffer.from(await background.arrayBuffer()),fs.readFileSync(path.join(__dirname,'assets/home-background.jpg')));
    const blocked=await fetch(origin+'/api/bootstrap',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(blocked.status,403);
    const foreign=await fetch(origin,{headers:{Origin:'https://evil.com'}});assert.equal(foreign.status,403);
    const settings=await post(origin,token,'settings',{accent:'rose',volume:2});assert.equal(settings.body.accent,'rose');assert.equal(settings.body.volume,1);
    assert.equal(JSON.parse(fs.readFileSync(path.join(folder,'settings.json'),'utf8')).accent,'rose');
    const song={id:'123',source:'local',name:'<img src=x onerror=alert(1)>',artists:'test'};
    const fav=await post(origin,token,'favorite',{track:song,enabled:true});assert.equal(fav.body.favorites.length,1);
    const repeat=await post(origin,token,'favorite',{track:song,enabled:true});assert.equal(repeat.body.favorites.length,1);
    await post(origin,token,'state',{queue:[song],current:'netease:123',position:31});
    const bootstrap=await post(origin,token,'bootstrap');assert.equal(bootstrap.body.state.position,31);assert.equal(bootstrap.body.state.queue.length,1);assert.equal(bootstrap.body.account.loggedIn,false);
    assert.deepEqual((await post(origin,token,'playlists')).body,{playlists:[]});
    assert.equal((await post(origin,token,'home')).status,400);
    assert.equal((await post(origin,token,'daily')).status,400);
    const played=await post(origin,token,'play',{id:'123',quality:'lossless'});assert.equal(played.body.actual,'exhigh');assert.ok(played.body.url.startsWith('/media/'));assert.equal(played.body.trial,false);
    const lyric=await post(origin,token,'lyrics',{id:'123'});assert.equal(lyric.body.lines[0].time,1);
    const sample=path.join(folder,'range-check.wav');fs.writeFileSync(sample,wav());const imported=await instance.importLocal([sample,sample]);assert.equal(imported.added,1);const local=imported.songs[0];assert.ok(!Object.hasOwn(local,'file'));
    const bytes=await fetch(origin+'/local/'+local.id,{headers:{Range:'bytes=10-99'}});assert.equal(bytes.status,206);assert.equal((await bytes.arrayBuffer()).byteLength,90);
    const suffix=await fetch(origin+'/local/'+local.id,{headers:{Range:'bytes=-32'}});assert.equal((await suffix.arrayBuffer()).byteLength,32);
    const invalid=await fetch(origin+'/local/'+local.id,{headers:{Range:'bytes=999999999-'}});assert.equal(invalid.status,416);
    const noAuth=await fetch(origin+'/api/settings',{method:'POST',headers:{'Content-Type':'application/json','X-Local-Token':'bad'},body:'{}'});assert.equal(noAuth.status,403);
    fs.unlinkSync(path.join(__dirname,'local-music',local.id+'.wav'));
    console.log('PASS: link IDs, LRC timestamps, quality/volume validation, origin/token checks, favorites deduplication, persisted settings/queue, local import and byte ranges');
  }finally{instance.server.closeAllConnections();await instance.close();}
  if(process.argv.includes('--live')){
    const origin='http://127.0.0.1:17634',html=await(await fetch(origin)).text(),token=/name="local-token" content="([a-f0-9]+)"/.exec(html)[1];
    const bootstrap=await post(origin,token,'bootstrap');assert.equal(bootstrap.status,200);console.log('PASS: existing encrypted account restored = '+bootstrap.body.account.loggedIn);
    const home=await post(origin,token,'playlists');assert.equal(home.status,200);assert.ok(Array.isArray(home.body.playlists));assert.ok(!Object.hasOwn(home.body,'recommendations'));console.log('PASS: own playlists only, recommendation endpoints removed');
    const search=await post(origin,token,'search',{keywords:'After Hours'});assert.ok(search.body.songs.length>0);console.log('PASS: live search');
    if(home.body.playlists.length){const p=await post(origin,token,'playlist',{id:home.body.playlists[0].id});assert.equal(p.status,200);assert.ok(Array.isArray(p.body.songs));console.log('PASS: live playlist detail and songs');}
    const track=await post(origin,token,'play',{id:'1424460203',quality:'jyeffect'});assert.equal(track.status,200,JSON.stringify(track.body));assert.ok(track.body.url);const audio=await fetch(origin+track.body.url,{headers:{Range:'bytes=0-1023'},signal:AbortSignal.timeout(30000)});assert.ok([200,206].includes(audio.status));const reader=audio.body.getReader(),chunk=await reader.read();await reader.cancel();assert.ok(chunk.value.length>0);console.log('PASS: live audio through local proxy; actual = '+track.body.actual+', trial = '+track.body.trial);
    const lyrics=await post(origin,token,'lyrics',{id:'1424460203'});assert.ok(lyrics.body.lines.length>0);console.log('PASS: live synchronized lyrics');
  }
})().catch(e=>{console.error('FAIL:',e.stack||e);process.exitCode=1;});
