(function(){
'use strict';
const MAX_IMAGES=35,MAX_FILE_BYTES=18*1024*1024,MAX_TOTAL_BYTES=100*1024*1024;
const A4=[595.28,841.89],ENCODER=new TextEncoder();
const items=[];
const $=id=>document.getElementById(id);
const htmlEscape=s=>String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[m]));
let nextId=0,processing=false;

function say(message,fail=false){
 const node=$('pdfStatus');if(!node)return;
 node.textContent=message;node.classList.toggle('error',fail);
}
function fileSize(n){return n<1e6?(n/1024).toFixed(0)+' KB':(n/(1024*1024)).toFixed(1)+' MB';}
function support(file){
 return file&&(file.type==='image/png'||file.type==='image/jpeg'||/\.(png|jpe?g)$/i.test(file.name||''));
}
function loadBitmap(file,url){
 return new Promise((resolve,reject)=>{
  const image=new Image();
  image.onload=()=>resolve({w:image.naturalWidth,h:image.naturalHeight});
  image.onerror=()=>reject(Error('Could not read the image'));
  image.src=url;
 });
}
async function receiveImages(files,source){
 const incoming=Array.from(files||[]).filter(Boolean);
 if(!incoming.length){say('No screenshots detected. Copy an image or choose PNG/JPG files.',true);return;}
 const valid=incoming.filter(support);
 if(!valid.length){say('Only PNG and JPG screenshots are supported.',true);return;}
 if(items.length+valid.length>MAX_IMAGES){say('You can combine up to '+MAX_IMAGES+' screenshots in one PDF.',true);return;}
 const currentBytes=items.reduce((n,x)=>n+x.file.size,0);
 if(currentBytes+valid.reduce((n,f)=>n+f.size,0)>MAX_TOTAL_BYTES){say('Combined screenshots are too large. Use smaller or fewer images.',true);return;}
 let ok=0,errors=[];
 for(const file of valid){
  if(file.size>MAX_FILE_BYTES){errors.push((file.name||'Image')+' exceeds 18 MB');continue;}
  const url=URL.createObjectURL(file);
  try{
   const dims=await loadBitmap(file,url);
   if(dims.w<=0||dims.h<=0)throw Error('Invalid image size');
   const name=file.name&&/\.(png|jpe?g)$/i.test(file.name)?file.name:'Pasted screenshot '+(items.length+1)+'.png';
   items.push({id:++nextId,file,url,name,width:dims.w,height:dims.h});
   ok++;
  }catch(e){URL.revokeObjectURL(url);errors.push((file.name||'Image')+': '+e.message);}
 }
 render();
 if(errors.length)say(ok+' screenshot(s) added. '+errors.join('; '),true);
 else say(ok+' screenshot(s) '+(source==='paste'?'pasted':'added')+'. Arrange them below or generate the PDF.');
}
function changeOrder(id,step){
 const at=items.findIndex(x=>x.id===id),target=at+step;
 if(at<0||target<0||target>=items.length)return;
 [items[at],items[target]]=[items[target],items[at]];
 render();
}
function remove(id){
 const i=items.findIndex(x=>x.id===id);if(i<0)return;
 URL.revokeObjectURL(items[i].url);items.splice(i,1);render();
 say(items.length?'Screenshot removed.':'All screenshots removed.');
}
function clear(){
 for(const item of items)URL.revokeObjectURL(item.url);
 items.length=0;render();say('Screenshots cleared from this browser page.');
}
function render(){
 const node=$('pdfPreviews');if(!node)return;
 $('pdfCounter').textContent=items.length+' screenshot'+(items.length===1?'':'s')+' ready';
 $('pdfDownload').disabled=processing||!items.length;
 $('pdfClear').disabled=processing||!items.length;
 if(!items.length){
  node.innerHTML='<div class="pdfEmpty">No screenshots yet. Paste with Ctrl+V or choose image files.</div>';
  return;
 }
 node.innerHTML=items.map((item,i)=>'<article class="pdfImageCard" data-id="'+item.id+'">'+
  '<div class="pdfImagePreview"><img src="'+item.url+'" alt="Screenshot '+(i+1)+' preview"/></div>'+
  '<div class="pdfImageDetails"><strong>Page '+(i+1)+'</strong>'+
  '<div class="pdfImageName">'+htmlEscape(item.name)+'</div>'+
  '<small>'+item.width+' × '+item.height+' px · '+fileSize(item.file.size)+'</small></div>'+
  '<div class="pdfPageActions">'+
  '<button type="button" aria-label="Move page '+(i+1)+' earlier" data-act="up" data-id="'+item.id+'" '+(i===0?'disabled':'')+'>↑</button>'+
  '<button type="button" aria-label="Move page '+(i+1)+' later" data-act="down" data-id="'+item.id+'" '+(i===items.length-1?'disabled':'')+'>↓</button>'+
  '<button type="button" aria-label="Remove page '+(i+1)+'" data-act="remove" data-id="'+item.id+'>×</button></div></article>').join('');
}
function pdfText(str){return ENCODER.encode(str);}
function assemblePdf(pages){
 // This writer embeds each screenshot as a compressed JPEG /Image XObject.
 // All bytes, page offsets and xref entries are generated locally in memory.
 let chunks=[],length=0;
 const append=part=>{const bytes=typeof part==='string'?pdfText(part):part;chunks.push(bytes);length+=bytes.byteLength;};
 const offsets=new Array(3+pages.length*3).fill(0);
 const addObj=(id,write)=>{
  offsets[id]=length;append(id+' 0 obj\n');write();append('\nendobj\n');
 };
 append('%PDF-1.4\n%\u00e2\u00e3\u00cf\u00d3\n');
 addObj(1,()=>append('<< /Type /Catalog /Pages 2 0 R >>'));
 addObj(2,()=>append('<< /Type /Pages /Count '+pages.length+' /Kids ['+pages.map((_,i)=>(3+i*3)+' 0 R').join(' ')+'] >>'));
 for(let i=0;i<pages.length;i++){
  const p=pages[i],pageId=3+i*3,contentId=pageId+1,imageId=pageId+2;
  const [pw,ph]=p.page,scale=Math.min((pw-p.margin*2)/p.width,(ph-p.margin*2)/p.height);
  const dw=+(p.width*scale).toFixed(3),dh=+(p.height*scale).toFixed(3);
  const x=+((pw-dw)/2).toFixed(3),y=+((ph-dh)/2).toFixed(3);
  const content='q\n'+dw+' 0 0 '+dh+' '+x+' '+y+' cm\n/Im'+i+' Do\nQ\n';
  const cb=pdfText(content);
  addObj(pageId,()=>append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pw+' '+ph+'] /Resources << /XObject << /Im'+i+' '+imageId+' 0 R >> >> /Contents '+contentId+' 0 R >>'));
  addObj(contentId,()=>{append('<< /Length '+cb.length+' >>\nstream\n');append(cb);append('endstream');});
  addObj(imageId,()=>{
   append('<< /Type /XObject /Subtype /Image /Width '+p.width+' /Height '+p.height+' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+p.bytes.length+' >>\nstream\n');
   append(p.bytes);append('\nendstream');
  });
 }
 const xrefOffset=length;
 append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
 for(let i=1;i<offsets.length;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF');
 return new Blob(chunks,{type:'application/pdf'});
}
async function screenshotPage(item,paperMode){
 const image=new Image();image.src=item.url;
 if(typeof image.decode==='function')await image.decode();
 else await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(Error('Image could not be decoded'));});
 // Limit raster size so browsers can handle dozens of screenshots without exhausting memory.
 const maxSide=4100,ratio=Math.min(1,maxSide/Math.max(item.width,item.height));
 const width=Math.max(1,Math.round(item.width*ratio)),height=Math.max(1,Math.round(item.height*ratio));
 const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
 const context=canvas.getContext('2d',{alpha:false});
 if(!context)throw Error('Canvas rendering is not supported on this device.');
 context.fillStyle='#ffffff';context.fillRect(0,0,width,height);
 context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';
 context.drawImage(image,0,0,width,height);
 const jpg=await new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Unable to encode screenshot')),'image/jpeg',0.91));
 canvas.width=0;canvas.height=0;
 const bytes=new Uint8Array(await jpg.arrayBuffer());
 const page=paperMode==='match'?
  (()=>{const r=Math.min(1,1850/Math.max(width,height));return [Math.max(72,+(width*r).toFixed(2)),Math.max(72,+(height*r).toFixed(2))]})()
  :(width>height*1.12?[A4[1],A4[0]]:A4);
 return {bytes,width,height,page,margin:paperMode==='match'?0:18};
}
async function generatePdf(){
 if(processing||!items.length){say('Paste or add at least one screenshot first.',true);return;}
 processing=true;render();say('Preparing screenshots for PDF…');
 try{
  const pages=[],mode=$('pdfPaperSize').value;
  for(let i=0;i<items.length;i++){
   say('Preparing screenshot '+(i+1)+' of '+items.length+'…');
   pages.push(await screenshotPage(items[i],mode));
  }
  say('Building PDF locally…');
  const pdf=assemblePdf(pages);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const name='Bank_Rate_Screenshots_'+date+'.pdf';
  const link=document.createElement('a'),url=URL.createObjectURL(pdf);
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),45000);
  say('PDF downloaded: '+pages.length+' page'+(pages.length===1?'':'s')+' ('+fileSize(pdf.size)+'). No images were uploaded or saved by the site.');
 }catch(e){console.error(e);say('Could not generate PDF: '+(e.message||String(e)),true)}
 finally{processing=false;render();}
}
function active(){
 return !$('pdfTool')?.classList.contains('hidden');
}
function init(){
 if(!$('pdfTool'))return;
 $('pdfChoose').addEventListener('change',async e=>{
  await receiveImages(e.target.files,'upload');e.target.value='';
 });
 $('pdfDownload').addEventListener('click',generatePdf);
 $('pdfClear').addEventListener('click',clear);
 $('pdfPreviews').addEventListener('click',event=>{
  const button=event.target.closest('[data-act][data-id]');if(!button)return;
  const id=Number(button.dataset.id);
  if(button.dataset.act==='up')changeOrder(id,-1);
  else if(button.dataset.act==='down')changeOrder(id,+1);
  else if(button.dataset.act==='remove')remove(id);
 });
 const drop=$('pdfDropZone');
 drop.addEventListener('dragover',event=>{event.preventDefault();drop.classList.add('dragging');});
 drop.addEventListener('dragleave',()=>drop.classList.remove('dragging'));
 drop.addEventListener('drop',event=>{
  event.preventDefault();drop.classList.remove('dragging');
  receiveImages(event.dataTransfer?.files,'drop');
 });
 drop.addEventListener('click',event=>{
  if(event.target.closest('button'))return;
  drop.focus();
 });
 drop.addEventListener('keydown',event=>{
  if((event.key==='Enter'||event.key===' ')&&event.target===drop){event.preventDefault();$('pdfChoose').click();}
 });
 document.addEventListener('paste',event=>{
  if(!active())return;
  const target=event.target;
  if(target?.matches?.('input,textarea,[contenteditable="true"]'))return;
  const files=[];
  for(const e of Array.from(event.clipboardData?.items||[])){
   if(e.type?.startsWith('image/')){
    const file=e.getAsFile();if(file)files.push(file);
   }
  }
  if(files.length){event.preventDefault();receiveImages(files,'paste');}
 });
 render();
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
window.MTBPDF={clear,receiveImages}; // supports the visible tab; no data is sent to the server
})();
