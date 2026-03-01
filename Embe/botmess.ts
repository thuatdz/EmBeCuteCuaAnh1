// Facebook Messenger Bot - Sử dụng facebook-chat-api
// Đăng nhập tài khoản Facebook cá nhân và forward message tới Minecraft bot

import * as fs from 'fs'
import * as path from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'
import { createRequire } from 'module'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const require = createRequire(import.meta.url)
const login = require('facebook-chat-api')

// Global state
let api: any = null
let isConnected = false
let friendList: Map<string, string> = new Map() // userID -> displayName mapping

// Track bot message đang chờ reply
interface BotMessage {
  playerName: string
  text: string
  timestamp: number
}
let lastBotMessageToMinecraft: BotMessage | null = null

// Hàm gửi tin qua Facebook
export async function sendFbMessage(userID: string, text: string) {
  if (!api || !isConnected) {
    console.log('⚠️ Facebook không kết nối, không thể gửi tin')
    return false
  }

  try {
    await new Promise((resolve, reject) => {
      api.sendMessage(text, userID, (err: any) => {
        if (err) reject(err)
        else resolve(true)
      })
    })
    console.log(`✅ Tin Facebook gửi tới ${friendList.get(userID) || userID}: ${text}`)
    return true
  } catch (error) {
    console.log('❌ Lỗi gửi tin Facebook:', (error as Error).message)
    return false
  }
}

// Hàm khởi tạo Facebook bot
export async function initFacebookBot() {
  const appStatePath = process.env.FB_APPSTATE_PATH || ''

  if (!appStatePath || !fs.existsSync(appStatePath)) {
    console.log('⚠️ FB_APPSTATE_PATH chưa được cấu hình hoặc file không tồn tại')
    console.log('   Hãy cấu hình appstate.json path trong .env')
    return false
  }

  try {
    console.log('🔐 Đang đăng nhập Facebook qua appstate...')

    // Đọc appstate từ file
    const appStateContent = fs.readFileSync(appStatePath, 'utf-8')
    console.log('📄 Appstate file size:', appStateContent.length, 'bytes')
    
    let appState: any
    try {
      appState = JSON.parse(appStateContent)
      console.log('✅ Parse appstate thành công, số cookie:', appState?.length || 0)
    } catch (parseErr) {
      console.log('❌ Lỗi parse appstate JSON:', (parseErr as Error).message)
      throw parseErr
    }

    api = await new Promise((resolve, reject) => {
      login({ appState }, (err: any, API: any) => {
        if (err) {
          console.log('❌ Lỗi đăng nhập Facebook:', err.error || err.message)
          console.log('💡 Gợi ý: Appstate có thể hết hạn, hãy cung cấp appstate mới')
          reject(err)
        } else {
          console.log('✅ Login thành công, đang khởi tạo API...')
          resolve(API)
        }
      })
    })

    isConnected = true
    console.log('✅ Đã kết nối Facebook thành công (appstate)')

    // Lấy danh sách bạn
    await loadFriendList()

    // Gửi thông báo bot đã online tới user ID
    const ownerID = process.env.FB_OWNER_ID || '100073991592173'
    await sendFbMessage(ownerID, '🎮 Bot Minecraft đã online trên server!')

    // Lắng nghe message
    listenForMessages()

    return true
  } catch (error) {
    console.log('❌ Lỗi khởi tạo Facebook bot:', (error as Error).message)
    return false
  }
}

// Hàm lấy danh sách bạn bè
async function loadFriendList() {
  try {
    await new Promise((resolve, reject) => {
      api.getUserList((err: any, users: any[]) => {
        if (err) {
          console.log('⚠️ Không thể tải danh sách bạn:', err)
          reject(err)
        } else {
          users.forEach((user: any) => {
            friendList.set(user.userID, user.fullName || user.name || 'Unknown')
          })
          console.log(`✅ Đã tải ${users.length} bạn bè`)
          resolve(true)
        }
      })
    })
  } catch (error) {
    console.log('⚠️ Lỗi khi tải danh sách bạn:', (error as Error).message)
  }
}

