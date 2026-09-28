import assert from 'node:assert/strict'
import {
  MAX_REFERENCE_IMAGES,
  appendReferenceImage,
  removeReferenceImage
} from '../src/services/reference-images.ts'

const images = Array.from({ length: MAX_REFERENCE_IMAGES }, (_, index) => ({
  name: `reference-${index}.jpg`,
  path: `/tmp/reference-${index}.jpg`,
  size: index + 1
}))

assert.equal(MAX_REFERENCE_IMAGES, 5, 'reference image limit is five')
assert.deepEqual(
  appendReferenceImage(images.slice(0, 4), images[4]),
  images,
  'adds an image while below the limit'
)
assert.deepEqual(
  appendReferenceImage(images, { name: 'overflow.jpg', path: '/tmp/overflow.jpg', size: 6 }),
  images,
  'does not add more than five reference images'
)
assert.deepEqual(
  removeReferenceImage(images, 2),
  [images[0], images[1], images[3], images[4]],
  'removes only the selected reference image'
)

console.log('reference image limit checks passed')
