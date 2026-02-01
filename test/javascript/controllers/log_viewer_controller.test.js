/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Application } from "@hotwired/stimulus"
import LogViewerController from "../../../app/javascript/controllers/log_viewer_controller"

describe("LogViewerController", () => {
  let application
  let container
  let controller

  beforeEach(() => {
    // Setup DOM
    document.body.innerHTML = `
      <div data-controller="log-viewer">
        <dialog data-log-viewer-target="dialog">
          <div data-log-viewer-target="environment"></div>
          <div data-log-viewer-target="status"></div>
          <pre data-log-viewer-target="content"></pre>
        </dialog>
      </div>
    `

    // Mock dialog methods
    HTMLDialogElement.prototype.showModal = vi.fn()
    HTMLDialogElement.prototype.close = vi.fn()

    container = document.querySelector('[data-controller="log-viewer"]')

    // Setup Stimulus
    application = Application.start()
    application.register("log-viewer", LogViewerController)

    // Get controller instance (needs to wait for Stimulus to initialize)
    return new Promise((resolve) => {
      setTimeout(() => {
        controller = application.getControllerForElementAndIdentifier(container, "log-viewer")
        resolve()
      }, 0)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    application.stop()
    document.body.innerHTML = ""
  })

  // Note: Keyboard shortcut (Ctrl+Shift+O) is now handled by app_controller
  // Tests for keyboard shortcuts are in the app_controller/keyboard_shortcuts tests

  describe("open", () => {
    it("shows the dialog", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ environment: "test", file: "test.log", lines: ["line1"] })
      })
      const dialog = container.querySelector('[data-log-viewer-target="dialog"]')

      await controller.open()

      expect(dialog.showModal).toHaveBeenCalled()
    })

    it("shows loading state initially", async () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
      const content = container.querySelector('[data-log-viewer-target="content"]')

      controller.open()

      expect(content.textContent).toBe("Loading...")
    })
  })

  describe("fetchLogs", () => {
    it("fetches logs from server", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          environment: "development",
          file: "development.log",
          lines: ["line 1", "line 2", "line 3"]
        })
      })

      await controller.fetchLogs()

      expect(global.fetch).toHaveBeenCalledWith("/logs/tail?lines=100", expect.any(Object))
    })

    it("displays environment and file name", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          environment: "production",
          file: "production.log",
          lines: []
        })
      })
      const envTarget = container.querySelector('[data-log-viewer-target="environment"]')

      await controller.fetchLogs()

      expect(envTarget.textContent).toBe("production - production.log")
    })

    it("displays log lines", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          environment: "test",
          file: "test.log",
          lines: ["First line", "Second line", "Third line"]
        })
      })
      const content = container.querySelector('[data-log-viewer-target="content"]')

      await controller.fetchLogs()

      expect(content.textContent).toBe("First line\nSecond line\nThird line")
    })

    it("shows empty message for empty log", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          environment: "test",
          file: "test.log",
          lines: []
        })
      })
      const content = container.querySelector('[data-log-viewer-target="content"]')

      await controller.fetchLogs()

      expect(content.textContent).toBe("(log is empty)")
    })

    it("displays line count in status", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({
          environment: "test",
          file: "test.log",
          lines: ["a", "b", "c", "d", "e"]
        })
      })
      const status = container.querySelector('[data-log-viewer-target="status"]')

      await controller.fetchLogs()

      expect(status.textContent).toBe("5 lines")
    })

    it("handles fetch errors gracefully", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))
      const content = container.querySelector('[data-log-viewer-target="content"]')

      await controller.fetchLogs()

      expect(content.textContent).toContain("Error loading logs")
    })

    it("handles non-ok response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      })
      const content = container.querySelector('[data-log-viewer-target="content"]')

      await controller.fetchLogs()

      expect(content.textContent).toContain("Error loading logs")
    })
  })

  describe("close", () => {
    it("closes the dialog", () => {
      const dialog = container.querySelector('[data-log-viewer-target="dialog"]')

      controller.close()

      expect(dialog.close).toHaveBeenCalled()
    })
  })

  describe("refresh", () => {
    it("shows loading and fetches logs again", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ environment: "test", file: "test.log", lines: ["new line"] })
      })
      const fetchSpy = vi.spyOn(controller, "fetchLogs")
      const loadingSpy = vi.spyOn(controller, "showLoading")

      await controller.refresh()

      expect(loadingSpy).toHaveBeenCalled()
      expect(fetchSpy).toHaveBeenCalled()
    })
  })

  describe("dialog interactions", () => {
    it("closes on backdrop click", () => {
      const dialog = container.querySelector('[data-log-viewer-target="dialog"]')
      const closeSpy = vi.spyOn(controller, "close")

      const event = { target: dialog }
      controller.onDialogClick(event)

      expect(closeSpy).toHaveBeenCalled()
    })

    it("does not close when clicking inside dialog", () => {
      const content = container.querySelector('[data-log-viewer-target="content"]')
      const closeSpy = vi.spyOn(controller, "close")

      const event = { target: content }
      controller.onDialogClick(event)

      expect(closeSpy).not.toHaveBeenCalled()
    })

    it("closes on Escape key", () => {
      const closeSpy = vi.spyOn(controller, "close")

      const event = { key: "Escape" }
      controller.onKeydown(event)

      expect(closeSpy).toHaveBeenCalled()
    })
  })

  // Note: disconnect() no longer needed as keyboard handling moved to app_controller
})
