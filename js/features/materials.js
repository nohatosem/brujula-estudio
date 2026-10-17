// Archivos de estudio privados: PDF en Supabase Storage, dueño por carpeta UUID.
// Lectura local opcional de texto; no se entrega el PDF a Gemini ni a ChatGPT por subirlo.
import { cloud,getClient } from '../cloud/cloud.js';
import {store,change} from '../core/store.js';
import {toast} from '../ui/feedback.js';
const BUCKET='brujula-materiales';
const MAX_SIZE=10*1024*1024;
const findTopic=id=>store.state.topics.find(t=>t.id===id);

async function extractText(file){
  try {
    const pdfjs=await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc='https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs';
    const buf=await file.arrayBuffer();
    const doc=await pdfjs.getDocument({data:buf}).promise;
    let chunks=[],length=0;
    for(let i=1;i<=Math.min(doc.numPages,35)&&length<14000;i++){
      const page=await doc.getPage(i),raw=await page.getTextContent();
      const txt=raw.items.map(item=>item.str||'').join(' ').trim();
      if(txt){chunks.push('Página '+i+': '+txt);length+=txt.length;}
    }
    return chunks.join('\n').slice(0,14000);
  }catch(e){console.warn('Vista previa de PDF no disponible',e.message);return '';}
}
export async function uploadPDF(topicId,file){
  const t=findTopic(topicId);
  if(!t||!cloud.user)throw Error('Inicia sesión y abre un tema válido.');
  if(!(file instanceof File)||file.size>MAX_SIZE||file.size===0||!(/\.pdf$/i.test(file.name)))throw Error('Selecciona un PDF de hasta 10 MB.');
  const client=await getClient(),name=file.name.slice(0,130),uuid=crypto.randomUUID();
  const path=[cloud.user.id,encodeURIComponent(topicId),uuid+'.pdf'].join('/');
  const {error}=await client.storage.from(BUCKET).upload(path,file,{contentType:'application/pdf',upsert:false});
  if(error)throw Error('No se pudo subir PDF: '+error.message);
  const excerpt=await extractText(file);
  try {
    change({label:'Adjuntar PDF a «'+t.title+'»',type:'material',topicIds:[topicId],
      mutate(s){const current=s.topics.find(x=>x.id===topicId);if(!current)throw Error('Tema inexistente');
        current.materials=[...(current.materials||[]),{
          id:uuid,path,name,size:file.size,excerpt,uploadedAt:new Date().toISOString()
        }];}
    });
  }catch(e){await client.storage.from(BUCKET).remove([path]);throw e;}
  toast(excerpt?'PDF guardado y texto preparado para analizar.':'PDF privado guardado. No se extrajo texto (quizá es un escaneo).',{tone:'ok',duration:6500});
  return {name,excerpt};
}
export function pickPDF(topicId){
  const input=document.createElement('input');input.type='file';input.accept='.pdf,application/pdf';
  input.addEventListener('change',async()=>{
    const f=input.files?.[0];if(!f)return;
    toast('Subiendo PDF…');try{await uploadPDF(topicId,f);}catch(e){toast(e.message,{tone:'warn',duration:8000});}
  },{once:true});
  input.click();
}
export async function openPDF(topicId,id){
  const m=(findTopic(topicId)?.materials||[]).find(x=>x.id===id);
  if(!m)throw Error('Material inexistente.');
  const client=await getClient();
  const {data,error}=await client.storage.from(BUCKET).createSignedUrl(m.path,120);
  if(error||!data?.signedUrl)throw Error('No se pudo abrir el PDF privado.');
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}
export async function removePDF(topicId,id){
  const m=(findTopic(topicId)?.materials||[]).find(x=>x.id===id);
  if(!m)throw Error('No se encontró el archivo.');
  const client=await getClient();
  const {error}=await client.storage.from(BUCKET).remove([m.path]);
  if(error)throw Error('No se pudo borrar el PDF: '+error.message);
  change({label:'Quitar PDF',type:'material',topicIds:[topicId],
    mutate(s){const t=s.topics.find(x=>x.id===topicId);t.materials=(t.materials||[]).filter(x=>x.id!==id);}
  });
}
export async function analyzePDF(topicId,id){
  const topic=findTopic(topicId),m=(topic?.materials||[]).find(x=>x.id===id);
  if(!m)throw Error('Material inexistente.');
  if(!m.excerpt)throw Error('Este PDF no contiene texto extraíble. Para analizar escaneos, adjúntalo directamente en ChatGPT.');
  const {requestChatGPT}=await import('./chatgpt-bridge.js');
  await requestChatGPT('Analiza los apuntes del PDF «'+m.name+'» del tema «'+topic.title+'». Explica, resume y sugiere prácticas. No cambies mi horario sin una propuesta.',{
    material:{fileName:m.name,topicId,title:topic.title,excerpt:m.excerpt.slice(0,12000)}
  });
}
