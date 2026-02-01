import { Controller } from "@hotwired/stimulus"
import { marked } from "marked"
import { escapeHtml } from "lib/text_utils"
import { findTableAtPosition, findCodeBlockAtPosition } from "lib/markdown_utils"
import { allExtensions } from "lib/marked_extensions"
import { encodePath } from "lib/url_utils"
import { flattenTree } from "lib/tree_utils"
import { LINE_NUMBER_MODES, normalizeLineNumberMode } from "lib/line_numbers"
import { parseIndentSetting } from "lib/indent_utils"
import {
  DEFAULT_SHORTCUTS,
  createKeyHandler,
  mergeShortcuts
} from "lib/keyboard_shortcuts"
import { createTextareaAdapter, getEditorContent } from "lib/codemirror_adapter"
import {
  insertBlockContent,
  insertInlineContent,
  insertImage,
  insertCodeBlock,
  insertVideoEmbed
} from "lib/codemirror_content_insertion"

export default class extends Controller {
  static targets = [
    "fileTree",
    "editorPlaceholder",
    "editor",
    "textarea",
    "currentPath",
    "saveStatus",
    "contextMenu",
    "editorToolbar",
    "helpDialog",
    "tableHint",
    "sidebar",
    "sidebarToggle",
    "aiButton",
    "editorWrapper",
    "editorBody"
  ]

  static values = {
    tree: Array,
    initialPath: String,
    initialNote: Object,
    config: Object
  }

  connect() {
    this.currentFile = null
    this.currentFileType = null  // "markdown", "config", or null
    this.expandedFolders = new Set()
    this.saveTimeout = null
    this.saveMaxIntervalTimeout = null  // Safety net for continuous typing
    this.isOffline = false
    this.hasUnsavedChanges = false
    this._lastSavedContent = null  // Track content to avoid redundant saves
    this._lastSaveTime = 0  // Track when we last saved

    // Editor customization - fonts in alphabetical order, Cascadia Code as default
    this.editorFonts = [
      { id: "cascadia-code", name: "Cascadia Code", family: "'Cascadia Code', monospace" },
      { id: "consolas", name: "Consolas", family: "Consolas, monospace" },
      { id: "dejavu-mono", name: "DejaVu Sans Mono", family: "'DejaVu Mono', monospace" },
      { id: "fira-code", name: "Fira Code", family: "'Fira Code', monospace" },
      { id: "hack", name: "Hack", family: "Hack, monospace" },
      { id: "jetbrains-mono", name: "JetBrains Mono", family: "'JetBrains Mono', monospace" },
      { id: "roboto-mono", name: "Roboto Mono", family: "'Roboto Mono', monospace" },
      { id: "source-code-pro", name: "Source Code Pro", family: "'Source Code Pro', monospace" },
      { id: "ubuntu-mono", name: "Ubuntu Mono", family: "'Ubuntu Mono', monospace" }
    ]

    // Load settings from server config (falls back to defaults if not available)
    const settings = this.hasConfigValue ? (this.configValue.settings || {}) : {}
    this.currentFont = settings.editor_font || "cascadia-code"
    this.currentFontSize = parseInt(settings.editor_font_size) || 14
    // Editor width with sane bounds (40-200 characters)
    const initWidth = parseInt(settings.editor_width) || 72
    this.editorWidth = Math.max(40, Math.min(200, initWidth))

    // Preview zoom (tracked for config saving, actual state in preview controller)
    this.previewZoom = parseInt(settings.preview_zoom) || 100

    // Sidebar/Explorer visibility - always start visible
    // (don't persist closed state across sessions)
    this.sidebarVisible = true

    // Typewriter mode - tracked for coordination (actual state in typewriter controller)
    this.typewriterModeEnabled = settings.typewriter_mode === true

    // Editor indent setting: 0 = tab, 1-6 = spaces (default 2)
    this.editorIndent = parseIndentSetting(settings.editor_indent)

    // Line number mode - tracked for config reload (actual state in CodeMirror)
    this.lineNumberMode = normalizeLineNumberMode(
      settings.editor_line_numbers,
      LINE_NUMBER_MODES.OFF
    )

    // Track pending config saves to debounce
    this.configSaveTimeout = null

    // Scroll sync coordination - prevents feedback loops between editor and preview
    this._scrollSource = null // 'editor' or 'preview'
    this._scrollSourceTimeout = null

    // Controller caching - avoid repeated querySelector calls
    this._controllerCache = {}
    this._controllerCacheTimeout = null

    // Debounce timers for performance
    this._tableCheckTimeout = null

    this.renderTree()
    this.setupKeyboardShortcuts()
    this.setupDialogClickOutside()
    this.setupSyncScroll()
    this.applyEditorSettings()
    this.applyPreviewZoom()
    this.applySidebarVisibility()
    this.initializeTypewriterMode()
    this.initializeLineNumbers()
    this.setupConfigFileListener()
    this.setupTableEditorListener()

    // Configure marked with custom extensions for superscript, subscript, highlight, emoji
    marked.use({
      breaks: true,
      gfm: true,
      extensions: allExtensions
    })

    // Handle initial file from URL (bookmarkable URLs)
    this.handleInitialFile()

    // Setup browser history handling for back/forward buttons
    this.setupHistoryHandling()
  }

  disconnect() {
    // Clear all timeouts
    if (this.saveTimeout) clearTimeout(this.saveTimeout)
    if (this.saveMaxIntervalTimeout) clearTimeout(this.saveMaxIntervalTimeout)
    if (this.configSaveTimeout) clearTimeout(this.configSaveTimeout)
    if (this._controllerCacheTimeout) clearTimeout(this._controllerCacheTimeout)
    if (this._tableCheckTimeout) clearTimeout(this._tableCheckTimeout)

    // Remove window/document event listeners
    if (this.boundPopstateHandler) {
      window.removeEventListener("popstate", this.boundPopstateHandler)
    }
    if (this.boundTableInsertHandler) {
      window.removeEventListener("frankmd:insert-table", this.boundTableInsertHandler)
    }
    if (this.boundConfigFileHandler) {
      window.removeEventListener("frankmd:config-file-modified", this.boundConfigFileHandler)
    }
    if (this.boundKeydownHandler) {
      document.removeEventListener("keydown", this.boundKeydownHandler)
    }

    // Clean up object URLs to prevent memory leaks
    this.cleanupLocalFolderImages()

    // Abort any pending AI requests
    if (this.aiImageAbortController) {
      this.aiImageAbortController.abort()
    }
  }

  // === Controller Getters (with caching) ===

  // Get a cached controller reference, with automatic invalidation
  // Controllers are cached for 5 seconds to balance performance with DOM changes
  _getCachedController(name, selector) {
    const cached = this._controllerCache[name]
    if (cached && cached.controller) {
      return cached.controller
    }

    const element = document.querySelector(selector)
    if (element) {
      const controller = this.application.getControllerForElementAndIdentifier(element, name)
      if (controller) {
        this._controllerCache[name] = { controller }
        // Auto-invalidate cache after 5 seconds (handles DOM changes)
        this._scheduleControllerCacheInvalidation()
        return controller
      }
    }
    return null
  }

  // Schedule cache invalidation (debounced to avoid constant clearing)
  _scheduleControllerCacheInvalidation() {
    if (this._controllerCacheTimeout) return // Already scheduled
    this._controllerCacheTimeout = setTimeout(() => {
      this._controllerCache = {}
      this._controllerCacheTimeout = null
    }, 5000)
  }

  // Invalidate controller cache immediately (call when DOM structure changes)
  _invalidateControllerCache() {
    this._controllerCache = {}
    if (this._controllerCacheTimeout) {
      clearTimeout(this._controllerCacheTimeout)
      this._controllerCacheTimeout = null
    }
  }

  getPreviewController() {
    return this._getCachedController("preview", '[data-controller~="preview"]')
  }

  getTypewriterController() {
    return this._getCachedController("typewriter", '[data-controller~="typewriter"]')
  }

  getCodemirrorController() {
    return this._getCachedController("codemirror", '[data-controller~="codemirror"]')
  }

