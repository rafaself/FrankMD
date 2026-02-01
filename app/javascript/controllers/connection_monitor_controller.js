import { Controller } from "@hotwired/stimulus"

// Connection Monitor Controller
// Monitors server connectivity and prevents editing when offline to avoid data loss
// Polls /up endpoint, shows warning banner and disables editor when offline
// Uses exponential backoff when offline to reduce console noise

export default class extends Controller {
  static targets = ["banner", "textarea"]

  static values = {
    interval: { type: Number, default: 5000 },      // Normal polling interval
    maxInterval: { type: Number, default: 30000 },  // Max interval when offline
    timeout: { type: Number, default: 3000 }
  }

  connect() {
    this.isOnline = true
    this.checkInProgress = false
    this.currentInterval = this.intervalValue
    this.failureCount = 0

    // Start monitoring
    this.scheduleNextCheck()

    // Also listen for browser online/offline events as early warning
    this.boundOnline = () => this.checkConnection()
    this.boundOffline = () => this.handleOffline()
    window.addEventListener("online", this.boundOnline)
    window.addEventListener("offline", this.boundOffline)
  }

  disconnect() {
    this.stopMonitoring()
    window.removeEventListener("online", this.boundOnline)
    window.removeEventListener("offline", this.boundOffline)
  }

  scheduleNextCheck() {
    this.stopMonitoring()
    this.monitorTimeout = setTimeout(() => {
      this.checkConnection()
    }, this.currentInterval)
  }

  stopMonitoring() {
    if (this.monitorTimeout) {
      clearTimeout(this.monitorTimeout)
      this.monitorTimeout = null
    }
  }

  async checkConnection() {
    // Avoid overlapping checks
    if (this.checkInProgress) return
    this.checkInProgress = true

    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutValue)

      const response = await fetch("/up", {
        method: "HEAD",
        cache: "no-store",
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        this.handleOnline()
      } else {
        this.handleOffline()
      }
    } catch (error) {
      // Network error or timeout
      if (!this.isOnline) {
        // Only log periodically when already offline to reduce noise
        if (this.failureCount % 6 === 0) { // ~every 30s with backoff
          console.info("[FrankMD] Server unavailable - editing disabled. Will auto-resume when connection returns.")
        }
      } else {
        console.warn("[FrankMD] Connection to server lost. Disabling editor to prevent data loss.")
      }
      this.handleOffline()
    } finally {
      this.checkInProgress = false
      this.scheduleNextCheck()
    }
  }

  handleOnline() {
    const wasOffline = !this.isOnline
    this.isOnline = true
    this.failureCount = 0
    this.currentInterval = this.intervalValue // Reset to normal interval

    if (wasOffline) {
      console.info("[FrankMD] Connection restored. Editor re-enabled.")
      this.hideBanner()
      this.enableEditor()
      this.dispatch("online")
    }
  }

  handleOffline() {
    const wasOnline = this.isOnline
    this.isOnline = false
    this.failureCount++

    // Exponential backoff: double interval each failure, up to max
    this.currentInterval = Math.min(
      this.intervalValue * Math.pow(2, this.failureCount),
      this.maxIntervalValue
    )

    if (wasOnline) {
      this.showBanner()
      this.disableEditor()
      this.dispatch("offline")
    }
  }

  showBanner() {
    if (this.hasBannerTarget) {
      this.bannerTarget.classList.remove("hidden")
    }
  }

  hideBanner() {
    if (this.hasBannerTarget) {
      this.bannerTarget.classList.add("hidden")
    }
  }

  disableEditor() {
    if (this.hasTextareaTarget) {
      this.textareaTarget.dataset.wasDisabled = this.textareaTarget.disabled
      this.textareaTarget.disabled = true
    }
  }

  enableEditor() {
    if (this.hasTextareaTarget) {
      // Only re-enable if it wasn't already disabled before we disabled it
      if (this.textareaTarget.dataset.wasDisabled !== "true") {
        this.textareaTarget.disabled = false
      }
      delete this.textareaTarget.dataset.wasDisabled
    }
  }

  // Manual retry button
  retry() {
    this.checkConnection()
  }
}
