import './hollowRadio.css';

export class HollowRadio {
  constructor(root,missions,journal,dispatch,capture){
    const panel=document.createElement('aside');panel.className='hollow-radio';panel.hidden=true;
    panel.innerHTML='<button type="button" class="hc-toggle" aria-expanded="false">Garage radio</button><output class="hc-nav"></output><section hidden><label>Dispatch<select></select></label><p></p><button class="hc-start" type="button">Accept mission</button><button type="button" class="hc-photo">Take photo</button><details><summary>Field settings</summary></details><small></small></section>';
    this.panel=panel;this.sheet=panel.querySelector('section');this.nav=panel.querySelector('output');
    const toggle=panel.querySelector('.hc-toggle'),select=panel.querySelector('select'),notes=panel.querySelector('p');
    this.select=select;this.journal=journal;this.missions=missions;this.status=panel.querySelector('small');
    for(const def of missions)select.add(new Option(def.name,def.id));
    const describe=()=>{notes.textContent=missions.find(m=>m.id===select.value).instruction;};
    select.addEventListener('change',describe);describe();
    toggle.onclick=()=>{this.sheet.hidden=!this.sheet.hidden;toggle.setAttribute('aria-expanded',String(!this.sheet.hidden));this.refresh();};
    panel.querySelector('.hc-start').onclick=()=>{this.sheet.hidden=true;toggle.setAttribute('aria-expanded','false');dispatch(select.value);};
    panel.querySelector('.hc-photo').onclick=capture;
    const details=panel.querySelector('details');
    for(const [key,title] of Object.entries({ambience:'Wind',music:'Drone',effects:'Environmental sounds',scares:'Jump scares',weather:'Mist and drizzle'})){
      const label=document.createElement('label');label.textContent=title;const input=document.createElement('input');
      input.type='range';input.min=0;input.max=1;input.step=.05;input.value=journal.settings[key];
      input.oninput=()=>{journal.settings[key]=Number(input.value);journal.save();};label.append(input);details.append(label);
    }
    root.append(panel);this.refresh();
  }
  refresh(){
    for(const o of this.select.options){
      const m=this.missions.find(d=>d.id===o.value);o.textContent=(this.journal.completed.has(m.id)?'✓ ':'')+m.name;
    }
    this.status.textContent=this.journal.found.size+' / 8 locations   ·   '+this.journal.completed.size+' / '+this.missions.length+' missions';
  }
  dispose(){this.panel.remove();}
}
