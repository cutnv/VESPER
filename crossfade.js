'use strict';
// 两个原生音频元素，一条 Web Audio 时间线；音量曲线不依赖窗口动画帧。
class CrossfadeDeck {
  constructor(first,second,{resolve,onSwitch,onFinish,onStandbyError}){
    this.active=first;this.spare=second;this.resolve=resolve;this.onSwitch=onSwitch;this.onFinish=onFinish;this.onStandbyError=onStandbyError;
    this.context=null;this.nodes=new Map();this.prepared=null;this.transition=null;this.generation=0;this.duration=4;this.preparing=null;this.starting=false;
  }
  async setup(){
    if(!this.context){this.context=new AudioContext();for(const element of [this.active,this.spare]){const source=this.context.createMediaElementSource(element),gain=this.context.createGain();source.connect(gain);gain.connect(this.context.destination);this.nodes.set(element,gain.gain);}this.setGain(this.active,1);this.setGain(this.spare,0);}
    if(this.suspension)await this.suspension;
    return this.context.resume();
  }
  setGain(element,value){const gain=this.nodes.get(element);if(!gain)return;const now=this.context.currentTime;if(gain.cancelAndHoldAtTime)gain.cancelAndHoldAtTime(now);else gain.cancelScheduledValues(0);gain.setValueAtTime(value,now);}
  setVolume(volume,muted=false){for(const element of [this.active,this.spare]){element.volume=volume;element.muted=muted;}}
  reset(){
    this.generation++;this.prepared=null;this.preparing=null;this.starting=false;
    if(this.transition)clearTimeout(this.transition.timer);this.transition=null;
    this.spare.pause();this.spare.removeAttribute('src');this.spare.load();this.setGain(this.active,1);this.setGain(this.spare,0);
  }
  async prepare(track){
    const identity=track&&`${track.source}:${track.id}`;
    if(!track||!this.duration||this.transition)return;
    if(this.prepared?.identity===identity||this.preparing?.identity===identity)return;
    this.reset();const generation=this.generation;
    const pending={identity,track};this.preparing=pending;
    try{
      const info=await this.resolve(track);if(generation!==this.generation)return;
      if(info.trial){this.preparing=null;this.prepared={identity,unavailable:true};return;}
      this.spare.src=info.url;this.spare.preload='auto';this.spare.load();
      this.prepared={identity,track,info,generation};
    }catch{if(generation===this.generation){this.prepared={identity,unavailable:true};this.onStandbyError?.();}}
    finally{if(this.preparing===pending)this.preparing=null;}
  }
  async tick(){
    const p=this.prepared,old=this.active,next=this.spare;
    if(!p||p.unavailable||this.transition||this.starting||old.paused||old.seeking||!Number.isFinite(old.duration)||next.readyState<3)return;
    const remaining=old.duration-old.currentTime;
    if(!Number.isFinite(next.duration)||next.duration<2)return;
    const fade=Math.min(this.duration,old.duration*.4,next.duration*.4);
    if(remaining>fade||remaining<.18)return;
    this.starting=true;const generation=this.generation;
    try{
      await this.setup();this.setGain(next,0);next.volume=old.volume;next.muted=old.muted;await next.play();
      if(generation!==this.generation||old.paused){next.pause();this.starting=false;return;}
      const seconds=Math.min(fade,old.duration-old.currentTime);
      if(seconds<.12){next.pause();this.starting=false;return;}
      const start=this.context.currentTime,outgoing=new Float32Array(65),incoming=new Float32Array(65);
      for(let i=0;i<65;i++){outgoing[i]=Math.cos(i/64*Math.PI/2);incoming[i]=Math.sin(i/64*Math.PI/2);}
      this.nodes.get(old).setValueCurveAtTime(outgoing,start,seconds);this.nodes.get(next).setValueCurveAtTime(incoming,start,seconds);
      this.active=next;this.spare=old;this.prepared=null;
      this.transition={old,next,start,seconds,timer:setTimeout(()=>this.finish(),seconds*1000+60)};
      this.onSwitch(p.track,p.info,next,old);this.starting=false;
    }catch{next.pause();this.setGain(old,1);this.setGain(next,0);this.prepared={identity:p.identity,unavailable:true};this.starting=false;}
  }
  finish(){if(!this.transition)return;clearTimeout(this.transition.timer);const{old,next}=this.transition;old.pause();old.removeAttribute('src');old.load();this.setGain(old,0);this.setGain(next,1);this.transition=null;this.onFinish?.();}
  pause(){if(this.transition)clearTimeout(this.transition.timer);this.active.pause();this.spare.pause();if(this.context?.state==='running')this.suspension=this.context.suspend().catch(()=>{});}
  async resume(){await this.setup();if(this.transition){await this.spare.play().catch(()=>{});const remaining=Math.max(0,this.transition.seconds-(this.context.currentTime-this.transition.start));this.transition.timer=setTimeout(()=>this.finish(),remaining*1000+60);}await this.active.play();}
  seek(){this.reset();}
}
window.CrossfadeDeck=CrossfadeDeck;
