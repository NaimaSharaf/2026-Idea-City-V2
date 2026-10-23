'use strict';
// Copied from overleaf-synced-library/bibtex.js. Used by the side panel and the Entries view for paper notes.
// Builds the citation: Last, F.M. et al., (year). PMID: n   e.g.  Lu, Y. et al., (2016). PMID: 62524
globalThis.Bib=(()=>{
 const MARK={'"':'̈',"'":'́','`':'̀','^':'̂','~':'̃','=':'̄','.':'̇',u:'̆',v:'̌',H:'̋',c:'̧',k:'̨',r:'̊'};
 const SPECIAL={o:'ø',O:'Ø',ss:'ß',ae:'æ',AE:'Æ',aa:'å',AA:'Å',l:'ł',L:'Ł',oe:'œ',OE:'Œ',i:'ı'};
 function clean(s){
  s=String(s||'').replace(/\\([\"'`^~=.uvHckr])\s*\{?\\?([A-Za-z])\}?/g,(m,a,ch)=>ch+MARK[a])
   .replace(/\\(ss|ae|AE|aa|AA|oe|OE|o|O|l|L|i)(?![A-Za-z])\s*/g,(m,k)=>SPECIAL[k])
   .replace(/\\[A-Za-z]+\s*/g,'').replace(/[{}]/g,'').replace(/~/g,' ').replace(/\s+/g,' ').trim();
  return s.normalize('NFC');
 }
 function parse(text){
  text=String(text||'');const at=text.search(/@\s*[A-Za-z]+\s*[{(]/);if(at<0)return null;
  const head=/@\s*([A-Za-z]+)\s*[{(]\s*([^,\s]*)\s*,?/.exec(text.slice(at));let i=at+head[0].length;const fields={};
  const ws=()=>{while(i<text.length&&/[\s,]/.test(text[i]))i++;};
  while(i<text.length){
   ws();const m=/^([A-Za-z][\w:.-]*)\s*=\s*/.exec(text.slice(i));if(!m)break;i+=m[0].length;let value='';
   for(;;){
    if(text[i]==='{'){let d=0,s=i;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='{')d++;else if(text[i]==='}'&&--d===0){i++;break;}}value+=text.slice(s+1,i-1);}
    else if(text[i]==='"'){let d=0,s=++i;for(;i<text.length;i++){if(text[i]==='\\'){i++;continue;}if(text[i]==='{')d++;else if(text[i]==='}')d--;else if(text[i]==='"'&&d===0)break;}value+=text.slice(s,i);i++;}
    else{const b=/^[^,#}\s)]+/.exec(text.slice(i));if(b){value+=b[0];i+=b[0].length;}}
    while(/\s/.test(text[i]||''))i++;if(text[i]==='#'){i++;while(/\s/.test(text[i]||''))i++;continue;}break;
   }
   fields[m[1].toLowerCase()]=value;
  }
  return {type:head[1].toLowerCase(),key:head[2],fields};
 }
 function splitTop(s,re){const out=[];let d=0,last=0;for(let i=0;i<s.length;i++){if(s[i]==='{')d++;else if(s[i]==='}')d--;else if(d===0){re.lastIndex=i;const m=re.exec(s);if(m&&m.index===i){out.push(s.slice(last,i));i+=m[0].length-1;last=i+1;}}}out.push(s.slice(last));return out.map(x=>x.trim()).filter(Boolean);}
 function firstAuthor(raw){
  const a=splitTop(String(raw||''),/\s+and\s+/iy)[0];if(!a)return null;
  if(/^\{.*\}$/.test(a)&&splitTop(a.slice(1,-1),/,/y).length)return {last:clean(a),first:''}; // {Corporate Author}
  const parts=splitTop(a,/,/y);let last,first;
  if(parts.length>1){last=parts[0];first=parts[parts.length-1];}
  else{const w=splitTop(a,/\s+/y);if(w.length===1)return {last:clean(w[0]),first:''};let k=w.length-1;while(k>1&&/^[a-z]/.test(clean(w[k-1])))k--;last=w.slice(k).join(' ');first=w.slice(0,k).join(' ');}
  return {last:clean(last),first:clean(first)};
 }
 const initials=first=>first.split(/[\s.]+/).filter(Boolean).map(p=>p.split('-').filter(Boolean).map(x=>x[0].toUpperCase()+'.').join('')).join('');
 function pmidOf(f){
  for(const k of ['pmid','pubmed','pubmedid'])if(f[k]&&/\d/.test(f[k]))return clean(f[k]).replace(/\D/g,'');
  if(f.eprint&&/pubmed/i.test((f.eprinttype||'')+(f.archiveprefix||'')))return clean(f.eprint).replace(/\D/g,'');
  for(const k of ['note','notes','annote','extra','annotation','url',...Object.keys(f)])if(f[k]){const m=/PMID[:\s]*(\d{4,9})/i.exec(f[k])||/pubmed\.ncbi\.nlm\.nih\.gov\/(\d{4,9})/i.exec(f[k]);if(m)return m[1];} // any field that says PMID: n
  return '';
 }
 function citation(text,fallbackYear){
  const p=parse(text);if(!p)return {text:'',missing:['a BibTeX entry']};
  const f=p.fields,names=f.author||f.editor,a=firstAuthor(names),many=splitTop(String(names||''),/\s+and\s+/iy).length>1,year=(clean(f.year)||(/\d{4}/.exec(f.date||'')||[])[0]||String(fallbackYear||'')).trim(),pmid=pmidOf(f);
  const missing=[];if(!a)missing.push('author');if(!year)missing.push('year');if(!pmid)missing.push('PMID');
  const who=a?a.last+(a.first?', '+initials(a.first):'')+(many?' et al.':''):'';
  return {text:[who+',',year?'('+year+').':'',pmid?'PMID: '+pmid:''].filter(Boolean).join(' '),missing,parsed:p};
 }
 // Copies as grey 8 pt Helvetica text (rich text for Word, Docs, email); plain text where formatting isn't supported.
 async function copyStyled(text){
  const esc=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'),html='<span style="font-family:Helvetica,Arial,sans-serif;color:#808080;font-size:8pt">'+esc+'</span>';
  try{await navigator.clipboard.write([new ClipboardItem({'text/html':new Blob([html],{type:'text/html'}),'text/plain':new Blob([text],{type:'text/plain'})})]);}
  catch{await navigator.clipboard.writeText(text);}
 }
 // One box: paste/edit BibTeX, see the citation, copy it.
 function field(row,{disabled=false,onEdit,tell=()=>{}}={}){
  const box=document.createElement('div');box.className='bib';
  const label=document.createElement('label');label.textContent='BibTeX';
  const area=document.createElement('textarea');area.className='bib-text';area.value=row.bibtex||'';area.disabled=disabled;area.spellcheck=false;area.rows=5;
  area.placeholder='Paste a BibTeX entry, e.g.\n@article{smith2020,\n  author = {Smith, John Adam and Lee, Kim},\n  year = {2020},\n  pmid = {31234567}\n}';
  area.setAttribute('aria-label','BibTeX for '+(row.keyword||'this entry'));label.append(area);
  const out=document.createElement('div');out.className='bib-out';const cite=document.createElement('code');cite.className='bib-cite';
  const copy=document.createElement('button');copy.type='button';copy.className='bib-copy';copy.textContent='Copy citation';
  const note=document.createElement('span');note.className='bib-note';
  const show=()=>{const c=citation(area.value,row.year);cite.textContent=c.text||'—';copy.disabled=!c.text;note.textContent=c.missing.length?'Missing: '+c.missing.join(', '):'';};
  area.oninput=()=>{row.bibtex=area.value;show();onEdit?.(area.value);};
  copy.onclick=async()=>{const c=citation(area.value,row.year);try{await copyStyled(c.text);tell('Copied: '+c.text+(c.missing.length?' (missing '+c.missing.join(', ')+')':''));copy.textContent='Copied ✓';setTimeout(()=>copy.textContent='Copy citation',1500);}catch{tell('Clipboard unavailable. Select the citation and copy it manually.');}};
  out.append(cite,copy,note);box.append(label,out);show();
  box.refresh=value=>{if(document.activeElement!==area&&area.value!==(value||'')){area.value=value||'';show();}};
  return box;
 }
 return {parse,citation,field,clean,firstAuthor};
})();
