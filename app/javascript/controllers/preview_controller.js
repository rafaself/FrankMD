import { Controller } from "@hotwired/stimulus"
import { marked } from "marked"

// Preview Controller
// Handles markdown preview panel rendering, zoom, and scroll sync
// Dispatches preview:toggled and preview:zoom-changed events
// Automatically strips YAML/TOML frontmatter from preview

// Strip frontmatter (YAML or TOML) from markdown content
// YAML: starts with --- and ends with ---
// TOML: starts with +++ and ends with +++
function stripFrontmatter(content) {
  if (!content) return content

  // Check for YAML frontmatter (---)
  if (content.startsWith("---")) {
    const endMatch = content.indexOf("\n---", 3)
    if (endMatch !== -1) {
      // Find the end of the closing --- line
      const afterFrontmatter = content.indexOf("\n", endMatch + 4)
      if (afterFrontmatter !== -1) {
        return content.slice(afterFrontmatter + 1).trimStart()
      }
      // Closing --- is at end of file
      return ""
    }
  }

  // Check for TOML frontmatter (+++)
  if (content.startsWith("+++")) {
    const endMatch = content.indexOf("\n+++", 3)
    if (endMatch !== -1) {
      const afterFrontmatter = content.indexOf("\n", endMatch + 4)
      if (afterFrontmatter !== -1) {
        return content.slice(afterFrontmatter + 1).trimStart()
      }
      return ""
    }
  }

  return content
}

export default class extends Controller {
  static targets = [
    "panel",
    "content",
    "zoomLevel"
  ]

  static values = {
    zoom: { type: Number, default: 100 },
    typewriterMode: { type: Boolean, default: false },
    syncScrollEnabled: { type: Boolean, default: true }
  }

  connect() {
    this.zoomLevels = [50, 75, 90, 100, 110, 125, 150, 175, 200]
    this.syncScrollTimeout = null
    this.lastScrollTarget = null
    this.scrollThreshold = 10 // Pixels - avoid jitter from micro-adjustments
    this.applyZoom()
  }

  disconnect() {
    if (this.syncScrollTimeout) {
      cancelAnimationFrame(this.syncScrollTimeout)
    }
  }

  // Toggle preview panel visibility
  toggle() {
    if (!this.hasPanelTarget) return false

    const isHidden = this.panelTarget.classList.contains("hidden")
    this.panelTarget.classList.toggle("hidden", !isHidden)
    this.panelTarget.classList.toggle("flex", isHidden)
    document.body.classList.toggle("preview-visible", isHidden)

    this.dispatch("toggled", { detail: { visible: isHidden } })
    return isHidden // Returns true if now visible
  }

  // Show preview panel
  show() {
    if (!this.hasPanelTarget) return
    if (!this.panelTarget.classList.contains("hidden")) return

    this.panelTarget.classList.remove("hidden")
    this.panelTarget.classList.add("flex")
    document.body.classList.add("preview-visible")
    this.dispatch("toggled", { detail: { visible: true } })
  }

  // Hide preview panel
  hide() {
    if (!this.hasPanelTarget) return
    if (this.panelTarget.classList.contains("hidden")) return

    this.panelTarget.classList.add("hidden")
    this.panelTarget.classList.remove("flex")
    document.body.classList.remove("preview-visible")
    this.dispatch("toggled", { detail: { visible: false } })
  }

  // Check if preview is visible
  get isVisible() {
    return this.hasPanelTarget && !this.panelTarget.classList.contains("hidden")
  }

  // Render markdown content to preview
  render(markdownContent) {
    if (!this.isVisible) return
    if (!this.hasContentTarget) return

    // Strip frontmatter (YAML/TOML) before rendering
    const content = stripFrontmatter(markdownContent || "")
    this.contentTarget.innerHTML = marked.parse(content)
  }

  // Update preview with content and scroll sync
  update(markdownContent, scrollData = {}) {
    this.render(markdownContent)

    // Sync scroll after rendering
    if (scrollData.syncToCursor && scrollData.currentLine !== undefined) {
      if (scrollData.typewriterMode) {
        this.syncToTypewriter(scrollData.currentLine, scrollData.totalLines)
      } else {
        this.syncToLineSmooth(scrollData.currentLine, scrollData.totalLines)
      }
    } else if (scrollData.typewriterMode && scrollData.currentLine !== undefined) {
      this.syncToTypewriter(scrollData.currentLine, scrollData.totalLines)
    } else if (scrollData.scrollRatio !== undefined) {
      this.syncScrollRatio(scrollData.scrollRatio)
    }
  }

