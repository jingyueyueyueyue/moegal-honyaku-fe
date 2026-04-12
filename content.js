const EXCLUDED_IMAGE_KEYWORDS = /(avatar|icon|logo|emoji|emoticon|sprite|thumb|thumbnail|favicon|profile|userpic|badge)/i
const COMIC_IMAGE_HINT_KEYWORDS = /(comic|manga|manhua|manhwa|chapter|panel|page|raw)/i
const CANVAS_INCLUDE_KEYWORDS = /(page|contents|reader|comic|manga|chapter|panel|slide)/i
const CANVAS_EXCLUDE_KEYWORDS = /(chart|graph|avatar|icon|logo|video|editor|signature|captcha)/i
const DEFAULT_API_BASE = "http://127.0.0.1:8000"
const API_BASE_STORAGE_KEY = "api_base_url"
const AUTO_TRANSLATE_KEY = "auto_translate_enabled"
const AUTO_SAVE_IMAGE_KEY = "auto_save_image_enabled"
const BASE64_UPLOAD_KEY = "base64_upload_enabled"
const VERTICAL_TEXT_KEY = "vertical_text_enabled"
const AI_LINEBREAK_KEY = "ai_linebreak_enabled"

let API_BASE = DEFAULT_API_BASE
let TRANSLATE_API_URL = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/web`

const MIN_RENDERED_WIDTH = 160
const MIN_RENDERED_HEIGHT = 160
const MIN_RENDERED_AREA = 42000
const MIN_NATURAL_WIDTH = 260
const MIN_NATURAL_HEIGHT = 260
const MIN_ASPECT_RATIO = 0.28
const MAX_ASPECT_RATIO = 3.5

const BUTTON_HIDE_DELAY = 200
const BUTTON_RESET_DELAY = 2000

const surfaceButtons = new WeakMap()
const canvasOverlays = new WeakMap()
const translatedSurfaces = new WeakSet()

let autoTranslateEnabled = false
let autoTranslateQueue = []
let isProcessingQueue = false
let autoSaveImageEnabled = false
let base64UploadEnabled = true  // 默认开启 base64 上传
let verticalTextEnabled = false  // 默认横排文字
let aiLinebreakEnabled = true  // 默认启用 AI 断句

// 翻译模式相关
let translateMode = "parallel"  // parallel, structured, context, context-batch, context-sequential
let sequentialContext = []  // 用于 context-sequential 模式的累积上下文

function decodeSafe(text) {
    try {
        return decodeURIComponent(text)
    } catch (error) {
        return text
    }
}

function getNodeTextForMatch(node) {
    if (!node || !(node instanceof Element)) return ""
    const tagName = node.tagName?.toLowerCase() || ""
    const id = node.id || ""
    const className = typeof node.className === "string" ? node.className : ""
    const ariaLabel = node.getAttribute("aria-label") || ""
    const role = node.getAttribute("role") || ""
    const dataType = node.getAttribute("data-type") || ""
    const datasetValues = node.dataset ? Object.values(node.dataset).join(" ") : ""
    return `${tagName} ${id} ${className} ${ariaLabel} ${role} ${dataType} ${datasetValues}`.toLowerCase()
}

function matchesKeywordAroundNode(node, pattern, maxDepth = 4) {
    let current = node instanceof Element ? node : null
    let depth = 0
    while (current && depth < maxDepth) {
        if (pattern.test(getNodeTextForMatch(current))) {
            return true
        }

        const previous = current.previousElementSibling
        if (previous && pattern.test(getNodeTextForMatch(previous))) {
            return true
        }

        const next = current.nextElementSibling
        if (next && pattern.test(getNodeTextForMatch(next))) {
            return true
        }

        current = current.parentElement
        depth += 1
    }
    return false
}

function hasExcludedKeywordAroundNode(node) {
    return matchesKeywordAroundNode(node, EXCLUDED_IMAGE_KEYWORDS)
}

function isLikelyRoundAvatar(img, rect) {
    const style = window.getComputedStyle(img)
    const borderRadius = style.borderRadius || ""
    if (borderRadius.includes("%")) {
        const percent = Number.parseFloat(borderRadius)
        if (Number.isFinite(percent) && percent >= 40) return true
    }

    const topLeftRadius = Number.parseFloat(style.borderTopLeftRadius)
    const minSide = Math.min(rect.width, rect.height)
    if (Number.isFinite(topLeftRadius) && minSide > 0 && topLeftRadius >= minSide * 0.35) {
        return true
    }

    return false
}

function isManagedOverlayNode(node) {
    return Boolean(node instanceof Element && node.closest(".moegal-translate-overlay"))
}

function getSurfaceRect(surface) {
    return surface.getBoundingClientRect()
}

function getSurfaceIntrinsicSize(surface, rect) {
    if (surface instanceof HTMLImageElement) {
        return {
            width: surface.naturalWidth || rect.width,
            height: surface.naturalHeight || rect.height,
        }
    }

    if (surface instanceof HTMLCanvasElement) {
        return {
            width: surface.width || rect.width,
            height: surface.height || rect.height,
        }
    }

    return {
        width: rect.width,
        height: rect.height,
    }
}

function isSurfaceSizeEligible(surface) {
    if (!(surface instanceof Element) || !surface.isConnected) return false

    const rect = getSurfaceRect(surface)
    if (rect.width < MIN_RENDERED_WIDTH || rect.height < MIN_RENDERED_HEIGHT) return false
    if (rect.width * rect.height < MIN_RENDERED_AREA) return false
    if (rect.bottom <= 0 || rect.right <= 0) return false

    const intrinsicSize = getSurfaceIntrinsicSize(surface, rect)
    if (intrinsicSize.width < MIN_NATURAL_WIDTH || intrinsicSize.height < MIN_NATURAL_HEIGHT) return false

    const ratio = intrinsicSize.width / intrinsicSize.height
    if (ratio < MIN_ASPECT_RATIO || ratio > MAX_ASPECT_RATIO) return false

    return true
}

function isTranslatableImage(img) {
    if (!(img instanceof HTMLImageElement)) return false
    if (isManagedOverlayNode(img)) return false
    if (!isSurfaceSizeEligible(img)) return false

    const rect = getSurfaceRect(img)
    const src = decodeSafe((img.currentSrc || img.src || "").toLowerCase())
    if (!src) return false
    if (src.startsWith("data:image/svg") || /\.svg(\?|#|$)/i.test(src)) return false
    if (EXCLUDED_IMAGE_KEYWORDS.test(src)) return false

    const alt = (img.alt || "").toLowerCase()
    if (EXCLUDED_IMAGE_KEYWORDS.test(alt)) return false
    if (EXCLUDED_IMAGE_KEYWORDS.test(getNodeTextForMatch(img))) return false
    if (hasExcludedKeywordAroundNode(img)) return false

    if (isLikelyRoundAvatar(img, rect) && !COMIC_IMAGE_HINT_KEYWORDS.test(src)) return false

    return true
}

function isTranslatableCanvas(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) return false
    if (isManagedOverlayNode(canvas)) return false
    if (!isSurfaceSizeEligible(canvas)) return false
    if (matchesKeywordAroundNode(canvas, CANVAS_EXCLUDE_KEYWORDS)) return false
    if (!matchesKeywordAroundNode(canvas, CANVAS_INCLUDE_KEYWORDS)) return false
    return true
}

function isTranslatableSurface(surface) {
    if (surface instanceof HTMLImageElement) return isTranslatableImage(surface)
    if (surface instanceof HTMLCanvasElement) return isTranslatableCanvas(surface)
    return false
}

// 检查图片是否"可能"可翻译（即使未加载完成）
// 用于在图片加载前就将其加入队列
function isPotentiallyTranslatable(surface) {
    if (surface instanceof HTMLCanvasElement) {
        return isTranslatableCanvas(surface)
    }
    if (!(surface instanceof HTMLImageElement)) return false
    if (isManagedOverlayNode(surface)) return false
    
    // 检查渲染尺寸（即使图片未加载，DOM 尺寸可能已有）
    const rect = getSurfaceRect(surface)
    if (rect.width < MIN_RENDERED_WIDTH || rect.height < MIN_RENDERED_HEIGHT) return false
    if (rect.width * rect.height < MIN_RENDERED_AREA) return false
    
    // 检查 src
    const src = decodeSafe((surface.currentSrc || surface.src || "").toLowerCase())
    if (!src) return false
    if (src.startsWith("data:image/svg") || /\.svg(\?|#|$)/i.test(src)) return false
    if (EXCLUDED_IMAGE_KEYWORDS.test(src)) return false
    
    const alt = (surface.alt || "").toLowerCase()
    if (EXCLUDED_IMAGE_KEYWORDS.test(alt)) return false
    if (EXCLUDED_IMAGE_KEYWORDS.test(getNodeTextForMatch(surface))) return false
    if (hasExcludedKeywordAroundNode(surface)) return false
    
    if (isLikelyRoundAvatar(surface, rect) && !COMIC_IMAGE_HINT_KEYWORDS.test(src)) return false
    
    return true
}

// 等待图片加载完成（带超时）
function waitForImageLoad(img, timeout = 5000) {
    return new Promise((resolve) => {
        if (img.complete && img.naturalWidth > 0) {
            resolve(true)
            return
        }
        
        const timer = setTimeout(() => {
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve(false)
        }, timeout)
        
        const onLoad = () => {
            clearTimeout(timer)
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve(true)
        }
        
        const onError = () => {
            clearTimeout(timer)
            img.removeEventListener('load', onLoad)
            img.removeEventListener('error', onError)
            resolve(false)
        }
        
        img.addEventListener('load', onLoad)
        img.addEventListener('error', onError)
    })
}

// 持久监听器：等待图片加载完成后自动翻译
// 使用 WeakMap 存储监听器标记，避免重复设置
const delayedListenerSet = new WeakSet()
function setupDelayedTranslateListener(img) {
    if (!(img instanceof HTMLImageElement)) return
    if (delayedListenerSet.has(img)) return  // 已经设置过
    
    delayedListenerSet.add(img)
    
    const onFinalLoad = () => {
        img.removeEventListener('load', onFinalLoad)
        img.removeEventListener('error', onFinalError)
        
        // 检查是否仍需翻译
        if (!autoTranslateEnabled || translatedSurfaces.has(img)) return
        if (!isTranslatableSurface(img)) return
        
        // 加入队列翻译
        addToAutoTranslateQueue(img)
    }
    
    const onFinalError = () => {
        img.removeEventListener('load', onFinalLoad)
        img.removeEventListener('error', onFinalError)
        // 加载失败，从标记中移除（允许重试）
        delayedListenerSet.delete(img)
    }
    
    img.addEventListener('load', onFinalLoad)
    img.addEventListener('error', onFinalError)
}

function getSurfaceHoverTarget(surface) {
    if (surface instanceof HTMLCanvasElement) {
        return surface.parentElement || surface
    }
    return surface
}

function clearHideTimer(state) {
    if (!state.hideTimeout) return
    clearTimeout(state.hideTimeout)
    state.hideTimeout = 0
}

function scheduleButtonReset(state, delay = BUTTON_RESET_DELAY) {
    if (state.resetTimeout) {
        clearTimeout(state.resetTimeout)
    }
    state.resetTimeout = setTimeout(() => {
        state.button.textContent = "翻译图片"
        state.resetTimeout = 0
    }, delay)
}

function setButtonMessage(state, text, delay = BUTTON_RESET_DELAY) {
    clearHideTimer(state)
    if (state.resetTimeout) {
        clearTimeout(state.resetTimeout)
        state.resetTimeout = 0
    }
    state.button.textContent = text
    scheduleButtonReset(state, delay)
}

function buildRefererBaseUrl() {
    return `${window.location.protocol}//${window.location.hostname}`
}

