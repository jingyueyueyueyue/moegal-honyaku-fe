const DEFAULT_API_BASE = "http://127.0.0.1:8000"
const API_BASE_STORAGE_KEY = "api_base_url"
const DEFAULT_OPTIONS = {
  translate_api_type: ["openai", "dashscope"],
  translate_mode: ["parallel", "structured", "context", "context-batch", "context-sequential"],
  ocr_engine: ["local", "vision"],
  vision_ocr_provider: ["openai", "dashscope"],
}
const AUTO_SAVE_IMAGE_KEY = "auto_save_image_enabled"
const BASE64_UPLOAD_KEY = "base64_upload_enabled"
const VERTICAL_TEXT_KEY = "vertical_text_enabled"
const AI_LINEBREAK_KEY = "ai_linebreak_enabled"

// 配置本地缓存 key
const TRANSLATE_CONFIG_CACHE_KEY = "translate_config_cache"
const OCR_CONFIG_CACHE_KEY = "ocr_config_cache"

// 默认 Base URL
const DEFAULT_BASE_URLS = {
  openai: "https://api.openai.com/v1",
  dashscope: "https://dashscope.aliyuncs.com/compatible-mode/v1",
}

let API_BASE = DEFAULT_API_BASE
const BG_STORAGE_KEY = "popup_custom_background"
const CONF_STORAGE_KEY = "popup_last_translate_conf"
const AUTO_TRANSLATE_KEY = "auto_translate_enabled"
const CROP_ZOOM_STEPS = 1000
const BG_EXPORT_MAX_EDGE = 1600
const BG_EXPORT_MAX_PIXELS = 1_600_000

const PROVIDER_LABEL = {
  openai: "OpenAI",
  dashscope: "DashScope",
}

const MODE_LABEL = {
  parallel: "并行翻译",
  structured: "结构化翻译",
  context: "上下文感知",
  "context-batch": "批量上下文",
  "context-sequential": "顺序上下文",
}

const MODE_DESC = {
  parallel: "【并行翻译】每句独立并发请求，速度快，适合简单对话。",
  structured: "【结构化翻译】一次请求完成整组翻译，保持术语一致性。",
  context: "【上下文感知】结合上下文理解代词、省略句和语气，保持叙事连贯性（单图片内）。",
  "context-batch": "【批量上下文】等待所有图片加载后一次性翻译，跨图片保持上下文连贯，适合整话阅读。",
  "context-sequential": "【顺序上下文】按顺序逐图翻译，累积上下文信息，适合边滚动边阅读。",
}

const state = {
  options: { ...DEFAULT_OPTIONS },
  current: {
    translate_api_type: "openai",
    translate_mode: "parallel",
  },
  hydrating: false,
  cropper: {
    isOpen: false,
    image: null,
    objectUrl: "",
    ratio: 1,
    viewportWidth: 0,
    viewportHeight: 0,
    minScale: 1,
    maxScale: 1,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    dragging: false,
    dragPointerId: null,
    startX: 0,
    startY: 0,
    baseOffsetX: 0,
    baseOffsetY: 0,
    resolve: null,
    reject: null,
  },
  // 翻译配置状态
  translateConfig: {
    provider: "openai",
    apiKey: "",
    baseUrl: "",
    model: "",
    models: [],
  },
  // OCR/Vision 配置状态
  ocrConfig: {
    engine: "local",
    provider: "openai",
    apiKey: "",
    baseUrl: "",
    model: "",
    models: [],
  },
}

const view = {
  providerSelect: null,
  modeSelect: null,
  currentEngine: null,
  currentMode: null,
  modeTip: null,
  errorTip: null,
  syncStatus: null,
  lastSync: null,
  reloadButton: null,
  bgFileInput: null,
  clearBgButton: null,
  bgTip: null,
  cropperOverlay: null,
  cropperDesc: null,
  cropperViewport: null,
  cropperCanvas: null,
  cropperZoom: null,
  cropperCancel: null,
  cropperConfirm: null,
  autoTranslateToggle: null,
  autoSaveImageToggle: null,
  base64UploadToggle: null,
  verticalTextToggle: null,
  aiLinebreakToggle: null,
  apiBaseInput: null,
  saveApiButton: null,
  apiTip: null,
  // 翻译配置
  translateProviderSelect: null,
  translateApiKeyInput: null,
  translateBaseUrlInput: null,
  translateModelSelect: null,
  translateRefreshModelsBtn: null,
  translateCustomModelBtn: null,
  translateCustomModelRow: null,
  translateCustomModelInput: null,
  translateConfigTip: null,
  saveTranslateConfigBtn: null,
  // OCR/Vision 配置
  ocrEngineSelect: null,
  visionConfigSection: null,
  visionProviderSelect: null,
  visionApiKeyInput: null,
  visionBaseUrlInput: null,
  visionModelSelect: null,
  visionRefreshModelsBtn: null,
  visionCustomModelBtn: null,
  visionCustomModelRow: null,
  visionCustomModelInput: null,
  visionConfigTip: null,
  saveVisionConfigBtn: null,
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function fitBackgroundExportSize(width, height) {
  let nextWidth = Math.max(1, Number.isFinite(width) ? width : 1)
  let nextHeight = Math.max(1, Number.isFinite(height) ? height : 1)

  const maxEdge = Math.max(nextWidth, nextHeight)
  if (maxEdge > BG_EXPORT_MAX_EDGE) {
    const edgeScale = BG_EXPORT_MAX_EDGE / maxEdge
    nextWidth *= edgeScale
    nextHeight *= edgeScale
  }

  const pixels = nextWidth * nextHeight
  if (pixels > BG_EXPORT_MAX_PIXELS) {
    const pixelScale = Math.sqrt(BG_EXPORT_MAX_PIXELS / pixels)
    nextWidth *= pixelScale
    nextHeight *= pixelScale
  }

  return {
    width: Math.max(1, Math.round(nextWidth)),
    height: Math.max(1, Math.round(nextHeight)),
  }
}

function now() {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date())
}

function providerLabel(value) {
  return PROVIDER_LABEL[value] || value
}

function modeLabel(value) {
  return MODE_LABEL[value] || value
}

function modeTip(value) {
  return MODE_DESC[value] || "可选择并行或结构化翻译模式。"
}

function setStatus(text, className) {
  view.syncStatus.textContent = text
  view.syncStatus.className = `status ${className}`
}

function setError(text) {
  const message = typeof text === "string" ? text.trim() : ""
  view.errorTip.textContent = message
  view.errorTip.hidden = !message
}

function setBackgroundTip(text, isError) {
  const message = typeof text === "string" ? text.trim() : ""
  view.bgTip.textContent = message || "未设置背景"
  view.bgTip.className = isError ? "bg-tip is-error" : "bg-tip"
}

function applyBackground(dataUrl) {
  const normalized = typeof dataUrl === "string" ? dataUrl.trim() : ""
  if (!normalized) {
    document.body.classList.remove("has-custom-bg")
    document.body.style.removeProperty("--popup-bg-image")
    view.clearBgButton.disabled = true
    return false
  }

  const safeUrl = normalized.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
  document.body.style.setProperty("--popup-bg-image", `url("${safeUrl}")`)
  document.body.classList.add("has-custom-bg")
  view.clearBgButton.disabled = false
  return true
}

