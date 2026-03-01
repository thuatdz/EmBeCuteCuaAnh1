// Script để lấy appstate từ email/password Facebook
// Chạy: npx tsx Embe/get-appstate.ts

import * as fs from 'fs'
import * as path from 'path'

const login = require('facebook-chat-api')

async function getAppState() {
  // Hỏi người dùng nhập email/password
  const readline = require('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  const question = (prompt: string): Promise<string> => {
    return new Promise(resolve => {
      rl.question(prompt, resolve)
    })
  }

  try {
    console.log('🔐 Công cụ lấy AppState Facebook\n')
    const email = await question('📧 Nhập email Facebook: ')
    const password = await question('🔑 Nhập password Facebook: ')

    console.log('\n⏳ Đang đăng nhập và lấy appstate...\n')

    await new Promise<void>((resolve, reject) => {
      login({ email, password }, (err: any, api: any, AppState: any) => {
        if (err) {
          console.log('❌ Lỗi đăng nhập:', err.error || err.message)
          reject(err)
          return
        }

        try {
          // Lưu appstate vào file
          const appstateFile = path.join(process.cwd(), 'appstate.json')
          fs.writeFileSync(appstateFile, JSON.stringify(AppState, null, 2), 'utf-8')
          
          console.log('✅ Đã lấy appstate thành công!')
          console.log(`💾 Appstate đã lưu tại: ${appstateFile}`)
          console.log('\n📝 Cấu hình .env:')
          console.log(`FB_APPSTATE_PATH=./appstate.json`)
          
          // Logout
          api.logout((err: any) => {
            if (!err) {
              console.log('\n✅ Đã logout Facebook')
            }
            resolve()
          })
        } catch (saveErr) {
          console.log('❌ Lỗi lưu appstate:', saveErr)
          reject(saveErr)
        }
      })
    })

    console.log('\n🎉 Sẵn sàng! Bot sẽ dùng appstate.json để đăng nhập.')
  } catch (error) {
    console.log('❌ Lỗi:', error)
  } finally {
    rl.close()
  }
}

getAppState()
