/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { RGBA } from "@opentui/core"
import { ManualClock } from "@opentui/core/testing"
import { testRender } from "@opentui/solid"
import { batch, createSignal } from "solid-js"
import { ConfigProvider } from "../../src/config"
import {
  EMPTY_SESSION_TAB_STATUS,
  SessionTabs,
  TAB_SPINNERS,
  type SessionTabsController,
  type SessionTabsStatus,
} from "../../src/component/session-tabs"
import { ThemeProvider, useTheme, useThemes } from "../../src/context/theme"
import { getOpenCodeTheme } from "../../src/theme"
import { createTuiResolvedConfig } from "../fixture/tui-runtime"

const titles = ["First session", "Other session"]
const native = {
  base: {
    ...getOpenCodeTheme().base,
    text: { ...getOpenCodeTheme().base.text, base: "#c8d3f5", muted: "#828bb8" },
    background: {
      ...getOpenCodeTheme().base.background,
      base: "#1a1b26",
      raised: { base: "#222436", high: "#2f334d", max: "#444a73" },
    },
  },
  dark: getOpenCodeTheme().dark,
} as const

test("the default tab spinner remains the original dots at 80ms", () => {
  expect(TAB_SPINNERS.dots).toEqual({
    frames: ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"],
    interval: 80,
  })
})

for (const orientation of ["horizontal", "vertical"] as const) {
  for (const theme of [
    { name: "opencode", mode: "dark" },
    { name: "opencode", mode: "light" },
    { name: "native", mode: "dark" },
  ] as const) {
    test(`${orientation} ${theme.name}/${theme.mode} wave stays behind selected and muted titles`, async () => {
      using app = await fixture(orientation, theme)
      await app.renderOnce()
      const baseline = titles.map(app.titleCells)
      const frames = [baseline]

      for (const millis of Array.from({ length: 28 }, () => 100)) {
        await app.step(millis)
        frames.push(titles.map(app.titleCells))
      }

      for (const [index, title] of titles.entries()) {
        const background = baseline[index][0].bg
        const foreground = index === 0 ? app.theme.text.base : app.theme.text.muted
        expect(baseline[index].every((cell) => cell.bg.equals(background))).toBe(true)
        const samples = frames.map((frame) => frame[index])
        const peak = Math.max(...samples.flatMap((cells) => cells.map((cell) => distance(cell.bg, background))))
        const gain = peak / distance(app.theme.text.base, background)
        // These framebuffer thresholds reject the old sweep's ~6%/3.5% title-background lift.
        expect(gain).toBeGreaterThan(orientation === "horizontal" ? 0.13 : 0.075)
        expect(gain).toBeLessThan(orientation === "horizontal" ? 0.17 : 0.1)
        if (orientation === "vertical") {
          // With a three-cell prefix, title character 6 sits at the ten-cell pulse's right clip.
          expect(samples.every((cells) => cells[6].bg.equals(background))).toBe(true)
          expect(Math.max(...samples.map((cells) => distance(cells[5].bg, background)))).toBeLessThan(peak / 10)
        }
        expect(samples[7].map((cell) => cell.bg.toInts())).not.toEqual(samples[11].map((cell) => cell.bg.toInts()))
        expect(samples.flat().every((cell) => cell.fg.equals(foreground))).toBe(true)
        expect(app.captureCharFrame()).toContain(title)
      }

      app.setStatus({ ...EMPTY_SESSION_TAB_STATUS, busy: true, renaming: true })
      await app.renderOnce()
      const renaming = [titles.map(app.titleCells)]
      for (const millis of Array.from({ length: 28 }, () => 100)) {
        await app.step(millis)
        renaming.push(titles.map(app.titleCells))
      }
      for (const [index] of titles.entries()) {
        const samples = renaming.flatMap((frame) => frame[index])
        expect(samples.some((cell) => !cell.fg.equals(baseline[index][0].fg))).toBe(true)
        // This is a sampled non-occlusion regression, not a universal contrast/WCAG guarantee.
        expect(samples.every((cell) => distance(cell.fg, cell.bg) > 1 / 255)).toBe(true)
      }

      app.setAnimations(false)
      await app.renderOnce()
      expect(app.renderer.root.liveCount).toBe(0)
      for (const [index, title] of titles.entries()) {
        expect(app.titleCells(title).every((cell) => cell.bg.equals(baseline[index][0].bg))).toBe(true)
        expect(app.captureCharFrame()).toContain(`⠋ ${title}`)
      }

      batch(() => {
        app.setStatus(EMPTY_SESSION_TAB_STATUS)
        app.setAnimations(true)
      })
      await app.renderOnce()
      await app.step(800)
      expect(app.renderer.root.liveCount).toBe(0)
      for (const [index, title] of titles.entries()) {
        expect(app.titleCells(title).every((cell) => cell.bg.equals(baseline[index][0].bg))).toBe(true)
        expect(app.captureCharFrame()).toContain(`   ${title}`)
      }
    })
  }

  for (const attention of ["question", "permission"] as const) {
    test(`${orientation} ${attention} keeps priority over busy and unread without a running sweep`, async () => {
      using app = await fixture(
        orientation,
        { name: "opencode", mode: "dark" },
        {
          ...EMPTY_SESSION_TAB_STATUS,
          busy: true,
          attention,
          unread: "error",
        },
      )
      await app.renderOnce()
      await app.step(700)
      expect(app.renderer.root.liveCount).toBe(0)
      const initial = titles.map((title) => app.titleCells(title).map((cell) => cell.bg.toInts()))
      for (const millis of [800, 2_000]) {
        await app.step(millis)
        expect(titles.map((title) => app.titleCells(title).map((cell) => cell.bg.toInts()))).toEqual(initial)
        for (const title of titles) {
          expect(app.captureCharFrame()).toContain(`${attention === "question" ? "?" : "!"} ${title}`)
        }
        expect(app.captureCharFrame()).not.toContain("•")
        expect(TAB_SPINNERS.dots.frames.every((frame) => !app.captureCharFrame().includes(frame))).toBe(true)
      }
    })
  }
}

