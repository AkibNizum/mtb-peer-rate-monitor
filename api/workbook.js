import ExcelJS from 'exceljs';
import {products,banks} from './catalog.js';

// Excel is the canonical intermediate artifact: PDF -> Rates.xlsx -> original PPT.
// Never read or write Proposed Rate; it is intentionally left blank.
const headers=['Bank ID','Bank Name','Product ID','Type','MTB Product','MTB Tenor','Peer Product','Current Rate (%)','Extraction Status','Source PDF','Evidence / Notes','Proposed Rate'];
const statusName=s=>s==='verified'?'Matched':s==='uploaded_reviewed'?'Manual':s==='review'?'Needs review':s==='product_na'?'N/A':'Missing';
const recordKey=r=>[String(r.bankId||''),String(r.productId||''),String(r.tenor||'')].join('|');
const canonical=new Map(products.flatMap(p=>p.tenors.flatMap(tenor=>banks.map(b=>{
 const peer=b.id==='MTB'?p.name:p.peers[b.id]||'N/A';
 return [recordKey({bankId:b.id,productId:p.id,tenor}),{
  bankId:b.id,category:p.type,productId:p.id,product:p.name,tenor,
  peerProduct:peer,rate:null,status:peer==='N/A'?'product_na':'pdf_missing',
  evidence:'',note:'No rate matched in uploaded PDFs',sourceUrl:'',proposedRate:null
 }];
}))));
const validRate=value=>{
 if(value===null||value===undefined||String(value).trim()===''||value==='-')return null;
 const n=Number(String(value).replace(/%/g,'').trim());
 return Number.isFinite(n)&&n>=0&&n<=30?n:null;
};
const textValue=v=>typeof v==='object'&&v&&'text' in v?v.text:v==null?'':String(v);
const fillFor=s=>s==='Matched'||s==='Manual'?'EAF6EF':s==='Needs review'?'FFF1D8':s==='N/A'?'F0F1F0':'FFF8EA';
const seedRecords=rows=>{
 const map=new Map((rows||[]).map(r=>[recordKey(r),r]));
 return [...canonical.entries()].map(([key,template])=>{
  const r=map.get(key)||{};
  const allowed=template.peerProduct!=='N/A',rate=allowed?validRate(r.rate):null;
  const status=allowed?(rate!==null?(r.status==='uploaded_reviewed'?'uploaded_reviewed':'verified'):r.status==='review'?'review':'pdf_missing'):'product_na';
  return {...template,...r,bankId:template.bankId,productId:template.productId,
   product:template.product,category:template.category,tenor:template.tenor,
   peerProduct:template.peerProduct,status,rate,proposedRate:null};
 });
};
export async function buildRateWorkbook({records=[],sources=[],asOf=''}) {
 const wb=new ExcelJS.Workbook();wb.creator='MTB Peer Bank Rate Tool';wb.created=new Date();
 wb.title='MTB ALCO Deposit Rate Review';wb.subject='PDF-extracted rates only';
 const main=wb.addWorksheet('Rates',{views:[{state:'frozen',ySplit:1}]});
 main.columns=[
  {header:headers[0],key:'bankId',width:12},
  {header:headers[1],key:'name',width:23},
  {header:headers[2],key:'productId',width:22},
  {header:headers[3],key:'category',width:11},
  {header:headers[4],key:'product',width:31},
  {header:headers[5],key:'tenor',width:18},
  {header:headers[6],key:'peer',width:38},
  {header:headers[7],key:'rate',width:20},
  {header:headers[8],key:'status',width:19},
  {header:headers[9],key:'source',width:37},
  {header:headers[10],key:'evidence',width:65},
  {header:headers[11],key:'proposed',width:22}
 ];
 const bankName=Object.fromEntries(banks.map(b=>[b.id,b.name]));
 const canonicalRecords=seedRecords(records);
 for(const record of canonicalRecords){
  const status=statusName(record.status);
  const row=main.addRow({
   bankId:record.bankId,name:bankName[record.bankId]||record.bankId,
   productId:record.productId,category:record.category,product:record.product,
   tenor:record.tenor,peer:record.peerProduct,
   rate:record.rate===null?'':record.rate,status,
   source:record.sourceUrl||'',evidence:record.evidence||record.note||'',proposed:''
  });
  row.height=20;
  row.getCell(8).numFmt='0.00';
  row.getCell(8).alignment={horizontal:'center'};
  row.getCell(8).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+fillFor(status)}};
  row.getCell(9).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF'+fillFor(status)}};
  row.getCell(12).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FFF0F1F0'}};
 }
 const header=main.getRow(1);header.height=34;
 header.eachCell(cell=>{cell.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF155D50'}};
  cell.font={bold:true,color:{argb:'FFFFFFFF'},size:10};cell.alignment={vertical:'middle',wrapText:true};});
 main.autoFilter={from:'A1',to:'L'+(canonicalRecords.length+1)};
 main.getColumn(10).alignment={wrapText:false};main.getColumn(11).alignment={wrapText:false};
 // Column L stays empty even if a user pastes a proposed rate; the PPT ignores it.
 const instructions=wb.addWorksheet('Instructions');
 instructions.getColumn(1).width=100;
 [
  'MTB ALCO — PDF → Excel → original PowerPoint',
  'This workbook is produced from the bank PDFs you uploaded; bank websites are never searched.',
  'Check the Rates sheet. Missing or ambiguous data is blank and will become a dash (-) in the PPT.',
  'To correct a value, edit ONLY column H (Current Rate %). Example: type 8.25, not 0.0825.',
  'Do not change Bank ID, Product ID or MTB Tenor columns. They identify the original PowerPoint cell.',
  'Column L (Proposed Rate) is deliberately blank. Any entered value in column L is ignored.',
  'To use your corrections, return to the website, select this workbook, then generate the PowerPoint.',
  'A matching product and tenor do not establish an amount bracket. Check bracket-based rates manually.',
  'Presentation date: '+asOf,
  'Original slide formatting is preserved; no report is stored on the website.'
 ].forEach((line,i)=>{const cell=instructions.getCell(i+1,1);cell.value=line;
  cell.font={size:i===0?16:11,bold:i===0,color:{argb:'FF22483C'}};
  instructions.getRow(i+1).height=i===0?36:25;});
 const sourceSheet=wb.addWorksheet('PDF Sources');
 sourceSheet.columns=[{header:'Bank',width:25},{header:'PDF filename',width:55},{header:'Readability',width:21},{header:'Characters',width:15},{header:'Pages',width:10}];
 for(const bank of sources){
  const files=Array.isArray(bank.uploadedDocuments)?bank.uploadedDocuments:[];
  for(const f of files)sourceSheet.addRow([bank.name||bank.id,f.name||'',f.readable?'Selectable text':'No readable text',f.characters||0,f.pages||0]);
 }
 sourceSheet.getRow(1).eachCell(c=>{c.font={color:{argb:'FFFFFFFF'},bold:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF155D50'}}});
 return Buffer.from(await wb.xlsx.writeBuffer());
}
export async function readRateWorkbook(data){
 const buffer=Buffer.isBuffer(data)?data:Buffer.from(data);
 if(buffer.length>6_000_000)throw Error('Rate workbook exceeds 6MB');
 const wb=new ExcelJS.Workbook();
 await wb.xlsx.load(buffer);
 const ws=wb.getWorksheet('Rates');if(!ws)throw Error('Workbook must have a Rates worksheet');
 const found=new Map();
 for(let i=2;i<=Math.min(ws.rowCount,1500);i++){
  const row=ws.getRow(i),bankId=textValue(row.getCell(1).value).trim(),
   productId=textValue(row.getCell(3).value).trim(),tenor=textValue(row.getCell(6).value).trim();
  const key=recordKey({bankId,productId,tenor}),template=canonical.get(key);
  if(!template)continue;
  const rate=template.peerProduct==='N/A'?null:validRate(row.getCell(8).value);
  const status=template.peerProduct==='N/A'?'product_na':rate===null?'pdf_missing':'uploaded_reviewed';
  found.set(key,{...template,rate,status,sourceUrl:textValue(row.getCell(10).value),
   evidence:textValue(row.getCell(11).value),note:'Rate from Excel intermediate workbook',proposedRate:null});
 }
 if(found.size<50)throw Error('Workbook contains too few recognized MTB product/tenor cells');
 const records=seedRecords([...found.values()]);
 return {records,matched:records.filter(x=>x.rate!==null&&x.status!=='product_na').length,total:records.length};
}