function persistBackground(dataUrl) {
  try {
    if (dataUrl) {
      localStorage.setItem(BG_STORAGE_KEY, dataUrl)
    } else {
      localStorage.removeItem(BG_STORAGE_KEY)
    }
    return true
  } catch (error) {
    console.error("背景保存失败:", error)
    return false
  }
}

function persistCurrentConfig() {
  try {
    localStorage.setItem(CONF_STORAGE_KEY, JSON.stringify(state.current))
  } catch (error) {
    console.error("配置缓存失败:", error)
  }
}

function hydrateCachedConfig() {
  try {
    const raw = localStorage.getItem(CONF_STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw)
    if (typeof parsed?.translate_api_type === "string" && parsed.translate_api_type.trim()) {
      state.current.translate_api_type = parsed.translate_api_type.trim()
    }
    if (typeof parsed?.translate_mode === "string" && parsed.translate_mode.trim()) {
      state.current.translate_mode = parsed.translate_mode.trim()
    }
  } catch (error) {
    console.error("配置缓存读取失败:", error)
  }
}

function loadBackground() {
  try {
    const cached = localStorage.getItem(BG_STORAGE_KEY) || ""
    const loaded = applyBackground(cached)
    setBackgroundTip(loaded ? "已启用自定义背景。" : "未设置背景", false)
  } catch (error) {
    console.error("背景读取失败:", error)
    setBackgroundTip("读取本地背景失败。", true)
    applyBackground("")
  }
}

async function loadApiBase() {
  try {
    const result = await chrome.storage.local.get(API_BASE_STORAGE_KEY)
    const savedBase = result[API_BASE_STORAGE_KEY]
    if (savedBase && typeof savedBase === "string" && savedBase.trim()) {
      API_BASE = savedBase.trim()
      view.apiBaseInput.value = API_BASE
      setApiTip(`当前: ${API_BASE}`, false)
    } else {
      API_BASE = DEFAULT_API_BASE
      view.apiBaseInput.value = ""
      setApiTip(`默认: ${DEFAULT_API_BASE}`, false)
    }
  } catch (error) {
    console.error("读取API地址失败:", error)
    API_BASE = DEFAULT_API_BASE
    setApiTip("读取失败，使用默认地址。", true)
  }
}

function setApiTip(text, isError) {
  const message = typeof text === "string" ? text.trim() : ""
  view.apiTip.textContent = message
  view.apiTip.className = isError ? "api-tip is-error" : "api-tip"
}

async function saveApiBase() {
  const input = view.apiBaseInput.value.trim()
  let newBase = input || DEFAULT_API_BASE

  // 简单验证 URL 格式
  try {
    const url = new URL(newBase)
    if (!url.protocol.startsWith("http")) {
      throw new Error("仅支持 http/https 协议")
    }
  } catch (error) {
    setApiTip(`地址格式错误: ${error.message}`, true)
    return
  }

  try {
    await chrome.storage.local.set({ [API_BASE_STORAGE_KEY]: newBase })
    API_BASE = newBase
    setApiTip(`已保存: ${newBase}`, false)

    // 通知所有标签页更新 API 地址
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "API_BASE_UPDATED",
            apiBase: newBase
          })
        } catch (e) {
          // 忽略无法发送的标签页
        }
      }
    }
  } catch (error) {
    console.error("保存API地址失败:", error)
    setApiTip("保存失败，请重试。", true)
  }
}

async function loadAutoTranslateState() {
  try {
    const result = await chrome.storage.local.get(AUTO_TRANSLATE_KEY)
    const enabled = result[AUTO_TRANSLATE_KEY] === true
    view.autoTranslateToggle.checked = enabled
  } catch (error) {
    console.error("读取自动翻译状态失败:", error)
    view.autoTranslateToggle.checked = false
  }
}

async function loadAutoSaveImageState() {
  try {
    const result = await chrome.storage.local.get(AUTO_SAVE_IMAGE_KEY)
    const enabled = result[AUTO_SAVE_IMAGE_KEY] === true
    view.autoSaveImageToggle.checked = enabled
  } catch (error) {
    console.error("读取自动保存图片状态失败:", error)
    view.autoSaveImageToggle.checked = false
  }
}

async function loadBase64UploadState() {
  try {
    const result = await chrome.storage.local.get(BASE64_UPLOAD_KEY)
    const enabled = result[BASE64_UPLOAD_KEY] === true
    view.base64UploadToggle.checked = enabled
  } catch (error) {
    console.error("读取Base64上传状态失败:", error)
    view.base64UploadToggle.checked = false
  }
}

async function loadVerticalTextState() {
  try {
    const result = await chrome.storage.local.get(VERTICAL_TEXT_KEY)
    const enabled = result[VERTICAL_TEXT_KEY] === true
    view.verticalTextToggle.checked = enabled
  } catch (error) {
    console.error("读取竖排文字状态失败:", error)
    view.verticalTextToggle.checked = false
  }
}

async function loadAiLinebreakState() {
  try {
    const result = await chrome.storage.local.get(AI_LINEBREAK_KEY)
    // 默认启用 AI 断句，只有明确设为 false 才关闭
    const enabled = result[AI_LINEBREAK_KEY] !== false
    view.aiLinebreakToggle.checked = enabled
  } catch (error) {
    console.error("读取AI断句状态失败:", error)
    view.aiLinebreakToggle.checked = true
  }
}

async function saveAutoTranslateState(enabled) {
  try {
    await chrome.storage.local.set({ [AUTO_TRANSLATE_KEY]: enabled })
  } catch (error) {
    console.error("保存自动翻译状态失败:", error)
  }
}

async function saveAutoSaveImageState(enabled) {
  try {
    await chrome.storage.local.set({ [AUTO_SAVE_IMAGE_KEY]: enabled })
  } catch (error) {
    console.error("保存自动保存图片状态失败:", error)
  }
}

async function saveBase64UploadState(enabled) {
  try {
    await chrome.storage.local.set({ [BASE64_UPLOAD_KEY]: enabled })
  } catch (error) {
    console.error("保存Base64上传状态失败:", error)
  }
}

async function saveVerticalTextState(enabled) {
  try {
    await chrome.storage.local.set({ [VERTICAL_TEXT_KEY]: enabled })
  } catch (error) {
    console.error("保存竖排文字状态失败:", error)
  }
}

async function saveAiLinebreakState(enabled) {
  try {
    await chrome.storage.local.set({ [AI_LINEBREAK_KEY]: enabled })
  } catch (error) {
    console.error("保存AI断句状态失败:", error)
  }
}

async function onAutoTranslateChange(event) {
  const enabled = event.target.checked
  await saveAutoTranslateState(enabled)
  
  // 通知当前标签页的 content script
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      await chrome.tabs.sendMessage(tab.id, {
        type: "AUTO_TRANSLATE_TOGGLE",
        enabled: enabled
      })
    }
  } catch (error) {
    console.error("通知content script失败:", error)
  }
}

async function onAutoSaveImageChange(event) {
  const enabled = event.target.checked
  await saveAutoSaveImageState(enabled)
  
  // 通知所有标签页的 content script
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "AUTO_SAVE_IMAGE_TOGGLE",
            enabled: enabled
          })
        } catch (e) {
          // 忽略无法发送的标签页
        }
      }
    }
  } catch (error) {
    console.error("通知content script失败:", error)
  }
}

