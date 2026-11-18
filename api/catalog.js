// MTB-first comparison catalog. Peer products are proposed comparators, NOT verified rates.
export const banks=[
{id:"MTB",name:"Mutual Trust Bank",domain:"mutualtrustbank.com",url:"https://www.mutualtrustbank.com/interest-rates/"},
{id:"EBL",name:"Eastern Bank",domain:"ebl.com.bd",url:"https://www.ebl.com.bd/interest-rates"},
{id:"PRIME",name:"Prime Bank",domain:"primebank.com.bd",url:"https://www.primebank.com.bd/conventional-rates"},
{id:"BRAC",name:"BRAC Bank",domain:"bracbank.com",url:"https://www.bracbank.com/en/page/deposit-interest-rate"},
{id:"DHAKA",name:"Dhaka Bank",domain:"dhakabank.com.bd",url:"https://dhakabank.com.bd/rates-and-charges/"},
{id:"CITY",name:"City Bank",domain:"citybankplc.com",url:"https://www.citybankplc.com/gsi/conventional-banking-products"},
{id:"UCB",name:"United Commercial Bank",domain:"ucb.com.bd",url:"https://www.ucb.com.bd/rates/interest-rates/"}
];
const peerIds=banks.slice(1).map(x=>x.id);
function item(id,type,name,tenors,peers){
 return {id,type,name,tenors:tenors.split("|"),peers:Object.fromEntries(peerIds.map((key,i)=>[key,peers[i]]))};
}
export const products=[
item("monthly-benefit","FDR","MTB Monthly Benefit Plan","1 Year|2 Years|3 Years",
 ["EBL Repeat","Prime Monthly Income Scheme","Abiram Fixed Deposit","Special Deposit Scheme","Monthly Interest Paying FD","UCB Earning Plus Fixed Deposit"]),
item("quarterly-benefit","FDR","MTB Quarterly Benefit Plan","1 Year|2 Years|3 Years",
 ["N/A","N/A","BRAC Bank Freedom Fixed Deposit (FRFRD)","N/A","N/A","UCB Earning Plus Fixed Deposit (UEPFD)"]),
item("fdr-days","FDR","MTB FDR in Days","91 Days|100 Days|122 Days|181 Days|210 Days|270 Days|365 Days",
 ["Fixed Deposit","Prime Fixed Deposit Plus","Fixed Deposit General","Special Fixed Deposit","Fixed Deposit","Fixed Deposit Receipt (FDR)"]),
item("fixed-deposit","FDR","MTB Fixed Deposit","1 Month|2 Months|3 Months|6 Months|9 Months|1 Year|2 Years|3 Years",
 ["Fixed Deposit","Prime Fixed Deposit","Fixed Deposit General","Fixed Deposit Receipt","FD","Retail Fixed Deposit (Individual)"]),
item("double-saver","FDR","MTB Double Saver","8 Years 7 Months",
 ["N/A","Double Benefit Deposit Scheme","N/A","Deposit Double Scheme","N/A","UCB Money Maximizer Double"]),
item("brick-by-brick","DPS","MTB Brick by Brick","1 Year|2 Years|3 Years|5 Years|8 Years|10 Years",
 ["EBL Confidence","Prime Deposit Premium Scheme","Deposit Premium Scheme (Personal & SME)","Deposit Pension Scheme","Insurance Backed DPS; Goal Based DPS","UCB Super Flex"]),
item("angona-dps","DPS","MTB Angona DPS","1 Year|2 Years|3 Years|5 Years|8 Years|10 Years",
 ["EBL Women-Confidence","Shuchona-NEERA Education Savings Scheme (discontinued)","Personal-TARA","Aroni Deposit Pension Scheme","Insurance Backed DPS (ALO); Goal Based DPS (ALO)","UCB AYMA Super Flex"]),
item("lakhopoti","DPS","MTB Lakhopoti Plan","12 Months|18 Months|24 Months|36 Months",
 ["N/A","Lakhopoti Deposit Scheme","N/A","Lakhopoti Deposit Scheme","N/A","N/A"]),
item("kotipati","DPS","MTB Kotipati Plan","4 Years|5 Years|6 Years|8 Years|10 Years|12 Years|15 Years|18 Years|20 Years",
 ["EBL Kotipoti Scheme","Kotipoti Deposit Scheme","N/A","Kotipoti Deposit Plan","N/A","N/A"]),
item("millionaire","DPS","MTB Millionaire Plan","4 Years|6 Years|8 Years|10 Years|12 Years|15 Years|20 Years",
 ["EBL Millionaire; EBL Women Millionaire DPS","Prime Millionaire","N/A","N/A","N/A","UCB Multi-Millionaire One Million"]),
item("education-plan","DPS","MTB Education Plan","4 Years|7 Years|9 Years|12 Years",
 ["EBL Child Future; EBL Aspire","Prime Edu DPS","Future Star Savings; Future Star Savings-TARA","Edu Savings Plan","N/A","UCB Youngsters' DPS"]),
item("junior-flexi","DPS","MTB Junior Flexi DPS","4 Years",
 ["EBL Child Future; EBL Aspire","Prime Edu DPS","Future Star Savings; AGAMI SAVERS","Edu Savings Plan","N/A","UCB Youngsters' DPS"])
];