function logTranslateResult(result) {
    if (!result) return
    console.log("-------------------------------------")
    console.log(`耗时：${result.duration}，花费：${result.price}`)
    console.log(`原句：${result.raw_text}`)
    console.log(`翻译：${result.cn_text}`)
    console.log("-------------------------------------")
}

function isCanvasReadBlockedError(error) {
    const message = error instanceof Error ? error.message : String(error || "")
    return /taint|cross-origin|security|insecure|permission|origin-clean|read the canvas/i.test(message)
}

function getCanvasImageBase64(canvas) {
    try {
        return canvas.toDataURL("image/jpeg")
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error))
    }
}

async function getImageBase64(img) {
    const src = img.currentSrc || img.src
    if (!src) {
        throw new Error("图片地址为空")
    }
    
    // 如果已经是 base64，需要转换为 JPEG 格式（后端只支持 png/jpeg/webp）
    if (src.startsWith("data:image")) {
        return new Promise((resolve, reject) => {
            const tempImg = new Image()
            tempImg.onload = () => {
                const canvas = document.createElement("canvas")
                canvas.width = tempImg.width
                canvas.height = tempImg.height
                const ctx = canvas.getContext("2d")
                ctx.drawImage(tempImg, 0, 0)
                resolve(canvas.toDataURL("image/jpeg", 0.85))
            }
            tempImg.onerror = () => reject(new Error("图片加载失败"))
            tempImg.src = src
        })
    }
    
    // 尝试使用 background script 获取图片（绑定 CORS）
    try {
        const response = await chrome.runtime.sendMessage({
            type: "FETCH_IMAGE",
            url: src,
            referer: window.location.href
        })
        if (response.error) {
            throw new Error(response.error)
        }
        if (response.base64) {
            return response.base64
        }
    } catch (bgError) {
        console.warn("Background fetch failed:", bgError)
    }
    
    // 如果 background script 失败，尝试直�?fetch
    try {
        const response = await fetch(src, {
            mode: "cors",
            credentials: "omit",
        })
        if (!response.ok) {
            throw new Error(`图片获取失败: ${response.status}`)
        }
        const blob = await response.blob()
        // 转换为 PNG 格式
        return new Promise((resolve, reject) => {
            const tempImg = new Image()
            tempImg.onload = () => {
                const canvas = document.createElement("canvas")
                canvas.width = tempImg.width
                canvas.height = tempImg.height
                const ctx = canvas.getContext("2d")
                ctx.drawImage(tempImg, 0, 0)
                resolve(canvas.toDataURL("image/jpeg", 0.85))
            }
            tempImg.onerror = () => reject(new Error("图片加载失败"))
            tempImg.src = URL.createObjectURL(blob)
        })
    } catch (fetchError) {
        // 如果 fetch 失败（可能是 CORS），尝试使用 canvas 方式
        try {
            const canvas = document.createElement("canvas")
            canvas.width = img.naturalWidth
            canvas.height = img.naturalHeight
            const ctx = canvas.getContext("2d")
            ctx.drawImage(img, 0, 0)
            return canvas.toDataURL("image/jpeg", 0.85)
        } catch (canvasError) {
            throw new Error("无法获取图片数据，可能是跨域限制")
        }
    }
}