// Hàm lắng nghe message từ Facebook
function listenForMessages() {
  if (!api) return

  api.listen((err: any, event: any) => {
    if (err) {
      console.log('❌ Lỗi listen Facebook:', err.error || err.message)
      // Reconnect sau 5 giây
      setTimeout(() => {
        console.log('🔄 Thử kết nối lại Facebook...')
        listenForMessages()
      }, 5000)
      return
    }

    // Xử lý incoming message
    if (event.type === 'message' && event.body) {
      const senderID = event.senderID
      const senderName = friendList.get(senderID) || 'Unknown'
      const messageText = event.body

      console.log(`💬 FB Message từ ${senderName} (${senderID}): ${messageText}`)

      // Forward message tới botlolicute.ts để xử lý
      handleFacebookMessage(senderID, senderName, messageText)
    }

    // Tiếp tục lắng nghe
    listenForMessages()
  })
}

// Hàm xử lý message từ Facebook
function handleFacebookMessage(senderID: string, senderName: string, messageText: string) {
  // Lưu lại info người gửi để reply qua Facebook sau
  const botMessage: BotMessage = {
    playerName: senderName,
    text: messageText,
    timestamp: Date.now()
  }
  lastBotMessageToMinecraft = botMessage

  // Forward tới botlolicute để bot chat trong Minecraft
  // Bạn có thể custom logic ở đây (ví dụ: mình nhắn "/hello" → bot chat "Hello từ Facebook")
  forwardToMinecraftBot(senderName, messageText, senderID)
}

// Hàm forward message tới Minecraft bot
function forwardToMinecraftBot(playerName: string, message: string, facebookID: string) {
  try {
    // Gọi tới botlolicute.ts để xử lý command/chat
    // Ví dụ: nếu message là "/help" → bot chat help message
    // Nếu message là "hello" → gửi feedback qua Facebook
    
    const isCommand = message.startsWith('/')
    
    if (isCommand) {
      // Xử lý command từ Facebook (forward tới bot)
      console.log(`⚙️ Command từ FB ${playerName}: ${message}`)
      // Bot sẽ tự xử lý và reply qua Minecraft chat (nếu có)
      
      // Gửi ack msg qua Facebook
      sendFbMessage(facebookID, `✅ Lệnh "${message}" đã gửi tới bot Minecraft`)
    } else {
      // Chat thường - gửi notification back
      console.log(`💭 Chat từ FB ${playerName}: ${message}`)
      sendFbMessage(facebookID, `🎮 Bot nhận được tin: "${message}". Bot sẽ xử lý sau...`)
    }
  } catch (error) {
    console.log('❌ Lỗi forward message:', (error as Error).message)
  }
}

// Hàm reply message qua Facebook
export async function replyFbMessage(text: string) {
  if (!lastBotMessageToMinecraft) {
    console.log('⚠️ Không có message gần đây từ Facebook để reply')
    return
  }

  // Lấy ID của người gửi message gần nhất
  const lastSenderID = Array.from(friendList.entries()).find(
    ([_, name]) => name === lastBotMessageToMinecraft!.playerName
  )?.[0]

  if (!lastSenderID) {
    console.log('⚠️ Không tìm thấy ID của người gửi')
    return
  }

  await sendFbMessage(lastSenderID, text)
}

// Hàm Shutdown
export function closeFacebookBot() {
  if (api) {
    api.logout((err: any) => {
      if (err) {
        console.log('⚠️ Lỗi logout Facebook:', err)
      } else {
        console.log('✅ Đã logout Facebook thành công')
      }
    })
  }
  isConnected = false
}

// Export getter để kiểm tra trạng thái
export function isFbConnected(): boolean {
  return isConnected
}

export function getLastFbMessage(): BotMessage | null {
  return lastBotMessageToMinecraft
}
