import JSZip from 'jszip';
import * as cheerio from 'cheerio';
import {products,banks} from './catalog.js';
import {FDR_TEMPLATE} from './templates/fdr.js';
import {DPS_TEMPLATE} from './templates/dps.js';

const nameBanks={
 MTB:['mutual trust bank','mtb'],
 EBL:['eastern bank','ebl'],
 PRIME:['prime bank'],
 BRAC:['brac bank'],
 DHAKA:['dhaka bank'],
 CITY:['city bank'],
 UCB:['united commercial bank','ucb']
};
const sourceProducts=Object.fromEntries(products.map(p=>[p.id,p]));
const tidy=s=>String(s??'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const bankId=s=>{
 const n=tidy(s);
 for(const [id,names] of Object.entries(nameBanks))if(names.some(x=>n===x||n===tidy(x)))return id;
 return null;
};
function tenor(s){
 const n=tidy(s);
 const year=n.match(/(?:^|\b)(\d+)\s*years?\b/),month=n.match(/(?:^|\b)(\d+)\s*months?\b/),day=n.match(/(?:^|\b)(\d+)\s*days?\b/);
 if(year&&month){
  const months=Number(year[1])*12+Number(month[1]);return 'm'+months;
 }
 if(year)return 'm'+Number(year[1])*12;
 if(month)return 'm'+Number(month[1]);
 if(day)return 'd'+Number(day[1]);
 return '';
}
function rateValue(record){
 if(!record||!['verified','uploaded_reviewed','tenor_na'].includes(record.status))return '';
 if(record.status==='tenor_na')return '-';
 if(record.rate===null||record.rate===''||record.rate===undefined)return '';
 const v=Number(record.rate);return Number.isFinite(v)&&v>=0&&v<=30?v.toFixed(2)+'%':'';
}
function cellText($,el){
 return $(el).find('a\\:t').map((_,x)=>$(x).text()).get().join('').trim();
}
function replaceText($,cell,v){
 const text=String(v??''),p=$(cell).find('a\\:p').first();
 if(!p.length)return;
 const runs=p.children('a\\:r');
 if(!text){runs.remove();return;}
 if(runs.length){
  const first=runs.first();const spans=first.find('a\\:t');
  if(spans.length)spans.first().text(text);
  else first.append($('<a:t></a:t>').text(text));
  spans.slice(1).remove();runs.slice(1).remove();
  return;
 }
 const end=p.children('a\\:endParaRPr').first();
 const attributes=end.attr()||{};
 const attrString=Object.entries(attributes).map(([k,x])=>k+'="'+String(x).replace(/&/g,'&amp;').replace(/"/g,'&quot;')+'"').join(' ');
 const extras=end.html()||'';
 const run=$('<a:r><a:rPr '+attrString+'>'+extras+'</a:rPr><a:t></a:t></a:r>');
 run.find('a\\:t').text(text);
 if(end.length)end.before(run);else p.append(run);
}
function peersMatch(product,bank,templateLabel){
 if(bank==='MTB')return true;
 const expected=product.peers?.[bank]||'N/A',head=tidy(templateLabel);
 if(!head||head==='n a'||tidy(expected)==='n a')return false;
 // Only map product labels already present in the user's original template.
 // Do not fill arbitrary accounts or similarly named deposits.
 const a=tidy(expected),b=head.replace(/\b(?:individual|retail|scheme|plan)\b/g,' ').trim();
 const x=a.replace(/\b(?:individual|retail|scheme|plan)\b/g,' ').trim();
 if(x.length<7||b.length<7)return false;
 return x.includes(b)||b.includes(x);
}
function groupColumns($,row){
 const cells=$(row).children('a\\:tc').toArray(),result=new Map();
 let bank=null;
 for(let c=1;c<cells.length;c++){
  const text=cellText($,cells[c]),id=bankId(text);
  if(id)bank=id;
  if(bank){
   if(!result.has(bank))result.set(bank,[]);
   result.get(bank).push(c);
  }
 }
 return result;
}
function sectionProduct(kind,slideNum){
 if(kind==='FDR'){
  if(slideNum===2)return 'monthly-benefit';
  if(slideNum===3)return 'quarterly-benefit';
  if(slideNum>=4&&slideNum<=8)return 'fdr-days';
  if(slideNum===9||slideNum===10)return 'fixed-deposit';
  if(slideNum===11)return 'double-saver';
 }else{
  return ['','brick-by-brick','angona-dps','lakhopoti','kotipati','millionaire','education-plan'][slideNum-1]||null;
 }
 return null;
}
function safeRateCell($,cell){
 if(!cell)return false;
 return !$(cell).attr('hMerge')&&!$(cell).attr('vMerge');
}
function updateDate($,date){
 const pretty=new Date(date+'T00:00:00Z').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric',timeZone:'UTC'});
 $('a\\:t').each((_,el)=>{
  const raw=$(el).text();
  const modified=raw
   .replace(/Last Review Date:\s*(?:November|October|September)\s+\d{1,2},?\s*2026/gi,'Last Review Date: '+pretty)
   .replace(/(?:as of|dated)\s+(?:November|October|September)\s+\d{1,2},?\s*2026/gi,m=>m.split(/\s/)[0]+' '+pretty)
   .replace(/(?:15th\s+November,?\s*2026|November\s+17,?\s*2026|November\s+15,?\s*2026)/gi,pretty);
  if(modified!==raw)$(el).text(modified);
 });
}
function sourceIndex(records){
 const index=new Map();
 for(const r of records||[]){
  if(!r||!sourceProducts[r.productId]||!nameBanks[r.bankId])continue;
  const key=r.productId+'|'+tenor(r.tenor)+'|'+r.bankId;
  if(!key.includes('|m')&&!key.includes('|d'))continue;
  const rVal=rateValue(r);
  if(rVal&&['verified','uploaded_reviewed','tenor_na'].includes(r.status))index.set(key,{...r,formatted:rVal});
 }
 return index;
}
async function processTemplate(base64,kind,records,asOf){
 const raw=Buffer.from(String(base64||''),'base64');
 if(!raw.length||raw.length>3_000_000)throw Error(kind+' original template missing or too large');
 if(raw.subarray(0,2).toString()!=='PK')throw Error(kind+' template must be an original .pptx file');
 const zip=await JSZip.loadAsync(raw,{checkCRC32:true});
 const expected=kind==='FDR'?11:7;
 const slides=Object.keys(zip.files).filter(x=>/^ppt\/slides\/slide\d+\.xml$/.test(x));
 if(slides.length!==expected)throw Error(kind+' template has '+slides.length+' slides; expected exactly '+expected+' from the original');
 if(!zip.file('ppt/media/image1.jpg'))throw Error(kind+' source does not appear to be the supplied MTB presentation template');
 const index=sourceIndex(records),log=[];
 for(let no=1;no<=expected;no++){
  const path='ppt/slides/slide'+no+'.xml',original=await zip.file(path).async('string');
  const $=cheerio.load(original,{xmlMode:true,decodeEntities:true});
  updateDate($,asOf);
  if(no>1){
   const productId=sectionProduct(kind,no);
   if(!productId)throw Error('Missing rate mapping for '+kind+' slide '+no);
   const product=sourceProducts[productId],table=$('a\\:tbl').first();
   if(!table.length)throw Error(kind+' slide '+no+' does not contain the original table');
   const rows=table.children('a\\:tr').toArray();
   if(rows.length<4)throw Error('Unexpected original template table on slide '+no);
   const columns=groupColumns($,rows[0]);
   const pRows=$(rows[1]).children('a\\:tc').toArray();
   const dataRows=kind==='FDR'&&no===11?[rows[4]]:rows.slice(3);
   let updated=0;
   for(const row of dataRows){
    if(!row)continue;
    const cells=$(row).children('a\\:tc').toArray();
    const displayedTenor=(kind==='FDR'&&no===11)?'8 Years 7 Months':cellText($,cells[0]);
    const keyTenor=tenor(displayedTenor);
    // Clear only old values, without moving cells, changing table geometry,
    // text style, backgrounds or any slide assets.
    for(let c=1;c<cells.length;c++){
     const old=cellText($,cells[c]);
     if(safeRateCell($,cells[c])&&(/(?:\d+(?:\.\d+)?\s*%)/.test(old)||old==='-'||old==='–'))replaceText($,cells[c],'');
    }
    if(safeRateCell($,cells[2]))replaceText($,cells[2],''); // MTB proposed always blank
    if(kind==='DPS'&&no===7&&safeRateCell($,cells[4]))replaceText($,cells[4],'');
    if(!keyTenor)continue;
    for(const [bank,columnsOfBank] of columns.entries()){
     if(!columnsOfBank.length)continue;
     // Multi-column peer panels represent different products or amount brackets.
     // No generic rate may be propagated across those columns.
     if(bank!=='MTB'&&columnsOfBank.length>1)continue;
     const target=bank==='MTB'?1:columnsOfBank[0];
     if(!safeRateCell($,cells[target]))continue;
     const candidate=index.get(productId+'|'+keyTenor+'|'+bank);
     if(!candidate)continue;
     if(bank!=='MTB'&&!peersMatch(product,bank,cellText($,pRows[target])))continue;
     replaceText($,cells[target],candidate.formatted);updated++;
    }
    if(kind==='DPS'&&no===7){
     const junior=index.get('junior-flexi|'+keyTenor+'|MTB');
     if(junior&&safeRateCell($,cells[3])){replaceText($,cells[3],junior.formatted);updated++;}
    }
   }
   // The original Double Saver table keeps the maturity-tenor row separate.
   if(kind==='FDR'&&no===11){
    const cells=$(rows[2]).children('a\\:tc').toArray();
    if(safeRateCell($,cells[1]))replaceText($,cells[1],'8 Years 7 Months');
   }
   log.push(kind+' slide '+no+': '+updated+' current-rate values populated');
  }
  zip.file(path,$.xml());
 }
 const buffer=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
 return {buffer,log};
}
export async function generateExactReports(input){
 const date=String(input.asOf||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw Error('Invalid report as-of date');
 const templates={FDR:input.templates?.FDR||FDR_TEMPLATE,DPS:input.templates?.DPS||DPS_TEMPLATE};
 if(!Array.isArray(input.records)||input.records.length<50)throw Error('Proceed through source review before generating the presentation');
 const results=await Promise.all(['FDR','DPS'].map(x=>processTemplate(templates[x],x,input.records,date)));
 const zip=new JSZip();
 zip.file('MTB_Peer_FDR_Rates_'+date+'.pptx',results[0].buffer);
 zip.file('MTB_Peer_DPS_Rates_'+date+'.pptx',results[1].buffer);
 const sourceLines=['MTB PEER BANK SOURCE DOCUMENTS','Report as of '+date,'','Rate sources and effective dates (do not infer publication dates):'];
 for(const s of input.sources||[]){
  sourceLines.push('',String(s.name||s.id), 'Official PDF: '+String(s.documentUrl||'Not supplied'), 'Official page: '+String(s.url||''),
   'Effective date: '+String(s.documentDate||s.effectiveDate||'Not confirmed'), 'Retrieval: '+String(s.status||'Not verified'));
 }
 sourceLines.push('','Blank rate = not verified. Dash = confirmed missing comparable tenor.',
  'Proposed Rate columns are intentionally blank. No change to original PowerPoint layout.',
  'If a peer has no genuine comparable product, do not insert a rate for that bank.',
  '',...results.flatMap(r=>r.log));
 zip.file('Official_Source_PDFs.txt',sourceLines.join('\n'));
 return zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
}
