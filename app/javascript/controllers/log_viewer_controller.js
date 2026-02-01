import { Controller } from "@hotwired/stimulus"

// Log Viewer Controller
// Opens a dialog showing the last 100 lines of the Rails log
// Triggered by keyboard shortcut only (Ctrl+Shift+L)

export default class extends Controller {
  static targets = ["dialog", "content", "status", "environment"]

  connect() {
    this.boundKeyHandler = this.handleKeydown.bind(this)
    document.addEventListener("keydown", this.boundKeyHandler)
  }

  disconnect() {
    document.removeEventListener("keydown", this.boundKeyHandler)
  }

  handleKeydown(event) {
    // Ctrl+Shift+L (or Cmd+Shift+L on Mac)
    const isCtrlOrCmd = event.ctrlKey || event.metaKey
    const isShift = event.shiftKey
    const isL = event.key.toLowerCase() === "l"

    if (isCtrlOrCmd && isShift && isL) {
      event.preventDefault()
      this.open()
    }
  }

  async open() {
    if (!this.hasDialogTarget) return

    this.dialogTarget.showModal()
    this.showLoading()
    await this.fetchLogs()
  }

  close() {
    if (this.hasDialogTarget) {
      this.dialogTarget.close()
    }
  }

  showLoading() {
    if (this.hasContentTarget) {
      this.contentTarget.textContent = "Loading..."
    }
    if (this.hasStatusTarget) {
      this.statusTarget.textContent = ""
    }
  }

  async fetchLogs() {
    try {
      const response = await fetch("/logs/tail?lines=100", {
        headers: { "Accept": "application/json" }
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }

      const data = await response.json()

      if (this.hasEnvironmentTarget) {
        this.environmentTarget.textContent = `${data.environment} - ${data.file}`
      }

      if (this.hasContentTarget) {
        if (data.lines && data.lines.length > 0) {
          this.contentTarget.textContent = data.lines.join("\n")
          // Scroll to bottom
          this.contentTarget.scrollTop = this.contentTarget.scrollHeight
        } else {
          this.contentTarget.textContent = "(log is empty)"
        }
      }

      if (this.hasStatusTarget) {
        this.statusTarget.textContent = `${data.lines?.length || 0} lines`
      }
    } catch (error) {
      console.error("[FrankMD] Failed to fetch logs:", error)
      if (this.hasContentTarget) {
        this.contentTarget.textContent = `Error loading logs: ${error.message}`
      }
    }
  }

  async refresh() {
    this.showLoading()
    await this.fetchLogs()
  }

  onDialogClick(event) {
    // Close when clicking backdrop
    if (event.target === this.dialogTarget) {
      this.close()
    }
  }

  onKeydown(event) {
    if (event.key === "Escape") {
      this.close()
    }
  }
}
