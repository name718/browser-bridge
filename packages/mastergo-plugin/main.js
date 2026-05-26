// Design JSON Export - MasterGo 高保真设计数据导出插件
// 支持：字体样式、自动布局、边框、阴影、圆角、填充色等完整样式提取

// ─── 工具函数 ───

function clone(val) {
  try {
    return JSON.parse(JSON.stringify(val))
  } catch {
    return null
  }
}

function round2(n) {
  return Math.round(n * 100) / 100
}

function slugifyName(name, fallback) {
  const raw = String(name || fallback || 'node')
  const slug = raw
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
  return (slug || fallback || 'node').slice(0, 80)
}

const DEBUG_EXPORT = false
const DEFAULT_PNG_EXPORT_SCALE = 1
const MIN_PNG_EXPORT_SCALE = 1
const MAX_PNG_EXPORT_SCALE = 4
const EXPORTER_VERSION = '2.1.0'
const LAST_EXPORT_STORAGE_KEY = 'design-json-export:last-export'
const DSL_EXPORT_DIR = 'dsl'
const PICTURE_EXPORT_DIR = 'picture'

function createTopLevelAssetFileName(dir, index, node, ext) {
  const safeName = slugifyName(node && node.name, 'node_' + (index + 1))
  return dir + '/' + String(index + 1).padStart(2, '0') + '_' + safeName + ext
}

function normalizeExportConfig(config) {
  const rawScale = config && config.pngScale != null ? Number(config.pngScale) : DEFAULT_PNG_EXPORT_SCALE
  const pngScale = Math.max(MIN_PNG_EXPORT_SCALE, Math.min(MAX_PNG_EXPORT_SCALE, Number.isFinite(rawScale) ? rawScale : DEFAULT_PNG_EXPORT_SCALE))
  return {
    pngScale,
  }
}

function commandInfo(command, doc, page) {
  const selection = page && page.selection ? page.selection : []
  const isSelection = command === 'exportSelection' || command === 'exportSelectionZip' || command === 'exportSelectionBindingZip'
  const includeZipAssets = command === 'exportPageZip' || command === 'exportSelectionZip'
  const isBindingZip = command === 'exportPageBindingZip' || command === 'exportSelectionBindingZip'
  const includeImages = command === 'exportPageWithImages'
  const nodes = isSelection ? selection : (page && page.children ? page.children : [])
  return {
    command,
    documentName: doc && doc.name ? doc.name : 'untitled',
    pageName: page && page.name ? page.name : 'untitled',
    pageSize: {
      width: page && page.width != null ? round2(page.width) : null,
      height: page && page.height != null ? round2(page.height) : null,
    },
    exportTarget: isSelection ? 'selection' : 'page',
    exportType: isBindingZip ? '绑定（JSON+PNG）' : (includeZipAssets ? 'JSON+PNG Zip' : (includeImages ? 'JSON（含内嵌图片）' : 'JSON')),
    topLevelCount: nodes.length,
    totalCount: countNodeTree(nodes),
    selection: analyzeSelection(selection),
  }
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function postProgress(stage, current, total, message) {
  try {
    mg.ui.postMessage({
      type: 'progress',
      stage,
      current: current || 0,
      total: total || 0,
      message: message || '',
    })
  } catch { }
}

async function storageGet(key) {
  try {
    if (!mg.clientStorage || typeof mg.clientStorage.getAsync !== 'function') return null
    const value = await mg.clientStorage.getAsync(key)
    return value === undefined ? null : value
  } catch (e) {
    debugLog('ClientStorageGetFailed', { key, message: e && e.message })
    return null
  }
}

async function storageSet(key, value) {
  try {
    if (!mg.clientStorage || typeof mg.clientStorage.setAsync !== 'function') return false
    await mg.clientStorage.setAsync(key, value)
    return true
  } catch (e) {
    debugLog('ClientStorageSetFailed', { key, message: e && e.message })
    return false
  }
}

function summarizeNodes(nodes) {
  const typeCounts = {}
  let total = 0
  function walk(items) {
    for (const item of items || []) {
      total++
      const type = item && item.type ? item.type : 'UNKNOWN'
      typeCounts[type] = (typeCounts[type] || 0) + 1
      if (item && item.children && item.children.length) walk(item.children)
    }
  }
  walk(nodes)
  return {
    topLevelCount: (nodes || []).length,
    totalCount: total,
    typeCounts,
  }
}

function summarizeSelection(selection) {
  return (selection || []).map(node => ({
    id: node.id || '',
    name: node.name || '',
    type: node.type || '',
    hasChildren: !!(node.children && node.children.length),
    childCount: node.children ? node.children.length : 0,
    bounds: normalizeBox(readProp(node, 'absoluteBoundingBox')) || normalizeBox(readProp(node, 'absoluteRenderBounds')),
  }))
}

function analyzeSelection(selection) {
  const items = summarizeSelection(selection)
  const warnings = []
  if (items.length === 1) {
    const item = items[0]
    if (!item.hasChildren && ['RECTANGLE', 'ELLIPSE', 'VECTOR', 'LINE', 'POLYGON', 'STAR'].includes(item.type)) {
      warnings.push({
        code: 'single-leaf-visual-selection',
        message: '当前只选中了一个无子节点的视觉图层，导出结果可能只包含背景或装饰图形。',
        nodeId: item.id,
        nodeName: item.name,
        nodeType: item.type,
      })
    }
  }
  return { count: items.length, items, warnings }
}

function postSelectionSummary(selectionSummary) {
  try {
    mg.ui.postMessage({
      type: 'selectionSummary',
      summary: selectionSummary,
    })
  } catch { }
}

function getRuntimeCapabilities() {
  return {
    mastergoMode: mg.mode || '',
    hasClientStorage: !!(mg.clientStorage && typeof mg.clientStorage.getAsync === 'function' && typeof mg.clientStorage.setAsync === 'function'),
    hasGetWebStyleCodeById: typeof mg.getWebStyleCodeById === 'function',
    hasGetNodeById: typeof mg.getNodeById === 'function',
    hasGetImageByHref: typeof mg.getImageByHref === 'function',
    hasCodegen: !!mg.codegen,
    hasSnippetgen: !!mg.snippetgen,
  }
}

async function buildRuntimeInfo(ctx) {
  const { command, doc, page, nodes, mode, startedAt, selection, selectionSummary, diagnostics, exportConfig } = ctx
  const previous = await storageGet(LAST_EXPORT_STORAGE_KEY)
  return {
    exporterVersion: EXPORTER_VERSION,
    apiVersion: typeof mg.apiVersion === 'string' ? mg.apiVersion : '',
    documentId: mg.documentId || '',
    command,
    mode,
    mastergoMode: mg.mode || '',
    startedAt,
    themeColor: mg.themeColor || '',
    capabilities: getRuntimeCapabilities(),
    document: {
      id: mg.documentId || '',
      name: doc.name || 'untitled',
    },
    page: {
      id: page.id || '',
      name: page.name || 'untitled',
      width: page.width != null ? round2(page.width) : null,
      height: page.height != null ? round2(page.height) : null,
    },
    selection: selectionSummary || analyzeSelection(selection),
    nodes: summarizeNodes(nodes),
    diagnostics,
    exportConfig,
    previousExport: previous ? {
      exporterVersion: previous.exporterVersion || '',
      apiVersion: previous.apiVersion || '',
      command: previous.command || '',
      mode: previous.mode || '',
      pageId: previous.pageId || '',
      topLevelCount: previous.topLevelCount || 0,
      totalCount: previous.totalCount || 0,
      exportedAt: previous.exportedAt || '',
    } : null,
  }
}

async function rememberExport(runtimeInfo, stats) {
  await storageSet(LAST_EXPORT_STORAGE_KEY, {
    exporterVersion: runtimeInfo.exporterVersion,
    apiVersion: runtimeInfo.apiVersion,
    documentId: runtimeInfo.documentId,
    command: runtimeInfo.command,
    mode: runtimeInfo.mode,
    pageId: runtimeInfo.page.id,
    pageName: runtimeInfo.page.name,
    topLevelCount: runtimeInfo.nodes.topLevelCount,
    totalCount: runtimeInfo.nodes.totalCount,
    jsonSize: stats && stats.jsonSize,
    exportedAt: new Date().toISOString(),
  })
}

function countNodeTree(nodes) {
  let count = 0
  function walk(items) {
    for (const item of items || []) {
      count++
      if (item.children && item.children.length) walk(item.children)
    }
  }
  walk(nodes)
  return count
}

function readProp(node, key) {
  try {
    const value = node[key]
    return value === undefined ? null : value
  } catch {
    return null
  }
}

function cloneProp(node, key) {
  return clone(readProp(node, key))
}

function normalizeBox(box) {
  if (!box) return null
  const x = box.x != null ? box.x : box.left
  const y = box.y != null ? box.y : box.top
  const width = box.width != null ? box.width : (box.right != null && x != null ? box.right - x : null)
  const height = box.height != null ? box.height : (box.bottom != null && y != null ? box.bottom - y : null)
  if (x == null || y == null || width == null || height == null) return null
  return {
    x: round2(x),
    y: round2(y),
    width: round2(width),
    height: round2(height),
  }
}

function deriveContentBounds(nodes) {
  const boxes = []

  function walk(items) {
    for (const item of items || []) {
      const box = item && (item.absoluteBoundingBox || item.absoluteRenderBounds)
      const normalized = normalizeBox(box)
      if (normalized) boxes.push(normalized)
      if (item && item.children) walk(item.children)
    }
  }

  walk(nodes)
  if (!boxes.length) return null

  const minX = Math.min.apply(null, boxes.map(box => box.x))
  const minY = Math.min.apply(null, boxes.map(box => box.y))
  const maxX = Math.max.apply(null, boxes.map(box => box.x + box.width))
  const maxY = Math.max.apply(null, boxes.map(box => box.y + box.height))

  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
  }
}

