// Subtle synthesized quiz feedback — no audio assets, just short Web Audio
// tones. Volume is deliberately low; these reinforce the loop, not announce it.
// The enabled flag is cached here (set from the per-profile setting at app
// boot and by the Settings dialog) so play calls stay synchronous.

let enabled = true
let ctx: AudioContext | null = null

export function setSoundEnabled(value: boolean): void {
  enabled = value
}

export function isSoundEnabled(): boolean {
  return enabled
}

function audioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null
  if (!ctx) ctx = new AudioContext()
  // WebView2 (production build) applies the autoplay policy more strictly
  // than a dev browser tab: the context can sit in 'suspended' even when
  // created inside a user-gesture call stack. Every play call originates
  // from a pointer event (a board move), so resuming here is allowed;
  // the scheduled tones then start as soon as the clock unfreezes.
  if (ctx.state === 'suspended') void ctx.resume()
  return ctx
}

function tone(
  freq: number,
  startOffset: number,
  duration: number,
  type: OscillatorType = 'sine',
  peak = 0.08,
): void {
  const ac = audioContext()
  if (!ac) return
  const t0 = ac.currentTime + startOffset
  const osc = ac.createOscillator()
  const gain = ac.createGain()
  osc.type = type
  osc.frequency.value = freq
  gain.gain.setValueAtTime(0, t0)
  gain.gain.linearRampToValueAtTime(peak, t0 + 0.01)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain)
  gain.connect(ac.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

/** Quiz move answered correctly: a single soft high blip. */
export function playCorrect(): void {
  if (!enabled) return
  tone(880, 0, 0.12)
}

/** Quiz move missed (retry or double-fail): a short low buzz. */
export function playWrong(): void {
  if (!enabled) return
  tone(196, 0, 0.18, 'triangle', 0.07)
}

/** Variant completed: a tiny ascending close-out. */
export function playComplete(): void {
  if (!enabled) return
  tone(659, 0, 0.12)
  tone(988, 0.1, 0.18)
}
