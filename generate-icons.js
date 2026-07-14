import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const ICONS_DIR = path.join(process.cwd(), 'src-tauri', 'icons');

if (!fs.existsSync(ICONS_DIR)) {
  fs.mkdirSync(ICONS_DIR, { recursive: true });
}

// CRC32 implementation for PNG chunks
const crcTable = [];
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    if (c & 1) {
      c = 0xedb88320 ^ (c >>> 1);
    } else {
      c = c >>> 1;
    }
  }
  crcTable[n] = c;
}

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Procedural 3D database stack icon drawer
function drawDatabaseIcon(width, height) {
  const bpp = 4;
  const data = Buffer.alloc(width * height * bpp);

  const cx = width / 2;
  const rx = width * 0.28; 
  const ry = height * 0.08; 

  const cy1 = height * 0.28; 
  const cy2 = height * 0.50; 
  const cy3 = height * 0.72; 

  const cylHeight = height * 0.12;

  const checkDisc = (x, y, cy) => {
    const dx = (x - cx) / rx;
    const dy = (y - cy) / ry;
    return (dx * dx + dy * dy <= 1);
  };

  const checkWall = (x, y, cyTop, cyBot) => {
    const inWidth = Math.abs(x - cx) <= rx;
    const inHeight = y >= cyTop && y <= cyBot;
    return inWidth && inHeight;
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * bpp;

      let inCylinder = false;
      let depthFactor = 0;

      // Top disc
      if (checkDisc(x, y, cy1)) {
        inCylinder = true;
        depthFactor = 1 - Math.sqrt((x - cx) * (x - cx) / (rx * rx) + (y - cy1) * (y - cy1) / (ry * ry));
      }
      // Top cylinder body
      else if (checkWall(x, y, cy1, cy1 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }
      // Top cylinder bottom lip
      else if (checkDisc(x, y, cy1 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }

      // Middle disc body & top curve
      if (checkDisc(x, y, cy2)) {
        inCylinder = true;
        depthFactor = 1 - Math.sqrt((x - cx) * (x - cx) / (rx * rx) + (y - cy2) * (y - cy2) / (ry * ry));
      }
      else if (checkWall(x, y, cy2, cy2 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }
      else if (checkDisc(x, y, cy2 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }

      // Bottom disc body & top curve
      if (checkDisc(x, y, cy3)) {
        inCylinder = true;
        depthFactor = 1 - Math.sqrt((x - cx) * (x - cx) / (rx * rx) + (y - cy3) * (y - cy3) / (ry * ry));
      }
      else if (checkWall(x, y, cy3, cy3 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }
      else if (checkDisc(x, y, cy3 + cylHeight)) {
        inCylinder = true;
        depthFactor = 1 - Math.abs(x - cx) / rx;
      }

      if (inCylinder) {
        // Vibrant developer blue gradient: #3b82f6 with depth highlighting
        const highlight = Math.floor(depthFactor * 80);
        const r = Math.min(255, 30 + highlight);
        const g = Math.min(255, 100 + highlight * 1.5);
        const b = Math.min(255, 230 + highlight * 0.3);
        
        data.writeUInt8(r, idx);     // R
        data.writeUInt8(g, idx + 1); // G
        data.writeUInt8(b, idx + 2); // B
        data.writeUInt8(255, idx + 3); // A
      } else {
        data.writeUInt8(0, idx);
        data.writeUInt8(0, idx + 1);
        data.writeUInt8(0, idx + 2);
        data.writeUInt8(0, idx + 3);
      }
    }
  }

  return data;
}

// Pure Node.js PNG Encoder
function makePng(rgbaBuffer, width, height) {
  const header = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  
  // IHDR chunk
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(width, 0);
  ihdrData.writeUInt32BE(height, 4);
  ihdrData.writeUInt8(8, 8); // depth (8 bits)
  ihdrData.writeUInt8(6, 9); // color type (RGBA = 6)
  ihdrData.writeUInt8(0, 10); // compression
  ihdrData.writeUInt8(0, 11); // filter
  ihdrData.writeUInt8(0, 12); // interlace
  
  const ihdrChunk = makeChunk('IHDR', ihdrData);
  
  // IDAT chunk (with scanline filter byte = 0)
  const scanlineSize = width * 4 + 1;
  const rawBuffer = Buffer.alloc(height * scanlineSize);
  for (let y = 0; y < height; y++) {
    rawBuffer[y * scanlineSize] = 0; // Filter 0 (None)
    const src = y * width * 4;
    const dest = y * scanlineSize + 1;
    rgbaBuffer.copy(rawBuffer, dest, src, src + width * 4);
  }
  const compressed = zlib.deflateSync(rawBuffer);
  const idatChunk = makeChunk('IDAT', compressed);
  
  // IEND chunk
  const iendChunk = makeChunk('IEND', Buffer.alloc(0));
  
  return Buffer.concat([header, ihdrChunk, idatChunk, iendChunk]);
}

function makeChunk(type, data) {
  const buf = Buffer.alloc(4 + type.length + data.length + 4);
  buf.writeUInt32BE(data.length, 0);
  buf.write(type, 4);
  data.copy(buf, 8);
  const crc = crc32(buf.subarray(4, 8 + data.length));
  buf.writeUInt32BE(crc, 8 + data.length);
  return buf;
}

// Pure Node.js uncompressed DIB ICO Generator
function generateIcoFile(sizes) {
  const icoHeader = Buffer.alloc(6);
  icoHeader.writeUInt16LE(0, 0);
  icoHeader.writeUInt16LE(1, 2); // Type 1 = ICO
  icoHeader.writeUInt16LE(sizes.length, 4);

  const directories = [];
  const dibs = [];

  let offset = 6 + sizes.length * 16;

  for (const size of sizes) {
    const rgbaBuffer = drawDatabaseIcon(size, size);
    
    // Create uncompressed DIB
    const cols = size * 4;
    const rows = size * cols;
    const end = rows - cols;
    const xorMask = Buffer.alloc(rgbaBuffer.length);

    for (let row = 0; row < rows; row += cols) {
      for (let col = 0; col < cols; col += 4) {
        const pos = row + col;
        const r = rgbaBuffer.readUInt8(pos);
        const g = rgbaBuffer.readUInt8(pos + 1);
        const b = rgbaBuffer.readUInt8(pos + 2);
        const a = rgbaBuffer.readUInt8(pos + 3);

        const targetPos = (end - row) + col;
        xorMask.writeUInt8(b, targetPos);     // B
        xorMask.writeUInt8(g, targetPos + 1); // G
        xorMask.writeUInt8(r, targetPos + 2); // R
        xorMask.writeUInt8(a, targetPos + 3); // A
      }
    }

    const andRowStride = Math.ceil(size / 32) * 4;
    const andMaskSize = andRowStride * size;
    const andMask = Buffer.alloc(andMaskSize); // all 0 (transparent outside alpha)
    const dib = Buffer.concat([xorMask, andMask]);
    
    const dibSize = dib.length;

    // Create directory entry
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size === 256 ? 0 : size, 0);
    dir.writeUInt8(size === 256 ? 0 : size, 1);
    dir.writeUInt8(0, 2); // Palette size
    dir.writeUInt8(0, 3); // Reserved
    dir.writeUInt16LE(1, 4); // Color planes
    dir.writeUInt16LE(32, 6); // BPP
    dir.writeUInt32LE(dibSize + 40, 8); // Size of header + DIB data
    dir.writeUInt32LE(offset, 12); // Offset from file start

    // Create BITMAPINFOHEADER
    const bmpHeader = Buffer.alloc(40);
    bmpHeader.writeUInt32LE(40, 0);
    bmpHeader.writeInt32LE(size, 4);
    bmpHeader.writeInt32LE(size * 2, 8); // height * 2 for XOR + AND
    bmpHeader.writeUInt16LE(1, 12);
    bmpHeader.writeUInt16LE(32, 14); // 32 bits
    bmpHeader.writeUInt32LE(0, 16); // BI_RGB (uncompressed)
    bmpHeader.writeUInt32LE(dibSize, 20); // DIB size
    bmpHeader.writeInt32LE(0, 24);
    bmpHeader.writeInt32LE(0, 28);
    bmpHeader.writeUInt32LE(0, 32);
    bmpHeader.writeUInt32LE(0, 36);

    directories.push(dir);
    dibs.push(Buffer.concat([bmpHeader, dib]));

    offset += dibSize + 40;
  }

  return Buffer.concat([icoHeader, ...directories, ...dibs]);
}

// 1. Generate PNGs
const png32 = makePng(drawDatabaseIcon(32, 32), 32, 32);
const png128 = makePng(drawDatabaseIcon(128, 128), 128, 128);
const png256 = makePng(drawDatabaseIcon(256, 256), 256, 256);

fs.writeFileSync(path.join(ICONS_DIR, '32x32.png'), png32);
fs.writeFileSync(path.join(ICONS_DIR, '128x128.png'), png128);
fs.writeFileSync(path.join(ICONS_DIR, '128x128@2x.png'), png256);

// 2. Generate multi-resolution perfectly formatted ICO
const icoFile = generateIcoFile([16, 32, 48, 64, 128, 256]);
fs.writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoFile);

// 3. Generate a minimal valid .icns file
const icnsHeader = Buffer.alloc(8);
icnsHeader.write('icns', 0);
icnsHeader.writeUInt32BE(8 + 8 + png256.length, 4);

const icnsType = Buffer.alloc(8);
icnsType.write('ic08', 0); // 256x256 PNG
icnsType.writeUInt32BE(8 + png256.length, 4);

const icnsFile = Buffer.concat([icnsHeader, icnsType, png256]);
fs.writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsFile);

console.log('Successfully generated 100% compliant uncompressed DIB ICO and standard PNG/ICNS icons!');