  // Sync scroll to line with element-aware positioning
  // Tries to find the closest rendered element to the current line
  syncToLineSmooth(currentLine, totalLines) {
    if (!this.isVisible) return
    if (!this.hasContentTarget) return
    if (totalLines <= 1) return

    // Wait for DOM to fully settle after render
    if (this.syncScrollTimeout) {
      cancelAnimationFrame(this.syncScrollTimeout)
    }

    // Double RAF ensures layout is complete
    this.syncScrollTimeout = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const preview = this.contentTarget

        // Get all block-level elements that correspond to markdown lines
        const blockElements = preview.querySelectorAll("h1, h2, h3, h4, h5, h6, p, ul, ol, blockquote, pre, hr, table, img, iframe, .video-embed")

        let targetScroll
        if (blockElements.length === 0) {
          // Fallback to ratio-based scroll
          const lineRatio = (currentLine - 1) / Math.max(totalLines - 1, 1)
          const previewScrollHeight = preview.scrollHeight - preview.clientHeight
          targetScroll = Math.max(0, lineRatio * previewScrollHeight)
        } else {
          // Estimate which element corresponds to the current line
          const lineRatio = (currentLine - 1) / Math.max(totalLines - 1, 1)
          const targetElementIndex = Math.min(
            Math.floor(lineRatio * blockElements.length),
            blockElements.length - 1
          )

          const targetElement = blockElements[targetElementIndex]
          if (!targetElement) return

          // Get element position relative to preview container
          const previewRect = preview.getBoundingClientRect()
          const elementRect = targetElement.getBoundingClientRect()
          const elementTop = elementRect.top - previewRect.top + preview.scrollTop

          // Scroll so the element is near the top (with some padding)
          targetScroll = Math.max(0, elementTop - 50)
        }

        // Only scroll if change exceeds threshold (prevents jitter)
        if (this.lastScrollTarget === null ||
            Math.abs(targetScroll - this.lastScrollTarget) > this.scrollThreshold) {
          this.lastScrollTarget = targetScroll
          // Use smooth scrolling for animation
          preview.scrollTo({
            top: targetScroll,
            behavior: "smooth"
          })
        }
      })
    })
  }

  // Zoom in
  zoomIn() {
    const currentIndex = this.zoomLevels.indexOf(this.zoomValue)
    if (currentIndex < this.zoomLevels.length - 1) {
      this.zoomValue = this.zoomLevels[currentIndex + 1]
      this.applyZoom()
      this.dispatch("zoom-changed", { detail: { zoom: this.zoomValue } })
    }
  }

  // Zoom out
  zoomOut() {
    const currentIndex = this.zoomLevels.indexOf(this.zoomValue)
    if (currentIndex > 0) {
      this.zoomValue = this.zoomLevels[currentIndex - 1]
      this.applyZoom()
      this.dispatch("zoom-changed", { detail: { zoom: this.zoomValue } })
    }
  }

  // Apply current zoom level to preview content
  applyZoom() {
    if (this.hasContentTarget) {
      this.contentTarget.style.fontSize = `${this.zoomValue}%`
    }
    if (this.hasZoomLevelTarget) {
      this.zoomLevelTarget.textContent = `${this.zoomValue}%`
    }
  }

  // Called when zoom value changes
  zoomValueChanged() {
    this.applyZoom()
  }

  // Sync scroll based on ratio (for normal scrolling)
  syncScrollRatio(scrollRatio) {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!this.hasContentTarget) return

    // Debounce to avoid excessive updates
    if (this.syncScrollTimeout) {
      cancelAnimationFrame(this.syncScrollTimeout)
    }

    this.syncScrollTimeout = requestAnimationFrame(() => {
      const preview = this.contentTarget
      const previewScrollHeight = preview.scrollHeight - preview.clientHeight

      if (previewScrollHeight > 0) {
        preview.scrollTop = scrollRatio * previewScrollHeight
      }
    })
  }

  // Sync scroll based on line position (for cursor-based sync)
  syncToLine(linesBefore, totalLines) {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!this.hasContentTarget) return
    if (totalLines <= 1) return

    const lineRatio = (linesBefore - 1) / (totalLines - 1)
    const preview = this.contentTarget
    const previewScrollHeight = preview.scrollHeight - preview.clientHeight

    if (previewScrollHeight > 0) {
      const targetScroll = lineRatio * previewScrollHeight

      preview.scrollTo({
        top: targetScroll,
        behavior: "smooth"
      })
    }
  }

  // Sync scroll in typewriter mode (center content)
  syncToTypewriter(currentLine, totalLines) {
    if (!this.hasContentTarget) return
    if (totalLines <= 1) return

    // Wait for DOM to fully settle after render
    if (this.syncScrollTimeout) {
      cancelAnimationFrame(this.syncScrollTimeout)
    }

    // Double RAF ensures layout is complete
    this.syncScrollTimeout = requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const preview = this.contentTarget
        const lineRatio = (currentLine - 1) / (totalLines - 1)

        // In typewriter mode, preview has bottom padding
        const style = window.getComputedStyle(preview)
        const paddingBottom = parseFloat(style.paddingBottom) || 0
        const actualContentHeight = preview.scrollHeight - paddingBottom

        // Position in the actual content based on line ratio
        const contentPosition = lineRatio * actualContentHeight

        // Center content at 50% of visible area
        const targetY = preview.clientHeight * 0.5
        const desiredScroll = Math.max(0, contentPosition - targetY)

        // Only scroll if change exceeds threshold (prevents jitter)
        if (this.lastScrollTarget === null ||
            Math.abs(desiredScroll - this.lastScrollTarget) > this.scrollThreshold) {
          this.lastScrollTarget = desiredScroll
          // Use smooth scrolling for animation
          preview.scrollTo({
            top: desiredScroll,
            behavior: "smooth"
          })
        }
      })
    })
  }

  // Toggle typewriter mode styling on preview
  setTypewriterMode(enabled) {
    this.typewriterModeValue = enabled
    if (this.hasContentTarget) {
      this.contentTarget.classList.toggle("preview-typewriter-mode", enabled)
    }
  }
}