async function fixture(
  orientation: "horizontal" | "vertical",
  theme: { name: string; mode: "dark" | "light" },
  initial: SessionTabsStatus = { ...EMPTY_SESSION_TAB_STATUS, busy: true },
) {
  const clock = new ManualClock()
  const [status, setStatus] = createSignal(initial)
  const [animations, setAnimations] = createSignal(true)
  const tabs = titles.map((title, index) => ({ sessionID: String(index), title }))
  const controller = {
    tabs: () => tabs,
    current: () => "0",
    select() {},
    close() {},
    move() {},
    detail: () => "project",
    status,
  } satisfies SessionTabsController
  let colors!: ReturnType<typeof useTheme>
  let themes!: ReturnType<typeof useThemes>
  function Tabs() {
    colors = useTheme()
    themes = useThemes()
    return (
      <box width="100%" height="100%" backgroundColor={colors.background.base}>
        <SessionTabs controller={controller} orientation={orientation} width={24} animations={animations()} />
      </box>
    )
  }
  const app = await testRender(
    () => (
      <ConfigProvider config={createTuiResolvedConfig({ theme })}>
        <ThemeProvider mode={theme.mode} source={{ discover: async () => ({ native }) }}>
          <Tabs />
        </ThemeProvider>
      </ConfigProvider>
    ),
    { width: 60, height: 10, useThread: false, clock },
  )
  app.renderer.pause()
  await app.waitFor(() => themes.ready)
  expect(themes.selected).toBe(theme.name)
  const renderOnce = async () => {
    await app.waitFor(() => !app.renderer.getSchedulerState().isRendering)
    await app.renderOnce()
  }
  return {
    ...app,
    theme: colors,
    setStatus,
    setAnimations,
    renderOnce,
    titleCells: (title: string) => {
      const rows = app.captureCharFrame().split("\n")
      const row = rows.findIndex((line) => line.includes(title))
      expect(row).toBeGreaterThanOrEqual(0)
      const column = rows[row].indexOf(title)
      return app
        .captureSpans()
        .lines[row].spans.flatMap((span) => Array.from({ length: span.width }, () => span))
        .slice(column, column + title.length)
    },
    step: async (millis: number) => {
      clock.setTime(clock.now() + millis)
      await renderOnce()
    },
    [Symbol.dispose]: () => app.renderer.destroy(),
  }
}

function distance(first: RGBA, second: RGBA) {
  return Math.max(Math.abs(first.r - second.r), Math.abs(first.g - second.g), Math.abs(first.b - second.b))
}
