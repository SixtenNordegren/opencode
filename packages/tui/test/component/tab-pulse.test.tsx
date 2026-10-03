import { expect, test } from "bun:test"
/** @jsxImportSource @opentui/solid */
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender, type JSX } from "@opentui/solid"
import { createSignal } from "solid-js"
import {
  TabPulse,
  blendTabPulseColor,
  completionPulseOpacity,
  glowIgnitionLevel,
  tabFlashIntensity,
  unreadGlowIntensity,
} from "../../src/component/tab-pulse"
import { tint } from "../../src/theme/color"

test("a disabled pulse stays idle when it becomes active", async () => {
  const background = RGBA.fromHex("#101010")
  const [active, setActive] = createSignal(false)
  using app = await fixture(() => (
    <box width="100%" backgroundColor={background}>
      <TabPulse enabled={false} active={active()} color={RGBA.fromHex("#ffffff")} backgroundColor={background} />
    </box>
  ))

  await app.renderOnce()
  expect(app.renderer.root.liveCount).toBe(0)

  setActive(true)
  await app.step(700)
  expect(app.renderer.root.liveCount).toBe(0)
  expect(app.cells().every((cell) => cell.bg.equals(background))).toBe(true)
})

test("an attention glow becomes idle after ignition", async () => {
  const background = RGBA.fromHex("#101010")
  const [glow, setGlow] = createSignal(false)
  using app = await fixture(() => (
    <TabPulse active={false} glow={glow()} color={RGBA.fromHex("#ffcc00")} backgroundColor={background} />
  ))

  await app.renderOnce()
  setGlow(true)
  await app.renderOnce()
  expect(app.renderer.root.liveCount).toBe(1)
  await app.step(650)
  expect(app.renderer.root.liveCount).toBe(0)
  expect(app.cells()[0].bg.equals(background)).toBe(false)
})

for (const edge of [undefined, "above", "below"] as const) {
  test(`the running ${edge ?? "background"} wave has a visible moving crest`, async () => {
    const background = RGBA.fromHex("#101010")
    const color = RGBA.fromHex("#f0f0f0")
    const outerColor = RGBA.fromHex("#a06020")
    using app = await fixture(() => (
      <box width="100%" backgroundColor={background}>
        <TabPulse active edge={edge} color={color} outerColor={outerColor} backgroundColor={background} />
      </box>
    ))

    await app.renderOnce()
    await app.step(700)
    const first = app.cells()
    await app.step(400)
    const second = app.cells()
    expect(app.captureCharFrame().trimEnd()).toBe(edge ? (edge === "above" ? "▄" : "▀").repeat(32) : "")

    for (const channel of edge ? (["fg", "bg"] as const) : (["bg"] as const)) {
      const target = edge && channel === "bg" ? outerColor : color
      const gain = first.map((cell) => (cell[channel].r - background.r) / (target.r - background.r))
      const next = second.map((cell) => (cell[channel].r - background.r) / (target.r - background.r))
      // A rendered crest above 30% excludes the former 14% sweep, without reproducing its motion math.
      expect(Math.max(...gain)).toBeGreaterThan(0.3)
      expect(Math.max(...gain)).toBeLessThan(0.36)
      expect(Math.min(...gain)).toBeCloseTo(0)
      expect(second.map((cell) => cell[channel].toInts())).not.toEqual(first.map((cell) => cell[channel].toInts()))
      expect(next.indexOf(Math.max(...next))).toBeGreaterThan(gain.indexOf(Math.max(...gain)))
    }
  })
}

test("running level remains unscaled and quantized, then returns to an idle background", async () => {
  const background = RGBA.fromHex("#101010")
  const [active, setActive] = createSignal(true)
  const levels: number[] = []
  using app = await fixture(() => (
    <box width="100%" backgroundColor={background}>
      <TabPulse
        active={active()}
        color={RGBA.fromHex("#f0f0f0")}
        backgroundColor={background}
        onLevel={(level) => levels.push(level)}
      />
    </box>
  ))

  await app.renderOnce()
  await app.step(500)
  expect(levels.at(-1)).toBe(1)
  const count = levels.length
  await app.renderOnce()
  expect(levels.length).toBe(count)
  await app.step(600)
  expect(levels.at(-1)).toBeGreaterThan(0)
  expect(levels.at(-1)).toBeLessThan(1)
  expect(levels.every((level) => Number.isInteger(level * 32))).toBe(true)

  setActive(false)
  await app.renderOnce()
  await app.step(800)
  expect(levels.at(-1)).toBe(0)
  expect(app.renderer.root.liveCount).toBe(0)
  expect(app.cells().every((cell) => cell.bg.equals(background))).toBe(true)
})