function mergeBounds(a, b) {
  if (!a) return b || null
  if (!b) return a
  const minX = Math.min(a.x, b.x)
  const minY = Math.min(a.y, b.y)
  const maxX = Math.max(a.x + a.width, b.x + b.width)
  const maxY = Math.max(a.y + a.height, b.y + b.height)
  return {
    x: round2(minX),
    y: round2(minY),
    width: round2(maxX - minX),
    height: round2(maxY - minY),
  }
}

function extractRawSnapshot(node) {
  const keys = [
    'absoluteBoundingBox',
    'absoluteRenderBounds',
    'absoluteTransform',
    'relativeTransform',
    'layoutMode',
    'layoutWrap',
    'layoutPositioning',
    'primaryAxisAlignItems',
    'counterAxisAlignItems',
    'primaryAxisSizingMode',
    'counterAxisSizingMode',
    'paddingLeft',
    'paddingRight',
    'paddingTop',
    'paddingBottom',
    'itemSpacing',
    'layoutGrids',
    'exportSettings',
    'componentProperties',
    'variantProperties',
    'textAutoResize',
    'fontName',
    'fontSize',
    'fontWeight',
    'lineHeight',
    'letterSpacing',
    'isMask',
  ]
  const raw = {}
  for (const key of keys) {
    const value = readProp(node, key)
    if (value !== null) raw[key] = clone(value)
  }
  return raw
}

function createDiagnostics() {
  return {
    warnings: [],
    imageFillFailures: [],
    imageFillAssets: [],
  }
}

function addDiagnosticWarning(diagnostics, warning) {
  if (!diagnostics || !warning) return
  diagnostics.warnings.push(warning)
}

function debugLog(tag, payload) {
  if (!DEBUG_EXPORT) return
  try {
    console.log('[ExportDebug][' + tag + ']', JSON.stringify(payload))
  } catch (e) {
    console.log('[ExportDebug][' + tag + ']', payload)
  }
}

// ─── 文字样式（优先 textStyles 分段样式，CSS 仅兜底） ───

// 缓存文本样式列表（只读取一次）
let _cachedTextStyles = null
function getTextStyles() {
  if (_cachedTextStyles) return _cachedTextStyles
  try {
    _cachedTextStyles = mg.getLocalTextStyles() || []
  } catch {
    _cachedTextStyles = []
  }
  return _cachedTextStyles
}

