/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest"
import { Application } from "@hotwired/stimulus"

// Mock @codemirror/commands before importing the controller
vi.mock("@codemirror/commands", () => ({
  undo: vi.fn()
}))

// Mock lib imports that the controller uses at module level
vi.mock("lib/marked_extensions", () => ({
  allExtensions: []
}))

vi.mock("lib/codemirror_content_insertion", () => ({
  insertBlockContent: vi.fn(),
  insertInlineContent: vi.fn(),
  insertImage: vi.fn(),
  insertCodeBlock: vi.fn(),
  insertVideoEmbed: vi.fn()
}))

vi.mock("lib/codemirror_adapter", () => ({
  createTextareaAdapter: vi.fn(),
  getEditorContent: vi.fn((cm, ta) => cm ? cm.getValue() : "")
}))

vi.mock("lib/keyboard_shortcuts", () => ({
  DEFAULT_SHORTCUTS: {},
  createKeyHandler: vi.fn(() => vi.fn()),
  mergeShortcuts: vi.fn(() => ({}))
}))

vi.mock("lib/line_numbers", () => ({
  LINE_NUMBER_MODES: { OFF: "off", ON: "on", RELATIVE: "relative" },
  normalizeLineNumberMode: vi.fn((val, def) => val || def)
}))

vi.mock("lib/indent_utils", () => ({
  parseIndentSetting: vi.fn(() => "  ")
}))

vi.mock("lib/tree_utils", () => ({
  flattenTree: vi.fn(() => [])
}))

import AppController from "../../../app/javascript/controllers/app_controller"

// Suppress jsdom HTMLBaseElement.get href errors from Stimulus Application.start()
// This is a known jsdom compatibility issue that doesn't affect test correctness
const originalListeners = process.listeners("unhandledRejection")
beforeAll(() => {
  process.removeAllListeners("unhandledRejection")
  process.on("unhandledRejection", (err) => {
    if (err?.message?.includes("HTMLBaseElement")) return
    // Re-throw non-jsdom errors
    throw err
  })
})
afterAll(() => {
  process.removeAllListeners("unhandledRejection")
  originalListeners.forEach((listener) => process.on("unhandledRejection", listener))
})

