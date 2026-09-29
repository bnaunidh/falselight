// Reusable traps. State lives on inventory items, so placing, picking up and saving use the normal inventory.
export const TRAPPER = { x:-300, z:185 };
export const trapFor = (items,who) => items.find(i=>i.kind==='trap'&&i.where==='world'&&i.trapState==='sprung'&&i.caught===who) || null;
export function armTrap(it) {
  if(!it||it.kind!=='trap'||it.where!=='world'||it.caught||it.pos?.[1]==null)return false;
  it.trapState='armed';it.armGrace=1.5;return true;
}
export function disarmTrap(it) {
  if(!it||it.kind!=='trap'||it.caught)return false;
  it.trapState='safe';it.armGrace=0;return true;
}
export function releaseTrap(it) {
  if(!it?.caught)return null;
  const who=it.caught;it.caught=null;it.trapState='safe';it.armGrace=0;it.caughtSeconds=0;return who;
}
// Swept foot contact catches a running bear too, but never a teleport or an animal on the floor above.
function contact(p,old,t,radius) {
  if(!p||Math.abs(p[1]-t[1])>.42)return false;
  if(!old||Math.hypot(p[0]-old[0],p[2]-old[2])>3||Math.abs(old[1]-t[1])>.42)return Math.hypot(p[0]-t[0],p[2]-t[2])<radius;
  const dx=p[0]-old[0],dz=p[2]-old[2],l=dx*dx+dz*dz;
  const u=l?Math.max(0,Math.min(1,((t[0]-old[0])*dx+(t[2]-old[2])*dz)/l)):0;
  return Math.hypot(old[0]+dx*u-t[0],old[2]+dz*u-t[2])<radius;
}
export function tickTraps(items,dt,actors,previous={}) {
  const events=[];
  for(const it of items) {
    if(it.kind!=='trap'||it.where!=='world'||!it.pos)continue;
    if(it.caught) {
      // The bear eventually tears free; Juniper and the player need a helping hand, never an automatic death.
      it.caughtSeconds=(it.caughtSeconds||0)+dt;
      if(it.caught==='bear'&&it.caughtSeconds>=18){releaseTrap(it);events.push({type:'escape',who:'bear',item:it});}
      continue;
    }
    if(it.trapState!=='armed')continue;
    if(it.armGrace>0){it.armGrace=Math.max(0,it.armGrace-dt);continue;}
    for(const who of ['player','dog','bear']) {
      if(trapFor(items,who))continue;
      if(contact(actors[who],previous[who],it.pos,who==='bear'?.48:.30)) {
        it.trapState='sprung';it.caught=who;it.caughtSeconds=0;events.push({type:'caught',who,item:it});break;
      }
    }
  }
  return events;
}
