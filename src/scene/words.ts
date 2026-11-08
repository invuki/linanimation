import { NARRATION as N } from './timeline'

// Floating words for the void between cathedral and portal. `update(t)` is pure in t (ms of timeline), so scrubbing works both ways.
const LINES: { text: string; at: number; out: number; x: number; y: number; slot?: boolean }[] = [
  { text: 'Hello, [NAME]', at: 9500, out: 12300, x: 50, y: 42 },
  { text: 'Have you ever thought about why we have memories?', at: 12700, out: 16300, x: 32, y: 36 },
  { text: 'You hoard moments in your life because you know,\ndeep down,\nhow fleeting your light is', at: 16700, out: 21700, x: 66, y: 44 },
  { text: 'You collect laughter, pain, happiness, and things you will never see again', at: 22100, out: 25500, x: 36, y: 56 },
  { text: 'It must be exhausting.', at: 25900, out: 28300, x: 62, y: 34 },
  { text: 'The world does not carry memories like you do, it thrives in permanence.', at: 28700, out: 32700, x: 34, y: 46 },
  { text: 'Sometimes, when I watch you, [NAME], clinging on so fiercely to a fleeting shadow of yesterday...', at: 33100, out: 38000, x: 60, y: 40 },
  { text: 'I envy the beauty of the burden you carry', at: 38400, out: 43000, x: 50, y: 48 },
  // the narrator returns in the marsh (times are offsets from N, the moment the white has cleared)
  { text: 'It has been centuries since humankind disappeared off the face of this Earth', at: N + 1500, out: N + 8000, x: 40, y: 40 },
  { text: 'Are you fond of the rain?', at: N + 8500, out: N + 15500, x: 50, y: 38 }, // held until answered (scroll locks at ASK_LOCK)
  { text: '', at: N + 15000, out: N + 20000, x: 50, y: 40, slot: true }, // filled with the reply to the answer
  { text: 'Look around. Humans imposed their will onto Earth.', at: N + 20500, out: N + 26500, x: 62, y: 44 },
  { text: 'They have done so for millennia.', at: N + 26900, out: N + 31500, x: 38, y: 36 },
  { text: 'Yet nothing remains. It seems that nature has taken its course.', at: N + 31900, out: N + 38000, x: 58, y: 46 },
  { text: 'It waits for no one.', at: N + 38400, out: N + 44000, x: 50, y: 42 },
]
const FADE = 900
const sm = (a: number, b: number, v: number) => { const k = Math.min(1, Math.max(0, (v - a) / (b - a))); return k * k * (3 - 2 * k) }

const TYPE = 0.65 // share of a line's window spent typing; the rest it just holds

export function createWords(root: HTMLElement, name: string, onType?: () => void) {
  let typed = 0 // total letters revealed last update; a rise means typing moved forward
  const fill = (d: HTMLElement, chars: HTMLElement[], text: string) => {
    d.replaceChildren()
    chars.length = 0
    // one span per letter (hidden until typed) so wrapping never shifts while typing; words stay unbroken
    text.replaceAll('[NAME]', name).split(/( |\n)/).forEach((tok) => {
      if (tok === ' ' || tok === '\n') return void d.append(tok)
      const w = document.createElement('span')
      w.style.display = 'inline-block'
      for (const ch of tok) {
        const c = document.createElement('span')
        c.textContent = ch
        c.style.opacity = '0'
        chars.push(c)
        w.append(c)
      }
      d.append(w)
    })
  }
  const rows = LINES.map((l) => {
    const d = document.createElement('div')
    d.className = 'word'
    d.style.setProperty('--x', `${l.x}%`) // centred on narrow screens via CSS
    d.style.top = `${l.y}%`
    const chars: HTMLElement[] = []
    fill(d, chars, l.text)
    root.appendChild(d)
    return { d, chars }
  })
  return {
    update(t: number) {
      let count = 0
      LINES.forEach((l, i) => {
        const { d, chars } = rows[i]
        const o = 1 - sm(l.out - FADE, l.out, t)
        const n = Math.min(1, Math.max(0, (t - l.at) / ((l.out - l.at) * TYPE))) * (chars.length + 2)
        chars.forEach((c, k) => { c.style.opacity = String(Math.min(1, Math.max(0, n - k))) })
        if (t < l.out - FADE) count += Math.min(chars.length, Math.floor(n)) // lines already fading don't count
        d.style.opacity = String(t < l.at ? 0 : o)
        d.style.transform = `translate(-50%, -50%) translateY(${(l.at - t) * 0.004}px)`
        d.style.visibility = t >= l.at && o > 0.001 ? 'visible' : 'hidden'
      })
      if (count > typed) onType?.()
      typed = count
    },
    /** Set the reply line that follows the yes/no question. */
    setReply(text: string) {
      const i = LINES.findIndex((l) => l.slot)
      fill(rows[i].d, rows[i].chars, text)
    },
    dispose: () => rows.forEach((r) => r.d.remove()),
  }
}