async function onBase64UploadChange(event) {
  const enabled = event.target.checked
  await saveBase64UploadState(enabled)
  
  // 通知所有标签页的 content script
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "BASE64_UPLOAD_TOGGLE",
            enabled: enabled
          })
        } catch (e) {
          // 忽略无法发送的标签页
        }
      }
    }
  } catch (error) {
    console.error("通知content script失败:", error)
  }
}

async function onVerticalTextChange(event) {
  const enabled = event.target.checked
  await saveVerticalTextState(enabled)
  
  // 通知所有标签页的 content script
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "VERTICAL_TEXT_TOGGLE",
            enabled: enabled
          })
        } catch (e) {
          // 忽略无法发送的标签页
        }
      }
    }
  } catch (error) {
    console.error("通知content script失败:", error)
  }
}

async function onAiLinebreakChange(event) {
  const enabled = event.target.checked
  await saveAiLinebreakState(enabled)

  // 通知所有标签页的 content script
  try {
    const tabs = await chrome.tabs.query({})
    for (const tab of tabs) {
      if (tab.id) {
        try {
          await chrome.tabs.sendMessage(tab.id, {
            type: "AI_LINEBREAK_TOGGLE",
            enabled: enabled
          })
        } catch (e) {
          // 忽略无法发送的标签页
        }
      }
    }
  } catch (error) {
    console.error("通知content script失败:", error)
  }
}

// ========== 翻译配置管理 ==========

function setTranslateConfigTip(text, type) {
  view.translateConfigTip.textContent = text || ""
  view.translateConfigTip.className = `config-tip ${type ? `is-${type}` : ""}`
}

function renderTranslateModels(models, selectedModel) {
  view.translateModelSelect.innerHTML = ""
  if (!models || models.length === 0) {
    const option = document.createElement("option")
    option.value = ""
    option.textContent = "-- 无可用模型 --"
    view.translateModelSelect.appendChild(option)
    return
  }

  models.forEach(modelId => {
    const option = document.createElement("option")
    option.value = modelId
    option.textContent = modelId
    if (modelId === selectedModel) {
      option.selected = true
    }
    view.translateModelSelect.appendChild(option)
  })
}

function updateTranslateBaseUrl() {
  const provider = view.translateProviderSelect.value
  const defaultUrl = DEFAULT_BASE_URLS[provider] || ""
  if (!view.translateBaseUrlInput.value.trim()) {
    view.translateBaseUrlInput.value = defaultUrl
    state.translateConfig.baseUrl = defaultUrl
  }
}

async function onTranslateProviderChange(event) {
  const provider = event.target.value
  state.translateConfig.provider = provider
  updateTranslateBaseUrl()

  // 清空模型列表
  state.translateConfig.models = []
  view.translateModelSelect.innerHTML = '<option value="">-- 点击刷新获取模型 --</option>'
  view.translateCustomModelRow.hidden = true
  setTranslateConfigTip("")

  // 同步旧的 provider-select
  view.providerSelect.value = provider
}

async function onTranslateRefreshModels() {
  const baseUrl = view.translateBaseUrlInput.value.trim()
  const apiKey = view.translateApiKeyInput.value.trim()

  view.translateRefreshModelsBtn.disabled = true
  setTranslateConfigTip("正在获取模型列表...", "")

  try {
    const models = await fetchModels(baseUrl, apiKey)
    state.translateConfig.models = models
    renderTranslateModels(models, state.translateConfig.model)
    setTranslateConfigTip(`获取到 ${models.length} 个模型`, "success")
  } catch (error) {
    console.error("获取翻译模型列表失败:", error)
    setTranslateConfigTip(error.message, "error")
  } finally {
    view.translateRefreshModelsBtn.disabled = false
  }
}

function onTranslateCustomModelToggle() {
  view.translateCustomModelRow.hidden = !view.translateCustomModelRow.hidden
  if (!view.translateCustomModelRow.hidden) {
    view.translateCustomModelInput.focus()
  }
}

function onTranslateCustomModelInput(event) {
  const customModel = event.target.value.trim()
  if (customModel) {
    // 添加自定义模型到下拉框
    const exists = Array.from(view.translateModelSelect.options).some(opt => opt.value === customModel)
    if (!exists) {
      const option = document.createElement("option")
      option.value = customModel
      option.textContent = `${customModel} (自定义)`
      view.translateModelSelect.appendChild(option)
    }
    view.translateModelSelect.value = customModel
    state.translateConfig.model = customModel
  }
}

async function onTranslateConfigSave() {
  const provider = view.translateProviderSelect.value
  const apiKey = view.translateApiKeyInput.value.trim()
  const baseUrl = view.translateBaseUrlInput.value.trim()
  const model = view.translateModelSelect.value

  state.translateConfig.provider = provider
  state.translateConfig.apiKey = apiKey
  state.translateConfig.baseUrl = baseUrl
  state.translateConfig.model = model

  setTranslateConfigTip("保存中...", "")

  try {
    const config = {
      translate_api_type: provider,
    }
    if (apiKey) config[`${provider}_api_key`] = apiKey
    if (baseUrl) config[`${provider}_base_url`] = baseUrl
    if (model) config[`${provider}_model`] = model

    await batchUpdateConf(config)

    // 同步旧的 provider-select
    view.providerSelect.value = provider
    state.current.translate_api_type = provider

    setTranslateConfigTip("保存成功", "success")
  } catch (error) {
    console.error("保存翻译配置失败:", error)
    setTranslateConfigTip(error.message, "error")
  }
}

// ========== OCR/Vision 配置管理 ==========

function setVisionConfigTip(text, type) {
  view.visionConfigTip.textContent = text || ""
  view.visionConfigTip.className = `config-tip ${type ? `is-${type}` : ""}`
}

function renderVisionModels(models, selectedModel) {
  view.visionModelSelect.innerHTML = ""
  if (!models || models.length === 0) {
    const option = document.createElement("option")
    option.value = ""
    option.textContent = "-- 无可用模型 --"
    view.visionModelSelect.appendChild(option)
    return
  }

  models.forEach(modelId => {
    const option = document.createElement("option")
    option.value = modelId
    option.textContent = modelId
    if (modelId === selectedModel) {
      option.selected = true
    }
    view.visionModelSelect.appendChild(option)
  })
}

function updateVisionConfigVisibility() {
  const engine = view.ocrEngineSelect.value
  view.visionConfigSection.hidden = engine !== "vision"
  state.ocrConfig.engine = engine
}

function updateVisionBaseUrl() {
  const provider = view.visionProviderSelect.value
  const defaultUrl = DEFAULT_BASE_URLS[provider] || ""
  if (!view.visionBaseUrlInput.value.trim()) {
    view.visionBaseUrlInput.value = defaultUrl
    state.ocrConfig.baseUrl = defaultUrl
  }
}

async function onOcrEngineChange(event) {
  updateVisionConfigVisibility()
  setVisionConfigTip("")
}

async function onVisionProviderChange(event) {
  const provider = event.target.value
  state.ocrConfig.provider = provider
  updateVisionBaseUrl()

  // 清空模型列表
  state.ocrConfig.models = []
  view.visionModelSelect.innerHTML = '<option value="">-- 点击刷新获取模型 --</option>'
  view.visionCustomModelRow.hidden = true
  setVisionConfigTip("")
}

