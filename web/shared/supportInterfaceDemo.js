import {writeZip} from '../zip.js';

// A generated, openly reusable test arch. No user models or remote assets.
export async function interfaceDemoFile() {
  const boxes=[
    [0,0,0,10,18,32,3], [50,0,0,10,18,32,3],
    [0,0,32,20,18,8,1], [20,0,32,20,18,8,4], [40,0,32,20,18,8,2],
  ];
  const faces=[[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],
    [1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  const meshes=boxes.map(([x,y,z,w,d,h],i)=>{
    const vertices=[[x,y,z],[x+w,y,z],[x+w,y+d,z],[x,y+d,z],
      [x,y,z+h],[x+w,y,z+h],[x+w,y+d,z+h],[x,y+d,z+h]];
    return `<object id="${i+1}" type="model"><mesh><vertices>${vertices.map(([x,y,z])=>`<vertex x="${x}" y="${y}" z="${z}"/>`).join('')}</vertices><triangles>${faces.map(([a,b,c])=>`<triangle v1="${a}" v2="${b}" v3="${c}"/>`).join('')}</triangles></mesh></object>`;
  }).join('');
  const model=`<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">BambuStudio-2.3.0</metadata><metadata name="Title">Four-colour support arch</metadata><resources>${meshes}<object id="10" type="model"><components>${boxes.map((_,i)=>`<component objectid="${i+1}"/>`).join('')}</components></object></resources><build><item objectid="10" transform="1 0 0 0 1 0 0 0 1 105 120 0"/></build></model>`;
  const config=`<config><object id="10"><metadata key="name" value="Four-colour support arch"/><metadata key="extruder" value="3"/>${boxes.map((b,i)=>`<part id="${i+1}" subtype="normal_part"><metadata key="name" value="Arch part ${i+1}"/><metadata key="extruder" value="${b[6]}"/></part>`).join('')}</object><plate><metadata key="plater_id" value="1"/><metadata key="plater_name" value="Interface demo"/><model_instance><metadata key="object_id" value="10"/><metadata key="instance_id" value="0"/></model_instance></plate></config>`;
  const settings={filament_colour:['#FFFFFF','#000000','#B50020','#8E8891'],filament_type:['PLA','PLA','PLA','PLA'],
    layer_height:'0.2',nozzle_diameter:['0.4'],enable_support:'1',support_type:'normal(auto)',support_on_build_plate_only:'1'};
  const enc=new TextEncoder();
  const entries=[['3D/3dmodel.model',model],['Metadata/model_settings.config',config],['Metadata/project_settings.config',JSON.stringify(settings)],
    ['[Content_Types].xml','<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'],
    ['_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>']];
  return writeZip(entries.map(([name,value])=>({name,data:enc.encode(value)})));
}