async function extractTextStyle(node) {
  if (node.type !== 'TEXT') return null

  let fontFamily = ''
  let fontStyle = ''
  let fontSize = null
  let fontWeight = null
  let lineHeight = null
  let letterSpacing = null
  let textDecoration = 'NONE'
  let textCase = 'ORIGINAL'

  const textRuns = extractTextRuns(node)
  const primaryTextStyle = textRuns[0] && textRuns[0].textStyle

  // 策略1：优先读取 TEXT 节点的分段 textStyles，这是 MasterGo 暴露的结构化文本样式。
  if (primaryTextStyle) {
    const fontName = primaryTextStyle.fontName || primaryTextStyle.localizedFontName
    if (fontName && typeof fontName === 'object') {
      fontFamily = fontName.family || ''
      fontStyle = fontName.style || ''
    } else if (typeof fontName === 'string') {
      fontFamily = fontName
    }

    if (typeof primaryTextStyle.fontSize === 'number') fontSize = primaryTextStyle.fontSize
    if (typeof primaryTextStyle.fontWeight === 'number') fontWeight = primaryTextStyle.fontWeight
    else if (typeof primaryTextStyle.fontWeight === 'string') fontWeight = fontStyleToWeight(primaryTextStyle.fontWeight)

    lineHeight = normalizeTextMetric(primaryTextStyle.lineHeight) || normalizeTextMetric(primaryTextStyle.lineHeightByPx)
    letterSpacing = normalizeTextMetric(primaryTextStyle.letterSpacing)
    if (primaryTextStyle.textDecoration) textDecoration = String(primaryTextStyle.textDecoration).toUpperCase()
    if (primaryTextStyle.textCase) textCase = String(primaryTextStyle.textCase).toUpperCase()
  }

  // 策略2：兼容部分运行时直接挂在 node 上的文本字段。
  const nodeFontName = readProp(node, 'fontName')
  if (!fontFamily && nodeFontName && typeof nodeFontName === 'object') {
    fontFamily = nodeFontName.family || ''
    fontStyle = nodeFontName.style || ''
  } else if (!fontFamily && typeof nodeFontName === 'string') {
    fontFamily = nodeFontName
  }

  const nodeFontSize = readProp(node, 'fontSize')
  if (fontSize == null && typeof nodeFontSize === 'number') fontSize = nodeFontSize

  const nodeFontWeight = readProp(node, 'fontWeight')
  if (fontWeight == null && typeof nodeFontWeight === 'number') fontWeight = nodeFontWeight
  else if (fontWeight == null && typeof nodeFontWeight === 'string') fontWeight = fontStyleToWeight(nodeFontWeight)

  if (lineHeight == null) lineHeight = normalizeTextMetric(readProp(node, 'lineHeight'))
  if (letterSpacing == null) letterSpacing = normalizeTextMetric(readProp(node, 'letterSpacing'))

  // 策略3：通过 getWebStyleCodeById 获取 CSS，只补齐结构化字段没有提供的值。
  try {
    const codeResult = await mg.getWebStyleCodeById(node.id)
    if (codeResult && codeResult.data) {
      const cssText = typeof codeResult.data === 'string'
        ? codeResult.data
        : JSON.stringify(codeResult.data)

      // 解析 font-family
      const ffMatch = cssText.match(/font-family\s*:\s*['"]?([^;'"]+)/i)
      if (!fontFamily && ffMatch) fontFamily = ffMatch[1].trim().replace(/['"]/g, '')

      // 解析 font-size
      const fsMatch = cssText.match(/font-size\s*:\s*([\d.]+)px/i)
      if (fontSize == null && fsMatch) fontSize = parseFloat(fsMatch[1])

      // 解析 font-weight
      const fwMatch = cssText.match(/font-weight\s*:\s*([\w-]+)/i)
      if (fwMatch) {
        const cssWeight = fwMatch[1].trim()
        if (!fontStyle) fontStyle = cssWeight
        if (fontWeight == null) {
          const parsedWeight = parseInt(cssWeight, 10)
          fontWeight = Number.isNaN(parsedWeight) ? fontStyleToWeight(cssWeight) : parsedWeight
        }
      }

      // 解析 line-height
      const lhMatch = cssText.match(/line-height\s*:\s*([\d.]+)(px|em|rem)?/i)
      if (lineHeight == null && lhMatch) lineHeight = parseFloat(lhMatch[1])

      // 解析 letter-spacing
      const lsMatch = cssText.match(/letter-spacing\s*:\s*([\d.-]+)px/i)
      if (letterSpacing == null && lsMatch) letterSpacing = parseFloat(lsMatch[1])

      // 解析 text-decoration
      const tdMatch = cssText.match(/text-decoration\s*:\s*([\w-]+)/i)
      if (textDecoration === 'NONE' && tdMatch) textDecoration = tdMatch[1].toUpperCase()

      // 解析 text-transform
      const ttMatch = cssText.match(/text-transform\s*:\s*([\w-]+)/i)
      if (textCase === 'ORIGINAL' && ttMatch) {
        const tc = ttMatch[1].toLowerCase()
        if (tc === 'uppercase') textCase = 'UPPER'
        else if (tc === 'lowercase') textCase = 'LOWER'
        else if (tc === 'capitalize') textCase = 'TITLE'
      }

    }
  } catch (e) {
  }

  // 策略4：如果分段样式、节点字段和 CSS 都没拿到 fontFamily，通过 getLocalTextStyles 匹配。
  if (!fontFamily) {
    const textStyles = getTextStyles()
    for (const ts of textStyles) {
      try {
        if (fontSize && ts.fontSize !== fontSize) continue
        if (ts.fontName && ts.fontName.family) {
          fontFamily = ts.fontName.family
          fontStyle = ts.fontName.style || ''
          if (!fontSize) fontSize = ts.fontSize
          break
        }
      } catch { }
    }
  }

  if (fontWeight == null) fontWeight = fontStyleToWeight(fontStyle)

  return {
    fontFamily,
    fontStyle,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing: typeof letterSpacing === 'number' ? round2(letterSpacing) : letterSpacing,
    textAlignHorizontal: node.textAlignHorizontal || 'LEFT',
    textAlignVertical: node.textAlignVertical || 'TOP',
    textDecoration,
    textCase,
    textRuns,
  }
}

function extractTextRuns(node) {
  const textStyles = readProp(node, 'textStyles') || []
  const characters = node.characters || ''
  return textStyles.map(run => {
    const start = typeof run.start === 'number' ? run.start : 0
    const end = typeof run.end === 'number' ? run.end : start
    return {
      start,
      end,
      text: characters.slice(start, end),
      textStyleId: run.textStyleId || '',
      fillStyleId: run.fillStyleId || '',
      fills: clone(run.fills) || [],
      textStyle: clone(run.textStyle) || null,
      textStyleDetail: clone(run.textStyleDetail) || null,
    }
  })
}

function normalizeTextMetric(value) {
  if (typeof value === 'number') return value
  if (!value || typeof value !== 'object') return null
  if (typeof value.value === 'number') return value.value
  if (typeof value.pixels === 'number') return value.pixels
  return null
}

// 将 fontStyle（如 "Bold"）转为 CSS fontWeight 数值
function fontStyleToWeight(style) {
  if (!style) return 400
  const s = String(style).toLowerCase()
  if (s.includes('thin') || s.includes('hairline')) return 100
  if (s.includes('extra light') || s.includes('ultra light')) return 200
  if (s.includes('light')) return 300
  if (s.includes('regular') || s.includes('normal')) return 400
  if (s.includes('medium')) return 500
  if (s.includes('semi bold') || s.includes('demi bold')) return 600
  if (s.includes('bold')) return 700
  if (s.includes('extra bold') || s.includes('ultra bold')) return 800
  if (s.includes('black') || s.includes('heavy')) return 900
  return 400
}

// ─── 描边 ───

function extractStrokes(node) {
  const strokes = node.strokes
  if (!strokes || strokes.length === 0) return null
  return strokes.map(s => ({
    type: s.type || 'SOLID',
    color: clone(s.color),
    weight: node.strokeWeight,
    align: s.strokeAlign || 'CENTER',
  }))
}

// ─── 阴影 / 模糊 ───

function extractEffects(node) {
  const effects = node.effects
  if (!effects || effects.length === 0) return null
  return effects
    .filter(e => e.visible !== false)
    .map(e => ({
      type: e.type,
      color: clone(e.color),
      offset: e.offset ? { x: round2(e.offset.x), y: round2(e.offset.y) } : null,
      radius: e.radius || 0,
      spread: e.spread || 0,
    }))
}

// ─── 自动布局 / 内边距 ───

function parseLayoutCSS(cssText) {
  // 从 CSS 文本中解析布局属性
  const result = {}
  const layoutMatch = cssText.match(/display\s*:\s*flex/i)
  if (layoutMatch) {
    result.isAutoLayout = true
  }
  const dirMatch = cssText.match(/flex-direction\s*:\s*([\w-]+)/i)
  if (dirMatch) {
    result.layoutMode = cssFlexDirectionToLayoutMode(dirMatch[1])
  }
  const wrapMatch = cssText.match(/flex-wrap\s*:\s*([\w-]+)/i)
  if (wrapMatch) {
    result.layoutWrap = wrapMatch[1].toUpperCase().replace('-', '_') // NO_WRAP / WRAP
  }
  const gapMatch = cssText.match(/gap\s*:\s*([\d.]+)px/i)
  if (gapMatch) {
    result.itemSpacing = parseFloat(gapMatch[1])
  }
  // justify-content → primaryAxisAlignItems
  const jcMatch = cssText.match(/justify-content\s*:\s*([\w-]+)/i)
  if (jcMatch) {
    result.primaryAxisAlignItems = cssAxisAlignToMasterGo(jcMatch[1], 'MIN')
  }
  // align-items → counterAxisAlignItems
  const aiMatch = cssText.match(/align-items\s*:\s*([\w-]+)/i)
  if (aiMatch) {
    result.counterAxisAlignItems = cssAxisAlignToMasterGo(aiMatch[1], 'MIN')
  }
  return result
}

function cssFlexDirectionToLayoutMode(value) {
  const normalized = String(value || '').toLowerCase()
  if (normalized === 'column' || normalized === 'column-reverse') return 'VERTICAL'
  if (normalized === 'row' || normalized === 'row-reverse') return 'HORIZONTAL'
  return normalized.toUpperCase()
}

function cssAxisAlignToMasterGo(value, fallback) {
  const normalized = String(value || '').toLowerCase()
  const map = {
    start: 'MIN',
    'flex-start': 'MIN',
    center: 'CENTER',
    end: 'MAX',
    'flex-end': 'MAX',
    'space-between': 'SPACE_BETWEEN',
    'space-around': 'SPACE_AROUND',
    'space-evenly': 'SPACE_EVENLY',
    stretch: 'STRETCH',
    baseline: 'BASELINE',
  }
  return map[normalized] || fallback
}

function extractAutoLayout(node, cssText) {
  const pl = readProp(node, 'paddingLeft')
  const pr = readProp(node, 'paddingRight')
  const pt = readProp(node, 'paddingTop')
  const pb = readProp(node, 'paddingBottom')
  const sp = readProp(node, 'itemSpacing')
  const nodeLayoutMode = readProp(node, 'layoutMode')
  const nodeLayoutWrap = readProp(node, 'layoutWrap')
  const nodePrimaryAxisAlignItems = readProp(node, 'primaryAxisAlignItems')
  const nodeCounterAxisAlignItems = readProp(node, 'counterAxisAlignItems')

  // 从 CSS 解析布局信息
  const cssLayout = cssText ? parseLayoutCSS(cssText) : {}

  // 只要有节点布局字段、padding/spacing 或 CSS 中有 display:flex 就导出
  const hasNodeLayout = nodeLayoutMode && nodeLayoutMode !== 'NONE'
  const hasPadding = pl != null || pr != null || pt != null || pb != null
  const hasSpacing = sp != null
  if (!hasNodeLayout && !hasPadding && !hasSpacing && !cssLayout.isAutoLayout) return null

  const layout = {
    paddingLeft: pl || 0,
    paddingRight: pr || 0,
    paddingTop: pt || 0,
    paddingBottom: pb || 0,
    itemSpacing: sp != null ? sp : (cssLayout.itemSpacing || 0),
  }

  layout.layoutMode = nodeLayoutMode || cssLayout.layoutMode || 'NONE'
  layout.layoutWrap = nodeLayoutWrap || cssLayout.layoutWrap || 'NO_WRAP'
  layout.primaryAxisAlignItems = nodePrimaryAxisAlignItems || cssLayout.primaryAxisAlignItems || 'MIN'
  layout.counterAxisAlignItems = nodeCounterAxisAlignItems || cssLayout.counterAxisAlignItems || 'MIN'
  try { layout.primaryAxisSizingMode = node.primaryAxisSizingMode || 'AUTO' } catch { }
  try { layout.counterAxisSizingMode = node.counterAxisSizingMode || 'AUTO' } catch { }

  return layout
}

function extractTypeDetails(node, data) {
  const base = {
    kind: node.type || 'UNKNOWN',
  }
  if (node.type === 'TEXT') {
    return Object.assign(base, {
      characterCount: data.characters ? data.characters.length : 0,
      runCount: data.textStyle && data.textStyle.textRuns ? data.textStyle.textRuns.length : 0,
      textAutoResize: data.textAutoResize || null,
      primaryFontFamily: data.textStyle ? data.textStyle.fontFamily : '',
      primaryFontSize: data.textStyle ? data.textStyle.fontSize : null,
    })
  }
  if (node.type === 'FRAME') {
    return Object.assign(base, {
      childCount: node.children ? node.children.length : 0,
      clipsContent: !!data.clipsContent,
      hasAutoLayout: !!data.autoLayout,
      hasLayoutGrids: !!(data.layoutGrids && data.layoutGrids.length),
    })
  }
  if (node.type === 'INSTANCE') {
    return Object.assign(base, {
      childCount: node.children ? node.children.length : 0,
      mainComponentId: data.mainComponentId || '',
      mainComponentName: data.mainComponentName || '',
      componentProperties: data.componentProperties || null,
      variantProperties: data.variantProperties || null,
    })
  }
  if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
    return Object.assign(base, {
      childCount: node.children ? node.children.length : 0,
      componentProperties: data.componentProperties || null,
      variantProperties: data.variantProperties || null,
    })
  }
  if (node.type === 'RECTANGLE') {
    return Object.assign(base, {
      fillCount: data.fills ? data.fills.length : 0,
      hasImageFill: !!(data.fills && data.fills.some(fill => fill.type === 'IMAGE')),
      cornerRadius: data.cornerRadius == null ? null : data.cornerRadius,
      strokeWeight: data.strokeWeight || 0,
    })
  }
  return base
}

// ─── 圆角 ───

function extractCornerRadius(node) {
  const cr = node.cornerRadius
  if (cr === undefined || cr === null) return null
  if (typeof cr === 'object') {
    return {
      topLeft: cr.topLeft || 0,
      topRight: cr.topRight || 0,
      bottomLeft: cr.bottomLeft || 0,
      bottomRight: cr.bottomRight || 0,
    }
  }
  return cr
}

// ─── 图片导出 ───

async function extractImageForNode(node) {
  try {
    const bytes = await node.exportAsync({
      format: 'PNG',
      constraint: { type: 'SCALE', value: 1 },
    })
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return 'data:image/png;base64,' + btoa(binary)
  } catch {
    return null
  }
}

async function exportPngForNode(node, scale) {
  try {
    const pngScale = normalizeExportConfig({ pngScale: scale }).pngScale
    const settings = {
      format: 'PNG',
      constraint: { type: 'SCALE', value: pngScale },
      useAbsoluteBounds: true,
      useRenderBounds: true,
    }
    const exported = typeof node.exportAsync === 'function'
      ? await node.exportAsync(settings)
      : (typeof node.export === 'function' ? node.export(settings) : null)
    if (!exported || typeof exported === 'string') return null
    const bytes = exported instanceof Uint8Array ? exported : new Uint8Array(exported)
    return {
      bytes,
      byteLength: bytes.length,
    }
  } catch (e) {
    console.log('[Export] PNG 导出失败:', node.name, e.message)
    return null
  }
}

async function inspectImageFill(fill, node, diagnostics) {
  const imageRef = fill.imageRef || fill.imageHash || ''
  const meta = {
    nodeId: node.id || '',
    nodeName: node.name || '',
    imageRef,
    status: 'skipped',
  }
  if (!imageRef) {
    meta.reason = 'missing-image-ref'
    diagnostics.imageFillFailures.push(meta)
    return meta
  }
  if (typeof mg.getImageByHref !== 'function') {
    meta.reason = 'getImageByHref-unavailable'
    diagnostics.imageFillFailures.push(meta)
    return meta
  }
  try {
    const image = await mg.getImageByHref(imageRef)
    meta.status = image ? 'available' : 'missing'
    if (image) {
      meta.hasGetBytesAsync = typeof image.getBytesAsync === 'function'
      meta.hasGetSizeAsync = typeof image.getSizeAsync === 'function'
      try {
        if (meta.hasGetSizeAsync) meta.size = await image.getSizeAsync()
      } catch (e) {
        meta.sizeError = e && e.message
      }
      diagnostics.imageFillAssets.push(meta)
    } else {
      meta.reason = 'image-not-found'
      diagnostics.imageFillFailures.push(meta)
    }
  } catch (e) {
    meta.status = 'failed'
    meta.reason = e && e.message ? e.message : 'unknown-error'
    diagnostics.imageFillFailures.push(meta)
  }
  return meta
}

async function exportPngAssets(nodes, exportConfig) {
  const pngScale = normalizeExportConfig(exportConfig).pngScale
  const assets = []
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    postProgress('png', i + 1, nodes.length, '正在导出 PNG ' + (i + 1) + '/' + nodes.length)
    if (i % 2 === 0) await wait(0)
    const image = await exportPngForNode(node, pngScale)
    if (!image) continue
    assets.push({
      nodeId: node.id || '',
      nodeName: node.name || '',
      fileName: createTopLevelAssetFileName(PICTURE_EXPORT_DIR, i, node, '.png'),
      mimeType: 'image/png',
      byteLength: image.byteLength,
      scale: pngScale,
      bytes: image.bytes,
    })
  }
  debugLog('PngAssets', {
    requestedCount: nodes.length,
    exportedCount: assets.length,
    files: assets.map(asset => asset.fileName),
  })
  return assets
}

async function exportZipStreaming(ctx) {
  const { doc, page, nodes, mode, runtimeInfo, diagnostics, exportConfig } = ctx
  const pngScale = normalizeExportConfig(exportConfig).pngScale
  const progress = {
    current: 0,
    total: countNodeTree(nodes),
  }
  const startedAt = new Date().toISOString()
  const zipName = slugifyName((doc.name || 'untitled') + '_' + (page.name || 'untitled'), 'mastergo_export') + '.zip'

  mg.ui.postMessage({
    type: 'zipStreamStart',
    zipName,
    mode,
    jsonFileName: 'manifest.json',
  })

  const assetsMeta = []
  const nodeJsonFiles = []
  let contentBounds = null

  function createNodeJsonState(fileName) {
    return {
      fileName,
      size: 0,
      buffer: '',
      contentBounds: null,
    }
  }

  function emitNodeJson(state, part) {
    state.size += part.length
    state.buffer += part
    if (state.buffer.length >= 65536) {
      mg.ui.postMessage({
        type: 'zipJsonFilePart',
        fileName: state.fileName,
        part: state.buffer,
      })
      state.buffer = ''
    }
  }

  function flushNodeJson(state) {
    if (!state.buffer) return
    mg.ui.postMessage({
      type: 'zipJsonFilePart',
      fileName: state.fileName,
      part: state.buffer,
    })
    state.buffer = ''
  }

  async function getCodegenDsl(node) {
    if (!mg.codegen || typeof mg.codegen.getDSL !== 'function') return null
    try {
      const data = await mg.codegen.getDSL(node.id)
      if (data) {
        debugLog('CodegenDSL', {
          nodeId: node.id || '',
          nodeName: node.name || '',
        })
        return data
      }
    } catch (e) {
      addDiagnosticWarning(diagnostics, {
        type: 'codegen-dsl-fallback',
        message: 'mg.codegen.getDSL failed; fallback to legacy extractor',
        nodeId: node.id || '',
        nodeName: node.name || '',
        error: e && e.message ? e.message : String(e),
      })
    }
    return null
  }

  async function streamNodeJson(node, options, state) {
    const data = await extractNode(node, Object.assign({}, options, { shallow: true }))
    const bounds = data.absoluteBoundingBox || data.absoluteRenderBounds
    contentBounds = mergeBounds(contentBounds, bounds)
    state.contentBounds = mergeBounds(state.contentBounds, bounds)
    const children = node.children || []
    let json = JSON.stringify(data)
    if (!children.length) {
      emitNodeJson(state, json)
      return
    }

    emitNodeJson(state, json.slice(0, -1) + ',"children":[')
    for (let i = 0; i < children.length; i++) {
      if (i > 0) emitNodeJson(state, ',')
      await streamNodeJson(children[i], {
        includeImages: false,
        imageNodes: new Set(),
        parentId: data.id,
        depth: options.depth + 1,
        index: i,
        siblingCount: children.length,
        pathIds: data.pathIds,
        pathNames: data.pathNames,
        progress,
      }, state)
    }
    emitNodeJson(state, ']}')
  }

  async function streamTopLevelDsl(node, options, state) {
    const codegenDsl = await getCodegenDsl(node)
    if (codegenDsl) {
      const bounds = normalizeBox(readProp(node, 'absoluteBoundingBox')) || normalizeBox(readProp(node, 'absoluteRenderBounds'))
      contentBounds = mergeBounds(contentBounds, bounds)
      state.contentBounds = mergeBounds(state.contentBounds, bounds)
      state.codegenDsl = true
      emitNodeJson(state, JSON.stringify(codegenDsl))
      return
    }
    await streamNodeJson(node, options, state)
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    const fileName = createTopLevelAssetFileName(DSL_EXPORT_DIR, i, node, '.json')
    const state = createNodeJsonState(fileName)
    await streamTopLevelDsl(node, {
      includeImages: false,
      imageNodes: new Set(),
      parentId: page.id || null,
      depth: 0,
      index: i,
      siblingCount: nodes.length,
      pathIds: [page.id || ''],
      pathNames: [page.name || ''],
      progress,
      diagnostics,
    }, state)
    flushNodeJson(state)
    nodeJsonFiles.push({
      fileName,
      nodeId: node.id || '',
      nodeName: node.name || '',
      nodeCount: countNodeTree([node]),
      contentBounds: state.contentBounds,
      nodeJsonSize: state.size,
      dslSource: state.codegenDsl ? 'mg.codegen.getDSL' : 'legacy-extractNode',
    })
    await wait(0)
  }

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]
    postProgress('png', i + 1, nodes.length, '正在导出 PNG ' + (i + 1) + '/' + nodes.length)
    const image = await exportPngForNode(node, pngScale)
    if (!image) continue

    const asset = {
      nodeId: node.id || '',
      nodeName: node.name || '',
      fileName: createTopLevelAssetFileName(PICTURE_EXPORT_DIR, i, node, '.png'),
      mimeType: 'image/png',
      byteLength: image.byteLength,
      scale: pngScale,
    }
    assetsMeta.push(asset)
    mg.ui.postMessage({
      type: 'zipAsset',
      asset,
      bytes: image.bytes,
    })
    await wait(0)
  }

  postProgress('json-stringify', 0, 0, '正在生成 JSON')
  const stats = {
    nodeCount: progress.total,
    topLevelNodeCount: nodes.length,
    textCount: null,
    jsonSize: 0,
  }
  const manifest = {
    schemaVersion: 2,
    runtime: runtimeInfo,
    diagnostics,
    fileName: doc.name || 'untitled',
    pageId: page.id || '',
    pageName: page.name || 'untitled',
    pageSize: {
      width: page.width != null ? round2(page.width) : null,
      height: page.height != null ? round2(page.height) : null,
    },
    contentBounds,
    exportMode: mode,
    exportedAt: startedAt,
    nodeCount: nodes.length,
    designModel: {
      nodeCount: progress.total,
      contentBounds,
      nodesRef: DSL_EXPORT_DIR + '/*.json',
      files: nodeJsonFiles.map(file => ({
        fileName: file.fileName,
        nodeId: file.nodeId,
        nodeName: file.nodeName,
        nodeCount: file.nodeCount,
        contentBounds: file.contentBounds,
      })),
    },
    renderAssets: {
      png: assetsMeta,
    },
    assets: {
      png: assetsMeta,
    },
  }
  const manifestJson = JSON.stringify(manifest, null, 2)
  const suffix = '\n  ]\n}'
  let splitJsonSize = manifestJson.length
  for (const file of nodeJsonFiles) {
    const prefix = JSON.stringify(Object.assign({}, manifest, {
      nodeCount: file.nodeCount,
      contentBounds: file.contentBounds,
      designModel: Object.assign({}, manifest.designModel, {
        nodeCount: file.nodeCount,
        contentBounds: file.contentBounds,
        nodesRef: 'nodes',
        sourceFile: file.fileName,
      }),
      splitSource: {
        manifestFileName: 'manifest.json',
        fileName: file.fileName,
        nodeId: file.nodeId,
        nodeName: file.nodeName,
      },
    }), null, 2).replace(/\n}$/, ',\n  "nodes": [\n')
    splitJsonSize += prefix.length + file.nodeJsonSize + suffix.length
    mg.ui.postMessage({
      type: 'zipJsonFileMeta',
      fileName: file.fileName,
      prefix,
      suffix,
    })
  }
  const jsonSize = splitJsonSize
  stats.jsonSize = jsonSize
  await rememberExport(runtimeInfo, stats)

  mg.ui.postMessage({
    type: 'zipJsonMeta',
    fileName: 'manifest.json',
    prefix: manifestJson,
    suffix: '',
    stats,
  })

  // 生成离线 binding.json：保留顶层图层名称、图片路径和 DSL 路径。
  const bindingJson = JSON.stringify(buildOfflineBindingIndex({
    fileId: mg.documentId || '',
    exportedAt: startedAt,
    pageName: page.name || 'untitled',
    nodes,
    assets: assetsMeta,
    dslFiles: nodeJsonFiles,
  }), null, 2)

  mg.ui.postMessage({
    type: 'zipStreamDone',
    mode,
    stats,
    bindingJson,
    bindingFileName: 'binding.json',
  })
}