async function onVisionRefreshModels() {
  const baseUrl = view.visionBaseUrlInput.value.trim()
  const apiKey = view.visionApiKeyInput.value.trim()

  view.visionRefreshModelsBtn.disabled = true
  setVisionConfigTip("正在获取模型列表...", "")

  try {
    const models = await fetchModels(baseUrl, apiKey)
    state.ocrConfig.models = models
    renderVisionModels(models, state.ocrConfig.model)
    setVisionConfigTip(`获取到 ${models.length} 个模型`, "success")
  } catch (error) {
    console.error("获取Vision模型列表失败:", error)
    setVisionConfigTip(error.message, "error")
  } finally {
    view.visionRefreshModelsBtn.disabled = false
  }
}

function onVisionCustomModelToggle() {
  view.visionCustomModelRow.hidden = !view.visionCustomModelRow.hidden
  if (!view.visionCustomModelRow.hidden) {
    view.visionCustomModelInput.focus()
  }
}

function onVisionCustomModelInput(event) {
  const customModel = event.target.value.trim()
  if (customModel) {
    const exists = Array.from(view.visionModelSelect.options).some(opt => opt.value === customModel)
    if (!exists) {
      const option = document.createElement("option")
      option.value = customModel
      option.textContent = `${customModel} (自定义)`
      view.visionModelSelect.appendChild(option)
    }
    view.visionModelSelect.value = customModel
    state.ocrConfig.model = customModel
  }
}

async function onVisionConfigSave() {
  const engine = view.ocrEngineSelect.value
  const provider = view.visionProviderSelect.value
  const apiKey = view.visionApiKeyInput.value.trim()
  const baseUrl = view.visionBaseUrlInput.value.trim()
  const model = view.visionModelSelect.value

  state.ocrConfig.engine = engine
  state.ocrConfig.provider = provider
  state.ocrConfig.apiKey = apiKey
  state.ocrConfig.baseUrl = baseUrl
  state.ocrConfig.model = model

  setVisionConfigTip("保存中...", "")

  try {
    const config = {
      ocr_engine: engine,
    }

    if (engine === "vision") {
      config.vision_ocr_provider = provider
      if (apiKey) config[`vision_${provider}_api_key`] = apiKey
      if (baseUrl) config[`vision_${provider}_base_url`] = baseUrl
      if (model) config[`vision_${provider}_model`] = model
    }

    await batchUpdateConf(config)
    setVisionConfigTip("保存成功", "success")
  } catch (error) {
    console.error("保存Vision配置失败:", error)
    setVisionConfigTip(error.message, "error")
  }
}

// 加载配置到 UI
function loadConfigToUI(conf) {
  // 翻译配置
  const translateProvider = conf.translate_api_type || "openai"
  view.translateProviderSelect.value = translateProvider
  view.translateApiKeyInput.value = conf[`${translateProvider}_api_key`] || ""
  view.translateBaseUrlInput.value = conf[`${translateProvider}_base_url`] || DEFAULT_BASE_URLS[translateProvider] || ""
  view.translateModelSelect.innerHTML = '<option value="">-- 点击刷新获取模型 --</option>'

  const translateModel = conf[`${translateProvider}_model`] || ""
  if (translateModel) {
    const option = document.createElement("option")
    option.value = translateModel
    option.textContent = translateModel
    view.translateModelSelect.appendChild(option)
    view.translateModelSelect.value = translateModel
  }

  state.translateConfig = {
    provider: translateProvider,
    apiKey: conf[`${translateProvider}_api_key`] || "",
    baseUrl: conf[`${translateProvider}_base_url`] || "",
    model: translateModel,
    models: [],
  }

  // OCR 配置
  const ocrEngine = conf.ocr_engine || "local"
  view.ocrEngineSelect.value = ocrEngine
  updateVisionConfigVisibility()

  if (ocrEngine === "vision") {
    const visionProvider = conf.vision_ocr_provider || "openai"
    view.visionProviderSelect.value = visionProvider
    view.visionApiKeyInput.value = conf[`vision_${visionProvider}_api_key`] || ""
    view.visionBaseUrlInput.value = conf[`vision_${visionProvider}_base_url`] || DEFAULT_BASE_URLS[visionProvider] || ""
    view.visionModelSelect.innerHTML = '<option value="">-- 点击刷新获取模型 --</option>'

    const visionModel = conf[`vision_${visionProvider}_model`] || ""
    if (visionModel) {
      const option = document.createElement("option")
      option.value = visionModel
      option.textContent = visionModel
      view.visionModelSelect.appendChild(option)
      view.visionModelSelect.value = visionModel
    }

    state.ocrConfig = {
      engine: ocrEngine,
      provider: visionProvider,
      apiKey: conf[`vision_${visionProvider}_api_key`] || "",
      baseUrl: conf[`vision_${visionProvider}_base_url`] || "",
      model: visionModel,
      models: [],
    }
  } else {
    state.ocrConfig = {
      engine: ocrEngine,
      provider: "openai",
      apiKey: "",
      baseUrl: "",
      model: "",
      models: [],
    }
  }
}

// 密码可见性切换
function onToggleVisibility(event) {
  const btn = event.target
  const targetId = btn.dataset.target
  if (!targetId) return

  const input = document.getElementById(targetId)
  if (!input) return

  if (input.type === "password") {
    input.type = "text"
    btn.textContent = "🔒"
  } else {
    input.type = "password"
    btn.textContent = "👁"
  }
}

// ========== 配置本地缓存 ==========

// 保存翻译配置到本地
function saveTranslateConfigCache() {
  try {
    const config = {
      provider: view.translateProviderSelect.value,
      apiKey: view.translateApiKeyInput.value.trim(),
      baseUrl: view.translateBaseUrlInput.value.trim(),
      model: view.translateModelSelect.value,
    }
    localStorage.setItem(TRANSLATE_CONFIG_CACHE_KEY, JSON.stringify(config))
  } catch (e) {
    console.error("缓存翻译配置失败:", e)
  }
}

// 恢复翻译配置
function restoreTranslateConfigCache() {
  try {
    const raw = localStorage.getItem(TRANSLATE_CONFIG_CACHE_KEY)
    if (!raw) return false
    const config = JSON.parse(raw)

    if (config.provider) {
      view.translateProviderSelect.value = config.provider
    }
    if (config.apiKey) {
      view.translateApiKeyInput.value = config.apiKey
    }
    if (config.baseUrl) {
      view.translateBaseUrlInput.value = config.baseUrl
    }
    if (config.model) {
      // 添加模型选项
      const exists = Array.from(view.translateModelSelect.options).some(opt => opt.value === config.model)
      if (!exists) {
        const option = document.createElement("option")
        option.value = config.model
        option.textContent = config.model
        view.translateModelSelect.appendChild(option)
      }
      view.translateModelSelect.value = config.model
    }

    // 更新状态
    state.translateConfig.provider = config.provider || "openai"
    state.translateConfig.apiKey = config.apiKey || ""
    state.translateConfig.baseUrl = config.baseUrl || ""
    state.translateConfig.model = config.model || ""

    return true
  } catch (e) {
    console.error("恢复翻译配置缓存失败:", e)
    return false
  }
}

