'use strict';
const http=require('node:http'),https=require('node:https'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {pipeline}=require('node:stream');
const {mergeCookies,safeMediaURL,protect}=require('./helpers.cjs');
const {DEFAULT_SHORTCUTS,validateShortcuts}=require('./shortcuts.cjs');
const ROOT=__dirname;
const SONG_PAGE_SIZE=400;
const LEVELS=['standard','exhigh','lossless','hires','jyeffect','jymaster','sky','vivid'];
const DEFAULTS={quality:'lossless',accent:'blue',theme:'dark',compact:false,lyricSize:22,volume:.65,mode:'loop',closeToTray:true,crossfade:4};
function configurePaths(){for(const dir of ['data','temp','cache','local-music'])fs.mkdirSync(path.join(ROOT,dir),{recursive:true});process.env.TEMP=path.join(ROOT,'temp');process.env.TMP=process.env.TEMP;process.env.ELECTRON_CACHE=path.join(ROOT,'cache/electron');process.env.DOTENV_CONFIG_QUIET='true';}
function readJSON(file,fallback){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return fallback;}}
function writeJSON(file,value){fs.writeFileSync(file+'.tmp',JSON.stringify(value));fs.renameSync(file+'.tmp',file);}
function parseId(input,type='song'){const value=String(input||'').trim();if(/^\d{1,20}$/.test(value))return value;return new RegExp(`(?:${type}[^\\s]*?[?&]id=|/${type}/)(\\d+)`).exec(value)?.[1]||null;}
function isTrial(track){return !!(track?.freeTrialInfo&&track.freeTrialInfo!=='null');}
function normalizeSong(s){return {id:String(s.id),source:'netease',name:s.name||'未命名歌曲',artists:(s.ar||s.artists||[]).map(a=>a.name).join(' / '),album:s.al?.name||s.album?.name||'',cover:s.al?.picUrl||s.album?.picUrl||'',duration:s.dt||s.duration||0,fee:s.fee||0};}
function normalizeArtist(a){return{id:String(a.id),name:a.name||'未知歌手',cover:a.picUrl||a.img1v1Url||'',albums:a.albumSize||0,songs:a.musicSize||0};}
function normalizeAlbum(a){return{id:String(a.id),name:a.name||'未命名专辑',cover:a.picUrl||'',artists:(a.artists||[a.artist]).filter(Boolean).map(x=>x.name).join(' / '),count:a.size||a.songCount||0};}
function uniqueById(items){const seen=new Set();return items.filter(item=>{if(!/^\d{1,20}$/.test(item.id)||seen.has(item.id))return false;seen.add(item.id);return true;});}
function playlistSummary(p){return {id:String(p.id),name:p.name,cover:p.coverImgUrl||p.picUrl||'',count:p.trackCount||0,description:p.description||'',creator:p.creator?.nickname||'',specialType:p.specialType||0};}
function parseLRC(text){const lines=[];for(const row of String(text||'').split(/\r?\n/)){const content=row.replace(/\[[^\]]*\]/g,'').trim();if(!content)continue;for(const m of row.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g))lines.push({time:Number(m[1])*60+Number(m[2]),text:content});}return lines.sort((a,b)=>a.time-b.time);}
function interpretLyrics(result){const lines=parseLRC(result.lrc?.lyric),marker=text=>/^(?:纯音乐[，,、\s]*(?:请(?:您)?欣赏)?|instrumental(?: music)?)[。.!！]?$/i.test(text.trim()),labels=lines.map(line=>line.text),plain=String(result.lrc?.lyric||'').replace(/\[[^\]]*\]/g,'').trim();const instrumental=result.nolyric===true||result.nolyric===1||marker(plain)||(labels.some(marker)&&labels.every(text=>marker(text)||/^(作词|作曲|编曲|制作人)\s*[:：]/.test(text)));return{lines:instrumental?[]:lines,translation:instrumental?[]:parseLRC(result.tlyric?.lyric),instrumental};}
function validatedSettings(input){const s={...DEFAULTS};for(const [key,values]of Object.entries({quality:LEVELS,accent:['blue','green','rose','amber'],theme:['light','dark'],mode:['loop','single','shuffle']}))if(values.includes(input?.[key]))s[key]=input[key];s.compact=!!input?.compact;s.closeToTray=input?.closeToTray!==false;s.volume=Number.isFinite(input?.volume)?Math.max(0,Math.min(1,input.volume)):.65;s.playerLayout=input?.playerLayout==='cover'?'cover':'split';s.crossfade=[0,2,4,6,8].includes(input?.crossfade)?input.crossfade:4;s.lyricSize=[18,22,26,30].includes(input?.lyricSize)?input.lyricSize:22;try{s.shortcuts=validateShortcuts(input?.shortcuts||DEFAULT_SHORTCUTS);}catch{s.shortcuts={...DEFAULT_SHORTCUTS};}return s;}

