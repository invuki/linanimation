/** Phones and tablets: touch-first pointers or small screens get a lighter render (fewer pixels, no MSAA, less far geometry). */
export const LOW_POWER =
  typeof window !== 'undefined' &&
  (window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 600)
