import ExcelJS from 'exceljs';
import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {banks,products} from './catalog.js';
import {collectBank,deriveRate} from './extractor.js';

export const config={api:{bodyParser:false}};
const MAX_REQUEST=3_100_000;
const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const norm=s=>clean(s).toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
const escaped=s=>String(s??'').replace(/[\u0000-\u001f\u007f]/g,' ').slice(0,500);
const error=(message,status=422)=>Object.assign(new Error(message),{status});
const typeAllows=['application/pdf','image/jpeg','image/png'];

function todayDhaka(){
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'})
  .formatToParts(new Date());
 const get=t=>parts.find(p=>p.type===t)?.value||'';
 return get('year')+'-'+get('month')+'-'+get('day');
}
function official(url,bank){
 try{
  const u=new URL(url),d=bank.domain.toLowerCase().replace(/^www\./,''),h=u.hostname.toLowerCase();
  return u.protocol==='https:'&&!u.username&&!u.password&&(!u.port||u.port==='443')&&!/^\d+(?:\.\d+){3}$/.test(h)&&(h===d||h.endsWith('.'+d));
 }catch{return false;}
}
function dateValue(s){
 const x=String(s||'').match(/(?:effective\s+(?:from|date)|w\.e\.f\.?|with\s+effect\s+from|as\s+of)\s*[:\-]?\s*(\d{1,2}[ /-][A-Za-z]+[ /,-]+20\d{2}|[A-Za-z]+[ /-]\d{1,2}[ ,/-]+20\d{2}|\d{1,2}[-/]\d{1,2}[-/]20\d{2}|20\d{2}-\d{2}-\d{2})/i);
 if(!x)return '';
 const d=Date.parse(x[1]);
 return Number.isFinite(d)?new Date(d).toISOString().slice(0,10):'';
}
function tenorKey(s){
 const pairs=[...norm(s).matchAll(/(\d+)\s*(years?|months?|days?)/g)];
 if(!pairs.length)return norm(s);
 let m=0,d=0;
 for(const x of pairs){if(x[2].startsWith('year'))m+=Number(x[1])*12;else if(x[2].startsWith('month'))m+=Number(x[1]);else d+=Number(x[1]);}
 return d&&m?'mixed:'+norm(s):d?'d'+d:'m'+m;
}
async function rawRequest(req,max=MAX_REQUEST){
 let chunks=[],size=0;
 for await(const x of req){size+=x.length;if(size>max)throw error('File or request exceeds 3 MB',413);chunks.push(x);}
 return Buffer.concat(chunks);
}
function quoteJSON(b){
 try{return JSON.parse(b.toString('utf8')||'{}');}catch{throw error('Malformed request');}
}
async function restrictedFetch(url,bank,timeoutMs=5500){
 if(!official(url,bank))throw Error('Unapproved official bank URL');
 let current=url;
 for(let hops=0;hops<3;hops++){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
   const response=await fetch(current,{signal:controller.signal,redirect:'manual',
    headers:{'User-Agent':'Mozilla/5.0 (compatible; PeerBankRates/2.0; official-publication-check)'}});
   if([301,302,303,307,308].includes(response.status)){
    const next=new URL(response.headers.get('location')||'',current).href;
    if(!official(next,bank))throw Error('Rate page redirected outside bank domain; upload document instead');
    current=next;continue;
   }
   if(!response.ok)throw Error('Official website returned HTTP '+response.status);
   if(Number(response.headers.get('content-length')||0)>7_000_000)throw Error('Official file is too large');
   const binary=Buffer.from(await response.arrayBuffer());
   if(binary.length>7_000_000)throw Error('Official file exceeds size limit');
   return {url:current,bytes:binary,type:response.headers.get('content-type')||''};
  }finally{clearTimeout(timer);}
 }
 throw Error('Rate page exceeded redirect limit');
}
function tableRows(html){
 const $=cheerio.load(html),tables=[];
 $('table').slice(0,80).each((_,table)=>{
  const rows=[];
  $(table).find('tr').slice(0,120).each((__,tr)=>{
   const cells=$(tr).find('td,th').map((___,c)=>clean($(c).text())).get();
   if(cells.length>=2&&cells.some(Boolean))rows.push(cells);
  });
  if(rows.length)tables.push({context:clean($(table).prevAll('h1,h2,h3,h4,h5').first().text()),rows});
 });
 $('script,style,noscript').remove();
 const visible=clean($('body').text()).slice(0,60_000);
 const links=$('a[href]').map((_,el)=>{
  try{return {name:clean($(el).text()),url:new URL($(el).attr('href'),html._sourceUrl||'https://invalid.example').href};}catch{return null;}
 }).get().filter(Boolean);
 return{tables,visible,links};
}
async function collect(bank){
 const item={id:bank.id,name:bank.name,url:bank.url,effectiveDate:'',status:'unavailable',note:'',tables:[],text:'',documentUrl:''};
 try{
  const response=await restrictedFetch(bank.url,bank);
  if(response.bytes.subarray(0,4).toString()==='%PDF'){
   item.text='';
   item.documentUrl=response.url;item.status='pdf_requires_upload';item.note='Bank PDF discovered; automatic deep PDF parsing skipped for fast generation. Upload it for manual review.';
  }else{
   const html=response.bytes.toString('utf8');
   const $=cheerio.load(html),tables=[];
   $('table').slice(0,70).each((i,table)=>{
    const rows=[];$(table).find('tr').slice(0,100).each((j,tr)=>{
     const cells=$(tr).find('td,th').map((_,x)=>clean($(x).text())).get();
     if(cells.length>1&&cells.some(Boolean))rows.push(cells);
    });
    if(rows.length)tables.push({context:clean($(table).prevAll('h1,h2,h3,h4').first().text()),rows});
   });
   $('script,style,noscript').remove();
   item.text=clean($('body').text()).slice(0,100_000);item.tables=tables;item.status='retrieved_web';
   const links=$('a[href]').map((_,a)=>{try{return{name:clean($(a).text()),url:new URL($(a).attr('href'),response.url).href};}catch{return null;}})
    .get().filter(Boolean).filter(x=>official(x.url,bank)&&/\.pdf(?:\?|$)/i.test(x.url)&&/deposit|interest|rate/i.test(x.name+' '+x.url));
   if(links.length){
    try{
     const pdf=await restrictedFetch(links[0].url,bank,4200);
     if(pdf.bytes.subarray(0,4).toString()==='%PDF'){
      item.documentUrl=pdf.url;
      item.status='linked_pdf_requires_upload';
      item.note='Official bank PDF detected; use optional upload for manual rate review.';
     }
    }catch(e){item.note='Linked PDF inaccessible: '+String(e.message).slice(0,150);}
   }
  }
  item.effectiveDate=dateValue(item.text);
  if(!item.effectiveDate)item.note+=(item.note?'; ':'')+'No machine-verifiable rate effective date';
 }catch(e){item.status='unavailable';item.note=String(e.message||e).slice(0,180);}
 return item;
}
function detectRate(src,peer,tenor,date){
 if(!src||!src.effectiveDate||src.effectiveDate>date||!Array.isArray(src.tables))return null;
 const p=norm(peer);
 if(p.length<12||p==='fixed deposit'||p==='special deposit'||p==='fd')return null;
 const tk=tenorKey(tenor),values=[];
 for(const table of src.tables){
  const context=norm(table.context+' '+table.rows.slice(0,4).flat().join(' '));
  if(!context.includes(p))continue;
  for(const row of table.rows){
   if(row.length!==2||tenorKey(row[0])!==tk)continue;
   const rates=[...row[1].matchAll(/(?:^|[^\d])(\d{1,2}(?:\.\d{1,3})?)\s*%/g)]
    .map(x=>Number(x[1])).filter(x=>Number.isFinite(x)&&x>=0&&x<=30);
   if(rates.length===1)values.push(rates[0]);
  }
 }
 return values.length===1?values[0]:null;
}
function buildRows(selectedProducts,sources,asOf){
 const by=Object.fromEntries(sources.map(s=>[s.id,s])),records=[];
 for(const p of selectedProducts)for(const tenor of p.tenors)for(const bank of banks){
  const peer=bank.id==='MTB'?p.name:(p.peers[bank.id]||'N/A');
  const src=by[bank.id],result=peer==='N/A'?null:deriveRate(src,p,bank,tenor,asOf);
  const status=peer==='N/A'?'product_na':result?.rate!==null&&result?.rate!==undefined?'verified':'review';
  const note=peer==='N/A'?'No comparable peer product in current comparison map'
   :result?.note||src?.note||'No verified current rate for this exact product and tenor';
  records.push({category:p.type,productId:p.id,product:p.name,tenor,
    bankId:bank.id,peerProduct:peer,rate:status==='verified'?result.rate:null,status,note,
    sourceUrl:result?.sourceUrl||src?.documentUrl||src?.url||bank.url,
    effectiveDate:result?.effectiveDate||src?.documentDate||'',proposedRate:null});
 }
 return records;
}

