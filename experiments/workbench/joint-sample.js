import {writeZip} from '../../web/zip.js';
import {encode} from '../../web/shared/paint.js';

// Generated geometry for trying colour separation. No private model data.
export async function jointSampleFile(){
  const profile=[[0,20],[2,24],[6,29],[14,32],[23,29],[29,22],[32,10],[33,5],[36,5],[43,4.5],[45,3]],steps=64,points=[],faces=[];
  for(const [z,r]of profile)for(let i=0;i<steps;i++){const angle=i*Math.PI*2/steps,radius=r*(1+.035*Math.cos(angle*8));points.push([radius*Math.cos(angle),radius*Math.sin(angle),z]);}
  for(let j=0;j<profile.length-1;j++)for(let i=0;i<steps;i++){const a=j*steps+i,b=j*steps+(i+1)%steps,c=(j+1)*steps+(i+1)%steps,d=(j+1)*steps+i,colour=j>=7?2:1;faces.push({ids:[a,b,c],colour},{ids:[a,c,d],colour});}
  const bottom=points.push([0,0,0])-1,top=points.push([0,0,45])-1;
  for(let i=0;i<steps;i++){faces.push({ids:[bottom,(i+1)%steps,i],colour:1},{ids:[top,(profile.length-1)*steps+i,(profile.length-1)*steps+(i+1)%steps],colour:2});}
  const model=`<model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Title">Colour split sample</metadata><resources><object id="1" type="model"><mesh><vertices>${points.map(([x,y,z])=>`<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${faces.map(f=>`<triangle v1="${f.ids[0]}" v2="${f.ids[1]}" v3="${f.ids[2]}" paint_color="${encode({kind:'leaf',state:f.colour})}"/>`).join('')}</triangles></mesh></object></resources><build><item objectid="1" transform="1 0 0 0 1 0 0 0 1 130 130 0"/></build></model>`;
  const config='<config><object id="1"><metadata key="name" value="Pumpkin with green stalk · sample"/><metadata key="extruder" value="1"/></object><plate><metadata key="plater_name" value="Colour split sample"/><model_instance><metadata key="object_id" value="1"/><metadata key="instance_id" value="0"/></model_instance></plate></config>';
  const entries=[['3D/3dmodel.model',model],['Metadata/model_settings.config',config],['Metadata/project_settings.config',JSON.stringify({filament_colour:['#F58231','#22864C'],filament_type:['PLA','PLA'],layer_height:'0.2',nozzle_diameter:['0.4']})],['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>']];
  const enc=new TextEncoder();return writeZip(entries.map(([name,data])=>({name,data:enc.encode(data)})));
}
