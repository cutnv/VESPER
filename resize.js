'use strict';
// Blank surfaces move the window; controls, scrollbars and lyric scrolling keep their input.
{
  const surface=document.querySelector('.app-shell');let pointer=null,frame=0,latest=null;
  surface.addEventListener('pointerdown',event=>{
    if(event.button!==0||!window.desktop||nativeWindowState.maximized||nativeWindowState.fullscreen||event.target.closest('button,input,select,textarea,a,[role=button],.song-table,.lyrics,.track-titles,.search-box,.search-suggestions,.favorites-search,.resize-grip,dialog'))return;
    const scroller=event.target.closest('.main-content,.side-content');if(scroller&&event.clientX>=scroller.getBoundingClientRect().left+scroller.clientLeft+scroller.clientWidth)return;
    event.preventDefault();pointer=event.pointerId;surface.setPointerCapture(pointer);
    window.desktop.startDrag({x:event.screenX,y:event.screenY}).then(ok=>{if(!ok&&pointer===event.pointerId){surface.releasePointerCapture(pointer);pointer=null;}});
  });
  surface.addEventListener('pointermove',event=>{if(pointer!==event.pointerId)return;latest={x:event.screenX,y:event.screenY};if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(pointer!==null)window.desktop.moveDrag(latest);});});
  const end=()=>{if(pointer===null)return;if(frame){cancelAnimationFrame(frame);frame=0;if(latest)window.desktop.moveDrag(latest);}const captured=pointer;pointer=null;latest=null;if(surface.hasPointerCapture(captured))surface.releasePointerCapture(captured);window.desktop.endDrag();};
  surface.addEventListener('pointerup',end);surface.addEventListener('pointercancel',end);surface.addEventListener('lostpointercapture',end);window.addEventListener('blur',end);
}
for(const direction of ['n','s','e','w','ne','nw','se','sw']){
  const grip=document.createElement('div');grip.className='resize-grip resize-'+direction;grip.dataset.direction=direction;grip.setAttribute('aria-hidden','true');document.body.append(grip);
  let pointer=null,frame=0,latest=null;
  grip.addEventListener('pointerdown',event=>{if(event.button!==0||!window.desktop)return;event.preventDefault();pointer=event.pointerId;document.body.classList.add('window-resizing');grip.setPointerCapture(pointer);window.desktop.startResize({direction,x:event.screenX,y:event.screenY}).then(ok=>{if(!ok)end();}).catch(end);});
  grip.addEventListener('pointermove',event=>{if(pointer!==event.pointerId)return;latest={x:event.screenX,y:event.screenY};if(!frame)frame=requestAnimationFrame(()=>{frame=0;if(pointer!==null)window.desktop.moveResize(latest);});});
  const end=()=>{if(pointer===null)return;if(frame){cancelAnimationFrame(frame);frame=0;if(latest)window.desktop.moveResize(latest);}const captured=pointer;pointer=null;latest=null;document.body.classList.remove('window-resizing');if(grip.hasPointerCapture(captured))grip.releasePointerCapture(captured);window.desktop?.endResize();};
  grip.addEventListener('pointerup',end);grip.addEventListener('pointercancel',end);grip.addEventListener('lostpointercapture',end);window.addEventListener('blur',end);
}
// Idle right edge resizes the window; a visible native scrollbar owns the list edge.
{
  const list=document.getElementById('mainContent'),body=document.body;
  let hideTimer,hovered=false,dragging=false,rail=null;
  const visible=()=>body.classList.contains('main-scrollbar-visible');
  const inRail=event=>rail?.scrollable&&event.clientX>=rail.left&&event.clientX<rail.right&&event.clientY>=rail.top&&event.clientY<rail.bottom;
  function hide(){clearTimeout(hideTimer);body.classList.remove('main-scrollbar-visible');}
  function scheduleHide(){clearTimeout(hideTimer);if(visible()&&!hovered&&!dragging)hideTimer=setTimeout(hide,1400);}
  function reveal(){if(!rail?.scrollable||body.classList.contains('window-resizing')||body.classList.contains('player-open'))return;body.classList.add('main-scrollbar-visible');scheduleHide();}
  function updateRail(){
    const rect=list.getBoundingClientRect();rail={left:rect.left+list.clientLeft+list.clientWidth,right:rect.right,top:rect.top,bottom:rect.bottom,scrollable:list.scrollHeight>list.clientHeight};
    body.classList.toggle('main-has-scrollbar',rail.scrollable);
    body.style.setProperty('--main-scroll-top',rect.top+'px');body.style.setProperty('--main-scroll-bottom',innerHeight-rect.bottom+'px');
    if(!rail.scrollable){hovered=false;dragging=false;hide();}
  }
  window.addEventListener('wheel',event=>{
    const edge=event.target.closest?.('.resize-e');if(!event.deltaY||(!event.target.closest?.('#mainContent')&&!(edge&&inRail(event))))return;
    hovered=!!inRail(event);reveal();
    if(edge&&inRail(event)){event.preventDefault();const unit=event.deltaMode===1?16:event.deltaMode===2?list.clientHeight:1;list.scrollTop+=event.deltaY*unit;}
  },{capture:true,passive:false});
  list.addEventListener('scroll',reveal,{passive:true});
  window.addEventListener('pointermove',event=>{
    const wasHovered=hovered,wasDragging=dragging;hovered=!!inRail(event);
    if(dragging&&!(event.buttons&1))dragging=false;
    if(wasHovered!==hovered||wasDragging!==dragging)scheduleHide();
  },{passive:true});
  window.addEventListener('pointerdown',event=>{if(event.button===0&&visible()&&inRail(event)){hovered=true;dragging=true;clearTimeout(hideTimer);}},{capture:true});
  window.addEventListener('pointerup',event=>{if(!dragging)return;dragging=false;hovered=!!inRail(event);scheduleHide();},{capture:true});
  window.addEventListener('pointercancel',()=>{dragging=false;scheduleHide();});
  document.documentElement.addEventListener('pointerleave',event=>{if(!dragging&&!inRail(event)){hovered=false;scheduleHide();}});
  window.addEventListener('blur',()=>{hovered=false;dragging=false;hide();});
  const observer=new ResizeObserver(updateRail);observer.observe(list);observer.observe(document.getElementById('view'));updateRail();
}
