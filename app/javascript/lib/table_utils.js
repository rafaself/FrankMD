// Table utility functions - Pure functions for markdown table parsing/generation
// Extracted for testability

/**
 * Parse a markdown table into a 2D array
 * @param {string|string[]} lines - Either a string with newlines or an array of lines
 * @returns {string[][]} - 2D array of cell values
 */
export function parseMarkdownTable(lines) {
  const rows = []
  const lineArray = Array.isArray(lines) ? lines : lines.split("\n")

  for (const line of lineArray) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Skip separator row (|---|---|)
    if (/^\|[\s\-:]+\|$/.test(trimmed) || /^\|(\s*:?-+:?\s*\|)+$/.test(trimmed)) {
      continue
    }

    // Split by | and remove empty first/last elements
    const cells = trimmed.split("|")
      .slice(1, -1)
      .map(cell => cell.trim())

    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  return rows
}

/**
 * Generate a markdown table from a 2D array
 * @param {string[][]} tableData - 2D array of cell values
 * @returns {string} - Formatted markdown table
 */
export function generateMarkdownTable(tableData) {
  if (!tableData || tableData.length === 0) return ""

  const colCount = Math.max(...tableData.map(row => row.length))

  // Normalize all rows to same column count
  const normalizedData = tableData.map(row => {
    const newRow = [...row]
    while (newRow.length < colCount) {
      newRow.push("")
    }
    return newRow
  })

  // Calculate column widths
  const widths = []
  for (let col = 0; col < colCount; col++) {
    widths[col] = Math.max(3, ...normalizedData.map(row => (row[col] || "").length))
  }

  // Build table
  const lines = []

  // Header row
  const headerCells = normalizedData[0].map((cell, i) => cell.padEnd(widths[i]))
  lines.push("| " + headerCells.join(" | ") + " |")

  // Separator row
  const separatorCells = widths.map(w => "-".repeat(w))
  lines.push("| " + separatorCells.join(" | ") + " |")

  // Data rows
  for (let i = 1; i < normalizedData.length; i++) {
    const cells = normalizedData[i].map((cell, j) => cell.padEnd(widths[j]))
    lines.push("| " + cells.join(" | ") + " |")
  }

  return lines.join("\n")
}

/**
 * Swap two columns in a table
 * @param {string[][]} tableData - 2D array
 * @param {number} colA - First column index
 * @param {number} colB - Second column index
 * @returns {string[][]} - New array with swapped columns
 */
export function swapColumns(tableData, colA, colB) {
  return tableData.map(row => {
    const newRow = [...row]
    const temp = newRow[colA]
    newRow[colA] = newRow[colB]
    newRow[colB] = temp
    return newRow
  })
}

/**
 * Swap two rows in a table
 * @param {string[][]} tableData - 2D array
 * @param {number} rowA - First row index
 * @param {number} rowB - Second row index
 * @returns {string[][]} - New array with swapped rows
 */
export function swapRows(tableData, rowA, rowB) {
  const newData = [...tableData]
  const temp = newData[rowA]
  newData[rowA] = newData[rowB]
  newData[rowB] = temp
  return newData
}

/**
 * Delete a column from the table
 * @param {string[][]} tableData - 2D array
 * @param {number} colIndex - Column to delete
 * @returns {string[][]} - New array without the column
 */
export function deleteColumn(tableData, colIndex) {
  return tableData.map(row => {
    const newRow = [...row]
    newRow.splice(colIndex, 1)
    return newRow
  })
}

/**
 * Delete a row from the table
 * @param {string[][]} tableData - 2D array
 * @param {number} rowIndex - Row to delete
 * @returns {string[][]} - New array without the row
 */
export function deleteRow(tableData, rowIndex) {
  const newData = [...tableData]
  newData.splice(rowIndex, 1)
  return newData
}

/**
 * Add a column to the table
 * @param {string[][]} tableData - 2D array
 * @param {string} headerName - Name for the new header
 * @returns {string[][]} - New array with added column
 */
export function addColumn(tableData, headerName = "Header") {
  return tableData.map((row, i) => [...row, i === 0 ? headerName : ""])
}

/**
 * Add a row to the table
 * @param {string[][]} tableData - 2D array
 * @returns {string[][]} - New array with added row
 */
export function addRow(tableData) {
  const colCount = tableData[0]?.length || 0
  return [...tableData, new Array(colCount).fill("")]
}