// ─── 核心：完整节点提取（异步） ───

async function extractNode(node, options = {}) {
  const {
    includeImages = false,
    imageNodes = new Set(),
    parentId = null,
    depth = 0,
    index = 0,
    siblingCount = 1,
    pathIds = [],
    pathNames = [],
    progress = null,
    shallow = false,
    diagnostics = null,
  } = options

  try {
    if (progress) {
      progress.current++
      if (progress.current === 1 || progress.current % 20 === 0) {
        postProgress('json', progress.current, progress.total, '正在采集 JSON ' + progress.current + '/' + progress.total)
        await wait(0)
      }
    }

    const type = node.type
    const currentPathIds = pathIds.concat(node.id || '')
    const currentPathNames = pathNames.concat(node.name || '')
    const raw = extractRawSnapshot(node)
    const data = {
      id: node.id || '',
      type,
      name: node.name || '',
      visible: node.visible !== false,
      parentId,
      depth,
      index,
      siblingCount,
      pathIds: currentPathIds,
      pathNames: currentPathNames,
      nodePath: currentPathNames.filter(Boolean).join(' / '),
    }

    // 坐标尺寸
    if (node.x != null) data.x = round2(node.x)
    if (node.y != null) data.y = round2(node.y)
    if (node.width != null) data.width = round2(node.width)
    if (node.height != null) data.height = round2(node.height)
    data.absoluteBoundingBox = normalizeBox(readProp(node, 'absoluteBoundingBox'))
    data.absoluteRenderBounds = normalizeBox(readProp(node, 'absoluteRenderBounds'))
    data.absoluteTransform = cloneProp(node, 'absoluteTransform')
    data.relativeTransform = cloneProp(node, 'relativeTransform')

    // 文本：内容 + 完整样式
    if (type === 'TEXT') {
      data.characters = node.characters || ''
      data.textStyle = await extractTextStyle(node)
      const textAutoResize = readProp(node, 'textAutoResize')
      if (textAutoResize) data.textAutoResize = textAutoResize
    }

    // FRAME：获取 CSS 用于解析布局
    let frameCSS = ''
    if (type === 'FRAME') {
      try {
        const css = await mg.getWebStyleCodeById(node.id)
        if (css && css.data) {
          frameCSS = typeof css.data === 'string' ? css.data : JSON.stringify(css.data)
        }
      } catch { }
    }

    // 填充
    const fills = node.fills
    if (fills && fills.length > 0) {
      data.fills = []
      for (const fill of fills) {
        const f = { type: fill.type || 'SOLID', visible: fill.visible !== false }
        if (f.type === 'SOLID') {
          f.color = clone(fill.color)
          f.opacity = fill.opacity
        } else if (f.type === 'IMAGE') {
          f.scaleMode = fill.scaleMode || 'FILL'
          f.imageHash = fill.imageRef || null
          f.imageRef = fill.imageRef || null
          if (diagnostics) f.imageAsset = await inspectImageFill(fill, node, diagnostics)
          imageNodes.add(node.id)
        } else if (f.type && f.type.startsWith('GRADIENT_')) {
          f.gradientStops = clone(fill.gradientStops)
          f.gradientTransform = clone(fill.gradientTransform)
        }
        data.fills.push(f)
      }
    }

    // 圆角
    const cr = extractCornerRadius(node)
    if (cr !== null) {
      data.cornerRadius = cr
      data.cornerSmoothing = node.cornerSmoothing || 0
    }

    // 描边
    const strokes = extractStrokes(node)
    if (strokes) data.strokes = strokes

    // 边框属性（即使 strokes 为空也可能有 strokeWeight）
    const sw = node.strokeWeight
    if (sw != null && sw > 0) {
      data.strokeWeight = sw
      try { data.strokeAlign = node.strokeAlign || 'CENTER' } catch { }
      // 四边独立边框
      const stw = node.strokeTopWeight
      const srw = node.strokeRightWeight
      const sbw = node.strokeBottomWeight
      const slw = node.strokeLeftWeight
      if (stw != null || srw != null || sbw != null || slw != null) {
        data.strokeWeights = {
          top: stw || 0,
          right: srw || 0,
          bottom: sbw || 0,
          left: slw || 0,
        }
      }
    }

    // clipsContent
    try {
      if (node.clipsContent) data.clipsContent = true
    } catch { }

    // 阴影/模糊
    const effects = extractEffects(node)
    if (effects) data.effects = effects

    // 透明度 / 旋转
    if (node.opacity != null && node.opacity !== 1) {
      data.opacity = round2(node.opacity)
    }
    if (node.rotation != null && node.rotation !== 0) {
      data.rotation = round2(node.rotation)
    }

    // 混合模式
    if (node.blendMode && node.blendMode !== 'NORMAL') {
      data.blendMode = node.blendMode
    }

    // 自动布局
    const autoLayout = extractAutoLayout(node, frameCSS)
    if (autoLayout) data.autoLayout = autoLayout
    const layoutPositioning = readProp(node, 'layoutPositioning')
    if (layoutPositioning) data.layoutPositioning = layoutPositioning

    const layoutGrids = cloneProp(node, 'layoutGrids')
    if (layoutGrids && layoutGrids.length) data.layoutGrids = layoutGrids

    const exportSettings = cloneProp(node, 'exportSettings')
    if (exportSettings && exportSettings.length) data.exportSettings = exportSettings

    // 约束
    if (node.constraints) {
      data.constraints = {
        horizontal: node.constraints.horizontal,
        vertical: node.constraints.vertical,
      }
    }

    // 组件信息
    if (node.mainComponent) {
      data.mainComponentId = node.mainComponent.id
      data.mainComponentName = node.mainComponent.name
    }
    const componentProperties = cloneProp(node, 'componentProperties')
    if (componentProperties) data.componentProperties = componentProperties
    const variantProperties = cloneProp(node, 'variantProperties')
    if (variantProperties) data.variantProperties = variantProperties

    data.typeDetails = extractTypeDetails(node, data)

    data.raw = raw

    debugLog('Node', {
      depth,
      index,
      type,
      name: data.name,
      id: data.id,
      parentId,
      box: data.absoluteBoundingBox || { x: data.x, y: data.y, width: data.width, height: data.height },
      rawKeys: Object.keys(raw),
    })
    if (type === 'TEXT') {
      debugLog('Text', {
        id: data.id,
        characters: data.characters,
        textStyle: data.textStyle,
        box: data.absoluteBoundingBox,
      })
    }
    if (autoLayout || layoutGrids || exportSettings) {
      debugLog('Layout', {
        id: data.id,
        autoLayout,
        layoutGrids,
        exportSettings,
      })
    }

    // 子节点递归
    if (!shallow && node.children && node.children.length > 0) {
      data.children = []
      for (let i = 0; i < node.children.length; i++) {
        const child = node.children[i]
        data.children.push(await extractNode(child, {
          includeImages,
          imageNodes,
          parentId: data.id,
          depth: depth + 1,
          index: i,
          siblingCount: node.children.length,
          pathIds: currentPathIds,
          pathNames: currentPathNames,
          progress,
          diagnostics,
        }))
      }
    }

    return data
  } catch (e) {
    console.log('[Export] extractNode error:', node.name, e.message)
    return { id: node.id || '?', type: node.type || '?', name: node.name || '?', _error: e.message }
  }
}

