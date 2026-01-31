import { Controller } from "@hotwired/stimulus"
import { marked } from "marked"
import { escapeHtml } from "lib/text_utils"
import { findTableAtPosition, findCodeBlockAtPosition } from "lib/markdown_utils"
import { allExtensions } from "lib/marked_extensions"
import { encodePath } from "lib/url_utils"
import { flattenTree } from "lib/tree_utils"
import { LINE_NUMBER_MODES, normalizeLineNumberMode } from "lib/line_numbers"
import { parseIndentSetting, indentLines, unindentLines } from "lib/indent_utils"
import {
  getLineBoundaries,
  getCursorInfo as getTextCursorInfo,
  getPositionForLine
} from "lib/text_editor_utils"
import { calculateScrollForLine } from "lib/scroll_utils"
import {
  DEFAULT_SHORTCUTS,
  createKeyHandler,
  mergeShortcuts
} from "lib/keyboard_shortcuts"

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
    this.editorFontSizes = [12, 13, 14, 15, 16, 18, 20, 22, 24]

    // Load settings from server config (falls back to defaults if not available)
    const settings = this.hasConfigValue ? (this.configValue.settings || {}) : {}
    this.currentFont = settings.editor_font || "cascadia-code"
    this.currentFontSize = parseInt(settings.editor_font_size) || 14

    // Preview zoom (tracked for config saving, actual state in preview controller)
    this.previewZoom = parseInt(settings.preview_zoom) || 100

    // Sidebar/Explorer visibility
    this.sidebarVisible = settings.sidebar_visible !== false

    // Typewriter mode - tracked for coordination (actual state in typewriter controller)
    this.typewriterModeEnabled = settings.typewriter_mode === true

    // Editor indent setting: 0 = tab, 1-6 = spaces (default 2)
    this.editorIndent = parseIndentSetting(settings.editor_indent)

    // Line number mode - tracked for config reload (actual state in line-numbers controller)
    this.lineNumberMode = normalizeLineNumberMode(
      settings.editor_line_numbers,
      LINE_NUMBER_MODES.OFF
    )

    // Track pending config saves to debounce
    this.configSaveTimeout = null

    // Sync scroll enabled flag
    this.syncScrollEnabled = true

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
    if (this.configSaveTimeout) clearTimeout(this.configSaveTimeout)

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

  // === Controller Getters ===

  getPreviewController() {
    const previewElement = document.querySelector('[data-controller~="preview"]')
    if (previewElement) {
      return this.application.getControllerForElementAndIdentifier(previewElement, "preview")
    }
    return null
  }

  getLineNumbersController() {
    const element = document.querySelector('[data-controller~="line-numbers"]')
    if (element) {
      return this.application.getControllerForElementAndIdentifier(element, "line-numbers")
    }
    return null
  }

  getTypewriterController() {
    const element = document.querySelector('[data-controller~="typewriter"]')
    if (element) {
      return this.application.getControllerForElementAndIdentifier(element, "typewriter")
    }
    return null
  }

  getPathDisplayController() {
    const element = document.querySelector('[data-controller~="path-display"]')
    if (element) {
      return this.application.getControllerForElementAndIdentifier(element, "path-display")
    }
    return null
  }

  getDragDropController() {
    const element = document.querySelector('[data-controller~="drag-drop"]')
    if (element) {
      return this.application.getControllerForElementAndIdentifier(element, "drag-drop")
    }
    return null
  }

  getTextFormatController() {
    const textFormatElement = document.querySelector('[data-controller~="text-format"]')
    if (textFormatElement) {
      return this.application.getControllerForElementAndIdentifier(textFormatElement, "text-format")
    }
    return null
  }

  getHelpController() {
    const helpElement = document.querySelector('[data-controller~="help"]')
    if (helpElement) {
      return this.application.getControllerForElementAndIdentifier(helpElement, "help")
    }
    return null
  }

  getStatsPanelController() {
    const statsPanelElement = document.querySelector('[data-controller~="stats-panel"]')
    if (statsPanelElement) {
      return this.application.getControllerForElementAndIdentifier(statsPanelElement, "stats-panel")
    }
    return null
  }

  getFileOperationsController() {
    const element = document.querySelector('[data-controller~="file-operations"]')
    return element ? this.application.getControllerForElementAndIdentifier(element, "file-operations") : null
  }

  getEmojiPickerController() {
    const emojiPickerElement = document.querySelector('[data-controller~="emoji-picker"]')
    if (emojiPickerElement) {
      return this.application.getControllerForElementAndIdentifier(emojiPickerElement, "emoji-picker")
    }
    return null
  }

  // === URL Management for Bookmarkable URLs ===

  handleInitialFile() {
    // Check if server provided initial note data (from URL like /notes/path/to/file.md)
    if (this.hasInitialNoteValue && this.initialNoteValue) {
      const { path, content, exists, error } = this.initialNoteValue

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
    this.textareaTarget.value = content
    this.textareaTarget.focus()

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
    this.scheduleLineNumberUpdate()
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
    this.scheduleLineNumberUpdate()
    this.scheduleAutoSave()
    this.scheduleStatsUpdate()

    // Only do markdown-specific processing for markdown files
    if (this.isMarkdownFile()) {
      this.updatePreviewWithSync()
      this.checkTableAtCursor()
      this.maintainTypewriterScroll()
    }
  }

  onTextareaSelectionChange() {
    this.scheduleLineNumberUpdate()
    this.updateLinePosition()
  }

  onTextareaScroll() {
    this.syncLineNumberScroll()
    // Sync preview scroll
    const previewController = this.getPreviewController()
    if (previewController && previewController.isVisible && this.hasTextareaTarget) {
      if (this.typewriterModeEnabled) {
        previewController.syncScrollTypewriter(this.textareaTarget)
      } else {
        previewController.syncFromEditorScroll(this.textareaTarget)
      }
    }
  }

  // Update preview and sync scroll to cursor position
  updatePreviewWithSync() {
    const previewController = this.getPreviewController()
    if (!previewController || !previewController.isVisible) return
    if (!this.hasTextareaTarget) return

    const content = this.textareaTarget.value
    const cursorPos = this.textareaTarget.selectionStart

    previewController.updateWithSync(content, {
      cursorPos,
      typewriterMode: this.typewriterModeEnabled
    })
  }

  // Check if cursor is in a markdown table
  checkTableAtCursor() {
    if (!this.hasTextareaTarget) return

    const text = this.textareaTarget.value
    const cursorPos = this.textareaTarget.selectionStart
    const tableInfo = findTableAtPosition(text, cursorPos)

    if (tableInfo) {
      this.tableHintTarget.classList.remove("hidden")
    } else {
      this.tableHintTarget.classList.add("hidden")
    }
  }

  scheduleAutoSave() {
    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
    }
    this.showSaveStatus(window.t("status.unsaved"))
    this.saveTimeout = setTimeout(() => this.saveNow(), 1000)
  }

  async saveNow() {
    if (!this.currentFile || !this.hasTextareaTarget) return

    if (this.saveTimeout) {
      clearTimeout(this.saveTimeout)
      this.saveTimeout = null
    }

    const content = this.textareaTarget.value
    const isConfigFile = this.currentFile === ".fed"

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
      const oldZoom = this.previewZoom
      const oldLineNumberMode = this.lineNumberMode

      this.currentFont = settings.editor_font || "cascadia-code"
      this.currentFontSize = parseInt(settings.editor_font_size) || 14
      this.previewZoom = parseInt(settings.preview_zoom) || 100
      this.editorIndent = parseIndentSetting(settings.editor_indent)
      this.lineNumberMode = normalizeLineNumberMode(
        settings.editor_line_numbers,
        LINE_NUMBER_MODES.OFF
      )

      // Apply changes if they differ
      if (this.currentFont !== oldFont || this.currentFontSize !== oldFontSize) {
        this.applyEditorSettings()
      }
      if (this.previewZoom !== oldZoom) {
        const previewController = this.getPreviewController()
        if (previewController) {
          previewController.zoomValue = this.previewZoom
        }
      }
      if (this.lineNumberMode !== oldLineNumberMode) {
        const lineNumbersController = this.getLineNumbersController()
        if (lineNumbersController) {
          lineNumbersController.setMode(this.lineNumberMode)
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
    if (!this.hasTextareaTarget) return

    const content = this.textareaTarget.value

    // Build scroll data for preview controller
    const scrollData = { typewriterMode: this.typewriterModeEnabled }

    if (this.typewriterModeEnabled) {
      const textBeforeCursor = content.substring(0, this.textareaTarget.selectionStart)
      scrollData.currentLine = textBeforeCursor.split("\n").length
      scrollData.totalLines = content.split("\n").length
    }

    previewController.update(content, scrollData)
  }

  setupSyncScroll() {
    if (!this.hasTextareaTarget) return

    const previewController = this.getPreviewController()
    if (previewController) {
      previewController.setupEditorSync(this.textareaTarget)
    }

    // Sync on cursor position changes (selection change)
    this.textareaTarget.addEventListener("click", () => {
      if (this.typewriterModeEnabled) {
        this.maintainTypewriterScroll()
      } else {
        this.syncPreviewScrollToCursor()
      }
    })

    this.textareaTarget.addEventListener("keyup", (event) => {
      // Sync on arrow keys, page up/down, home/end
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) {
        if (this.typewriterModeEnabled) {
          this.maintainTypewriterScroll()
        } else {
          this.syncPreviewScrollToCursor()
        }
      }
    })
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
    if (this.hasTextareaTarget) {
      const text = this.textareaTarget.value
      const cursorPos = this.textareaTarget.selectionStart
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

    if (!this.hasTextareaTarget || !markdown) return

    const textarea = this.textareaTarget
    const text = textarea.value

    if (editMode) {
      // Replace existing table
      const before = text.substring(0, startPos)
      const after = text.substring(endPos)
      textarea.value = before + markdown + after

      // Position cursor after table
      const newPos = startPos + markdown.length
      textarea.setSelectionRange(newPos, newPos)
    } else {
      // Insert at cursor
      const cursorPos = textarea.selectionStart
      const before = text.substring(0, cursorPos)
      const after = text.substring(cursorPos)

      // Add newlines if needed
      const prefix = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""
      const suffix = after.length > 0 && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : ""

      textarea.value = before + prefix + markdown + suffix + after

      // Position cursor after table
      const newPos = before.length + prefix.length + markdown.length
      textarea.setSelectionRange(newPos, newPos)
    }

    textarea.focus()
    this.scheduleAutoSave()
    this.updatePreview()
  }

  // === Image Picker Event Handler ===
  onImageSelected(event) {
    const { markdown } = event.detail
    if (!markdown || !this.hasTextareaTarget) return

    const textarea = this.textareaTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value

    // Insert markdown at cursor position
    const before = text.substring(0, start)
    const after = text.substring(end)

    // Add newlines if needed
    const needsNewlineBefore = before.length > 0 && !before.endsWith("\n")
    const needsNewlineAfter = after.length > 0 && !after.startsWith("\n")

    const insert = (needsNewlineBefore ? "\n" : "") + markdown + (needsNewlineAfter ? "\n" : "")
    textarea.value = before + insert + after

    // Position cursor after inserted markdown
    const newPosition = start + insert.length
    textarea.setSelectionRange(newPosition, newPosition)
    textarea.focus()

    this.scheduleAutoSave()
    this.updatePreview()
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
    if (font && this.hasTextareaTarget) {
      this.textareaTarget.style.fontFamily = font.family
      this.textareaTarget.style.fontSize = `${this.currentFontSize}px`
    }
    this.scheduleLineNumberUpdate()
  }

  // === Line Numbers - Delegates to line_numbers_controller ===

  initializeLineNumbers() {
    const lineNumbersController = this.getLineNumbersController()
    if (lineNumbersController) {
      lineNumbersController.setMode(this.lineNumberMode)
    }
  }

  scheduleLineNumberUpdate() {
    const lineNumbersController = this.getLineNumbersController()
    if (lineNumbersController) {
      lineNumbersController.scheduleUpdate()
    }
  }

  syncLineNumberScroll() {
    const lineNumbersController = this.getLineNumbersController()
    if (lineNumbersController) {
      lineNumbersController.syncScroll()
    }
  }

  toggleLineNumberMode() {
    const lineNumbersController = this.getLineNumbersController()
    if (lineNumbersController) {
      lineNumbersController.toggle()
    }
  }

  // Handle line-numbers:mode-changed event
  onLineNumberModeChanged(event) {
    const { mode } = event.detail
    this.lineNumberMode = mode
    this.saveConfig({ editor_line_numbers: mode })
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
    try {
      const response = await fetch(`/notes/${encodePath(".fed")}`, {
        headers: { "Accept": "application/json" }
      })

      if (response.ok) {
        const data = await response.json()
        if (this.hasTextareaTarget && this.currentFile === ".fed") {
          // Save cursor position
          const cursorPos = this.textareaTarget.selectionStart
          // Update content
          this.textareaTarget.value = data.content || ""
          // Restore cursor position (or end of file if content is shorter)
          const newCursorPos = Math.min(cursorPos, this.textareaTarget.value.length)
          this.textareaTarget.setSelectionRange(newCursorPos, newCursorPos)
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
    this.saveConfig({ sidebar_visible: this.sidebarVisible })
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

    // Typewriter mode controls explorer and preview visibility
    if (enabled) {
      // Hide explorer
      this.sidebarVisible = false
      this.applySidebarVisibility()

      // Show preview
      if (previewController && !previewController.isVisible) {
        previewController.show()
        this.updatePreview()
        setTimeout(() => this.syncPreviewScrollToCursor(), 50)
      }
    } else {
      // Show explorer
      this.sidebarVisible = true
      this.applySidebarVisibility()

      // Hide preview
      if (previewController && previewController.isVisible) {
        previewController.hide()
      }
    }

    // Save sidebar visibility along with typewriter mode
    this.saveConfig({ sidebar_visible: this.sidebarVisible })
  }

  maintainTypewriterScroll() {
    const typewriterController = this.getTypewriterController()
    if (typewriterController && typewriterController.isEnabled) {
      typewriterController.maintainScroll()

      // Also sync preview if visible
      const previewController = this.getPreviewController()
      if (previewController && previewController.isVisible && this.hasTextareaTarget) {
        const content = this.textareaTarget.value
        const cursorPos = this.textareaTarget.selectionStart
        const textBeforeCursor = content.substring(0, cursorPos)
        const currentLine = textBeforeCursor.split("\n").length
        const totalLines = content.split("\n").length
        previewController.syncToTypewriter(currentLine, totalLines)
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
      this.saveConfig({ sidebar_visible: true })
      this.applySidebarVisibility()
    }

    // Load the file
    await this.loadFile(path)
  }

  openFindReplace(options = {}) {
    if (!this.hasTextareaTarget) return

    const selection = this.textareaTarget.value.substring(
      this.textareaTarget.selectionStart,
      this.textareaTarget.selectionEnd
    )

    const findReplaceElement = document.querySelector('[data-controller~="find-replace"]')
    if (findReplaceElement) {
      const findReplaceController = this.application.getControllerForElementAndIdentifier(
        findReplaceElement,
        "find-replace"
      )
      if (findReplaceController) {
        findReplaceController.open({
          textarea: this.textareaTarget,
          tab: options.tab,
          query: selection || undefined
        })
      }
    }
  }

  onFindReplaceJump(event) {
    if (!this.hasTextareaTarget) return

    const { start, end } = event.detail
    const textarea = this.textareaTarget
    textarea.focus()
    textarea.setSelectionRange(start, end)
    this.scrollTextareaToPosition(start)
  }

  onFindReplaceReplace(event) {
    if (!this.hasTextareaTarget) return

    const { start, end, replacement } = event.detail
    const textarea = this.textareaTarget
    const text = textarea.value
    const before = text.substring(0, start)
    const after = text.substring(end)
    textarea.value = before + replacement + after

    const newPosition = start + replacement.length
    textarea.focus()
    textarea.setSelectionRange(newPosition, newPosition)
    this.scrollTextareaToPosition(newPosition)
    this.onTextareaInput()
  }

  onFindReplaceReplaceAll(event) {
    if (!this.hasTextareaTarget) return

    const { updatedText } = event.detail
    if (typeof updatedText !== "string") return

    const textarea = this.textareaTarget
    textarea.value = updatedText
    textarea.focus()
    textarea.setSelectionRange(0, 0)
    this.scrollTextareaToPosition(0)
    this.onTextareaInput()
  }

  openJumpToLine() {
    if (!this.hasTextareaTarget) return

    const jumpElement = document.querySelector('[data-controller~="jump-to-line"]')
    if (jumpElement) {
      const jumpController = this.application.getControllerForElementAndIdentifier(
        jumpElement,
        "jump-to-line"
      )
      if (jumpController) {
        jumpController.open(this.textareaTarget)
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
    if (!this.hasTextareaTarget) return

    const textarea = this.textareaTarget

    // Use utility function to calculate character position
    const charPos = getPositionForLine(textarea.value, lineNumber)

    // Set cursor position
    textarea.focus()
    textarea.setSelectionRange(charPos, charPos)

    // Scroll to make the line visible using utility function
    const style = window.getComputedStyle(textarea)
    const fontSize = parseFloat(style.fontSize) || 14
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.6
    const targetScroll = calculateScrollForLine(lineNumber, lineHeight, textarea.clientHeight)

    textarea.scrollTop = targetScroll
  }

  scrollTextareaToPosition(position) {
    if (!this.hasTextareaTarget) return

    const textarea = this.textareaTarget
    const { line: lineNumber } = getTextCursorInfo(textarea.value, position)

    const style = window.getComputedStyle(textarea)
    const fontSize = parseFloat(style.fontSize) || 14
    const lineHeight = parseFloat(style.lineHeight) || fontSize * 1.6
    const targetScroll = calculateScrollForLine(lineNumber, lineHeight, textarea.clientHeight)

    textarea.scrollTop = targetScroll
  }

  // === Help Dialog - delegates to help controller ===
  openHelp() {
    const helpController = this.getHelpController()
    if (helpController) {
      helpController.openHelp()
    }
  }

  // === Code Snippet Editor - Delegates to code_dialog_controller ===
  openCodeEditor() {
    if (!this.hasTextareaTarget) return

    const text = this.textareaTarget.value
    const cursorPos = this.textareaTarget.selectionStart
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
    if (!this.hasTextareaTarget) return

    const { codeBlock, language, editMode, startPos, endPos } = event.detail
    const textarea = this.textareaTarget
    const text = textarea.value

    let newCursorPos

    if (editMode) {
      // Replace existing code block
      const before = text.substring(0, startPos)
      const after = text.substring(endPos)
      textarea.value = before + codeBlock + after

      // Position cursor at first line of content (after ```language\n)
      newCursorPos = startPos + 3 + language.length + 1
    } else {
      // Insert at cursor
      const cursorPos = textarea.selectionStart
      const before = text.substring(0, cursorPos)
      const after = text.substring(cursorPos)

      // Add newlines if needed
      const prefix = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""
      const suffix = after.length > 0 && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : ""

      textarea.value = before + prefix + codeBlock + suffix + after

      // Position cursor at first line inside the fence (after ```language\n)
      newCursorPos = before.length + prefix.length + 3 + language.length + 1
    }

    // Focus first, then set cursor position
    textarea.focus()
    setTimeout(() => {
      textarea.setSelectionRange(newCursorPos, newCursorPos)
    }, 0)
    this.scheduleAutoSave()
    this.updatePreview()
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
    if (!embedCode || !this.hasTextareaTarget) return

    const textarea = this.textareaTarget
    const cursorPos = textarea.selectionStart
    const text = textarea.value
    const before = text.substring(0, cursorPos)
    const after = text.substring(cursorPos)

    // Add newlines if needed
    const prefix = before.length > 0 && !before.endsWith("\n\n") ? (before.endsWith("\n") ? "\n" : "\n\n") : ""
    const suffix = after.length > 0 && !after.startsWith("\n\n") ? (after.startsWith("\n") ? "\n" : "\n\n") : ""

    textarea.value = before + prefix + embedCode + suffix + after

    const newCursorPos = before.length + prefix.length + embedCode.length
    textarea.focus()
    textarea.setSelectionRange(newCursorPos, newCursorPos)

    this.scheduleAutoSave()
    this.updatePreview()
  }

  // === AI Grammar Check Methods - Delegates to ai_grammar_controller ===

  async openAiDialog() {
    if (!this.currentFile) {
      alert(window.t("errors.no_file_open"))
      return
    }

    const text = this.textareaTarget.value
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
    this.textareaTarget.disabled = true

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
    this.textareaTarget.disabled = false

    if (this.hasAiButtonTarget && this.aiButtonOriginalContent) {
      this.aiButtonTarget.innerHTML = this.aiButtonOriginalContent
      this.aiButtonTarget.disabled = false
    }
  }

  // Handle AI correction accepted event - update textarea with corrected text
  onAiAccepted(event) {
    const { correctedText } = event.detail
    this.textareaTarget.value = correctedText
    this.onTextareaInput() // Trigger save and preview update
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
      this.updatePreview()
      setTimeout(() => this.syncPreviewScrollToCursor(), 50)
    }
    this.scheduleLineNumberUpdate()
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
    const { oldPath, newPath } = event.detail

    // Update current file if it was the renamed file
    if (this.currentFile === oldPath) {
      this.currentFile = newPath
      this.updatePathDisplay(newPath.replace(/\.md$/, ""))
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

  // Get the current indent string
  getIndentString() {
    return this.editorIndent || "  "
  }

  // Handle keydown events on textarea (Tab/Shift+Tab for indentation)
  onTextareaKeydown(event) {
    // Only handle Tab key
    if (event.key !== "Tab") return

    // Don't interfere if a dialog is open or modifier keys other than Shift are pressed
    if (event.ctrlKey || event.metaKey || event.altKey) return

    const textarea = this.textareaTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value

    // Check if there's a selection spanning multiple characters
    if (start === end) {
      // No selection - insert indent at cursor (default Tab behavior but with our indent string)
      event.preventDefault()
      if (!event.shiftKey) {
        const indent = this.getIndentString()
        const before = text.substring(0, start)
        const after = text.substring(end)
        textarea.value = before + indent + after
        textarea.selectionStart = textarea.selectionEnd = start + indent.length
        this.onTextareaInput()
      }
      return
    }

    // There's a selection - indent/unindent block using utility functions
    event.preventDefault()

    const { lineStart, lineEnd, lines } = getLineBoundaries(text, start, end)
    const selectedText = lines.join("\n")
    const indent = this.getIndentString()

    // Use imported indentLines/unindentLines from lib/indent_utils.js
    const modifiedText = event.shiftKey
      ? unindentLines(selectedText, indent)
      : indentLines(selectedText, indent)

    const before = text.substring(0, lineStart)
    const after = text.substring(lineEnd)

    textarea.value = before + modifiedText + after

    // Adjust selection to cover the modified lines
    const lengthDiff = modifiedText.length - selectedText.length
    textarea.selectionStart = lineStart
    textarea.selectionEnd = lineEnd + lengthDiff

    this.onTextareaInput()
  }

  // === Text Format Menu ===

  // Open text format menu via Ctrl+M
  openTextFormatMenu() {
    if (!this.hasTextareaTarget) return
    if (!this.isMarkdownFile()) return

    const textFormatController = this.getTextFormatController()
    if (textFormatController) {
      textFormatController.openAtCursor(this.textareaTarget)
    }
  }

  // Handle right-click on textarea to show text format menu
  onTextareaContextMenu(event) {
    if (!this.hasTextareaTarget) return
    if (!this.isMarkdownFile()) return

    const textarea = this.textareaTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd

    // Only show custom menu if text is selected
    if (start === end) return // Let default context menu show

    const selectedText = textarea.value.substring(start, end)
    if (!selectedText.trim()) return // Let default context menu show

    // Prevent default context menu
    event.preventDefault()

    const textFormatController = this.getTextFormatController()
    if (textFormatController) {
      textFormatController.openAtPosition(this.textareaTarget, event.clientX, event.clientY)
    }
  }

  // Handle text format applied event
  onTextFormatApplied(event) {
    if (!this.hasTextareaTarget) return

    const { prefix, suffix, selectionData } = event.detail
    if (!selectionData) return

    const textarea = this.textareaTarget
    const { start, end, text } = selectionData

    // Build the formatted text
    const formattedText = prefix + text + suffix

    // Replace the selected text
    const before = textarea.value.substring(0, start)
    const after = textarea.value.substring(end)
    textarea.value = before + formattedText + after

    // Calculate new cursor position
    // For link format, select "url" for easy replacement
    if (prefix === "[" && suffix === "](url)") {
      const urlStart = start + prefix.length + text.length + 2 // After ](
      const urlEnd = urlStart + 3 // Select "url"
      textarea.setSelectionRange(urlStart, urlEnd)
    } else {
      // Position cursor after the formatted text
      const newPosition = start + formattedText.length
      textarea.setSelectionRange(newPosition, newPosition)
    }

    textarea.focus()
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
  applyInlineFormat(formatId) {
    if (!this.hasTextareaTarget) return

    const textFormatController = this.getTextFormatController()
    if (!textFormatController) return

    if (textFormatController.applyFormatById(formatId, this.textareaTarget)) {
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
    if (!this.hasTextareaTarget) return

    const { text: insertText } = event.detail
    if (!insertText) return

    const textarea = this.textareaTarget
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const text = textarea.value

    // Insert the emoji/emoticon at cursor position
    const before = text.substring(0, start)
    const after = text.substring(end)
    textarea.value = before + insertText + after

    // Position cursor after the inserted text
    const newPosition = start + insertText.length
    textarea.setSelectionRange(newPosition, newPosition)

    textarea.focus()
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
    if (statsController && this.hasTextareaTarget) {
      statsController.scheduleUpdate(this.textareaTarget.value, this.getCursorInfo())
    }
  }

  updateStats() {
    const statsController = this.getStatsPanelController()
    if (statsController && this.hasTextareaTarget) {
      statsController.update(this.textareaTarget.value, this.getCursorInfo())
    }
  }

  updateLinePosition() {
    const statsController = this.getStatsPanelController()
    if (statsController && this.hasTextareaTarget) {
      statsController.updateLinePosition(this.getCursorInfo())
    }
  }

  getCursorInfo() {
    if (!this.hasTextareaTarget) return null

    const text = this.textareaTarget.value
    const cursorPos = this.textareaTarget.selectionStart
    const textBeforeCursor = text.substring(0, cursorPos)
    const currentLine = textBeforeCursor.split("\n").length
    const totalLines = text.split("\n").length

    return { currentLine, totalLines }
  }
}
