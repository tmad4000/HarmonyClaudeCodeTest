"""Store Conv weights as FP16, cast back to FP32 for existing browser kernels.
Modified weights: storage precision reduced, no fine-tuning or graph arithmetic changes.
"""
from pathlib import Path
import onnx,numpy as np,json,hashlib,gzip
from onnx import numpy_helper,helper,TensorProto
import argparse
parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,required=True);parser.add_argument('--output-directory',type=Path,required=True);args=parser.parse_args()
root=args.output_directory;root.mkdir(parents=True,exist_ok=True)
m=onnx.load(args.input);casts=[];count=0
for i in m.graph.initializer:
 if i.data_type==TensorProto.FLOAT and np.prod(i.dims)>1024:
  name=i.name; a=numpy_helper.to_array(i).astype(np.float16)
  i.CopyFrom(numpy_helper.from_array(a,name=name+'__fp16_storage'))
  casts.append(helper.make_node('Cast',[i.name],[name],to=TensorProto.FLOAT,name=name+'__restore_fp32'))
  count+=1
nodes=list(m.graph.node);del m.graph.node[:];m.graph.node.extend(casts+nodes)
onnx.checker.check_model(m)
p=root/'model-storage-fp16.onnx';onnx.save(m,p)
report={'modified_tensors':count,'original_bytes':args.input.stat().st_size,'packed_bytes':p.stat().st_size,'gzip_bytes':len(gzip.compress(p.read_bytes())),'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'method':'Conv weight storage FP16; Cast restores FP32 before arithmetic; no fine-tuning'}
(root/'model-pack.json').write_text(json.dumps(report,indent=2));print(report)

b=p.read_bytes();mid=(len(b)+1)//2
(root/'model-1.bin').write_bytes(b[:mid]);(root/'model-2.bin').write_bytes(b[mid:])