describe("AppController — Content Loss Detection", () => {
  let application
  let container
  let controller
  let mockCodemirrorValue = ""

  const mockCodemirrorController = {
    getValue: () => mockCodemirrorValue,
    setValue: vi.fn(),
    focus: vi.fn(),
    getEditorView: vi.fn(() => ({})),
    getCursorPosition: vi.fn(() => ({ offset: 0 })),
    getCursorInfo: vi.fn(() => ({ line: 1, col: 1 })),
    setFontFamily: vi.fn(),
    setFontSize: vi.fn(),
    setLineNumberMode: vi.fn(),
    setEnabled: vi.fn(),
    maintainTypewriterScroll: vi.fn(),
    getScrollRatio: vi.fn(() => 0),
    getSelection: vi.fn(() => ({ from: 0, to: 0, text: "" })),
  }

  beforeEach(async () => {
    // Mock fetch
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({})
    })

    // Mock window.t
    window.t = vi.fn().mockReturnValue("")

    // Mock window.history methods for jsdom compatibility
    window.history.pushState = vi.fn()
    window.history.replaceState = vi.fn()

    // Setup minimal DOM with only the targets needed for content loss detection
    document.body.innerHTML = `
      <div data-controller="app"
           data-app-tree-value="[]"
           data-app-config-value="{}">
        <div data-app-target="contentLossBanner" class="hidden"></div>
        <div data-app-target="saveStatus" class="hidden"></div>
        <textarea data-app-target="textarea"></textarea>
        <div data-app-target="editor" class="hidden"></div>
        <div data-app-target="editorPlaceholder"></div>
        <div data-app-target="currentPath"></div>
        <div data-app-target="editorToolbar" class="hidden"></div>
        <div data-app-target="fileTree"></div>
        <div data-app-target="tableHint" class="hidden"></div>
      </div>
    `

    container = document.querySelector('[data-controller="app"]')

    // Setup Stimulus
    application = Application.start()
    application.register("app", AppController)

    // Wait for Stimulus to initialize
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller = application.getControllerForElementAndIdentifier(container, "app")

    // Override getCodemirrorController to return our mock
    controller.getCodemirrorController = () => mockCodemirrorController
    // Stub out controllers that don't exist in our minimal DOM
    controller.getPreviewController = () => null
    controller.getTypewriterController = () => null
    controller.getPathDisplayController = () => null
    controller.getStatsPanelController = () => null
    controller.getHelpController = () => null

    // Reset mock state
    mockCodemirrorValue = ""
    mockCodemirrorController.setValue.mockClear()
    global.fetch.mockClear()
  })

  afterEach(() => {
    // Clear all timeouts
    if (controller) {
      if (controller.saveTimeout) clearTimeout(controller.saveTimeout)
      if (controller.saveMaxIntervalTimeout) clearTimeout(controller.saveMaxIntervalTimeout)
      if (controller.configSaveTimeout) clearTimeout(controller.configSaveTimeout)
      if (controller._controllerCacheTimeout) clearTimeout(controller._controllerCacheTimeout)
      if (controller._tableCheckTimeout) clearTimeout(controller._tableCheckTimeout)
    }
    vi.restoreAllMocks()
    application.stop()
    document.body.innerHTML = ""
  })

  // Helper to generate a string of a given length
  function makeContent(length) {
    return "x".repeat(length)
  }

  describe("saveNow()", () => {
    it("no warning for small deletion (< 20% or < 50 chars)", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = makeContent(200)
      mockCodemirrorValue = makeContent(180) // 10% loss, 20 chars lost

      await controller.saveNow()

      // Should have called fetch (proceeded with save)
      expect(global.fetch).toHaveBeenCalled()
      // Banner should remain hidden
      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(true)
    })

    it("shows warning for large deletion (> 20% AND > 50 chars)", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = makeContent(300)
      mockCodemirrorValue = "" // 100% loss, 300 chars lost

      await controller.saveNow()

      // Should NOT have called fetch (save blocked)
      expect(global.fetch).not.toHaveBeenCalled()
      // Banner should be visible
      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(false)
      expect(banner.classList.contains("flex")).toBe(true)
      expect(controller._contentLossWarningActive).toBe(true)
    })

    it("no warning when _contentLossOverride is true", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = makeContent(300)
      mockCodemirrorValue = "" // 100% loss
      controller._contentLossOverride = true

      await controller.saveNow()

      // Should have called fetch despite massive deletion
      expect(global.fetch).toHaveBeenCalled()
    })

    it("no warning when _lastSavedContent is null (fresh file)", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = null
      mockCodemirrorValue = "some new content"

      await controller.saveNow()

      // Should proceed normally with fetch
      expect(global.fetch).toHaveBeenCalled()
    })

    it("resets _contentLossOverride after successful save", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = makeContent(300)
      mockCodemirrorValue = "" // 100% loss
      controller._contentLossOverride = true

      global.fetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({})
      })

      await controller.saveNow()

      expect(controller._contentLossOverride).toBe(false)
    })
  })

  describe("scheduleAutoSave()", () => {
    it("blocked while warning is active", () => {
      controller._contentLossWarningActive = true
      controller.saveTimeout = null

      controller.scheduleAutoSave()

      // No timeout should have been created
      expect(controller.saveTimeout).toBeNull()
      // But unsaved changes should be tracked
      expect(controller.hasUnsavedChanges).toBe(true)
    })
  })

  describe("dismissContentLossWarning()", () => {
    it("hides banner and resets flags", () => {
      // Show the banner first
      controller.showContentLossWarning()
      expect(controller._contentLossWarningActive).toBe(true)

      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(false)

      // Dismiss it
      controller.dismissContentLossWarning()

      expect(banner.classList.contains("hidden")).toBe(true)
      expect(banner.classList.contains("flex")).toBe(false)
      expect(controller._contentLossWarningActive).toBe(false)
      expect(controller._contentLossOverride).toBe(false)
    })
  })

  describe("saveAnywayAfterWarning()", () => {
    it("sets override, dismisses banner, and calls saveNow", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = makeContent(300)
      mockCodemirrorValue = ""

      // Show warning first
      controller.showContentLossWarning()

      const saveNowSpy = vi.spyOn(controller, "saveNow").mockResolvedValue()

      controller.saveAnywayAfterWarning()

      // Banner should be dismissed
      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(true)
      // Override should be set so saveNow bypasses content loss check
      expect(controller._contentLossOverride).toBe(true)
      expect(saveNowSpy).toHaveBeenCalled()
    })
  })

  describe("onEditorChange()", () => {
    it("auto-dismisses warning when content is restored (e.g. Ctrl+Z)", () => {
      const originalContent = makeContent(300)
      controller._lastSavedContent = originalContent
      controller._contentLossWarningActive = true

      // Show banner
      controller.showContentLossWarning()

      // Simulate content being restored (e.g., user pressed Ctrl+Z)
      mockCodemirrorValue = originalContent

      controller.onEditorChange({ detail: { docChanged: true } })

      // Warning should be auto-dismissed
      expect(controller._contentLossWarningActive).toBe(false)
      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(true)
    })

    it("warning stays if content is still below threshold", () => {
      controller._lastSavedContent = makeContent(300)
      controller._contentLossWarningActive = true

      // Show banner
      controller.showContentLossWarning()

      // Content is still empty
      mockCodemirrorValue = ""

      controller.onEditorChange({ detail: { docChanged: true } })

      // Warning should remain
      expect(controller._contentLossWarningActive).toBe(true)
      const banner = container.querySelector('[data-app-target="contentLossBanner"]')
      expect(banner.classList.contains("hidden")).toBe(false)
    })
  })

  // === Race condition and save concurrency tests ===

  describe("saveNow() — concurrent save guard", () => {
    it("prevents concurrent saves (_isSaving blocks second call)", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"

      // Make fetch hang (never resolves) to keep _isSaving true
      let resolveFetch
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => { resolveFetch = resolve })
      )

      // Start first save (will hang at await fetch)
      const savePromise = controller.saveNow()
      expect(controller._isSaving).toBe(true)

      // Second call should be a no-op
      await controller.saveNow()
      expect(global.fetch).toHaveBeenCalledTimes(1)

      // Clean up: resolve the hanging fetch
      resolveFetch({ ok: true })
      await savePromise
      expect(controller._isSaving).toBe(false)
    })

    it("clears _isSaving after fetch error", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"

      global.fetch = vi.fn().mockRejectedValue(new Error("network error"))

      await controller.saveNow()

      expect(controller._isSaving).toBe(false)
    })

    it("reschedules save if content changed during fetch", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "version1"

      // Fetch resolves, but while it's in flight we'll change the editor content
      let resolveFetch
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => { resolveFetch = resolve })
      )

      const savePromise = controller.saveNow()

      // User types while save is in flight — content changes
      mockCodemirrorValue = "version2"

      // Complete the fetch
      resolveFetch({ ok: true })
      await savePromise

      // Post-save check should detect the change and reschedule
      expect(controller.hasUnsavedChanges).toBe(true)
      expect(controller.saveTimeout).not.toBeNull()
    })

    it("does not reschedule if content unchanged after save", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"

      await controller.saveNow()

      // Content didn't change during save
      expect(controller.hasUnsavedChanges).toBe(false)
      expect(controller.saveTimeout).toBeNull()
    })
  })

  describe("offline → in-flight save → online flow", () => {
    it("saves pending changes after reconnection even if in-flight save completed during offline", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "original"
      mockCodemirrorValue = "version1"

      // Start a save that will hang
      let resolveFetch
      global.fetch = vi.fn().mockImplementation(() =>
        new Promise((resolve) => { resolveFetch = resolve })
      )

      const savePromise = controller.saveNow()

      // Connection drops while save is in flight
      controller.onConnectionLost()
      expect(controller.isOffline).toBe(true)

      // User types while offline
      mockCodemirrorValue = "version2"
      controller.scheduleAutoSave() // returns early (offline), but marks unsaved
      expect(controller.hasUnsavedChanges).toBe(true)

      // In-flight save completes during offline
      resolveFetch({ ok: true })
      await savePromise

      // The post-save freshness check should detect content changed,
      // but we're offline so it shouldn't schedule (scheduleAutoSave guards this)
      // However, hasUnsavedChanges should still be true because of the offline guard
      // in the freshness re-check (isOffline is true, so scheduleAutoSave won't schedule)

      // Connection restored
      global.fetch = vi.fn().mockResolvedValue({ ok: true })
      controller.onConnectionRestored()
      expect(controller.isOffline).toBe(false)

      // onConnectionRestored should see hasUnsavedChanges and call saveNow
      // Wait for the save to complete
      await vi.waitFor(() => {
        expect(global.fetch).toHaveBeenCalled()
      })
    })

    it("onConnectionLost clears all pending save timers", () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"

      // Create save timers
      controller.scheduleAutoSave()
      expect(controller.saveTimeout).not.toBeNull()
      expect(controller.saveMaxIntervalTimeout).not.toBeNull()

      // Go offline
      controller.onConnectionLost()

      // All timers should be cleared
      expect(controller.saveTimeout).toBeNull()
      expect(controller.saveMaxIntervalTimeout).toBeNull()
      expect(controller.hasUnsavedChanges).toBe(true)
    })

    it("scheduleAutoSave is a no-op while offline", () => {
      controller.isOffline = true
      controller.saveTimeout = null

      controller.scheduleAutoSave()

      expect(controller.saveTimeout).toBeNull()
      expect(controller.hasUnsavedChanges).toBe(true)
    })

    it("saveNow is a no-op while offline", async () => {
      controller.isOffline = true
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"

      await controller.saveNow()

      expect(global.fetch).not.toHaveBeenCalled()
      expect(controller.hasUnsavedChanges).toBe(true)
    })

    it("onConnectionRestored triggers saveNow when there are pending changes", async () => {
      controller.currentFile = "test.md"
      controller._lastSavedContent = "old"
      mockCodemirrorValue = "new"
      controller.isOffline = true
      controller.hasUnsavedChanges = true

      const saveNowSpy = vi.spyOn(controller, "saveNow").mockResolvedValue()

      controller.onConnectionRestored()

      expect(controller.isOffline).toBe(false)
      expect(saveNowSpy).toHaveBeenCalled()
    })

    it("onConnectionRestored does NOT save when there are no pending changes", () => {
      controller.currentFile = "test.md"
      controller.isOffline = true
      controller.hasUnsavedChanges = false

      const saveNowSpy = vi.spyOn(controller, "saveNow")

      controller.onConnectionRestored()

      expect(saveNowSpy).not.toHaveBeenCalled()
    })
  })
})