async function getTranslatePayload(surface) {
    const referer = buildRefererBaseUrl()
    const textDirection = verticalTextEnabled ? "vertical" : "horizontal"
    
    if (surface instanceof HTMLImageElement) {
        // 根据开关决定使用 URL 还是 base64
        if (base64UploadEnabled) {
            const imageBase64 = await getImageBase64(surface)
            return {
                image_base64: imageBase64,
                referer,
                source_type: "img",
                text_direction: textDirection,
                enable_linebreak: aiLinebreakEnabled,
            }
        } else {
            return {
                image_url: surface.currentSrc || surface.src,
                referer,
                source_type: "img",
                text_direction: textDirection,
                enable_linebreak: aiLinebreakEnabled,
            }
        }
    }

    if (surface instanceof HTMLCanvasElement) {
        return {
            image_base64: getCanvasImageBase64(surface),
            referer,
            source_type: "canvas",
            text_direction: textDirection,
            enable_linebreak: aiLinebreakEnabled,
        }
    }

    throw new Error("暂不支持该类型")
}

function getCanvasOverlayContainer(canvas) {
    if (canvas.parentElement) return canvas.parentElement
    throw new Error("无法定位画布容器")
}

function ensureRelativePosition(container) {
    const style = window.getComputedStyle(container)
    if (style.position === "static") {
        container.style.position = "relative"
    }
}