// 保存 OCR 配置到本地
function saveOcrConfigCache() {
  try {
    const config = {
      engine: view.ocrEngineSelect.value,
      provider: view.visionProviderSelect.value,
      apiKey: view.visionApiKeyInput.value.trim(),
      baseUrl: view.visionBaseUrlInput.value.trim(),
      model: view.visionModelSelect.value,
    }
    localStorage.setItem(OCR_CONFIG_CACHE_KEY, JSON.stringify(config))
  } catch (e) {
    console.error("缓存 OCR 配置失败:", e)
  }
}

// 恢复 OCR 配置
function restoreOcrConfigCache() {
  try {
    const raw = localStorage.getItem(OCR_CONFIG_CACHE_KEY)
    if (!raw) return false
    const config = JSON.parse(raw)

    if (config.engine) {
      view.ocrEngineSelect.value = config.engine
      updateVisionConfigVisibility()
    }
    if (config.provider) {
      view.visionProviderSelect.value = config.provider
    }
    if (config.apiKey) {
      view.visionApiKeyInput.value = config.apiKey
    }
    if (config.baseUrl) {
      view.visionBaseUrlInput.value = config.baseUrl
    }
    if (config.model) {
      const exists = Array.from(view.visionModelSelect.options).some(opt => opt.value === config.model)
      if (!exists) {
        const option = document.createElement("option")
        option.value = config.model
        option.textContent = config.model
        view.visionModelSelect.appendChild(option)
      }
      view.visionModelSelect.value = config.model
    }

    // 更新状态
    state.ocrConfig.engine = config.engine || "local"
    state.ocrConfig.provider = config.provider || "openai"
    state.ocrConfig.apiKey = config.apiKey || ""
    state.ocrConfig.baseUrl = config.baseUrl || ""
    state.ocrConfig.model = config.model || ""

    return true
  } catch (e) {
    console.error("恢复 OCR 配置缓存失败:", e)
    return false
  }
}

function popupRatio() {
  const width = Math.max(1, Math.round(window.innerWidth))
  const height = Math.max(1, Math.round(window.innerHeight))
  return width / height
}

function computeCropViewportSize(ratio) {
  const maxWidth = Math.max(160, Math.min(window.innerWidth - 44, 360))
  const maxHeight = Math.max(160, Math.min(window.innerHeight - 210, 420))

  let width = maxWidth
  let height = width / ratio
  if (height > maxHeight) {
    height = maxHeight
    width = height * ratio
  }

  return {
    width: Math.max(1, Math.round(width)),
    height: Math.max(1, Math.round(height)),
  }
}

function syncCropZoomInput() {
  const crop = state.cropper
  const range = crop.maxScale - crop.minScale
  if (range <= 0) {
    view.cropperZoom.value = "0"
    return
  }
  const progress = clamp((crop.scale - crop.minScale) / range, 0, 1)
  view.cropperZoom.value = String(Math.round(progress * CROP_ZOOM_STEPS))
}

function clampCropOffset() {
  const crop = state.cropper
  if (!crop.image) return

  const scaledWidth = crop.image.naturalWidth * crop.scale
  const scaledHeight = crop.image.naturalHeight * crop.scale

  const minX = Math.min(0, crop.viewportWidth - scaledWidth)
  const minY = Math.min(0, crop.viewportHeight - scaledHeight)
  crop.offsetX = clamp(crop.offsetX, minX, 0)
  crop.offsetY = clamp(crop.offsetY, minY, 0)
}

function renderCropCanvas() {
  const crop = state.cropper
  if (!crop.isOpen || !crop.image) return

  const canvas = view.cropperCanvas
  const context = canvas.getContext("2d")
  if (!context) return

  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(crop.viewportWidth * dpr))
  canvas.height = Math.max(1, Math.round(crop.viewportHeight * dpr))
  canvas.style.width = `${crop.viewportWidth}px`
  canvas.style.height = `${crop.viewportHeight}px`

  context.setTransform(dpr, 0, 0, dpr, 0, 0)
  context.clearRect(0, 0, crop.viewportWidth, crop.viewportHeight)
  context.drawImage(
    crop.image,
    crop.offsetX,
    crop.offsetY,
    crop.image.naturalWidth * crop.scale,
    crop.image.naturalHeight * crop.scale,
  )
}

function setCropScale(nextScale, anchorX, anchorY) {
  const crop = state.cropper
  if (!crop.isOpen || !crop.image) return

  const targetScale = clamp(nextScale, crop.minScale, crop.maxScale)
  const oldScale = crop.scale
  if (!Number.isFinite(targetScale) || targetScale <= 0 || !Number.isFinite(oldScale) || oldScale <= 0) {
    return
  }

  const focusX = typeof anchorX === "number" ? anchorX : crop.viewportWidth / 2
  const focusY = typeof anchorY === "number" ? anchorY : crop.viewportHeight / 2

  const imageX = (focusX - crop.offsetX) / oldScale
  const imageY = (focusY - crop.offsetY) / oldScale

  crop.scale = targetScale
  crop.offsetX = focusX - imageX * crop.scale
  crop.offsetY = focusY - imageY * crop.scale
  clampCropOffset()
  renderCropCanvas()
  syncCropZoomInput()
}

function resetCropperState() {
  const crop = state.cropper
  crop.isOpen = false
  crop.image = null
  crop.objectUrl = ""
  crop.ratio = 1
  crop.viewportWidth = 0
  crop.viewportHeight = 0
  crop.minScale = 1
  crop.maxScale = 1
  crop.scale = 1
  crop.offsetX = 0
  crop.offsetY = 0
  crop.dragging = false
  crop.dragPointerId = null
  crop.startX = 0
  crop.startY = 0
  crop.baseOffsetX = 0
  crop.baseOffsetY = 0
  crop.resolve = null
  crop.reject = null
}

function closeCropperUI() {
  view.cropperOverlay.hidden = true
  view.cropperViewport.classList.remove("is-dragging")
  document.body.classList.remove("is-cropping-bg")
  const context = view.cropperCanvas.getContext("2d")
  if (context) {
    context.clearRect(0, 0, view.cropperCanvas.width, view.cropperCanvas.height)
  }
}

function finalizeCropper(result, error) {
  const crop = state.cropper
  const resolve = crop.resolve
  const reject = crop.reject
  const objectUrl = crop.objectUrl

  closeCropperUI()
  resetCropperState()

  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
  }

  if (error) {
    if (typeof reject === "function") {
      reject(error)
    }
    return
  }

  if (typeof resolve === "function") {
    resolve(result)
  }
}

function loadImageFromObjectUrl(objectUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("图片读取失败，请重试。"))
    image.src = objectUrl
  })
}

