import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('PWA manifest advertises actual icon dimensions and valid image formats',()=>{
  const manifest=JSON.parse(readFileSync('manifest.json','utf8'));
  assert.equal(manifest.name,'Mr. Chicken House POS');
  for(const icon of manifest.icons){
    const image=readFileSync(icon.src);
    assert.equal(image.subarray(1,4).toString(),'PNG');
    assert.equal(`${image.readUInt32BE(16)}x${image.readUInt32BE(20)}`,icon.sizes);
  }
  const apple=readFileSync('assets/icons/icon-180.png');
  assert.equal(apple.readUInt32BE(16),180);
  assert.equal(apple.readUInt32BE(20),180);
  const ico=readFileSync('logo.ico');
  assert.equal(ico.readUInt16LE(0),0);
  assert.equal(ico.readUInt16LE(2),1);
  assert.equal(ico.readUInt16LE(4),1);
  assert.equal(ico.readUInt32LE(18),22);
});
