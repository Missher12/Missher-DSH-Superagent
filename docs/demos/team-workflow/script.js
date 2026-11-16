// Isolated UI prototype. It never calls DSH, creates sessions, or dispatches work.
const $ = s => document.querySelector(s), stage = $('#stage'), world = $('#world');
const paths = {
  team:'M8 4h8v5H8z M3 15h6v5H3z M15 15h6v5h-6z M12 9v3M6 15v-3h12v3',
  route:'M4 5h6v6H4z M14 14h6v6h-6z M10 8h7v6 M14 11l3 3 3-3',
  plus:'M12 5v14M5 12h14',minus:'M5 12h14',close:'M6 6l12 12M18 6 6 18',
  chevron:'m7 10 5 5 5-5',check:'m5 12 4 4L19 6',code:'m8 6-6 6 6 6m8-12 6 6-6 6',
  shield:'m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6',
  grip:'M9 5h.01M15 5h.01M9 12h.01M15 12h.01M9 19h.01M15 19h.01',
  command:'M5 6h14M5 11h14M5 16h9',undo:'M3 10h12a6 6 0 0 1 0 12 M3 10l5-5M3 10l5 5',
  layout:'M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z',
  sidebar:'M3 4h18v16H3z M15 4v16',expand:'M8 3H3v5M16 3h5v5M21 16v5h-5M8 21H3v-5',
  trash:'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6',
  sun:'M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4 M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  cursor:'m5 3 14 9-7 1-3 7z', 'user-plus':'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0 M20 7v6M17 10h6'
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${paths[name] || paths.team}"/></svg>`;
const escape = text => String(text ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
document.querySelectorAll('[data-icon]').forEach(el => el.innerHTML = icon(el.dataset.icon));
const initial = [
  {id:'commander',name:'总指挥',role:'commander',parent:null,work:'统筹目标，确认方案与最终交付。',deps:[],x:40,y:230},
  {id:'planner',name:'策划',role:'manager',parent:'commander',work:'拆分任务、协调分工，复核交付结果。',deps:[],x:326,y:230},
  {id:'frontend',name:'前端',role:'implementer',parent:'planner',work:'完成界面和交互，接通宿主原生能力。',deps:[],x:612,y:90},
  {id:'backend',name:'后端',role:'implementer',parent:'planner',work:'实现插件逻辑、数据存储与接口。',deps:[],x:612,y:370},
  {id:'reviewer',name:'检验',role:'reviewer',parent:'planner',work:'独立运行检查，验证前后端交付。',deps:['frontend','backend'],x:898,y:230}
];
const roleLabels = {commander:'总指挥',manager:'管理',implementer:'实施',reviewer:'检验'};
const roleIcon = role => ({commander:'command',manager:'team',implementer:'code',reviewer:'shield'}[role]);
let members = structuredClone(initial), selected = 'frontend', view = 'hierarchy', history = [], dirty = false;
let camera = {x:0,y:0,scale:1}, activeMenu, linkFrom, pointer, selectedEdge, toastTimer, formDraft;
const member = id => members.find(m => m.id === id);
const key = 'superagent-team-workflow-demo-v1';
try { const saved = JSON.parse(localStorage.getItem(key)); if (Array.isArray(saved) && saved.length >= 2 && saved.every(m => typeof m.id === 'string' && Array.isArray(m.deps) && Number.isFinite(m.x) && Number.isFinite(m.y))) members = saved; } catch {}
if (!member(selected)) selected = members[0].id;
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.add('visible'); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3000); }
function remember(before = members) { history.push(structuredClone(before)); if (history.length > 40) history.shift(); dirty = true; $('#undo').disabled = false; $('#save-state').textContent = '草稿有更改'; }
function change(fn, message) { closeMenu(); remember(); fn(); render(); if (message) toast(message); }
function choose(id) { selected = id; selectedEdge = null; render(); }
function isDescendant(id, ancestor) { const seen = new Set(); while (id && !seen.has(id)) { if (id === ancestor) return true; seen.add(id); id = member(id)?.parent; } return false; }
function parents(id) { return members.filter(m => ['manager','commander'].includes(m.role) && m.id !== id && !isDescendant(m.id,id)).map(m => [m.id,m.name]); }
function dependencyCycle(from,to) { const pending=[from],seen=new Set(); while(pending.length){const id=pending.pop();if(id===to)return true;if(seen.has(id))continue;seen.add(id);pending.push(...(member(id)?.deps||[]));} return false; }
function endLink() {
  linkFrom=null;document.body.classList.remove('connecting');
  document.querySelectorAll('.link-target').forEach(el=>el.classList.remove('link-target'));
  $('.route-preview')?.remove();
}
function connect(from,to) {
  endLink();
  if (!member(from) || !member(to) || from === to || ['commander','planner'].includes(to) || from === 'commander') return toast('请选择两个执行成员连接交付');
  if (member(to).deps.includes(from)) return toast('这条交付关系已经存在');
  if (dependencyCycle(from,to)) return toast('会形成互相等待，已保留原关系');
  change(() => { member(to).deps.push(from); selected = to; view = 'delivery'; }, `${member(to).name}将等待${member(from).name}交付`);
}
function selectButton(id,label,value,options,onSelect) {
  const button = document.createElement('button'); button.type='button';button.id=id;button.className='select-button';button.setAttribute('aria-label',label);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');
  const caption = options.find(o => o[0] === value)?.[1] || value;
  button.innerHTML=`<span>${escape(caption)}</span>${icon('chevron')}`;
  button.onclick=()=>openMenu(button, options, value, onSelect);
  button.onkeydown=event=>{if(['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();openMenu(button,options,value,onSelect);}};
  return button;
}
function closeMenu(focus=false) { if(!activeMenu)return;const {root,button}=activeMenu;root.remove();button.setAttribute('aria-expanded','false');activeMenu=null;if(focus)button.focus({preventScroll:true}); }
function openMenu(button,options,value,onSelect) {
  if(activeMenu?.button===button){closeMenu(true);return;}closeMenu();
  const root=document.createElement('div');root.className='select-menu';root.setAttribute('role','listbox');root.setAttribute('aria-label',button.getAttribute('aria-label'));root.setAttribute('popover','manual');
  const dialog=button.closest('dialog');(dialog||document.body).append(root);
  options.forEach(([id,label])=>{const row=document.createElement('button');row.type='button';row.setAttribute('role','option');row.setAttribute('aria-selected',String(id===value));row.innerHTML=`<span>${escape(label)}</span>${id===value?icon('check'):''}`;row.onclick=()=>{closeMenu();onSelect(id);(document.getElementById(button.id)||button).focus({preventScroll:true});};root.append(row);});
  root.showPopover();const rect=button.getBoundingClientRect(),width=Math.min(Math.max(rect.width,240),innerWidth-24);root.style.width=width+'px';root.style.left=Math.max(12,Math.min(rect.left,innerWidth-width-12))+'px';
  const below=innerHeight-rect.bottom-16,above=rect.top-16,up=below<Math.min(root.scrollHeight,300)&&above>below;
  root.style.maxHeight=Math.min(300,up?above:below)+'px';root.style.top=(up?rect.top-root.offsetHeight-5:rect.bottom+5)+'px';
  button.setAttribute('aria-expanded','true');activeMenu={root,button};const rows=[...root.children];(rows[options.findIndex(o=>o[0]===value)]||rows[0])?.focus({preventScroll:true});
  root.onkeydown=event=>{const index=rows.indexOf(document.activeElement);if(event.key==='Escape'){event.preventDefault();event.stopPropagation();closeMenu(true);}else if(event.key==='Tab')closeMenu(true);else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?rows.length-1:(index+(event.key==='ArrowUp'?-1:1)+rows.length)%rows.length;rows[next].focus();}};
}
document.addEventListener('pointerdown',event=>{if(activeMenu&&!activeMenu.root.contains(event.target)&&!activeMenu.button.contains(event.target))closeMenu();},true);
document.addEventListener('keydown',event=>{if(event.key==='Escape'){if(pointer?.kind==='link')pointer=null;endLink();renderEdges();}});
function mountSelect(target,id,label,value,options,fn) { $(target).replaceChildren(selectButton(id,label,value,options,fn)); }
function field(label,id,content) { return `<div class="field"><label for="${id}">${label}</label>${content}</div>`; }
function renderInspector() {
  const m=member(selected);if(!m)return;
  const root=$('#inspector');root.innerHTML=`<div class="inspector-head"><h2>成员分工</h2><button class="icon-button inspector-close" id="close-details" aria-label="关闭成员分工">${icon('close')}</button></div>
    <div class="selected-member"><span class="node-icon">${icon(roleIcon(m.role))}</span><div><strong>${escape(m.name)}</strong><small>${roleLabels[m.role]} · 草稿</small></div></div>
    <div class="inspector-fields">${field('名称','edit-name',`<input id="edit-name" maxlength="60" value="${escape(m.name)}">`)}${field('职责','edit-role','<div id="edit-role-wrap"></div>')}${m.parent?field('上级','edit-parent','<div id="edit-parent-wrap"></div>'):''}${field('分工','edit-work',`<textarea id="edit-work" maxlength="4000">${escape(m.work)}</textarea>`)}${field('模型','edit-model','<div id="edit-model-wrap"></div>')}${field('思考强度','edit-effort','<div id="edit-effort-wrap"></div>')}</div>
    <div class="inspector-section"><div class="section-title"><span>等待交付</span><button class="icon-button" id="add-dependency" aria-label="添加交付依赖">${icon('plus')}</button></div><div class="dependencies">${m.deps.map(id=>`<span class="dependency">${escape(member(id)?.name)}<button data-remove="${escape(id)}" aria-label="不再等待${escape(member(id)?.name)}">${icon('close')}</button></span>`).join('')||'<span class="empty-copy">无前置交付</span>'}</div></div>
    <p class="inspector-help">拖到管理成员上可更改上级。<br>交付连线决定谁先完成、谁再开始。</p>${!['commander','planner'].includes(m.id)?`<div class="danger-zone"><button id="delete-member">${icon('trash')}移除此成员</button></div>`:''}`;
  const bindText=(id,property)=>{const el=$(id);let remembered=false;el.onfocus=()=>remembered=false;el.oninput=()=>{if(!remembered){remember();remembered=true;}m[property]=el.value;const node=$(`[data-node="${m.id}"]`);node?.querySelector(property==='name'?'.node-name':'.node-work')?.replaceChildren(document.createTextNode(el.value));};el.onblur=()=>{if(property==='name'&&!el.value.trim()){m.name='未命名成员';el.value=m.name;renderNodes();}root.querySelector('.selected-member strong').textContent=m.name;};};
  bindText('#edit-name','name');bindText('#edit-work','work');
  mountSelect('#edit-role-wrap','edit-role','职责',m.role,m.role==='commander'?[['commander','总指挥']]:Object.entries(roleLabels).filter(([id])=>id!=='commander'),role=>{
    if(role!=='manager'&&members.some(n=>n.parent===m.id))return toast('先调整下属的上级，再修改管理职责');change(()=>m.role=role);
  });
  if(m.parent)mountSelect('#edit-parent-wrap','edit-parent','上级',m.parent,parents(m.id),id=>change(()=>m.parent=id,'已更改上级'));
  mountSelect('#edit-model-wrap','edit-model','任务模型',m.model||'inherit',[['inherit','继承团队模型'],['qwen','Qwen3.7 Plus'],['deepseek','DeepSeek V4']],id=>change(()=>m.model=id));
  mountSelect('#edit-effort-wrap','edit-effort','思考强度',m.effort||'high',[['low','低'],['medium','中'],['high','高']],id=>change(()=>m.effort=id));
  root.querySelectorAll('[data-remove]').forEach(b=>b.onclick=()=>change(()=>m.deps=m.deps.filter(id=>id!==b.dataset.remove),'已移除交付关系'));
  $('#add-dependency').onclick=event=>{const options=members.filter(n=>n.id!==m.id&&!['commander','planner'].includes(n.id)&&!m.deps.includes(n.id)&&!dependencyCycle(n.id,m.id)).map(n=>[n.id,n.name]);if(!options.length||['commander','planner'].includes(m.id))return toast('当前没有可添加的前置交付');openMenu(event.currentTarget,options,'',id=>connect(id,m.id));};
  $('#close-details').onclick=()=>document.body.classList.remove('details-open');
  if($('#delete-member'))$('#delete-member').onclick=()=>{if(members.some(n=>n.parent===m.id))return toast('先调整下属的上级，再移除此管理成员');change(()=>{members=members.filter(n=>n.id!==m.id);members.forEach(n=>n.deps=n.deps.filter(id=>id!==m.id));selected='planner';},'已移除，可撤销');};
}
function renderNodes() {
  $('#nodes').innerHTML=members.map(m=>`<article class="node ${m.id===selected?'selected ':''}${m.role==='commander'?'commander':''}" style="left:${m.x}px;top:${m.y}px" data-node="${escape(m.id)}" tabindex="0" aria-label="${escape(m.name)}，${roleLabels[m.role]}，拖动排版或更改上级"><div class="node-head"><span class="node-icon">${icon(roleIcon(m.role))}</span><strong class="node-name">${escape(m.name)}</strong><span class="node-grip">${icon('grip')}</span></div><p class="node-work">${escape(m.work)}</p><div class="node-foot"><span>${m.model==='deepseek'?'DeepSeek V4':'Qwen3.7 Plus'} · ${{low:'低',medium:'中',high:'高'}[m.effort||'high']}</span><span class="node-role">${roleLabels[m.role]}</span></div>${!['commander','planner'].includes(m.id)?`<button class="port in" data-in="${escape(m.id)}" aria-label="连接交付到${escape(m.name)}" title="接收交付"></button><button class="port out" data-out="${escape(m.id)}" aria-label="从${escape(m.name)}连接交付" title="拖动连接交付"></button>`:''}</article>`).join('');
  document.querySelectorAll('[data-node]').forEach(el=>{
    el.onclick=event=>{if(event.target.closest('.port'))return;if(linkFrom){connect(linkFrom,el.dataset.node);return;}choose(el.dataset.node);if(innerWidth<=1100)document.body.classList.add('details-open');};
    el.onkeydown=event=>{if(event.target!==el)return;if(event.key==='Enter'){choose(el.dataset.node);document.body.classList.add('details-open');}else if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();const m=member(el.dataset.node);remember();m.x=Math.max(0,m.x+({ArrowLeft:-20,ArrowRight:20}[event.key]||0));m.y=Math.max(0,m.y+({ArrowUp:-20,ArrowDown:20}[event.key]||0));el.style.left=m.x+'px';el.style.top=m.y+'px';renderEdges();}};
    el.onpointerdown=event=>startPointer(event,el.dataset.node);
  });
  document.querySelectorAll('.port').forEach(el=>{
    el.onpointerdown=event=>{event.preventDefault();event.stopPropagation();if(el.dataset.in){if(linkFrom)connect(linkFrom,el.dataset.in);return;}linkFrom=el.dataset.out;document.body.classList.add('connecting');pointer={kind:'link',id:linkFrom,startX:event.clientX,startY:event.clientY};stage.setPointerCapture(event.pointerId);renderEdges();};
    el.onclick=event=>{event.stopPropagation();if(event.detail!==0)return;if(el.dataset.out){linkFrom=el.dataset.out;document.body.classList.add('connecting');toast('选择接收交付的成员');}else if(linkFrom)connect(linkFrom,el.dataset.in);};
  });
}
// Read the rendered ports in SVG coordinates: borders, zoom and panel resizing
// must affect the preview and the committed connection in exactly the same way.
function nodeBox(id) {
  const rect=$(`[data-node="${CSS.escape(id)}"]`).getBoundingClientRect(),matrix=$('#edges').getScreenCTM().inverse();
  const a=new DOMPoint(rect.left,rect.top).matrixTransform(matrix),b=new DOMPoint(rect.right,rect.bottom).matrixTransform(matrix);
  return {left:a.x,top:a.y,right:b.x,bottom:b.y};
}
function anchor(id,side='out') {
  const el=$(`[data-node="${CSS.escape(id)}"]`),port=el.querySelector(`.port.${side}`);
  if(port){const r=port.getBoundingClientRect();return new DOMPoint(r.left+r.width/2,r.top+r.height/2).matrixTransform($('#edges').getScreenCTM().inverse());}
  const box=nodeBox(id);return {x:side==='bottom'?(box.left+box.right)/2:side==='in'?box.left:box.right,y:side==='bottom'?box.bottom:(box.top+box.bottom)/2};
}
function roundedPath(points) {
  let d=`M${points[0].x},${points[0].y}`;
  for(let i=1;i<points.length-1;i++){
    const a=points[i-1],b=points[i],c=points[i+1],before=Math.hypot(b.x-a.x,b.y-a.y),after=Math.hypot(c.x-b.x,c.y-b.y),r=Math.min(12,before/2,after/2);
    if(!r){d+=` L${b.x},${b.y}`;continue;}
    d+=` L${b.x+(a.x-b.x)*r/before},${b.y+(a.y-b.y)*r/before} Q${b.x},${b.y} ${b.x+(c.x-b.x)*r/after},${b.y+(c.y-b.y)*r/after}`;
  }
  const end=points.at(-1);return d+` L${end.x},${end.y}`;
}
function connectionPath(from,end,to) {
  const start=anchor(from),gap=end.x-start.x;
  if(gap>=48||!to){const dx=Math.max(24,Math.abs(gap)/2);return `M${start.x},${start.y} C${start.x+dx},${start.y} ${end.x-dx},${end.y} ${end.x},${end.y}`;}
  const a=nodeBox(from),b=nodeBox(to),between=a.bottom+48<b.top?(a.bottom+b.top)/2:b.bottom+48<a.top?(b.bottom+a.top)/2:Math.max(a.bottom,b.bottom)+36;
  return roundedPath([start,{x:start.x+32,y:start.y},{x:start.x+32,y:between},{x:end.x-32,y:between},{x:end.x-32,y:end.y},end]);
}
function path(from,to) { return member(from)&&member(to)?connectionPath(from,anchor(to,'in'),to):''; }
function linkTarget(event,from) {
  const p=point(event),radius=24/camera.scale;
  return members.find(m=>{
    if(m.id===from||['commander','planner'].includes(m.id))return false;
    const box=nodeBox(m.id),port=anchor(m.id,'in');
    return Math.hypot(p.x-port.x,p.y-port.y)<=radius||(p.x>=box.left&&p.x<=box.right&&p.y>=box.top&&p.y<=box.bottom);
  })?.id;
}
function renderEdges() {
  const edges=view==='hierarchy'?members.filter(m=>m.parent).map(m=>[m.parent,m.id]):members.flatMap(m=>m.deps.map(id=>[id,m.id]));
  let html=`<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M2 1L9 5 2 9" fill="none" stroke="var(--line)" stroke-width="1.5"/></marker></defs>`;
  if(view==='delivery')html+=members.filter(m=>m.id==='planner'||(!['commander','planner'].includes(m.id)&&!m.deps.length)).map(m=>`<path class="route" d="${path(m.id==='planner'?'commander':'planner',m.id)}" opacity=".65"/>`).join('');
  html+=edges.map(([from,to])=>`<g><path class="route ${view==='delivery'?'delivery':''} ${to===selected?'selected':''}" d="${path(from,to)}" marker-end="url(#arrow)"/>${view==='delivery'?`<path class="route-hit" data-from="${escape(from)}" data-to="${escape(to)}" d="${path(from,to)}"/>`:''}</g>`).join('');
  if(view==='delivery'&&member('reviewer')&&member('planner')){const a=anchor('reviewer','bottom'),b=anchor('planner','bottom'),bottom=Math.max(...members.map(m=>nodeBox(m.id).bottom))+60;html+=`<path class="route return" d="${roundedPath([a,{x:a.x,y:bottom},{x:b.x,y:bottom},b])}"/><text class="route-label" x="${(a.x+b.x)/2}" y="${bottom-10}">检验未通过 · 返回策划</text>`;}
  const target=linkFrom&&pointer?.target,valid=target&&!member(target).deps.includes(linkFrom)&&!dependencyCycle(linkFrom,target);
  document.querySelectorAll('.node').forEach(el=>el.classList.toggle('link-target',Boolean(valid&&el.dataset.node===target)));
  if(linkFrom){const a=anchor(linkFrom),p=valid?anchor(target,'in'):pointer?.end||{x:a.x+72,y:a.y};html+=`<path class="route-preview" d="${connectionPath(linkFrom,p,valid?target:undefined)}"/>`;}
  $('#edges').innerHTML=html;document.querySelectorAll('.route-hit').forEach(el=>el.onclick=()=>{selectedEdge=[el.dataset.from,el.dataset.to];$('#edge-label').textContent=`${member(selectedEdge[0]).name} → ${member(selectedEdge[1]).name}`;$('#edge-action').hidden=false;});
}
function transform(){world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.scale})`;$('#zoom-value').textContent=Math.round(camera.scale*100)+'%';}
function fit(){const r=stage.getBoundingClientRect(),left=Math.min(...members.map(m=>m.x)),top=Math.min(...members.map(m=>m.y)),width=Math.max(...members.map(m=>m.x+224))-left,height=Math.max(...members.map(m=>m.y+132))-top+75;camera.scale=Math.max(.8,Math.min(1,(r.width-70)/width,(r.height-85)/height));const focus=member(selected);camera.x=width*camera.scale>r.width?r.width/2-(focus.x+112)*camera.scale:(r.width-width*camera.scale)/2-left*camera.scale;camera.y=height*camera.scale>r.height?r.height/2-(focus.y+66)*camera.scale:(r.height-height*camera.scale)/2-top*camera.scale;transform();}
function point(event){const r=stage.getBoundingClientRect();return{x:(event.clientX-r.left-camera.x)/camera.scale,y:(event.clientY-r.top-camera.y)/camera.scale};}
function startPointer(event,id){if(event.button!==0||event.target.closest('.port'))return;closeMenu();const m=member(id);pointer={kind:'node',id,startX:event.clientX,startY:event.clientY,x:m.x,y:m.y,before:structuredClone(members),moved:false};stage.setPointerCapture(event.pointerId);}
stage.onpointerdown=event=>{if(event.button!==0||event.target.closest('.node,button,.zoom,#edge-action,.route-hit'))return;closeMenu();pointer={kind:'pan',startX:event.clientX,startY:event.clientY,x:camera.x,y:camera.y};stage.setPointerCapture(event.pointerId);};
stage.onpointermove=event=>{
  if(!pointer)return;const dx=event.clientX-pointer.startX,dy=event.clientY-pointer.startY;
  if(pointer.kind==='pan'){camera.x=pointer.x+dx;camera.y=pointer.y+dy;transform();return;}
  if(pointer.kind==='link'){pointer.end=point(event);pointer.target=linkTarget(event,pointer.id);renderEdges();return;}
  if(!pointer.moved&&Math.hypot(dx,dy)<5)return;pointer.moved=true;const m=member(pointer.id);m.x=Math.max(0,Math.min(1600,pointer.x+dx/camera.scale));m.y=Math.max(0,Math.min(950,pointer.y+dy/camera.scale));
  const el=$(`[data-node="${m.id}"]`);el.classList.add('dragging');el.style.left=m.x+'px';el.style.top=m.y+'px';
  const p=point(event);pointer.target=members.find(n=>n.id!==m.id&&n.role==='manager'&&!isDescendant(n.id,m.id)&&p.x>=n.x&&p.x<=n.x+224&&p.y>=n.y&&p.y<=n.y+132)?.id;
  document.querySelectorAll('.node').forEach(n=>n.classList.toggle('drop-target',n.dataset.node===pointer.target));renderEdges();
};
stage.onpointerup=event=>{
  if(!pointer)return;const operation=pointer;pointer=null;if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
  if(operation.kind==='link'){const target=linkTarget(event,operation.id);if(target)connect(operation.id,target);else if(Math.hypot(event.clientX-operation.startX,event.clientY-operation.startY)>5){endLink();renderEdges();}return;}
  if(operation.kind!=='node')return;
  if(!operation.moved){choose(operation.id);return;}
  remember(operation.before);const m=member(operation.id);selected=m.id;if(operation.target&&m.id!=='commander'){m.parent=operation.target;m.x=operation.x;m.y=operation.y;toast(`${m.name}已归入${member(operation.target).name}`);}render();
};
stage.onpointercancel=()=>{if(pointer?.kind==='node')members=pointer.before;pointer=null;endLink();render();};
function zoom(factor){const r=stage.getBoundingClientRect(),next=Math.min(1.7,Math.max(.3,camera.scale*factor)),ratio=next/camera.scale;camera.x=r.width/2-(r.width/2-camera.x)*ratio;camera.y=r.height/2-(r.height/2-camera.y)*ratio;camera.scale=next;transform();}
stage.addEventListener('wheel',event=>{event.preventDefault();if(event.ctrlKey||event.metaKey)zoom(event.deltaY<0?1.08:1/1.08);else{camera.x-=event.deltaX;camera.y-=event.deltaY;transform();}},{passive:false});
function render(){document.body.dataset.view=view;$('#hierarchy').setAttribute('aria-selected',String(view==='hierarchy'));$('#delivery').setAttribute('aria-selected',String(view==='delivery'));$('#legend-text').textContent=view==='hierarchy'?'归属关系':'交付依赖 · 虚线回到策划复核';$('#team-count').textContent=`${members.length} 个角色`;$('#edge-action').hidden=true;$('#undo').disabled=!history.length;renderNodes();renderEdges();renderInspector();}
function showAdd(){closeMenu();formDraft={role:'implementer',parent:['manager','commander'].includes(member(selected)?.role)?selected:'planner',model:'inherit',effort:'high'};$('#member-form').reset();$('#member-properties').innerHTML=field('任务模型','new-model','<div id="new-model-wrap"></div>')+field('思考强度','new-effort','<div id="new-effort-wrap"></div>')+field('上级','new-parent','<div id="new-parent-wrap"></div>')+field('职责','new-role','<div id="new-role-wrap"></div>');
  const controls=[['model','任务模型',[['inherit','继承团队模型 · Qwen3.7 Plus 高'],['qwen','Qwen3.7 Plus'],['deepseek','DeepSeek V4']]],['effort','思考强度',[['low','低'],['medium','中'],['high','高']]],['parent','上级',parents('new')],['role','职责',Object.entries(roleLabels).filter(([id])=>id!=='commander')]];
  const draw=()=>controls.forEach(([key,label,options])=>mountSelect(`#new-${key}-wrap`,`new-${key}`,label,formDraft[key],options,value=>{formDraft[key]=value;draw();$(`#new-${key}`).focus();}));draw();$('#member-dialog').showModal();$('#member-name').focus();}