async function startServer(options={}){
  configurePaths();const dataDir=options.dataDir||path.join(ROOT,'data');fs.mkdirSync(dataDir,{recursive:true});
  const sdk=options.sdk||require('@neteasecloudmusicapienhanced/api');require('axios').default.defaults.timeout=15000;
  const deviceFile=path.join(dataDir,'device-id');global.deviceId=fs.existsSync(deviceFile)?fs.readFileSync(deviceFile,'utf8'):require('@neteasecloudmusicapienhanced/api/util/index').generateDeviceId();if(!fs.existsSync(deviceFile))fs.writeFileSync(deviceFile,global.deviceId);
  const sessionFile=path.join(dataDir,'session.dpapi');let cookie='';try{if(fs.existsSync(sessionFile))cookie=protect(fs.readFileSync(sessionFile),true).toString('utf8');}catch{}
  let user=null,qrKey='',keyPromise=null;
  let likesVersion=0,likesRevision=0,likesRequest=null,likesIds=new Set(),likesLoaded=false,likesAt=0;
  let likedPlaylistId=null;
  function resetLikes(){likesVersion++;likesRevision++;likesRequest=null;likesIds=new Set();likesLoaded=false;likesAt=0;likedPlaylistId=null;}
  let settings=validatedSettings(readJSON(path.join(dataDir,'settings.json'),DEFAULTS));
  let state=readJSON(path.join(dataDir,'player.json'),{queue:[],current:null,position:0});
  let library=readJSON(path.join(dataDir,'local-library.json'),[]),favorites=readJSON(path.join(dataDir,'favorites.json'),[]);
  const images=new Map(),media=new Map(),token=crypto.randomBytes(24).toString('hex');let origin='';
  const log=console.log.bind(console);console.log=(...a)=>a[0]==='[ERR]'?log('网易云请求失败，凭证详情不写入日志。'):log(...a);
  async function call(name,args={}){try{return(await sdk[name]({...args,cookie:mergeCookies(cookie,'deviceId='+global.deviceId),timeout:15000,timestamp:Date.now()})).body;}catch(e){throw new Error(typeof e?.body?.message==='string'?e.body.message:typeof e?.body?.msg==='string'?e.body.msg:'网易云连接失败，请检查网络或重新扫码登录');}}
  async function songDetails(ids){const batches=[];for(let i=0;i<ids.length;i+=200)batches.push(call('song_detail',{ids:ids.slice(i,i+200).join(',')}));const results=await Promise.all(batches);if(results.some(result=>!Array.isArray(result.songs)))throw new Error('歌曲详情加载失败，请重试');const byId=new Map(results.flatMap(result=>result.songs).map(song=>[String(song.id),song]));return ids.map(id=>byId.has(id)?normalizeSong(byId.get(id)):{id,source:'netease',name:'暂不可用的歌曲',artists:'网易云音乐',album:'',cover:'',duration:0});}
  async function playbackKey(){if(options.skipKey)return;if(!keyPromise)keyPromise=(async()=>{const file=path.join(ROOT,'temp/xeapi_public_key');const key=await require('@neteasecloudmusicapienhanced/api/util/xeapiKey').getXeapiPublicKey(readJSON(file,{}),global.deviceId);writeJSON(file,key);})().catch(()=>{keyPromise=null;throw new Error('初始化播放连接失败，请稍后重试');});return keyPromise;}
  async function account(){if(!cookie){if(user)resetLikes();user=null;return{loggedIn:false};}const result=await call('login_status'),p=(result.data||result).profile;if(!p?.userId){if(user)resetLikes();user=null;return{loggedIn:false,expired:true};}if(user?.id!==String(p.userId))resetLikes();user={loggedIn:true,id:String(p.userId),nickname:p.nickname,avatar:p.avatarUrl||'',vip:!!p.vipType};return user;}
  async function syncLikes(force=false){
    if(!user)throw new Error('请先扫码登录网易云账号');
    if(likesLoaded&&!force&&Date.now()-likesAt<30000)return;
    if(likesRequest)return likesRequest;
    const version=likesVersion,revision=likesRevision,uid=user.id;
    const pending=(async()=>{
      if(!likedPlaylistId){
        const result=await call('user_playlist',{uid,limit:100});
        if(version!==likesVersion||user?.id!==uid)throw new Error('账号已切换，请重新同步红心');
        if(!Array.isArray(result.playlist))throw new Error('网易云歌单读取失败，请重试');
        const playlist=result.playlist.find(p=>Number(p.specialType)===5&&String(p.creator?.userId??uid)===uid);
        if(!playlist||!/^\d{1,20}$/.test(String(playlist.id)))throw new Error('未找到“我喜欢的音乐”歌单，请重新同步红心');
        likedPlaylistId=String(playlist.id);
      }
      // likelist 接口无序；歌单 trackIds 才是网易云保存的歌曲顺序。
      const result=await call('playlist_detail',{id:likedPlaylistId});
      if(version!==likesVersion||user?.id!==uid)throw new Error('账号已切换，请重新同步红心');
      if(!Array.isArray(result.playlist?.trackIds))throw new Error('网易云红心同步失败，请重试');
      if(revision===likesRevision){likesIds=new Set(result.playlist.trackIds.map(t=>String(t.id)).filter(id=>/^\d{1,20}$/.test(id)));likesLoaded=true;likesAt=Date.now();}
    })();
    likesRequest=pending;try{await pending;}finally{if(likesRequest===pending)likesRequest=null;}
  }
  async function likesResult(force=false){
    if(!user)return{status:'signedout',ids:[],owner:null};
    try{await syncLikes(force);return{status:'ready',ids:[...likesIds],owner:user.id};}
    catch(error){return{status:'error',ids:likesLoaded?[...likesIds]:null,owner:user?.id||null,error:error.message};}
  }
  function publicLocal(track){const{file,coverFile,...rest}=track;return{...rest,source:'local'};}
  async function resolveShare(input,type){let id=parseId(input,type);if(id)return id;const match=String(input||'').match(/https?:\/\/163cn\.tv\/[^\s<>"，。]+/);if(match){let link=match[0];for(let i=0;i<5;i++){const url=new URL(link);if(!(url.hostname==='163cn.tv'||url.hostname==='music.163.com'||url.hostname.endsWith('.music.163.com')))break;id=parseId(link,type);if(id)return id;const response=await fetch(link,{redirect:'manual',signal:AbortSignal.timeout(8000)});await response.body?.cancel();if(!response.headers.get('location'))break;link=new URL(response.headers.get('location'),link).href;}}throw new Error('没有识别到链接，请粘贴完整网易云链接或数字 ID');}
  async function action(name,b){
    if(name==='bootstrap'){let a,warning='';try{a=await account();}catch(e){a={loggedIn:false};warning=e.message;}const cloudLikes=a.loggedIn?await likesResult():{status:'signedout',ids:[],owner:null};return{account:a,settings,state,local:library.map(publicLocal),favorites:favorites.filter(t=>t.source==='local'),cloudLikes,warning};}
    if(name==='artwork'){const cover=String(b.cover||'');if(/^\/art\/local-[a-f0-9]{20}$/.test(cover))return{url:cover};safeMediaURL(cover);const id=crypto.randomUUID();if(images.size>=64)images.delete(images.keys().next().value);images.set(id,cover);return{url:'/image/'+id};}
    if(name==='account')return account();
    if(name==='qr/start'){const result=await call('login_qr_key');qrKey=result.data?.unikey;if(!qrKey)throw new Error('生成二维码失败，请重试');const qr=await call('login_qr_create',{key:qrKey,qrimg:true,platform:'pc'});return{image:qr.data?.qrimg};}
    if(name==='qr/check'){if(!qrKey)throw new Error('二维码已失效，请重新生成');const checked=qrKey,result=await call('login_qr_check',{key:checked});if(result.code===803&&checked===qrKey){if(!result.cookie)throw new Error('未返回登录凭证，请重试');cookie=mergeCookies(cookie,result.cookie);fs.writeFileSync(sessionFile,protect(cookie));qrKey='';return{code:803,account:await account()};}return{code:result.code};}
    if(name==='logout'){cookie='';user=null;resetLikes();qrKey='';media.clear();fs.rmSync(sessionFile,{force:true});return{ok:true};}
    if(name==='likes')return likesResult(b.force===true);
    if(name==='favorites'){
      const local=favorites.filter(t=>t.source==='local');if(!user)return{songs:local,total:local.length,cloudTotal:0,more:false,nextOffset:0,signedOut:true};
      await syncLikes(b.force===true);const owner=user.id,version=likesVersion,offset=Math.max(0,Number(b.offset)||0),ids=[...likesIds].slice(offset,offset+SONG_PAGE_SIZE),songs=await songDetails(ids);
      if(version!==likesVersion||user?.id!==owner)throw new Error('账号已切换，请重新同步红心');
      return{songs:offset===0?[...songs,...local]:songs,total:likesIds.size+local.length,cloudTotal:likesIds.size,nextOffset:offset+ids.length,more:offset+ids.length<likesIds.size};
    }
    if(name==='playlists'){if(!user)return{playlists:[]};const result=await call('user_playlist',{uid:user.id,limit:100});if(!Array.isArray(result.playlist))throw new Error('歌单读取失败，请重试');return{playlists:uniqueById(result.playlist.filter(p=>Number(p.specialType)!==5).map(playlistSummary))};}
    if(name==='subscribed-albums'||name==='followed-artists'){
      const kind=name==='subscribed-albums'?'album':'artist',offset=Math.max(0,Math.min(10000,Number(b.offset)||0));
      if(!user)return{kind,items:[],total:0,more:false,nextOffset:0,signedOut:true};
      const owner=user.id,r=await call(kind==='album'?'album_sublist':'artist_sublist',{limit:40,offset});
      if(user?.id!==owner)throw new Error('账号已切换，请重新加载');
      if(!Array.isArray(r.data))throw new Error(kind==='album'?'收藏专辑读取失败，请重试':'关注歌手读取失败，请重试');
      const total=Number(r.count??r.total??r.data.length),nextOffset=offset+r.data.length;
      return{kind,items:uniqueById(r.data.map(kind==='album'?normalizeAlbum:normalizeArtist)),total,nextOffset,more:r.data.length>0&&(r.hasMore??r.more??nextOffset<total)};
    }
    if(name==='suggest'){
      const keywords=String(b.keywords||'').normalize('NFKC').trim().slice(0,100);if(!keywords)return{songs:[],artists:[],albums:[]};
      const r=await call('search_suggest',{keywords,type:'web'});if(!r.result)throw new Error('匹配提示暂不可用，按 Enter 搜索');
      return{songs:uniqueById((r.result.songs||[]).map(normalizeSong)).slice(0,4),artists:uniqueById((r.result.artists||[]).map(normalizeArtist)).slice(0,3),albums:uniqueById((r.result.albums||[]).map(normalizeAlbum)).slice(0,3)};
    }
    if(name==='search'){const keywords=String(b.keywords||'').trim().slice(0,100);if(!keywords)throw new Error('输入歌名、歌手或专辑名');const kind=['songs','artists','albums'].includes(b.kind)?b.kind:'songs',type={songs:1,artists:100,albums:10}[kind],offset=Math.max(0,Math.min(10000,Number(b.offset)||0)),r=await call('cloudsearch',{keywords,type,limit:40,offset});if(!r.result)throw new Error('搜索暂时不可用，请重试');const items=(r.result[kind]||[]).map({songs:normalizeSong,artists:normalizeArtist,albums:normalizeAlbum}[kind]);return{kind,[kind]:items,total:r.result[{songs:'songCount',artists:'artistCount',albums:'albumCount'}[kind]]||items.length,offset};}
    if(name==='artist'||name==='album'){
      const id=String(b.id||'');if(!/^\d{1,20}$/.test(id))throw new Error('歌手或专辑 ID 无效');
      const owner=user?.id||null,version=likesVersion;
      const status=name==='album'&&user?call('album_detail_dynamic',{id}).then(r=>{if(r.code!==200||typeof r.isSub!=='boolean')throw new Error('专辑收藏状态读取失败，请重试');return{subscribed:r.isSub};}).catch(error=>({subscribed:null,subscriptionError:error.message})):Promise.resolve({subscribed:false});
      const[r,subscription]=await Promise.all([call(name==='artist'?'artists':'album',{id}),status]),entity=name==='artist'?r.artist:r.album;
      if(!entity)throw new Error('内容暂时不可用，请重试');
      if(name==='album'&&(version!==likesVersion||(user?.id||null)!==owner))throw new Error('账号已切换，请重新加载专辑');
      return{...(name==='artist'?normalizeArtist(entity):{...normalizeAlbum(entity),...subscription,owner}),songs:(name==='artist'?r.hotSongs||[]:r.songs||[]).map(normalizeSong)};
    }
    if(name==='album-favorite'){
      const id=String(b.id||'');if(!/^\d{1,20}$/.test(id)||typeof b.enabled!=='boolean')throw new Error('专辑收藏参数无效');
      if(!user)throw new Error('请先扫码登录网易云账号');
      const owner=user.id,version=likesVersion;if(b.owner!==owner)throw new Error('账号已切换，请重新加载专辑');
      const result=await call('album_sub',{id,t:b.enabled?1:2});
      if(version!==likesVersion||user?.id!==owner)throw new Error('账号已切换，请重新加载专辑');
      if(result.code!==200)throw new Error(result.message||result.msg||'网易云专辑收藏更新失败，请重试');
      return{id,enabled:b.enabled,owner};
    }
    if(name==='playlist'){const id=await resolveShare(b.id||b.input,'playlist'),p=(await call('playlist_detail',{id})).playlist;if(!p)throw new Error('歌单读取失败，私密歌单需要登录所属账号');const offset=Math.max(0,Number(b.offset)||0),ids=(p.trackIds||[]).slice(offset,offset+SONG_PAGE_SIZE).map(t=>String(t.id));return{...playlistSummary(p),songs:await songDetails(ids),total:p.trackIds?.length||0,offset};}
    if(name==='song'){const id=await resolveShare(b.input,'song'),r=await call('song_detail',{ids:id});if(!r.songs?.[0])throw new Error('没有找到这首歌');return normalizeSong(r.songs[0]);}
    if(name==='play'){const id=String(b.id||'');if(!/^\d{1,20}$/.test(id))throw new Error('歌曲 ID 无效');await playbackKey();const requested=LEVELS.includes(b.quality)?b.quality:settings.quality;let track=(await call('song_url_v1',{id,level:requested,unblock:'false'})).data?.[0];if((!track?.url||isTrial(track))&&!['exhigh','standard'].includes(requested)){const fallback=(await call('song_url_v1',{id,level:'exhigh',unblock:'false'})).data?.[0];if(fallback?.url&&(!isTrial(fallback)||!track?.url))track=fallback;}if(!track?.url)throw new Error(user?'当前歌曲暂不可播放，可能受版权或账号权限限制':'当前歌曲不可播放；扫码登录可使用会员权限');safeMediaURL(track.url);const key=crypto.randomUUID();if(media.size>=1000)media.delete(media.keys().next().value);media.set(key,track.url);return{url:'/media/'+key,requested,actual:track.level||null,type:track.type||'',bitrate:track.br||0,sampleRate:track.sr||0,trial:isTrial(track),expires:Date.now()+(track.expi||1200)*1000};}
    if(name==='lyrics'){if(!/^\d{1,20}$/.test(String(b.id)))throw new Error('歌曲 ID 无效');return interpretLyrics(await call('lyric',{id:b.id}));}
    if(name==='favorite'){
      const t=b.track;if(!t||!['local','netease'].includes(t.source)||typeof t.id!=='string'||typeof t.name!=='string'||typeof b.enabled!=='boolean')throw new Error('歌曲信息无效');
      if(t.source==='netease'){
        if(!/^\d{1,20}$/.test(t.id))throw new Error('歌曲 ID 无效');await syncLikes();const version=likesVersion,uid=user.id;
        if(likesIds.has(t.id)!==b.enabled){const result=await call('like',{id:t.id,like:b.enabled?'true':'false'});if(result.code!==200)throw new Error(result.message||'网易云红心更新失败，请重试');if(version!==likesVersion||user?.id!==uid)throw new Error('账号已切换，请重新同步红心');if(b.enabled)likesIds=new Set([t.id,...likesIds]);else likesIds.delete(t.id);likesRevision++;likesAt=Date.now();}
        return{id:t.id,enabled:b.enabled,owner:uid,total:likesIds.size};
      }
      if(b.enabled&&!favorites.some(x=>x.id===t.id&&x.source===t.source))favorites.unshift(t);if(!b.enabled)favorites=favorites.filter(x=>x.id!==t.id||x.source!==t.source);favorites=favorites.slice(0,2000);writeJSON(path.join(dataDir,'favorites.json'),favorites);return{favorites:favorites.filter(t=>t.source==='local')};
    }
    if(name==='settings'){settings=validatedSettings({...settings,...b});writeJSON(path.join(dataDir,'settings.json'),settings);return settings;}
    if(name==='state'){if(!Array.isArray(b.queue)||b.queue.length>2000)throw new Error('播放列表过长');state={queue:b.queue.filter(t=>t&&typeof t.id==='string'&&['netease','local'].includes(t.source)&&typeof t.name==='string'),current:typeof b.current==='string'?b.current:null,position:Math.max(0,Number(b.position)||0)};writeJSON(path.join(dataDir,'player.json'),state);return{ok:true};}
    if(name==='local')return{songs:library.map(publicLocal)};
    throw new Error('不支持的操作');
  }
  async function importLocal(files){const{parseFile}=await import('music-metadata');let added=0;const errors=[];for(const source of files.slice(0,500)){try{const ext=path.extname(source).toLowerCase();if(!['.mp3','.flac','.wav','.m4a','.ogg','.aac','.opus'].includes(ext))continue;const stat=fs.statSync(source);if(!stat.isFile())continue;
      // ponytail: 选择文件时按路径、大小、修改时间去重，不做后台全盘扫描。
      const id='local-'+crypto.createHash('sha256').update(source+'|'+stat.size+'|'+stat.mtimeMs).digest('hex').slice(0,20);if(library.some(t=>t.id===id))continue;const destination=path.join(ROOT,'local-music',id+ext);await require('node:stream/promises').pipeline(fs.createReadStream(source),fs.createWriteStream(destination));const m=await parseFile(destination,{duration:true,skipCovers:false}),c=m.common;let cover='',coverFile='';if(c.picture?.[0]?.data?.length<3000000){const p=c.picture[0];if(['image/jpeg','image/png','image/webp'].includes(p.format)){coverFile=path.join(ROOT,'local-music',id+'.cover');fs.writeFileSync(coverFile,Buffer.from(p.data));cover='/art/'+id;}}
      library.push({id,source:'local',name:c.title||path.basename(source,ext),artists:c.artists?.join(' / ')||c.artist||'未知歌手',album:c.album||'本地音乐',duration:(m.format.duration||0)*1000,cover,coverFile,file:destination,bitrate:m.format.bitrate||0,type:ext.slice(1),sampleRate:m.format.sampleRate||0});added++;
    }catch{errors.push(path.basename(source));}}writeJSON(path.join(dataDir,'local-library.json'),library);return{added,errors,songs:library.map(publicLocal)};}
  function proxy(value,req,res,redirects=0){let url;try{url=safeMediaURL(value);}catch{res.writeHead(502).end();return;}const headers={'User-Agent':'Mozilla/5.0',Referer:'https://music.163.com/'};if(req.headers.range&&/^bytes=\d*-\d*$/.test(req.headers.range))headers.Range=req.headers.range;const upstream=(url.protocol==='https:'?https:http).get(url,{headers},r=>{if([301,302,303,307,308].includes(r.statusCode)&&r.headers.location){r.resume();if(redirects>=4){res.writeHead(502).end();return;}try{proxy(new URL(r.headers.location,url).href,req,res,redirects+1);}catch{res.writeHead(502).end();}return;}const headers={'Cache-Control':'no-store'};for(const key of ['content-type','content-length','content-range','accept-ranges'])if(r.headers[key])headers[key]=r.headers[key];res.writeHead(r.statusCode||502,headers);pipeline(r,res,()=>{});});upstream.setTimeout(25000,()=>upstream.destroy());upstream.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end();});res.on('close',()=>upstream.destroy());}
  function localAudio(id,req,res){const track=library.find(t=>t.id===id);if(!track||!fs.existsSync(track.file)){res.writeHead(404).end();return;}const file=path.resolve(track.file);if(!file.startsWith(path.resolve(ROOT,'local-music')+path.sep)){res.writeHead(403).end();return;}const size=fs.statSync(file).size;let start=0,end=size-1,status=200;if(req.headers.range){const m=/^bytes=(\d*)-(\d*)$/.exec(req.headers.range);if(!m){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}if(m[1]){start=Number(m[1]);if(m[2])end=Math.min(end,Number(m[2]));}else if(m[2])start=Math.max(0,size-Number(m[2]));if(start>=size||end<start){res.writeHead(416,{'Content-Range':`bytes */${size}`}).end();return;}status=206;}const mime={mp3:'audio/mpeg',flac:'audio/flac',wav:'audio/wav',m4a:'audio/mp4',ogg:'audio/ogg',aac:'audio/aac',opus:'audio/ogg'};const headers={'Content-Type':mime[track.type]||'application/octet-stream','Content-Length':end-start+1,'Accept-Ranges':'bytes'};if(status===206)headers['Content-Range']=`bytes ${start}-${end}/${size}`;res.writeHead(status,headers);if(req.method==='HEAD')res.end();else pipeline(fs.createReadStream(file,{start,end}),res,()=>{});}
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.126.net https://*.163.com; media-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    if(req.headers.host!==new URL(origin).host||(req.headers.origin&&req.headers.origin!==origin)){res.writeHead(403).end();return;}const pathname=new URL(req.url,origin).pathname;
    if(req.method==='GET'&&pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({app:'vesper'}));return;}
    const assets={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/search-suggestions.js':['search-suggestions.js','text/javascript'],'/appearance.js':['appearance.js','text/javascript'],'/resize.js':['resize.js','text/javascript'],'/crossfade.js':['crossfade.js','text/javascript'],'/style.css':['style.css','text/css'],'/home-background.jpg':['assets/home-background.jpg','image/jpeg'],'/icon.svg':['icon.svg','image/svg+xml'],'/icon.png':['icon.png','image/png']};
    if(req.method==='GET'&&assets[pathname]){const[file,type]=assets[pathname];try{let bytes=fs.readFileSync(path.join(ROOT,file));if(file==='index.html')bytes=Buffer.from(bytes.toString('utf8').replace('__LOCAL_TOKEN__',token));res.setHeader('Content-Type',type+(type.startsWith('text/')||type==='image/svg+xml'?'; charset=utf-8':''));res.end(bytes);}catch{res.writeHead(404).end();}return;}
    if(req.method==='GET'&&pathname.startsWith('/image/')){const url=images.get(pathname.slice(7));if(url)proxy(url,req,res);else res.writeHead(404).end();return;}
    if(req.method==='GET'&&pathname.startsWith('/media/')){const value=media.get(pathname.slice(7));if(value)proxy(value,req,res);else res.writeHead(404).end();return;}
    if(req.method==='GET'&&pathname.startsWith('/art/')){const track=library.find(t=>t.id===pathname.slice(5));if(!track?.coverFile||!path.resolve(track.coverFile).startsWith(path.resolve(ROOT,'local-music')+path.sep)){res.writeHead(404).end();return;}try{const bytes=fs.readFileSync(track.coverFile);res.setHeader('Content-Type',bytes[0]===137?'image/png':bytes[0]===255?'image/jpeg':'image/webp');res.end(bytes);}catch{res.writeHead(404).end();}return;}
    if(['GET','HEAD'].includes(req.method)&&pathname.startsWith('/local/')){localAudio(pathname.slice(7),req,res);return;}
    if(req.method!=='POST'||!pathname.startsWith('/api/')){res.writeHead(404).end();return;}if(req.headers['x-local-token']!==token||!req.headers['content-type']?.startsWith('application/json')){res.writeHead(403).end();return;}
    res.setHeader('Content-Type','application/json; charset=utf-8');try{let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>8000000)throw new Error('数据太大，请分批操作');chunks.push(chunk);}res.end(JSON.stringify(await action(pathname.slice(5),JSON.parse(Buffer.concat(chunks).toString()||'{}'))));}catch(e){if(!res.headersSent)res.writeHead(400);res.end(JSON.stringify({error:e.message||'操作失败，请重试'}));}
  });server.requestTimeout=60000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(options.port??17634,'127.0.0.1',()=>{origin='http://127.0.0.1:'+server.address().port;resolve();});});
  return{server,origin,token,importLocal,getSettings:()=>settings,setShortcuts:config=>{const updated=validatedSettings({...settings,shortcuts:config});writeJSON(path.join(dataDir,'settings.json'),updated);settings=updated;return settings.shortcuts;},close:()=>new Promise(resolve=>server.close(resolve))};
}
module.exports={startServer,configurePaths,parseId,isTrial,safeMediaURL,parseLRC,interpretLyrics,validatedSettings,protect,normalizeSong};
if(require.main===module)startServer().then(s=>console.log('VESPER已启动：'+s.origin)).catch(e=>{console.error(e.message);process.exitCode=1;});
