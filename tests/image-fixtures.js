"use strict";

/*
 * 只给用例用的最小位图：PNG / JPEG 的文件头（尺寸就在这几处），BMP 用来验「别的格式不接」。
 * 这些是测试夹具，不是生产代码；lib/design-image.js 的解析器只看这几个字段。
 */

/* 最小 PNG：签名 + IHDR（宽高在 16 / 20）。 */
function png(width, height) {
  const buffer = Buffer.alloc(24);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write("IHDR", 12, "ascii");
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

/* 最小 JPEG：SOI + SOF0（精度 / 高 / 宽跟在段长后面）。 */
function jpeg(width, height) {
  const buffer = Buffer.alloc(12);
  buffer[0] = 0xff;
  buffer[1] = 0xd8;
  buffer[2] = 0xff;
  buffer[3] = 0xc0;
  buffer.writeUInt16BE(17, 4);
  buffer[6] = 8;
  buffer.writeUInt16BE(height, 7);
  buffer.writeUInt16BE(width, 9);
  return buffer;
}

/* 一份 BMP 的文件头（只为了验「别的格式不接」）。 */
function bmp(width, height) {
  const buffer = Buffer.alloc(32);
  buffer.write("BM", 0, "ascii");
  buffer.writeUInt32LE(width, 18);
  buffer.writeUInt32LE(height, 22);
  return buffer;
}

module.exports = { png, jpeg, bmp };
