'use strict';
(()=>{
  const input=$('searchInput'),menu=$('searchSuggestions'),form=$('searchForm');
  let timer,serial=0,active=-1,options=[],composing=false;
  const normalized=text=>String(text||'').normalize('NFKC').toLocaleLowerCase();
  function close(){clearTimeout(timer);serial++;active=-1;options=[];menu.hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');}
  function select(index){active=index;options.forEach((button,i)=>{button.classList.toggle('selected',i===index);button.setAttribute('aria-selected',String(i===index));});if(index>=0){input.setAttribute('aria-activedescendant',options[index].id);options[index].scrollIntoView({block:'nearest'});}else input.removeAttribute('aria-activedescendant');}
  function render(result,words,status=''){
    menu.replaceChildren();options=[];active=-1;input.removeAttribute('aria-activedescendant');
    const tokens=normalized(words).split(/\s+/).filter(Boolean),local=localSongs.filter(t=>tokens.every(word=>normalized([t.name,t.artists,t.album].join(' ')).includes(word))).slice(0,4);
    for(const[kind,title,items]of[['local','本地歌曲',local],['songs','歌曲',result.songs||[]],['artists','歌手',result.artists||[]],['albums','专辑',result.albums||[]]]){
      if(!items.length)continue;const group=el('div',undefined,'suggestion-group');group.setAttribute('role','group');group.setAttribute('aria-label',title);group.append(el('p',title,'suggestion-heading'));
      for(const item of items){
        const button=btn('',()=>{
          close();if(kind==='artists'||kind==='albums')loadEntity(kind==='artists'?'artist':'album',item.id,'suggest');
          else startFromList(item,[item]);
        },'suggestion-option');
        button.id='search-option-'+options.length;button.dataset.kind=kind;button.setAttribute('role','option');button.setAttribute('aria-selected','false');
        const text=el('span',undefined,'suggestion-text');text.append(el('strong',item.name));const detail=kind==='artists'?'歌手':item.artists;if(detail)text.append(el('small',detail));
        button.append(icon(kind==='artists'?'artist':kind==='albums'?'album':'note'),text);const index=options.length;button.onpointermove=()=>select(index);options.push(button);group.append(button);
      }
      menu.append(group);
    }
    if(status)menu.append(el('p',status,'suggestion-status'));
    else if(!options.length)menu.append(el('p','暂无匹配提示，可按 Enter 查看完整结果。','suggestion-status'));
    const all=btn('搜索“'+words+'”',()=>{close();search(false);},'suggestion-option suggestion-all');all.prepend(icon('search'));all.id='search-option-'+options.length;all.setAttribute('role','option');all.setAttribute('aria-selected','false');const index=options.length;all.onpointermove=()=>select(index);options.push(all);menu.append(all);
    menu.hidden=false;input.setAttribute('aria-expanded','true');
  }
  function schedule(){
    close();if(composing)return;const words=input.value.normalize('NFKC').trim();if(!words||/https?:\/\//.test(words)||/^\d{5,}$/.test(words))return;
    const version=serial;timer=setTimeout(async()=>{
      if(version!==serial)return;render({},words,'正在匹配…');
      try{const result=await request('suggest',{keywords:words});if(version===serial)render(result,words);}
      catch{if(version===serial)render({},words,'匹配提示暂不可用，按 Enter 搜索。');}
    },280);
  }
  input.addEventListener('input',schedule);input.addEventListener('focus',schedule);
  input.addEventListener('compositionstart',()=>{composing=true;close();});input.addEventListener('compositionend',()=>{composing=false;schedule();});
  input.addEventListener('keydown',event=>{
    if(composing||event.isComposing)return;
    if(event.key==='Escape'&&!menu.hidden){event.preventDefault();event.stopPropagation();close();return;}
    if(menu.hidden)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const down=event.key==='ArrowDown';select(active<0?(down?0:options.length-1):(active+(down?1:-1)+options.length)%options.length);}
    if(event.key==='Enter'&&active>=0){event.preventDefault();options[active].click();}
  });
  form.addEventListener('submit',close);
  form.addEventListener('focusout',event=>{if(!form.contains(event.relatedTarget))close();});
  document.addEventListener('pointerdown',event=>{if(!form.contains(event.target))close();});
})();