async function fixture(view: () => JSX.Element) {
  const clock = new ManualClock()
  const app = await testRender(view, { width: 32, height: 1, useThread: false, clock })
  app.renderer.pause()
  const renderOnce = async () => {
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    await app.renderOnce()
  }
  return {
    ...app,
    renderOnce,
    cells: () => app.captureSpans().lines[0].spans.flatMap((span) => Array.from({ length: span.width }, () => span)),
    step: async (millis: number) => {
      clock.setTime(clock.now() + millis)
      await renderOnce()
    },
    [Symbol.dispose]: () => app.renderer.destroy(),
  }
}

test("completion pulse rises quickly and fades over the remaining duration", () => {
  expect(completionPulseOpacity(0)).toBe(0)
  expect(completionPulseOpacity(0.06)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(0.12)).toBe(1)
  expect(completionPulseOpacity(0.56)).toBeCloseTo(0.5)
  expect(completionPulseOpacity(1)).toBe(0)
})

test("glow ignition overshoots the resting level and settles back to it", () => {
  expect(glowIgnitionLevel(0)).toBe(0)
  expect(glowIgnitionLevel(0.3)).toBeCloseTo(1.5)
  expect(glowIgnitionLevel(0.6)).toBeGreaterThan(1)
  expect(glowIgnitionLevel(1)).toBe(1)
})

test("unread glow peaks behind the tab number and fades to the normal background", () => {
  const intensities = Array.from({ length: 22 }, (_, index) => unreadGlowIntensity(index, 22))

  expect(intensities[0]).toBe(1)
  expect(intensities[1]).toBe(1)
  expect(intensities[2]).toBeLessThan(1)
  expect(intensities.slice(1)).toEqual(intensities.slice(1).sort((a, b) => b - a))
  expect(intensities[13]).toBe(0)
  expect(intensities.at(-1)).toBe(0)
})

test("unread glow reaches the normal background on compact tabs", () => {
  expect(unreadGlowIntensity(0, 8)).toBe(1)
  expect(unreadGlowIntensity(7, 8)).toBe(0)
})

test("tab flash holds behind the shortcut then feathers to the background", () => {
  const intensities = Array.from({ length: 10 }, (_, index) => tabFlashIntensity(index, 8))

  expect(intensities[0]).toBe(1)
  expect(intensities[1]).toBe(1)
  expect(intensities[2]).toBeLessThan(1)
  expect(intensities.slice(1)).toEqual(intensities.slice(1).sort((a, b) => b - a))
  expect(intensities.at(-1)).toBe(0)
})

test("reuses a color while preserving the original glow and pulse blend stages", () => {
  const output = RGBA.fromInts(0, 0, 0)
  const background = RGBA.fromHex("#1a1b26")
  const glowColor = RGBA.fromHex("#82aaff")
  const runningColor = RGBA.fromHex("#c8d3f5")
  const flashColor = RGBA.fromHex("#e2e8fb")
  const completionColor = RGBA.fromHex("#ff9e64")

  for (const glow of [0, 0.08, 0.16]) {
    for (const running of [0, 0.01, 0.07, 0.14, 0.35]) {
      for (const flash of [0, 0.05, 0.1]) {
        for (const completion of [0, 0.03, 0.09, 0.18]) {
          blendTabPulseColor(
            output,
            background,
            glowColor,
            runningColor,
            flashColor,
            completionColor,
            glow,
            running,
            flash,
            completion,
          )
          expect(output.buffer).toEqual(
            tint(
              tint(tint(tint(background, glowColor, glow), runningColor, running), flashColor, flash),
              completionColor,
              completion,
            ).buffer,
          )
        }
      }
    }
  }
})