async function openCropperWithFile(file) {
  if (state.cropper.isOpen) {
    throw new Error("已有进行中的裁剪，请先完成。")
  }

  const objectUrl = URL.createObjectURL(file)
  let image = null
  try {
    image = await loadImageFromObjectUrl(objectUrl)
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }

  const popupWidth = Math.max(1, Math.round(window.innerWidth))
  const popupHeight = Math.max(1, Math.round(window.innerHeight))

  const crop = state.cropper
  crop.isOpen = true
  crop.image = image
  crop.objectUrl = objectUrl
  crop.ratio = popupRatio()

  const viewport = computeCropViewportSize(crop.ratio)
  crop.viewportWidth = viewport.width
  crop.viewportHeight = viewport.height

  crop.minScale = Math.max(
    crop.viewportWidth / image.naturalWidth,
    crop.viewportHeight / image.naturalHeight,
  )
  crop.maxScale = Math.max(crop.minScale * 4, crop.minScale + 0.25)
  crop.scale = crop.minScale
  crop.offsetX = (crop.viewportWidth - image.naturalWidth * crop.scale) / 2
  crop.offsetY = (crop.viewportHeight - image.naturalHeight * crop.scale) / 2
  clampCropOffset()

  view.cropperViewport.style.width = `${crop.viewportWidth}px`
  view.cropperViewport.style.height = `${crop.viewportHeight}px`
  view.cropperDesc.textContent =
    `拖动选择区域，比例固定为 ${popupWidth}:${popupHeight}（与当前 popup 大小一致）`
  view.cropperOverlay.hidden = false
  document.body.classList.add("is-cropping-bg")
  renderCropCanvas()
  syncCropZoomInput()

  return new Promise((resolve, reject) => {
    crop.resolve = resolve
    crop.reject = reject
  })
}

function exportCroppedBackground() {
  const crop = state.cropper
  if (!crop.image) {
    throw new Error("裁剪数据无效，请重新上传。")
  }

  clampCropOffset()

  const sw = crop.viewportWidth / crop.scale
  const sh = crop.viewportHeight / crop.scale
  const sxRaw = -crop.offsetX / crop.scale
  const syRaw = -crop.offsetY / crop.scale

  const sx = clamp(sxRaw, 0, Math.max(0, crop.image.naturalWidth - sw))
  const sy = clamp(syRaw, 0, Math.max(0, crop.image.naturalHeight - sh))

  const outputSize = fitBackgroundExportSize(sw, sh)
  const outputWidth = outputSize.width
  const outputHeight = outputSize.height
  const canvas = document.createElement("canvas")
  canvas.width = outputWidth
  canvas.height = outputHeight

  const context = canvas.getContext("2d")
  if (!context) {
    throw new Error("裁剪失败，请重试。")
  }

  context.drawImage(crop.image, sx, sy, sw, sh, 0, 0, outputWidth, outputHeight)
  return canvas.toDataURL("image/png")
}

function cancelCropper() {
  if (!state.cropper.isOpen) return
  finalizeCropper(null, null)
}

function confirmCropper() {
  if (!state.cropper.isOpen) return
  try {
    const dataUrl = exportCroppedBackground()
    finalizeCropper(dataUrl, null)
  } catch (error) {
    finalizeCropper(null, error instanceof Error ? error : new Error("裁剪失败，请重试。"))
  }
}

function onCropPointerDown(event) {
  const crop = state.cropper
  if (!crop.isOpen) return

  event.preventDefault()
  crop.dragging = true
  crop.dragPointerId = event.pointerId
  crop.startX = event.clientX
  crop.startY = event.clientY
  crop.baseOffsetX = crop.offsetX
  crop.baseOffsetY = crop.offsetY
  view.cropperViewport.classList.add("is-dragging")
  view.cropperViewport.setPointerCapture(event.pointerId)
}

function onCropPointerMove(event) {
  const crop = state.cropper
  if (!crop.isOpen || !crop.dragging || crop.dragPointerId !== event.pointerId) return

  event.preventDefault()
  crop.offsetX = crop.baseOffsetX + (event.clientX - crop.startX)
  crop.offsetY = crop.baseOffsetY + (event.clientY - crop.startY)
  clampCropOffset()
  renderCropCanvas()
}

function onCropPointerEnd(event) {
  const crop = state.cropper
  if (!crop.dragging) return
  if (crop.dragPointerId !== event.pointerId) return

  crop.dragging = false
  crop.dragPointerId = null
  view.cropperViewport.classList.remove("is-dragging")
  if (view.cropperViewport.hasPointerCapture(event.pointerId)) {
    view.cropperViewport.releasePointerCapture(event.pointerId)
  }
}

function onCropZoomInput(event) {
  const crop = state.cropper
  if (!crop.isOpen) return

  const value = Number(event.target.value)
  const ratio = clamp(Number.isFinite(value) ? value / CROP_ZOOM_STEPS : 0, 0, 1)
  const nextScale = crop.minScale + (crop.maxScale - crop.minScale) * ratio
  setCropScale(nextScale)
}

function onCropWheel(event) {
  const crop = state.cropper
  if (!crop.isOpen) return

  event.preventDefault()
  const delta = event.deltaY < 0 ? 1 : -1
  const step = Math.max((crop.maxScale - crop.minScale) / 24, crop.minScale * 0.04)
  const rect = view.cropperViewport.getBoundingClientRect()
  const anchorX = clamp(event.clientX - rect.left, 0, crop.viewportWidth)
  const anchorY = clamp(event.clientY - rect.top, 0, crop.viewportHeight)
  setCropScale(crop.scale + delta * step, anchorX, anchorY)
}

function onCropKeyDown(event) {
  if (!state.cropper.isOpen) return
  if (event.key !== "Escape") return
  event.preventDefault()
  cancelCropper()
}

async function onBackgroundFileChange(event) {
  const file = event.target?.files?.[0]
  if (!file) return

  if (!file.type.startsWith("image/")) {
    setBackgroundTip("请选择图片文件。", true)
    event.target.value = ""
    return
  }

  try {
    const croppedDataUrl = await openCropperWithFile(file)
    if (!croppedDataUrl) {
      setBackgroundTip("已取消背景更新。", false)
      return
    }
    const applied = applyBackground(croppedDataUrl)
    if (!applied) {
      throw new Error("背景应用失败，请重试。")
    }
    if (!persistBackground(croppedDataUrl)) {
      setBackgroundTip(`背景已应用：${file.name}（未保存，图片可能过大）`, true)
      return
    }
    setBackgroundTip(`背景已更新：${file.name}`, false)
  } catch (error) {
    console.error("背景设置失败:", error)
    setBackgroundTip(error.message || "背景设置失败。", true)
  } finally {
    event.target.value = ""
  }
}

function onBackgroundClear() {
  if (!persistBackground("")) {
    setBackgroundTip("清除背景失败，请重试。", true)
    return
  }
  applyBackground("")
  setBackgroundTip("背景已清除。", false)
}

function setLoading(loading, loadingText) {
  view.providerSelect.disabled = loading
  view.modeSelect.disabled = loading
  view.reloadButton.disabled = loading
  view.reloadButton.textContent = loading ? loadingText : "重新拉取配置"
}

function errorMessage(response, payload) {
  if (payload && typeof payload === "object") {
    const raw = payload.detail || payload.info || payload.message || payload.error
    if (typeof raw === "string" && raw.trim()) return raw.trim()
  }
  if (typeof payload === "string" && payload.trim()) {
    return payload.trim()
  }
  return `请求失败 (${response.status})`
}

async function requestJSON(path, options) {
  const headers = {
    "ngrok-skip-browser-warning": "true",
    ...(options?.headers || {}),
  }
  // Remove trailing slash from API_BASE to avoid double slashes
  const baseUrl = API_BASE.replace(/\/+$/, "")
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers })
  let payload = null
  try {
    payload = await response.json()
  } catch (error) {
    payload = null
  }
  if (!response.ok) {
    throw new Error(errorMessage(response, payload))
  }
  return payload || {}
}

