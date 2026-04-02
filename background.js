// Background script for handling cross-origin image fetching

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_IMAGE") {
    fetchImageAsBase64(message.url)
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error.message }))
    return true // Keep the message channel open for async response
  }
})

async function fetchImageAsBase64(url) {
  try {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
    })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`)
    }
    const blob = await response.blob()
    
    // Convert to PNG format using createImageBitmap (works in service worker)
    const imageBitmap = await createImageBitmap(blob)
    const canvas = new OffscreenCanvas(imageBitmap.width, imageBitmap.height)
    const ctx = canvas.getContext("2d")
    ctx.drawImage(imageBitmap, 0, 0)
    
    const pngBlob = await canvas.convertToBlob({ type: "image/png" })
    
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve({ base64: reader.result })
      reader.onerror = () => reject(new Error("Failed to read PNG blob"))
      reader.readAsDataURL(pngBlob)
    })
  } catch (error) {
    throw error
  }
}
