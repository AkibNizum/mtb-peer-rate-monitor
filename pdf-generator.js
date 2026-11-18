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
  '<button type="button" aria-label="Remove page '+(i+1)+'" data-act="remove" data-id="'+item.id+'">×</button></div></article>').join('');
}
function pdfText(str){return ENCODER.encode(str);}
function pdfHexText(text,map){
 let out='';
 for(const char of Array.from(String(text||''))){
  const id=map.get(char);
  if(id!==undefined)out+=id.toString(16).padStart(2,'0').toUpperCase();
 }
 return out;
}
function unicodeHex(ch){
 let hex='';
 for(let i=0;i<ch.length;i++)hex+=ch.charCodeAt(i).toString(16).padStart(4,'0').toUpperCase();
 return hex;
}
function pdfCMap(map){
 const pairs=[...map.entries()].map(([ch,id])=>'<'+id.toString(16).padStart(2,'0').toUpperCase()+'> <'+unicodeHex(ch)+'>');
 const lines=[
 '/CIDInit /ProcSet findresource begin',
 '12 dict begin begincmap',
 '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
 '/CMapName /MTBUnicode def /CMapType 2 def',
 '1 begincodespacerange <20> <FF> endcodespacerange'
 ];
 for(let i=0;i<pairs.length;i+=75){
  const part=pairs.slice(i,i+75);
  lines.push(part.length+' beginbfchar',...part,'endbfchar');
 }
 lines.push('endcmap CMapName currentdict /CMap defineresource pop end end');
 return lines.join('\n')+'\n';
}
function pdfLineOverlay(page,location,fontMap){
 const result=[];
 const lines=page.searchTextLines||[];
 for(const item of lines){
  if(!item||!String(item.text||'').trim())continue;
  const s=String(item.text).replace(/[\r\n]+/g,' ').slice(0,600);
  const hex=pdfHexText(s,fontMap);
  if(!hex)continue;
  const x=Number.isFinite(item.x)?Math.max(0,Math.min(page.page[0]-2,item.x)):28;
  const y=Number.isFinite(item.y)?Math.max(2,Math.min(page.page[1]-2,item.y)):page.page[1]-38;
  const fontSize=Number.isFinite(item.size)?Math.min(40,Math.max(3,item.size)):8.5;
  result.push('/F1 '+fontSize.toFixed(2)+' Tf\n1 0 0 1 '+x.toFixed(2)+' '+y.toFixed(2)+' Tm\n<'+hex+'> Tj');
 }
 return result.length?'BT\n3 Tr\n'+result.join('\n')+'\nET\n':'';
}
function assemblePdf(pages){
 // A visible screenshot with an invisible searchable, copyable Unicode text layer.
 // OCR text and images remain in this browser; no upload is needed.
 const count=pages.length,offsets=new Array(3+count*5).fill(0);
 let chunks=[],length=0;
 const append=data=>{
  const b=typeof data==='string'?pdfText(data):data;
  chunks.push(b);length+=b.byteLength;
 };
 const addObj=(id,body)=>{
  offsets[id]=length;append(id+' 0 obj\n');body();append('\nendobj\n');
 };
 append('%PDF-1.4\n%Searchable, browser-generated PDF\n');
 addObj(1,()=>append('<< /Type /Catalog /Pages 2 0 R >>'));
 addObj(2,()=>append('<< /Type /Pages /Count '+count+' /Kids ['+
  pages.map((_,i)=>(3+i*5)+' 0 R').join(' ')+'] >>'));
 for(let i=0;i<pages.length;i++){
  const p=pages[i],pageId=3+i*5,contentId=pageId+1,imageId=pageId+2,fontId=pageId+3,toUnicodeId=pageId+4;
  const [pw,ph]=p.page,scale=Math.min((pw-p.margin*2)/p.width,(ph-p.margin*2)/p.height);
  const dw=+(p.width*scale).toFixed(3),dh=+(p.height*scale).toFixed(3);
  const x=+((pw-dw)/2).toFixed(3),y=+((ph-dh)/2).toFixed(3);
  const lines=(p.searchTextLines||[]).slice(0,1600);
  const seen=new Set(),charset=[];
  for(const l of lines)for(const ch of Array.from(String(l.text||''))){
   if(ch==='\n'||ch==='\r'||seen.has(ch))continue;
   seen.add(ch);charset.push(ch);
  }
  if(charset.length>224)throw Error('Too many unique characters for one PDF page; split the page or use smaller text.');
  const map=new Map(charset.map((ch,n)=>[ch,n+32]));
  const content='q\n'+dw+' 0 0 '+dh+' '+x+' '+y+' cm\n/Im'+i+' Do\nQ\n'+pdfLineOverlay(p,{x,y,dw,dh},map);
  const cb=pdfText(content),cmap=pdfText(pdfCMap(map));
  addObj(pageId,()=>append('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+pw+' '+ph+
   '] /Resources << /XObject << /Im'+i+' '+imageId+' 0 R >> /Font << /F1 '+fontId+
   ' 0 R >> >> /Contents '+contentId+' 0 R >>'));
  addObj(contentId,()=>{append('<< /Length '+cb.length+' >>\nstream\n');append(cb);append('endstream');});
  addObj(imageId,()=>{
   append('<< /Type /XObject /Subtype /Image /Width '+p.width+' /Height '+p.height+
    ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length '+p.bytes.length+
    ' >>\nstream\n');
   append(p.bytes);append('\nendstream');
  });
  addObj(fontId,()=>append('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /ToUnicode '+toUnicodeId+' 0 R >>'));
  addObj(toUnicodeId,()=>{append('<< /Length '+cmap.length+' >>\nstream\n');append(cmap);append('endstream');});
 }
 const xrefOffset=length;
 append('xref\n0 '+offsets.length+'\n0000000000 65535 f \n');
 for(let i=1;i<offsets.length;i++)append(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
 append('trailer\n<< /Size '+offsets.length+' /Root 1 0 R >>\nstartxref\n'+xrefOffset+'\n%%EOF');
 return new Blob(chunks,{type:'application/pdf'});
}
function parseTsvLines(tsv){
 if(!tsv||typeof tsv!=='string')return [];
 const rows=tsv.trim().split(/\r?\n/),grouped=new Map();
 for(const row of rows.slice(1)){
  const c=row.split('\t');if(c.length<12||c[0]!=='5'||!c[11]?.trim())continue;
  const key=c.slice(1,5).join(':');
  const left=Number(c[6]),top=Number(c[7]),width=Number(c[8]),height=Number(c[9]);
  if(!Number.isFinite(left+top+width+height))continue;
  if(!grouped.has(key))grouped.set(key,{text:'',bbox:{x0:left,y0:top,x1:left+width,y1:top+height}});
  const g=grouped.get(key);
  g.text+=(g.text?' ':'')+c[11];
  g.bbox.x0=Math.min(g.bbox.x0,left);g.bbox.y0=Math.min(g.bbox.y0,top);
  g.bbox.x1=Math.max(g.bbox.x1,left+width);g.bbox.y1=Math.max(g.bbox.y1,top+height);
 }
 return [...grouped.values()];
}
async function getOCR(item){
 if(!window.Tesseract){
  await new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   script.src='https://unpkg.com/tesseract.js@5/dist/tesseract.min.js';
   script.onload=resolve;script.onerror=()=>reject(Error('OCR is not available on this network. Screenshot PDF was not generated without extractable text.'));
   document.head.appendChild(script);
  });
 }
 const result=await window.Tesseract.recognize(item.file,'eng',{logger:()=>{}});
 const data=result.data||{},text=String(data.text||'');
 let lines=[];
 if(Array.isArray(data.lines)&&data.lines.length){
  lines=data.lines.map(x=>({text:String(x.text||''),bbox:x.bbox})).filter(x=>x.text.trim());
 }
 if(!lines.length)lines=parseTsvLines(data.tsv);
 if(!lines.length){
  const raw=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  lines=raw.map((line,i)=>({text:line,bbox:null}));
 }
 if(!lines.length)throw Error('No readable text recognized in '+item.name+'. Try a sharper screenshot or provide the original PDF.');
 return lines.slice(0,1500);
}
function textCoordinates(lines,item,page){
 const [pw,ph]=page.page,scale=Math.min((pw-page.margin*2)/page.width,(ph-page.margin*2)/page.height);
 const dw=page.width*scale,dh=page.height*scale,x=(pw-dw)/2,y=(ph-dh)/2;
 return lines.map((l,i)=>{
  const bbox=l.bbox;
  if(bbox&&Number.isFinite(bbox.x0)&&Number.isFinite(bbox.y1)){
   const y0=(bbox.y1/item.height)*dh;
   return {
    text:l.text,x:x+(bbox.x0/item.width)*dw,
    y:y+dh-y0,
    size:Math.max(4,Math.min(16,((bbox.y1-bbox.y0)/item.height)*dh))
   };
  }
  return {text:l.text,x:page.margin||15,y:ph-25-(i*11),size:9};
 });
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
   const rendered=await screenshotPage(items[i],mode);
   say('Reading text from screenshot '+(i+1)+' of '+items.length+'…');
   const lines=await getOCR(items[i]);
   rendered.searchTextLines=textCoordinates(lines,items[i],rendered);
   pages.push(rendered);
  }
  say('Building PDF locally…');
  const pdf=assemblePdf(pages);
  const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
  const name='Bank_Rate_Screenshots_'+date+'.pdf';
  const link=document.createElement('a'),url=URL.createObjectURL(pdf);
  link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
  setTimeout(()=>URL.revokeObjectURL(url),45000);
  say('Searchable PDF downloaded: '+pages.length+' page'+(pages.length===1?'':'s')+' ('+fileSize(pdf.size)+'). OCR text can be selected and extracted; no files were uploaded or saved.');
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
window.MTBPDF={clear,receiveImages,createImagePdf:assemblePdf}; // browser-only PDF utility for screenshots and Unicode text
})();
