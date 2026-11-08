import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import Lenis from 'lenis'
import { createCathedral } from './scene/cathedral'
import { createWords } from './scene/words'
import { createAudio } from './audio'
import { createRig, createRigTimeline, TOTAL } from './scene/timeline'

const IDLE_MS = 30_000 // hint appears after this long without scrolling

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const wordsRef = useRef<HTMLDivElement>(null)
  const whiteRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!, hint = hintRef.current!
    const query = new URLSearchParams(location.search)
    const idleMs = Number(query.get('idle')) || IDLE_MS // ?idle=ms and ?p=0..1 are test hooks

    const rig = createRig()
    const tl = createRigTimeline(rig)
    const cathedral = createCathedral(canvas, () => setReady(true))
    const audio = createAudio()
    const words = createWords(wordsRef.current!, query.get('name')?.trim() || 'friend', audio.tick) // ?name= personalises [NAME]

    let progress = 0
    const onProgress = (p: number) => {
      progress = p
      tl.seek(p * TOTAL)
      words.update(p * TOTAL)
    }

    // idle hint: fades in after IDLE_MS of no scrolling; any scroll hides it and restarts the clock
    let idleTimer = 0, hintShown = false
    const showHint = () => {
      if (progress > 0.98) return // nothing left to scroll to
      hintShown = true
      animate(hint, { opacity: [0, 1], translateY: [10, 0], duration: 900, ease: 'outQuad' })
    }
    const resetIdle = () => {
      if (hintShown) {
        hintShown = false
        animate(hint, { opacity: 0, duration: 400, ease: 'outQuad' })
      }
      window.clearTimeout(idleTimer)
      idleTimer = window.setTimeout(showHint, idleMs)
    }

    const lenis = new Lenis({ lerp: 0.08, wheelMultiplier: 0.9, smoothWheel: true })
    lenis.on('scroll', (e: Lenis) => {
      onProgress(e.progress || 0)
      resetIdle()
    })

    const startP = parseFloat(query.get('p') ?? '')
    if (!Number.isNaN(startP)) onProgress(startP)
    resetIdle()

    const raf = { id: 0 }
    const loop = (t: number) => {
      lenis.raf(t)
      cathedral.frame(t / 1000, rig)
      audio.update(rig)
      whiteRef.current!.style.opacity = String(rig.white)
      raf.id = requestAnimationFrame(loop)
    }
    raf.id = requestAnimationFrame(loop)

    return () => {
      cancelAnimationFrame(raf.id)
      window.clearTimeout(idleTimer)
      lenis.destroy()
      tl.pause()
      words.dispose()
      audio.dispose()
      cathedral.dispose()
    }
  }, [])

  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <div className="vignette" />
      <div ref={whiteRef} className="whiteout" />
      <div ref={wordsRef} className="words" aria-hidden="true" />
      <div className={`loader${ready ? ' done' : ''}`} />
      <div ref={hintRef} className="hint" aria-hidden="true"><span>Scroll</span><i /></div>
      <main className="scroll-space" />
    </>
  )
}

export default App
