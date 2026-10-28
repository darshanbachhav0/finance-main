const date=s=>/^\d{4}-\d{2}-\d{2}$/.test(String(s||''))&&new Date(`${s}T12:00:00Z`).toISOString().slice(0,10)===s;
const round=n=>Math.round(Number(n)*100)/100;
export function validateInvestment(input){
 const principal=Number(input.principal),annualRate=Number(input.annualRate),start=input.startDate,end=input.maturityDate;
 const institution=String(input.institution||'').trim(),currency=String(input.currency||'').toUpperCase();
 if(!institution||institution.length>180||!['PEN','USD'].includes(currency)||!Number.isFinite(principal)||principal<=0||!Number.isFinite(annualRate)||annualRate<0||annualRate>100||!date(start)||!date(end))throw Error('Institución, moneda, capital, tasa y fechas válidas son obligatorios.');
 const days=Math.round((new Date(`${end}T12:00:00Z`)-new Date(`${start}T12:00:00Z`))/86400000);
 if(days<1||days>360)throw Error('Las inversiones a plazo deben durar entre 1 y 360 días.');
 return {institution,currency,principal:round(principal),annualRate, startDate:new Date(`${start}T12:00:00Z`),maturityDate:new Date(`${end}T12:00:00Z`),days,estimatedInterest:round(principal*annualRate/100*days/360)};
}
export function concentrationAfter(portfolio,newInvestment){
 const all=[...portfolio,newInvestment].filter(i=>i.currency===newInvestment.currency&&i.status!=='CANCELLED');
 const total=all.reduce((sum,i)=>sum+i.principal,0);
 const institutionAmount=all.filter(i=>i.institution.toUpperCase()===newInvestment.institution.toUpperCase()).reduce((sum,i)=>sum+i.principal,0);
 return {total,institutionAmount,share:total?institutionAmount/total:1};
}
