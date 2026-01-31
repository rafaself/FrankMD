import { Controller } from "@hotwired/stimulus"
import {
  findAllMatches,
  findClosestMatchIndex,
  replaceMatches,
  validateRegex
} from "lib/find_utils"

export default class extends Controller {
  static targets = [
    "dialog",
    "findInput",
    "replaceInput",
    "replaceSection",
    "tabFind",
    "tabReplace",
    "matchCount",
    "miniBar",
    "miniCount",
    "miniModeLabel",
    "caseSensitiveToggle",
    "regexToggle"
  ]

  static values = {
    caseSensitive: { type: Boolean, default: false },
    useRegex: { type: Boolean, default: false }
  }

  connect() {
    this.activeTab = "find"
    this.matches = []
    this.currentMatchIndex = -1
    this.textareaRef = null
    this.boundTextareaInput = null
    this.boundDocumentKeydown = null
    this.updateTabState()
    this.updateToggleState()
    this.updateMatchCount()
  }

  open(options = {}) {
    const { textarea, tab = "find", query } = options
    if (textarea) {
      this.textareaRef = textarea
    }

    if (query) {
      this.findInputTarget.value = query
    }

    this.setActiveTab(tab)
    this.showDialog()
    this.hideMiniBar()

    this.findInputTarget.focus()
    this.findAll()
    this.bindTextareaListener()
    this.bindDocumentKeydown()
  }

  close() {
    this.hideDialog()
    this.hideMiniBar()

    this.matches = []
    this.currentMatchIndex = -1
    this.updateMatchCount()
    this.unbindTextareaListener()
    this.unbindDocumentKeydown()
  }

  minimize() {
    if (!this.findInputTarget.value) {
      this.close()
      return
    }

    this.hideDialog()
    this.showMiniBar()
    this.bindDocumentKeydown()
  }

  skip() {
    this.findNext()
  }

  miniNext() {
    if (this.activeTab === "replace") {
      this.replaceCurrent(true)
      return
    }

    this.findNext()
  }

  miniPrevious() {
    if (this.activeTab === "replace") {
      this.replaceCurrent(false)
      this.findPrevious()
      return
    }

    this.findPrevious()
  }

  miniSkip() {
    this.findNext()
  }

  restore() {
    this.showDialog()
    this.hideMiniBar()
    this.findInputTarget.focus()
  }

  onInput() {
    this.findAll()
  }

  onKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault()
      this.close()
      return
    }

    if (event.key === "Enter") {
      event.preventDefault()

      if (event.altKey && this.activeTab === "replace") {
        this.replaceCurrent(true)
        return
      }

      if (event.shiftKey) {
        this.findPrevious()
      } else {
        this.findNext()
      }
    }
  }

  switchToFind() {
    this.setActiveTab("find")
  }

  switchToReplace() {
    this.setActiveTab("replace")
  }

  toggleCaseSensitive() {
    this.caseSensitiveValue = !this.caseSensitiveValue
    this.updateToggleState()
    this.findAll()
  }

  toggleRegex() {
    this.useRegexValue = !this.useRegexValue
    this.updateToggleState()
    this.findAll()
  }

  findAll() {
    const searchTerm = this.findInputTarget.value
    const text = this.textareaRef ? this.textareaRef.value : ""

    if (!searchTerm) {
      this.matches = []
      this.currentMatchIndex = -1
      this.updateMatchCount()
      return
    }

    if (this.useRegexValue) {
      const validation = validateRegex(searchTerm)
      if (!validation.valid) {
        this.matches = []
        this.currentMatchIndex = -1
        this.matchCountTarget.textContent = validation.error || "Invalid regex"
        this.matchCountTarget.classList.add("text-red-500")
        return
      }
    }

    this.matches = findAllMatches(text, searchTerm, {
      caseSensitive: this.caseSensitiveValue,
      useRegex: this.useRegexValue
    })

    const position = this.textareaRef ? this.textareaRef.selectionStart : 0
    this.currentMatchIndex = findClosestMatchIndex(this.matches, position, "next")
    this.updateMatchCount()
  }

  findNext() {
    if (!this.matches.length) {
      this.findAll()
    }

    if (!this.matches.length) return

    const position = this.textareaRef ? this.textareaRef.selectionEnd : 0
    this.currentMatchIndex = findClosestMatchIndex(this.matches, position, "next")
    this.jumpToMatch(this.currentMatchIndex)
  }

  findPrevious() {
    if (!this.matches.length) {
      this.findAll()
    }

    if (!this.matches.length) return

    const position = this.textareaRef ? this.textareaRef.selectionStart : 0
    this.currentMatchIndex = findClosestMatchIndex(this.matches, position, "previous")
    this.jumpToMatch(this.currentMatchIndex)
  }

  replaceCurrent(advance = false) {
    if (!this.matches.length) return

    const match = this.matches[this.currentMatchIndex]
    if (!match) return

    const replacement = this.buildReplacement(match)
    this.dispatch("replace", { detail: { start: match.start, end: match.end, replacement } })
    this.findAll()

    if (advance) {
      this.findNext()
    }
  }

  replaceAll() {
    if (!this.matches.length) return

    const replacement = this.replaceInputTarget.value
    const text = this.textareaRef ? this.textareaRef.value : ""
    const updated = replaceMatches(text, this.matches, replacement, {
      useRegex: this.useRegexValue
    })

    this.dispatch("replace-all", {
      detail: {
        matches: this.matches,
        replacement,
        useRegex: this.useRegexValue,
        updatedText: updated
      }
    })

    this.findAll()
  }

  jumpToMatch(index) {
    const match = this.matches[index]
    if (!match) return

    this.dispatch("jump", { detail: { start: match.start, end: match.end } })
    this.updateMatchCount()
  }

  updateMatchCount() {
    this.matchCountTarget.classList.remove("text-red-500")

    const total = this.matches.length
    if (!this.findInputTarget.value) {
      this.matchCountTarget.textContent = ""
      if (this.hasMiniCountTarget) {
        this.miniCountTarget.textContent = ""
      }
      this.hideMiniBar()
      return
    }

    let text
    if (total === 0) {
      text = window.t("dialogs.find_replace.no_results")
    } else {
      const current = this.currentMatchIndex >= 0 ? this.currentMatchIndex + 1 : 0
      text = window.t("dialogs.find_replace.match_count", {
        current,
        total
      })
    }

    this.matchCountTarget.textContent = text
    if (this.hasMiniCountTarget) {
      this.miniCountTarget.textContent = text
    }
  }

  showDialog() {
    if (typeof this.dialogTarget.show === "function") {
      if (!this.dialogTarget.open) {
        this.dialogTarget.show()
      }
      return
    }

    if (typeof this.dialogTarget.showModal === "function") {
      if (!this.dialogTarget.open) {
        this.dialogTarget.showModal()
      }
      return
    }

    this.dialogTarget.setAttribute("open", "open")
  }

  hideDialog() {
    if (typeof this.dialogTarget.close === "function") {
      this.dialogTarget.close()
    } else {
      this.dialogTarget.removeAttribute("open")
    }
  }

  showMiniBar() {
    if (!this.hasMiniBarTarget) return

    this.miniBarTarget.classList.remove("hidden")
  }

  hideMiniBar() {
    if (!this.hasMiniBarTarget) return

    this.miniBarTarget.classList.add("hidden")
  }

  setActiveTab(tab) {
    this.activeTab = tab === "replace" ? "replace" : "find"
    this.updateTabState()
  }

  updateTabState() {
    const isReplace = this.activeTab === "replace"

    this.replaceSectionTarget.classList.toggle("hidden", !isReplace)

    this.tabFindTarget.classList.toggle("bg-[var(--theme-accent)]", !isReplace)
    this.tabFindTarget.classList.toggle("text-[var(--theme-accent-text)]", !isReplace)
    this.tabFindTarget.classList.toggle("text-[var(--theme-text-muted)]", isReplace)

    this.tabReplaceTarget.classList.toggle("bg-[var(--theme-accent)]", isReplace)
    this.tabReplaceTarget.classList.toggle("text-[var(--theme-accent-text)]", isReplace)
    this.tabReplaceTarget.classList.toggle("text-[var(--theme-text-muted)]", !isReplace)

    if (this.hasMiniModeLabelTarget) {
      this.miniModeLabelTarget.textContent = isReplace
        ? window.t("dialogs.find_replace.tab_replace")
        : window.t("dialogs.find_replace.tab_find")
    }
  }

  updateToggleState() {
    this.caseSensitiveToggleTarget.classList.toggle("bg-[var(--theme-bg-hover)]", this.caseSensitiveValue)
    this.caseSensitiveToggleTarget.setAttribute("aria-pressed", this.caseSensitiveValue.toString())

    this.regexToggleTarget.classList.toggle("bg-[var(--theme-bg-hover)]", this.useRegexValue)
    this.regexToggleTarget.setAttribute("aria-pressed", this.useRegexValue.toString())
  }

  buildReplacement(match) {
    const replacement = this.replaceInputTarget.value

    if (!this.useRegexValue) {
      return replacement
    }

    return replacement.replace(/\$(\$|&|\d+)/g, (_, token) => {
      if (token === "$") return "$"
      if (token === "&" || token === "0") return match.text

      const groupIndex = Number.parseInt(token, 10)
      if (Number.isNaN(groupIndex) || groupIndex < 1) return ""

      return match.groups && match.groups[groupIndex - 1] !== undefined
        ? match.groups[groupIndex - 1]
        : ""
    })
  }

  bindDocumentKeydown() {
    if (this.boundDocumentKeydown) return

    this.boundDocumentKeydown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        this.close()
      }
    }

    document.addEventListener("keydown", this.boundDocumentKeydown)
  }

  unbindDocumentKeydown() {
    if (!this.boundDocumentKeydown) return

    document.removeEventListener("keydown", this.boundDocumentKeydown)
    this.boundDocumentKeydown = null
  }

  bindTextareaListener() {
    if (!this.textareaRef || this.boundTextareaInput) return

    this.boundTextareaInput = () => this.findAll()
    this.textareaRef.addEventListener("input", this.boundTextareaInput)
  }

  unbindTextareaListener() {
    if (!this.textareaRef || !this.boundTextareaInput) return

    this.textareaRef.removeEventListener("input", this.boundTextareaInput)
    this.boundTextareaInput = null
  }
}
