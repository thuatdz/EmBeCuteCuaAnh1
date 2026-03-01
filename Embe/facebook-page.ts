// Facebook Page API - Sử dụng Graph API chính thức
// Gửi tin nhắn qua Facebook Page

import fetch from 'node-fetch'

let pageAccessToken: string = ''
let pageId: string = ''
let recipientId: string = ''
let isConnected = false

// Khởi tạo Facebook Page API
export async function initFacebookPage() {
  pageAccessToken = process.env.FB_PAGE_ACCESS_TOKEN || ''
  pageId = process.env.FB_PAGE_ID || ''
  recipientId = process.env.FB_RECIPIENT_ID || process.env.FB_OWNER_ID || ''

  console.log('🔍 Debug - Token length:', pageAccessToken.length)
  console.log('🔍 Debug - Page ID length:', pageId.length)

  if (!pageAccessToken || !pageId) {
    console.log('⚠️ FB_PAGE_ACCESS_TOKEN hoặc FB_PAGE_ID chưa được cấu hình')
    console.log('   Hãy cấu hình trong file .env')
    return false
  }

  try {
    console.log('🔐 Đang kiểm tra Facebook Page Access Token...')

    // Kiểm tra token có hợp lệ không - dùng Page ID thay vì "me"
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}?access_token=${pageAccessToken}`
    )

    if (!response.ok) {
      const errorData: any = await response.json()
      console.log('❌ Page Access Token không hợp lệ:', errorData.error?.message || 'Unknown error')
      return false
    }

    const data: any = await response.json()
    console.log(`✅ Đã kết nối Facebook Page: ${data.name} (ID: ${data.id})`)
    
    isConnected = true
    return true
  } catch (error) {
    console.log('❌ Lỗi kết nối Facebook Page:', (error as Error).message)
    return false
  }
}

// Gửi tin nhắn qua Facebook Page
export async function sendPageMessage(userId: string, text: string) {
  if (!isConnected || !pageAccessToken) {
    console.log('⚠️ Facebook Page chưa kết nối')
    return false
  }

  try {
    const response = await fetch(
      `https://graph.facebook.com/v18.0/${pageId}/messages?access_token=${pageAccessToken}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          recipient: { id: userId },
          message: { text: text },
        }),
      }
    )

    if (!response.ok) {
      const error: any = await response.json()
      console.log('❌ Lỗi gửi tin Facebook Page:', error.error?.message || 'Unknown error')
      return false
    }

    console.log(`✅ Đã gửi tin qua Facebook Page tới ${userId}`)
    return true
  } catch (error) {
    console.log('❌ Lỗi gửi tin Facebook Page:', (error as Error).message)
    return false
  }
}

// Gửi tin tới recipient mặc định (owner)
export async function notifyOwner(message: string) {
  if (!recipientId) {
    console.log('⚠️ FB_RECIPIENT_ID chưa được cấu hình')
    return false
  }

  return await sendPageMessage(recipientId, message)
}

// Kiểm tra trạng thái kết nối
export function isPageConnected(): boolean {
  return isConnected
}

// Đóng kết nối (không cần thiết cho Graph API)
export function closeFacebookPage() {
  isConnected = false
  console.log('✅ Đã đóng kết nối Facebook Page')
}
