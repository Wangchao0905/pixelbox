import type { ImageAsset } from './image-api'

export const MAX_REFERENCE_IMAGES = 5

let referenceDraft: ImageAsset | null = null

export function appendReferenceImage(images: ImageAsset[], image: ImageAsset): ImageAsset[] {
  return images.length >= MAX_REFERENCE_IMAGES ? images : [...images, image]
}

export function removeReferenceImage(images: ImageAsset[], index: number): ImageAsset[] {
  return images.filter((_, itemIndex) => itemIndex !== index)
}

export function setReferenceDraft(image: ImageAsset) {
  referenceDraft = image
}

export function takeReferenceDraft(): ImageAsset | null {
  const draft = referenceDraft
  referenceDraft = null
  return draft
}