function syncCanvasOverlayBounds(state) {
    if (!state.overlay.isConnected || !state.canvas.isConnected || !state.container.isConnected) return

    const canvasRect = state.canvas.getBoundingClientRect()
    const containerRect = state.container.getBoundingClientRect()
    state.overlay.style.left = `${Math.max(0, canvasRect.left - containerRect.left + state.container.scrollLeft)}px`
    state.overlay.style.top = `${Math.max(0, canvasRect.top - containerRect.top + state.container.scrollTop)}px`
    state.overlay.style.width = `${canvasRect.width}px`
    state.overlay.style.height = `${canvasRect.height}px`
}

function ensureCanvasOverlay(canvas) {
    const container = getCanvasOverlayContainer(canvas)
    const existing = canvasOverlays.get(canvas)
    if (existing && existing.overlay.isConnected && existing.container === container) {
        syncCanvasOverlayBounds(existing)
        return existing
    }

    if (existing?.resizeObserver) {
        existing.resizeObserver.disconnect()
    }
    if (existing?.overlay?.isConnected) {
        existing.overlay.remove()
    }

    ensureRelativePosition(container)

    const overlay = document.createElement("div")
    overlay.className = "moegal-translate-overlay"
    overlay.setAttribute("aria-hidden", "true")

    const image = document.createElement("img")
    image.className = "moegal-translate-overlay-image"
    image.alt = ""
    overlay.appendChild(image)
    container.appendChild(overlay)

    const state = {
        canvas,
        container,
        overlay,
        image,
        resizeObserver: null,
    }

    if (typeof ResizeObserver === "function") {
        state.resizeObserver = new ResizeObserver(() => {
            syncCanvasOverlayBounds(state)
        })
        state.resizeObserver.observe(container)
        state.resizeObserver.observe(canvas)
    }

    canvasOverlays.set(canvas, state)
    syncCanvasOverlayBounds(state)
    return state
}

function applyTranslatedResult(surface, translatedDataUrl) {
    if (surface instanceof HTMLImageElement) {
        surface.src = translatedDataUrl
        return
    }

    if (surface instanceof HTMLCanvasElement) {
        const overlayState = ensureCanvasOverlay(surface)
        overlayState.image.src = translatedDataUrl
        overlayState.overlay.hidden = false
        syncCanvasOverlayBounds(overlayState)
    }
}

function downloadTranslatedImage(translatedDataUrl, sourceUrl) {
    try {
        const link = document.createElement("a")
        link.href = translatedDataUrl
        // 从原图片URL提取文件名，或使用默认名
        let filename = "translated_image.jpg"
        if (sourceUrl) {
            try {
                const urlPath = new URL(sourceUrl).pathname
                const originalName = urlPath.split("/").pop()
                if (originalName && originalName.includes(".")) {
                    const nameWithoutExt = originalName.replace(/\.[^.]+$/, "")
                    filename = `${nameWithoutExt}_translated.jpg`
                }
            } catch (e) {
                // URL解析失败，使用默认文件名
            }
        }
        link.download = filename
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
    } catch (error) {
        console.error("保存图片失败:", error)
    }
}

async function requestTranslation(surface) {
    const payload = await getTranslatePayload(surface)
    
    // 通过 background.js 的 Service Worker 代理请求，绕过混合内容限制
    const response = await chrome.runtime.sendMessage({
        type: "TRANSLATE_REQUEST",
        url: TRANSLATE_API_URL,
        payload: payload
    })
    
    if (response.error) {
        throw new Error(response.error)
    }
    
    const result = response.data
    
    logTranslateResult(result)

    if (result?.status !== "success") {
        throw new Error(result?.info || "error")
    }

    return result
}

