import * as THREE from 'three';
import {TRAPPER} from './traps.js?v=4df4ed7c0f218f54';
import {cullTrees,sceneMaterials} from './fireCache.js?v=d62e642fa3a7ab78';

export async function createTrapperCabin(engine) {
 const W=engine.world,{x,z}=TRAPPER;
 // Keep the old cabin floor level without modifying the terrain or the source world.
 const y=Math.max(...[-2,0,2].flatMap(dx=>[-2,0,2].map(dz=>W.heightAt(x+dx,z+dz))))+.03;
 const root=await W.addModel('prop_trapper_cabin',new THREE.Vector3(x,y,z));
 if(!root)return null;
 const materials=sceneMaterials(W),wood=materials.get('FL_tw_timber'),roof=materials.get('FL_tw_roof');
 root.traverse(o=>{if(o.isMesh&&!o.name.startsWith('COL_')){if(o.material?.name==='FL_trapper_wood'&&wood)o.material=wood;else if(o.material?.name==='FL_trapper_roof'&&roof)o.material=roof;}});
 // A short entry ramp follows the real ground: the new threshold must not become an un-climbable ledge.
 const end=W.heightAt(x,z+4.8)+.025,g=new THREE.BufferGeometry();
 g.setAttribute('position',new THREE.Float32BufferAttribute([x-.52,y+.063,z+1.98,x+.52,y+.063,z+1.98,x-.52,end,z+4.8,x+.52,end,z+4.8],3));g.setIndex([0,2,1,1,2,3]);g.computeVertexNormals();
 const ramp=new THREE.Mesh(g,wood||new THREE.MeshStandardMaterial({color:0x5c5040,roughness:.9}));ramp.name='FL_trapper_entry';ramp.receiveShadow=true;engine.scene.add(ramp);W.colliders.push({name:'COL_ramp_trapper_entry',type:'ramp',mesh:ramp,enabled:true});W._collidersDirty=true;
 const clear=()=>{const list=[];for(const vs of W.vegSets||[])for(const p of vs.inst||[])if(Math.abs(p[0]-x)<3.5&&p[2]>z-3&&p[2]<z+5.5)list.push([vs.kind,p[0],p[2]]);cullTrees(W,list);};
 clear();engine.stream?.ready('D').then(clear);
 let acc=0;engine.onUpdate(dt=>{if((acc-=dt)>0)return;acc=1;const close=engine.player.position.distanceTo(root.position)<220;root.visible=close;ramp.visible=close;});
 return {root,floor:y+.08};
}
