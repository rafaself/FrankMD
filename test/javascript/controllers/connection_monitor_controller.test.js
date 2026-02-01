/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { Application } from "@hotwired/stimulus"
import ConnectionMonitorController from "../../../app/javascript/controllers/connection_monitor_controller"

describe("ConnectionMonitorController", () => {
  let application
  let container
  let controller

  beforeEach(async () => {
    // Mock fetch before controller connects (it starts checking immediately)
    global.fetch = vi.fn().mockResolvedValue({ ok: true })

    // Setup DOM
    document.body.innerHTML = `
      <div data-controller="connection-monitor">
        <div data-connection-monitor-target="banner" class="hidden">Offline</div>
        <textarea data-connection-monitor-target="textarea"></textarea>
      </div>
    `

    container = document.querySelector('[data-controller="connection-monitor"]')

    // Setup Stimulus
    application = Application.start()
    application.register("connection-monitor", ConnectionMonitorController)

    // Get controller instance (needs to wait for Stimulus to initialize)
    await new Promise((resolve) => setTimeout(resolve, 10))
    controller = application.getControllerForElementAndIdentifier(container, "connection-monitor")
  })

  afterEach(() => {
    // Stop the monitoring interval first
    if (controller && controller.monitorInterval) {
      clearInterval(controller.monitorInterval)
      controller.monitorInterval = null
    }
    vi.restoreAllMocks()
    application.stop()
    document.body.innerHTML = ""
  })

  describe("connect", () => {
    it("initializes with online state", () => {
      expect(controller.isOnline).toBe(true)
    })

    it("starts monitoring on connect", () => {
      expect(controller.monitorInterval).toBeDefined()
    })
  })

  describe("checkConnection", () => {
    it("sets online state when fetch succeeds", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })
      controller.isOnline = false
      controller.isChecking = false

      await controller.checkConnection()

      expect(controller.isOnline).toBe(true)
    })

    it("sets offline state when fetch fails", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"))
      controller.isOnline = true
      controller.isChecking = false

      await controller.checkConnection()

      expect(controller.isOnline).toBe(false)
    })

    it("sets offline state when response is not ok", async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false })
      controller.isOnline = true
      controller.isChecking = false

      await controller.checkConnection()

      expect(controller.isOnline).toBe(false)
    })

    it("prevents overlapping checks", () => {
      global.fetch = vi.fn().mockImplementation(() => new Promise(() => {})) // Never resolves
      controller.isChecking = false

      controller.checkConnection()
      controller.checkConnection()
      controller.checkConnection()

      expect(global.fetch).toHaveBeenCalledTimes(1)
    })
  })

  describe("handleOffline", () => {
    it("shows banner when going offline", () => {
      controller.isOnline = true
      const banner = container.querySelector('[data-connection-monitor-target="banner"]')

      controller.handleOffline()

      expect(banner.classList.contains("hidden")).toBe(false)
    })

    it("disables textarea when going offline", () => {
      controller.isOnline = true
      const textarea = container.querySelector('[data-connection-monitor-target="textarea"]')

      controller.handleOffline()

      expect(textarea.disabled).toBe(true)
    })

    it("dispatches offline event", () => {
      controller.isOnline = true
      const dispatchSpy = vi.spyOn(controller, "dispatch")

      controller.handleOffline()

      expect(dispatchSpy).toHaveBeenCalledWith("offline")
    })

    it("does nothing if already offline", () => {
      controller.isOnline = false
      const dispatchSpy = vi.spyOn(controller, "dispatch")

      controller.handleOffline()

      expect(dispatchSpy).not.toHaveBeenCalled()
    })
  })

  describe("handleOnline", () => {
    it("hides banner when coming online", () => {
      controller.isOnline = false
      const banner = container.querySelector('[data-connection-monitor-target="banner"]')
      banner.classList.remove("hidden")

      controller.handleOnline()

      expect(banner.classList.contains("hidden")).toBe(true)
    })

    it("enables textarea when coming online", () => {
      controller.isOnline = false
      const textarea = container.querySelector('[data-connection-monitor-target="textarea"]')
      textarea.disabled = true

      controller.handleOnline()

      expect(textarea.disabled).toBe(false)
    })

    it("dispatches online event", () => {
      controller.isOnline = false
      const dispatchSpy = vi.spyOn(controller, "dispatch")

      controller.handleOnline()

      expect(dispatchSpy).toHaveBeenCalledWith("online")
    })

    it("does nothing if already online", () => {
      controller.isOnline = true
      const dispatchSpy = vi.spyOn(controller, "dispatch")

      controller.handleOnline()

      expect(dispatchSpy).not.toHaveBeenCalled()
    })
  })

  describe("textarea state preservation", () => {
    it("preserves disabled state if textarea was already disabled", () => {
      const textarea = container.querySelector('[data-connection-monitor-target="textarea"]')
      textarea.disabled = true
      controller.isOnline = true

      controller.handleOffline()
      controller.isOnline = false // Reset for handleOnline
      controller.handleOnline()

      // Should stay disabled because it was disabled before
      expect(textarea.disabled).toBe(true)
    })

    it("re-enables textarea if it was enabled before going offline", () => {
      const textarea = container.querySelector('[data-connection-monitor-target="textarea"]')
      textarea.disabled = false
      controller.isOnline = true

      controller.handleOffline()
      controller.isOnline = false
      controller.handleOnline()

      expect(textarea.disabled).toBe(false)
    })
  })

  describe("retry", () => {
    it("calls checkConnection", () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })
      controller.isChecking = false
      const checkSpy = vi.spyOn(controller, "checkConnection")

      controller.retry()

      expect(checkSpy).toHaveBeenCalled()
    })
  })

  describe("browser events", () => {
    it("checks connection on browser online event", () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true })
      controller.isChecking = false
      const checkSpy = vi.spyOn(controller, "checkConnection")

      window.dispatchEvent(new Event("online"))

      expect(checkSpy).toHaveBeenCalled()
    })

    it("handles offline on browser offline event", () => {
      controller.isOnline = true
      const offlineSpy = vi.spyOn(controller, "handleOffline")

      window.dispatchEvent(new Event("offline"))

      expect(offlineSpy).toHaveBeenCalled()
    })
  })

  describe("disconnect", () => {
    it("stops monitoring interval", () => {
      expect(controller.monitorInterval).not.toBeNull()

      controller.disconnect()

      expect(controller.monitorInterval).toBeNull()
    })

    it("removes event listeners", () => {
      const removeEventListenerSpy = vi.spyOn(window, "removeEventListener")

      controller.disconnect()

      expect(removeEventListenerSpy).toHaveBeenCalledWith("online", expect.any(Function))
      expect(removeEventListenerSpy).toHaveBeenCalledWith("offline", expect.any(Function))
    })
  })
})