  getPathDisplayController() {
    return this._getCachedController("path-display", '[data-controller~="path-display"]')
  }

  getTextFormatController() {
    return this._getCachedController("text-format", '[data-controller~="text-format"]')
  }

  getHelpController() {
    return this._getCachedController("help", '[data-controller~="help"]')
  }

  getStatsPanelController() {
    return this._getCachedController("stats-panel", '[data-controller~="stats-panel"]')
  }

  getFileOperationsController() {
    return this._getCachedController("file-operations", '[data-controller~="file-operations"]')
  }

  getEmojiPickerController() {
    return this._getCachedController("emoji-picker", '[data-controller~="emoji-picker"]')
  }

  // === URL Management for Bookmarkable URLs ===

  handleInitialFile() {
    // Check if server provided initial note data (from URL like /notes/path/to/file.md)
    const initialNote = this.hasInitialNoteValue ? this.initialNoteValue : null
    if (initialNote && Object.keys(initialNote).length > 0) {
      const { path, content, exists, error } = initialNote

      if (exists && content !== null) {
        // File exists - load it directly from server-provided data
        this.currentFile = path
        const fileType = this.getFileType(path)
        const displayPath = fileType === "markdown" ? path.replace(/\.md$/, "") : path
        this.updatePathDisplay(displayPath)
        this.expandParentFolders(path)
        this.showEditor(content, fileType)
        this.renderTree()
        return
      }

      if (!exists) {
        // File was requested but doesn't exist
        this.showFileNotFoundMessage(path, error || window.t("errors.file_not_found"))
        // Update URL to root without adding history entry
        this.updateUrl(null, { replace: true })
        return
      }
    }

    // Fallback: Check URL path directly (shouldn't normally happen if server is handling it)
    const urlPath = this.getFilePathFromUrl()
    if (urlPath) {
      this.loadFile(urlPath)
    }
  }

  getFilePathFromUrl() {
    const path = window.location.pathname
    const match = path.match(/^\/notes\/(.+\.md)$/)
    if (match) {
      return decodeURIComponent(match[1])
    }

    // Also check query param ?file=
    const params = new URLSearchParams(window.location.search)
    return params.get("file")
  }

  updateUrl(path, options = {}) {
    const { replace = false } = options
    const newUrl = path ? `/notes/${encodePath(path)}` : "/"

    if (window.location.pathname !== newUrl) {
      if (replace) {
        window.history.replaceState({ file: path }, "", newUrl)
      } else {
        window.history.pushState({ file: path }, "", newUrl)
      }
    }
  }

  setupHistoryHandling() {
    this.boundPopstateHandler = async (event) => {
      const path = event.state?.file || this.getFilePathFromUrl()

      if (path) {
        await this.loadFile(path, { updateHistory: false })
      } else {
        // No file - show placeholder
        this.currentFile = null
        this.updatePathDisplay(null)
        this.editorPlaceholderTarget.classList.remove("hidden")
        this.editorTarget.classList.add("hidden")
        this.editorToolbarTarget.classList.add("hidden")
        this.editorToolbarTarget.classList.remove("flex")
        this.hideStatsPanel()
        this.renderTree()
      }
    }
    window.addEventListener("popstate", this.boundPopstateHandler)
  }

  expandParentFolders(path) {
    const parts = path.split("/")
    let expandPath = ""

    for (let i = 0; i < parts.length - 1; i++) {
      expandPath = expandPath ? `${expandPath}/${parts[i]}` : parts[i]
      this.expandedFolders.add(expandPath)
    }
  }

  showFileNotFoundMessage(path, message) {
    this.editorPlaceholderTarget.classList.add("hidden")
    this.editorTarget.classList.remove("hidden")
    this.editorToolbarTarget.classList.add("hidden")
    this.editorToolbarTarget.classList.remove("flex")

    this.textareaTarget.value = ""
    this.textareaTarget.disabled = true

    this.currentPathTarget.innerHTML = `
      <span class="text-red-500">${escapeHtml(path)}</span>
      <span class="text-[var(--theme-text-muted)] ml-2">(${escapeHtml(message)})</span>
    `

    // Clear after a moment and return to normal state
    setTimeout(() => {
      this.textareaTarget.disabled = false
      this.updatePathDisplay(null)
      this.editorPlaceholderTarget.classList.remove("hidden")
      this.editorTarget.classList.add("hidden")
      this.hideStatsPanel()
    }, 5000)
  }

  // === Tree Rendering ===
  renderTree() {
    this.fileTreeTarget.innerHTML = this.buildTreeHTML(this.treeValue)
  }

  buildTreeHTML(items, depth = 0) {
    if (!items || items.length === 0) {
      if (depth === 0) {
        return `<div class="text-sm text-[var(--theme-text-muted)] p-2">${window.t("sidebar.no_notes_yet")}</div>`
      }
      return ""
    }

    return items.map(item => {
      if (item.type === "folder") {
        const isExpanded = this.expandedFolders.has(item.path)
        return `
          <div class="tree-folder" data-path="${escapeHtml(item.path)}">
            <div class="tree-item drop-target" draggable="true"
              data-action="click->app#toggleFolder contextmenu->app#showContextMenu dragstart->drag-drop#onDragStart dragover->drag-drop#onDragOver dragenter->drag-drop#onDragEnter dragleave->drag-drop#onDragLeave drop->drag-drop#onDrop dragend->drag-drop#onDragEnd"
              data-path="${escapeHtml(item.path)}" data-type="folder">
              <svg class="tree-chevron ${isExpanded ? 'expanded' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7" />
              </svg>
              <svg class="tree-icon text-[var(--theme-folder-icon)]" fill="currentColor" viewBox="0 0 20 20">
                <path d="M2 6a2 2 0 012-2h5l2 2h5a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V6z" />
              </svg>
              <span class="truncate">${escapeHtml(item.name)}</span>
            </div>
            <div class="tree-children ${isExpanded ? '' : 'hidden'}">
              ${this.buildTreeHTML(item.children, depth + 1)}
            </div>
          </div>
        `
      } else {
        const isSelected = this.currentFile === item.path
        const isConfig = item.file_type === "config"
        const icon = isConfig
          ? `<svg class="tree-icon text-[var(--theme-config-icon)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>`
          : `<svg class="tree-icon text-[var(--theme-file-icon)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>`
        // Config files should not be draggable or have context menu
        const dragAttrs = isConfig ? '' : 'draggable="true" data-action="click->app#selectFile contextmenu->app#showContextMenu dragstart->drag-drop#onDragStart dragend->drag-drop#onDragEnd"'
        const clickAction = isConfig ? 'data-action="click->app#selectFile"' : ''
        return `
          <div class="tree-item ${isSelected ? 'selected' : ''}" ${isConfig ? clickAction : dragAttrs}
            data-path="${escapeHtml(item.path)}" data-type="file" data-file-type="${item.file_type || 'markdown'}">
            ${icon}
            <span class="truncate">${escapeHtml(item.name)}</span>
          </div>
        `
      }
    }).join("")
  }

  toggleFolder(event) {
    const path = event.currentTarget.dataset.path
    const folderEl = event.currentTarget.closest(".tree-folder")
    const children = folderEl.querySelector(".tree-children")
    const chevron = event.currentTarget.querySelector(".tree-chevron")

    if (this.expandedFolders.has(path)) {
      this.expandedFolders.delete(path)
      children.classList.add("hidden")
      chevron.classList.remove("expanded")
    } else {
      this.expandedFolders.add(path)
      children.classList.remove("hidden")
      chevron.classList.add("expanded")
    }
  }

  // === Drag and Drop Event Handler ===
  // Handle item moved event from drag-drop controller
  async onItemMoved(event) {
    const { oldPath, newPath, type } = event.detail

    // Update current file reference if it was moved
    if (this.currentFile === oldPath) {
      this.currentFile = newPath
      this.updatePathDisplay(newPath.replace(/\.md$/, ""))
    } else if (type === "folder" && this.currentFile && this.currentFile.startsWith(oldPath + "/")) {
      // If a folder containing the current file was moved
      this.currentFile = this.currentFile.replace(oldPath, newPath)
      this.updatePathDisplay(this.currentFile.replace(/\.md$/, ""))
    }

    // Expand the target folder
    const targetFolder = newPath.split("/").slice(0, -1).join("/")
    if (targetFolder) {
      this.expandedFolders.add(targetFolder)
    }

    await this.refreshTree()
  }

