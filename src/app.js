(function(){
'use strict';
const config={"name":"lige","language":"ar","product":{"name":"منتجك هنا","price":69,"currency":"MAD","sku":""},"orderForm":{"webhookUrl":"","successMessage":"تم استلام طلبك، سنتواصل معك لتأكيده."},"integrations":{"appsScriptUrl":""},"ui":{"sending":"جار إرسال الطلب...","success":"تم إرسال طلبك، سنتواصل معك لتأكيده.","orderNo":"رقم الطلب:","noWebhook":"نموذج الطلب غير متصل حاليا. يرجى المحاولة لاحقا.","failed":"تعذر تأكيد إرسال الطلب. تم حفظ المحاولة ويمكن إعادة إرسالها.","required":"هذا الحقل مطلوب.","invalidPhone":"أدخل رقم هاتف صحيحا (أرقام فقط، مع رمز الدولة عند الحاجة).","invalidQty":"الكمية يجب أن تكون عددا صحيحا بين 1 و {max}.","outOfStock":"هذا الخيار غير متوفر حاليا.","pickOption":"اختر الخيارات المطلوبة.","duplicate":"تم إرسال هذا الطلب للتو من هذا المتصفح.","stockIn":"متوفر","stockOut":"غير متوفر","stockCount":"متوفر: {n}","viewImage":"عرض الصورة {n}","fixErrors":"يرجى تصحيح الحقول المحددة.","rejected":"تعذر قبول الطلب. تحقق من البيانات وحاول مرة أخرى.","humanCheck":"أكمل التحقق الأمني أولا ثم أعد الإرسال.","failedNoQueue":"تعذر إرسال الطلب. تحقق من الاتصال ثم أعد المحاولة."}};
const QUEUE_KEY='bouhaj-order-queue-v2';
function trackLead(){try{if(window.fbq)window.fbq('track','Lead');if(window.ttq)window.ttq.track('SubmitForm');if(window.gtag)window.gtag('event','generate_lead');if(window.pintrk)window.pintrk('track','lead');if(window.snaptr)window.snaptr('track','SIGN_UP')}catch(e){}}
function safeUrl(value){try{const u=new URL(String(value||''),location.href);if(u.protocol!=='https:'&&u.hostname!=='127.0.0.1'&&u.hostname!=='localhost')return '';return u.href}catch(e){return ''}}
function loadQueue(){try{const q=JSON.parse(localStorage.getItem(QUEUE_KEY)||'[]');return Array.isArray(q)?q:[]}catch(e){return []}}
function saveQueue(q){try{localStorage.setItem(QUEUE_KEY,JSON.stringify(q.slice(-10)))}catch(e){}}
function queueOrder(data){const q=loadQueue();if(!q.some(x=>x.order_id===data.order_id)){q.push(data);saveQueue(q)}}
async function postOrder(url,data){
  const target=safeUrl(url); if(!target) throw new Error('Invalid webhook URL');
  const payload=JSON.stringify(data);
  for(let attempt=0;attempt<3;attempt++){
    const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),7000);
    try{
      const r=await fetch(target,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:payload,keepalive:true,signal:controller.signal,credentials:'omit'});
      clearTimeout(timer);
      if(!r.ok)throw new Error('HTTP '+r.status);
      const text=await r.text();
      let result={};try{result=JSON.parse(text)}catch(_){throw new Error('Invalid webhook response')}
      if(!result.ok){const rej=new Error(String(result.error||'Webhook rejected order'));rej.final=true;throw rej}
      return result;
    }catch(err){clearTimeout(timer);if(err&&err.final||attempt===2)throw err;await new Promise(r=>setTimeout(r,400*(attempt+1)));}
  }
}
async function flushQueue(){const webhook=config.orderForm.webhookUrl||config.integrations.appsScriptUrl||'';if(!webhook)return;const q=loadQueue();if(!q.length)return;const keep=[];for(const item of q){try{await postOrder(webhook,item)}catch(e){if(!(e&&e.final))keep.push(item)}}saveQueue(keep)}
function bhGoto(a){var h=a.getAttribute('href')||'';if(h.charAt(0)!=='#')return false;var t=null;try{t=h.length>1?document.getElementById(decodeURIComponent(h.slice(1))):null}catch(x){}var f=document.getElementById('orderForm');if(f&&(!t||t.id==='offer'||t.contains(f)))t=f;t=t||document.getElementById('offer');if(!t)return false;var r=t.getBoundingClientRect(),red=false;try{red=window.matchMedia('(prefers-reduced-motion: reduce)').matches}catch(x){}t.scrollIntoView({behavior:red?'auto':'smooth',block:r.height>window.innerHeight*.9?'start':'center'});if(t===f){setTimeout(function(){var i=f.querySelector('input:not([type=hidden]):not([tabindex="-1"]),textarea,select');if(i&&i.focus)try{i.focus({preventScroll:true})}catch(x){}},red?0:650)}return true}
document.addEventListener('click',function(e){if(e.defaultPrevented||e.button||e.metaKey||e.ctrlKey||e.shiftKey)return;var a=e.target&&e.target.closest?e.target.closest('a[href^="#"]'):null;if(a&&bhGoto(a))e.preventDefault()});
const form=document.getElementById('orderForm');
if(form){form.addEventListener('submit',async function(e){e.preventDefault();const result=document.getElementById('orderResult');const button=form.querySelector('button[type=submit]');const data=Object.fromEntries(new FormData(form).entries());if(String(data.website||'').trim())return;
data.product=config.product.name||'';data.amount=config.product.price||0;data.currency=config.product.currency||'';data.sku=config.product.sku||'';data.quantity=1;data.order_id='BH-'+Date.now()+'-'+crypto.getRandomValues(new Uint32Array(2)).join('').slice(0,10);data.page=location.href;data.created_at=new Date().toISOString();
const webhook=config.orderForm.webhookUrl||config.integrations.appsScriptUrl||'';result.textContent=config.ui.sending;if(button)button.disabled=true;
try{if(!webhook)throw new Error('NO_WEBHOOK');const response=await postOrder(webhook,data);if(response&&response.order_id){trackLead();result.textContent=(config.orderForm.successMessage||config.ui.success)+' '+config.ui.orderNo+' '+response.order_id;form.reset();}else{throw new Error('No order confirmation')}}catch(err){queueOrder(data);result.textContent=err.message==='NO_WEBHOOK'?config.ui.noWebhook:config.ui.failed;console.error(err)}finally{if(button)button.disabled=false}})}
flushQueue();
const ann=document.querySelector('.announcement');if(ann){const slides=[...ann.querySelectorAll('.announcement-track span')],speed=Number(ann.dataset.speed)||3500;let i=0;if(slides.length>1)setInterval(()=>{slides[i].classList.remove('active');i=(i+1)%slides.length;slides[i].classList.add('active')},speed);}
(function(){document.querySelectorAll('[data-gallery]').forEach(function(g){var m=g.querySelector('[data-gallery-main]');g.querySelectorAll('[data-gallery-thumb]').forEach(function(b){b.addEventListener('click',function(){if(m){m.src=b.dataset.src;if(b.dataset.alt)m.alt=b.dataset.alt}g.querySelectorAll('[aria-current]').forEach(function(e){e.removeAttribute('aria-current')});b.setAttribute('aria-current','true')})})})})();
(function pageRuntime(config,postOrder,queueOrder,trackLead,safeUrl){
  'use strict';
  var form=document.getElementById('orderForm');
  var ui=config.ui||{},cat=config.catalog||null;
  function q(s,r){return (r||document).querySelector(s);}
  function qa(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s));}
  function fmt(n,cur){return String(n)+(cur?' '+cur:'');}
  function tpl(s,o){return String(s||'').replace(/\{(\w+)\}/g,function(m,k){return o&&o[k]!==undefined?o[k]:m;});}
  /* https/relative assets only; SVG data URIs exist solely in template previews (never produced for real pages) and cannot run script inside <img> */
  function safeAsset(u){u=String(u||'');return /^(https:\/\/|\.\/assets\/|assets\/|data:image\/svg\+xml[;,])/.test(u)?u:'';}
  function has(o,k){return Object.prototype.hasOwnProperty.call(o,k);}
  var products={};
  var state={pid:'',sel:{},sig:''};
  if(cat){cat.products.forEach(function(p){products[p.id]=p;state.sel[p.id]=p.defaultSel||{};});state.pid=cat.active;}
  function product(){return cat?products[state.pid]:null;}
  function variantOf(p,sel){
    if(!p||!p.variants.length)return null;
    for(var i=0;i<p.variants.length;i++){var v=p.variants[i],ok=true;
      for(var j=0;j<p.options.length;j++){if(v.options[p.options[j].key]!==sel[p.options[j].key]){ok=false;break;}}
      if(ok)return v;}
    return null;
  }
  function stockOf(p,v){if(v)return v.stock;return p.stock===undefined?null:p.stock;}
  function avail(s){return s===null||s===undefined?'unknown':(s>0?'in':'out');}
  function eff(p,v){var own=v&&v.price!==null;return {price:own?v.price:p.price,old:own?v.oldPrice:p.oldPrice,images:v&&v.images&&v.images.length?v.images:p.images,sku:(v&&v.sku)||p.sku||''};}
  function labelOf(p,sel){return p.options.map(function(o){for(var i=0;i<o.values.length;i++)if(o.values[i].id===sel[o.key])return o.values[i].label;return '';}).filter(Boolean).join(' / ');}

  /* ---------- gallery ---------- */
  function setMain(src){qa('[data-gallery-main]').forEach(function(m){m.src=src;});}
  function buildThumbs(images){
    qa('[data-gallery-thumbs]').forEach(function(box){
      while(box.firstChild)box.removeChild(box.firstChild);
      if(images.length<2)return;
      images.forEach(function(src,i){
        var b=document.createElement('button');b.type='button';b.className='g-thumb';b.setAttribute('role','listitem');
        b.setAttribute('aria-label',tpl(ui.viewImage,{n:i+1}));if(i===0)b.setAttribute('aria-current','true');
        var im=document.createElement('img');im.src=src;im.alt='';im.loading='lazy';b.appendChild(im);
        b.addEventListener('click',function(){setMain(src);qa('[aria-current]',box).forEach(function(e){e.removeAttribute('aria-current');});b.setAttribute('aria-current','true');});
        box.appendChild(b);});
    });
    qa('[data-gallery-strip]').forEach(function(box){
      while(box.firstChild)box.removeChild(box.firstChild);
      images.forEach(function(src,i){var d=document.createElement('div');d.className='g-slide';d.setAttribute('role','listitem');var im=document.createElement('img');im.src=src;im.alt=box.getAttribute('data-alt')||'';im.decoding='async';if(i)im.loading='lazy';d.appendChild(im);box.appendChild(d);});
      box.scrollLeft=0;
    });
  }

  /* ---------- apply state to the page ---------- */
  function apply(){
    var p=product();if(!p)return;
    var sel=state.sel[p.id]||{},v=variantOf(p,sel),e=eff(p,v),s=stockOf(p,v),a=avail(s),complete=!p.options.length||!!v;
    var imgs=(e.images||[]).map(safeAsset).filter(Boolean);
    qa('[data-product-panel]').forEach(function(el){el.hidden=el.getAttribute('data-product-panel')!==p.id;});
    qa('[data-switch]').forEach(function(b){b.setAttribute('aria-pressed',b.getAttribute('data-switch')===p.id?'true':'false');});
    qa('[data-bh-name]').forEach(function(n){n.textContent=p.name;});
    qa('[data-bh-price]').forEach(function(n){n.textContent=fmt(e.price,p.currency);});
    var disc=e.old!==null&&e.old!==undefined&&e.old>e.price;
    qa('[data-bh-old]').forEach(function(n){n.hidden=!disc;if(disc)n.textContent=fmt(e.old,p.currency);});
    qa('[data-bh-save]').forEach(function(n){n.hidden=!disc;if(disc)n.textContent=(n.getAttribute('data-save-label')||'')+' '+Math.round((1-e.price/e.old)*100)+'%';});
    qa('[data-bh-sku]').forEach(function(n){n.textContent=e.sku;n.hidden=!e.sku;});
    qa('[data-product-panel="'+p.id+'"] [data-option]').forEach(function(fs){
      var key=fs.getAttribute('data-option'),lab=q('[data-opt-label]',fs);
      if(lab){for(var i=0;i<p.options.length;i++)if(p.options[i].key===key)for(var j=0;j<p.options[i].values.length;j++)if(p.options[i].values[j].id===sel[key])lab.textContent=p.options[i].values[j].label;}
      qa('[data-bh-opt]',fs).forEach(function(inp){
        /* struck through only when EVERY combination containing this value is sold out (a single sold-out combination is shown via the status line) */
        var any=p.variants.some(function(x){return x.options[key]===inp.value&&avail(x.stock)!=='out';});
        var lbl=inp.closest('label');if(lbl){lbl.setAttribute('data-oos',any?'false':'true');lbl.classList.toggle('is-checked',inp.checked);}
      });
    });
    var txt='',st='';
    if(cat.display!=='none'){
      if(!complete){txt=ui.pickOption;st='pending';}
      else if(a==='out'){txt=ui.stockOut;st='out';}
      else if(a==='in'){txt=(cat.display==='count'&&s!==null)?tpl(ui.stockCount,{n:s}):ui.stockIn;st='in';}
    }
    qa('[data-bh-stock]').forEach(function(n){n.textContent=txt;n.hidden=!txt;n.setAttribute('data-state',st||'unknown');});
    var sig=imgs.join('|');
    if(sig&&sig!==state.sig){if(state.sig){setMain(imgs[0]);buildThumbs(imgs);}state.sig=sig;}
    if(form){
      var f=form.elements;
      if(f.product_id)f.product_id.value=p.id;
      if(f.variant_id)f.variant_id.value=v?v.id:'';
      if(f.variant)f.variant.value=labelOf(p,sel);
      var qty=f.quantity;
      if(qty){var max=(a==='in'&&s!==null)?Math.min(s,cat.maxQty):cat.maxQty;qty.max=String(max);if(Number(qty.value)>max)qty.value=String(max);}
      var btn=form.querySelector('button[type=submit]');
      if(btn&&!state.submitting){var block=a==='out'||!complete;btn.disabled=block;btn.setAttribute('aria-disabled',block?'true':'false');}
    }
    qa('[data-sel-summary]').forEach(function(n){var l=labelOf(p,sel);n.textContent=p.name+(l?' — '+l:'');});
  }
  function syncPickers(pid){
    qa('[data-bh-opt][data-pid="'+pid+'"]').forEach(function(inp){inp.checked=state.sel[pid][inp.getAttribute('data-bh-opt')]===inp.value;var l=inp.closest('label');if(l)l.classList.toggle('is-checked',inp.checked);});
  }
  if(cat){
    qa('[data-bh-opt]').forEach(function(inp){
      inp.addEventListener('change',function(){
        var pid=inp.getAttribute('data-pid')||state.pid;
        state.sel[pid]=state.sel[pid]||{};state.sel[pid][inp.getAttribute('data-bh-opt')]=inp.value;
        syncPickers(pid);apply();
      });
    });
    qa('[data-switch]').forEach(function(b){b.addEventListener('click',function(){state.pid=b.getAttribute('data-switch');apply();});});
    var p0=product(),v0=variantOf(p0,state.sel[p0.id]||{});state.sig=(eff(p0,v0).images||[]).map(safeAsset).filter(Boolean).join('|');
    apply();
  }

  /* ---------- live stock (only when the seller connected the Apps Script inventory) ---------- */
  function liveStock(){
    if(!cat||cat.mode!=='apps-script')return;
    var base=safeUrl(config.orderForm.webhookUrl||config.integrations.appsScriptUrl||'');if(!base)return;
    var ctl=new AbortController(),t=setTimeout(function(){ctl.abort();},7000);
    fetch(base+(base.indexOf('?')<0?'?':'&')+'action=stock',{method:'GET',signal:ctl.signal,credentials:'omit',cache:'no-store'})
      .then(function(r){return r.json();})
      .then(function(d){
        clearTimeout(t);if(!d||!d.ok||!d.stock||typeof d.stock!=='object')return;
        Object.keys(products).forEach(function(pid){var p=products[pid];
          p.variants.forEach(function(v){var k=pid+':'+v.id;if(has(d.stock,k)&&isFinite(Number(d.stock[k])))v.stock=Math.max(0,Math.floor(Number(d.stock[k])));});
          var k0=pid+':-';if(!p.variants.length&&has(d.stock,k0)&&isFinite(Number(d.stock[k0])))p.stock=Math.max(0,Math.floor(Number(d.stock[k0])));});
        apply();
      }).catch(function(){clearTimeout(t);});
  }
  if(cat)liveStock();

  if(!form)return;
  /* ---------- order form ---------- */
  var result=document.getElementById('orderResult'),KEY='bouhaj-order-attempt-v1';
  function say(m){if(result)result.textContent=m;}
  function clearErr(el){el.removeAttribute('aria-invalid');var e=document.getElementById('err-'+el.name);if(e)e.parentNode.removeChild(e);el.removeAttribute('aria-describedby');}
  function setErr(el,m){clearErr(el);el.setAttribute('aria-invalid','true');var s=document.createElement('span');s.className='fld-err';s.id='err-'+el.name;s.textContent=m;el.setAttribute('aria-describedby',s.id);(el.closest('label')||el.parentNode).appendChild(s);}
  qa('input,textarea',form).forEach(function(el){el.addEventListener('input',function(){if(el.getAttribute('aria-invalid'))clearErr(el);});});
  function validate(){
    var bad=[],f=form.elements;
    function chk(name,ok,msg){var el=f[name];if(!el||el.type==='hidden')return;clearErr(el);if(el.required&&!ok(String(el.value||'').trim())){setErr(el,msg);bad.push(el);}}
    chk('name',function(v){return v.length>=2;},ui.required);
    chk('phone',function(v){return v.length>0;},ui.required);
    var ph=f.phone;if(ph&&ph.required&&!ph.getAttribute('aria-invalid')&&!/^\+?[0-9]{7,20}$/.test(String(ph.value).replace(/[\s.\-()\u200e\u200f]/g,''))){setErr(ph,ui.invalidPhone);bad.push(ph);}
    chk('city',function(v){return v.length>=2;},ui.required);
    chk('address',function(v){return v.length>=5;},ui.required);
    var qe=f.quantity;if(qe){clearErr(qe);var n=Number(qe.value),mx=Number(qe.max)||99;if(!(n>=1&&n<=mx&&Math.floor(n)===n)){setErr(qe,tpl(ui.invalidQty,{max:mx}));bad.push(qe);}}
    return bad;
  }
  function read(){try{return JSON.parse(localStorage.getItem(KEY)||'null');}catch(e){return null;}}
  function write(o){try{localStorage.setItem(KEY,JSON.stringify(o));}catch(e){}}
  form.setAttribute('novalidate','');
  /* Optional Cloudflare Turnstile. Only the PUBLIC site key is in the page; the secret is checked inside Apps Script. */
  var ts=/^[0-9A-Za-z_-]{10,64}$/.test(String(config.turnstile||''))?String(config.turnstile):'';
  if(ts){
    var holder=document.createElement('div');holder.className='cf-turnstile';holder.setAttribute('data-sitekey',ts);
    var sbtn=form.querySelector('button[type=submit]');if(sbtn&&sbtn.parentNode)sbtn.parentNode.insertBefore(holder,sbtn);
    var tsc=document.createElement('script');tsc.src='https://challenges.cloudflare.com/turnstile/v0/api.js';tsc.async=true;tsc.defer=true;document.head.appendChild(tsc);
  }
  form.addEventListener('submit',function(e){
    e.preventDefault();e.stopImmediatePropagation();
    if(state.submitting)return;
    var data=Object.fromEntries(new FormData(form).entries());
    if(String(data.website||'').trim())return;
    delete data.website;
    var bad=validate();if(bad.length){say(ui.fixErrors);bad[0].focus();return;}
    if(ts){var tok=String(data['cf-turnstile-response']||'');delete data['cf-turnstile-response'];if(!tok){say(ui.humanCheck);return;}data.turnstile_token=tok;}
    var p=product(),v=null,unit=Number(config.product.price)||0,cur=config.product.currency||'',sel=null,pname=config.product.name||'',sku=config.product.sku||'',key='';
    if(p){sel=state.sel[p.id]||{};v=variantOf(p,sel);
      if(p.options.length&&!v){say(ui.pickOption);return;}
      var s=stockOf(p,v);if(avail(s)==='out'){say(ui.outOfStock);return;}
      var ef=eff(p,v);unit=ef.price;cur=p.currency||cur;pname=p.name;sku=ef.sku;key=p.id+':'+(v?v.id:'-');
      data.product_id=p.id;data.variant_id=v?v.id:'';data.variant=labelOf(p,sel);data.inventory_key=key;
      var mx=(avail(s)==='in'&&s!==null)?Math.min(s,cat.maxQty):cat.maxQty;if(Number(data.quantity)>mx){say(tpl(ui.invalidQty,{max:mx}));return;}
    }
    var qty=Math.max(1,Math.floor(Number(data.quantity)||1));
    data.product=pname;data.sku=sku;data.quantity=qty;data.unit_price=unit;data.amount=Math.round(unit*qty*100)/100;data.currency=cur;
    data.page=location.href;data.created_at=new Date().toISOString();
    var webhook=config.orderForm.webhookUrl||config.integrations.appsScriptUrl||'';
    if(!webhook){say(ui.noWebhook);return;}
    var fp=[data.product_id||'',data.variant_id||'',qty,String(data.phone).replace(/\D/g,''),String(data.name).toLowerCase()].join('|');
    var last=read(),now=Date.now();
    if(last&&last.fp===fp&&last.done&&now-last.at<120000){say(ui.duplicate);return;}
    data.order_id=(last&&last.fp===fp&&!last.done&&last.id)?last.id:'BH-'+now+'-'+crypto.getRandomValues(new Uint32Array(2)).join('').slice(0,10);
    write({fp:fp,id:data.order_id,at:now,done:false});
    state.submitting=true;var btn=form.querySelector('button[type=submit]');if(btn)btn.disabled=true;say(ui.sending);
    postOrder(webhook,data).then(function(r){
      if(!(r&&r.order_id))throw new Error('No order confirmation');
      write({fp:fp,id:data.order_id,at:Date.now(),done:true});
      trackLead();
      say((config.orderForm.successMessage||ui.success)+' '+ui.orderNo+' '+r.order_id);
      form.reset();if(cat){state.sel[state.pid]=(products[state.pid].defaultSel||{});syncPickers(state.pid);}
    }).catch(function(err){
      var m=String(err&&err.message||'');
      if(/^OUT_OF_STOCK/i.test(m)){say(ui.outOfStock);liveStock();}
      else if(!(err&&err.final)){if(ts)say(ui.failedNoQueue);else{queueOrder(data);say(ui.failed);}}   /* a spent one-time token cannot be replayed from the retry queue */   /* network/HTTP/timeouts: keep for retry */
      else say(ui.rejected);                                         /* explicit rejection by the server: never retried */
    }).then(function(){try{if(ts&&window.turnstile)window.turnstile.reset();}catch(x){}state.submitting=false;if(cat)apply();else if(btn)btn.disabled=false;});
  },true);
})(config,postOrder,queueOrder,trackLead,safeUrl);
(()=>{const F={"spotlight":false,"magnetic":false,"tilt":false,"skeleton":false,"grain":false,"counter":false,"tiltStrength":10,"magneticStrength":12,"counterDuration":1.6};const root=document.documentElement;})();
})();