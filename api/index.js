import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import {banks,products} from './catalog.js';
import {deriveRate} from './extractor.js';
import {analyzeUploadedPDFs} from './pdf-matcher.js';
import {generateExactReports} from './exact-template.js';

export const config={api:{bodyParser:false}};
const LIMIT=3_100_000;
const error=(message,status=422)=>Object.assign(new Error(message),{status});
function todayDhaka(){
 const p=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Dhaka',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
 const value=x=>p.find(z=>z.type===x)?.value||'';
 return value('year')+'-'+value('month')+'-'+value('day');
}
async function rawRequest(req,max=LIMIT){
 let size=0,chunks=[];
 for await(const part of req){size+=part.length;if(size>max)throw error('Request exceeds the 3 MB limit. Split a large PDF or compress it.',413);chunks.push(part)}
 return Buffer.concat(chunks);
}
function quoteJSON(data){try{return JSON.parse(data.toString('utf8')||'{}')}catch{throw error('Could not read the submitted data')}}
async function extractPDF(req,res){
 const kind=String(req.headers['content-type']||'').split(';')[0].trim();
 if(kind!=='application/pdf')throw error('Upload a PDF document, not an image');
 const file=await rawRequest(req,MAX_REQUEST);
 if(file.length<5||file.subarray(0,4).toString()!=='%PDF')throw error('The selected file is not a readable PDF');
 let plain=null,layout=null,plainIssue='',layoutIssue='';
 try{plain=await pdfParse(file)}catch(e){plainIssue=String(e.message||e).slice(0,160)}
 // Rebuild lines from PDF text coordinates; this preserves product/tenor/rate
 // rows in many fixed-column bank rate tables that plain extraction flattens.
 try{
  const render=async page=>{
   const content=await page.getTextContent({normalizeWhitespace:true,disableCombineTextItems:false});
   const positioned=(content.items||[]).map(x=>({str:String(x.str||'').trim(),x:Number(x.transform?.[4]||0),
    y:Number(x.transform?.[5]||0),width:Number(x.width||0),h:Math.abs(Number(x.height||7))})).filter(x=>x.str);
   positioned.sort((a,b)=>b.y-a.y||a.x-b.x);
   const groups=[];
   for(const item of positioned){
    const last=groups.at(-1);
    if(last&&Math.abs(last.y-item.y)<=Math.min(3.5,Math.max(2,item.h*.35)))last.parts.push(item);
    else groups.push({y:item.y,parts:[item]});
   }
   return groups.map(g=>{
    const ordered=g.parts.sort((a,b)=>a.x-b.x);let line='',right=0;
    for(const token of ordered){
     if(line){const gap=token.x-right;line+=gap>8?'  ':' '}
     line+=token.str;right=Math.max(right,token.x+token.width);
    }
    return line;
   }).join('\n');
  };
  layout=await pdfParse(file,{pagerender:render});
 }catch(e){layoutIssue=String(e.message||e).slice(0,160)}
 const text=String(plain?.text||'').slice(0,155000),layoutText=String(layout?.text||'').slice(0,155000);
 const pages=plain?.numpages||layout?.numpages||0;
 const readable=!!text.trim()||!!layoutText.trim();
 return res.status(200).json({text,layoutText,pages,readable,
  notice:readable?'Selectable text found. Rate tables will be matched by product and tenor.':
   'No selectable text was found. This may be a scanned PDF; convert it using Screenshot → Searchable PDF, or use OCR.',
  warnings:[plainIssue,layoutIssue].filter(Boolean)});
}