// ─── 图层绑定信息提取 ───

function keyByNodeId(items) {
  const map = {}
  for (const item of items || []) {
    if (item && item.nodeId) map[item.nodeId] = item
  }
  return map
}

function createBindingBase(options, pageItems) {
  return {
    file_id: options.fileId == null ? '' : options.fileId,
    exported_at: options.exportedAt || new Date().toISOString(),
    pages: {
      [options.pageName || 'untitled']: pageItems,
    },
  }
}

function buildOfflineBindingIndex(options) {
  const nodes = options.nodes || []
  const assetsByNodeId = keyByNodeId(options.assets)
  const dslByNodeId = keyByNodeId(options.dslFiles)
  const pageItems = nodes.map((node, index) => {
    const id = node.id || ''
    const imageAsset = assetsByNodeId[id]
    const dslFile = dslByNodeId[id]
    return {
      name: node.name || '',
      image: imageAsset ? imageAsset.fileName : createTopLevelAssetFileName(PICTURE_EXPORT_DIR, index, node, '.png'),
      dsl: dslFile ? dslFile.fileName : createTopLevelAssetFileName(DSL_EXPORT_DIR, index, node, '.json'),
    }
  })
  return createBindingBase(options, pageItems)
}

function buildMcpBindingIndex(options) {
  const nodes = options.nodes || []
  const assetsByNodeId = keyByNodeId(options.assets)
  const pageItems = nodes.map((node, index) => {
    const id = node.id || ''
    const imageAsset = assetsByNodeId[id]
    return {
      id,
      image: imageAsset ? imageAsset.fileName : createTopLevelAssetFileName(PICTURE_EXPORT_DIR, index, node, '.png'),
    }
  })
  return createBindingBase(options, pageItems)
}

