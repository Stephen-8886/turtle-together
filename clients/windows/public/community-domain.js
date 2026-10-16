import {dayKey,validDay} from './domain.js';

export const CATEGORIES=['餐饮','交通','购物','居家','娱乐','健康','学习','其他'];
export const money=cents=>'¥'+(cents/100).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
export function validateExpense(input,now=Date.now()){
  const amount=String(input.amount??'').trim();
  if(!/^(0|[1-9]\d{0,6})(\.\d{1,2})?$/.test(amount))throw new Error('金额请填写正数，最多两位小数，单笔不超过 999 万元。');
  const [yuan,fen='']=amount.split('.');const cents=Number(yuan)*100+Number(fen.padEnd(2,'0'));
  if(cents<=0)throw new Error('支出金额必须大于 0。');
  const title=String(input.title||'').trim(),note=String(input.note||'').trim();
  if(!title||title.length>80)throw new Error('请填写 1–80 字的支出名称。');
  if(!CATEGORIES.includes(input.category))throw new Error('请选择支出分类。');
  if(!validDay(input.date)||input.date<'1900-01-01'||input.date>dayKey(now))throw new Error('支出日期应为今天或过去的有效日期。');
  if(note.length>500)throw new Error('备注最多 500 字。');
  return {title,cents,category:input.category,date:input.date,note};
}
export function expenseSummary(expenses,{month,member='',category=''}={}){
  const rows=expenses.filter(e=>(!month||e.date.startsWith(month+'-'))&&(!member||e.owner===member)&&(!category||e.category===category)).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt-a.createdAt);
  const byMember={},byCategory={};let total=0;
  for(const e of rows){total+=e.cents;byMember[e.owner]=(byMember[e.owner]||0)+e.cents;byCategory[e.category]=(byCategory[e.category]||0)+e.cents;}
  return {rows,total,byMember,byCategory};
}