function uploadedSource(bank,uploads){
 const docs=uploads.filter(u=>u.bankId===bank.id);
 const accepted=docs.filter(u=>String(u.text||u.layoutText||'').trim());
 const raw=accepted.map(u=>String(u.text||u.layoutText||'')).join('\n\f\n').slice(0,240000);
 return {id:bank.id,name:bank.name,sourceType:'User-uploaded PDF',status:docs.length?accepted.length?'uploaded_pdf':'pdf_unreadable':'pdf_not_supplied',
  text:raw,documentDate:'',effectiveDate:'',publishedDate:'',documentUrl:'',url:'',
  note:!docs.length?'No PDF attached to this bank':!accepted.length?'PDF attached but contains no selectable text; scanned PDF needs OCR':'PDF accepted without website or date verification',
  uploadedDocuments:docs.map(u=>({name:u.name,readable:!!String(u.text||u.layoutText||'').trim(),
   characters:String(u.text||'').length,layoutCharacters:String(u.layoutText||'').length,pages:Number(u.pages||0),
   extractionNotice:String(u.notice||'').slice(0,160)}))};
}
function pdfOnlyRows(sources,asOf){
 const lookup=Object.fromEntries(sources.map(s=>[s.id,s])),records=[];
 for(const product of products)for(const tenor of product.tenors)for(const bank of banks){
  const src=lookup[bank.id],peer=bank.id==='MTB'?product.name:product.peers[bank.id]||'N/A';
  // Bank-specific parsers supplement the generic table reader, but never use web rates.
  const found=peer==='N/A'||!src?.text?null:deriveRate({...src,status:'uploaded_pdf'},product,bank,tenor,asOf);
  const rate=found?.rate===null||found?.rate===undefined?null:Number(found.rate);
  const ok=Number.isFinite(rate)&&rate>=0&&rate<=30;
  records.push({category:product.type,productId:product.id,product:product.name,tenor,bankId:bank.id,
   peerProduct:peer,rate:ok?rate:null,status:peer==='N/A'?'product_na':ok?'verified':'pdf_missing',
   note:ok?String(found.note||'Rate identified in supplied PDF'):'No unambiguous matching rate in supplied PDF',
   evidence:ok?String(found.note||'Bank-specific PDF parser'):'',
   sourceUrl:src?.uploadedDocuments?.map(x=>x.name).join('; ')||'No PDF supplied',
   effectiveDate:'',proposedRate:null});
 }
 return records;
}
function completePDFReview(uploads,asOf){
 const sources=banks.map(b=>uploadedSource(b,uploads)),rows=pdfOnlyRows(sources,asOf);
 // Read both original PDF text and coordinate-restored rows if available.
 const datasets=[...uploads,...uploads.filter(u=>String(u.layoutText||'').trim()).map(u=>({
  bankId:u.bankId,name:u.name+' (table layout)',text:u.layoutText
 }))];
 const evidence=analyzeUploadedPDFs(datasets,products,banks);
 const byKey=new Map(rows.map(r=>[r.productId+'|'+r.tenor+'|'+r.bankId,r]));
 const grouped=new Map();
 for(const c of evidence.candidates){
  if(!grouped.has(c.key))grouped.set(c.key,[]);
  grouped.get(c.key).push(c);
 }
 let added=0,ambiguous=0;
 for(const [k,list] of grouped){
  const row=byKey.get(k);if(!row||row.peerProduct==='N/A')continue;
  const possible=new Set(list.map(c=>Number(c.rate).toFixed(3)));
  if(row.status==='verified')possible.add(Number(row.rate).toFixed(3));
  if(possible.size>1){
   row.rate=null;row.status='review';row.note='Conflicting rates or deposit amount brackets; select the correct rate from the PDF';
   row.evidence=list.slice(0,4).map(c=>c.evidence).join(' | ').slice(0,350);
   row.choices=[...possible].map(Number);ambiguous++;
  }else if(possible.size===1&&row.status!=='verified'){
   const picked=list[0];row.rate=picked.rate;row.status='verified';
   row.note=picked.method+' · '+picked.sourceName+' · page '+picked.page;
   row.evidence=picked.evidence;row.sourceUrl=picked.sourceName;added++;
  }
 }
 const totals={verified:rows.filter(r=>r.status==='verified').length,
  missing:rows.filter(r=>r.status==='pdf_missing'&&r.peerProduct!=='N/A').length,
  notComparable:rows.filter(r=>r.status==='product_na').length,
  ambiguous:rows.filter(r=>r.status==='review').length,
  uploadedFiles:uploads.length,genericMatched:added};
 const byBank=banks.map(b=>{
  const records=rows.filter(r=>r.bankId===b.id),docs=uploads.filter(u=>u.bankId===b.id);
  return {bankId:b.id,name:b.name,uploaded:docs.length,characters:docs.reduce((sum,u)=>sum+String(u.text||u.layoutText||'').length,0),
   pages:docs.reduce((sum,u)=>sum+Number(u.pages||0),0),
   matched:records.filter(r=>r.status==='verified').length,
   missing:records.filter(r=>r.status==='pdf_missing'&&r.peerProduct!=='N/A').length,
   ambiguous:records.filter(r=>r.status==='review').length,
   preview:docs.map(u=>String(u.text||u.layoutText||'').slice(0,3500)).join('\n\n').slice(0,6500),
   files:docs.map(u=>u.name),issues:evidence.warnings.filter(w=>w.bankId===b.id).slice(0,5)};
 });
 const errors=evidence.warnings.slice(0,60);
 // Report review should not send hundreds of KB of full PDF text back to the browser.
 const safeSources=sources.map(({text,...source})=>({...source,textLength:text.length}));
 return {asOf,rows,sources:safeSources,stats:totals,byBank,issues:errors,
  diagnostics:evidence.stats.slice(0,36),sourcePolicy:'uploaded-PDFs-only-no-website-or-date-check',stateless:true};
}
async function analyzeReport(req,res){
 const input=quoteJSON(await rawRequest(req,3_100_000)),asOf=String(input.asOf||todayDhaka());
 if(!/^\d{4}-\d{2}-\d{2}$/.test(asOf))throw error('Enter a valid presentation date');
 const uploads=Array.isArray(input.uploads)?input.uploads.slice(0,26).map(x=>({
  bankId:String(x.bankId||'').slice(0,25),name:String(x.name||'').slice(0,110),
  text:String(x.text||'').slice(0,160000),layoutText:String(x.layoutText||'').slice(0,160000),
  pages:Math.min(200,Math.max(0,Number(x.pages)||0)),notice:String(x.notice||'').slice(0,200)
 })).filter(x=>banks.some(b=>b.id===x.bankId)&&/\.pdf$/i.test(x.name)) : [];
 const result=completePDFReview(uploads,asOf);
 return res.status(200).json(result);
}
async function downloadExact(req,res){
 const input=quoteJSON(await rawRequest(req,LIMIT));
 const date=String(input.asOf||'');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw error('Invalid presentation date');
 if(!Array.isArray(input.records)||input.records.length<50)throw error('Click Read PDFs before generating the report');
 const data=await generateExactReports(input);
 res.status(200).setHeader('Content-Type','application/zip');
 res.setHeader('Content-Disposition','attachment; filename="MTB_ALCO_Peer_Rates_'+date+'.zip"');
 res.setHeader('Content-Length',data.length);
 return res.end(data);
}
export default async function handler(req,res){
 res.setHeader('Cache-Control','no-store');
 try{
  const action=String(req.query?.action||'health');
  if(action==='health')return res.status(200).json({ok:true,version:'4.1',public:true,sourcePolicy:'uploaded-PDFs-only',dateVerification:false,savedReports:false});
  if(action==='extract'&&req.method==='POST')return await extractPDF(req,res);
  if(action==='review'&&req.method==='POST')return await analyzeReport(req,res);
  if(action==='ppt-exact'&&req.method==='POST')return await downloadExact(req,res);
  return res.status(404).json({error:'Supported actions: extract, review, ppt-exact. No website scraping or report storage.'});
 }catch(e){
  console.error('ALCO tool error:',String(e.message||e));
  if(!res.headersSent)return res.status(e.status||500).json({error:String(e.message||e)});
 }
}