// ─── 批量导出图片 ───

async function exportImages(imageNodes) {
  const images = {}
  let count = 0
  for (const nodeId of imageNodes) {
    try {
      const node = mg.getNodeById(nodeId)
      if (node) {
        const base64 = await extractImageForNode(node)
        if (base64) {
          images[nodeId] = base64
          count++
        }
      }
    } catch (e) {
      console.log('[Export] 图片导出失败:', nodeId, e.message)
    }
  }
  return images
}

// ─── 入口 ───

async function exportDesign(config) {
  try {
    const exportConfig = normalizeExportConfig(config)
    const command = mg.command || 'exportPage'
    const doc = mg.document
    if (!doc) {
      mg.closePlugin('无法读取文档')
      return
    }

    const page = doc.currentPage
    if (!page) {
      mg.closePlugin('无法读取页面')
      return
    }

    const includeImages = command === 'exportPageWithImages'
    const includeZipAssets = command === 'exportPageZip' || command === 'exportSelectionZip'
    const isBindingZip = command === 'exportPageBindingZip' || command === 'exportSelectionBindingZip'
    let nodes = []
    let mode = ''
    let selection = []
    const diagnostics = createDiagnostics()

    if (isBindingZip) {
      const isSelection = command === 'exportSelectionBindingZip'
      selection = isSelection ? (page.selection || []) : []
      if (isSelection && (!selection || selection.length === 0)) {
        mg.closePlugin('请先选中要导出的图层')
        return
      }
      const bindingNodes = isSelection ? selection : (page.children || [])
      mode = isSelection
        ? '选中图层绑定（JSON+PNG，' + bindingNodes.length + ' 个）'
        : '当前页面绑定（JSON+PNG）'
      postProgress('start', 0, bindingNodes.length, '准备导出绑定 ' + mode)
      const pngScale = normalizeExportConfig(exportConfig).pngScale
      const startedAt = new Date().toISOString()

      mg.ui.postMessage({
        type: 'zipStreamStart',
        zipName: slugifyName((doc.name || 'untitled') + '_' + (page.name || 'untitled') + '_binding', 'binding') + '.zip',
        mode: 'binding',
        jsonFileName: 'binding.json',
      })

      // 导出 PNG（文件名用 node ID 以便和 MCP JSON 关联）
      const assetsMeta = []
      for (let i = 0; i < bindingNodes.length; i++) {
        const node = bindingNodes[i]
        postProgress('png', i + 1, bindingNodes.length, '正在导出 PNG ' + (i + 1) + '/' + bindingNodes.length)
        const image = await exportPngForNode(node, pngScale)
        if (!image) continue
        const pngFileName = createTopLevelAssetFileName(PICTURE_EXPORT_DIR, i, node, '.png')
        const asset = {
          nodeId: node.id || '',
          nodeName: node.name || '',
          fileName: pngFileName,
          mimeType: 'image/png',
          byteLength: image.byteLength,
          scale: pngScale,
        }
        assetsMeta.push(asset)
        mg.ui.postMessage({
          type: 'zipAsset',
          asset,
          bytes: image.bytes,
        })
        await wait(0)
      }

      // 生成 MCP binding.json：仅保留顶层图层 id 和图片路径。
      const bindingJson = JSON.stringify(buildMcpBindingIndex({
        fileId: mg.documentId || '',
        exportedAt: startedAt,
        pageName: page.name || 'untitled',
        nodes: bindingNodes,
        assets: assetsMeta,
      }), null, 2)

      const stats = {
        nodeCount: bindingNodes.length,
        topLevelNodeCount: bindingNodes.length,
        jsonSize: bindingJson.length,
      }

      postProgress('json-stringify', 0, 0, '正在生成绑定 JSON')
      mg.ui.postMessage({
        type: 'zipJsonMeta',
        fileName: 'binding.json',
        prefix: bindingJson,
        suffix: '',
        stats,
      })

      mg.ui.postMessage({
        type: 'zipStreamDone',
        mode,
        stats,
      })
      return
    }

    if (command === 'exportSelection' || command === 'exportSelectionZip') {
      selection = page.selection || []
      if (!selection || selection.length === 0) {
        mg.closePlugin('请先选中要导出的图层')
        return
      }
      nodes = selection
      mode = includeZipAssets ? '选中图层（JSON+PNG Zip，' + nodes.length + ' 个）' : '选中图层 (' + nodes.length + ' 个)'
    } else {
      nodes = page.children || []
      mode = includeZipAssets ? '当前页面（JSON+PNG Zip）' : (includeImages ? '当前页面（含图片）' : '当前页面')
    }

    postProgress('start', 0, nodes.length, '准备导出 ' + mode)
    console.log('[Export] 提取中，节点数:', nodes.length)
    const startedAt = new Date().toISOString()
    const selectionSummary = analyzeSelection(selection)
    for (const warning of selectionSummary.warnings) addDiagnosticWarning(diagnostics, warning)
    postSelectionSummary(selectionSummary)
    const runtimeInfo = await buildRuntimeInfo({
      command,
      doc,
      page,
      nodes,
      mode,
      startedAt,
      selection,
      selectionSummary,
      diagnostics,
      exportConfig,
    })

    if (includeZipAssets) {
      await exportZipStreaming({ doc, page, nodes, mode, runtimeInfo, diagnostics, exportConfig })
      return
    }

    const options = { includeImages, imageNodes: new Set() }
    const extractedNodes = []
    const progress = {
      current: 0,
      total: countNodeTree(nodes),
    }
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i]
      extractedNodes.push(await extractNode(node, {
        includeImages,
        imageNodes: options.imageNodes,
        parentId: page.id || null,
        depth: 0,
        index: i,
        siblingCount: nodes.length,
        pathIds: [page.id || ''],
        pathNames: [page.name || ''],
        progress,
        diagnostics,
      }))
    }

    // 导出图片
    let images = {}
    if (includeImages && options.imageNodes.size > 0) {
      postProgress('embedded-images', 0, options.imageNodes.size, '正在导出内嵌图片')
      images = await exportImages(options.imageNodes)
    }

    const pngAssets = includeZipAssets ? await exportPngAssets(nodes, exportConfig) : []
    postProgress('json-stringify', 0, 0, '正在生成 JSON')

    const designData = {
      schemaVersion: 2,
      runtime: runtimeInfo,
      diagnostics,
      fileName: doc.name || 'untitled',
      pageId: page.id || '',
      pageName: page.name || 'untitled',
      pageSize: {
        width: page.width != null ? round2(page.width) : null,
        height: page.height != null ? round2(page.height) : null,
      },
      contentBounds: deriveContentBounds(extractedNodes),
      exportMode: mode,
      exportedAt: startedAt,
      nodeCount: extractedNodes.length,
      designModel: {
        nodeCount: progress.total,
        contentBounds: deriveContentBounds(extractedNodes),
        nodesRef: 'nodes',
      },
      renderAssets: {
        png: pngAssets.map(asset => ({
          nodeId: asset.nodeId,
          nodeName: asset.nodeName,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          byteLength: asset.byteLength,
          scale: asset.scale,
        })),
      },
      nodes: extractedNodes,
    }

    if (includeZipAssets) {
      designData.assets = {
        png: pngAssets.map(asset => ({
          nodeId: asset.nodeId,
          nodeName: asset.nodeName,
          fileName: asset.fileName,
          mimeType: asset.mimeType,
          byteLength: asset.byteLength,
          scale: asset.scale,
        })),
      }
    }

    if (includeImages && Object.keys(images).length > 0) {
      designData.images = images
    }

    debugLog('Page', {
      fileName: designData.fileName,
      pageName: designData.pageName,
      pageId: designData.pageId,
      pageSize: designData.pageSize,
      contentBounds: designData.contentBounds,
      nodeCount: designData.nodeCount,
      imageCount: Object.keys(images).length,
      pngAssetCount: pngAssets.length,
    })

    const stats = {
      nodeCount: progress.total,
      topLevelNodeCount: extractedNodes.length,
      textCount: null,
      jsonSize: 0,
    }
    const json = JSON.stringify(designData, null, 2)
    stats.jsonSize = json.length
    await rememberExport(runtimeInfo, stats)

    mg.ui.postMessage({
      type: 'sendData',
      text: json,
      mode,
      stats,
      zipName: includeZipAssets ? slugifyName(designData.fileName + '_' + designData.pageName, 'mastergo_export') + '.zip' : '',
      zipPayload: includeZipAssets ? {
        jsonFileName: 'design.json',
        assets: pngAssets,
      } : null,
    })

  } catch (e) {
    console.log('[Export] FATAL:', e.message)
    try {
      mg.ui.postMessage({ type: 'error', message: '导出失败: ' + e.message })
    } catch { }
  }
}

function run() {
  console.log('[Export] === Design JSON Export ===')
  console.log('[Export] Runtime capabilities:', getRuntimeCapabilities())
  const command = mg.command || 'exportPage'
  mg.showUI(__html__, { visible: true, width: 500, height: 520 })
  let started = false
  function postExportInfo() {
    try {
      const doc = mg.document
      const page = doc && doc.currentPage
      if (!doc || !page) return
      mg.ui.postMessage({
        type: 'exportInfo',
        info: commandInfo(command, doc, page),
        config: normalizeExportConfig({}),
      })
    } catch (e) {
      try {
        mg.ui.postMessage({ type: 'error', message: '读取导出信息失败: ' + e.message })
      } catch { }
    }
  }
  function startExportOnce(config) {
    if (started) return
    started = true
    postProgress('start', 0, 0, '正在启动导出...')
    setTimeout(function () {
      exportDesign(config)
    }, 80)
  }

  mg.ui.onmessage = function (msg) {
    if (msg.type === 'closePlugin') {
      mg.closePlugin('')
      return
    }
    if (msg.type === 'uiReady') {
      postExportInfo()
      return
    }
    if (msg.type === 'startExport') {
      startExportOnce(msg.config || {})
    }
  }
}

run()