async function fetchOptions() {
  return requestJSON("/conf/options", { method: "GET" })
}

async function queryConf() {
  return requestJSON("/conf/query", { method: "GET" })
}

async function batchUpdateConf(config) {
  return requestJSON("/conf/batch-update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(config),
  })
}

// 获取模型列表（调用 OpenAI 兼容 API）
async function fetchModels(baseUrl, apiKey) {
  if (!baseUrl || !apiKey) {
    throw new Error("请先填写 Base URL 和 API Key")
  }

  // 确保 URL 不以 / 结尾
  const cleanUrl = baseUrl.replace(/\/+$/, "")
  const modelsUrl = `${cleanUrl}/models`

  const response = await fetch(modelsUrl, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
    },
  })

  if (!response.ok) {
    let errorMsg = `获取模型列表失败 (${response.status})`
    try {
      const errorData = await response.json()
      errorMsg = errorData.error?.message || errorMsg
    } catch (e) {
      // 忽略解析错误
    }
    throw new Error(errorMsg)
  }

  const data = await response.json()
  if (!data.data || !Array.isArray(data.data)) {
    throw new Error("模型列表格式错误")
  }

  // 过滤并排序模型
  const models = data.data
    .filter(m => m.id && typeof m.id === "string")
    .map(m => m.id)
    .sort((a, b) => a.localeCompare(b))

  return models
}

async function updateConf(attr, value) {
  return requestJSON("/conf/update", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      attr: attr,
      v: value,
    }),
  })
}

function cleanValues(values) {
  if (!Array.isArray(values)) return []
  return values.filter((item) => typeof item === "string" && item.trim().length > 0)
}

function normalizeOptions(payload) {
  const providerOptions = cleanValues(payload?.translate_api_type)
  const modeOptions = cleanValues(payload?.translate_mode)
  return {
    translate_api_type: providerOptions.length > 0 ? providerOptions : [...DEFAULT_OPTIONS.translate_api_type],
    translate_mode: modeOptions.length > 0 ? modeOptions : [...DEFAULT_OPTIONS.translate_mode],
  }
}

function renderSelect(select, values, labeler) {
  select.innerHTML = ""
  values.forEach((value) => {
    const option = document.createElement("option")
    option.value = value
    option.textContent = labeler(value)
    select.appendChild(option)
  })
}

function ensureOption(select, value, text) {
  if (typeof value !== "string" || !value) return
  const exists = Array.from(select.options).some((option) => option.value === value)
  if (exists) return
  const option = document.createElement("option")
  option.value = value
  option.textContent = `${text}（后端）`
  select.appendChild(option)
}

function renderCurrent() {
  view.currentEngine.textContent = providerLabel(state.current.translate_api_type)
  view.currentMode.textContent = modeLabel(state.current.translate_mode)
  view.modeTip.textContent = modeTip(state.current.translate_mode)
}

function applyConfig(conf) {
  const nextProvider = typeof conf?.translate_api_type === "string" ? conf.translate_api_type : "openai"
  const nextMode = typeof conf?.translate_mode === "string" ? conf.translate_mode : "parallel"

  state.current.translate_api_type = nextProvider
  state.current.translate_mode = nextMode

  ensureOption(view.providerSelect, nextProvider, providerLabel(nextProvider))
  ensureOption(view.modeSelect, nextMode, modeLabel(nextMode))

  view.providerSelect.value = nextProvider
  view.modeSelect.value = nextMode
  renderCurrent()
  persistCurrentConfig()
}

async function syncConfig() {
  setLoading(true, "同步中...")
  setStatus("同步中", "is-loading")
  setError("")
  try {
    state.options = normalizeOptions(await fetchOptions())

    state.hydrating = true
    renderSelect(view.providerSelect, state.options.translate_api_type, providerLabel)
    renderSelect(view.modeSelect, state.options.translate_mode, modeLabel)
    const conf = await queryConf()
    applyConfig(conf)
    loadConfigToUI(conf)
    state.hydrating = false

    // 加载后端配置后，尝试用本地缓存覆盖（优先使用用户之前输入的内容）
    restoreTranslateConfigCache()
    restoreOcrConfigCache()

    view.lastSync.textContent = now()
    setStatus("已同步", "is-ok")
  } catch (error) {
    state.hydrating = false
    console.error("配置同步失败:", error)
    setStatus("同步失败", "is-error")
    setError(error.message)
  } finally {
    setLoading(false, "")
  }
}

function withStructuredSuggestion(message) {
  const text = typeof message === "string" ? message : "更新失败"
  if (/structured|格式|数量|列表|list/i.test(text)) {
    return `${text}。请重试或切换并行模式。`
  }
  return text
}

async function onConfigChange(attr, value) {
  if (state.hydrating) return

  const oldValue = state.current[attr]
  if (oldValue === value) return

  setLoading(true, "保存中...")
  setStatus("保存中", "is-loading")
  setError("")

  try {
    await updateConf(attr, value)
    state.current[attr] = value
    renderCurrent()
    persistCurrentConfig()
    view.lastSync.textContent = now()
    setStatus("保存成功", "is-ok")
    
    // 如果是翻译模式变更，通知所有 content scripts
    if (attr === "translate_mode") {
      try {
        const tabs = await chrome.tabs.query({})
        for (const tab of tabs) {
          if (tab.id) {
            try {
              await chrome.tabs.sendMessage(tab.id, {
                type: "TRANSLATE_MODE_UPDATED",
                mode: value
              })
            } catch (e) {
              // 忽略无法发送的标签页
            }
          }
        }
      } catch (e) {
        console.error("通知翻译模式变更失败:", e)
      }
    }
  } catch (error) {
    console.error("配置更新失败:", error)
    if (attr === "translate_api_type") {
      view.providerSelect.value = oldValue
    } else if (attr === "translate_mode") {
      view.modeSelect.value = oldValue
    }
    renderCurrent()
    setStatus("保存失败", "is-error")
    setError(attr === "translate_mode" ? withStructuredSuggestion(error.message) : error.message)
  } finally {
    setLoading(false, "")
  }
}