function textStyle(cell,fill='FFFFFF',color='1D4540',bold=false){
 cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+fill}};
 cell.font={name:'Aptos',size:10,bold,color:{argb:'FF'+color}};
 cell.alignment={vertical:'middle',wrapText:true};
 cell.border={bottom:{style:'hair',color:{argb:'FFDDE9E5'}}};
}
function cellValue(cell,value,kind='normal'){
 cell.value=value===null||value===undefined?'':value;
 if(kind==='head')textStyle(cell,'126256','FFFFFF',true);
 else if(kind==='muted')textStyle(cell,'EDF3F1','56726B');
 else if(kind==='review')textStyle(cell,'FFF2D7','785B1D');
 else if(kind==='na')textStyle(cell,'F2F4F5','73837E');
 else textStyle(cell,'FFFFFF','21413B');
}
function contentLineMatches(text){
 return String(text||'').split(/\r?\n/).map(s=>s.trim()).filter(s=>s.length>4&&s.length<250&&/\d{1,2}(?:\.\d+)?\s*%/.test(s)).slice(0,100);
}
function addWorkbookOverview(wb,report){
 const s=wb.addWorksheet('Read Me');
 s.columns=[{width:24},{width:83}];s.mergeCells('A1:B1');s.getCell('A1').value='MTB | Peer Deposit Rate Report';
 s.getCell('A1').font={name:'Aptos Display',size:20,bold:true,color:{argb:'FF0B554A'}};
 const info=[['As of report date',report.asOf+' (Asia/Dhaka)'],['Source policy','Latest available official rate sheet effective ON or BEFORE report as-of date; upload text marked unverified'],
 ['Reference bank','Mutual Trust Bank PLC'],['Proposed Rate','ALWAYS BLANK — for ALCO confirmation'],
 ['N/A','Peer has no comparable product in candidate mapping'],['-','Peer offers comparable product but verified MTB tenor unavailable'],
 ['Blank rate','No sufficiently verified current official rate; requires review'],
 ['Storage','Generated in memory and downloaded; no server report archive'],
 ['Publication vs. effective date','An effective date is not necessarily the publication/upload date. We only label dates supported by the official document.'],
 ['Important','Before ALCO, verify every highlighted/blank rate and effective date against the cited original bank publication']];
 for(let i=0;i<info.length;i++){const r=s.getRow(i+3);cellValue(r.getCell(1),info[i][0],'head');cellValue(r.getCell(2),info[i][1],i===info.length-1?'review':'normal');r.height=i===info.length-1?40:28;}
}
function addProduct(wb,product,report){
 const title=(product.type==='FDR'?'F_':'D_')+product.id;
 const ws=wb.addWorksheet(title.slice(0,31)),bs= banks,records=report.records;
 ws.views=[{state:'frozen',ySplit:6}];ws.properties.defaultRowHeight=21;
 ws.columns=[{width:22},...bs.map(()=>({width:23})),{width:22},{width:35}];
 ws.mergeCells(1,1,1,bs.length+3);
 const titleCell=ws.getCell(1,1);titleCell.value=product.name;titleCell.font={name:'Aptos Display',bold:true,size:18,color:{argb:'FF0A5E50'}};
 ws.mergeCells(2,1,2,bs.length+3);ws.getCell(2,1).value='Downloaded '+report.asOf+'  •  MTB is the reference bank  •  Unverified rates intentionally blank';
 cellValue(ws.getCell(4,1),'Peer product','head');
 for(let j=0;j<bs.length;j++){
  const b=bs[j],candidate=b.id==='MTB'?product.name:product.peers[b.id]||'N/A';
  cellValue(ws.getCell(4,j+2),candidate,candidate==='N/A'?'na':'normal');
 }
 cellValue(ws.getCell(6,1),'MTB offered tenor','head');
 for(let j=0;j<bs.length;j++)cellValue(ws.getCell(6,j+2),bs[j].name+' current rate','head');
 cellValue(ws.getCell(6,bs.length+2),'MTB Proposed Rate','head');
 cellValue(ws.getCell(6,bs.length+3),'Review needed','head');
 for(let k=0;k<product.tenors.length;k++){
  const tenor=product.tenors[k],row=ws.getRow(7+k);
  cellValue(row.getCell(1),tenor,'muted');const missing=[];
  for(let j=0;j<bs.length;j++){
   const r=records.find(x=>x.productId===product.id&&x.tenor===tenor&&x.bankId===bs[j].id);
   const cell=row.getCell(j+2);
   if(r?.status==='verified'){cellValue(cell,r.rate);cell.numFmt='0.00"%"';}
   else if(r?.status==='tenor_na')cellValue(cell,'-','na');
   else if(r?.status==='product_na')cellValue(cell,'','na');
   else{cellValue(cell,'','review');missing.push(bs[j].id);}
  }
  cellValue(row.getCell(bs.length+2),'');
  cellValue(row.getCell(bs.length+3),missing.join(', '),missing.length?'review':'normal');
 }
 ws.autoFilter={from:{row:6,column:1},to:{row:6+product.tenors.length,column:bs.length+3}};
}
function addAudit(wb,report){
 const ws=wb.addWorksheet('Rate Audit');
 const cols=['Type','MTB product','MTB tenor','Bank','Peer product','Current rate %','Status','Source URL','Effective date','Evidence note'];
 ws.columns=[{width:12},{width:31},{width:19},{width:13},{width:42},{width:17},{width:20},{width:65},{width:19},{width:58}];
 const top=ws.addRow(cols);top.eachCell(c=>cellValue(c,c.value,'head'));
 for(const r of report.records){
  const v=[r.category,r.product,r.tenor,r.bankId,r.peerProduct,r.rate??'',r.status,r.sourceUrl,r.effectiveDate,r.note];
  const row=ws.addRow(v);
  row.eachCell((c,n)=>cellValue(c,c.value,n===6&&r.status==='verified'?'normal':r.status==='review'?'review':'normal'));
 }
 ws.views=[{state:'frozen',ySplit:1}];ws.autoFilter={from:'A1',to:'J'+(report.records.length+1)};
}
function addSources(wb,report,uploads){
 const ws=wb.addWorksheet('Source PDFs');
 ws.columns=[{width:18},{width:19},{width:20},{width:22},{width:23},{width:73},{width:58},{width:23},{width:18}];
 const header=ws.addRow(['Bank','Source type','Effective date','Publication date','Selection status','Official rate sheet PDF','Official rate page','Rate cells to verify','Uploaded document']);
 header.eachCell(c=>cellValue(c,c.value,'head'));
 for(const s of report.sources){
  const count=report.records.filter(r=>r.bankId===s.id&&r.status==='review').length;
  const up=uploads.filter(x=>x.bankId===s.id).map(x=>x.name).join('; ');
  const row=ws.addRow([s.name,s.sourceType||'Unavailable',s.documentDate||s.effectiveDate||'Not established',s.publishedDate||'Not stated',
   s.status,s.documentUrl||'No official PDF selected',s.url,count,up]);
  row.height=38;row.eachCell((c,n)=>cellValue(c,c.value,count?'review':'normal'));
  if(s.documentUrl)row.getCell(6).value={text:s.documentUrl,hyperlink:s.documentUrl};
  row.getCell(7).value={text:s.url,hyperlink:s.url};
 }
 ws.views=[{state:'frozen',ySplit:1}];
 const notes=ws.addRow(['Method','Select the latest discoverable bank-issued rate sheet whose documented effective date is no later than the report date. A sheet dated 1 November may be valid for a report as of 18 November.']);
 notes.getCell(2).font={name:'Aptos',italic:true,size:10};
 ws.addRow(['Important','Document effective dates and actual publication/upload dates are distinct. The publication-date field remains “Not stated” unless officially evidenced.']);
 ws.addRow(['Historical','Old rate sheets not linked by the bank may be impossible to reconstruct automatically; they are NOT replaced with a newer rate sheet.']);
 const audit=wb.addWorksheet('Source Review');
 audit.columns=[{width:18},{width:27},{width:71},{width:24},{width:73},{width:22}];
 audit.addRow(['Bank','Retrieval status','Official rate page','PDF effective date','Notes / blocker','Candidate PDF URLs found']).eachCell(c=>cellValue(c,c.value,'head'));
 for(const s of report.sources){
  const links=s.alternatives?.map(x=>x.url).slice(0,3).join('\n')||'';
  const row=audit.addRow([s.name,s.status,s.url,s.documentDate||'',s.note||'',links]);row.height=46;
  row.eachCell(c=>cellValue(c,c.value,s.status==='pdf_extracted'||s.status==='web_readable'?'normal':'review'));
 }
 const candidates=wb.addWorksheet('Upload Candidates');
 candidates.columns=[{width:16},{width:38},{width:90},{width:30}];
 candidates.addRow(['Bank','Uploaded file','Extracted rate-bearing text (UNVERIFIED)','Review required']).eachCell(c=>cellValue(c,c.value,'head'));
 for(const u of uploads)for(const line of contentLineMatches(u.text).slice(0,50)){
  const row=candidates.addRow([u.bankId,u.name,escaped(line),'Unverified; check official source']);
  row.eachCell(c=>cellValue(c,c.value,'review'));
 }
 if(!uploads.length)candidates.addRow(['—','None','','']);
}

