import { useState } from 'react'
import { PlayerProvider } from '@/player/PlayerProvider'
import { MediaUIProvider, type MediaUI } from '@/components/shared/MediaUIContext'
import { CarPlayer } from '@/components/player/CarPlayer'
import cozyHearth from '@/assets/img/SittingInTheHearth.webp'

// Minimal stub so shared components (Cover) can read the media seam. No covers,
// no navigation - the harness only needs the layout to render.
const STUB_UI: MediaUI = {
  coverUrl: () => null,
  openItem: () => {},
  playItem: () => {},
}

// DEV-ONLY visual harness for the car-mode player. Renders CarPlayer with stub
// data outside the auth/server stack so the layout, drag, resize, and idle-fade
// can be checked without Clerk or a live ABS server. Gated to import.meta.env.DEV
// in the router - never reachable in a production build.
const CHAPTERS = Array.from({ length: 12 }, (_, i) => ({
  id: i,
  start: i * 1800,
  end: (i + 1) * 1800,
  title: `Chapter ${i + 1}: The Long Road`,
}))

export function CarPlayerHarness() {
  const [pos, setPos] = useState(3600 + 600)
  const [playing, setPlaying] = useState(true)
  const [rate, setRate] = useState(1.5)
  const duration = CHAPTERS.length * 1800

  const ci = Math.min(CHAPTERS.length - 1, Math.floor(pos / 1800))
  const cur = CHAPTERS[ci]
  const seekClamp = (sec: number) => setPos(Math.max(0, Math.min(duration, sec)))

  return (
    <PlayerProvider>
    <MediaUIProvider value={STUB_UI}>
    <div className="player car-mode hearth-bg">
      <div
        className="player-hearth-bg car-bg"
        aria-hidden="true"
        style={{ backgroundImage: `url("${cozyHearth}")` }}
      />
      <CarPlayer
        libraryItemId="dev-stub"
        title="The Wind-Up Bird Chronicle"
        author="Haruki Murakami"
        chapters={CHAPTERS}
        ci={ci}
        cur={cur}
        pos={pos}
        duration={duration}
        isPlaying={playing}
        rate={rate}
        setRate={setRate}
        togglePlay={() => setPlaying((p) => !p)}
        seekClamp={seekClamp}
        prevCh={() => seekClamp(CHAPTERS[Math.max(0, ci - 1)].start)}
        nextCh={() => seekClamp(CHAPTERS[Math.min(CHAPTERS.length - 1, ci + 1)].start)}
        onExit={() => alert('exit car mode')}
      />
    </div>
    </MediaUIProvider>
    </PlayerProvider>
  )
}
