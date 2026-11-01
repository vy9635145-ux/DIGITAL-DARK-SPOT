const PDFDocument = require('pdfkit');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, "..", "..");
function buildPdf(data) {
  return new Promise((resolve,reject)=>{
    const doc=new PDFDocument({size:'A4',margins:{top:48,bottom:52,left:48,right:48},bufferPages:true,info:{Title:`Digital Dark Spot - ${data.topic}`,Author:'Digital Dark Spot'}});
    const chunks=[];doc.on('data',c=>chunks.push(c));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);
    const regular=path.join(ROOT,'fonts','DejaVuSans.ttf'),bold=path.join(ROOT,'fonts','DejaVuSans-Bold.ttf');
    if(fs.existsSync(regular))doc.font(regular);else doc.font('Helvetica');
    const fontBold=fs.existsSync(bold)?bold:'Helvetica-Bold';
    const pageFooter=()=>{const pages=doc.bufferedPageRange();for(let i=0;i<pages.count;i++){doc.switchToPage(i);doc.save();doc.fontSize(7).fillColor('#5d6385').text('Digital Dark Spot - AI-assisted research. Verify findings with official sources.',48,doc.page.height-32,{width:440,align:'left'});doc.text(`Page ${i+1}`,doc.page.width-90,doc.page.height-32,{width:42,align:'right'});doc.restore();}};
    const h=(title)=>{doc.moveDown(.65).font(fontBold).fontSize(13).fillColor('#4a2fd0').text(title,{continued:false});doc.moveDown(.25).font(fs.existsSync(regular)?regular:'Helvetica').fontSize(9.5).fillColor('#171a2f');};
    const line=(label,value)=>{doc.font(fontBold).text(`${label}: `,{continued:true});doc.font(fs.existsSync(regular)?regular:'Helvetica').text(String(value??'-'));};
    const block=(title,items,render)=>{h(title);if(!items?.length){doc.text('None recorded.');return;}items.forEach((x,i)=>{doc.font(fontBold).text(`${i+1}. ${render(x)}`);doc.moveDown(.3);});};
    doc.font(fontBold).fontSize(20).fillColor('#14183a').text('Digital Dark Spot Research Report');doc.moveDown(.6);doc.font(fs.existsSync(regular)?regular:'Helvetica').fontSize(9).fillColor('#5d6385').text(`Report generated: ${data.generated||'-'}`);doc.moveDown(.6);
    line('Research topic',data.topic);line('Research question',data.question);line('Research category',data.category);line('Research date',String(data.researched_at||'-').slice(0,10));h('Executive summary');doc.text(data.summary||'No summary was generated.');
    const c=data.counts||{};doc.moveDown(.4).text(`In total, ${c.sources||0} source(s) were reviewed (${c.extracted||0} extracted successfully), ${c.claims||0} claim(s) recorded, ${c.gaps||0} information gap(s), ${c.conflicts||0} possible conflict(s), ${c.outdated||0} freshness warning(s); ${c.tasks_done||0} of ${c.tasks||0} verification tasks completed.`);
    const cov=data.coverage||{};h('Research coverage');if(cov.empty)doc.text(cov.empty_message||'No research questions have been evaluated yet.');else{doc.text(`${cov.score}% - ${cov.answered} answered, ${cov.partial} partially answered, ${cov.unanswered} unanswered of ${cov.total} research questions.`);doc.fontSize(8).fillColor('#5d6385').text(`${cov.formula}. Partially answered questions count as 0.5. Coverage is not a measure of accuracy, reliability or truthfulness.`);doc.fillColor('#171a2f').fontSize(9.5);block('Research questions',data.questions||[],x=>`${x.question} — ${x.answer_status}`);}
    block('Sources reviewed',data.sources||[],x=>`S${x.id} ${x.title||x.domain||''} | ${x.url} | ${x.category||'Unknown'} | ${x.status} | Published ${String(x.published_at||'Not available').slice(0,10)}, updated ${String(x.updated_at||'Not available').slice(0,10)}`);
    block('Important findings and extracted claims',data.claims||[],x=>`${x.claim} | Evidence: ${x.evidence||'No verbatim evidence found'} | Source S${x.source_id} | ${x.status}`);
    block('Information gaps (not found in reviewed sources)',data.gaps||[],x=>`${x.title} | ${x.reason} | ${x.priority} | ${x.status} | Action: ${x.action||'-'}`);
    block('Possible conflicts between sources',data.conflicts||[],x=>`[S${x.source_a}] ${x.claim_a} vs [S${x.source_b}] ${x.claim_b} | ${x.explanation} | ${x.status}`);
    block('Outdated information signals',data.outdated||[],x=>`S${x.source_id} ${x.source_title} | ${x.signal_type} | ${x.reason}`);
    if((data.omitted||[]).includes('evidence')){h('Evidence references');doc.text('Omitted because of the report settings.');}else block('Evidence references',data.evidence||[],x=>`${x.finding} | “${x.quote}” | ${x.url}`);
    if((data.omitted||[]).includes('checklist')){h('Verification checklist');doc.text('Omitted because of the report settings.');}else block('Verification checklist',data.checklist||[],x=>`${x.task} | ${x.priority} | ${x.status}`);
    {const recs=[...(data.followups||[]).map(x=>`Follow-up question: ${x}`),...(data.gaps||[]).filter(g=>g.action).map(g=>`${g.title}: ${g.action}`)];block('Recommendations and follow-up research (AI-assisted)',recs,x=>x);}
    h('Research limitations');[
      'Findings come only from the sources listed above. A gap means information was not found in those sources; it does not mean the information does not exist.',
      'Differences between sources may reflect different years, programmes or contexts and are not proof that any source is wrong.',
      'Pages that need JavaScript to show their content cannot be read; such sources are marked as failed.',
      'Freshness signals use dates found on the page, not the date the page was downloaded.',
      'AI-assisted extraction can make mistakes. Check every important detail against the original source.'
    ].forEach(x=>doc.list([x],{bulletRadius:1.5}));
    pageFooter();doc.end();
  });
}
module.exports={buildPdf};