function createTranslateButton(surface) {
    if (!(surface instanceof HTMLImageElement || surface instanceof HTMLCanvasElement)) return
    if (isManagedOverlayNode(surface)) return
    if (surfaceButtons.has(surface)) return

    const hoverTarget = getSurfaceHoverTarget(surface)
    if (!(hoverTarget instanceof Element)) return

    const button = document.createElement("button")
    button.type = "button"
    button.textContent = "翻译图片"
    button.className = "translate-btn"
    button.style.position = "absolute"
    button.style.zIndex = 9999
    button.style.display = "none"
    document.body.appendChild(button)

    const state = {
        surface,
        hoverTarget,
        button,
        hideTimeout: 0,
        resetTimeout: 0,
    }

    surfaceButtons.set(surface, state)

    const updateButtonPosition = () => {
        const rect = getSurfaceRect(surface)
        button.style.top = `${rect.top + window.scrollY + 3}px`
        button.style.left = `${rect.left + window.scrollX + 3}px`
    }

    const showButton = () => {
        clearHideTimer(state)
        if (!surface.isConnected || !isTranslatableSurface(surface)) {
            button.style.display = "none"
            return
        }
        updateButtonPosition()
        button.style.display = "block"
    }

    const hideButtonWithDelay = () => {
        clearHideTimer(state)
        state.hideTimeout = setTimeout(() => {
            button.style.display = "none"
            state.hideTimeout = 0
        }, BUTTON_HIDE_DELAY)
    }

    hoverTarget.addEventListener("mouseenter", showButton)
    hoverTarget.addEventListener("mouseleave", hideButtonWithDelay)
    button.addEventListener("mouseenter", showButton)
    button.addEventListener("mouseleave", hideButtonWithDelay)
    button.addEventListener("click", async (event) => {
        event.preventDefault()
        event.stopPropagation()

        if (!isTranslatableSurface(surface)) {
            setButtonMessage(state, "仅支持漫画图", 1200)
            return
        }

        if (state.resetTimeout) {
            clearTimeout(state.resetTimeout)
            state.resetTimeout = 0
        }
        button.textContent = "处理中..."

        try {
            const result = await requestTranslation(surface)
            const translatedDataUrl = "data:image/jpeg;base64," + result.res_img
            applyTranslatedResult(surface, translatedDataUrl)
            // 自动保存图片
            if (autoSaveImageEnabled) {
                const sourceUrl = surface instanceof HTMLImageElement ? (surface.currentSrc || surface.src) : null
                downloadTranslatedImage(translatedDataUrl, sourceUrl)
            }
            button.textContent = "翻译完成"
        } catch (error) {
            console.error("翻译失败:", error)
            if (surface instanceof HTMLCanvasElement && isCanvasReadBlockedError(error)) {
                button.textContent = "当前页面禁止读取画布"
            } else {
                const errorMessage = error instanceof Error ? error.message : String(error || "")
                if (/structured|格式|数量|不匹配|列表|list/i.test(errorMessage)) {
                    button.textContent = "请重试/切并行"
                } else {
                    button.textContent = "翻译失败"
                }
            }
        }

        scheduleButtonReset(state)
    })
}

async function init() {
  await loadApiBase()
  const surfaces = document.querySelectorAll("img, canvas")
  surfaces.forEach((surface) => createTranslateButton(surface))
}
// 为图片添加 load 事件监听，处理懒加载情况
function setupImageLoadListener(img) {
    if (!(img instanceof HTMLImageElement)) return
    
    // 已经加载完成且有内容
    if (img.complete && img.naturalWidth > 0) {
        // 直接检查是否需要翻译（可能之前漏掉了）
        if (autoTranslateEnabled && isPotentiallyTranslatable(img) && !translatedSurfaces.has(img)) {
            addToAutoTranslateQueue(img)
        }
        return
    }
    
    // 未加载完成，设置监听器
    const onLoad = () => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
        // 图片加载完成后，重新检查是否需要翻译（使用宽松检查）
        if (isPotentiallyTranslatable(img) && !translatedSurfaces.has(img)) {
            createTranslateButton(img)
            addToAutoTranslateQueue(img)
        }
    }
    
    const onError = () => {
        img.removeEventListener('load', onLoad)
        img.removeEventListener('error', onError)
    }
    
    img.addEventListener('load', onLoad)
    img.addEventListener('error', onError)
}

function handleAddedNode(node) {
    if (!(node instanceof Element)) return

    if (node instanceof HTMLImageElement || node instanceof HTMLCanvasElement) {
        createTranslateButton(node)
        addToAutoTranslateQueue(node)
        // 为图片设置 load 监听
        if (node instanceof HTMLImageElement) {
            setupImageLoadListener(node)
        }
    }

    const surfaces = node.querySelectorAll?.("img, canvas")
    surfaces?.forEach((surface) => {
        createTranslateButton(surface)
        addToAutoTranslateQueue(surface)
        // 为图片设置 load 监听
        if (surface instanceof HTMLImageElement) {
            setupImageLoadListener(surface)
        }
    })
}

// 自动翻译相关函数
async function loadApiBase() {
  try {
    const result = await chrome.storage.local.get(API_BASE_STORAGE_KEY)
    const savedBase = result[API_BASE_STORAGE_KEY]
    if (savedBase && typeof savedBase === "string" && savedBase.trim()) {
      API_BASE = savedBase.trim()
    } else {
      API_BASE = DEFAULT_API_BASE
    }
    TRANSLATE_API_URL = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/web`
  } catch (error) {
    console.error("读取API地址失败:", error)
    API_BASE = DEFAULT_API_BASE
    TRANSLATE_API_URL = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/web`
  }
}

async function loadAutoTranslateState() {
    try {
        const result = await chrome.storage.local.get([AUTO_TRANSLATE_KEY, AUTO_SAVE_IMAGE_KEY, BASE64_UPLOAD_KEY, VERTICAL_TEXT_KEY, AI_LINEBREAK_KEY])
        autoTranslateEnabled = result[AUTO_TRANSLATE_KEY] === true
        autoSaveImageEnabled = result[AUTO_SAVE_IMAGE_KEY] === true
        base64UploadEnabled = result[BASE64_UPLOAD_KEY] !== false  // 默认开启，只有明确设为 false 才关闭
        verticalTextEnabled = result[VERTICAL_TEXT_KEY] === true  // 默认横排
        aiLinebreakEnabled = result[AI_LINEBREAK_KEY] !== false  // 默认启用 AI 断句
        if (autoTranslateEnabled) {
            startAutoTranslate()
        }
    } catch (error) {
        console.error("读取自动翻译状态失败:", error)
    }
}

