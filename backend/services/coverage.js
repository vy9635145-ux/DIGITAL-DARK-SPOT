const FORMULA = 'Coverage Score = ((Answered + 0.5 x Partially answered) / Total questions) x 100';
const NOTE = 'Coverage measures how many research questions have supporting evidence in the reviewed sources. Partially answered questions count as 0.5. It is not a measure of accuracy, source reliability or truthfulness.';
function calculate(statuses) {
 const a=Array.from(statuses), total=a.length, answered=a.filter(x=>x==='answered').length, partial=a.filter(x=>x==='partial').length;
 return {score:total?Math.round((answered+0.5*partial)/total*1000)/10:null,total,answered,partial,unanswered:total-answered-partial,formula:FORMULA,note:NOTE,empty:!total,empty_message:total?null:'No research questions have been evaluated yet, so no coverage score can be shown.'};
}
module.exports={calculate,FORMULA,NOTE};