async function buildExcel(req,res){
 const input=quoteJSON(await rawRequest(req,350_000));
 const scope=input.scope||'both';
 const date=input.asOf||todayDhaka();
 if(!/^20\d{2}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date))||date>todayDhaka())throw error('Please select a valid report date that is not in the future');
 if(!['both','FDR','DPS'].includes(scope))throw error('Invalid report type');
 const uploads=Array.isArray(input.uploads)?input.uploads.slice(0,7).map(x=>({
  bankId:String(x.bankId||'').slice(0,16),name:String(x.name||'').slice(0,90),
  text:String(x.text||'').slice(0,15_000)
 })).filter(x=>banks.some(b=>b.id===x.bankId)):[];
 const requested=products.filter(p=>scope==='both'||p.type===scope);
 const sources=await Promise.all(banks.map(b=>collectBank(b,date)));
 const records=buildRows(requested,sources,date);
 const report={asOf:date,sources,records};
 const wb=new ExcelJS.Workbook();wb.creator='MTB Peer Rate Monitor';wb.created=new Date();wb.calcProperties.fullCalcOnLoad=true;
 addWorkbookOverview(wb,report);
 for(const p of requested)addProduct(wb,p,report);
 addAudit(wb,report);addSources(wb,report,uploads);
 const buf=Buffer.from(await wb.xlsx.writeBuffer());
 const name='MTB_Peer_Deposit_Rates_'+date+(scope==='both'?'':'_'+scope)+'.xlsx';
 res.status(200);res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
 res.setHeader('Content-Disposition','attachment; filename="'+name+'"');
 res.setHeader('Content-Length',buf.length);
 return res.end(buf);
}
async function extractPDF(req,res){
 const kind=String(req.headers['content-type']||'').split(';')[0].trim();
 if(!typeAllows.includes(kind))throw error('Only PDF, JPG or PNG supported');
 const file=await rawRequest(req,MAX_REQUEST);
 if(!file.length)throw error('Empty file');
 const valid=kind==='application/pdf'?file.subarray(0,4).toString()==='%PDF':
  kind==='image/jpeg'?file[0]===255&&file[1]===216:file.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
 if(!valid)throw error('File does not match its declared format');
 if(kind!=='application/pdf')return res.status(200).json({text:'',notice:'Image was not uploaded to storage. Use browser OCR preview; review extracted figures before ALCO.'});
 try{
  const parsed=await pdfParse(file);
  return res.status(200).json({text:String(parsed.text||'').slice(0,20_000),
   notice:'PDF text extracted in memory. Proposed rates and unverified bank rates remain blank.'});
 }catch{return res.status(200).json({text:'',notice:'Scanned PDF has no machine-readable text. Please upload a JPG/PNG scan for browser OCR.'});}
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const action=String(req.query.action||'health').split('&')[0];
  if(action==='health')return res.status(200).json({ok:true,stateless:true,archive:false,authRequired:false,version:'2.2'});
  if(action==='excel'&&req.method==='POST')return await buildExcel(req,res);
  if(action==='extract'&&req.method==='POST')return await extractPDF(req,res);
  return res.status(404).json({error:'This version only supports Excel download; report history was removed.'});
 }catch(e){
  console.error('Peer rate generation error:',String(e.message||e));
  if(!res.headersSent)return res.status(e.status||500).json({error:String(e.message||e)});
 }
}
