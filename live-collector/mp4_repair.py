"""Repair missing AAC AudioSpecificConfig in old fragmented MP4, in memory.
Only accepts AAC-LC MP4 sample entries; fragment media bytes are preserved.
"""
import struct
RATES=[96000,88200,64000,48000,44100,32000,24000,22050,16000,12000,11025,8000,7350]
def boxes(data):
 offset=0
 while offset<len(data):
  if offset+8>len(data):raise ValueError('Truncated MP4 box')
  size,kind=struct.unpack_from('>I4s',data,offset)
  if size<8 or offset+size>len(data):raise ValueError('Unsupported MP4 box')
  yield kind,data[offset+8:offset+size]
  offset+=size

def box(kind,payload):return struct.pack('>I4s',len(payload)+8,kind)+payload

def descriptor(data,offset=0):
 tag=data[offset];length=0;start=offset+1
 for _ in range(4):
  b=data[start];start+=1;length=(length<<7)|(b&127)
  if not b&128:break
 else:raise ValueError('Invalid descriptor length')
 end=start+length
 if end>len(data):raise ValueError('Truncated descriptor')
 return tag,data[start:end],end

def desc(tag,payload):
 n=len(payload)
 return bytes([tag,128|((n>>21)&127),128|((n>>14)&127),128|((n>>7)&127),n&127])+payload

def repair_moov(data):
 def children(payload):return b''.join(transform(kind,value) for kind,value in boxes(payload))
 def transform(kind,payload):
  if kind in [b'moov',b'trak',b'mdia',b'minf',b'stbl']:payload=children(payload)
  elif kind==b'stsd':payload=payload[:8]+children(payload[8:])
  elif kind==b'mp4a':
   if struct.unpack_from('>H',payload,8)[0]!=0:raise ValueError('Unsupported audio sample entry')
   channels=struct.unpack_from('>H',payload,16)[0];rate=struct.unpack_from('>I',payload,24)[0]>>16
   updated=[]
   for child,value in boxes(payload[28:]):
    if child==b'esds':
     tag,es,end=descriptor(value,4)
     if tag!=3 or es[2]!=0:raise ValueError('Unsupported ES descriptor')
     tag,decoder,next_offset=descriptor(es,3)
     if tag!=4 or decoder[0]!=0x40:raise ValueError('Unsupported audio codec')
     if len(decoder)==13:
      if rate not in RATES or not 1<=channels<=7:raise ValueError('Unsupported AAC rate/channels')
      config=((2<<11)|(RATES.index(rate)<<7)|(channels<<3)).to_bytes(2,'big')
      decoder+=desc(5,config)
      value=value[:4]+desc(3,es[:3]+desc(4,decoder)+es[next_offset:])+value[end:]
    updated.append(box(child,value))
   payload=payload[:28]+b''.join(updated)
  return box(kind,payload)
 return children(data)

def repair_mfra(data,delta):
 if not delta:return data
 updated=[]
 for kind,payload in boxes(data):
  if kind==b'mfra':payload=repair_mfra(payload,delta)
  elif kind==b'tfra':
   payload=bytearray(payload);version=payload[0]
   lengths=struct.unpack_from('>I',payload,8)[0];count=struct.unpack_from('>I',payload,12)[0]
   skip=((lengths>>4)&3)+1+((lengths>>2)&3)+1+(lengths&3)+1
   width=8 if version==1 else 4;position=16
   for _ in range(count):
    position+=width
    fmt='>Q' if width==8 else '>I';offset=struct.unpack_from(fmt,payload,position)[0];struct.pack_into(fmt,payload,position,offset+delta);position+=width+skip
  updated.append(box(kind,payload))
 return b''.join(updated)
