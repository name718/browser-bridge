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

const DEBUG_EXPORT = true

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

function debugLog(tag, payload) {
  if (!DEBUG_EXPORT) return
  try {
    console.log('[ExportDebug][' + tag + ']', JSON.stringify(payload))
  } catch (e) {
    console.log('[ExportDebug][' + tag + ']', payload)
  }
}

// ─── 文字样式（通过 CSS 解析 + 文本样式匹配） ───

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
  let lineHeight = null
  let letterSpacing = null
  let textDecoration = 'NONE'
  let textCase = 'ORIGINAL'

  // 策略1：通过 getWebStyleCodeById 获取 CSS，解析字体信息
  try {
    const codeResult = await mg.getWebStyleCodeById(node.id)
    if (codeResult && codeResult.data) {
      const cssText = typeof codeResult.data === 'string'
        ? codeResult.data
        : JSON.stringify(codeResult.data)

      // 解析 font-family
      const ffMatch = cssText.match(/font-family\s*:\s*['"]?([^;'"]+)/i)
      if (ffMatch) fontFamily = ffMatch[1].trim().replace(/['"]/g, '')

      // 解析 font-size
      const fsMatch = cssText.match(/font-size\s*:\s*([\d.]+)px/i)
      if (fsMatch) fontSize = parseFloat(fsMatch[1])

      // 解析 font-weight
      const fwMatch = cssText.match(/font-weight\s*:\s*(\w+)/i)
      if (fwMatch) fontStyle = fwMatch[1].trim()

      // 解析 line-height
      const lhMatch = cssText.match(/line-height\s*:\s*([\d.]+)(px|em|rem)?/i)
      if (lhMatch) lineHeight = parseFloat(lhMatch[1])

      // 解析 letter-spacing
      const lsMatch = cssText.match(/letter-spacing\s*:\s*([\d.-]+)px/i)
      if (lsMatch) letterSpacing = parseFloat(lsMatch[1])

      // 解析 text-decoration
      const tdMatch = cssText.match(/text-decoration\s*:\s*(\w+)/i)
      if (tdMatch) textDecoration = tdMatch[1].toUpperCase()

      // 解析 text-transform
      const ttMatch = cssText.match(/text-transform\s*:\s*(\w+)/i)
      if (ttMatch) {
        const tc = ttMatch[1].toLowerCase()
        if (tc === 'uppercase') textCase = 'UPPER'
        else if (tc === 'lowercase') textCase = 'LOWER'
        else if (tc === 'capitalize') textCase = 'TITLE'
      }

    }
  } catch (e) {
  }

  // 策略2：如果 CSS 解析没拿到 fontFamily，通过 getLocalTextStyles 匹配
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

  const fontWeight = fontStyleToWeight(fontStyle)

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
  }
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
  const dirMatch = cssText.match(/flex-direction\s*:\s*(\w+)/i)
  if (dirMatch) {
    result.layoutMode = dirMatch[1].toUpperCase() // COLUMN / ROW
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
  const jcMatch = cssText.match(/justify-content\s*:\s*(\w+)/i)
  if (jcMatch) {
    const m = { 'flex-start': 'MIN', 'center': 'CENTER', 'flex-end': 'MAX', 'space-between': 'SPACE_BETWEEN' }
    result.primaryAxisAlignItems = m[jcMatch[1]] || 'MIN'
  }
  // align-items → counterAxisAlignItems
  const aiMatch = cssText.match(/align-items\s*:\s*(\w+)/i)
  if (aiMatch) {
    const m = { 'flex-start': 'MIN', 'center': 'CENTER', 'flex-end': 'MAX', 'stretch': 'STRETCH', 'baseline': 'BASELINE' }
    result.counterAxisAlignItems = m[aiMatch[1]] || 'MIN'
  }
  return result
}

function extractAutoLayout(node, cssText) {
  const pl = node.paddingLeft
  const pr = node.paddingRight
  const pt = node.paddingTop
  const pb = node.paddingBottom
  const sp = node.itemSpacing

  // 从 CSS 解析布局信息
  const cssLayout = cssText ? parseLayoutCSS(cssText) : {}

  // 只要有 padding/spacing 或 CSS 中有 display:flex 就导出
  const hasPadding = pl != null || pr != null || pt != null || pb != null
  const hasSpacing = sp != null
  if (!hasPadding && !hasSpacing && !cssLayout.isAutoLayout) return null

  const layout = {
    paddingLeft: pl || 0,
    paddingRight: pr || 0,
    paddingTop: pt || 0,
    paddingBottom: pb || 0,
    itemSpacing: sp != null ? sp : (cssLayout.itemSpacing || 0),
  }

  // 优先用 CSS 解析的值，其次尝试代理属性
  layout.layoutMode = cssLayout.layoutMode || 'NONE'
  if (layout.layoutMode === 'NONE') {
    try { layout.layoutMode = node.layoutMode || 'NONE' } catch { }
  }
  layout.layoutWrap = cssLayout.layoutWrap || 'NO_WRAP'
  layout.primaryAxisAlignItems = cssLayout.primaryAxisAlignItems || 'MIN'
  layout.counterAxisAlignItems = cssLayout.counterAxisAlignItems || 'MIN'
  try { layout.primaryAxisSizingMode = node.primaryAxisSizingMode || 'AUTO' } catch { }
  try { layout.counterAxisSizingMode = node.counterAxisSizingMode || 'AUTO' } catch { }

  return layout
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
  } = options

  try {
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
      data.fills = fills.map(fill => {
        const f = { type: fill.type || 'SOLID', visible: fill.visible !== false }
        if (f.type === 'SOLID') {
          f.color = clone(fill.color)
          f.opacity = fill.opacity
        } else if (f.type === 'IMAGE') {
          f.scaleMode = fill.scaleMode || 'FILL'
          f.imageHash = fill.imageRef || null
          imageNodes.add(node.id)
        } else if (f.type && f.type.startsWith('GRADIENT_')) {
          f.gradientStops = clone(fill.gradientStops)
          f.gradientTransform = clone(fill.gradientTransform)
        }
        return f
      })
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
    if (node.children && node.children.length > 0) {
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
        }))
      }
    }

    return data
  } catch (e) {
    console.log('[Export] extractNode error:', node.name, e.message)
    return { id: node.id || '?', type: node.type || '?', name: node.name || '?', _error: e.message }
  }
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

