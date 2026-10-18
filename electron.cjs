'use strict';
const path=require('node:path'),fs=require('node:fs');
const {app,BrowserWindow,ipcMain,dialog,Tray,Menu,nativeImage,shell,session,nativeTheme,globalShortcut,screen}=require('electron');
const {ShortcutController}=require('./shortcuts.cjs');
const {resizeBounds}=require('./window-resize.cjs');
const {configurePaths,startServer}=require('./server.cjs');
configurePaths();
for(const dir of ['data/profile','data/session','data/logs','data/crashes'])fs.mkdirSync(path.join(__dirname,dir),{recursive:true});
app.setName('VESPER');
nativeTheme.themeSource='dark';
for(const [name,folder]of Object.entries({userData:'data/profile',sessionData:'data/session',logs:'data/logs',crashDumps:'data/crashes',temp:'temp'}))app.setPath(name,path.join(__dirname,folder));
app.commandLine.appendSwitch('disk-cache-dir',path.join(__dirname,'cache/chromium'));
app.setAppUserModelId('local.vesper.player');
const WINDOW_MINIMUM=[1020,720];
let win,tray,service,shortcutController,quitting=false;
let playback={playing:false,hasTrack:false,canNext:false,loading:false},thumbnailSignature='';
let resizeGesture=null,dragGesture=null;
function prepareWindowExpansion(){win.setResizable(true);win.setMinimumSize(...WINDOW_MINIMUM);win.setMaximumSize(0,0);win.setMaximizable(true);}
function restoreWindowEdgePolicy(){if(!win||win.isDestroyed()||win.isMaximized()||win.isFullScreen()||resizeGesture)return;win.setResizable(false);win.setMinimumSize(...WINDOW_MINIMUM);win.setMaximizable(true);}
function finishResizeGesture(){if(!resizeGesture)return;resizeGesture=null;restoreWindowEdgePolicy();}
function showWindow(){if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus();}
function media(action){win?.webContents.send('media-action',action);}
function updateThumbnail(force=false){
  if(process.platform!=='win32'||!win||win.isDestroyed())return;
  const theme=nativeTheme.shouldUseDarkColorsForSystemIntegratedUI?'dark':'light',signature=JSON.stringify([playback,theme]);if(!force&&signature===thumbnailSignature)return;
  const image=kind=>nativeImage.createFromPath(path.join(__dirname,'assets','thumbnail',kind+'-'+theme+'.png'));
  // 当前原生实现以空 flags 表示启用，显式传 enabled 会被拒绝。
  const flags=enabled=>enabled?[]:['disabled'];
  const ok=win.setThumbarButtons([
    {tooltip:'上一首',icon:image('previous'),flags:flags(playback.canNext),click:()=>media('previous')},
    {tooltip:playback.playing?'暂停':'播放',icon:image(playback.playing?'pause':'play'),flags:flags(!playback.loading&&(playback.hasTrack||playback.canNext)),click:()=>media('toggle')},
    {tooltip:'下一首',icon:image('next'),flags:flags(playback.canNext),click:()=>media('next')},
  ]);if(ok)thumbnailSignature=signature;
}
async function quitApp(){if(quitting)return;quitting=true;try{if(win&&!win.isDestroyed())await win.webContents.executeJavaScript('typeof saveState === "function" ? saveState() : undefined');}catch{}app.quit();}
if(!app.requestSingleInstanceLock())app.quit();
else {
  app.on('second-instance',showWindow);
  app.whenReady().then(async()=>{
    service=await startServer({port:17634});
    shortcutController=new ShortcutController(globalShortcut,service.getSettings().shortcuts,media,config=>service.setShortcuts(config));
    shortcutController.apply(service.getSettings().shortcuts,false);
    // 缩放由自定义区域接管；仅在缩放手势中启用原生缩放，防止系统边框抢走贴边滚动条事件。
    win=new BrowserWindow({title:'VESPER',width:1460,height:960,minWidth:WINDOW_MINIMUM[0],minHeight:WINDOW_MINIMUM[1],show:false,frame:false,resizable:false,maximizable:true,backgroundColor:'#0b1016',icon:path.join(__dirname,'vesper.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,spellcheck:false,backgroundThrottling:false}});
    // 双击标题栏、系统菜单和应用按钮最大化之前，先解除固定尺寸约束。
    if(process.platform==='win32')win.hookWindowMessage(0x0112,wParam=>{if((wParam.readUInt32LE(0)&0xfff0)===0xf030)prepareWindowExpansion();});
    Menu.setApplicationMenu(null);
    session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
    session.defaultSession.setPermissionCheckHandler(()=>false);
    win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
    win.webContents.on('will-navigate',(event,url)=>{if(url!==service.origin+'/')event.preventDefault();});
    win.on('close',event=>{if(!quitting){event.preventDefault();if(service.getSettings().closeToTray&&tray)win.hide();else quitApp();}});
    win.on('closed',()=>{win=null;});
    win.once('ready-to-show',()=>{win.show();updateThumbnail(true);});
    win.on('show',()=>updateThumbnail(true));
    win.on('blur',()=>{if(shortcutController.suspended)shortcutController.suspend(false);});
    nativeTheme.on('updated',()=>updateThumbnail(true));
    win.webContents.on('did-fail-load',(_event,code,description)=>{if(code!==-3)dialog.showErrorBox('VESPER加载失败',description);});
    function trusted(event){return !!win&&event.sender===win.webContents&&event.senderFrame?.url===service.origin+'/';}
    const windowState=()=>({fullscreen:win.isFullScreen(),maximized:win.isMaximized()});
    for(const event of ['enter-full-screen','leave-full-screen','maximize','unmaximize'])win.on(event,()=>{finishResizeGesture();restoreWindowEdgePolicy();dragGesture=null;win.webContents.send('window-state',windowState());});
    win.on('blur',()=>{finishResizeGesture();dragGesture=null;});
    ipcMain.handle('window-state-get',event=>trusted(event)?windowState():null);
    const validPoint=p=>p&&Number.isFinite(p.x)&&Number.isFinite(p.y)&&Math.abs(p.x)<100000&&Math.abs(p.y)<100000;
    ipcMain.handle('resize-start',(event,p)=>{if(!trusted(event)||win.isMaximized()||win.isFullScreen()||!validPoint(p)||!['n','s','e','w','ne','nw','se','sw'].includes(p.direction))return false;win.setResizable(true);win.setMinimumSize(...WINDOW_MINIMUM);resizeGesture={direction:p.direction,...screen.getCursorScreenPoint(),box:win.getBounds(),minimum:WINDOW_MINIMUM};return true;});
    ipcMain.on('resize-move',(event,p)=>{if(!trusted(event)||!resizeGesture||!validPoint(p)||win.isMaximized()||win.isFullScreen())return;const g=resizeGesture,point=screen.getCursorScreenPoint();win.setBounds(resizeBounds(g.box,g.direction,point.x-g.x,point.y-g.y,g.minimum));});
    ipcMain.on('resize-end',event=>{if(trusted(event))finishResizeGesture();});
    // 游标和窗口统一使用主进程 DIP 坐标，避免 Windows 缩放造成拖动偏移；沿用起始尺寸，避免逐帧取整累积。
    ipcMain.handle('drag-start',(event,p)=>{if(!trusted(event)||win.isMaximized()||win.isFullScreen()||!validPoint(p))return false;finishResizeGesture();dragGesture={...screen.getCursorScreenPoint(),box:win.getBounds()};return true;});
    ipcMain.on('drag-move',(event,p)=>{if(!trusted(event)||!dragGesture||!validPoint(p)||win.isMaximized()||win.isFullScreen())return;const g=dragGesture,point=screen.getCursorScreenPoint();win.setBounds({...g.box,x:Math.round(g.box.x+point.x-g.x),y:Math.round(g.box.y+point.y-g.y)});});
    ipcMain.on('drag-end',event=>{if(trusted(event))dragGesture=null;});
    ipcMain.on('playback-state',(event,state)=>{if(!trusted(event)||!state||typeof state!=='object')return;playback={playing:!!state.playing,hasTrack:!!state.hasTrack,canNext:!!state.canNext,loading:!!state.loading};updateThumbnail();});
    ipcMain.handle('shortcuts-get',event=>trusted(event)?shortcutController.state():null);
    ipcMain.handle('shortcuts-set',(event,config)=>trusted(event)?shortcutController.apply(config):{ok:false,error:'不允许的窗口请求'});
    ipcMain.handle('shortcuts-suspend',(event,value)=>trusted(event)?shortcutController.suspend(!!value):{ok:false,error:'不允许的窗口请求'});
    ipcMain.handle('window-control',(event,action)=>{if(!trusted(event))return;if(action==='minimize')win.minimize();if(action==='maximize'){finishResizeGesture();if(win.isMaximized())win.unmaximize();else{prepareWindowExpansion();win.maximize();}}if(action==='fullscreen'){finishResizeGesture();if(!win.isFullScreen())prepareWindowExpansion();win.setFullScreen(!win.isFullScreen());}if(action==='close')win.close();if(action==='quit')quitApp();if(action==='folder')return shell.openPath(__dirname);});
    ipcMain.handle('import-audio',async event=>{
      if(!trusted(event))throw new Error('不允许的窗口请求');
      const result=await dialog.showOpenDialog(win,{title:'选择本地音乐（会复制到 D 盘曲库）',properties:['openFile','multiSelections'],filters:[{name:'音乐文件',extensions:['mp3','flac','wav','m4a','ogg','aac','opus']}]});
      if(result.canceled)return{canceled:true};return service.importLocal(result.filePaths);
    });
    const image=nativeImage.createFromPath(path.join(__dirname,'icon.png'));
    if(!image.isEmpty()){
      tray=new Tray(image.resize({width:20,height:20}));tray.setToolTip('VESPER');tray.on('double-click',showWindow);
      tray.setContextMenu(Menu.buildFromTemplate([{label:'打开VESPER',click:showWindow},{type:'separator'},{label:'播放 / 暂停',click:()=>media('toggle')},{label:'上一首',click:()=>media('previous')},{label:'下一首',click:()=>media('next')},{type:'separator'},{label:'退出',click:quitApp}]));
    }
    await win.loadURL(service.origin+'/');
  }).catch(error=>{dialog.showErrorBox('VESPER启动失败',error.code==='EADDRINUSE'?'播放器端口被占用，请关闭旧的VESPER窗口后重试。':error.message);app.quit();});
}
app.on('before-quit',()=>{quitting=true;});
app.on('will-quit',()=>{shortcutController?.unregister();tray?.destroy();service?.server.close();});
app.on('window-all-closed',()=>{if(!tray||quitting)app.quit();});