// 从后端获取翻译模式
async function loadTranslateMode() {
    try {
        const response = await fetch(`${API_BASE}/conf/query`)
        if (response.ok) {
            const conf = await response.json()
            translateMode = conf.translate_mode || "parallel"
            console.log("翻译模式:", translateMode)
        }
    } catch (error) {
        console.error("读取翻译模式失败:", error)
    }
}

function startAutoTranslate() {
    autoTranslateQueue = []
    sequentialContext = []  // 重置累积上下文
    const surfaces = document.querySelectorAll("img, canvas")
    surfaces.forEach((surface) => {
        // 为图片设置 load 监听，处理懒加载
        if (surface instanceof HTMLImageElement) {
            setupImageLoadListener(surface)
        }
        // 使用 isPotentiallyTranslatable 检查，即使图片未加载也能加入队列
        if (isPotentiallyTranslatable(surface) && !translatedSurfaces.has(surface)) {
            autoTranslateQueue.push(surface)
        }
    })
    
    // 启动定期扫描，处理漏掉的图片
    startPeriodicScan()
    
    // 根据翻译模式选择处理方式
    if (translateMode === "context-batch") {
        // 批量模式：延迟处理，等待懒加载图片
        scheduleBatchProcess()
    } else if (translateMode === "context-sequential") {
        processSequentialTranslate()
    } else {
        processAutoTranslateQueue()
    }
}

// 定期扫描未翻译的图片
let periodicScanTimer = null
const PERIODIC_SCAN_INTERVAL = 3000  // 3秒扫描一次

function startPeriodicScan() {
    if (periodicScanTimer) return
    
    periodicScanTimer = setInterval(() => {
        if (!autoTranslateEnabled) {
            stopPeriodicScan()
            return
        }
        
        // 扫描页面上所有图片
        const surfaces = document.querySelectorAll("img, canvas")
        let newFound = 0
        
        surfaces.forEach((surface) => {
            // 跳过已翻译或已在队列中的
            if (translatedSurfaces.has(surface)) return
            if (autoTranslateQueue.includes(surface)) return
            
            // 检查是否可翻译（已加载完成）
            if (surface instanceof HTMLImageElement) {
                if (surface.complete && surface.naturalWidth > 0 && isTranslatableSurface(surface)) {
                    autoTranslateQueue.push(surface)
                    newFound++
                }
            } else if (isTranslatableSurface(surface)) {
                autoTranslateQueue.push(surface)
                newFound++
            }
        })
        
        // 如果发现新图片，触发处理
        if (newFound > 0) {
            console.log(`[定期扫描] 发现 ${newFound} 张新图片`)
            if (translateMode === "context-batch") {
                scheduleBatchProcess()
            } else if (translateMode === "context-sequential") {
                processSequentialTranslate()
            } else {
                processAutoTranslateQueue()
            }
        }
    }, PERIODIC_SCAN_INTERVAL)
}

function stopPeriodicScan() {
    if (periodicScanTimer) {
        clearInterval(periodicScanTimer)
        periodicScanTimer = null
    }
}

function stopAutoTranslate() {
    autoTranslateQueue = []
    stopPeriodicScan()
}

async function processAutoTranslateQueue() {
    if (isProcessingQueue || !autoTranslateEnabled) return
    if (autoTranslateQueue.length === 0) return

    isProcessingQueue = true

    while (autoTranslateQueue.length > 0 && autoTranslateEnabled) {
        const surface = autoTranslateQueue.shift()
        
        if (!surface.isConnected || translatedSurfaces.has(surface)) {
            continue
        }

        // 如果是图片，等待加载完成
        if (surface instanceof HTMLImageElement) {
            const loaded = await waitForImageLoad(surface, 5000)
            if (!loaded) {
                // 加载超时，设置持久监听器
                setupDelayedTranslateListener(surface)
                continue
            }
            if (!isTranslatableSurface(surface)) {
                continue
            }
        } else if (!isTranslatableSurface(surface)) {
            continue
        }

        try {
            const result = await requestTranslation(surface)
            const translatedDataUrl = "data:image/jpeg;base64," + result.res_img
            applyTranslatedResult(surface, translatedDataUrl)
            translatedSurfaces.add(surface)
            // 自动保存图片
            if (autoSaveImageEnabled) {
                const sourceUrl = surface instanceof HTMLImageElement ? (surface.currentSrc || surface.src) : null
                downloadTranslatedImage(translatedDataUrl, sourceUrl)
            }
        } catch (error) {
            console.error("自动翻译失败:", error)
        }
    }

    isProcessingQueue = false
    
    // 检查是否有新图片加入队列，继续处理
    if (autoTranslateQueue.length > 0 && autoTranslateEnabled) {
        processAutoTranslateQueue()
    }
}

