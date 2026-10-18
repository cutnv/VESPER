'use strict';
const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('desktop',{
  control:action=>{if(['minimize','maximize','fullscreen','close','quit','folder'].includes(action))return ipcRenderer.invoke('window-control',action);},
  getWindowState:()=>ipcRenderer.invoke('window-state-get'),
  startResize:point=>ipcRenderer.invoke('resize-start',point),
  moveResize:point=>ipcRenderer.send('resize-move',point),
  endResize:()=>ipcRenderer.send('resize-end'),
  startDrag:point=>ipcRenderer.invoke('drag-start',point),
  moveDrag:point=>ipcRenderer.send('drag-move',point),
  endDrag:()=>ipcRenderer.send('drag-end'),
  onWindowState:callback=>{if(typeof callback==='function')ipcRenderer.on('window-state',(_event,state)=>callback(state));},
  importAudio:()=>ipcRenderer.invoke('import-audio'),
  playbackState:state=>ipcRenderer.send('playback-state',state),
  getShortcuts:()=>ipcRenderer.invoke('shortcuts-get'),
  saveShortcuts:config=>ipcRenderer.invoke('shortcuts-set',config),
  suspendShortcuts:value=>ipcRenderer.invoke('shortcuts-suspend',!!value),
  onMedia:callback=>{if(typeof callback!=='function')return;ipcRenderer.on('media-action',(_event,action)=>{if(['toggle','next','previous'].includes(action))callback(action);});}
});