  // === File Selection and Editor ===
  async selectFile(event) {
    const path = event.currentTarget.dataset.path
    await this.loadFile(path)
  }

  async loadFile(path, options = {}) {
    const { updateHistory = true } = options

    try {
      const response = await fetch(`/notes/${encodePath(path)}`, {
        headers: { "Accept": "application/json" }
      })

      if (!response.ok) {
        if (response.status === 404) {
          this.showFileNotFoundMessage(path, window.t("errors.note_not_found"))
          if (updateHistory) {
            this.updateUrl(null)
          }
          return
        }
        throw new Error(window.t("errors.failed_to_load"))
      }

      const data = await response.json()
      this.currentFile = path
      const fileType = this.getFileType(path)

      // Display path (don't strip extension for non-markdown files)
      const displayPath = fileType === "markdown" ? path.replace(/\.md$/, "") : path
      this.updatePathDisplay(displayPath)

      // Expand parent folders in tree
      this.expandParentFolders(path)

      this.showEditor(data.content, fileType)
      this.renderTree()

      // Update URL for bookmarkability
      if (updateHistory) {
        this.updateUrl(path)
      }
    } catch (error) {
      console.error("Error loading file:", error)
      this.showSaveStatus(window.t("status.error_loading"), true)
    }
  }

  showEditor(content, fileType = "markdown") {
    this.currentFileType = fileType
    this.editorPlaceholderTarget.classList.add("hidden")
    this.editorTarget.classList.remove("hidden")

    // Track the loaded content as "saved" baseline (prevents unnecessary saves)
    this._lastSavedContent = content
    this.hasUnsavedChanges = false

    // Set content via CodeMirror controller
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setValue(content)
      codemirrorController.focus()
    } else {
      // Fallback to hidden textarea
      this.textareaTarget.value = content
    }

    // Only show toolbar and preview for markdown files
    const isMarkdown = fileType === "markdown"

    if (isMarkdown) {
      this.editorToolbarTarget.classList.remove("hidden")
      this.editorToolbarTarget.classList.add("flex")
      this.updatePreview()
    } else {
      this.editorToolbarTarget.classList.add("hidden")
      this.editorToolbarTarget.classList.remove("flex")
      // Hide preview for non-markdown files
      const previewController = this.getPreviewController()
      if (previewController && previewController.isVisible) {
        previewController.hide()
      }
    }