// ============ 批量翻译模式（context-batch）============
async function processBatchTranslate() {
    if (isProcessingQueue || !autoTranslateEnabled) return
    if (autoTranslateQueue.length === 0) return

    isProcessingQueue = true
    console.log(`[context-batch] 开始批量翻译 ${autoTranslateQueue.length} 张图片`)

    // 收集所有待处理的图片（包括未加载的）
    const pendingSurfaces = autoTranslateQueue.filter(surface => 
        surface.isConnected && 
        !translatedSurfaces.has(surface)
    )
    autoTranslateQueue = []

    if (pendingSurfaces.length === 0) {
        isProcessingQueue = false
        return
    }

    // 按 DOM 位置排序
    pendingSurfaces.sort((a, b) => {
        const rectA = a.getBoundingClientRect()
        const rectB = b.getBoundingClientRect()
        if (Math.abs(rectA.top - rectB.top) > 50) {
            return rectA.top - rectB.top
        }
        return rectA.left - rectB.left
    })

    // 等待所有图片加载完成
    const validSurfaces = []
    for (const surface of pendingSurfaces) {
        if (surface instanceof HTMLImageElement) {
            const loaded = await waitForImageLoad(surface, 5000)
            if (loaded && isTranslatableSurface(surface)) {
                validSurfaces.push(surface)
            } else if (!loaded) {
                // 加载超时，设置持久监听器
                setupDelayedTranslateListener(surface)
            }
        } else if (isTranslatableSurface(surface)) {
            validSurfaces.push(surface)
        }
    }

    if (validSurfaces.length === 0) {
        isProcessingQueue = false
        return
    }

    try {
        // 收集所有图片数据
        const images = []
        for (const surface of validSurfaces) {
            const payload = await getTranslatePayload(surface)
            images.push({
                image_base64: payload.image_base64,
                image_url: payload.image_url,
            })
        }

        // 发送批量翻译请求
        const batchUrl = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/batch`
        const textDirection = verticalTextEnabled ? "vertical" : "horizontal"
        
        const response = await chrome.runtime.sendMessage({
            type: "BATCH_TRANSLATE_REQUEST",
            url: batchUrl,
            payload: {
                images,
                referer: buildRefererBaseUrl(),
                text_direction: textDirection,
                enable_linebreak: aiLinebreakEnabled,
            }
        })

        if (response.error) {
            throw new Error(response.error)
        }

        const result = response.data

        if (result?.status !== "success") {
            throw new Error(result?.info || "批量翻译失败")
        }

        // 应用翻译结果
        for (let i = 0; i < validSurfaces.length && i < result.results.length; i++) {
            const surface = validSurfaces[i]
            const itemResult = result.results[i]
            
            if (itemResult.res_img) {
                const translatedDataUrl = "data:image/jpeg;base64," + itemResult.res_img
                applyTranslatedResult(surface, translatedDataUrl)
                translatedSurfaces.add(surface)
                
                if (autoSaveImageEnabled) {
                    const sourceUrl = surface instanceof HTMLImageElement ? (surface.currentSrc || surface.src) : null
                    downloadTranslatedImage(translatedDataUrl, sourceUrl)
                }
            }
        }

        console.log(`[context-batch] 批量翻译完成，耗时 ${result.duration}s`)

    } catch (error) {
        console.error("[context-batch] 批量翻译失败:", error)
    }

    isProcessingQueue = false
    
    // 检查是否有新图片加入队列，继续处理
    if (autoTranslateQueue.length > 0 && autoTranslateEnabled) {
        scheduleBatchProcess()
    }
}

// ============ 顺序翻译模式（context-sequential）============
async function processSequentialTranslate() {
    if (isProcessingQueue || !autoTranslateEnabled) return
    if (autoTranslateQueue.length === 0) return

    isProcessingQueue = true
    console.log(`[context-sequential] 开始顺序翻译，当前上下文: ${sequentialContext.length} 条`)

    // 收集所有有效图片（包括未加载的）
    const pendingSurfaces = autoTranslateQueue.filter(surface => 
        surface.isConnected && 
        !translatedSurfaces.has(surface)
    )
    autoTranslateQueue = []

    if (pendingSurfaces.length === 0) {
        isProcessingQueue = false
        return
    }

    // 按 DOM 位置排序（从上到下，从左到右）
    pendingSurfaces.sort((a, b) => {
        const rectA = a.getBoundingClientRect()
        const rectB = b.getBoundingClientRect()
        // 先按 top 排序，相同则按 left 排序
        if (Math.abs(rectA.top - rectB.top) > 50) {
            return rectA.top - rectB.top
        }
        return rectA.left - rectB.left
    })

    for (const surface of pendingSurfaces) {
        if (!autoTranslateEnabled) break
        
        // 如果是图片，等待加载完成
        if (surface instanceof HTMLImageElement) {
            const loaded = await waitForImageLoad(surface, 5000)
            if (!loaded) {
                // 加载超时，设置持久监听器，等加载完成后再翻译
                console.log("[context-sequential] 图片加载超时，设置持久监听器")
                setupDelayedTranslateListener(surface)
                continue
            }
            if (!isTranslatableSurface(surface)) {
                console.log("[context-sequential] 图片不可翻译，跳过")
                continue
            }
        } else if (!isTranslatableSurface(surface)) {
            continue
        }
        
        try {
            // 发送带上下文的翻译请求
            const payload = await getTranslatePayload(surface)
            const sequentialUrl = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/sequential`
            const textDirection = verticalTextEnabled ? "vertical" : "horizontal"
            
            const response = await chrome.runtime.sendMessage({
                type: "SEQUENTIAL_TRANSLATE_REQUEST",
                url: sequentialUrl,
                payload: {
                    ...payload,
                    previous_translations: sequentialContext.slice(-20),  // 只保留最近20条
                    text_direction: textDirection,
                    enable_linebreak: aiLinebreakEnabled,
                }
            })

            if (response.error) {
                throw new Error(response.error)
            }

            const result = response.data

            if (result?.status !== "success") {
                throw new Error(result?.info || "翻译失败")
            }

            const translatedDataUrl = "data:image/jpeg;base64," + result.res_img
            applyTranslatedResult(surface, translatedDataUrl)
            translatedSurfaces.add(surface)

            // 累积上下文
            if (result.cn_text && Array.isArray(result.cn_text)) {
                sequentialContext.push(...result.cn_text)
            }

            if (autoSaveImageEnabled) {
                const sourceUrl = surface instanceof HTMLImageElement ? (surface.currentSrc || surface.src) : null
                downloadTranslatedImage(translatedDataUrl, sourceUrl)
            }

            console.log(`[context-sequential] 翻译完成，上下文累积: ${sequentialContext.length} 条`)

        } catch (error) {
            console.error("[context-sequential] 顺序翻译失败:", error)
            // 失败时使用普通翻译，避免中断
            try {
                const result = await requestTranslation(surface)
                const translatedDataUrl = "data:image/jpeg;base64," + result.res_img
                applyTranslatedResult(surface, translatedDataUrl)
                translatedSurfaces.add(surface)
                if (result.cn_text && Array.isArray(result.cn_text)) {
                    sequentialContext.push(...result.cn_text)
                }
            } catch (fallbackError) {
                console.error("[context-sequential] 回退翻译也失败:", fallbackError)
            }
        }
    }

    isProcessingQueue = false
    
    // 检查是否有新图片加入队列，继续处理
    if (autoTranslateQueue.length > 0 && autoTranslateEnabled) {
        processSequentialTranslate()
    }
}

