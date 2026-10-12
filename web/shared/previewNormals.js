// Preview lighting only: colours, topology and export geometry are untouched.
export function smoothPreviewNormals(positions,flat,creaseCos=.6){
  const buckets=new Map(),keys=new Array(positions.length/3);
  for(let i=0;i<positions.length;i+=3){
    const key=`${Math.round(positions[i]*1e5)},${Math.round(positions[i+1]*1e5)},${Math.round(positions[i+2]*1e5)}`;keys[i/3]=key;
    let bucket=buckets.get(key);if(!bucket){bucket=[];buckets.set(key,bucket);}bucket.push(i);
  }
  const result=new Float32Array(flat.length);
  for(let i=0;i<positions.length;i+=3){let x=0,y=0,z=0;
    for(const j of buckets.get(keys[i/3]))if(flat[i]*flat[j]+flat[i+1]*flat[j+1]+flat[i+2]*flat[j+2]>=creaseCos){x+=flat[j];y+=flat[j+1];z+=flat[j+2];}
    const length=Math.hypot(x,y,z)||1;result[i]=x/length;result[i+1]=y/length;result[i+2]=z/length;
  }
  return result;
}
