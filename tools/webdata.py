"""Read and write Unity's UnityWebData1.0 container (Build/*_data.unityweb)."""
import struct

MAGIC = b'UnityWebData1.0\0'

def read(blob):
    assert blob[:16] == MAGIC
    end = struct.unpack_from('<I', blob, 16)[0]; p = 20; files = []
    while p < end:
        off, size, n = struct.unpack_from('<III', blob, p); p += 12
        files.append([blob[p:p + n].decode(), blob[off:off + size]]); p += n
    return files

def write(files):
    names = [f[0].encode() for f in files]
    end = 20 + sum(12 + len(n) for n in names)
    out = bytearray(MAGIC) + struct.pack('<I', end); off = end
    for (name, data), n in zip(files, names):
        out += struct.pack('<III', off, len(data), len(n)) + n; off += len(data)
    for _, data in files: out += data
    return bytes(out)
