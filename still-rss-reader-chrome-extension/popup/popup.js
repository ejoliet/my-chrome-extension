'use strict';
const $ = id => document.getElementById(id);
const readerUrl = chrome.runtime.getURL('reader/index.html');
const safe = raw => {try {const u=new URL(raw);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
function originPattern(url){const u=new URL(url);return `${u.protocol}//${u.hostname}/*`;}
function setStatus(value){$('status').textContent=value;}
async function add(url,name,button){
  url=safe(url);if(!url){setStatus('Enter a valid HTTP(S) URL.');return;}
  button.disabled=true;
  try{
    // Must run directly in response to a user gesture, before deferred operations.
    const origin=originPattern(url);
    const granted=await chrome.permissions.request({origins:[origin]});
    if(!granted)throw Error('Site access was declined.');
    // Single canonical subscriptions key shared by popup and reader.
    const data=await chrome.storage.local.get('stillFeeds');
    const items=Array.isArray(data.stillFeeds)?data.stillFeeds:[];
    if(!items.some(x=>x.url===url))items.push({url,name:String(name||new URL(url).hostname).slice(0,120),customName:!!name,cookies:false,lastError:''});
    await chrome.storage.local.set({stillFeeds:items});
    await chrome.tabs.create({url:readerUrl});
    window.close();
  }catch(e){setStatus(e.message||String(e));button.disabled=false;}
}
function render(feeds){
  $('results').replaceChildren();
  const unique=new Map(feeds.filter(f=>safe(f.url)).map(f=>[safe(f.url),f]));
  if(!unique.size){setStatus('No feed declared. You can add a feed URL below.');return;}
  setStatus(`${unique.size} feed${unique.size===1?'':'s'} found on this page.`);
  for(const f of unique.values()){
    const row=document.createElement('div');row.className='item';
    const meta=document.createElement('div');const name=document.createElement('div');name.className='name';name.textContent=f.name||new URL(f.url).hostname;
    const link=document.createElement('div');link.className='url';link.textContent=f.url;
    meta.append(name,link);const button=document.createElement('button');button.textContent='＋ Add';button.setAttribute('aria-label',`Subscribe to ${name.textContent}`);
    button.addEventListener('click',()=>add(f.url,f.name,button));row.append(meta,button);$('results').append(row);
  }
}
function findInPage(){
  const out=[];
  const base=location.href;
  for(const l of document.querySelectorAll('link[rel~="alternate"][href]')){
    const type=(l.getAttribute('type')||'').toLowerCase();
    if(!['application/rss+xml','application/atom+xml','application/rdf+xml','application/feed+json'].includes(type))continue;
    if(type==='application/feed+json')continue; // JSON Feed not supported by the reader.
    try{out.push({url:new URL(l.getAttribute('href'),base).href,name:l.getAttribute('title')||document.title||location.hostname});}catch{}
  }
  if(['application/rss+xml','application/atom+xml','text/xml','application/xml'].includes(document.contentType))out.unshift({url:location.href,name:document.title||location.hostname});
  return out;
}
async function discover(){
  try{
    const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
    if(!tab?.id||!/^https?:/.test(tab.url||'')){setStatus('Open a website to discover its feeds.');return;}
    const result=await chrome.scripting.executeScript({target:{tabId:tab.id},func:findInPage});
    render(result?.[0]?.result||[]);
  }catch(e){setStatus('Cannot inspect this page. Try a normal website or enter a feed URL.');}
}
$('reader').addEventListener('click',()=>chrome.tabs.create({url:readerUrl}));
$('manualAdd').addEventListener('click',()=>add($('manual').value,'',$('manualAdd')));
$('manual').addEventListener('keydown',e=>{if(e.key==='Enter')$('manualAdd').click();});
discover();
