import { useEffect, useRef, useState } from 'react'
import { animate } from 'animejs'
import Lenis from 'lenis'
import { createCathedral } from './scene/cathedral'
import { createStartScreen } from './scene/startScreen'
import { createWords } from './scene/words'
import { createAudio } from './audio'
import { createRig, createRigTimeline, TOTAL, ASK_SHOW, ASK_LOCK, ANSWERED } from './scene/timeline'

const REPLY = { yes: 'Me too, my friend.', no: 'That is a shame.' } as const

const IDLE_MS = 30_000 // hint appears after this long without scrolling

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const hintRef = useRef<HTMLDivElement>(null)
  const wordsRef = useRef<HTMLDivElement>(null)
  const whiteRef = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const [started, setStarted] = useState(() => new URLSearchParams(location.search).has('p')) // ?p= test hook skips the start screen
  const startCanvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<ReturnType<typeof createAudio> | null>(null)
  const [soundOn, setSoundOn] = useState(true)
  const [credits, setCredits] = useState(false)
  const [asking, setAsking] = useState(false)
  const answerRef = useRef<((a: 'yes' | 'no') => void) | null>(null)
  const startLiveRef = useRef<{ dispose(): void } | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current!, hint = hintRef.current!
    const query = new URLSearchParams(location.search)
    const idleMs = Number(query.get('idle')) || IDLE_MS // ?idle=ms and ?p=0..1 are test hooks

    const rig = createRig()
    const tl = createRigTimeline(rig)
    const cathedral = createCathedral(canvas, () => setReady(true))
    const audio = createAudio()
    audioRef.current = audio
    const words = createWords(wordsRef.current!, query.get('name')?.trim() || 'friend', audio.tick) // ?name= personalises [NAME]

    let progress = 0
    let answered = false
    const reply = (a: 'yes' | 'no') => { answered = true; words.setReply(REPLY[a]); setAsking(false) }
    const onProgress = (p: number) => {
      progress = p
      tl.seek(p * TOTAL)
      words.update(p * TOTAL)
      setAsking(!answered && p * TOTAL >= ASK_SHOW)
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
    answerRef.current = (a) => { // reply, then glide on so the response line types in
      reply(a)
      lenis.scrollTo(lenis.limit * (ANSWERED / TOTAL), { duration: 3.5, force: true })
    }
    lenis.on('scroll', (e: Lenis) => {
      if (!answered && (e.progress || 0) * TOTAL > ASK_LOCK) { // hold at the question until it is answered
        lenis.scrollTo(lenis.limit * (ASK_LOCK / TOTAL), { immediate: true, force: true })
        return
      }
      onProgress(e.progress || 0)
      resetIdle()
    })

    const startP = parseFloat(query.get('p') ?? '')
    const pre = query.get('answer') // ?answer=yes|no skips the question when jumping with ?p= (test hook)
    if (pre === 'yes' || pre === 'no') reply(pre)
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
      audioRef.current = null
      answerRef.current = null
      cathedral.dispose()
    }
  }, [])

  // animated start screen (three.js); the still jpg shows underneath until it is ready
  useEffect(() => {
    const canvas = startCanvasRef.current!
    const ss = createStartScreen(canvas, () => canvas.classList.add('live'))
    startLiveRef.current = ss
    return () => { ss.dispose(); startLiveRef.current = null }
  }, [])
  useEffect(() => {
    if (!started) return
    const id = window.setTimeout(() => startLiveRef.current?.dispose(), 1600) // after the fade-out
    return () => window.clearTimeout(id)
  }, [started])

  const toggleSound = () => {
    const next = !soundOn
    setSoundOn(next)
    audioRef.current?.setMuted(!next)
  }
  useEffect(() => {
    if (!credits) return
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setCredits(false)
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [credits])

  // lock page scroll until the start button is pressed
  useEffect(() => {
    if (started) return
    const root = document.documentElement
    root.style.overflow = 'hidden'
    return () => { root.style.overflow = '' }
  }, [started])

  return (
    <>
      <canvas ref={canvasRef} className="stage" />
      <div className="vignette" />
      <div ref={whiteRef} className="whiteout" />
      <div ref={wordsRef} className="words" aria-hidden="true" />
      <div className={`start${started ? ' done' : ''}`} aria-hidden={started}><canvas ref={startCanvasRef} />
        <div className="start-ui">
          <h1>De mémoire d’homme</h1>
          <nav>
            <button type="button" onClick={() => setStarted(true)} disabled={started}>Start</button>
            <button type="button" onClick={toggleSound} aria-pressed={!soundOn}>Sound:{' '}
              <span className={`swap${soundOn ? '' : ' off'}`}><span>on</span><span>off</span></span>
            </button>
            <button type="button" onClick={() => setCredits(true)}>Credits</button>
          </nav>
        </div>
        <div className={`credits${credits ? ' open' : ''}`} role="dialog" aria-label="Credits" aria-hidden={!credits} inert={!credits} onClick={() => setCredits(false)}>
            <div onClick={(e) => e.stopPropagation()}>
              <h2>Credits</h2>
              <p>De mémoire d’homme</p>
              <p>Built with three.js, anime.js and Lenis</p>
              <p>Title typeface: Tangerine, by Vernon Adams</p>
              <button type="button" onClick={() => setCredits(false)}>Close</button>
            </div>
          </div>
      </div>
      <div className={`loader${ready ? ' done' : ''}`} />
      <div className={`choice${asking ? ' show' : ''}`} inert={!asking}>
        <button type="button" onClick={() => answerRef.current?.('yes')}>Yes</button>
        <button type="button" onClick={() => answerRef.current?.('no')}>No</button>
      </div>
      <div ref={hintRef} className="hint" aria-hidden="true"><span>Scroll</span><i /></div>
      <main className="scroll-space" />
    </>
  )
}

export default App
