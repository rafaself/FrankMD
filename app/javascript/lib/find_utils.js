export function findAllMatches(text, searchTerm, options = {}) {
  if (!text || !searchTerm) return []

  const { caseSensitive = false, useRegex = false } = options
  const pattern = useRegex ? searchTerm : escapeRegexChars(searchTerm)
  const flags = `g${caseSensitive ? "" : "i"}`

  let regex
  try {
    regex = new RegExp(pattern, flags)
  } catch (error) {
    return []
  }

  const matches = []
  let match

  while ((match = regex.exec(text)) !== null) {
    const matchText = match[0]
    const start = match.index
    const end = start + matchText.length
    matches.push({ start, end, text: matchText, groups: match.slice(1) })

    if (matchText.length === 0) {
      regex.lastIndex += 1
    }
  }

  return matches
}

export function replaceMatches(text, matches, replacement, options = {}) {
  if (!text || !matches || matches.length === 0) return text

  const { useRegex = false } = options
  let updatedText = text

  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const match = matches[index]
    const before = updatedText.substring(0, match.start)
    const after = updatedText.substring(match.end)
    const resolvedReplacement = useRegex
      ? resolveRegexReplacement(replacement, match)
      : replacement

    updatedText = `${before}${resolvedReplacement}${after}`
  }

  return updatedText
}

export function escapeRegexChars(str) {
  if (!str) return ""
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

export function findClosestMatchIndex(matches, position, direction = "next") {
  if (!matches || matches.length === 0) return -1

  if (direction === "previous" || direction === -1) {
    for (let index = matches.length - 1; index >= 0; index -= 1) {
      if (matches[index].end <= position) {
        return index
      }
    }
    return matches.length - 1
  }

  for (let index = 0; index < matches.length; index += 1) {
    if (matches[index].start >= position) {
      return index
    }
  }

  return 0
}

export function validateRegex(pattern) {
  if (!pattern) return { valid: true }

  try {
    new RegExp(pattern)
    return { valid: true }
  } catch (error) {
    return { valid: false, error: error.message }
  }
}

function resolveRegexReplacement(replacement, match) {
  if (!replacement) return ""

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
