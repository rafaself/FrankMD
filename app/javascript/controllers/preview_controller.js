import { Controller } from "@hotwired/stimulus"
import { marked } from "marked"
import { calculateLineFromScroll } from "lib/scroll_utils"

// Preview Controller
// Handles markdown preview panel rendering, zoom, and scroll sync
// Provides setupEditorSync() and syncToCursor() for editor synchronization
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
    this.editorTextarea = null
    this._lastSyncedLine = null
    this._lastSyncedTotalLines = null
    this._previewRenderTimeout = null
    this._scrollSource = null // Track who initiated the scroll: 'editor' or 'preview'
    this._scrollSourceTimeout = null
    this.applyZoom()
  }

  disconnect() {
    if (this.syncScrollTimeout) {
      cancelAnimationFrame(this.syncScrollTimeout)
    }
    if (this._previewRenderTimeout) {
      clearTimeout(this._previewRenderTimeout)
    }
    if (this._scrollSourceTimeout) {
      clearTimeout(this._scrollSourceTimeout)
    }
    this.editorTextarea = null
  }

  // Mark that scroll was initiated by editor (prevents reverse sync)
  _markScrollFromEditor() {
    this._scrollSource = "editor"
    if (this._scrollSourceTimeout) {
      clearTimeout(this._scrollSourceTimeout)
    }
    // Clear flag after scroll animations complete (smooth scroll can take 300ms+)
    this._scrollSourceTimeout = setTimeout(() => {
      this._scrollSource = null
    }, 150)
  }

  // Mark that scroll was initiated by preview (prevents reverse sync)
  _markScrollFromPreview() {
    this._scrollSource = "preview"
    if (this._scrollSourceTimeout) {
      clearTimeout(this._scrollSourceTimeout)
    }
    this._scrollSourceTimeout = setTimeout(() => {
      this._scrollSource = null
    }, 150)
  }

  // Handle scroll event on preview content - sync to editor
  onPreviewScroll() {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!this.editorTextarea) return

    // Don't sync back if this scroll was caused by editor sync
    if (this._scrollSource === "editor") return

    // Mark that preview initiated this scroll
    this._markScrollFromPreview()

    // Dispatch event to notify app controller to sync editor
    this.dispatch("scroll", {
      detail: {
        scrollRatio: this._getPreviewScrollRatio(),
        typewriterMode: this.typewriterModeValue
      }
    })
  }

  // Get current scroll ratio of preview
  _getPreviewScrollRatio() {
    if (!this.hasContentTarget) return 0

    const preview = this.contentTarget
    const scrollHeight = preview.scrollHeight - preview.clientHeight

    if (scrollHeight <= 0) return 0
    return preview.scrollTop / scrollHeight
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

    // Don't sync if this was triggered by preview scroll
    if (this._scrollSource === "preview") return

    // Mark that editor initiated this scroll
    this._markScrollFromEditor()

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

    // Don't sync if this was triggered by preview scroll
    if (this._scrollSource === "preview") return

    // Mark that editor initiated this scroll
    this._markScrollFromEditor()

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

    // Don't sync if this was triggered by preview scroll
    if (this._scrollSource === "preview") return

    // Mark that editor initiated this scroll
    this._markScrollFromEditor()

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

    // Don't sync if this was triggered by preview scroll
    if (this._scrollSource === "preview") return

    // Mark that editor initiated this scroll
    this._markScrollFromEditor()

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

  // Setup editor synchronization - store reference to textarea and add scroll listeners
  setupEditorSync(textarea) {
    this.editorTextarea = textarea
  }

  // Sync preview scroll to cursor position in editor
  syncToCursor() {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!this.editorTextarea) return

    const textarea = this.editorTextarea
    const content = textarea.value
    const cursorPos = textarea.selectionStart

    const textBeforeCursor = content.substring(0, cursorPos)
    const linesBefore = textBeforeCursor.split("\n").length
    const totalLines = content.split("\n").length

    this.syncToLine(linesBefore, totalLines)
  }

  // Update preview with content and sync scroll to cursor
  // This is called during typing - only syncs when line changes
  updateWithSync(content, options = {}) {
    if (!this.isVisible) return

    const cursorPos = options.cursorPos || 0
    const typewriterMode = options.typewriterMode || false

    // Calculate cursor line info
    const textBeforeCursor = content.substring(0, cursorPos)
    const currentLine = textBeforeCursor.split("\n").length
    const totalLines = content.split("\n").length

    // Only sync scroll when line changes (prevents jitter from typing on same line)
    const lineChanged = this._lastSyncedLine !== currentLine ||
                        this._lastSyncedTotalLines !== totalLines

    // Debounce preview render to reduce DOM thrashing
    if (this._previewRenderTimeout) {
      clearTimeout(this._previewRenderTimeout)
    }

    this._previewRenderTimeout = setTimeout(() => {
      // Build scroll data - only sync scroll if line changed
      const scrollData = {
        typewriterMode,
        currentLine,
        totalLines,
        syncToCursor: lineChanged
      }

      this.update(content, scrollData)

      if (lineChanged) {
        this._lastSyncedLine = currentLine
        this._lastSyncedTotalLines = totalLines
      }
    }, 50) // Small debounce for render
  }

  // Sync preview scroll in typewriter mode based on visible content
  syncScrollTypewriter(textarea) {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!textarea) return

    const content = textarea.value
    const totalLines = content.split("\n").length

    // Calculate which line is at the center of visible area using utility function
    const centerLine = calculateLineFromScroll(
      textarea.scrollTop,
      textarea.clientHeight,
      textarea.scrollHeight,
      totalLines
    )

    this.syncToTypewriter(centerLine, totalLines)
  }

  // Sync scroll from editor scroll event (normal mode - ratio based)
  syncFromEditorScroll(textarea) {
    if (!this.syncScrollEnabledValue) return
    if (!this.isVisible) return
    if (!textarea) return

    const scrollTop = textarea.scrollTop
    const scrollHeight = textarea.scrollHeight - textarea.clientHeight

    if (scrollHeight <= 0) return

    const scrollRatio = scrollTop / scrollHeight
    this.syncScrollRatio(scrollRatio)
  }
}
