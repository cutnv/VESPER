'use strict';
const DEFAULT_SHORTCUTS={enabled:true,previous:'Control+Alt+Left',toggle:'Control+Alt+Space',next:'Control+Alt+Right'};
const ACTIONS={previous:'上一首',toggle:'播放 / 暂停',next:'下一首'};
function validateShortcuts(input){
  if(!input||typeof input!=='object')throw new Error('快捷键配置无效');
  const result={enabled:input.enabled!==false},seen=new Set();
  for(const action of Object.keys(ACTIONS)){
    const value=input[action];if(typeof value!=='string'||value.length>80)throw new Error(ACTIONS[action]+'快捷键无效');
    if(!value){result[action]='';continue;}
    const parts=value.split('+'),key=parts.pop(),modifiers=['Control','Alt','Shift','Super'].filter(m=>parts.includes(m));
    if(parts.length!==modifiers.length||parts.some(m=>!modifiers.includes(m))||!/^([A-Z0-9]|F([1-9]|1\d|2[0-4])|Left|Right|Up|Down|Space|Home|End|PageUp|PageDown|Insert|Delete)$/.test(key)||(!modifiers.some(m=>m!=='Shift')&&!/^F\d+$/.test(key)))throw new Error('请使用 Ctrl / Alt / Win 组合键，或 F1–F24');
    const canonical=[...modifiers,key].join('+');
    if(['Alt+F4','Alt+Tab','Alt+Escape','Control+Alt+Delete','Super+L','Super+D','Super+Tab'].includes(canonical))throw new Error('这是系统保留的组合键，请换一组');
    if(seen.has(canonical))throw new Error('上一首、播放暂停和下一首不能使用相同快捷键');
    seen.add(canonical);result[action]=canonical;
  }
  return result;
}
class ShortcutController {
  constructor(api,config,dispatch,persist){this.api=api;this.config=validateShortcuts(config);this.dispatch=dispatch;this.persist=persist;this.owned=new Set();this.suspended=false;this.error='';}
  unregister(){for(const key of this.owned)this.api.unregister(key);this.owned.clear();}
  register(config){if(!config.enabled)return;for(const action of Object.keys(ACTIONS)){const key=config[action];if(!key)continue;let ok=false;if(!this.api.isRegistered(key)){try{ok=this.api.register(key,()=>this.dispatch(action));}catch{}}if(!ok)throw new Error(ACTIONS[action]+'快捷键 '+key+' 被其他程序占用，请更换');this.owned.add(key);}}
  state(){return{config:{...this.config},suspended:this.suspended,error:this.error,registered:Object.fromEntries(Object.keys(ACTIONS).map(action=>[action,!!this.config[action]&&this.owned.has(this.config[action])&&this.api.isRegistered(this.config[action])]))};}
  apply(input,save=true){
    let config;try{config=validateShortcuts(input);}catch(error){return{...this.state(),ok:false,error:error.message};}
    const previous=this.config;this.unregister();
    try{this.register(config);if(save)this.persist(config);this.config=config;this.error='';if(this.suspended)this.unregister();return{ok:true,...this.state()};}
    catch(error){this.unregister();this.config=previous;if(!this.suspended){try{this.register(previous);}catch{this.unregister();}}this.error=error.message;return{ok:false,...this.state()};}
  }
  suspend(value){this.suspended=!!value;if(this.suspended){this.unregister();return{ok:true,...this.state()};}return this.apply(this.config,false);}
}
module.exports={DEFAULT_SHORTCUTS,ACTIONS,validateShortcuts,ShortcutController};
