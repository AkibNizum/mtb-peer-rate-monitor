// PDF-only table reader. No website lookups, no date or issuer verification.
// Product and tenor must both be evidenced; ambiguous amount tiers stay unresolved.
const clean=s=>String(s??'').replace(/[\u00a0\t]+/g,' ').replace(/\s+/g,' ').trim();
const norm=s=>clean(s).toLowerCase().replace(/[’‘]/g,"'").replace(/[^a-z0-9]+/g,' ').trim();
const rateFormat=/^(?:\d{1,2}(?:\.\d{1,3})?)\s*%?$/;
const tenorRe=/\b(\d{1,3})\s*(years?|yrs?|yr|y|months?|mons?|mos?|mo|m|days?|d)\b/gi;
const comboRe=/\b(\d{1,2})\s*(?:years?|yrs?|yr|y)\s*(\d{1,2})\s*(?:months?|mons?|mos?|mo|m)\b/i;
function key(s){
 const st=clean(s).toLowerCase();const c=st.match(comboRe);
 if(c)return 'm'+(12*Number(c[1])+Number(c[2]));
 const m=st.match(/\b(\d{1,3})\s*(years?|yrs?|yr|y|months?|mons?|mos?|mo|m|days?|d)\b/i);
 if(!m)return '';
 const n=Number(m[1]),u=m[2];return u.startsWith('y')?'m'+n*12:u.startsWith('m')?'m'+n:'d'+n;
}
function num(raw){const s=String(raw||'').replace('%','').trim();if(!/^\d{1,2}(?:\.\d{1,3})?$/.test(s))return null;const n=Number(s);return n>=0&&n<=30?n:null;}
function values(s,allowBare=true){
 const text=clean(s);
 const percentages=[...text.matchAll(/(?<![\d.])(\d{1,2}(?:\.\d{1,3})?)\s*%/g)].map(v=>num(v[1])).filter(v=>v!==null);
 if(percentages.length)return percentages;
 if(!allowBare||/\b(?:tk\.?|bdt|lac|lakh|crore|cr\.?|million|taka|amount)\b/i.test(text))return [];
 return [...text.matchAll(/(?<![\d.,])(\d{1,2}\.\d{1,3})(?![\d.,])/g)].map(v=>num(v[1])).filter(v=>v!==null);
}
function matrixTokens(s){
 const raw=clean(s);if(/\b(?:tk\.?|bdt|crore|lakh|lac)\b/i.test(raw))return [];
 const list=[];for(const m of raw.matchAll(/(?<![\d.])\d{1,2}(?:\.\d{1,3})?\s*%|(?<![\d.])\d{1,2}\.\d{1,3}(?![\d.,])|(?<!\S)[–-](?!\S)/g)){
   const n=num(m[0]);list.push(n===null?null:n);
 }
 return list;
}
const EXTRAS={
 MTB:{'fixed-deposit':['mtb fixed deposit retail customer','interest rates on mtb fixed deposit'],
  'fdr-days':['mtb fdr in days','fdr in days'],
  'monthly-benefit':['mtb monthly benefit plan'],
  'quarterly-benefit':['mtb quarterly benefit plan'],
  'education-plan':['mtb education plan'], 'junior-flexi':['mtb junior flexi dps']},
 PRIME:{'monthly-benefit':['prime monthly income scheme pmis','prime monthly income scheme'],
  'fdr-days':['prime fixed deposit plus'],'fixed-deposit':['prime fixed deposit'],
  'kotipati':['prime kotipoti dps'], 'millionaire':['prime millionaire scheme pms'],
  'brick-by-brick':['prime deposit premium scheme'],'lakhopoti':['lakhopati deposit scheme lds'],
  'education-plan':['prime edu dps'],'junior-flexi':['prime edu dps']},
 UCB:{'fixed-deposit':['retail fixed deposit individual'],
  'education-plan':["ucb youngsters dps","retail ucb youngsters dps"],
  'junior-flexi':["ucb youngsters dps","retail ucb youngsters dps"],
  'brick-by-brick':['ucb super flex regular deposit scheme'],
  'angona-dps':['ucb ayma super flex deposit scheme']},
 EBL:{'angona-dps':['ebl women confidence','ebl women-confidence'],
  'education-plan':['ebl child future plan'],'junior-flexi':['ebl child future plan']}
};
function aliases(bank,product){
 const basic=bank==='MTB'?[product.name]:(product.peers?.[bank]||'').split(/;|\s+\|\s+/);
 const add=EXTRAS[bank]?.[product.id]||[];
 const listed=[...basic,...add].map(norm).filter(x=>x&&x!=='n a'&&x.length>=5);
 return [...new Set(listed)];
}
function matchesAlias(line,alias){const v=' '+norm(line)+' ';return v.includes(' '+alias+' ');}
function competingLabels(line){return /\b(?:deposit|dps|saving|savings|scheme|benefit|fdr|account|flexi|kotipoti|millionaire|lakhopati)\b/i.test(line)
 && /(?:^\s*[a-z]|\b(?:mtb|prime|ucb|ebl|retail|brac|city|dhaka)\b)/i.test(line)
 && !/\b(?:amount|rate sheet|interest rate|tenor of|rate of|below tk|above tk)\b/i.test(line);}
