import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'

const ENCRYPTION_KEY = process.env.FB_ENCRYPTION_KEY || 'embe-cute-bot-default-key-32ch'

// Đảm bảo key dài 32 bytes (256-bit) sử dụng null padding
const ensureKeyLength = (key: string): Buffer => {
  const padded = Buffer.alloc(32, 0)
  const keyBuffer = Buffer.from(key)
  keyBuffer.copy(padded)
  return padded
}

export function encryptAppState(appState: string): string {
  try {
    const key = ensureKeyLength(ENCRYPTION_KEY)
    const iv = randomBytes(16)
    const cipher = createCipheriv('aes-256-cbc', key, iv)

    let encrypted = cipher.update(appState, 'utf8', 'hex')
    encrypted += cipher.final('hex')

    // Combine IV + encrypted data
    const result = iv.toString('hex') + ':' + encrypted
    return result
  } catch (error) {
    console.log('❌ Lỗi mã hóa appstate:', error)
    return appState
  }
}

export function decryptAppState(encrypted: string): string {
  const key = ensureKeyLength(ENCRYPTION_KEY)
  const trimmed = encrypted.trim()
  const [ivHex, encryptedData] = trimmed.split(':')

  if (!ivHex || !encryptedData) {
    throw new Error('Invalid encrypted format: missing IV or data')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const decipher = createDecipheriv('aes-256-cbc', key, iv)

  let decrypted = decipher.update(encryptedData, 'hex', 'utf8')
  decrypted += decipher.final('utf8')

  return decrypted
}

export function generateEncryptionKey(): string {
  return randomBytes(32).toString('hex')
}
