import * as cheerio from 'cheerio';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';

const clean=s=>String(s??'').replace(/\s+/g,' ').trim();
const low=s=>clean(s).toLowerCase();
const numberRate=s=>{const m=String(s??'').match(/^\s*(\d{1,2}(?:\.\d{1,3})?)\s*%\s*$/);const x=m?Number(m[1]):null;return x!==null&&x>=0&&x<=30?x:null;};
const rateFromText=s=>{const m=String(s??'').match(/(?:^|[^\d])(\d{1,2}(?:\.\d{1,3})?)\s*%/);const x=m?Number(m[1]):null;return x!==null&&x>=0&&x<=30?x:null;};
const isDate=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s));
const months={jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12};
function toISO(y,m,d){if(!y||!m||!d)return '';const v=[+y,+m,+d];const iso=v[0]+'-'+String(v[1]).padStart(2,'0')+'-'+String(v[2]).padStart(2,'0');return isDate(iso)?iso:'';}
function dateFragment(s){
 const x=String(s||'');
 let m=x.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);if(m)return toISO(m[1],m[2],m[3]);
 m=x.match(/\b(\d{1,2})(?:st|nd|rd|th)?[ ,./-]+(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[ ,./-]+(20\d{2})\b/i);
 if(m)return toISO(m[3],months[m[2].toLowerCase().slice(0,3)],m[1]);
 m=x.match(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)[ ,./-]+(\d{1,2})(?:st|nd|rd|th)?[,]?[ /-]+(20\d{2})\b/i);
 if(m)return toISO(m[3],months[m[1].toLowerCase().slice(0,3)],m[2]);
 m=x.match(/\b(\d{1,2})[-/](\d{1,2})[-/](20\d{2})\b/);if(m)return toISO(m[3],m[2],m[1]);
 return '';
}
function effectiveDate(s){
 const txt=String(s||'').slice(0,8000);
 const matches=[...txt.matchAll(/\b(?:effective\s*(?:date|from)?|w\.?\s*e\.?\s*f\.?|date\s*:)\s*[:\-]?\s*([^\n\r]{0,60})/gi)];
 for(const x of matches){const d=dateFragment(x[1]);if(d)return d;}
 return dateFragment(txt.slice(0,2500));
}
function dateFromUrl(s){
 const decoded=decodeURIComponent(String(s||'')).replace(/[_-]/g,' ');
 const date=dateFragment(decoded);
 if(date)return date;
 const v=decoded.match(/(?:\b|_)(\d{2})\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s*(\d{2})(?:\b|_)/i);
 if(v)return toISO(2000+Number(v[3]),months[v[2].toLowerCase()],v[1]);
 return '';
}
function comparableRoot(name){
 return low(name).replace(/\s+(retail|individual|general|scheme|plan)\b/g,' ').trim();
}
function official(url,bank){
 try{const u=new URL(url),host=u.hostname.toLowerCase(),domain=bank.domain.replace(/^www\./,'').toLowerCase();
 return u.protocol==='https:'&&(host===domain||host.endsWith('.'+domain));}catch{return false;}
}
async function fetchOfficial(url,bank,timeout=5600,max=1_600_000){
 if(!official(url,bank))throw Error('URL not hosted on approved bank website');
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout);
 try{
  const res=await fetch(url,{signal:controller.signal,redirect:'follow',headers:{'User-Agent':'Mozilla/5.0 (compatible; MTBRateReview/2.2)'}});
  if(!official(res.url,bank))throw Error('Redirected to non-official domain');
  if(!res.ok)throw Error('HTTP '+res.status);
  if(Number(res.headers.get('content-length')||0)>max)throw Error('File exceeds safety limit');
  const data=Buffer.from(await res.arrayBuffer());
  if(data.byteLength>max)throw Error('File exceeds safety limit');
  return {data,url:res.url,contentType:res.headers.get('content-type')||''};
 }finally{clearTimeout(timer);}
}
function htmlTables(html){
 const $=cheerio.load(html),tables=[];let heading='',date='';
 // Traverse headings, paragraphs, and tables in document order. The date belongs to its own product section.
 $('h1,h2,h3,h4,h5,h6,p,table').each((_,el)=>{
  if($(el).parents('table').length)return;
  if(/^h[1-6]$/.test(el.tagName||'')){
   heading=clean($(el).text());date='';
  }else if(el.tagName==='p'){
   const str=clean($(el).text());if(/(?:effective\s+(?:from|date)|w\.?e\.?f\.?)/i.test(str)){
    const d=effectiveDate(str);if(d)date=d;
   }
  }else if(el.tagName==='table'){
   const rows=[];
   $(el).find('tr').slice(0,110).each((__,tr)=>{
    const cells=$(tr).children('th,td').map((___,c)=>clean($(c).text())).get();
    if(cells.length>1&&cells.some(Boolean))rows.push(cells);
   });
   if(rows.length)tables.push({heading,date,rows});
  }
 });
 return tables;
}
function officialLinks(html,base,bank){
 const $=cheerio.load(html),links=[];
 $('a[href]').each((_,el)=>{
  let u;try{u=new URL($(el).attr('href'),base).href}catch{return}
  if(!official(u,bank)||!/\.pdf(?:[?#]|$)/i.test(u))return;
  const label=low($(el).text()),name=low(u);
  if(/lending|loan|credit|annual.report|climate|financial.statement|audit|islamic|taqwa/.test(label+' '+name))return;
  const score= /(deposit.*rate|rate.*deposit|full.deposit.products|interest.rate.conventional)/.test(name)?20
   :/deposit|interest.rate|rates/.test(name+' '+label)?10:0;
  if(score)links.push({url:u,label,score,date:dateFromUrl(u)});
 });
 return Array.from(new Map(links.map(x=>[x.url,x])).values()).sort((a,b)=>b.score-a.score||(b.date||'').localeCompare(a.date||''));
}
const docDatePattern=/\b(?:effective\s*(?:date|from)?|dated|date\s*:|with\s*effect\s*from)/i;
async function getSheet(bank,links,asOf){
 const acceptable=links.filter(x=>!x.date||x.date<=asOf).slice(0,5);
 // Explicitly prefer a link with a dated title. Undated files must have a date in their content.
 const available=[];
 await Promise.all(acceptable.map(async link=>{
  try{
   const response=await fetchOfficial(link.url,bank,5700,2_700_000);
   if(response.data.subarray(0,4).toString()!=='%PDF')return;
   const pdf=await Promise.race([pdfParse(response.data),new Promise((_,reject)=>setTimeout(()=>reject(Error('PDF extraction timeout')),7800))]);
   const content=String(pdf.text||'').slice(0,100_000);
   const dates=[effectiveDate(content),link.date].filter(Boolean);
   const date=dates[0]||'';
   if(date&&date<=asOf){
    available.push({url:response.url,effectiveDate:date,text:content,pages:pdf.numpages,extracted:true});
   }
  }catch(e){/* Individual PDF blocked or unreadable; official URL remains visible in source audit */}
 }));
 available.sort((a,b)=>b.effectiveDate.localeCompare(a.effectiveDate));
 return available[0]||null;
}
export async function collectBank(bank,asOf){
 const src={id:bank.id,name:bank.name,url:bank.url,documentUrl:'',documentDate:'',effectiveDate:'',publishedDate:'',
  status:'unavailable',note:'',tables:[],text:'',sourceType:'',alternatives:[]};
 try{
  const r=await fetchOfficial(bank.url,bank,8300,2_300_000);
  const html=r.data.toString('utf8');
  src.tables=htmlTables(html);
  src.status='web_readable';src.sourceType='Official web page';
  src.alternatives=officialLinks(html,r.url,bank).slice(0,12);
  if(src.tables.length&&bank.id==='MTB'){
   src.note='MTB product tables carry their own effective dates. Rates are read only when that date is on or before the report date.';
   src.effectiveDate=src.tables.map(t=>t.date).filter(x=>x&&x<=asOf).sort().at(-1)||'';
  }else if(src.alternatives.length){
   const sheet=await getSheet(bank,src.alternatives,asOf);
   if(sheet){
    src.text=sheet.text;src.documentUrl=sheet.url;src.documentDate=sheet.effectiveDate;src.effectiveDate=sheet.effectiveDate;
    src.sourceType='Official bank PDF';src.status='pdf_extracted';
    src.note='Latest discoverable official rate PDF effective on or before selected report date; effective date verified from document.';
   }else{
    src.status='pdf_unverified';
    src.documentUrl=src.alternatives[0]?.url||'';
    src.note='Official PDF linked but not parsed or no eligible dated sheet established for selected date.';
   }
  }else{
   src.status='web_unstructured';
   src.note='Official page reachable; no supported rate table or downloadable conventional deposit PDF found.';
  }
  if(src.id!=='MTB'&&src.tables.length&&src.status==='web_readable'){
   src.note='Web tables are accessible but automatic product matching requires verification.';
  }
 }catch(e){
  src.status=/HTTP 403|HTTP 406|HTTP 429/.test(String(e))?'access_blocked':'unavailable';
  src.note=String(e.message||e).slice(0,230);
  // The official bank landing page can reject Vercel while the bank-issued PDF remains public.
  if(bank.fallbackPdf){
   src.alternatives=[{url:bank.fallbackPdf,score:10,date:dateFromUrl(bank.fallbackPdf)}];
   const fallback=await getSheet(bank,src.alternatives,asOf).catch(()=>null);
   if(fallback){
    src.status='pdf_extracted_fallback';src.sourceType='Official bank PDF (landing page blocked)';
    src.text=fallback.text;src.documentUrl=fallback.url;src.documentDate=fallback.effectiveDate;
    src.effectiveDate=fallback.effectiveDate;
    src.note='Landing page access error ('+String(e.message||e).slice(0,90)+'). Direct official PDF was downloaded and its effective date confirmed. Verify that the PDF is the latest published sheet.';
   }else{
    src.documentUrl=bank.fallbackPdf;
    src.note+='; official PDF fallback could not be read or validated for selected date.';
   }
  }
 }
 return src;
}
function tenorKey(t){
 const tokens=[...low(t).matchAll(/(\d+)\s*(years?|months?|days?|y|m)\b/g)];
 if(tokens.length){
  let m=0,d=0;
  for(const v of tokens){if(/^y/.test(v[2]))m+=12*Number(v[1]);else if(/^m/.test(v[2]))m+=Number(v[1]);else d+=Number(v[1]);}
  return m&&d?m+'m'+d+'d':m?'m'+m:'d'+d;
 }
 const v=low(t).match(/\b(\d+)\s*([mdy])\b/);return v? v[2]==='y'?'m'+(12*Number(v[1])):v[2]==='m'?'m'+Number(v[1]):'d'+Number(v[1]):low(t);
}
function candidate(rate,src,productNote='',docDate=null){
 if(rate===null||rate<0||rate>30)return null;
 return {rate,sourceUrl:src.documentUrl||src.url,effectiveDate:docDate||src.documentDate||src.effectiveDate,
  note:productNote||'Source: official bank rate publication'};
}
function parseMTB(src,p,tenor,asOf){
 const mapping={
 'fixed-deposit':'Interest Rates on MTB Fixed Deposit (Retail Customer)',
 'fdr-days':'Interest Rates on FDR in Days (Retail Customer)',
 'brick-by-brick':'MTB Brick by Brick',
 'education-plan':'MTB Education plan',
 'millionaire':'MTB Millionaire plan',
 'double-saver':'MTB Double Saver',
 'kotipati':'MTB Kotipati',
 'junior-flexi':'MTB Junior Flexi DPS',
 'monthly-benefit':'MTB Monthly Benefit Plan',
 'quarterly-benefit':'MTB Quarterly Benefit Plan for Retail Customers'
 };
 const heading=mapping[p.id];if(!heading)return null;
 const table=src.tables.find(t=>low(t.heading)===low(heading));
 if(!table||!table.date||table.date>asOf)return null;
 const rows=table.rows,key=tenorKey(tenor);
 if(['fixed-deposit','fdr-days','double-saver'].includes(p.id)){
  const row=rows.slice(1).find(r=>tenorKey(r[0])===key);if(!row)return null;
  const rate=numberRate(row[1]);return candidate(rate,src,p.id==='fixed-deposit'||p.id==='fdr-days'?'MTB retail first deposit-size bracket: below BDT 50 lakh':'MTB published product rate',table.date);
 }
 if(['monthly-benefit','quarterly-benefit'].includes(p.id)){
  const row=rows.slice(1).find(r=>tenorKey(r[2])===key);return row?candidate(numberRate(row[1]),src,'Published return before tax',table.date):null;
 }
 if(['millionaire','kotipati'].includes(p.id)){
  const row=rows.slice(1).find(r=>tenorKey(r[0]+' Years')===key);
  return row?candidate(numberRate(row[2]),src,'Published annual interest rate',table.date):null;
 }
 if(p.id==='junior-flexi'){
  const found=rows.find(r=>low(r[0])==='interest rate');return key==='m48'&&found?candidate(numberRate(found[1]),src,'Published flexi DPS rate',table.date):null;
 }
 if(['education-plan','brick-by-brick'].includes(p.id)){
  const header=rows[0],idx=header.findIndex((x,i)=>i>0&&tenorKey(x)===key);
  if(idx<1)return null;
  const r=rows.slice(2).find(row=>/^\s*\d+/.test(row[0]));
  if(!r)return null;
  return candidate(numberRate(r[1+(idx-1)*2]),src,'Interest rate from official installment table, not maturity amount',table.date);
 }
 return null;
}
function pdfLines(src){return String(src.text||'').split(/\r?\n/).map(clean).filter(Boolean)}
function missingTenor(src,note){
 return {rate:null,status:'tenor_na',sourceUrl:src.documentUrl||src.url,effectiveDate:src.documentDate,note:note||'Comparable product exists, but this MTB tenor is not offered in the cited official sheet'};
}
function rateVector(row,expected){
 const tok=clean(row).split(/\s+/);
 if(tok.length!==expected||!tok.every(x=>x==='-'||/^\d{1,2}(?:\.\d{1,3})?%$/.test(x)))return null;
 return tok.map(x=>x==='-'?null:Number(x.slice(0,-1)));
}
function getEblDpsRow(lines,kind){
 const start=lines.findIndex(l=>/^Recurring Deposit$/i.test(l));
 if(start<0)return null;
 const end=lines.findIndex((l,i)=>i>start&&/^Time Frame$/i.test(l));
 const section=lines.slice(start,end>start?end:start+100);
 const patterns={
  'brick-by-brick':/\bEBL\s+Confidence\b/i,
  'angona-dps':/\bEBL\s+Women\s+Confidence\b/i,
  'millionaire':/\bEBL\s+Millionaire\s+Scheme\b/i,
  'kotipati':/\bEBL\s+Kotipoti\b/i,
  'education-plan':/\bEBL\s+Child\s+Future\s+Plan\b/i,
  'junior-flexi':/\bEBL\s+Child\s+Future\s+Plan\b/i
 };
 const pat=patterns[kind];if(!pat)return null;
 let name='';
 for(const line of section){
  const v=rateVector(line,15);
  if(v){
   if(pat.test(name))return v;
   name='';
  }else{name=clean(name+' '+line).slice(-160);}
 }
 return null;
}
function primeRow(lines,name){
 const row=lines.find(x=>x.toLowerCase().startsWith(name.toLowerCase()));
 if(!row)return null;
 const tokens=clean(row.slice(name.length)).split(/\s+/).filter(Boolean);
 if(tokens.length!==8)return null;
 if(!tokens.every(x=>x==='-'||/^\d{1,2}(?:\.\d{1,3})?%$/.test(x)))return null;
 return tokens.map(x=>x==='-'?null:Number(x.slice(0,-1)));
}
function parsePDF(src,p,tenor){
 const lines=pdfLines(src),tk=tenorKey(tenor);
 if(!lines.length)return null;
 if(src.id==='EBL'){
  if(p.id==='fixed-deposit'){
   const start=lines.findIndex(x=>/Business Unit:\s*Retail/i.test(x));
   const end=lines.findIndex((x,i)=>i>start&&/Business Unit:\s*Corporate/i.test(x));
   if(start<0)return null;
   const arr=lines.slice(start,end>start?end:Math.min(start+110,lines.length));
   const row=arr.find(x=>/^FD\s+\d+\s*(?:Month|Year)s?\b/i.test(x)&&tenorKey(x.match(/^FD\s+(\d+\s*(?:Month|Year)s?)/i)?.[1])===tk);
   if(row)return candidate(rateFromText(row),src,'EBL retail FD, first amount band');
   return missingTenor(src,'EBL retail FD is offered, but the requested MTB tenor is not listed in the official schedule.');
  }
  if(p.id==='monthly-benefit'){
   const row=lines.find(x=>/^EBL Repeat\s+(?:\d+(?:\.\d+)?%\s*){3}/i.test(x));
   const index={m12:0,m24:1,m36:2}[tk];
   if(row&&index!==undefined){
    const matches=[...row.matchAll(/(\d+(?:\.\d+)?)%/g)].map(x=>Number(x[1]));
    return candidate(matches[index]??null,src,'EBL Repeat: 1/2/3-year rates per official PDF');
   }
   return null;
  }
  const dps=getEblDpsRow(lines,p.id);
  if(dps){
   const tenors=[1,2,3,4,5,6,7,8,9,10,12,14,15,18,20].map(y=>'m'+y*12);
   const idx=tenors.indexOf(tk);
   if(idx<0)return missingTenor(src,'Comparable EBL recurring deposit product does not publish this tenor.');
   return dps[idx]===null?missingTenor(src,'The official EBL rate sheet marks this tenor unavailable for the comparable scheme.')
    :candidate(dps[idx],src,'Official EBL recurring deposit rate for the specific tenure');
  }
 }
 if(src.id==='PRIME'){
  if(p.id==='fixed-deposit'){
   const start=lines.findIndex(x=>/FIXED\/TERM DEPOSITS/i.test(x));
   const end=lines.findIndex((x,i)=>i>start&&/MONTHLY INSTALLMENT DEPOSIT SCHEMES/i.test(x));
   if(start<0)return null;
   let active=false;
   for(const row of lines.slice(start,end>start?end:start+45)){
    if(/^Prime Fixed Deposit\s+\d+[MY]/i.test(row))active=true;
    if(/^(Prime I-First|Prime Fixed Deposit Plus)/i.test(row))active=false;
    if(!active)continue;
    const v=row.match(/(?:^Prime Fixed Deposit\s+|\b)(\d+M(?:\s*&\s*above)?)\s+(\d+(?:\.\d+)?%)/i);
    if(v){
     const rate=numberRate(v[2]);
     if(tenorKey(v[1])===tk)return candidate(rate,src,'Prime conventional fixed deposit, any amount');
     if(/24M\s*&\s*above/i.test(v[1])&&/^m(?:[3-9]\d|\d{3,})$/.test(tk))return candidate(rate,src,'Prime FD 24 months and above, any amount');
    }
   }
   return missingTenor(src,'Requested MTB tenor is not separately offered by Prime Fixed Deposit in the official conventional rate sheet.');
  }
  if(p.id==='fdr-days'){
   const row=lines.find(x=>/^Prime Fixed Deposit Plus\s+91 Days/i.test(x));
   if(row){
    const pairs=[...row.matchAll(/(\d+\s+Days)\s+(\d+(?:\.\d+)?%)/gi)];
    const m=pairs.find(x=>tenorKey(x[1])===tk);
    if(m)return candidate(numberRate(m[2]),src,'Prime Fixed Deposit Plus, first amount band');
    return missingTenor(src,'Prime Fixed Deposit Plus does not list this specific number of days in the official sheet.');
   }
  }
  if(p.id==='monthly-benefit'){
   const row=lines.find(x=>/Prime Monthly Income Scheme \(PMIS\)/i.test(x));
   const map={m12:0,m36:1,m60:2},idx=map[tk];
   if(row){
    const rates=[...row.matchAll(/(\d+(?:\.\d+)?)%/g)].map(v=>Number(v[1]));
    if(idx!==undefined)return candidate(rates[idx]??null,src,'Prime PMIS: 12, 36, 60 month rates');
    return missingTenor(src,'Prime PMIS has no rate for this requested MTB tenor.');
   }
  }
  if(p.id==='double-saver'){
   const row=lines.find(x=>/^Double Benefit Deposit Scheme/i.test(x));
   if(row&&/Double in\s+7Y\s+11M/i.test(row))return missingTenor(src,'Prime Double Benefit rate corresponds to 7 years 11 months, not MTB 8 years 7 months.');
  }
  const mapping={
   'brick-by-brick':'Prime Deposit Premium Scheme',
   'millionaire':'Prime Millionaire Scheme (PMS)',
   'kotipati':'Prime Kotipoti DPS',
   'lakhopoti':'Lakhopati Deposit Scheme (LDS)',
   'education-plan':'Prime Edu DPS',
   'junior-flexi':'Prime Edu DPS'
  };
  const name=mapping[p.id];
  if(name){
   const rates=primeRow(lines,name);
   if(rates){
    const idx=[36,48,60,84,120,144,180,240].indexOf(Number(tk.startsWith('m')?tk.slice(1):-1));
    if(idx<0)return missingTenor(src,'Prime scheme does not list the requested MTB tenor.');
    if(rates[idx]===null)return missingTenor(src,'Prime scheme rate sheet explicitly marks this tenor unavailable.');
    return candidate(rates[idx],src,'Official Prime consumer recurring deposit scheme rate');
   }
  }
 }
 return null;
}

export function deriveRate(src,product,bank,tenor,asOf){
 if(!src||src.status==='access_blocked'||src.status==='unavailable')return null;
 if(src.id==='MTB')return parseMTB(src,product,tenor,asOf);
 if((src.status==='pdf_extracted'||src.status==='pdf_extracted_fallback')&&src.documentDate<=asOf)return parsePDF(src,product,tenor);
 return null;
}