$('#member-form').onsubmit=event=>{event.preventDefault();const name=$('#member-name').value.trim(),work=$('#member-work').value.trim();if(!name||!work)return toast('请填写名称和分工');const parent=member(formDraft.parent);change(()=>{const id=crypto.randomUUID();members.push({id,name,work,...formDraft,deps:[],x:parent.x+286,y:Math.min(900,Math.max(...members.filter(m=>m.x>=parent.x+224).map(m=>m.y+170),parent.y))});selected=id;},'已添加到演示草稿');$('#member-dialog').close();fit();};
$('#add-member').onclick=showAdd;
for(const id of ['#cancel-dialog','#close-dialog'])$(id).onclick=()=>{closeMenu();$('#member-dialog').close();};
$('#member-dialog').addEventListener('cancel',event=>{if(activeMenu){event.preventDefault();closeMenu(true);}});
$('#hierarchy').onclick=()=>{view='hierarchy';render();};$('#delivery').onclick=()=>{view='delivery';render();};
$('#undo').onclick=()=>{if(!history.length)return;members=history.pop();if(!member(selected))selected='planner';dirty=true;render();toast('已撤销');};
$('#remove-edge').onclick=()=>{if(selectedEdge){const [from,to]=selectedEdge;change(()=>member(to).deps=member(to).deps.filter(id=>id!==from),'已移除交付关系');}};
$('#arrange').onclick=()=>{change(()=>{
  const depths=new Map(),columns=new Map();
  const depth=(m,seen=new Set())=>{
    if(depths.has(m.id))return depths.get(m.id);if(seen.has(m.id))return 0;
    const inputs=view==='hierarchy'?[m.parent]:m.deps.length?m.deps:[m.id==='commander'?null:m.id==='planner'?'commander':'planner'];
    const value=Math.max(0,...inputs.filter(id=>member(id)).map(id=>depth(member(id),new Set([...seen,m.id]))+1));depths.set(m.id,value);return value;
  };
  for(const m of members){const column=depth(m);if(!columns.has(column))columns.set(column,[]);columns.get(column).push(m);}
  const rows=Math.max(...[...columns.values()].map(list=>list.length));
  for(const [column,list] of columns)list.forEach((m,index)=>{m.x=40+286*column;m.y=70+((rows-list.length)/2+index)*180;});
},'已按当前关系整理位置');fit();};
$('#save').onclick=()=>{try{localStorage.setItem(key,JSON.stringify(members));dirty=false;$('#save-state').textContent='草稿已保存在此浏览器';toast('已保存 Demo 草稿，没有派出真实任务');}catch{toast('浏览器无法保存，请保留当前页面');}};
$('#reset').onclick=()=>{change(()=>{members=structuredClone(initial);selected='frontend';view='hierarchy';},'已重置示例，可撤销');fit();};
$('#zoom-out').onclick=()=>zoom(1/1.15);$('#zoom-in').onclick=()=>zoom(1.15);$('#fit').onclick=fit;
$('#theme').onclick=()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';};
$('#toggle-details').onclick=()=>{if(innerWidth<=1100)document.body.classList.toggle('details-open');else document.body.classList.toggle('details-hidden');};
const splitter=$('#splitter');splitter.onpointerdown=event=>{splitter.setPointerCapture(event.pointerId);};splitter.onpointermove=event=>{if(splitter.hasPointerCapture(event.pointerId)){document.documentElement.style.setProperty('--inspector-width',Math.min(450,Math.max(270,innerWidth-event.clientX))+'px');}};splitter.onpointerup=event=>splitter.releasePointerCapture(event.pointerId);splitter.onkeydown=event=>{if(['ArrowLeft','ArrowRight'].includes(event.key)){event.preventDefault();const w=$('#inspector').offsetWidth;document.documentElement.style.setProperty('--inspector-width',Math.min(450,Math.max(270,w+(event.key==='ArrowLeft'?20:-20)))+'px');}};
window.addEventListener('resize',()=>{closeMenu();fit();});
render();fit();
