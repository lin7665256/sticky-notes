// Generate a sticky-note-style PNG icon using only Node.js built-in modules
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const TOP_STRIP = 40; // darker yellow strip at top

// Color helpers
function lerp(a, b, t) { return Math.round(a + (b - a) * t); }

// Create raw image data with filter byte per row
// Format: each row starts with filter byte (0 = None), then RGBA pixels
const rawData = Buffer.alloc((1 + SIZE * 4) * SIZE);

// Corner fold coords: top-right triangle
const foldX = SIZE * 0.25; // fold starts at 75% from right
const foldY = 0;

for (let y = 0; y < SIZE; y++) {
  const rowOffset = y * (1 + SIZE * 4);
  rawData[rowOffset] = 0; // filter byte: None

  for (let x = 0; x < SIZE; x++) {
    const pixelOffset = rowOffset + 1 + x * 4;
    const inFold = x > foldX && y < (SIZE - x); // top-right corner fold

    let r, g, b, a = 255;

    if (inFold) {
      // Folded corner — darker, like paper folded over
      r = 220; g = 120; b = 4;
      // Darker edge on the fold line
      const distToFold = (x - foldX) * 0.7 + y * 0.7;
      if (distToFold < 8) {
        r = lerp(202, r, distToFold / 8);
        g = lerp(138, g, distToFold / 8);
        b = lerp(4, b, distToFold / 8);
      }
    } else if (y < TOP_STRIP) {
      // Top darker strip
      r = 253; g = 224; b = 71;
    } else {
      // Main body gradient (slightly darker at bottom)
      const t = (y - TOP_STRIP) / (SIZE - TOP_STRIP);
      r = lerp(254, 252, t);
      g = lerp(240, 232, t);
      b = lerp(138, 128, t);
    }

    // Border (1px edge)
    if (x < 2 || x >= SIZE - 2 || y < 2 || y >= SIZE - 2) {
      r = 202; g = 138; b = 4;
    }

    // Rounded corners (clip 8px radius)
    const cornerDist = (cx, cy) => Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    if (cornerDist(8, 8) < 8 || cornerDist(SIZE - 9, 8) < 8 ||
        cornerDist(8, SIZE - 9) < 8 || cornerDist(SIZE - 9, SIZE - 9) < 8) {
      a = 0; // transparent corners
    }

    rawData[pixelOffset] = r;
    rawData[pixelOffset + 1] = g;
    rawData[pixelOffset + 2] = b;
    rawData[pixelOffset + 3] = a;
  }
}

// Compress image data
const compressed = zlib.deflateSync(rawData);

// Build PNG chunks
function createChunk(type, data) {
  const typeBuffer = Buffer.from(type, 'ascii');
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  
  // CRC: type + data
  const crcData = Buffer.concat([typeBuffer, data]);
  const crc = crc32(crcData);
  const crcBuffer = Buffer.alloc(4);
  crcBuffer.writeUInt32BE(crc, 0);
  
  return Buffer.concat([length, typeBuffer, data, crcBuffer]);
}

// CRC32 implementation
function crc32(buf) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

// IHDR data
const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(SIZE, 0);   // width
ihdrData.writeUInt32BE(SIZE, 4);   // height
ihdrData[8] = 8;                    // bit depth
ihdrData[9] = 6;                    // color type: RGBA
ihdrData[10] = 0;                   // compression
ihdrData[11] = 0;                   // filter
ihdrData[12] = 0;                   // interlace

// Build PNG
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const ihdr = createChunk('IHDR', ihdrData);
const idat = createChunk('IDAT', compressed);
const iend = createChunk('IEND', Buffer.alloc(0));

const png = Buffer.concat([signature, ihdr, idat, iend]);

const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(outputPath, png);
console.log('Generated icon.png (' + SIZE + 'x' + SIZE + ', ' + png.length + ' bytes)');