function lineLabels(line,products,bank){
 const found=[];
 for(const p of products)for(const alias of aliases(bank,p)){
  if(matchesAlias(line,alias)){if(bank==='UCB'&&p.id==='brick-by-brick'&&/senior citizens|ayma/i.test(line))continue;found.push({p,alias,score:alias.length});}
 }
 if(!found.length)return [];
 const max=Math.max(...found.map(x=>x.score));
 return found.filter(x=>x.score===max).map(x=>x.p.id);
}
function isSectionBreak(line){return /^(?:consumer banking|corporate banking|sme banking|current account|casa products|list of discontinued|not continuing|business unit:|page\s+\d+\s+of\s+\d+|\d+\s*\|\s*page)$/i.test(clean(line));}
function extractPairs(line){
 const parts=[];const matches=[...line.matchAll(tenorRe)];
 if(!matches.length)return parts;
 for(let i=0;i<matches.length;i++){
  const m=matches[i],k=key(m[0]);if(!k)continue;
  const limit=i+1<matches.length?matches[i+1].index:line.length;
  const suffix=line.slice(m.index+m[0].length,limit);
  const rates=values(suffix,true);if(!rates.length)continue;
  const unique=[...new Set(rates.map(x=>x.toFixed(3)))];
  parts.push({tenor:k,rate:unique.length===1?rates[0]:null,conflict:unique.length>1,
   note:unique.length>1?'Multiple rates or deposit-size brackets':'Tenor and rate on same PDF row'});
 }
 return parts;
}
function matrixHeaders(line){
 const matches=[...line.matchAll(tenorRe)].map(m=>key(m[0])).filter(Boolean);
 if(matches.length<3||matches.length>24)return [];
 if(!/\b(?:product|tenor|tenure|months|year|time frame|duration)\b/i.test(line)&&matches.length<5)return [];
 return matches;
}
function isOnlyRateTokens(line){const s=clean(line);return !!s&&/^(?:[\d.%–\-\s]+)$/.test(s)&&matrixTokens(s).length>0;}
function segments(text){const src=String(text||'');return src.split(/\f|\n\s*--- PDF page \d+ ---\s*\n/).flatMap(t=>t.split(/\n\s*Page\s+\d+\s+of\s+\d+\s*\n/i)).filter(x=>x.trim());}
export function analyzeUploadedPDFs(uploads,products,banks){
 const bankMap=Object.fromEntries(banks.map(b=>[b.id,b]));
 const candidates=[],warnings=[],stats=[];
 for(const up of uploads){
  const bank=bankMap[up.bankId];if(!bank)continue;
  const uniquePerPDF=new Set(),pageParts=segments(up.text);
  let seenLines=0,claimed=0;
  const record=(p,tenor,rate,context,method,page)=>{
   if(!p?.tenors?.some(t=>key(t)===tenor)||!Number.isFinite(rate)||rate<0||rate>30)return;
   const id=[up.bankId,p.id,tenor,rate.toFixed(3),page,method].join('|');
   if(uniquePerPDF.has(id))return;uniquePerPDF.add(id);
   candidates.push({key:p.id+'|'+p.tenors.find(t=>key(t)===tenor)+'|'+up.bankId,
    bankId:up.bankId,productId:p.id,tenor:p.tenors.find(t=>key(t)===tenor),rate,
    sourceName:up.name,method,page,evidence:clean(context).slice(0,240)});claimed++;
  };
  for(let page=0;page<pageParts.length;page++){
   const lines=pageParts[page].split(/\r?\n/).map(clean).filter(Boolean);
   seenLines+=lines.length;
   let active=[],lastAt=-100,headers=[];
   for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(isSectionBreak(line)){active=[];headers=[];lastAt=-100;continue}
    const hits=lineLabels(line,products,up.bankId);
    if(hits.length){active=hits;lastAt=i}
    else if(competingLabels(line)){active=[];lastAt=-100}
    const header=matrixHeaders(line);
    if(header.length){headers=header;continue}
    if(!active.length||i-lastAt>24)continue;
    // Product/tenor rows; reject differing multiple amount brackets rather than choosing one.
    for(const pair of extractPairs(line)){
     if(pair.rate===null){warnings.push({bankId:up.bankId,sourceName:up.name,issue:'Different rates in one row; amount bracket required',evidence:line.slice(0,165)});continue}
     for(const pid of active){const p=products.find(p=>p.id===pid);record(p,pair.tenor,pair.rate,line,pair.note,page+1)}
    }
    // Standard DPS matrix: a header of months/years, followed by a product rate vector.
    if(hits.length&&headers.length){
     const longest=hits.map(pid=>({pid,al:aliases(up.bankId,products.find(x=>x.id===pid)).sort((a,b)=>b.length-a.length)[0]||''}));
     const label=longest.sort((a,b)=>b.al.length-a.al.length)[0];
     const n=norm(line),cut=label.al?n.indexOf(label.al):-1;
     const after=cut>=0?line.slice(line.toLowerCase().indexOf(label.al)+label.al.length):line;
     let toks=matrixTokens(after);
     for(let ahead=1;ahead<=2&&toks.length<headers.length&&i+ahead<lines.length;ahead++){
      if(!isOnlyRateTokens(lines[i+ahead]))break;
      toks=toks.concat(matrixTokens(lines[i+ahead]));
     }
     if(toks.length===headers.length){
      for(const pid of hits){const p=products.find(p=>p.id===pid);headers.forEach((t,j)=>{if(toks[j]!==null)record(p,t,toks[j],line,'Tenor-column rate matrix',page+1)})}
     }
    }
   }
  }
  stats.push({bankId:up.bankId,name:up.name,characters:up.text?.length||0,pages:pageParts.length,lines:seenLines,matchedCandidates:claimed});
  if(!claimed)warnings.push({bankId:up.bankId,sourceName:up.name,issue:!up.text?.trim()?'PDF has no extractable text':'No unique MTB product/tenor rate could be matched automatically; review extracted text or enter rates manually'});
 }
 return {candidates,warnings,stats};
}
export const canonicalTenor=key;