async function run() {
  console.log('[Export] === Design JSON Export ===')

  try {
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
    let nodes = []
    let mode = ''

    if (command === 'exportSelection') {
      const selection = page.selection
      if (!selection || selection.length === 0) {
        mg.closePlugin('请先选中要导出的图层')
        return
      }
      nodes = selection
      mode = '选中图层 (' + nodes.length + ' 个)'
    } else {
      nodes = page.children || []
      mode = includeImages ? '当前页面（含图片）' : '当前页面'
    }

    console.log('[Export] 提取中，节点数:', nodes.length)

    const options = { includeImages, imageNodes: new Set() }
    const extractedNodes = []
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
      }))
    }

    // 导出图片
    let images = {}
    if (includeImages && options.imageNodes.size > 0) {
      images = await exportImages(options.imageNodes)
    }

    const designData = {
      schemaVersion: 2,
      fileName: doc.name || 'untitled',
      pageId: page.id || '',
      pageName: page.name || 'untitled',
      pageSize: {
        width: page.width != null ? round2(page.width) : null,
        height: page.height != null ? round2(page.height) : null,
      },
      contentBounds: deriveContentBounds(extractedNodes),
      exportMode: mode,
      exportedAt: new Date().toISOString(),
      nodeCount: extractedNodes.length,
      nodes: extractedNodes,
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
    })

    const json = JSON.stringify(designData, null, 2)

    // 展示 UI 让用户复制
    mg.showUI(__html__, { visible: true, width: 460, height: 400 })
    mg.ui.postMessage({ type: 'sendData', text: json, mode })

    mg.ui.onmessage = function (msg) {
      if (msg.type === 'closePlugin') {
        mg.closePlugin('')
      }
    }
  } catch (e) {
    console.log('[Export] FATAL:', e.message)
    mg.closePlugin('导出失败: ' + e.message)
  }
}

run()
