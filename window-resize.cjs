'use strict';
function resizeBounds(box,direction,dx,dy,minimum){let left=box.x,top=box.y,right=box.x+box.width,bottom=box.y+box.height;if(direction.includes('w'))left=Math.min(right-minimum[0],left+dx);if(direction.includes('e'))right=Math.max(left+minimum[0],right+dx);if(direction.includes('n'))top=Math.min(bottom-minimum[1],top+dy);if(direction.includes('s'))bottom=Math.max(top+minimum[1],bottom+dy);return{x:Math.round(left),y:Math.round(top),width:Math.round(right-left),height:Math.round(bottom-top)};}
module.exports={resizeBounds};