function addToAutoTranslateQueue(surface) {
    if (!autoTranslateEnabled) return
    if (!isPotentiallyTranslatable(surface)) return  // 使用新检查函数
    if (translatedSurfaces.has(surface)) return
    if (autoTranslateQueue.includes(surface)) return
    
    autoTranslateQueue.push(surface)
    
    // 根据当前翻译模式触发对应的处理函数
    if (translateMode === "context-batch") {
        // 批量模式：等待更多图片，稍后统一处理
        scheduleBatchProcess()
    } else if (translateMode === "context-sequential") {
        processSequentialTranslate()
    } else {
        processAutoTranslateQueue()
    }
}

// 批量翻译的延迟处理（等待更多图片加载）
let batchProcessTimer = null
function scheduleBatchProcess() {
    if (batchProcessTimer) {
        clearTimeout(batchProcessTimer)
    }
    // 等待 500ms 无新图片后再开始批量翻译
    batchProcessTimer = setTimeout(() => {
        batchProcessTimer = null
        processBatchTranslate()
    }, 500)
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === "AUTO_TRANSLATE_TOGGLE") {
        autoTranslateEnabled = message.enabled
        if (autoTranslateEnabled) {
            startAutoTranslate()
        } else {
            stopAutoTranslate()
        }
    }
    if (message.type === "AUTO_SAVE_IMAGE_TOGGLE") {
        autoSaveImageEnabled = message.enabled
    }
    if (message.type === "BASE64_UPLOAD_TOGGLE") {
        base64UploadEnabled = message.enabled
        console.log("Base64上传模式已", message.enabled ? "开启" : "关闭")
    }
    if (message.type === "VERTICAL_TEXT_TOGGLE") {
        verticalTextEnabled = message.enabled
        console.log("文字排版已切换为", message.enabled ? "竖排" : "横排")
    }
    if (message.type === "AI_LINEBREAK_TOGGLE") {
        aiLinebreakEnabled = message.enabled
        console.log("AI智能断句已", message.enabled ? "启用" : "禁用")
    }
    if (message.type === "TRANSLATE_MODE_UPDATED") {
        translateMode = message.mode || "parallel"
        sequentialContext = []  // 切换模式时重置上下文
        console.log("翻译模式已切换为:", translateMode)
    }
    if (message.type === "API_BASE_UPDATED") {
        API_BASE = message.apiBase || DEFAULT_API_BASE
        TRANSLATE_API_URL = `${API_BASE.replace(/\/+$/, "")}/api/v1/translate/web`
        console.log("API地址已更新:", API_BASE)
        // 如果自动翻译已开启，重新启动以确保使用新API地址
        if (autoTranslateEnabled) {
            stopAutoTranslate()
            startAutoTranslate()
        }
    }
})

const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        mutation.addedNodes.forEach((node) => handleAddedNode(node))
    })
})

observer.observe(document.body, { childList: true, subtree: true })

// 初始化顺序：先加载配置，再启动自动翻译
async function initializeContent() {
    init()
    await loadTranslateMode()  // 先加载翻译模式
    await loadAutoTranslateState()  // 再加载自动翻译状态（会根据 translateMode 选择处理方式）
}
initializeContent()