    // Show stats panel and update stats
    this.showStatsPanel()
    this.updateStats()
    // Apply editor settings (font, size, line numbers)
    this.applyEditorSettings()
  }

  // Check if current file is markdown
  isMarkdownFile() {
    return this.currentFileType === "markdown"
  }

  // Get file type from path
  getFileType(path) {
    if (!path) return null
    if (path === ".fed") return "config"
    if (path.endsWith(".md")) return "markdown"
    return "text"
  }

  onTextareaInput() {
    // Legacy method - CodeMirror now handles input via onEditorChange
    this.onEditorChange({ detail: { docChanged: true } })
  }

  // Handle CodeMirror editor change events
  onEditorChange(event) {
    this.scheduleAutoSave()
    this.scheduleStatsUpdate()

    // Only do markdown-specific processing for markdown files
    if (this.isMarkdownFile()) {
      // Only sync preview if it's visible - skip entirely when closed
      const previewController = this.getPreviewController()
      if (previewController && previewController.isVisible) {
        this.updatePreviewWithSync()
      }

      this.checkTableAtCursor()

      // Typewriter scroll centering works regardless of preview
      if (this.typewriterModeEnabled) {
        this.maintainTypewriterScroll()
      }
    }
  }

  // Handle CodeMirror selection change events
  onEditorSelectionChange(event) {
    this.updateLinePosition()
  }

  // Handle CodeMirror scroll events
  onEditorScroll(event) {
    // Only sync when preview is visible - skip all sync logic when closed
    const previewController = this.getPreviewController()
    if (!previewController || !previewController.isVisible) return

    // Don't sync if this scroll was caused by preview sync (prevents feedback loop)
    if (this._scrollSource === "preview") return

    // Mark that editor initiated this scroll
    this._markScrollFromEditor()

    // Sync preview scroll position
    const scrollRatio = event.detail?.scrollRatio || 0
    previewController.syncScrollRatio(scrollRatio)
  }

  // Dispatch an input event to trigger all listeners after programmatic value changes
  // Note: CodeMirror handles this automatically, but kept for backward compatibility
  triggerTextareaInput() {
    this.onEditorChange({ detail: { docChanged: true } })
  }

  onTextareaSelectionChange() {
    // Legacy method - CodeMirror now handles selection via onEditorSelectionChange
    this.updateLinePosition()
  }

  onTextareaScroll() {
    // Legacy method - CodeMirror now handles scroll via onEditorScroll
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

  // Update preview and sync scroll to cursor position
  updatePreviewWithSync() {
    const previewController = this.getPreviewController()
    if (!previewController || !previewController.isVisible) return

    const codemirrorController = this.getCodemirrorController()
    const content = getEditorContent(codemirrorController, this.hasTextareaTarget ? this.textareaTarget : null)
    const cursorInfo = codemirrorController ? codemirrorController.getCursorPosition() : { offset: 0 }

    previewController.updateWithSync(content, {
      cursorPos: cursorInfo.offset,
      typewriterMode: this.typewriterModeEnabled
    })
  }

  // Check if cursor is in a markdown table (debounced to avoid performance issues)
  checkTableAtCursor() {
    // Debounce table detection - no need to check on every keystroke
    if (this._tableCheckTimeout) {
      clearTimeout(this._tableCheckTimeout)
    }

    this._tableCheckTimeout = setTimeout(() => {
      this._tableCheckTimeout = null
      this._doCheckTableAtCursor()
    }, 200)
  }

  // Internal: Actually perform the table check
  _doCheckTableAtCursor() {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const text = codemirrorController.getValue()
    const cursorInfo = codemirrorController.getCursorPosition()
    const tableInfo = findTableAtPosition(text, cursorInfo.offset)

    if (tableInfo) {
      this.tableHintTarget.classList.remove("hidden")
    } else {
      this.tableHintTarget.classList.add("hidden")
    }
  }

  // Auto-save configuration
  static SAVE_DEBOUNCE_MS = 2000      // Wait 2 seconds after last keystroke
  static SAVE_MAX_INTERVAL_MS = 30000 // Force save every 30 seconds if continuously typing

  scheduleAutoSave() {
    // Don't schedule saves while offline
    if (this.isOffline) {
      this.hasUnsavedChanges = true
      return
    }

    // Only show "unsaved" status once when transitioning from saved to unsaved
    if (!this.hasUnsavedChanges) {
      this.hasUnsavedChanges = true
      this.showSaveStatus(window.t("status.unsaved"))
    }

    // Clear existing debounce timer
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }

    // Debounced save - triggers 2 seconds after user stops typing
    this.saveTimeout = setTimeout(() => this.saveNow(), this.constructor.SAVE_DEBOUNCE_MS)

    // Safety net: ensure we save at least every 30 seconds during continuous typing
    // This prevents data loss if user types without pausing
    if (!this.saveMaxIntervalTimeout) {
      this.saveMaxIntervalTimeout = setTimeout(() => {
        this.saveMaxIntervalTimeout = null
        if (this.hasUnsavedChanges) {
          this.saveNow()
        }
      }, this.constructor.SAVE_MAX_INTERVAL_MS)
    }
  }

  async saveNow() {
    // Don't attempt saves while offline
    if (this.isOffline) {
      this.hasUnsavedChanges = true
      return
    }

    if (!this.currentFile) return

    // Clear both timers
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }
    if (this.saveMaxIntervalTimeout) {
      clearTimeout(this.saveMaxIntervalTimeout)
      this.saveMaxIntervalTimeout = null
    }

    // Get content from CodeMirror or fallback to textarea
    const codemirrorController = this.getCodemirrorController()
    const content = codemirrorController ? codemirrorController.getValue() : this.textareaTarget.value
    const isConfigFile = this.currentFile === ".fed"

    // Skip save if content hasn't actually changed since last save
    if (content === this._lastSavedContent) {
      this.hasUnsavedChanges = false
      this.showSaveStatus("")
      return
    }

    try {
      const response = await fetch(`/notes/${encodePath(this.currentFile)}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": this.csrfToken
        },
        body: JSON.stringify({ content })
      })

      if (!response.ok) {
        throw new Error(window.t("errors.failed_to_save"))
      }

      // Track what we saved
      this._lastSavedContent = content
      this._lastSaveTime = Date.now()
      this.hasUnsavedChanges = false
      this.showSaveStatus(window.t("status.saved"))
      setTimeout(() => this.showSaveStatus(""), 2000)

      // If config file was saved, reload the configuration
      if (isConfigFile) {
        await this.reloadConfig()
      }
    } catch (error) {
      console.error("Error saving:", error)
      this.showSaveStatus(window.t("status.error_saving"), true)
    }
  }

  // Connection status handlers
  onConnectionLost() {
    this.isOffline = true

    // Cancel any pending saves - we'll save when connection returns
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
      this.hasUnsavedChanges = true
    }
    if (this.saveMaxIntervalTimeout) {
      clearTimeout(this.saveMaxIntervalTimeout)
      this.saveMaxIntervalTimeout = null
    }

    // Cancel any pending config save
    if (this.configSaveTimeout) {
      clearTimeout(this.configSaveTimeout)
      this.configSaveTimeout = null
    }

    this.showSaveStatus(window.t("connection.offline_message"), true)
  }

  onConnectionRestored() {
    this.isOffline = false
    this.showSaveStatus("")

    // Save if there were unsaved changes
    if (this.hasUnsavedChanges && this.currentFile) {
      this.saveNow()
    }
  }

  // Reload configuration from server and apply changes
  async reloadConfig() {
    try {
      const response = await fetch("/config", {
        headers: { "Accept": "application/json" }
      })

      if (!response.ok) {
        console.warn("Failed to reload config")
        return
      }

      const data = await response.json()
      const settings = data.settings || {}

      // Apply UI settings
      const oldFont = this.currentFont
      const oldFontSize = this.currentFontSize
      const oldEditorWidth = this.editorWidth
      const oldZoom = this.previewZoom
      const oldLineNumberMode = this.lineNumberMode

      this.currentFont = settings.editor_font || "cascadia-code"
      this.currentFontSize = parseInt(settings.editor_font_size) || 14
      const reloadWidth = parseInt(settings.editor_width) || 72
      this.editorWidth = Math.max(40, Math.min(200, reloadWidth))
      this.previewZoom = parseInt(settings.preview_zoom) || 100
      this.editorIndent = parseIndentSetting(settings.editor_indent)
      this.lineNumberMode = normalizeLineNumberMode(
        settings.editor_line_numbers,
        LINE_NUMBER_MODES.OFF
      )

      // Apply changes if they differ
      if (this.currentFont !== oldFont || this.currentFontSize !== oldFontSize || this.editorWidth !== oldEditorWidth) {
        this.applyEditorSettings()
      }
      if (this.previewZoom !== oldZoom) {
        const previewController = this.getPreviewController()
        if (previewController) {
          previewController.zoomValue = this.previewZoom
        }
      }
      if (this.lineNumberMode !== oldLineNumberMode) {
        const codemirrorController = this.getCodemirrorController()
        if (codemirrorController) {
          codemirrorController.setLineNumberMode(this.lineNumberMode)
        }
      }

      // Notify theme controller to reload (dispatch custom event)
      const themeChanged = settings.theme
      if (themeChanged) {
        window.dispatchEvent(new CustomEvent("frankmd:config-changed", {
          detail: { theme: settings.theme }
        }))
      }

      this.showSaveStatus(window.t("status.config_applied"))
      setTimeout(() => this.showSaveStatus(""), 2000)
    } catch (error) {
      console.warn("Error reloading config:", error)
    }
  }

  showSaveStatus(text, isError = false) {
    this.saveStatusTarget.textContent = text
    this.saveStatusTarget.classList.toggle("hidden", !text)
    this.saveStatusTarget.classList.toggle("text-red-500", isError)
    this.saveStatusTarget.classList.toggle("dark:text-red-400", isError)
  }

  // === Preview Panel - Delegates to preview_controller ===
  togglePreview() {
    // Only allow preview for markdown files
    if (!this.isMarkdownFile()) {
      this.showTemporaryMessage("Preview is only available for markdown files")
      return
    }

    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.toggle()
    }
  }

  updatePreview() {
    const previewController = this.getPreviewController()
    if (!previewController || !previewController.isVisible) return

    const codemirrorController = this.getCodemirrorController()
    const content = getEditorContent(codemirrorController, this.hasTextareaTarget ? this.textareaTarget : null)

    // Build scroll data for preview controller
    const scrollData = { typewriterMode: this.typewriterModeEnabled }

    if (this.typewriterModeEnabled && codemirrorController) {
      const cursorInfo = codemirrorController.getCursorInfo()
      scrollData.currentLine = cursorInfo.currentLine
      scrollData.totalLines = cursorInfo.totalLines
    }

    previewController.update(content, scrollData)
  }

  setupSyncScroll() {
    // CodeMirror handles scroll events via data-action bindings
    // The onEditorScroll method handles preview synchronization
  }

  syncPreviewScrollToCursor() {
    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.syncToCursor()
    }
  }

  // === Table Editor ===
  openTableEditor() {
    let existingTable = null
    let startPos = 0
    let endPos = 0

    // Check if cursor is in existing table
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      const text = codemirrorController.getValue()
      const cursorPos = codemirrorController.getCursorPosition().offset
      const tableInfo = findTableAtPosition(text, cursorPos)

      if (tableInfo) {
        existingTable = tableInfo.lines.join("\n")
        startPos = tableInfo.startPos
        endPos = tableInfo.endPos
      }
    }

    // Dispatch event for table_editor_controller
    window.dispatchEvent(new CustomEvent("frankmd:open-table-editor", {
      detail: { existingTable, startPos, endPos }
    }))
  }

  // Setup listener for table insertion from table_editor_controller
  setupTableEditorListener() {
    this.boundTableInsertHandler = this.handleTableInsert.bind(this)
    window.addEventListener("frankmd:insert-table", this.boundTableInsertHandler)
  }

  // Handle table insertion from table_editor_controller
  handleTableInsert(event) {
    const { markdown, editMode, startPos, endPos } = event.detail

    if (!markdown) return

    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    insertBlockContent(codemirrorController, markdown, { editMode, startPos, endPos })
    codemirrorController.focus()
    this.onEditorChange({ detail: { docChanged: true } })
  }

  // === Image Picker Event Handler ===
  onImageSelected(event) {
    const { markdown } = event.detail
    if (!markdown) return

    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    insertImage(codemirrorController, markdown)
    codemirrorController.focus()
    this.onEditorChange({ detail: { docChanged: true } })
  }

  // Open image picker dialog (delegates to image-picker controller)
  openImagePicker() {
    const imagePickerElement = document.querySelector('[data-controller~="image-picker"]')
    if (imagePickerElement) {
      const imagePickerController = this.application.getControllerForElementAndIdentifier(
        imagePickerElement,
        "image-picker"
      )
      if (imagePickerController) {
        imagePickerController.open()
      }
    }
  }

  // === Editor Customization - Delegates to customize_controller ===
  openCustomize() {
    const customizeElement = document.querySelector('[data-controller~="customize"]')
    if (customizeElement) {
      const customizeController = this.application.getControllerForElementAndIdentifier(
        customizeElement,
        "customize"
      )
      if (customizeController) {
        customizeController.open(this.currentFont, this.currentFontSize)
      }
    }
  }

  // Handle customize:applied event from customize_controller
  onCustomizeApplied(event) {
    const { font, fontSize } = event.detail

    this.currentFont = font
    this.currentFontSize = fontSize

    // Save to server config
    this.saveConfig({
      editor_font: font,
      editor_font_size: fontSize
    })

    // Apply to editor
    this.applyEditorSettings()
  }

  applyEditorSettings() {
    const font = this.editorFonts.find(f => f.id === this.currentFont)
    const codemirrorController = this.getCodemirrorController()

    if (codemirrorController && font) {
      codemirrorController.setFontFamily(font.family)
      codemirrorController.setFontSize(this.currentFontSize)
      codemirrorController.setLineNumberMode(this.lineNumberMode)
    }

    // Apply editor width as CSS custom property
    document.documentElement.style.setProperty("--editor-width", `${this.editorWidth}ch`)
  }

  // === Editor Width Adjustment ===

  // Editor width bounds (in characters)
  static MIN_EDITOR_WIDTH = 40
  static MAX_EDITOR_WIDTH = 200
  static EDITOR_WIDTH_STEP = 8 // Change by 8 characters per step

  increaseEditorWidth() {
    const maxWidth = this.constructor.MAX_EDITOR_WIDTH
    const step = this.constructor.EDITOR_WIDTH_STEP

    if (this.editorWidth >= maxWidth) {
      this.showTemporaryMessage(`Maximum width (${maxWidth}ch)`)
      return
    }

    this.editorWidth = Math.min(this.editorWidth + step, maxWidth)
    this.applyEditorWidth()
    this.saveConfig({ editor_width: this.editorWidth })
    this.showTemporaryMessage(`Editor width: ${this.editorWidth}ch`)
  }

  decreaseEditorWidth() {
    const minWidth = this.constructor.MIN_EDITOR_WIDTH
    const step = this.constructor.EDITOR_WIDTH_STEP

    if (this.editorWidth <= minWidth) {
      this.showTemporaryMessage(`Minimum width (${minWidth}ch)`)
      return
    }

    this.editorWidth = Math.max(this.editorWidth - step, minWidth)
    this.applyEditorWidth()
    this.saveConfig({ editor_width: this.editorWidth })
    this.showTemporaryMessage(`Editor width: ${this.editorWidth}ch`)
  }

  applyEditorWidth() {
    document.documentElement.style.setProperty("--editor-width", `${this.editorWidth}ch`)
  }

  // === Line Numbers - Now handled by CodeMirror ===

  initializeLineNumbers() {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setLineNumberMode(this.lineNumberMode)
    }
  }

  scheduleLineNumberUpdate() {
    // CodeMirror handles line number updates automatically
  }

  syncLineNumberScroll() {
    // CodeMirror handles line number scroll automatically
  }

  // === Syntax Highlighting - Now handled by CodeMirror ===

  scheduleSyntaxHighlightUpdate() {
    // CodeMirror handles syntax highlighting automatically
  }

  toggleLineNumberMode() {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      this.lineNumberMode = codemirrorController.toggleLineNumberMode()
      this.saveConfig({ editor_line_numbers: this.lineNumberMode })
    }
  }


  // === Path Display - Delegates to path_display_controller ===

  updatePathDisplay(path) {
    const pathDisplayController = this.getPathDisplayController()
    if (pathDisplayController) {
      pathDisplayController.update(path)
    }
  }

  // === Save config settings to server (debounced) ===
  saveConfig(settings) {
    // Clear any pending save
    if (this.configSaveTimeout) {
      clearTimeout(this.configSaveTimeout)
    }

    // Debounce saves to avoid excessive API calls
    this.configSaveTimeout = setTimeout(async () => {
      try {
        const response = await fetch("/config", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            "Accept": "application/json",
            "X-CSRF-Token": document.querySelector('meta[name="csrf-token"]')?.content
          },
          body: JSON.stringify(settings)
        })

        if (!response.ok) {
          console.warn("Failed to save config:", await response.text())
        } else {
          // Notify other controllers that config file was modified
          window.dispatchEvent(new CustomEvent("frankmd:config-file-modified"))
        }
      } catch (error) {
        console.warn("Failed to save config:", error)
      }
    }, 500)
  }

  // Reload .fed content if it's open in the editor
  async reloadCurrentConfigFile() {
    if (this.currentFile !== ".fed") return

    try {
      const response = await fetch(`/notes/${encodePath(".fed")}`, {
        headers: { "Accept": "application/json" }
      })

      if (response.ok) {
        const data = await response.json()
        const codemirrorController = this.getCodemirrorController()
        if (codemirrorController) {
          // Save cursor position
          const cursorPos = codemirrorController.getCursorPosition().offset
          // Update content
          codemirrorController.setValue(data.content || "")
          // Restore cursor position (or end of file if content is shorter)
          const newContent = codemirrorController.getValue()
          const newCursorPos = Math.min(cursorPos, newContent.length)
          codemirrorController.setSelection(newCursorPos, newCursorPos)
        }
      }
    } catch (error) {
      console.warn("Failed to reload config file:", error)
    }
  }

  // Listen for config file modifications from any source (theme, settings, etc.)
  setupConfigFileListener() {
    this.boundConfigFileHandler = () => {
      // If .fed is currently open in the editor, reload it
      if (this.currentFile === ".fed") {
        this.reloadCurrentConfigFile()
      }
    }
    window.addEventListener("frankmd:config-file-modified", this.boundConfigFileHandler)
  }

  // === Preview Zoom - Delegates to preview_controller ===
  zoomPreviewIn() {
    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.zoomIn()
    }
  }

  zoomPreviewOut() {
    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.zoomOut()
    }
  }

  applyPreviewZoom() {
    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.applyZoom()
    }
  }

  // === Sidebar/Explorer Toggle ===
  toggleSidebar() {
    this.sidebarVisible = !this.sidebarVisible
    this.applySidebarVisibility()
  }

  applySidebarVisibility() {
    if (this.hasSidebarTarget) {
      this.sidebarTarget.classList.toggle("hidden", !this.sidebarVisible)
    }
    if (this.hasSidebarToggleTarget) {
      this.sidebarToggleTarget.setAttribute("aria-expanded", this.sidebarVisible.toString())
    }
    this.scheduleLineNumberUpdate()
  }

  // === Typewriter Mode - Delegates to typewriter_controller ===

  initializeTypewriterMode() {
    const typewriterController = this.getTypewriterController()
    if (typewriterController) {
      typewriterController.setEnabled(this.typewriterModeEnabled)
    }
  }

  toggleTypewriterMode() {
    // Only allow typewriter mode for markdown files
    if (!this.isMarkdownFile()) {
      this.showTemporaryMessage("Typewriter mode is only available for markdown files")
      return
    }

    const typewriterController = this.getTypewriterController()
    if (typewriterController) {
      typewriterController.toggle()
    }
  }

  // Handle typewriter:toggled event
  onTypewriterToggled(event) {
    const { enabled } = event.detail
    this.typewriterModeEnabled = enabled
    this.saveConfig({ typewriter_mode: enabled })

    // Toggle typewriter mode on preview controller
    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.setTypewriterMode(enabled)
    }

    // Typewriter mode: hide sidebar and preview for distraction-free writing
    // Editor is centered on screen with content width control
    if (enabled) {
      // Hide explorer
      this.sidebarVisible = false
      this.applySidebarVisibility()

      // Hide preview (keep editor only for focused writing)
      if (previewController && previewController.isVisible) {
        previewController.hide()
      }

      // Add typewriter body class for full-width editor centering
      document.body.classList.add("typewriter-mode")
    } else {
      // Show explorer
      this.sidebarVisible = true
      this.applySidebarVisibility()

      // Remove typewriter body class
      document.body.classList.remove("typewriter-mode")
    }
  }

  maintainTypewriterScroll() {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    // Center cursor in editor (works regardless of preview)
    codemirrorController.maintainTypewriterScroll()

    // Sync preview if visible
    const previewController = this.getPreviewController()
    if (previewController && previewController.isVisible) {
      const syncData = codemirrorController.getTypewriterSyncData()
      if (syncData) {
        previewController.syncToTypewriter(syncData.currentLine, syncData.totalLines)
      }
    }
  }

  // Show a temporary message to the user (auto-dismisses)
  showTemporaryMessage(message, duration = 2000) {
    // Remove any existing message
    const existing = document.querySelector(".temporary-message")
    if (existing) existing.remove()

    const el = document.createElement("div")
    el.className = "temporary-message fixed bottom-4 left-1/2 -translate-x-1/2 bg-[var(--theme-bg-secondary)] text-[var(--theme-text-primary)] px-4 py-2 rounded-lg shadow-lg border border-[var(--theme-border)] text-sm z-50"
    el.textContent = message
    document.body.appendChild(el)

    setTimeout(() => el.remove(), duration)
  }

  // === File Finder (Ctrl+P) - Delegates to file_finder_controller ===
  openFileFinder() {
    // Build flat list of all files from tree
    const files = flattenTree(this.treeValue)

    // Find the file-finder controller and call open
    const fileFinderElement = document.querySelector('[data-controller~="file-finder"]')
    if (fileFinderElement) {
      const fileFinderController = this.application.getControllerForElementAndIdentifier(
        fileFinderElement,
        "file-finder"
      )
      if (fileFinderController) {
        fileFinderController.open(files)
      }
    }
  }

  // Handle file selected event from file_finder_controller
  onFileSelected(event) {
    const { path } = event.detail
    this.openFileAndRevealInTree(path)
  }

  async openFileAndRevealInTree(path) {
    // Expand all parent folders in the tree
    const parts = path.split("/")
    let currentPath = ""
    for (let i = 0; i < parts.length - 1; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      this.expandedFolders.add(currentPath)
    }

    // Show sidebar if hidden
    if (!this.sidebarVisible) {
      this.sidebarVisible = true
      this.applySidebarVisibility()
    }

    // Load the file
    await this.loadFile(path)
  }

  openFindReplace(options = {}) {
    const codemirrorController = this.getCodemirrorController()
    const selection = codemirrorController ? codemirrorController.getSelection().text : ""

    const findReplaceElement = document.querySelector('[data-controller~="find-replace"]')
    if (findReplaceElement) {
      const findReplaceController = this.application.getControllerForElementAndIdentifier(
        findReplaceElement,
        "find-replace"
      )
      if (findReplaceController) {
        // Pass the codemirror controller's API adapter
        findReplaceController.open({
          textarea: this.createTextareaAdapter(),
          tab: options.tab,
          query: selection || undefined
        })
      }
    }
  }

  // Create an adapter that makes CodeMirror look like a textarea for find/replace
  createTextareaAdapter() {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) {
      return this.hasTextareaTarget ? this.textareaTarget : null
    }
    return createTextareaAdapter(codemirrorController)
  }

  onFindReplaceJump(event) {
    const { start, end } = event.detail
    const codemirrorController = this.getCodemirrorController()

    if (codemirrorController) {
      codemirrorController.focus()
      codemirrorController.setSelection(start, end)
      codemirrorController.scrollToPosition(start)
    }
  }

  onFindReplaceReplace(event) {
    const { start, end, replacement } = event.detail
    const codemirrorController = this.getCodemirrorController()

    if (codemirrorController) {
      codemirrorController.replaceRange(replacement, start, end)
      const newPosition = start + replacement.length
      codemirrorController.setSelection(newPosition, newPosition)
      codemirrorController.scrollToPosition(newPosition)
      this.onEditorChange({ detail: { docChanged: true } })
    }
  }

  onFindReplaceReplaceAll(event) {
    const { updatedText } = event.detail
    if (typeof updatedText !== "string") return

    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setValue(updatedText)
      codemirrorController.setSelection(0, 0)
      codemirrorController.scrollTo(0)
      this.onEditorChange({ detail: { docChanged: true } })
    }
  }

  openJumpToLine() {
    const jumpElement = document.querySelector('[data-controller~="jump-to-line"]')
    if (jumpElement) {
      const jumpController = this.application.getControllerForElementAndIdentifier(
        jumpElement,
        "jump-to-line"
      )
      if (jumpController) {
        // Pass a textarea adapter for the jump-to-line controller
        jumpController.open(this.createTextareaAdapter())
      }
    }
  }

  onJumpToLine(event) {
    const { lineNumber } = event.detail
    if (!lineNumber) return
    this.jumpToLine(lineNumber)
  }

  // Content Search (Ctrl+Shift+F) - Delegates to content_search_controller
  openContentSearch() {
    const contentSearchElement = document.querySelector('[data-controller~="content-search"]')
    if (contentSearchElement) {
      const contentSearchController = this.application.getControllerForElementAndIdentifier(
        contentSearchElement,
        "content-search"
      )
      if (contentSearchController) {
        contentSearchController.open()
      }
    }
  }

  // Handle search result selected event from content_search_controller
  async onSearchResultSelected(event) {
    const { path, lineNumber } = event.detail
    await this.openFileAndRevealInTree(path)
    this.jumpToLine(lineNumber)
  }

  jumpToLine(lineNumber) {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.jumpToLine(lineNumber)
    }
  }

  scrollTextareaToPosition(position) {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.scrollToPosition(position)
    }
  }

  // === Help Dialog - delegates to help controller ===
  openHelp() {
    const helpController = this.getHelpController()
    if (helpController) {
      helpController.openHelp()
    }
  }

  // === Log Viewer - Delegates to log_viewer_controller ===
  openLogViewer() {
    const logViewerElement = document.querySelector('[data-controller~="log-viewer"]')
    if (logViewerElement) {
      const logViewerController = this.application.getControllerForElementAndIdentifier(
        logViewerElement,
        "log-viewer"
      )
      if (logViewerController) {
        logViewerController.open()
      }
    }
  }

  // === Code Snippet Editor - Delegates to code_dialog_controller ===
  openCodeEditor() {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const text = codemirrorController.getValue()
    const cursorPos = codemirrorController.getCursorPosition().offset
    const codeBlock = findCodeBlockAtPosition(text, cursorPos)

    // Find the code-dialog controller and call open
    const codeDialogElement = document.querySelector('[data-controller~="code-dialog"]')
    if (codeDialogElement) {
      const codeDialogController = this.application.getControllerForElementAndIdentifier(
        codeDialogElement,
        "code-dialog"
      )
      if (codeDialogController) {
        if (codeBlock) {
          codeDialogController.open({
            language: codeBlock.language || "",
            content: codeBlock.content || "",
            editMode: true,
            startPos: codeBlock.startPos,
            endPos: codeBlock.endPos
          })
        } else {
          codeDialogController.open()
        }
      }
    }
  }

  // Handle code insert event from code_dialog_controller
  onCodeInsert(event) {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const { codeBlock, language, editMode, startPos, endPos } = event.detail

    insertCodeBlock(codemirrorController, codeBlock, language, { editMode, startPos, endPos })
    codemirrorController.focus()
    this.onEditorChange({ detail: { docChanged: true } })
  }

  // About Dialog - delegates to help controller
  openAboutDialog() {
    const helpController = this.getHelpController()
    if (helpController) {
      helpController.openAbout()
    }
  }

  // Video Dialog - delegates to video-dialog controller
  openVideoDialog() {
    const videoDialogElement = document.querySelector('[data-controller~="video-dialog"]')
    if (videoDialogElement) {
      const videoDialogController = this.application.getControllerForElementAndIdentifier(
        videoDialogElement,
        "video-dialog"
      )
      if (videoDialogController) {
        videoDialogController.open()
      }
    }
  }

  // Video Embed Event Handler - receives events from video_dialog_controller
  insertVideoEmbed(event) {
    const { embedCode } = event.detail
    if (!embedCode) return

    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    insertVideoEmbed(codemirrorController, embedCode)
    codemirrorController.focus()
    this.onEditorChange({ detail: { docChanged: true } })
  }

  // === AI Grammar Check Methods - Delegates to ai_grammar_controller ===

  async openAiDialog() {
    if (!this.currentFile) {
      alert(window.t("errors.no_file_open"))
      return
    }

    const codemirrorController = this.getCodemirrorController()
    const text = codemirrorController ? codemirrorController.getValue() : ""
    if (!text.trim()) {
      alert(window.t("errors.no_text_to_check"))
      return
    }

    // Save file first if there are pending changes (server reads from disk)
    if (this.saveTimeout) {
      await this.saveNow()
    }

    // Find the ai-grammar controller and call open
    const aiGrammarElement = document.querySelector('[data-controller~="ai-grammar"]')
    if (aiGrammarElement) {
      const aiGrammarController = this.application.getControllerForElementAndIdentifier(
        aiGrammarElement,
        "ai-grammar"
      )
      if (aiGrammarController) {
        aiGrammarController.open(this.currentFile)
      }
    }
  }

  // Handle AI processing started event - disable editor and show button loading state
  onAiProcessingStarted() {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setReadOnly(true)
    }

    if (this.hasAiButtonTarget) {
      this.aiButtonOriginalContent = this.aiButtonTarget.innerHTML
      this.aiButtonTarget.innerHTML = `
        <svg class="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        <span>${window.t("status.processing")}</span>
      `
      this.aiButtonTarget.disabled = true
    }
  }

  // Handle AI processing ended event - re-enable editor and restore button
  onAiProcessingEnded() {
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setReadOnly(false)
    }

    if (this.hasAiButtonTarget && this.aiButtonOriginalContent) {
      this.aiButtonTarget.innerHTML = this.aiButtonOriginalContent
      this.aiButtonTarget.disabled = false
    }
  }

  // Handle AI correction accepted event - update editor with corrected text
  onAiAccepted(event) {
    const { correctedText } = event.detail
    const codemirrorController = this.getCodemirrorController()
    if (codemirrorController) {
      codemirrorController.setValue(correctedText)
      this.onEditorChange({ detail: { docChanged: true } })
    }
  }

  // Handle preview zoom changed event - save to config
  onPreviewZoomChanged(event) {
    const { zoom } = event.detail
    this.previewZoom = zoom
    this.saveConfig({ preview_zoom: zoom })
  }

  // Handle preview toggled event
  onPreviewToggled(event) {
    const { visible } = event.detail
    if (visible) {
      // Ensure editor sync is setup (may not have been ready at connect time)
      const previewController = this.getPreviewController()
      if (previewController && this.hasTextareaTarget) {
        previewController.setupEditorSync(this.textareaTarget)
      }
      this.updatePreview()
      setTimeout(() => this.syncPreviewScrollToCursor(), 50)
    }
    this.scheduleLineNumberUpdate()
  }

  // Handle preview scroll event - sync editor to preview position
  onPreviewScroll(event) {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    // Don't sync if this scroll was caused by editor sync (prevents feedback loop)
    if (this._scrollSource === "editor") return

    // Mark that preview initiated this scroll
    this._markScrollFromPreview()

    const { scrollRatio, sourceLine, totalLines } = event.detail
    const scrollInfo = codemirrorController.getScrollInfo()
    const maxScroll = scrollInfo.height - scrollInfo.clientHeight
    if (maxScroll <= 0) return

    let targetScroll

    // Try line-based sync first (more accurate with images/embeds)
    if (sourceLine && totalLines > 1) {
      // Convert source line to scroll position
      const lineRatio = (sourceLine - 1) / (totalLines - 1)
      targetScroll = lineRatio * maxScroll
    } else {
      // Fallback to ratio-based sync
      targetScroll = scrollRatio * maxScroll
    }

    // Only scroll if change is significant (prevent jitter)
    if (Math.abs(scrollInfo.top - targetScroll) > 5) {
      codemirrorController.scrollTo(targetScroll)
    }
  }

  // === File Operations Event Handlers ===

  async onFileCreated(event) {
    const { path } = event.detail

    // Expand parent folders
    const pathParts = path.split("/")
    let expandPath = ""
    for (let i = 0; i < pathParts.length - 1; i++) {
      expandPath = expandPath ? `${expandPath}/${pathParts[i]}` : pathParts[i]
      this.expandedFolders.add(expandPath)
    }

    await this.refreshTree()
    await this.loadFile(path)
  }

  async onFolderCreated(event) {
    const { path } = event.detail
    this.expandedFolders.add(path)
    await this.refreshTree()
  }

  async onFileRenamed(event) {
    const { oldPath, newPath, type } = event.detail

    // For folder renames, check if current file is inside the renamed folder
    if (type === "folder" && this.currentFile?.startsWith(oldPath + "/")) {
      const newFilePath = this.currentFile.replace(oldPath, newPath)
      // Navigate to new URL to force full refresh
      window.location.href = `/notes/${encodePath(newFilePath)}`
      return
    }

    // Update current file if it was the renamed file
    if (this.currentFile === oldPath) {
      this.currentFile = newPath
      this.updatePathDisplay(newPath.replace(/\.md$/, ""))
      this.updateUrl(newPath)
    }

    await this.refreshTree()
  }

  async onFileDeleted(event) {
    const { path } = event.detail

    // Clear editor if deleted file was currently open
    if (this.currentFile === path) {
      this.currentFile = null
      this.updatePathDisplay(null)
      this.editorPlaceholderTarget.classList.remove("hidden")
      this.editorTarget.classList.add("hidden")
      this.hideStatsPanel()
    }

    await this.refreshTree()
  }

  // File Operations - delegate to file-operations controller
  newNote() {
    const fileOps = this.getFileOperationsController()
    if (fileOps) fileOps.newNote()
  }

  newFolder() {
    const fileOps = this.getFileOperationsController()
    if (fileOps) fileOps.newFolder()
  }

  showContextMenu(event) {
    const fileOps = this.getFileOperationsController()
    if (fileOps) fileOps.showContextMenu(event)
  }

  setupDialogClickOutside() {
    // Close dialog when clicking on backdrop (outside the dialog content)
    if (this.hasHelpDialogTarget) {
      this.helpDialogTarget.addEventListener("click", (event) => {
        if (event.target === this.helpDialogTarget) {
          this.helpDialogTarget.close()
        }
      })
    }
  }

  async refreshTree() {
    try {
      const response = await fetch("/notes/tree", {
        headers: { "Accept": "application/json" }
      })
      if (response.ok) {
        this.treeValue = await response.json()
        this.renderTree()
      }
    } catch (error) {
      console.error("Error refreshing tree:", error)
    }
  }

  // === Keyboard Shortcuts ===
  setupKeyboardShortcuts() {
    // Merge default shortcuts with user customizations (future: load from config)
    const shortcuts = mergeShortcuts(DEFAULT_SHORTCUTS, this.userShortcuts)

    this.boundKeydownHandler = createKeyHandler(shortcuts, (action) => {
      this.executeShortcutAction(action)
    })

    document.addEventListener("keydown", this.boundKeydownHandler)
  }

  // Execute an action triggered by a keyboard shortcut
  executeShortcutAction(action) {
    const actions = {
      newNote: () => this.getFileOperationsController()?.newNote(),
      save: () => this.saveNow(),
      bold: () => this.applyInlineFormat("bold"),
      italic: () => this.applyInlineFormat("italic"),
      togglePreview: () => this.togglePreview(),
      findInFile: () => this.openFindReplace(),
      findReplace: () => this.openFindReplace({ tab: "replace" }),
      jumpToLine: () => this.openJumpToLine(),
      lineNumbers: () => this.toggleLineNumberMode(),
      contentSearch: () => this.openContentSearch(),
      fileFinder: () => this.openFileFinder(),
      toggleSidebar: () => this.toggleSidebar(),
      typewriterMode: () => this.toggleTypewriterMode(),
      textFormat: () => this.openTextFormatMenu(),
      emojiPicker: () => this.openEmojiPicker(),
      increaseWidth: () => this.increaseEditorWidth(),
      decreaseWidth: () => this.decreaseEditorWidth(),
      logViewer: () => this.openLogViewer(),
      help: () => this.openHelp(),
      closeDialogs: () => this.closeAllDialogs()
    }

    const handler = actions[action]
    if (handler) {
      handler()
    }
  }

  // Close all open dialogs and menus
  closeAllDialogs() {
    // Close context menu
    if (this.hasContextMenuTarget) {
      this.contextMenuTarget.classList.add("hidden")
    }

    // Close help dialog
    if (this.hasHelpDialogTarget && this.helpDialogTarget.open) {
      this.helpDialogTarget.close()
    }
  }

  // === Editor Indentation ===
  // Note: Tab/Shift+Tab indentation is now handled by CodeMirror's indentWithTab keymap

  // Get the current indent string
  getIndentString() {
    return this.editorIndent || "  "
  }

  // Handle keydown events on textarea (legacy - now handled by CodeMirror)
  onTextareaKeydown(event) {
    // CodeMirror handles Tab/Shift+Tab indentation via indentWithTab keymap
    // This method is kept for backward compatibility but doesn't need to do anything
  }

  // === Text Format Menu ===

  // Open text format menu via Ctrl+M
  openTextFormatMenu() {
    if (!this.isMarkdownFile()) return

    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const textFormatController = this.getTextFormatController()
    if (textFormatController) {
      // Use the textarea adapter for text format controller
      textFormatController.openAtCursor(this.createTextareaAdapter())
    }
  }

  // Handle right-click on editor to show text format menu
  onTextareaContextMenu(event) {
    if (!this.isMarkdownFile()) return

    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const { from, to, text: selectedText } = codemirrorController.getSelection()

    // Only show custom menu if text is selected
    if (from === to) return // Let default context menu show

    if (!selectedText.trim()) return // Let default context menu show

    // Prevent default context menu
    event.preventDefault()

    const textFormatController = this.getTextFormatController()
    if (textFormatController) {
      textFormatController.openAtPosition(this.createTextareaAdapter(), event.clientX, event.clientY)
    }
  }

  // Handle text format applied event
  onTextFormatApplied(event) {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const { prefix, suffix, selectionData } = event.detail
    if (!selectionData) return

    const { start, end, text } = selectionData
    const fullText = codemirrorController.getValue()

    // Check for toggle (unwrap) if format is symmetric
    const isToggleable = prefix === suffix
    if (isToggleable) {
      // Case 1: Selection itself includes the markers
      if (text.startsWith(prefix) && text.endsWith(suffix) && text.length >= prefix.length + suffix.length) {
        const unwrapped = text.slice(prefix.length, -suffix.length || undefined)
        codemirrorController.replaceRange(unwrapped, start, end)
        codemirrorController.setSelection(start, start + unwrapped.length)
        codemirrorController.focus()
        this.scheduleAutoSave()
        this.updatePreview()
        return
      }

      // Case 2: Markers are just outside the selection
      const beforeStart = start - prefix.length
      const afterEnd = end + suffix.length
      if (beforeStart >= 0 && afterEnd <= fullText.length) {
        const textBefore = fullText.substring(beforeStart, start)
        const textAfter = fullText.substring(end, afterEnd)
        if (textBefore === prefix && textAfter === suffix) {
          codemirrorController.replaceRange(text, beforeStart, afterEnd)
          codemirrorController.setSelection(beforeStart, beforeStart + text.length)
          codemirrorController.focus()
          this.scheduleAutoSave()
          this.updatePreview()
          return
        }
      }
    }

    // Build the formatted text
    const formattedText = prefix + text + suffix

    // Replace the selected text
    codemirrorController.replaceRange(formattedText, start, end)

    // Calculate new cursor position
    // For link format, select "url" for easy replacement
    if (prefix === "[" && suffix === "](url)") {
      const urlStart = start + prefix.length + text.length + 2 // After ](
      const urlEnd = urlStart + 3 // Select "url"
      codemirrorController.setSelection(urlStart, urlEnd)
    } else {
      // Position cursor after the formatted text
      const newPosition = start + formattedText.length
      codemirrorController.setSelection(newPosition, newPosition)
    }

    codemirrorController.focus()
    this.scheduleAutoSave()
    this.updatePreview()
  }

  // Handle text format menu closed event (return focus to textarea)
  onTextFormatClosed() {
    if (this.hasTextareaTarget) {
      this.textareaTarget.focus()
    }
  }

  // Apply inline formatting directly (for keyboard shortcuts like Ctrl+B, Ctrl+I)
  // Note: CodeMirror now handles Ctrl+B and Ctrl+I via its own keymap
  applyInlineFormat(formatId) {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const textFormatController = this.getTextFormatController()
    if (!textFormatController) return

    if (textFormatController.applyFormatById(formatId, this.createTextareaAdapter())) {
      this.scheduleAutoSave()
      this.updatePreview()
    }
  }

  // === Emoji Picker ===

  // Open emoji picker dialog
  openEmojiPicker() {
    if (!this.hasTextareaTarget) return
    if (!this.isMarkdownFile()) return

    const emojiPickerController = this.getEmojiPickerController()
    if (emojiPickerController) {
      emojiPickerController.open()
    }
  }

  // Handle emoji/emoticon selected event
  onEmojiSelected(event) {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return

    const { text: insertText } = event.detail
    if (!insertText) return

    insertInlineContent(codemirrorController, insertText)
    codemirrorController.focus()
    this.scheduleAutoSave()
    this.updatePreview()
  }

  // === Utilities ===

  // Get CSRF token safely
  get csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')
    return meta ? meta.content : ""
  }

  // Position a dialog near a specific point (for explorer dialogs)
  positionDialogNearPoint(dialog, x, y) {
    dialog.classList.add("positioned")

    // Use showModal first to get dimensions
    dialog.showModal()

    // Get dialog dimensions
    const rect = dialog.getBoundingClientRect()
    const padding = 10

    // Calculate position, keeping dialog on screen
    let left = x
    let top = y

    // Adjust if dialog would go off right edge
    if (left + rect.width > window.innerWidth - padding) {
      left = window.innerWidth - rect.width - padding
    }

    // Adjust if dialog would go off bottom edge
    if (top + rect.height > window.innerHeight - padding) {
      top = window.innerHeight - rect.height - padding
    }

    // Ensure dialog stays on screen (left/top)
    left = Math.max(padding, left)
    top = Math.max(padding, top)

    dialog.style.left = `${left}px`
    dialog.style.top = `${top}px`
  }

  // Show dialog centered (default behavior)
  showDialogCentered(dialog) {
    dialog.classList.remove("positioned")
    dialog.style.left = ""
    dialog.style.top = ""
    dialog.showModal()
  }

  // Clean up any object URLs created for local folder images
  cleanupLocalFolderImages() {
    // Implementation depends on image picker state
    // This is called on disconnect to prevent memory leaks
  }

  // === Document Stats - delegates to stats-panel controller ===

  showStatsPanel() {
    const statsController = this.getStatsPanelController()
    if (statsController) {
      statsController.show()
    }
  }

  hideStatsPanel() {
    const statsController = this.getStatsPanelController()
    if (statsController) {
      statsController.hide()
    }
  }

  scheduleStatsUpdate() {
    const statsController = this.getStatsPanelController()
    const codemirrorController = this.getCodemirrorController()
    if (statsController && codemirrorController) {
      statsController.scheduleUpdate(codemirrorController.getValue(), codemirrorController.getCursorInfo())
    }
  }

  updateStats() {
    const statsController = this.getStatsPanelController()
    const codemirrorController = this.getCodemirrorController()
    if (statsController && codemirrorController) {
      statsController.update(codemirrorController.getValue(), codemirrorController.getCursorInfo())
    }
  }

  updateLinePosition() {
    const statsController = this.getStatsPanelController()
    const codemirrorController = this.getCodemirrorController()
    if (statsController && codemirrorController) {
      statsController.updateLinePosition(codemirrorController.getCursorInfo())
    }
  }

  getCursorInfo() {
    const codemirrorController = this.getCodemirrorController()
    if (!codemirrorController) return null

    return codemirrorController.getCursorInfo()
  }
}
