import pptxgen from 'pptxgenjs';
import {banks,products} from './catalog.js';

const GREEN='126255',DARK='073F37',LIGHT='EDF4F0',BEIGE='FFF4D9',WHITE='FFFFFF',GREY='677970',BORDER='C8D9D1';
const BANKS=banks.map(b=>b.id),DISPLAY={MTB:'MTB',EBL:'Eastern Bank',PRIME:'Prime Bank',BRAC:'BRAC Bank',DHAKA:'Dhaka Bank',CITY:'City Bank',UCB:'UCB'};
const pmap=Object.fromEntries(products.map(x=>[x.id,x]));
const norm=s=>String(s??'').toLowerCase().replace(/\s+/g,' ').trim();
function checkRows(rows){
 if(!Array.isArray(rows)||rows.length>800)throw Error('Invalid report data');
 const valid=[];
 for(const row of rows){
  if(!pmap[row.productId]||!BANKS.includes(row.bankId)||!pmap[row.productId].tenors.includes(row.tenor))continue;
  let rate=null;
  if(row.rate!==null&&row.rate!==''&&row.rate!==undefined){
   const n=Number(row.rate);if(Number.isFinite(n)&&n>=0&&n<=30)rate=n;
  }
  const status=['verified','tenor_na','product_na','review','uploaded_reviewed'].includes(row.status)?row.status:'review';
  if(status==='tenor_na'&&rate!==null)continue;
  if(status==='verified'&&rate===null)continue;
  if(status==='uploaded_reviewed'&&rate===null)continue;
  valid.push({productId:row.productId,bankId:row.bankId,tenor:row.tenor,rate,status,
   effectiveDate:String(row.effectiveDate||'').slice(0,30),sourceUrl:String(row.sourceUrl||'').slice(0,500),
   note:String(row.note||'').slice(0,240)});
 }
 return valid;
}
function valueFor(index,pid,tenor,bankId){
 const r=index.get(pid+'|'+tenor+'|'+bankId);
 if(!r)return '';
 if(r.status==='tenor_na')return '-';
 if(r.status==='product_na')return '';
 if((r.status==='verified'||r.status==='uploaded_reviewed')&&r.rate!==null)return r.rate.toFixed(2)+'%';
 return '';
}
function putHeader(slide,title,date,page){
 slide.background={color:'FFFFFF'};
 slide.addShape('rect',{x:0,y:0,w:13.333,h:0.18,line:{color:GREEN,transparency:100},fill:{color:GREEN}});
 slide.addText(title,{x:0.5,y:0.39,w:11.7,h:0.49,color:DARK,fontFace:'Arial',fontSize:22,bold:true,margin:0,breakLine:false});
 slide.addText('Last Review Date: '+date,{x:0.52,y:0.97,w:9,h:0.25,color:GREY,fontFace:'Arial',fontSize:10,margin:0});
 slide.addText('MTB PEER BANK DEPOSIT RATE MONITORING',{x:8.0,y:0.99,w:4.75,h:0.24,align:'right',color:GREEN,fontFace:'Arial',fontSize:8,bold:true,margin:0});
 slide.addShape('line',{x:0.5,y:1.31,w:12.32,h:0,line:{color:GREEN,width:1.1}});
 slide.addText('Mutual Trust Bank PLC  |  Official-source comparison  |  Proposed rates intentionally blank',{x:0.52,y:7.18,w:11.7,h:0.16,color:GREY,fontFace:'Arial',fontSize:7.6,margin:0});
 slide.addText(String(page),{x:12.27,y:7.15,w:0.4,h:0.21,align:'right',color:GREY,fontFace:'Arial',fontSize:8,margin:0});
}
function addSlideNotes(slide,records,sources){
 const details=[...new Set(records.map(r=>r.sourceUrl).filter(Boolean))].slice(0,20);
 const parts=['Source references and effective dates:'];
 for(const src of sources){
  parts.push(src.name+' | '+(src.documentDate||src.effectiveDate||'Date not established')+' | '+(src.documentUrl||src.url||'No source')+' | Uploaded supporting files: '+(src.uploadedDocuments||[]).map(u=>u.name).join(', '));
 }
 parts.push(...details);
 try{slide.addNotes(parts.join('\n'))}catch{}
}
function cover(ppt,title,items,date,kind){
 const s=ppt.addSlide();s.background={color:DARK};
 s.addShape('rect',{x:0.5,y:0.53,w:0.11,h:5.95,line:{color:'D6C7A4',transparency:100},fill:{color:'D6C7A4'}});
 s.addText('MUTUAL TRUST BANK PLC',{x:0.88,y:0.73,w:9.5,h:0.35,color:'C7E5DB',fontFace:'Arial',fontSize:16,bold:true,margin:0});
 s.addText('Interest Rate Analysis:\nPeer Bank Products ('+kind+')',{x:0.87,y:1.56,w:11.6,h:1.27,color:WHITE,fontFace:'Arial',fontSize:27,bold:true,breakLine:false,margin:0});
 s.addText('As of '+date,{x:0.88,y:3.15,w:8.5,h:0.4,color:'E0CBA9',fontFace:'Arial',fontSize:17,margin:0});
 const half=Math.ceil(items.length/2),left=items.slice(0,half).join('\n'),right=items.slice(half).join('\n');
 s.addText(left,{x:0.9,y:4.2,w:5.65,h:1.72,color:'F3FAF7',fontFace:'Arial',fontSize:12,breakLine:false,margin:0,lineSpacingMultiple:1.12});
 s.addText(right,{x:6.92,y:4.2,w:5.6,h:1.72,color:'F3FAF7',fontFace:'Arial',fontSize:12,breakLine:false,margin:0,lineSpacingMultiple:1.12});
 s.addText('Editable ALCO report • Current published rates only',{x:0.9,y:6.8,w:10,h:0.24,color:'C7E5DB',fontFace:'Arial',fontSize:10,margin:0});
 return s;
}
function tableCells(pid,tenors,index,bankLabels){
 const p=pmap[pid]; const rows=[];
 const hdr=['MTB offered tenor','MTB current rate','MTB Proposed Rate',...BANKS.slice(1).map(id=>DISPLAY[id])];
 rows.push(hdr.map(text=>({text,options:{bold:true,color:WHITE,fill:GREEN,align:'center',margin:0.04}})));
 const sub=['Product name',p.name,'',...BANKS.slice(1).map(id=>p.peers[id]||'N/A')];
 rows.push(sub.map((text,j)=>({text,options:{bold:j===0,color:DARK,fill:LIGHT,align:'center',fontSize:j===0?8.8:7.5,margin:0.03}})));
 for(let i=0;i<tenors.length;i++){
  const t=tenors[i];
  const r=[t,valueFor(index,pid,t,'MTB'),'',...BANKS.slice(1).map(id=>valueFor(index,pid,t,id))];
  rows.push(r.map((text,j)=>({text,options:{fill:j===0?LIGHT:(i%2?WHITE:BEIGE),color: text==='-'?GREY:DARK,
    bold:j===0,align:j===0?'left':'center',fontSize:9,margin:0.035}})));
 }
 return rows;
}
function addBankMatrix(ppt,pid,tenors,index,date,page,heading,records,sources){
 const s=ppt.addSlide(); putHeader(s,heading||pmap[pid]?.name||'MTB Peer Rates',date,page);
 if(!tenors.length){
  s.addText('No MTB reference tenor falls in this section of the original presentation.',{x:1.0,y:2.2,w:11,h:0.6,color:GREY,fontSize:17,align:'center'});
  addSlideNotes(s,records,sources);return s;
 }
 const rows=tableCells(pid,tenors,index);
 const colW=[1.60,1.45,1.50,1.33,1.38,1.38,1.38,1.38,1.38]; // 12.78
 const count=rows.length;
 const rowHeight=Math.min(0.52,4.88/count),y=1.64;
 s.addTable(rows,{x:0.32,y,w:12.76,border:{type:'solid',color:BORDER,pt:0.55},colW,
  rowH:rowHeight,fontFace:'Arial',fontSize:8.3,
  valign:'mid',margin:0.03,autoFit:false,breakLine:false});
 s.addText('Blank = rate not verified from official source   •   – = confirmed missing peer tenor',{x:0.50,y:6.72,w:11.9,h:0.19,fontSize:8.2,color:GREY,margin:0});
 addSlideNotes(s,records,sources);return s;
}
function splitDays(){
 return [
  ['91 Days'],['100 Days','122 Days'],['181 Days'],['210 Days','270 Days'],['365 Days']
 ];
}
function sourcesSlide(ppt,sources,date,page){
 const s=ppt.addSlide();putHeader(s,'Official Source Documents',date,page);
 const columns=[{text:'Bank',options:{bold:true,color:WHITE,fill:GREEN}},{text:'Effective date',options:{bold:true,color:WHITE,fill:GREEN}},{text:'Official document / page',options:{bold:true,color:WHITE,fill:GREEN}},{text:'Collection result',options:{bold:true,color:WHITE,fill:GREEN}}];
 const rows=[columns,...sources.map(b=>[b.name,b.documentDate||b.effectiveDate||'Not confirmed',b.documentUrl||b.url||'—',(b.status||'review')+(b.uploadedDocuments?.length?'\nUploaded: '+b.uploadedDocuments.map(u=>u.name).join('; '):'')].map(text=>({text,options:{fontSize:9,fill:WHITE,color:DARK,margin:0.04}})))];
 s.addTable(rows,{x:0.47,y:1.62,w:12.35,h:4.85,colW:[2.15,1.35,7.0,1.85],rowH:0.58,border:{type:'solid',color:BORDER,pt:0.6},fontFace:'Arial',fontSize:9,margin:0.05,breakLine:false});
 s.addText('A publication date is not assumed to equal the effective date. These links are included for source checking; no report is archived.',{x:0.53,y:6.55,w:12,h:0.34,fontSize:9.4,color:GREY,margin:0});
 return s;
}
export async function generatePowerPoint(input){
 const asOf=String(input.asOf||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw Error('Invalid report date');
 const records=checkRows(input.records||[]);
 const sources=Array.isArray(input.sources)?input.sources.slice(0,7).map(s=>({
  id:String(s.id||''),name:String(s.name||''),url:String(s.url||''),documentUrl:String(s.documentUrl||''),
  documentDate:String(s.documentDate||''),effectiveDate:String(s.effectiveDate||''),status:String(s.status||''),
  uploadedDocuments:Array.isArray(s.uploadedDocuments)?s.uploadedDocuments.slice(0,12).map(u=>({name:String(u.name||'').slice(0,100),readable:!!u.readable})):[]
 })):[];
 const idx=new Map(records.map(x=>[x.productId+'|'+x.tenor+'|'+x.bankId,x]));
 const ppt=new pptxgen();ppt.layout='LAYOUT_WIDE';ppt.author='MTB Peer Deposit Rate Monitoring System';
 ppt.subject='Bank deposit rate comparison as of '+asOf;
 ppt.title='MTB Peer Bank FDR and DPS Rates - '+asOf;
 ppt.lang='en-BD';ppt.theme={headFontFace:'Arial',bodyFontFace:'Arial',lang:'en-BD'};
 let page=1;
 cover(ppt,'FDR',products.filter(p=>p.type==='FDR').map(p=>p.name),asOf,'FDR');page++;
 addBankMatrix(ppt,'monthly-benefit',pmap['monthly-benefit'].tenors,idx,asOf,page++,'MTB Monthly Benefit Plan',records,sources);
 addBankMatrix(ppt,'quarterly-benefit',pmap['quarterly-benefit'].tenors,idx,asOf,page++,'MTB Quarterly Benefit Plan',records,sources);
 const parts=splitDays();for(let i=0;i<5;i++)addBankMatrix(ppt,'fdr-days',parts[i].filter(t=>pmap['fdr-days'].tenors.includes(t)),idx,asOf,page++,'MTB FDR in Days · Part '+(i+1),records,sources);
 addBankMatrix(ppt,'fixed-deposit',pmap['fixed-deposit'].tenors.slice(0,5),idx,asOf,page++,'MTB Fixed Deposit · Part 1',records,sources);
 addBankMatrix(ppt,'fixed-deposit',pmap['fixed-deposit'].tenors.slice(5),idx,asOf,page++,'MTB Fixed Deposit · Part 2',records,sources);
 addBankMatrix(ppt,'double-saver',pmap['double-saver'].tenors,idx,asOf,page++,'MTB Double Saver',records,sources);
 cover(ppt,'DPS',products.filter(p=>p.type==='DPS').map(p=>p.name),asOf,'DPS');page++;
 for(const [pid,title] of [
  ['brick-by-brick','MTB Brick by Brick'],['angona-dps','MTB Angona DPS'],['lakhopoti','MTB Lakhopoti Plan'],
  ['kotipati','MTB Kotipati Plan'],['millionaire','MTB Millionaire Plan']
 ])addBankMatrix(ppt,pid,pmap[pid].tenors,idx,asOf,page++,title,records,sources);
 // The original final DPS slide combines Education Plan and Junior Flexi DPS.
 const combined=ppt.addSlide();putHeader(combined,'MTB Education Plan & MTB Junior Flexi DPS',asOf,page++);
 const finalTenors=[...new Set([...pmap['education-plan'].tenors,...pmap['junior-flexi'].tenors])].sort((a,b)=>parseInt(a)-parseInt(b));
 const h=['MTB offered tenor','Education current','Education Proposed','Junior current','Junior Proposed','EBL','Prime','BRAC','Dhaka','City','UCB'];
 const rs=[h.map(x=>({text:x,options:{fill:GREEN,color:WHITE,bold:true,align:'center'}}))];
 for(let i=0;i<finalTenors.length;i++){
  const tenor=finalTenors[i];
  const arr=[tenor,valueFor(idx,'education-plan',tenor,'MTB'),'',valueFor(idx,'junior-flexi',tenor,'MTB'),'',
   valueFor(idx,'education-plan',tenor,'EBL'),valueFor(idx,'education-plan',tenor,'PRIME'),valueFor(idx,'education-plan',tenor,'BRAC'),
   valueFor(idx,'education-plan',tenor,'DHAKA'),valueFor(idx,'education-plan',tenor,'CITY'),valueFor(idx,'education-plan',tenor,'UCB')];
  rs.push(arr.map((text,j)=>({text,options:{fill:j===0?LIGHT:(i%2?WHITE:BEIGE),color:DARK,align:'center'}})));
 }
 combined.addTable(rs,{x:0.36,y:1.72,w:12.61,colW:[1.50,1.15,1.15,1.15,1.15,1.08,1.08,1.08,1.08,1.08,1.08],rowH:0.48,
  border:{type:'solid',color:BORDER,pt:.6},fontFace:'Arial',fontSize:8.5,margin:.045,breakLine:false});
 addSlideNotes(combined,records,sources);
 sourcesSlide(ppt,sources,asOf,page++);
 const out=await ppt.write({outputType:'nodebuffer'});
 return Buffer.from(out);
}