function bindEvents() {
  view.providerSelect.addEventListener("change", async (event) => {
    await onConfigChange("translate_api_type", event.target.value)
  })
  view.modeSelect.addEventListener("change", async (event) => {
    await onConfigChange("translate_mode", event.target.value)
  })
  view.reloadButton.addEventListener("click", async () => {
    await syncConfig()
  })
  view.saveApiButton.addEventListener("click", saveApiBase)
  view.apiBaseInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      saveApiBase()
    }
  })
  view.bgFileInput.addEventListener("change", onBackgroundFileChange)
  view.clearBgButton.addEventListener("click", onBackgroundClear)
  view.cropperCancel.addEventListener("click", cancelCropper)
  view.cropperConfirm.addEventListener("click", confirmCropper)
  view.cropperZoom.addEventListener("input", onCropZoomInput)
  view.cropperViewport.addEventListener("pointerdown", onCropPointerDown)
  view.cropperViewport.addEventListener("pointermove", onCropPointerMove)
  view.cropperViewport.addEventListener("pointerup", onCropPointerEnd)
  view.cropperViewport.addEventListener("pointercancel", onCropPointerEnd)
  view.cropperViewport.addEventListener("wheel", onCropWheel, { passive: false })
  window.addEventListener("keydown", onCropKeyDown)
  view.autoTranslateToggle.addEventListener("change", onAutoTranslateChange)
  view.autoSaveImageToggle.addEventListener("change", onAutoSaveImageChange)
  view.base64UploadToggle.addEventListener("change", onBase64UploadChange)
  view.verticalTextToggle.addEventListener("change", onVerticalTextChange)
  view.aiLinebreakToggle.addEventListener("change", onAiLinebreakChange)

  // 翻译配置事件
  view.translateProviderSelect.addEventListener("change", () => {
    onTranslateProviderChange()
    saveTranslateConfigCache()
  })
  view.translateRefreshModelsBtn.addEventListener("click", onTranslateRefreshModels)
  view.translateCustomModelBtn.addEventListener("click", onTranslateCustomModelToggle)
  view.translateCustomModelInput.addEventListener("input", (event) => {
    onTranslateCustomModelInput(event)
    saveTranslateConfigCache()
  })
  view.translateApiKeyInput.addEventListener("input", () => {
    state.translateConfig.apiKey = view.translateApiKeyInput.value.trim()
    saveTranslateConfigCache()
  })
  view.translateBaseUrlInput.addEventListener("input", () => {
    state.translateConfig.baseUrl = view.translateBaseUrlInput.value.trim()
    saveTranslateConfigCache()
  })
  view.translateModelSelect.addEventListener("change", (event) => {
    state.translateConfig.model = event.target.value
    saveTranslateConfigCache()
  })
  view.saveTranslateConfigBtn.addEventListener("click", onTranslateConfigSave)

  // OCR/Vision 配置事件
  view.ocrEngineSelect.addEventListener("change", () => {
    onOcrEngineChange()
    saveOcrConfigCache()
  })
  view.visionProviderSelect.addEventListener("change", () => {
    onVisionProviderChange()
    saveOcrConfigCache()
  })
  view.visionRefreshModelsBtn.addEventListener("click", onVisionRefreshModels)
  view.visionCustomModelBtn.addEventListener("click", onVisionCustomModelToggle)
  view.visionCustomModelInput.addEventListener("input", (event) => {
    onVisionCustomModelInput(event)
    saveOcrConfigCache()
  })
  view.visionApiKeyInput.addEventListener("input", () => {
    state.ocrConfig.apiKey = view.visionApiKeyInput.value.trim()
    saveOcrConfigCache()
  })
  view.visionBaseUrlInput.addEventListener("input", () => {
    state.ocrConfig.baseUrl = view.visionBaseUrlInput.value.trim()
    saveOcrConfigCache()
  })
  view.visionModelSelect.addEventListener("change", (event) => {
    state.ocrConfig.model = event.target.value
    saveOcrConfigCache()
  })
  view.saveVisionConfigBtn.addEventListener("click", onVisionConfigSave)

  // 密码可见性切换
  document.querySelectorAll(".toggle-visibility-btn").forEach(btn => {
    btn.addEventListener("click", onToggleVisibility)
  })
}

async function init() {
  view.providerSelect = document.getElementById("provider-select")
  view.modeSelect = document.getElementById("mode-select")
  view.currentEngine = document.getElementById("current-engine")
  view.currentMode = document.getElementById("current-mode")
  view.modeTip = document.getElementById("mode-tip")
  view.errorTip = document.getElementById("error-tip")
  view.syncStatus = document.getElementById("sync-status")
  view.lastSync = document.getElementById("last-sync")
  view.reloadButton = document.getElementById("reload-conf-button")
  view.bgFileInput = document.getElementById("bg-file-input")
  view.clearBgButton = document.getElementById("clear-bg-button")
  view.bgTip = document.getElementById("bg-tip")
  view.cropperOverlay = document.getElementById("bg-cropper-overlay")
  view.cropperDesc = document.getElementById("bg-cropper-desc")
  view.cropperViewport = document.getElementById("bg-cropper-viewport")
  view.cropperCanvas = document.getElementById("bg-cropper-canvas")
  view.cropperZoom = document.getElementById("bg-cropper-zoom")
  view.cropperCancel = document.getElementById("bg-cropper-cancel")
  view.cropperConfirm = document.getElementById("bg-cropper-confirm")
  view.autoTranslateToggle = document.getElementById("auto-translate-toggle")
  view.autoSaveImageToggle = document.getElementById("auto-save-image-toggle")
  view.base64UploadToggle = document.getElementById("base64-upload-toggle")
  view.verticalTextToggle = document.getElementById("vertical-text-toggle")
  view.aiLinebreakToggle = document.getElementById("ai-linebreak-toggle")
  view.apiBaseInput = document.getElementById("api-base-input")
  view.saveApiButton = document.getElementById("save-api-button")
  view.apiTip = document.getElementById("api-tip")

  // 翻译配置元素
  view.translateProviderSelect = document.getElementById("translate-provider-select")
  view.translateApiKeyInput = document.getElementById("translate-api-key-input")
  view.translateBaseUrlInput = document.getElementById("translate-base-url-input")
  view.translateModelSelect = document.getElementById("translate-model-select")
  view.translateRefreshModelsBtn = document.getElementById("translate-refresh-models-btn")
  view.translateCustomModelBtn = document.getElementById("translate-custom-model-btn")
  view.translateCustomModelRow = document.getElementById("translate-custom-model-row")
  view.translateCustomModelInput = document.getElementById("translate-custom-model-input")
  view.translateConfigTip = document.getElementById("translate-config-tip")
  view.saveTranslateConfigBtn = document.getElementById("save-translate-config-btn")

  // OCR/Vision 配置元素
  view.ocrEngineSelect = document.getElementById("ocr-engine-select")
  view.visionConfigSection = document.getElementById("vision-config-section")
  view.visionProviderSelect = document.getElementById("vision-provider-select")
  view.visionApiKeyInput = document.getElementById("vision-api-key-input")
  view.visionBaseUrlInput = document.getElementById("vision-base-url-input")
  view.visionModelSelect = document.getElementById("vision-model-select")
  view.visionRefreshModelsBtn = document.getElementById("vision-refresh-models-btn")
  view.visionCustomModelBtn = document.getElementById("vision-custom-model-btn")
  view.visionCustomModelRow = document.getElementById("vision-custom-model-row")
  view.visionCustomModelInput = document.getElementById("vision-custom-model-input")
  view.visionConfigTip = document.getElementById("vision-config-tip")
  view.saveVisionConfigBtn = document.getElementById("save-vision-config-btn")

  resetCropperState()
  hydrateCachedConfig()

  state.hydrating = true
  renderSelect(view.providerSelect, state.options.translate_api_type, providerLabel)
  renderSelect(view.modeSelect, state.options.translate_mode, modeLabel)
  applyConfig(state.current)
  state.hydrating = false
  loadBackground()
  loadAutoTranslateState()
  loadAutoSaveImageState()
  loadBase64UploadState()
  loadVerticalTextState()
  loadAiLinebreakState()
  await loadApiBase()

  bindEvents()

  // 恢复本地缓存的配置
  restoreTranslateConfigCache()
  restoreOcrConfigCache()

  await syncConfig()
}

init()
