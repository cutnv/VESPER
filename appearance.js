'use strict';
// 从封面像素提取颜色；无图片或无法解码时使用安静的中性底色。
window.ArtworkColors={
  extract(data){
    const buckets=new Map();
    for(let i=0;i<data.length;i+=4){if(data[i+3]<128)continue;const rgb=[data[i],data[i+1],data[i+2]],id=rgb.map(v=>v>>4).join(',');let b=buckets.get(id);if(!b){b={count:0,total:[0,0,0]};buckets.set(id,b);}b.count++;rgb.forEach((v,j)=>b.total[j]+=v);}
    const colors=[...buckets.values()].map(b=>({rgb:b.total.map(v=>Math.round(v/b.count)),count:b.count})).sort((a,b)=>b.count-a.count);
    if(!colors.length)return [[48,54,64],[65,70,83],[32,39,49]];
    const chosen=[colors[0].rgb];
    for(const c of colors){if(chosen.every(rgb=>rgb.reduce((n,v,i)=>n+(v-c.rgb[i])**2,0)>4000))chosen.push(c.rgb);if(chosen.length===3)break;}
    while(chosen.length<3)chosen.push(chosen[0].map(v=>Math.round(v*.65)));
    return chosen;
  },
  dark(rgb){const scale=Math.min(.58,100/Math.max(1,...rgb));return rgb.map(v=>Math.round(v*scale+10));}
};
