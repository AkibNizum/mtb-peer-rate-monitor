(function(){
'use strict';
const PAGE=[595.28,841.89],MARGIN=49,MAX_CHARS=120000;
const $=id=>document.getElementById(id);
const enc=new TextEncoder();
function setStatus(message,bad=false){
 const node=$('textPdfStatus');
 if(node){node.textContent=message;node.classList.toggle('error',bad);}
}
function normalize(s){return String(s||'').replace(/\r\n?/g,'\n').replace(/\t/g,'    ');}
function safeFileName(name){
 return String(name||'Text_Document').trim().replace(/\.pdf$/i,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,90)||'Text_Document';
}
function pdfLiteral(s){
 return String(s).replace(/\\/g,'\\\\').replace(/\(/g,'\\(').replace(/\)/g,'\\)').replace(/[^\x20-\x7e]/g,'?');
}
function wrapPlain(text,maxChars){
 const out=[];
 for(const original of normalize(text).split('\n')){
  if(!original.trim()){out.push('');continue;}
  const words=original.split(/(\s+)/);
  let line='';
  function push(){out.push(line.replace(/\s+$/,''));line='';}
  for(const part of words){
   if(!part)continue;
   if(line.length+part.length<=maxChars){line+=part;continue;}
   if(line.trim())push();
   if(part.trim()==='')continue;
   if(part.length<=maxChars){line=part;continue;}
   for(let at=0;at<part.length;at+=maxChars){
    const piece=part.slice(at,at+maxChars);
    if(at+maxChars<part.length)out.push(piece);
    else line=piece;
   }
  }
  if(line)push();
 }
 return out;
}
function makeBinaryPdf(objects){
 let chunks=[],count=0,positions=new Array(objects.length+1).fill(0);
 const add=data=>{const bytes=typeof data==='string'?enc.encode(data):data;chunks.push(bytes);count+=bytes.length};
 add('%PDF-1.4\n%Generated locally\n');
 for(let i=0;i<objects.length;i++){
  positions[i+1]=count;
  add((i+1)+' 0 obj\n');
  add(objects[i]);
  add('\nendobj\n');
 }
 const offset=count;
 add('xref\n0 '+(objects.length+1)+'\n0000000000 65535 f \n');
 for(let i=1;i<positions.length;i++)add(String(positions[i]).padStart(10,'0')+' 00000 n \n');
 add('trailer\n<< /Root 1 0 R /Size '+(objects.length+1)+' >>\nstartxref\n'+offset+'\n%%EOF');
 return new Blob(chunks,{type:'application/pdf'});
}
function textStreamObject(stream){
 const b=enc.encode(stream);
 return '<< /Length '+b.length+' >>\nstream\n'+stream+'\nendstream';
}
function textPageStream(title,lines,pageNum,bodyFontSize){
 const chunks=['q\n0.10 0.32 0.26 rg\n'];
 const top=PAGE[1]-MARGIN;
 if(pageNum===0&&title){
  chunks.push('BT /F1 17 Tf 1 0 0 1 '+MARGIN+' '+top+' Tm ('+pdfLiteral(title)+') Tj ET\n');
  chunks.push('0.72 0.79 0.75 RG 0.8 w '+MARGIN+' '+(top-15)+' m '+(PAGE[0]-MARGIN)+' '+(top-15)+' l S\n');
 }
 const start=pageNum===0&&title?top-53:top-5;
 chunks.push('0.08 0.13 0.13 rg\n');
 for(let i=0;i<lines.length;i++){
  if(lines[i]==='')continue;
  const y=+(start-i*bodyFontSize*1.48).toFixed(2);
  chunks.push('BT /F1 '+bodyFontSize+' Tf 1 0 0 1 '+MARGIN+' '+y+' Tm ('+pdfLiteral(lines[i])+') Tj ET\n');
 }
 chunks.push('Q\n');
 return chunks.join('');
}
function createSelectableTextPdf(text,title='',bodyFontSize=11){
 const body=normalize(text);
 if(!body.trim()&&!title.trim())throw Error('Paste text before generating a PDF.');
 const size=Number(bodyFontSize)||11,maxWidth=PAGE[0]-2*MARGIN;
 const limit=Math.floor(maxWidth/(size*0.59));
 const all=wrapPlain(body,limit);
 const firstCapacity=Math.floor((PAGE[1]-2*MARGIN-(title?56:6))/(size*1.48));
 const nextCapacity=Math.floor((PAGE[1]-2*MARGIN)/(size*1.48));
 const pageLines=[];
 let rest=all;
 if(!rest.length)rest=[''];
 pageLines.push(rest.slice(0,firstCapacity));rest=rest.slice(firstCapacity);
 while(rest.length){pageLines.push(rest.slice(0,nextCapacity));rest=rest.slice(nextCapacity);}
 if(pageLines.length>180)throw Error('Text is too long for one document. Split it into smaller PDFs.');
 const objects=[];
 // 1 = Catalog, 2 = Pages tree, 3 = Helvetica font, then page/content pairs.
 objects[0]='<< /Type /Catalog /Pages 2 0 R >>';
 objects[1]='<< /Type /Pages /Count '+pageLines.length+' /Kids ['+pageLines.map((_,i)=>(4+i*2)+' 0 R').join(' ')+'] >>';
 objects[2]='<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
 pageLines.forEach((lines,i)=>{
  const pageId=4+i*2,contentId=pageId+1;
  objects.push('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 '+PAGE.join(' ')+'] /Resources << /Font << /F1 3 0 R >> >> /Contents '+contentId+' 0 R >>');
  objects.push(textStreamObject(textPageStream(title,lines,i,size)));
 });
 return makeBinaryPdf(objects);
}
async function canvasJpeg(canvas){
 return new Promise((resolve,reject)=>{
  canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Could not encode PDF page')),'image/jpeg',0.94);
 });
}
async function makeUnicodePdf(text,title,size){
 if(!window.MTBPDF?.createImagePdf)throw Error('Browser PDF image composer failed to initialize.');
 const scale=2.12,w=Math.round(PAGE[0]*scale),h=Math.round(PAGE[1]*scale);
 const fontsize=Math.round((Number(size)||11)*scale),margin=MARGIN*scale,lineHeight=fontsize*1.5;
 const limitW=w-2*margin;
 const output=[];
 const words=normalize(text).split('\n');
 let canvas,ctx,y,first=true,currentTextLines=[];
 const newPage=()=>{
  currentTextLines=[];
  canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  ctx=canvas.getContext('2d',{alpha:false});
  if(!ctx)throw Error('This device cannot create a PDF canvas.');
  ctx.fillStyle='#ffffff';ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#182d2a';
  ctx.font=fontsize+'px "Noto Sans Bengali", "Noto Sans", Arial, sans-serif';
  y=margin+fontsize;
  if(first&&title){
   ctx.font='bold '+Math.round(17*scale)+'px "Noto Sans Bengali",Arial,sans-serif';
   ctx.fillText(title,margin,y,w-2*margin);
   currentTextLines.push({text:title,x:margin/scale,y:(h-y)/scale,size:17});
   y+=Math.round(28*scale);
   ctx.strokeStyle='#bdcdc6';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(margin,y);ctx.lineTo(w-margin,y);ctx.stroke();
   y+=Math.round(25*scale);
   ctx.font=fontsize+'px "Noto Sans Bengali", "Noto Sans", Arial, sans-serif';
  }
  first=false;
 };
 const finish=async()=>{
  if(!canvas)return;
  const blob=await canvasJpeg(canvas);
  output.push({bytes:new Uint8Array(await blob.arrayBuffer()),width:w,height:h,page:PAGE,margin:0,searchTextLines:currentTextLines.slice()});
  canvas.width=0;canvas.height=0;canvas=null;
 };
 newPage();
 const nextLine=async()=>{
  y+=lineHeight;
  if(y+lineHeight>h-margin){
   await finish();newPage();
  }
 };
 const paintLine=(str)=>{
  if(!str)return;
  ctx.fillText(str,margin,y);
  currentTextLines.push({text:str,x:margin/scale,y:(h-y)/scale,size:Number(size)||11});
 };
 const drawLine=async(s)=>{
  const str=String(s);
  if(!str){await nextLine();return;}
  // Browser canvas is used to preserve non-Latin scripts such as Bangla.
  const chunks=str.split(/(\s+)/);
  let built='';
  for(const chunk of chunks){
   if(!chunk)continue;
   if(ctx.measureText(built+chunk).width<=limitW){built+=chunk;continue;}
   if(built.trim()){paintLine(built.trimEnd());await nextLine();built='';}
   if(!chunk.trim())continue;
   if(ctx.measureText(chunk).width<=limitW){built=chunk;continue;}
   for(const ch of Array.from(chunk)){
    if(ctx.measureText(built+ch).width>limitW&&built){
     paintLine(built);await nextLine();built='';
    }
    built+=ch;
   }
  }
  if(built)paintLine(built.trimEnd());
  await nextLine();
 };
 for(const paragraph of words)await drawLine(paragraph);
 await finish();
 if(output.length>180)throw Error('Text is too long. Split it into smaller PDFs.');
 return window.MTBPDF.createImagePdf(output);
}
function download(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=name+'.pdf';
 document.body.appendChild(a);a.click();a.remove();
 setTimeout(()=>URL.revokeObjectURL(url),45000);
}
async function generate(){
 const text=$('textPdfBody')?.value||'';
 const title=($('textPdfTitle')?.value||'').trim();
 const fontSize=Number($('textPdfSize')?.value)||11;
 const filename=safeFileName($('textPdfFileName')?.value);
 if(!text.trim()&&!title){setStatus('Paste text to create a PDF.',true);return;}
 if(text.length>MAX_CHARS){setStatus('The maximum is 120,000 characters per PDF.',true);return;}
 const button=$('textPdfGenerate');button.disabled=true;setStatus('Generating PDF in your browser…');
 try{
  // All PDFs include real extractable text. Unicode uses a visually rendered page
  // with an invisible, copyable/searchable Unicode text layer behind the image.
  const plain=/^[\x09\x0a\x0d\x20-\x7e]*$/.test(text+title);
  const pdf=plain?createSelectableTextPdf(text,title,fontSize):await makeUnicodePdf(text,title,fontSize);
  download(pdf,filename);
  setStatus('Searchable PDF downloaded ('+(pdf.size/1024).toFixed(0)+' KB). Text is extractable'+(plain?'':' from its Unicode layer')+'. Nothing was uploaded or saved.');
 }catch(e){setStatus(e.message||String(e),true)}
 finally{button.disabled=false;}
}
function setup(){
 if(!$('textPdfTool'))return;
 $('textPdfGenerate').addEventListener('click',generate);
 $('textPdfBody').addEventListener('input',()=>{
  const n=$('textPdfBody').value.length;
  $('textPdfCount').textContent=n.toLocaleString()+' characters';
 });
}
if(typeof document!=='undefined'){
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
}
window.MTBTextPDF={generate,createSelectableTextPdf};
})();
