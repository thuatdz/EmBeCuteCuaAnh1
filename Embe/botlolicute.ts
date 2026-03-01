import 'dotenv/config'
import { config } from 'dotenv'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

// Load .env from project root
const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
config({ path: join(__dirname, '..', '.env') })

import mineflayer, { Bot } from 'mineflayer'
import { pathfinder, Movements } from 'mineflayer-pathfinder'
import * as net from 'net'

// helper to check if a TCP port is free without actually starting the viewer
async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const tester = net.createServer()
      .once('error', () => {
        resolve(false)
      })
      .once('listening', () => {
        tester.close()
        resolve(true)
      })
      .listen(port, '0.0.0.0')
  })
}

// Import goals using createRequire for CommonJS module
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { goals } = require('mineflayer-pathfinder')
import { plugin as pvp } from 'mineflayer-pvp'
import { plugin as collectBlock } from 'mineflayer-collectblock'
const autoEat = require('mineflayer-auto-eat').plugin
import { Vec3 } from 'vec3'
import * as fs from 'fs'

// Import các module đã tách
import { BotConfig, BotState } from './types'
import { updateBotStatus, setBotConnected, getBotStatus } from './bot-status'
import { initFacebookBot, sendFbMessage, replyFbMessage, closeFacebookBot } from './botmess'
const { mineflayer: mineflayerViewer } = require('prismarine-viewer')

const groqApiKey = process.env.GROQ_API_KEY // Groq API key (Free, Fast LLM)

// Bot configuration
const BOT_CONFIG: BotConfig = {
  host: process.env.MINECRAFT_SERVER_HOST || 'bloom.pikamc.vn',
  port: parseInt(process.env.MINECRAFT_SERVER_PORT || '25718'),
  username: process.env.MINECRAFT_BOT_USERNAME || 'ice',
  version: process.env.MINECRAFT_VERSION || '1.21.4',
  auth: 'offline' as const
}

// Export BOT_CONFIG globally for bot-status sync
;(global as any).BOT_CONFIG = BOT_CONFIG;

// All manager functionality is now integrated directly in this file

// Global state variables
let bot: Bot
let targetPlayer: any = null
let prismarineViewerInstance: any = null
let prismarineViewerSetup = false
let followInterval: NodeJS.Timeout | null = null
let protectInterval: NodeJS.Timeout | null = null
let autoFarmActive = false
let isFollowing = false
let isProtecting = false
let lootedChests: Set<string> = new Set() // Ghi nhớ rương đã loot
let isEating = false // Track trạng thái đang ăn
let autoFishingActive = false // Track trạng thái câu cá
let autoItemCollectionDisabled = false // Tạm dừng nhặt đồ khi câu cá
let autoEquipDisabled = false // Tạm dừng tự động trang bị khi câu cá
let lastPlayerCommand = Date.now() // Track lần cuối player ra lệnh
let lastEatTime = 0 // Track lần cuối ăn để tránh spam
let bobberThrowCount = 0 // Đếm số lần âm thanh fishing_bobber.throw
let reconnectAttempts = 0
const MAX_RECONNECT_ATTEMPTS = 5

// Presence check variables
let presenceCheckFailures = 0
let lastPresenceCheck = Date.now()

// Auto mining variables
let autoMiningActive = false
let currentMiningTarget: any = null
let targetOreType = ''
let miningInterval: NodeJS.Timeout | null = null
let lastMinedPosition: any = null
let isCurrentlyDigging = false

// Auto eat plugin variables (plugin no longer auto-starts)
let autoEatPluginActive = false // Track trạng thái auto eat plugin (kept for compatibility)
let lastMobCheckTime = 0 // Track lần cuối kiểm tra mob xung quanh

// Chat/eating control variables (new requirements)
let chatEnabled = true               // nếu false, bot sẽ im lặng mọi chat
let hungerAlertSent = false          // đã gửi cảnh báo "em đói" chưa
let autoEatModeActive = false        // chế độ auto ăn bật hay tắt
let autoEatInterval: NodeJS.Timeout | null = null // interval khi auto ăn bật

// Auto chest hunting variables
let autoChestHuntingActive = false
let currentChestTarget: any = null
let chestHuntingInterval: NodeJS.Timeout | null = null
let lastChestPosition: any = null
let isCurrentlyApproachingChest = false
let farmInterval: NodeJS.Timeout | null = null // Farm interval for compatibility

// Auto crop farming variables - NEW
let autoCropFarmerActive = false
let cropFarmerInterval: NodeJS.Timeout | null = null
let currentHoeTool: any = null
let lastCropFarmLog = 0 // Track lần cuối log để tránh spam
let lastEquipLog = 0 // Track lần cuối log equip để tránh spam

// Shield blocking variables - NEW
let isBlockingWithShield = false
let lastShieldBlockTime = 0
let harvestedCrops: Set<string> = new Set() // Track harvested crops to avoid re-harvesting

// Authorized players list - NEW
let authorizedPlayers: string[] = []

// Load authorized players from server.namgt68
function loadAuthorizedPlayers() {
  try {
    const filePath = join(__dirname, '..', 'server.namgt68')
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, 'utf-8')
      authorizedPlayers = content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line && !line.startsWith('#'))
        .map(name => name.toLowerCase())
      console.log(`✅ Đã tải ${authorizedPlayers.length} người chơi được phép:`, authorizedPlayers)
    } else {
      console.log('⚠️ Không tìm thấy file server.namgt68, tất cả người chơi đều có thể điều khiển bot')
      authorizedPlayers = []
    }
  } catch (error) {
    console.log('❌ Lỗi đọc file server.namgt68:', error)
    authorizedPlayers = []
  }
}

// Calculate string similarity (Levenshtein distance)
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase()
  const s2 = str2.toLowerCase()
  
  const len1 = s1.length
  const len2 = s2.length
  
  if (len1 === 0) return len2 === 0 ? 100 : 0
  if (len2 === 0) return 0
  
  const matrix: number[][] = []
  
  for (let i = 0; i <= len1; i++) {
    matrix[i] = [i]
  }
  
  for (let j = 0; j <= len2; j++) {
    matrix[0][j] = j
  }
  
  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      const cost = s1[i - 1] === s2[j - 1] ? 0 : 1
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      )
    }
  }
  
  const distance = matrix[len1][len2]
  const maxLen = Math.max(len1, len2)
  const similarity = ((maxLen - distance) / maxLen) * 100
  
  return similarity
}

// Check if player is authorized (98% similarity)
function isPlayerAuthorized(username: string): boolean {
  // Nếu không có danh sách, cho phép tất cả
  if (authorizedPlayers.length === 0) {
    return true
  }
  
  const cleanUsername = username.toLowerCase().trim()
  
  // Kiểm tra độ tương đồng với từng tên trong danh sách
  for (const authorizedName of authorizedPlayers) {
    const similarity = calculateSimilarity(cleanUsername, authorizedName)
    console.log(`🔍 So sánh "${cleanUsername}" với "${authorizedName}": ${similarity.toFixed(2)}%`)
    
    if (similarity >= 98) {
      console.log(`✅ Player "${username}" được phép điều khiển bot (${similarity.toFixed(2)}% khớp)`)
      return true
    }
  }
  
  console.log(`❌ Player "${username}" KHÔNG được phép điều khiển bot`)
  return false
}

// PVP variables - NEW
let pvpActive = false
let pvpTargetName = ''
let pvpInterval: NodeJS.Timeout | null = null
let hasWarnedWeakPlayer = false // Track nếu đã chat "Sao cậu yếu thế"
let lastPvpTpAttempt = 0 // Track lần cuối thử /tp trong PVP
let lastShieldCheck = 0 // Track lần cuối check shield
let isCirclingBehind = false // Track nếu đang vòng ra sau lưng

// Bow mode variables - NEW
let bowModeActive = false // Chế độ tấn công tầm xa với cung
let lastBowShot = 0 // Track lần bắn cuối để cooldown

// AI Agent variables - NEW
let aiAgentActive = false
let aiAgentShouldStop = false

  // Biến cho respawn handling
  let lastMode = 'idle' // Track chế độ trước khi chết
  let lastPosition: any = null // Track vị trí trước khi chết
  let lastTargetPlayerName = '' // Track tên player đang theo/bảo vệ
  let hasTpPermission: boolean | null = null // Track quyền /tp
  let tpFailCount = 0 // Đếm số lần /tp thất bại
  let lastAttackTime = 0 // Track lần cuối tấn công để cooldown
  let lastTpAttempt = 0 // Track lần cuối thử /tp để tránh spam

// Auto Explore variables - NEW
let autoExploreActive = false
let exploreInterval: NodeJS.Timeout | null = null
let exploreDirection: { x: number, z: number } | null = null
let discoveredStructures: Set<string> = new Set() // Track discovered structures
let lastExploreMove = 0

// Auto Collect variables - NEW
let autoCollectActive = false
let collectInterval: NodeJS.Timeout | null = null
let spawnPoint: Vec3 | null = null // Lưu vị trí spawn
let lastCollectLog = 0 // Track để tránh spam log

// Compatibility shims to replace deleted manager modules
let equipmentManager: any
let autoEatManager: any
let combatManager: any
let fishingManager: any
let followingManager: any
let protectingManager: any
let autoFarmManager: any
let autoBuildManager: any
let autoMiningManager: any

// Forward declarations của các hàm sẽ được định nghĩa sau
let startFollowingPlayer: (username: string) => void
let stopFollowing: () => void
let startProtectingPlayer: (username: string) => void
let stopProtecting: () => void
let startSmartAutoFishing: () => void
let stopSmartAutoFishing: () => void
let startSmartAutoBuild: (buildType: string) => void
let stopSmartAutoBuild: () => void
let equipBestSwordForCombat: () => boolean | undefined
// Auto mining functions
let startAutoMining: (oreType: string) => void
let stopAutoMining: () => void
let startAutoFarmAll: () => void
let stopAutoFarm: () => void
// Auto chest hunting functions
let startAutoChestHunting: () => void
let stopAutoChestHunting: () => void
// Auto crop farming functions
let startAutoCropFarmer: () => void
let stopAutoCropFarmer: () => void
// PVP functions
let startPvP: (targetName: string) => void
let stopPvP: (silent?: boolean) => void
// Auto Explore functions
let startAutoExplore: () => void
let stopAutoExplore: () => void
// Auto Collect functions
let startAutoCollect: () => void
let stopAutoCollect: () => void
let goHome: () => void

// Create compatibility shims
function createManagerShims() {
  followingManager = {
    startFollowingPlayer: (playerName: string) => startFollowingPlayer(playerName),
    stopFollowing: () => stopFollowing(),
    getIsFollowing: () => isFollowing,
    getTargetPlayerName: () => lastTargetPlayerName
  }

  protectingManager = {
    startProtectingPlayer: (playerName: string) => startProtectingPlayer(playerName),
    stopProtecting: () => stopProtecting(),
    getIsProtecting: () => isProtecting,
    getTargetPlayerName: () => lastTargetPlayerName
  }

  autoFarmManager = {
    startAutoFarm: () => startAutoFarmAll(),
    startAutoFarmAll: () => startAutoFarmAll(),
    stopAutoFarm: () => stopAutoFarm(),
    getIsAutoFarmActive: () => autoFarmActive
  }

  // Auto mining manager - REMOVED COMPLETELY

  fishingManager = {
    startSmartAutoFishing: () => startSmartAutoFishing(),
    stopSmartAutoFishing: () => stopSmartAutoFishing(),
    getIsAutoFishingActive: () => autoFishingActive
  }

  autoBuildManager = {
    startSmartAutoBuild: (buildType: string) => startSmartAutoBuild(buildType),
    stopSmartAutoBuild: () => stopSmartAutoBuild()
  }

  autoEatManager = {
    setup: () => {}, // Removed - auto eat now on-demand via chat command
    disable: () => {} // Removed
  }

  equipmentManager = {
    equipBestWeapon: () => equipBestSwordForCombat(),
    setup: () => {}
  }

  combatManager = {
    setup: () => {}
  }
}

async function testServerConnection() {
  return new Promise<boolean>((resolve) => {
    const socket = new net.Socket()

    socket.setTimeout(5000) // 5 second timeout

    socket.on('connect', () => {
      socket.destroy()
      resolve(true)
    })

    socket.on('timeout', () => {
      socket.destroy()
      resolve(false)
    })

    socket.on('error', () => {
      resolve(false)
    })

    socket.connect(BOT_CONFIG.port, BOT_CONFIG.host)
  })
}

async function createBot() {
  console.log(`🚀 Đang tạo bot mới... (Thử lần ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`)
  console.log(`📡 Kết nối tới: ${BOT_CONFIG.host}:${BOT_CONFIG.port}`)
  
  // Load authorized players list
  loadAuthorizedPlayers()

  if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
    console.log('❌ Đã vượt quá số lần thử kết nối tối đa. Dừng bot.')
    console.log('💡 Gợi ý: Kiểm tra xem server Minecraft có đang online không:')
    console.log(`   - Truy cập https://${BOT_CONFIG.host} để kiểm tra status`)
    console.log('   - Hoặc thay đổi MINECRAFT_SERVER_HOST trong file .env')
    return
  }

  // Test server connectivity first
  console.log('🔍 Kiểm tra kết nối server...')
  const serverOnline = await testServerConnection()

  if (!serverOnline) {
    console.log('❌ Server không phản hồi. Server có thể đang offline.')
    console.log('💡 Gợi ý:')
    console.log('   1. Kiểm tra server Aternos có đang chạy không')
    console.log('   2. Thử kết nối bằng Minecraft client trước')
    console.log('   3. Kiểm tra địa chỉ server và port có đúng không')
    console.log('⏳ Sẽ thử lại sau...')

    // Still attempt connection but with warning
  } else {
    console.log('✅ Server phản hồi, đang kết nối bot...')
  }

  bot = mineflayer.createBot({
    host: BOT_CONFIG.host,
    port: BOT_CONFIG.port,
    username: BOT_CONFIG.username,
    version: BOT_CONFIG.version,
    auth: BOT_CONFIG.auth,
    keepAlive: true,
    checkTimeoutInterval: 60000, // Check connection mỗi 60s
    hideErrors: false
  })

  // Tăng MaxListeners để tránh warning
  bot.setMaxListeners(100)

  // patch chat method so we can globally silence it
  const originalChat = bot.chat.bind(bot as any)
  bot.chat = (message: string) => {
    if (chatEnabled) {
      try { originalChat(message) } catch {};
    }
  }

  // Setup real prismarine-viewer for 3D world viewing with dedicated host
  async function setupPrismarineViewer() {
    // Prevent multiple setups
    if (prismarineViewerSetup) {
      console.log('⚠️ Prismarine viewer already set up, skipping...')
      return
    }

    try {
      console.log('🖥️ Setting up Prismarine Viewer (one-time setup)...')
      prismarineViewerSetup = true

      // Cleanup any existing viewer instance first
      if (prismarineViewerInstance) {
        try {
          console.log('🧹 Cleaning up existing prismarine-viewer instance...')
          if (typeof prismarineViewerInstance.close === 'function') {
            prismarineViewerInstance.close()
          }
        } catch (cleanupErr) {
          console.log('⚠️ Error cleaning up old viewer:', (cleanupErr as Error).message || cleanupErr)
        }
        prismarineViewerInstance = null
      }

      console.log('🖥️ Đang khởi động Real Prismarine Viewer với host riêng...')

      // Check if mineflayerViewer is available
      if (typeof mineflayerViewer === 'function') {
        // Try ports starting from 3005 to avoid conflicts
        const tryPorts = [3005, 3006, 3007, 3008, 3009]
        let viewerStarted = false
        let chosenPort: number | null = null

        for (const tryPort of tryPorts) {
          if (viewerStarted) break

          // first ensure port is free before invoking external library
          const free = await isPortAvailable(tryPort)
          if (!free) {
            console.log(`❌ Port ${tryPort} already in use, skipping`) 
            continue
          }

          try {
            console.log(`🔍 Attempting to start prismarine-viewer on port ${tryPort}...`)

            // Start real prismarine-viewer with dynamic port
            // note: this function does not return anything useful, errors may fire later
            mineflayerViewer(bot, {
              port: tryPort,
              firstPerson: false,
              host: '0.0.0.0',  // Bind to all interfaces for Replit
              viewDistance: 'far',
              chatHistory: true,
              outputTextToConsole: false
            })

            // keep track of the instance (mineflayer-viewer returns undefined)
            viewerStarted = true
            chosenPort = tryPort

            console.log(`✅ Prismarine viewer initialized on port ${tryPort}`)

            // since we don't receive the http object, guard the event on bot.viewer instead
            if (prismarineViewerInstance && typeof prismarineViewerInstance.on === 'function') {
              prismarineViewerInstance.on('error', (error: any) => {
                console.log(`❌ Prismarine-viewer emitted error:`, error?.message || error)
                // if the error is address in use, we'll attempt next port on reconnect
                prismarineViewerInstance = null
                viewerStarted = false
              })
            }

            // once the internal http server is listening it'll log itself; we can still notify
            const viewerUrl = `https://${process.env.REPL_SLUG || 'workspace'}-${process.env.REPL_OWNER || 'xihobel480'}.replit.dev:${tryPort}`
            console.log(`🎮 External Viewer URL: ${viewerUrl}`)
            fetch('http://localhost:5000/api/bot-viewer-url', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                url: viewerUrl,
                port: tryPort,
                status: 'active',
                botId: 'botlolicute'
              })
            }).catch(() => {})

            break // exit the loop after starting
          } catch (portError: any) {
            console.log(`❌ Failed to start on ${tryPort}:`, portError.message || portError)
            prismarineViewerInstance = null
            continue
          }
        }

        if (!viewerStarted) {
          console.log('❌ Không thể khởi động prismarine-viewer trên bất kỳ port nào, dùng fallback')
          throw new Error('All ports busy for prismarine-viewer')
        }

        // final log with actual port used
        console.log(`✅ Real Prismarine Viewer setup hoàn tất trên port ${chosenPort}`)
      } else {
        console.log('❌ mineflayerViewer không khả dụng, sử dụng fallback')
        throw new Error('mineflayerViewer not available')
      }

      // Keep bot view tracking for web interface
      startBotViewTracking()
      setupBotEnvironmentTracking()
    } catch (error) {
      console.log('⚠️ Lỗi khởi động Real Prismarine Viewer:', error)
      // Fallback: chỉ chạy basic tracking
      startBotViewTracking()
      setupBotEnvironmentTracking()
    }
  }

  // Enhanced bot view tracking function
  function startBotViewTracking() {
    setInterval(() => {
      if (bot && bot.entity) {
        const pos = bot.entity.position
        const viewData = {
          position: pos,
          health: bot.health,
          food: bot.food,
          yaw: bot.entity.yaw,
          pitch: bot.entity.pitch,
          gamemode: bot.game?.gameMode || 'unknown',
          dimension: bot.game?.dimension || 'overworld',
          inventory: getFullInventoryData(),
          time: bot.time?.timeOfDay || 0,
          weather: bot.isRaining ? 'Mưa' : 'Nắng'
        }

        // Update bot status với enhanced view data - silent update
        updateBotStatus({
          position: viewData.position,
          health: viewData.health,
          food: viewData.food,
          status: `Tọa độ: ${Math.floor(pos.x)}, ${Math.floor(pos.y)}, ${Math.floor(pos.z)} | HP: ${viewData.health}/20 | Đồ ăn: ${viewData.food}/20`,
          inventory: viewData.inventory,
          gamemode: viewData.gamemode,
          weather: viewData.weather
        })

        // Sync với prismarine-viewer để hiển thị real-time data
        syncWithPrismarineViewer(viewData)
      }
    }, 5000) // Update mỗi 5 giây theo yêu cầu
  }

  // Function để lấy đầy đủ thông tin inventory bao gồm trang bị
  function getFullInventoryData() {
    try {
      const items = bot.inventory?.items() || []
      const inventory = items.map(item => ({
        name: item.name,
        displayName: item.displayName || item.name,
        count: item.count,
        slot: item.slot,
        type: item.type
      }))

      // Lấy thông tin trang bị
      const equipment = {
        hand: bot.heldItem ? {
          name: bot.heldItem.name,
          displayName: bot.heldItem.displayName || bot.heldItem.name,
          count: bot.heldItem.count
        } : null,
        helmet: bot.inventory.slots[5] ? {
          name: bot.inventory.slots[5].name,
          displayName: bot.inventory.slots[5].displayName || bot.inventory.slots[5].name,
          count: bot.inventory.slots[5].count
        } : null,
        chestplate: bot.inventory.slots[6] ? {
          name: bot.inventory.slots[6].name,
          displayName: bot.inventory.slots[6].displayName || bot.inventory.slots[6].name,
          count: bot.inventory.slots[6].count
        } : null,
        leggings: bot.inventory.slots[7] ? {
          name: bot.inventory.slots[7].name,
          displayName: bot.inventory.slots[7].displayName || bot.inventory.slots[7].name,
          count: bot.inventory.slots[7].count
        } : null,
        boots: bot.inventory.slots[8] ? {
          name: bot.inventory.slots[8].name,
          displayName: bot.inventory.slots[8].displayName || bot.inventory.slots[8].name,
          count: bot.inventory.slots[8].count
        } : null,
        offhand: bot.inventory.slots[45] ? {
          name: bot.inventory.slots[45].name,
          displayName: bot.inventory.slots[45].displayName || bot.inventory.slots[45].name,
          count: bot.inventory.slots[45].count
        } : null
      }

      return {
        items: inventory,
        equipment: equipment,
        totalItems: items.length
      }
    } catch (error) {
      console.log('Lỗi lấy inventory data:', error)
      return {
        items: [],
        equipment: {},
        totalItems: 0
      }
    }
  }

  // Function để sync data với prismarine-viewer
  async function syncWithPrismarineViewer(viewData: any) {
    try {
      await fetch('http://localhost:3001/api/bot-viewer-sync', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          position: viewData.position,
          health: viewData.health,
          food: viewData.food,
          status: `Tọa độ: ${Math.floor(viewData.position.x)}, ${Math.floor(viewData.position.y)}, ${Math.floor(viewData.position.z)} | HP: ${viewData.health}/20 | Đồ ăn: ${viewData.food}/20`,
          inventory: viewData.inventory,
          connected: true
        })
      })
    } catch (error) {
      // Silent fail để không spam console
    }
  }

  // Thêm tracking environment chi tiết
  function setupBotEnvironmentTracking() {
    if (!bot) return

    // Track các entities xung quanh - REDUCED SPAM
    bot.on('entitySpawn', (entity) => {
      if (entity.type === 'player') {
        console.log(`👤 Player xuất hiện: ${entity.username || entity.displayName || 'Unknown'}`)
      }
      // Removed mob spawn log to reduce spam - chỉ log player thôi
    })

    // Track block breaks/places - disabled to reduce spam
    // bot.on('blockUpdate', (oldBlock, newBlock) => {
    //   if (oldBlock && newBlock && oldBlock.type !== newBlock.type) {
    //     console.log(`🧱 Block thay đổi tại ${newBlock.position}: ${oldBlock.name} → ${newBlock.name}`)
    //   }
    // })

    // Track chat messages
    bot.on('chat', (username, message) => {
      console.log(`💬 [${username}]: ${message}`)
    })
  }

  // Load plugins with error handling
  try {
    bot.loadPlugin(pathfinder)
    bot.loadPlugin(pvp)
    bot.loadPlugin(collectBlock)

    // note: auto-eat plugin is not loaded by default anymore
    // it will be loaded on demand when "auto eat" command is used

    console.log('✅ Plugins loaded successfully (auto-eat deferred)')
  } catch (pluginError) {
    console.log('⚠️ Warning loading plugins:', pluginError)
  }

  // Initialize compatibility shims NGAY SAU KHI TẠO BOT để tránh lỗi undefined
  createManagerShims()
  console.log('✅ Managers initialized')

  // Connection events
  bot.on('login', () => {
    console.log('🔑 Bot đã đăng nhập thành công!')
    console.log(`👤 Username: ${bot.username}`)
    console.log(`🌍 Đang chờ spawn...`)
  })

  bot.once('inject_allowed', () => {
    console.log('✅ Bot được phép inject packets')
  })

  bot.on('spawn', () => {
    console.log('🎉 Bot đã spawn thành công!')
    reconnectAttempts = 0 // Reset on successful connection

    // Lưu spawn point khi bot spawn lần đầu
    if (!spawnPoint && bot.entity && bot.entity.position) {
      spawnPoint = bot.entity.position.clone()
      console.log(`🏠 Đã lưu spawn point: ${Math.floor(spawnPoint.x)}, ${Math.floor(spawnPoint.y)}, ${Math.floor(spawnPoint.z)}`)
    }

    // Reset presence check failures on successful spawn
    presenceCheckFailures = 0
    lastPresenceCheck = Date.now()

    // Đợi 2 giây cho bot ổn định trước khi setup
    setTimeout(() => {
      try {
        const defaultMove = new Movements(bot)
        bot.pathfinder.setMovements(defaultMove)

        // Managers đã được khởi tạo sớm hơn, không cần khởi tạo lại

        // Start các chức năng với delay
        setTimeout(() => startStatusUpdates(), 1000)
        setTimeout(() => startWebStatusUpdates(), 1500)
        // setupAutoEatPlugin removed - using bot.autoEat directly
        setTimeout(() => collectNearbyItems(), 3000)

        // Xử lý respawn sau khi bot đã ổn định
        setTimeout(() => handleRespawn(), 5000)

        // Khởi động prismarine-viewer (asynchronous, sẽ tự chọn port)
        setTimeout(() => { void setupPrismarineViewer() }, 6000)

        // Start monitoring player list to ensure bot is actually in server
        setTimeout(() => startPlayerListMonitoring(), 7000)

        // Kiểm tra quyền /tp một lần duy nhất
        setTimeout(() => checkTpPermissionOnce(), 8000)

        // Khởi tạo Facebook bot (nếu cấu hình sẵn)
        setTimeout(async () => {
          const fbConnected = await initFacebookBot()
          if (fbConnected) {
            console.log('✅ Facebook bot đã kết nối thành công')
            // Gửi thông báo tới Facebook owner
            await sendFbMessage(process.env.FB_OWNER_ID || '', '🎮 Bot Minecraft đã online, sẵn sàng chat!')
          } else {
            console.log('⚠️ Không thể kết nối Facebook, tiếp tục chạy Minecraft bot')
          }
        }, 9000)

        console.log('✅ Bot setup hoàn tất và ổn định')

        // Cập nhật bot status cho web interface
        setBotConnected(true, bot)
      } catch (error) {
        console.log('⚠️ Lỗi setup bot sau spawn:', error)
      }
    }, 2000)
  })

  // Monitor player list to ensure bot is actually in the server
  function startPlayerListMonitoring() {
    let playerListCheckFailures = 0
    const MAX_PLAYERLIST_FAILURES = 2

    const playerListInterval = setInterval(() => {
      if (!bot || !bot._client || bot._client.state !== 'play') {
        clearInterval(playerListInterval)
        return
      }

      try {
        const playerList = Object.keys(bot.players || {})
        const botInList = playerList.includes(bot.username) || playerList.some(name =>
          name.toLowerCase() === bot.username.toLowerCase()
        )

        if (!botInList && playerList.length > 0) {
          playerListCheckFailures++
          console.log(`⚠️ Bot not found in player list (${playerListCheckFailures}/${MAX_PLAYERLIST_FAILURES})`)
          console.log(`📋 Current players: [${playerList.join(', ')}]`)

          if (playerListCheckFailures >= MAX_PLAYERLIST_FAILURES) {
            console.log('❌ Bot not in server player list, triggering reconnect...')
            clearInterval(playerListInterval)

            // Force disconnect and reconnect
            try {
              bot._client.end()
            } catch (e) {}

            setTimeout(() => {
              if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                console.log('🚀 Reconnecting due to player list check failure...')
                createBot()
              }
            }, 2000)
            return
          }
        } else {
          if (playerListCheckFailures > 0) {
            console.log('✅ Bot found in player list, monitoring continues')
            playerListCheckFailures = 0
          }
        }
      } catch (error) {
        console.log('⚠️ Player list monitoring error:', (error as Error).message || error)
        playerListCheckFailures++
      }
    }, 15000) // Check every 15 seconds
  }

  bot.on('death', () => {
    console.log('💀 Bot đã chết!')

    // Thông báo qua Facebook Messenger
    // botMessenger.notifyOwner('bot_died', `Bot đã chết tại vị trí ${Math.floor(bot.entity.position.x)}, ${Math.floor(bot.entity.position.y)}, ${Math.floor(bot.entity.position.z)}`)

    // Lưu trạng thái hiện tại
    lastPosition = bot.entity.position ? { ...bot.entity.position } : null

    // Kiểm tra managers đã được khởi tạo chưa
    if (followingManager && followingManager.getIsFollowing()) {
      lastMode = 'following'
      lastTargetPlayerName = followingManager.getTargetPlayerName() || ''
    } else if (protectingManager && protectingManager.getIsProtecting()) {
      lastMode = 'protecting'
      lastTargetPlayerName = protectingManager.getTargetPlayerName() || ''
    } else if (autoFarmManager && autoFarmManager.getIsAutoFarmActive()) {
      lastMode = 'farming'
    } else if (autoCropFarmerActive) {
      lastMode = 'crop_farming'
    } else if (autoFishingActive) {
      lastMode = 'fishing'
    } else if (autoChestHuntingActive) {
      lastMode = 'chest_hunting'
    } else {
      lastMode = 'idle'
    }

    console.log(`💾 Đã lưu trạng thái: ${lastMode}, target: ${lastTargetPlayerName}`)
    bot.chat('💀 Tớ chết rồi! Sẽ quay lại ngay...')
  })

  bot.on('health', () => {
    // Handle health updates silently
  })

  // ============= TỰ ĐỘNG BƠI VÀ QUẢN LÝ OXY DƯỚI NƯỚC =============
  let isSwimming = false
  let lastOxygenCheck = 0
  let lastSwimLog = 0 // Track để tránh spam log
  
  setInterval(() => {
    try {
      const currentTime = Date.now()
      
      // Kiểm tra mỗi 1000ms (giảm frequency để tránh spam)
      if (currentTime - lastOxygenCheck < 1000) return
      lastOxygenCheck = currentTime

      // Kiểm tra xem bot có đang trong nước không
      const headBlock = bot.blockAt(bot.entity.position.offset(0, 1.6, 0))
      const isInWater = headBlock && headBlock.name === 'water'
      
      if (isInWater) {
        // Bot đang ở dưới nước
        
        // Log chỉ 1 lần mỗi 10 giây để tránh spam
        if (!isSwimming && currentTime - lastSwimLog > 10000) {
          console.log(`🏊 Đang bơi dưới nước`)
          lastSwimLog = currentTime
          isSwimming = true
        }
        
        // CHỈ BƠI LÊN KHI KHÔNG ĐANG THỰC HIỆN HÀNH ĐỘNG KHÁC
        // Nếu đang follow/protect, để pathfinder xử lý
        const isDoingActivity = isFollowing || isProtecting || autoFarmActive || 
                                autoFishingActive || pvpActive
        
        if (!isDoingActivity) {
          // Chỉ bơi lên khi idle
          const blockAbove = bot.blockAt(bot.entity.position.offset(0, 2, 0))
          const hasWaterAbove = blockAbove && blockAbove.name === 'water'
          
          if (hasWaterAbove) {
            // Vẫn còn nước phía trên, bơi lên nhẹ nhàng
            bot.setControlState('jump', true)
            bot.setControlState('sprint', true)
          } else {
            // Đã gần mặt nước
            bot.setControlState('jump', false)
            bot.setControlState('sprint', false)
          }
        }
        // Nếu đang làm việc khác, không can thiệp vào control state
        
      } else {
        // Không còn trong nước
        if (isSwimming) {
          bot.setControlState('jump', false)
          bot.setControlState('sprint', false)
          isSwimming = false
          // Không log nữa để tránh spam
        }
      }
      
    } catch (error) {
      // Silent error
    }
  }, 1000) // Check mỗi 1 giây thay vì 500ms

  // Suppress deprecated physicTick warnings from plugins
  const originalConsoleWarn = console.warn
  console.warn = (...args) => {
    const message = args.join(' ')
    if (!message.includes('physicTick') && !message.includes('deprecated')) {
      originalConsoleWarn.apply(console, args)
    }
  }

  // Suppress partial packet warnings (explosion packets)
  const originalConsoleLog = console.log
  console.log = (...args) => {
    const message = args.join(' ')
    // Bỏ qua warning về partial packet explosion
    if (message.includes('Chunk size') && message.includes('partial packet') && message.includes('explosion')) {
      return // Không log
    }
    originalConsoleLog.apply(console, args)
  }

  // ============= HÀM KIỂM TRA VÀ SỬ DỤNG /TP AN TOÀN =============
  
  // Kiểm tra quyền /tp một lần duy nhất khi bot spawn
  async function checkTpPermissionOnce() {
    if (hasTpPermission !== null) return // Đã check rồi
    
    console.log('🔍 Kiểm tra quyền OP/tp...')
    
    try {
      // Phương pháp 1: Thử lệnh /gamemode để check OP
      const currentGamemode = bot.game.gameMode
      bot.chat('/gamemode survival')
      
      // Đợi 1 giây
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      // Nếu không bị kick hoặc báo lỗi permission thì có OP
      if (bot._client && bot._client.state === 'play') {
        hasTpPermission = true
        console.log('✅ Bot có quyền OP (có thể dùng /tp)')
        
        // Khôi phục gamemode cũ nếu cần
        if (currentGamemode !== 'survival') {
          bot.chat(`/gamemode ${currentGamemode}`)
        }
        return
      }
    } catch (error) {
      // Nếu lỗi, thử phương pháp 2
    }
    
    try {
      // Phương pháp 2: Thử /tp đến chính mình
      const currentPos = bot.entity.position
      const testX = Math.floor(currentPos.x)
      const testY = Math.floor(currentPos.y) + 2
      const testZ = Math.floor(currentPos.z)
      
      bot.chat(`/tp ${bot.username} ${testX} ${testY} ${testZ}`)
      
      // Đợi 1.5 giây kiểm tra
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      const newPos = bot.entity.position
      const moved = Math.abs(newPos.y - currentPos.y) > 1
      
      if (moved) {
        hasTpPermission = true
        console.log('✅ Bot có quyền /tp (OP)')
      } else {
        hasTpPermission = false
        console.log('❌ Bot KHÔNG có quyền /tp (không phải OP)')
        console.log('💡 Bot sẽ đào block để di chuyển khi cần thiết')
      }
    } catch (error) {
      hasTpPermission = false
      console.log('❌ Lỗi kiểm tra /tp, giả định không có quyền')
    }
  }
  
  // Hàm wrapper an toàn cho /tp - chỉ thực hiện nếu có quyền và không spam
  function safeTeleport(command: string): boolean {
    // Kiểm tra quyền
    if (hasTpPermission === false) {
      console.log('⚠️ Bỏ qua /tp vì bot không có quyền OP')
      return false
    }
    
    // Kiểm tra spam (tối đa 1 lần mỗi 3 giây)
    const now = Date.now()
    if (now - lastTpAttempt < 3000) {
      console.log('⚠️ Bỏ qua /tp để tránh spam (cooldown 3s)')
      return false
    }
    
    // Thực hiện teleport
    lastTpAttempt = now
    bot.chat(command)
    console.log(`📍 Thực hiện: ${command}`)
    return true
  }
  
  // Hàm tạo movements thông minh - cho phép đào nếu không có OP
  function createSmartMovements(): any {
    const movements = new Movements(bot)
    
    // Nếu không có OP, cho phép đào block để di chuyển
    if (hasTpPermission === false) {
      movements.canDig = true
      movements.digCost = 1 // Chi phí đào thấp
      movements.placeCost = 1 // Chi phí đặt block thấp
      console.log('⛏️ Movements: Cho phép đào block (không có OP)')
    } else {
      // Có OP thì không cần đào, dùng /tp
      movements.canDig = false
    }
    
    movements.allowSprinting = true
    movements.allowParkour = true
    movements.allow1by1towers = false
    
    return movements
  }

  // Hàm trang bị KIẾM TỐINHẤT - BẮT BUỘC cho chiến đấu
  equipBestSwordForCombat = function() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return
      }
      
      // CHỈ TÌM KIẾM - ưu tiên tuyệt đối cho combat
      const swords = bot.inventory.items().filter(item =>
        item.name.includes('sword')
      )

      if (swords.length > 0) {
        // Sort kiếm theo độ mạnh: netherite > diamond > iron > stone > wood
        const bestSword = swords.sort((a, b) => {
          const getSwordTier = (name: string) => {
            if (name.includes('netherite')) return 10
            if (name.includes('diamond')) return 8
            if (name.includes('iron')) return 6
            if (name.includes('stone')) return 4
            if (name.includes('wooden') || name.includes('wood')) return 2
            return 1
          }
          return getSwordTier(b.name) - getSwordTier(a.name)
        })[0]

        // BẮT BUỘC trang bị kiếm tốt nhất
        if (!bot.heldItem || bot.heldItem.name !== bestSword.name) {
          bot.equip(bestSword, 'hand').catch(() => {})
          console.log(`⚔️ BẮT BUỘC trang bị kiếm: ${bestSword.name} cho combat`)
          return true
        }
        return true
      } else {
        // Không có kiếm, trang bị rìu tốt nhất
        const axes = bot.inventory.items().filter(item => item.name.includes('axe'))
        if (axes.length > 0) {
          const bestAxe = axes.sort((a, b) => {
            const getAxeTier = (name: string) => {
              if (name.includes('netherite')) return 10
              if (name.includes('diamond')) return 8
              if (name.includes('iron')) return 6
              if (name.includes('stone')) return 4
              if (name.includes('wooden') || name.includes('wood')) return 2
              return 1
            }
            return getAxeTier(b.name) - getAxeTier(a.name)
          })[0]

          bot.equip(bestAxe, 'hand').catch(() => {})
          console.log(`🪓 Trang bị rìu thay thế: ${bestAxe.name} cho combat`)
          return true
        }
        
        // Chỉ log 1 lần mỗi 10 giây để tránh spam
        const now = Date.now()
        if (now - lastEquipLog > 10000) {
          console.log('⚠️ Không có kiếm hoặc rìu để combat!')
          lastEquipLog = now
        }
        return false
      }
    } catch (error) {
      console.log('❌ Lỗi trang bị kiếm combat:', error)
      return false
    }
  }

  // Hàm trang bị công cụ phù hợp khi đi theo (không combat)
  function equipBestToolForFollowing() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return
      }
      
      // Không đổi công cụ khi đang fishing hoặc farming
      if (autoFishingActive || autoFarmActive) {
        return
      }
      
      // Khi đi theo, ưu tiên pickaxe > shovel > axe > sword
      const tools = bot.inventory.items().filter(item =>
        item.name.includes('pickaxe') ||
        item.name.includes('shovel') ||
        item.name.includes('axe') ||
        item.name.includes('sword')
      )

      if (tools.length > 0) {
        // Sắp xếp theo ưu tiên: pickaxe > shovel > axe > sword
        const bestTool = tools.sort((a, b) => {
          const getToolPriority = (name: string) => {
            if (name.includes('pickaxe')) return 100
            if (name.includes('shovel')) return 80
            if (name.includes('axe')) return 60
            if (name.includes('sword')) return 40
            return 0
          }

          const getTier = (name: string) => {
            if (name.includes('netherite')) return 10
            if (name.includes('diamond')) return 8
            if (name.includes('iron')) return 6
            if (name.includes('stone')) return 4
            if (name.includes('wooden') || name.includes('wood')) return 2
            return 1
          }

          const priorityA = getToolPriority(a.name) + getTier(a.name)
          const priorityB = getToolPriority(b.name) + getTier(b.name)
          return priorityB - priorityA
        })[0]

        if (!bot.heldItem || bot.heldItem.name !== bestTool.name) {
          bot.equip(bestTool, 'hand').catch(() => {})
          // Chỉ log 1 lần mỗi 15 giây để tránh spam
          const now = Date.now()
          if (now - lastEquipLog > 15000) {
            console.log(`🔧 Trang bị công cụ theo dõi: ${bestTool.name}`)
            lastEquipLog = now
          }
        }
      }
    } catch (error) {
      // Silent error
    }
  }

  // Bow functions removed

  // Kiểm tra vật cản giữa bot và target (raycast) - FIXED VERSION
  function hasLineOfSight(target: any): boolean {
    try {
      if (!target || !target.position) return false

      const botPos = bot.entity.position
      const targetPos = target.position

      // Điều chỉnh vị trí kiểm tra: mắt bot và trung tâm target
      const from = new Vec3(botPos.x, botPos.y + 1.6, botPos.z) // Mắt bot (1.6 blocks cao)
      const to = new Vec3(targetPos.x, targetPos.y + 0.5, targetPos.z) // Trung tâm target

      const distance = from.distanceTo(to)
      if (distance < 2) return true // Quá gần thì luôn có line of sight

      // Tính vector hướng
      const direction = to.clone().subtract(from).normalize()

      // Kiểm tra từng 0.5 block dọc theo đường
      const steps = Math.floor(distance * 2)
      for (let i = 1; i < steps; i++) {
        const checkPoint = from.clone().add(direction.clone().scale(i * 0.5))
        const block = bot.blockAt(checkPoint.floor())

        // Kiểm tra block rắn cản đường
        if (block && block.name !== 'air') {
          // Cho phép bắn qua các block không rắn
          const passableBlocks = [
            'water', 'lava', 'grass', 'tall_grass', 'fern', 'large_fern',
            'flower', 'dandelion', 'poppy', 'rose', 'vine', 'snow',
            'snow_layer', 'torch', 'redstone_torch', 'lever', 'button',
            'pressure_plate', 'tripwire', 'string', 'web', 'fire'
          ]

          const isPassable = passableBlocks.some(passable =>
            block.name.includes(passable)
          )

          if (!isPassable && block.boundingBox === 'block') {
            // Removed spam log - chỉ return false thôi
            return false
          }
        }
      }

      return true // Không có vật cản
    } catch (error) {
      // Silent error - không spam log
      return true // Cho phép tấn công nếu có lỗi để tránh block hoàn toàn
    }
  }

  // Hàm tấn công cận chiến với NHẢY LÊN để tăng sát thương (critical hit)
  let lastMeleeAttackTime = 0
  function meleeAttack(target: any, distance: number): boolean {
    if (!target || !target.isValid || !target.position) return false

    // Cooldown 500ms giữa các đòn để tránh spam vô ích (Minecraft attack cooldown)
    const now = Date.now()
    if (now - lastMeleeAttackTime < 500) return false
    lastMeleeAttackTime = now

    try {
      // Ngắm mục tiêu CHÍNH XÁC trước khi tấn công
      const targetPos = target.position.clone()
      
      // Tính khoảng cách 3D (bao gồm cả Y axis)
      const dx = targetPos.x - bot.entity.position.x
      const dy = targetPos.y - bot.entity.position.y
      const dz = targetPos.z - bot.entity.position.z
      const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz)
      
      // Ngắm vào trung tâm body (chest level) để chính xác hơn
      targetPos.y += target.height * 0.6
      
      // Ngắm CHẬM HƠN để chính xác (force = true)
      bot.lookAt(targetPos, true)

      // Chờ 50ms để aim ổn định trước khi tấn công
      setTimeout(() => {
        if (!target.isValid) return

        // NHẢY LÊN để tấn công critical (tăng 50% damage)
        if (distance3D <= 4 && bot.entity.onGround) {
          // Nhảy lên để chuẩn bị critical hit
          bot.setControlState('jump', true)
          setTimeout(() => {
            bot.setControlState('jump', false)
          }, 50)
          
          // Tấn công khi đang rơi xuống (critical hit)
          setTimeout(() => {
            if (target.isValid) {
              bot.attack(target)
            }
          }, 150)
        } else {
          // Tấn công bình thường
          bot.attack(target)
        }
      }, 50)

      // Bật sprint để tăng damage và tốc độ
      bot.setControlState('sprint', true)

      return true
    } catch (error) {
      // Silent error để tránh spam
      return false
    }
  }

  // Hàm bắn cung tầm xa CỰC CHUẨN
  async function bowAttack(target: any, distance: number): Promise<boolean> {
    if (!target || !target.isValid || !target.position) return false

    // Cooldown 1 giây giữa các mũi tên
    const now = Date.now()
    if (now - lastBowShot < 1000) return false

    try {
      // Trang bị cung nếu chưa có
      const bow = bot.inventory.items().find(item => 
        item.name === 'bow' || item.name === 'crossbow'
      )
      
      if (!bow) {
        console.log('⚠️ Không có cung để bắn!')
        return false
      }

      // Trang bị cung
      if (!bot.heldItem || bot.heldItem.name !== bow.name) {
        await bot.equip(bow, 'hand')
      }

      // Kiểm tra có mũi tên không
      const arrow = bot.inventory.items().find(item => 
        item.name === 'arrow' || item.name === 'spectral_arrow' || item.name === 'tipped_arrow'
      )
      
      if (!arrow) {
        console.log('⚠️ Hết mũi tên!')
        return false
      }

      // Tính toán vị trí bắn CỰC CHUẨN
      const targetPos = target.position.clone()
      
      // Dự đoán vị trí target sẽ di chuyển đến (lead shot)
      if (target.velocity) {
        const timeToHit = distance / 45 // Arrow speed ~45 m/s
        targetPos.x += target.velocity.x * timeToHit
        targetPos.y += target.velocity.y * timeToHit
        targetPos.z += target.velocity.z * timeToHit
      }
      
      // Ngắm vào chest level + bù trọng lực
      const gravity = 0.05 // Minecraft arrow gravity
      const timeToTarget = distance / 45
      const dropCompensation = 0.5 * gravity * timeToTarget * timeToTarget * 20 // Bù rơi
      
      targetPos.y += target.height * 0.6 + dropCompensation

      // Ngắm CỰC CHUẨN với force = true
      await bot.lookAt(targetPos, true)

      // Chờ 100ms để aim ổn định
      await new Promise(resolve => setTimeout(resolve, 100))

      // Kéo cung đầy (1 giây)
      bot.activateItem() // Bắt đầu kéo cung
      
      await new Promise(resolve => setTimeout(resolve, 1000)) // Kéo đầy
      
      bot.deactivateItem() // Bắn!

      lastBowShot = now
      console.log(`🏹 Bắn mũi tên vào ${target.username || target.name} (${distance.toFixed(1)}m)`)

      return true
    } catch (error) {
      console.log('❌ Lỗi bắn cung:', (error as any)?.message || error)
      return false
    }
  }

  async function equipBestArmor() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return
      }
      
      const armorSlots: {[key: string]: any} = {
        head: null,
        torso: null,
        legs: null,
        feet: null
      }

      // Material priority từ xịn đến cùi
      const materialPriority = ['netherite', 'diamond', 'iron', 'gold', 'chainmail', 'leather']

      for (const item of bot.inventory.items()) {
        // Check helmet
        if (item.name.includes('helmet')) {
          if (!armorSlots.head) {
            armorSlots.head = item
          } else {
            // Compare by material priority (safer than maxDurability)
            const currentMaterial = materialPriority.findIndex(m => armorSlots.head.name.includes(m))
            const newMaterial = materialPriority.findIndex(m => item.name.includes(m))
            if (newMaterial < currentMaterial || newMaterial === -1) {
              armorSlots.head = item
            }
          }
        }
        // Check chestplate
        else if (item.name.includes('chestplate')) {
          if (!armorSlots.torso) {
            armorSlots.torso = item
          } else {
            const currentMaterial = materialPriority.findIndex(m => armorSlots.torso.name.includes(m))
            const newMaterial = materialPriority.findIndex(m => item.name.includes(m))
            if (newMaterial < currentMaterial || newMaterial === -1) {
              armorSlots.torso = item
            }
          }
        }
        // Check leggings
        else if (item.name.includes('leggings')) {
          if (!armorSlots.legs) {
            armorSlots.legs = item
          } else {
            const currentMaterial = materialPriority.findIndex(m => armorSlots.legs.name.includes(m))
            const newMaterial = materialPriority.findIndex(m => item.name.includes(m))
            if (newMaterial < currentMaterial || newMaterial === -1) {
              armorSlots.legs = item
            }
          }
        }
        // Check boots
        else if (item.name.includes('boots')) {
          if (!armorSlots.feet) {
            armorSlots.feet = item
          } else {
            const currentMaterial = materialPriority.findIndex(m => armorSlots.feet.name.includes(m))
            const newMaterial = materialPriority.findIndex(m => item.name.includes(m))
            if (newMaterial < currentMaterial || newMaterial === -1) {
              armorSlots.feet = item
            }
          }
        }
      }

      // Equip armor với async/await để tránh lỗi
      for (const [slot, item] of Object.entries(armorSlots)) {
        if (item) {
          try {
            const destination = slot === 'torso' ? 'torso' : slot
            await bot.equip(item, destination as any)
          } catch (equipError) {
            // Silent fail - giáp có thể đã được trang bị rồi
          }
        }
      }
    } catch (error) {
      console.log('Lỗi trang bị giáp:', error)
    }
  }

  async function equipBestTool() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return false
      }
      
      const pickaxes = bot.inventory.items().filter(item => item.name.includes('pickaxe'))

      if (pickaxes.length > 0) {
        const priority = ['netherite', 'diamond', 'iron', 'stone', 'wooden']
        let bestPickaxe = pickaxes[0]

        for (const material of priority) {
          const pickaxe = pickaxes.find(p => p.name.includes(material))
          if (pickaxe) {
            bestPickaxe = pickaxe
            break
          }
        }

        if (!bot.heldItem || bot.heldItem.name !== bestPickaxe.name) {
          await bot.equip(bestPickaxe, 'hand')
          console.log(`🔨 Trang bị ${bestPickaxe.name}`)
        }
        return true
      } else {
        console.log('Không có pickaxe nào để trang bị.')
        return false
      }
    } catch (error) {
      console.log('Lỗi trang bị tool:', error)
      return false
    }
  }

  function equipOffhand() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return
      }
      
      const totem = bot.inventory.items().find(item => item.name === 'totem_of_undying')
      const shield = bot.inventory.items().find(item => item.name.includes('shield'))

      if (totem) {
        bot.equip(totem, 'off-hand').catch(() => {})
        console.log(`✨ Bot đã trang bị Vật Tổ vào tay trái.`)
      } else if (shield) {
        bot.equip(shield, 'off-hand').catch(() => {})
        console.log(`🛡️ Bot đã trang bị Khiên vào tay trái.`)
      }
    } catch (error) {
      console.log('Lỗi trang bị offhand:', error)
    }
  }

  // Helper function để kiểm tra có nên chặn hoạt động khi câu cá không
  function isBlockedByFishing() {
    return autoFishingActive && (autoEquipDisabled || autoItemCollectionDisabled)
  }

  // Xử lý respawn - quay lại vị trí cũ và tiếp tục chế độ
  async function handleRespawn() {
    // Chỉ xử lý nếu có trạng thái được lưu
    if (lastMode === 'idle' || !lastPosition) {
      return
    }

    console.log(`🔄 Bắt đầu khôi phục trạng thái: ${lastMode}`)

    // Đợi 3 giây để bot ổn định sau khi respawn
    setTimeout(async () => {
      try {
        // Kiểm tra quyền /tp
        if (hasTpPermission === false) {
          console.log('❌ Bỏ qua respawn vì không có quyền /tp')
          bot.chat('🥺 Tớ không có quyền /tp để quay lại vị trí cũ')
          resetRespawnState()
          return
        }
        
        if (hasTpPermission === true) {
          // Có quyền /tp, thực hiện ngay
          performRespawnTeleport()
        } else {
          // Chưa biết, đợi check xong
          console.log('⏳ Đợi kiểm tra quyền /tp...')
          setTimeout(() => {
            if (hasTpPermission === true) {
              performRespawnTeleport()
            } else {
              console.log('❌ Không có quyền /tp, bỏ qua respawn')
              resetRespawnState()
            }
          }, 3000)
        }
      } catch (error) {
        console.log('❌ Lỗi khi kiểm tra quyền /tp:', error)
        resetRespawnState()
      }
    }, 3000)
  }

  function performRespawnTeleport() {
    if (!lastPosition) return

    console.log(`🚀 Teleport về vị trí cũ: ${Math.floor(lastPosition.x)}, ${Math.floor(lastPosition.y)}, ${Math.floor(lastPosition.z)}`)
    const tpCommand = `/tp ${bot.username} ${Math.floor(lastPosition.x)} ${Math.floor(lastPosition.y)} ${Math.floor(lastPosition.z)}`
    
    // Sử dụng safeTeleport thay vì bot.chat trực tiếp
    if (!safeTeleport(tpCommand)) {
      console.log('❌ Không thể teleport, bỏ qua respawn')
      resetRespawnState()
      return
    }

    // Kiểm tra thành công sau 3 giây
    setTimeout(() => {
      const currentPos = bot.entity.position
      const distance = Math.sqrt(
        Math.pow(currentPos.x - lastPosition!.x, 2) +
        Math.pow(currentPos.y - lastPosition!.y, 2) +
        Math.pow(currentPos.z - lastPosition!.z, 2)
      )

      if (distance < 10) {
        console.log('✅ Teleport thành công, khôi phục chế độ')
        restorePreviousMode()
      } else {
        console.log('❌ Teleport thất bại, dừng khôi phục')
        resetRespawnState()
      }
    }, 3000)
  }

  function restorePreviousMode() {
    console.log(`🔄 Khôi phục chế độ: ${lastMode}`)

    switch (lastMode) {
      case 'following':
        if (lastTargetPlayerName) {
          bot.chat(`🔄 Quay lại theo ${lastTargetPlayerName}!`)
          followingManager.startFollowingPlayer(lastTargetPlayerName)
        }
        break

      case 'protecting':
        if (lastTargetPlayerName) {
          bot.chat(`🔄 Quay lại bảo vệ ${lastTargetPlayerName}!`)
          protectingManager.startProtectingPlayer(lastTargetPlayerName)
        }
        break

      case 'farming':
        bot.chat('🔄 Quay lại auto farm!')
        autoFarmManager.startAutoFarmAll()
        break

      case 'crop_farming':
        bot.chat('🔄 Quay lại auto crop farmer!')
        startAutoCropFarmer()
        break

      case 'fishing':
        bot.chat('🔄 Quay lại auto câu!')
        fishingManager.startSmartAutoFishing()
        break

      case 'chest_hunting':
        bot.chat('🔄 Quay lại auto tìm rương!')
        startAutoChestHunting()
        break

      default:
        console.log('🔄 Không có chế độ để khôi phục')
        break
    }

    // Reset trạng thái sau khi khôi phục
    resetRespawnState()
  }

  function resetRespawnState() {
    lastPosition = null
    lastMode = 'idle'
    lastTargetPlayerName = ''
    tpFailCount = 0
  }

  // Hàm trang bị vũ khí tốt nhất
  function equipBestWeapon() {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return
      }
      
      // Tìm vũ khí tốt nhất theo thứ tự: sword > axe > bow
      const weapons = bot.inventory.items().filter(item =>
        item.name.includes('sword') ||
        item.name.includes('axe') ||
        item.name.includes('bow')
      )

      if (weapons.length > 0) {
        // Sort theo độ mạnh
        const bestWeapon = weapons.sort((a, b) => {
          const getWeaponTier = (name: string) => {
            if (name.includes('netherite')) return 100
            if (name.includes('diamond')) return 80
            if (name.includes('iron')) return 60
            if (name.includes('stone')) return 40
            if (name.includes('wooden') || name.includes('wood')) return 20
            return 10
          }

          const getWeaponType = (name: string) => {
            if (name.includes('sword')) return 1000
            if (name.includes('axe')) return 800
            if (name.includes('bow')) return 600
            return 0
          }

          const scoreA = getWeaponType(a.name) + getWeaponTier(a.name)
          const scoreB = getWeaponType(b.name) + getWeaponTier(b.name)
          return scoreB - scoreA
        })[0]

        if (!bot.heldItem || bot.heldItem.name !== bestWeapon.name) {
          bot.equip(bestWeapon, 'hand').catch(() => {})
        }
      }
    } catch (error) {
      console.log('Lỗi trang bị vũ khí:', error)
    }
  }

  // Tự động trang bị định kỳ (chặn khi đang câu) - giảm frequency vì plugin tự xử lý
  setInterval(() => {
    // Không trang bị khi đang câu cá hoặc đang ăn
    if (isBlockedByFishing() || isEating) {
      return
    }

    equipBestWeapon()
    equipBestArmor()
    equipOffhand()
  }, 15000) // Tăng lên 15 giây vì plugin tự xử lý việc ăn

  // ------------------ Chat & eating helpers ------------------
  // new logic based on user request: no automatic eating unless commanded
  // safeChat wraps bot.chat so it respects the "chatEnabled" flag
  function safeChat(message: string) {
    if (chatEnabled) {
      try {
        bot.chat(message)
      } catch {}
    }
  }

  function startAutoEatMode() {
    if (!bot) return
    // load plugin lazily if not already
    if (!bot.autoEat) {
      try {
        bot.loadPlugin(autoEat)
        console.log('🍽️ Auto eat plugin loaded on demand')
      } catch (e) {
        console.log('⚠️ Không thể tải auto-eat plugin:', e)
      }
    }
    if (bot.autoEat) {
      bot.autoEat.options = {
        priority: 'foodPoints',
        bannedFood: ['spider_eye', 'pufferfish']
      }
      bot.autoEat.enable()
      autoEatModeActive = true
      safeChat('🍽️ Auto eat bật – tớ sẽ ăn mọi thứ trừ mắt nhện và cá nóc.')
    }
    // keep interval running so we can stop later
    if (!autoEatInterval) {
      autoEatInterval = setInterval(() => {
        if (!autoEatModeActive && autoEatInterval) {
          clearInterval(autoEatInterval)
          autoEatInterval = null
        }
      }, 5000)
    }
  }

  function stopAutoEatMode() {
    if (bot.autoEat && bot.autoEat.isEnabled && bot.autoEat.isEnabled()) {
      bot.autoEat.disable()
    }
    autoEatModeActive = false
    if (autoEatInterval) {
      clearInterval(autoEatInterval)
      autoEatInterval = null
    }
    safeChat('🍽️ Đã tắt auto eat.')
  }

  // monitor hunger for chat alert; does not eat
  function monitorHunger() {
    setInterval(() => {
      if (!bot || typeof bot.food === 'undefined') return
      const food = bot.food
      if (food < 6) {
        if (!hungerAlertSent) {
          safeChat('em đói')
          hungerAlertSent = true
        }
      } else {
        hungerAlertSent = false
      }
    }, 5000)
  }
      

  // disableAutoEatPlugin removed - not needed

  // ------------------ Nhặt item ------------------
  let itemCollectionDisabled = false // Biến để tắt nhặt đồ khi dừng

  function collectNearbyItems() {
    setInterval(() => {
      // Chặn nhặt đồ khi đang câu cá hoặc khi bị disabled
      if (isBlockedByFishing() || itemCollectionDisabled) {
        return
      }

      try {
        const entities = Object.values(bot.entities)
        for (const entity of entities) {
          if (entity.name === 'item' && entity.position && bot.entity.position.distanceTo(entity.position) < 5) {
            bot.lookAt(entity.position, true).catch(() => {})
            bot.collectBlock.collect(entity).catch(() => {})
          }
        }
      } catch (error) {
        // Ignore errors
      }
    }, 2000)
  }

  // ============= ITEM TRACKING SYSTEM =============
  // Map để lưu thông tin item entities khi chúng spawn
  const itemEntityMap = new Map<number, {
    id: number,
    count: number,
    name: string,
    displayName: string,
    spawnTime: number
  }>()

  // Theo dõi khi item entities spawn để lưu metadata
  bot.on('entitySpawn', (entity: any) => {
    // Chỉ quan tâm đến item entities
    if (entity.name === 'item' || entity.type === 'object') {
      try {
        // Thử lấy metadata ngay lập tức
        const tryGetMetadata = () => {
          if (!entity.metadata) return false
          
          const itemStack = entity.metadata.item || entity.metadata[7] || entity.metadata[8]
          if (itemStack && itemStack.itemId !== undefined) {
            const itemInfo = bot.registry.items[itemStack.itemId]
            if (itemInfo) {
              itemEntityMap.set(entity.id, {
                id: itemStack.itemId,
                count: itemStack.itemCount || 1,
                name: itemInfo.name,
                displayName: itemInfo.displayName || itemInfo.name,
                spawnTime: Date.now()
              })
              // Không log nữa để tránh spam - chỉ log khi nhặt
              return true
            }
          }
          return false
        }

        // Thử ngay lập tức
        if (!tryGetMetadata()) {
          // Nếu không có metadata ngay, đợi một chút rồi thử lại
          setTimeout(() => {
            tryGetMetadata()
          }, 100)
          
          // Thử lần cuối sau 500ms
          setTimeout(() => {
            tryGetMetadata()
          }, 500)
        }
      } catch (error) {
        // Bỏ qua lỗi parsing metadata
      }
    }
  })

  // Cleanup Map định kỳ để tránh memory leak (xóa items cũ hơn 60 giây)
  setInterval(() => {
    const now = Date.now()
    for (const [entityId, itemData] of itemEntityMap.entries()) {
      if (now - itemData.spawnTime > 60000) { // 60 giây
        itemEntityMap.delete(entityId)
      }
    }
  }, 30000) // Cleanup mỗi 30 giây

  // Lắng nghe metadata updates cho item entities
  bot.on('entityUpdate', (entity: any) => {
    if ((entity.name === 'item' || entity.type === 'object') && !itemEntityMap.has(entity.id)) {
      // Nếu item chưa có trong Map, thử lấy metadata
      try {
        if (entity.metadata) {
          const itemStack = entity.metadata.item || entity.metadata[7] || entity.metadata[8]
          if (itemStack && itemStack.itemId !== undefined) {
            const itemInfo = bot.registry.items[itemStack.itemId]
            if (itemInfo) {
              itemEntityMap.set(entity.id, {
                id: itemStack.itemId,
                count: itemStack.itemCount || 1,
                name: itemInfo.name,
                displayName: itemInfo.displayName || itemInfo.name,
                spawnTime: Date.now()
              })
              // Không log nữa để tránh spam - chỉ log khi nhặt
            }
          }
        }
      } catch (error) {
        // Bỏ qua lỗi
      }
    }
  })

  // Track khi bot nhặt item - ENHANCED VERSION
  bot.on('playerCollect', (collector: any, collected: any) => {
    if (collector.username === bot.username) {
      let itemName = 'Unknown item'
      let itemCount = 1

      // PHƯƠNG PHÁP 1: Lấy từ Map đã lưu (ưu tiên cao nhất)
      if (collected.id && itemEntityMap.has(collected.id)) {
        const itemData = itemEntityMap.get(collected.id)!
        itemName = itemData.displayName || itemData.name
        itemCount = itemData.count

        // Xóa khỏi Map sau khi sử dụng
        itemEntityMap.delete(collected.id)

        console.log(`🎁 Bot đã nhận: ${itemName} x${itemCount}`)
        return
      }

      // PHƯƠNG PHÁP 2: Thử lấy từ metadata hiện tại
      if (collected.metadata) {
        const itemStack = collected.metadata.item || collected.metadata[7] || collected.metadata[8]
        if (itemStack && itemStack.itemId !== undefined) {
          const itemInfo = bot.registry.items[itemStack.itemId]
          if (itemInfo) {
            itemName = itemInfo.displayName || itemInfo.name
            itemCount = itemStack.itemCount || 1
            console.log(`🎁 Bot đã nhận: ${itemName} x${itemCount}`)
            return
          }
        }
      }

      // PHƯƠNG PHÁP 3: Thử tìm entity trong danh sách entities
      try {
        const entity = bot.entities[collected.id]
        if (entity && entity.metadata) {
          const metadata = entity.metadata as any
          const itemStack = metadata.item || metadata[7] || metadata[8]
          if (itemStack && itemStack.itemId !== undefined) {
            const itemInfo = bot.registry.items[itemStack.itemId]
            if (itemInfo) {
              itemName = itemInfo.displayName || itemInfo.name
              itemCount = itemStack.itemCount || 1
              console.log(`🎁 Bot đã nhận: ${itemName} x${itemCount}`)
              return
            }
          }
        }
      } catch (e) {
        // Bỏ qua lỗi
      }

      // PHƯƠNG PHÁP 4: Fallback methods từ collected object
      if (collected.metadata && collected.metadata.itemName) {
        itemName = collected.metadata.itemName
      } else if (collected.name && collected.name !== 'item') {
        itemName = collected.name
      } else if (collected.metadata && collected.metadata.itemId) {
        const itemById = bot.registry.items[collected.metadata.itemId]
        if (itemById) {
          itemName = itemById.displayName || itemById.name
        }
      }

      // Làm sạch tên item (bỏ minecraft: prefix nếu có)
      if (itemName.includes(':')) {
        itemName = itemName.split(':').pop() || itemName
      }

      // Format tên item đẹp hơn nếu vẫn là technical name
      if (itemName.includes('_')) {
        itemName = itemName.replace(/_/g, ' ')
          .split(' ')
          .map((word: string) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ')
      }

      // Log với tên đã được cải thiện
      console.log(`🎁 Bot đã nhận: ${itemName} x${itemCount}`)
    }
  })

  // Backup method removed - windowUpdate not in BotEvents

  // ------------------ Random Status Updates ------------------
  function startStatusUpdates() {
    setInterval(() => {
      // Removed flirting, now only provides status updates when needed
      if (Math.random() < 0.1) { // 10% chance every 30s for status
        const statusMessages = [
          "🤖 Tớ đang hoạt động bình thường!",
          "⚡ Hệ thống bot stable!",
          "🔋 Bot ready cho commands!",
          "🌟 Mọi thứ OK!"
        ]
        const randomMessage = statusMessages[Math.floor(Math.random() * statusMessages.length)]
        console.log(`Status: ${randomMessage}`)
      }
    }, 30000) // 30 giây một lần
  }

  // Function để cập nhật web status real-time - silent mode
  function startWebStatusUpdates() {
    setInterval(() => {
      if (bot && bot.entity) {
        // Determine current mode
        let currentMode = 'idle';
        let currentStatus = 'Đang chờ lệnh';

        if (isFollowing) {
          currentMode = 'following';
          currentStatus = `Đang theo ${targetPlayer?.username || 'player'}`;
        } else if (isProtecting) {
          currentMode = 'protecting';
          currentStatus = `Đang bảo vệ ${targetPlayer?.username || 'player'}`;
        } else if (autoFarmActive) {
          currentMode = 'autofarming';
          currentStatus = 'Đang auto farm monsters';
        } else if (autoCropFarmerActive) {
          currentMode = 'crop_farming';
          currentStatus = 'Đang auto crop farmer';
        } else if (autoFishingActive) {
          currentMode = 'fishing';
          currentStatus = 'Đang câu cá';
        // Mining status removed
        } else if (autoMiningActive) {
          currentMode = 'mining';
          currentStatus = `Đang đào ${targetOreType}`;
        } else if (autoChestHuntingActive) {
          currentMode = 'chest_hunting';
          currentStatus = 'Đang tìm rương';
        }

        // Get nearby entities
        const nearbyMobs = Object.values(bot.entities)
          .filter(entity => entity.type === 'mob' && entity.position)
          .filter(entity => bot.entity.position.distanceTo(entity.position) < 10)
          .map(entity => ({
            type: entity.name || 'unknown',
            distance: Math.round(bot.entity.position.distanceTo(entity.position) * 10) / 10
          }))
          .slice(0, 5); // Limit to 5 entities

        const currentPosition = {
          x: Math.round(bot.entity.position.x),
          y: Math.round(bot.entity.position.y),
          z: Math.round(bot.entity.position.z)
        };

        // Silent update bot status for web interface (no console logs)
        updateBotStatus({
          connected: true,
          health: bot.health,
          food: bot.food,
          position: currentPosition,
          mode: currentMode,
          status: currentStatus,
          nearbyMobs: nearbyMobs,
          equipment: {
            weapon: bot.heldItem?.name || null,
            armor: [] // Could be expanded later
          },
          targetPlayer: targetPlayer?.username || null,
          lastActivity: new Date().toLocaleString('vi-VN')
        });

        // Đồng bộ với Prismarine Viewer mỗi 10 giây để giảm spam
        if (Date.now() % 10000 < 2000) {
          const viewData = {
            position: currentPosition,
            health: bot.health,
            food: bot.food,
            inventory: getFullInventoryData()
          };

          syncWithPrismarineViewer(viewData);
        }
      }
    }, 5000) // Sync mỗi 5 giây để cân bằng giữa real-time và performance
  }

  // ------------------ SMART AUTO FISHING ------------------
  // Biến tracking cho smart auto fishing
  let isFishing = false
  let fishingInterval: NodeJS.Timeout | null = null
  let currentHook: any = null
  let hookCheckInterval: NodeJS.Timeout | null = null
  let fishingStartTime = 0
  let hasFishBitten = false
  let lastHookPosition: any = null

  // Alias để tương thích với lệnh chat cũ
  startSmartAutoFishing = function() {
    // Dừng các hoạt động khác TRƯỚC khi bắt đầu câu
  stopFollowing()
  stopProtecting()
  if (autoFarmActive) stopAutoFarm()

    // Kích hoạt chế độ câu cá thông minh
    autoFishingActive = true
    autoItemCollectionDisabled = true  // Tạm dừng nhặt đồ
    autoEquipDisabled = true           // Tạm dừng tự động trang bị
    itemCollectionDisabled = false     // Bật lại nhặt đồ cho fishing

    isFishing = false
    currentHook = null
    bobberThrowCount = 0 // Reset đếm âm thanh fishing_bobber.throw cho lần câu này

    bot.chat('🎣 Bắt đầu auto câu thông minh! Tớ chỉ cầm cần câu thôi nè~ ✨')
    console.log('🎣 Smart Auto Fishing - Activated')

    if (fishingInterval) {
      clearInterval(fishingInterval)
    }

    fishingInterval = setInterval(async () => {
      if (!autoFishingActive) {
        clearInterval(fishingInterval!)
        fishingInterval = null
        return
      }

      // Nếu đang câu thì không làm gì cả, chỉ đợi
      if (isFishing) {
        return
      }

      try {
        // BƯỚC 1: Kiểm tra cần câu
        const fishingRod = bot.inventory.items().find(item => item.name.includes('fishing_rod'))

        if (!fishingRod) {
          bot.chat('🥺 Không có cần câu! Cần cần câu để hoạt động nè!')
          stopSmartAutoFishing()
          return
        }

        // BƯỚC 2: Chỉ cầm cần câu - bỏ tất cả đồ khác
        if (!bot.heldItem || !bot.heldItem.name.includes('fishing_rod')) {
          await bot.equip(fishingRod, 'hand')
          console.log('🎣 Chỉ cầm cần câu:', fishingRod.name)
          await new Promise(resolve => setTimeout(resolve, 1200))
        }

        // BƯỚC 3: Tìm nước để câu
        const waterBlock = bot.findBlock({
          matching: (block) => block && (block.name === 'water'),
          maxDistance: 20,
          useExtraInfo: true
        })

        if (waterBlock) {
          // Di chuyển đến gần nước nếu cần
          if (bot.entity.position.distanceTo(waterBlock.position) > 5) {
            const movements = new Movements(bot)
            movements.allowSprinting = true
            bot.pathfinder.setMovements(movements)
            const nearWaterGoal = new goals.GoalNear(waterBlock.position.x, waterBlock.position.y, waterBlock.position.z, 4)
            bot.pathfinder.setGoal(nearWaterGoal)
            await new Promise(resolve => setTimeout(resolve, 2000))
            bot.pathfinder.setGoal(null)
          }

          // BƯỚC 4: Thả câu xuống nước
          await bot.lookAt(waterBlock.position.offset(0.5, 0.5, 0.5), true)
          await new Promise(resolve => setTimeout(resolve, 400))

          console.log('🎣 Thả cần xuống nước!')
          isFishing = true
          currentHook = null
          bobberThrowCount = 0 // Reset đếm âm thanh fishing_bobber.throw cho lần câu này
          bot.activateItem() // Thả phao

          // BƯỚC 5: Setup event listeners cho fishing
          setupFishingEventListeners()

          // BƯỚC 6: Đợi 4 giây trước khi theo dõi
          setTimeout(() => {
            if (!autoFishingActive || !isFishing) return

            // Tìm fishing hook entity với nhiều lần thử
            let attempts = 0
            const maxAttempts = 10
            const findHook = () => {
              attempts++
              currentHook = Object.values(bot.entities).find(entity =>
                (entity.name === 'fishing_bobber' || entity.name === 'fishing_hook') &&
                entity.position &&
                bot.entity.position.distanceTo(entity.position) < 15
              )

              if (currentHook) {
                console.log('✅ Đã tìm thấy phao, bắt đầu theo dõi chuyển động...')
                startSmartHookWatcher()
              } else if (attempts < maxAttempts) {
                console.log(`⚠️ Không thấy phao, thử lại... (${attempts}/${maxAttempts})`)
                setTimeout(findHook, 500) // Thử lại sau 0.5 giây
              } else {
                console.log('❌ Không thể tìm thấy phao sau nhiều lần thử, thả cần lại')
                isFishing = false
              }
            }
            findHook()
          }, 4000) // Đợi 4 giây như yêu cầu trước khi theo dõi

        } else {
          bot.chat('🥺 Không tìm thấy nước gần! Cần tìm ao, sông hoặc biển~')
          stopSmartAutoFishing()
        }

      } catch (error) {
        console.log('❌ Lỗi smart fishing:', error)
        bot.chat('😵 Có lỗi khi câu cá! Thử lại sau~')
        isFishing = false
      }
    }, 6000) // Kiểm tra mỗi 6 giây
  }

  // Alias để tương thích với code cũ
  function startAutoFishing() {
    return startSmartAutoFishing()
  }

  // Hàm theo dõi fishing hook metadata - ƯU TIÊN SỐ 1
  let lastHookMetadata: any = null

  // Hệ thống phát hiện cá cắn thông minh - FIXED VERSION
  let fishingIndicators = {
    particleCount: 0,
    velocityDetections: 0,
    positionChanges: 0,
    strongMovements: 0,
    lastResetTime: Date.now()
  }

  function startSmartHookWatcher() {
    if (hookCheckInterval) {
      clearInterval(hookCheckInterval)
    }

    fishingStartTime = Date.now()
    hasFishBitten = false
    lastHookPosition = currentHook.position ? { ...currentHook.position } : null

    // Reset indicators khi bắt đầu fishing mới
    fishingIndicators = {
      particleCount: 0,
      velocityDetections: 0,
      positionChanges: 0,
      strongMovements: 0,
      lastResetTime: Date.now()
    }

    console.log('🎣 Bắt đầu smart hook watcher, đợi 6 giây trước khi phát hiện...')

    hookCheckInterval = setInterval(() => {
      if (!autoFishingActive || !isFishing || hasFishBitten) {
        if (hookCheckInterval) {
          clearInterval(hookCheckInterval)
          hookCheckInterval = null
        }
        return
      }

      const currentTime = Date.now()
      const fishingDuration = currentTime - fishingStartTime

      // Tìm hook entity hiện tại
      const hookEntity = Object.values(bot.entities).find(entity =>
        entity.id === currentHook.id &&
        (entity.name === 'fishing_bobber' || entity.name === 'fishing_hook')
      )

      if (!hookEntity) {
        // Hook biến mất = đã câu được cá (chỉ sau 6 giây)
        if (fishingDuration > 6000) {
          console.log('🐟 PHAO BIẾN MẤT - ĐÃ CÂU ĐƯỢC CÁ!')
          hasFishBitten = true
          handleSmartFishCaught()
        }
        return
      }

      // CHỈ BẮT ĐẦU PHÁT HIỆN SAU 6 GIÂY ĐỂ TRÁNH GIẬT CẦN SỚM
      if (fishingDuration < 6000) {
        // Cập nhật vị trí để chuẩn bị
        if (hookEntity.position) {
          lastHookPosition = { ...hookEntity.position }
        }
        return
      }

      // PHƯƠNG PHÁP 1: Theo dõi chuyển động Y (phao bị kéo xuống)
      if (hookEntity.position && lastHookPosition) {
        const yChange = lastHookPosition.y - hookEntity.position.y // Dương = phao chìm xuống
        const distanceMoved = Math.sqrt(
          (hookEntity.position.x - lastHookPosition.x) ** 2 +
          (hookEntity.position.y - lastHookPosition.y) ** 2 +
          (hookEntity.position.z - lastHookPosition.z) ** 2
        )

        // Log debug mỗi 10 giây (giảm spam)
        if (fishingDuration % 10000 < 100) {
          console.log(`🎣 Đang câu... ${(fishingDuration/1000).toFixed(0)}s`)
        }

        // ĐẾM CÁC DẤU HIỆU CÁ CẮN (chỉ sau 6 giây) - THÔNG SỐ TỐI ƯU

        // ĐIỀU KIỆN 1: Âm thanh fishing_bobber.throw lần 2 + chuyển động thật (ngưỡng cá cắn)
        if (bobberThrowCount >= 2 && (yChange > 0.25 || distanceMoved > 0.25)) {
          console.log(`🐟 ÂM THANH LẦN 2 + CÁ CẮN THẬT! Y: ${yChange.toFixed(3)}, D: ${distanceMoved.toFixed(3)}`)
          handleSmartFishCaught()
          return
        }

        // ĐIỀU KIỆN 2: Chuyển động cực mạnh (chắc chắn có cá) - Ngưỡng gần như chắc chắn
        if (yChange > 0.40 || distanceMoved > 0.40) {
          console.log(`🐟 CHUYỂN ĐỘNG CỰC MẠNH! Y: ${yChange.toFixed(3)}, Distance: ${distanceMoved.toFixed(3)}`)
          handleSmartFishCaught()
          return
        }
      }

      // PHƯƠNG PHÁP 2: Velocity detection - THÔNG SỐ TỐI ƯU
      if (hookEntity.velocity && fishingDuration > 6000) {
        const velocityMagnitude = Math.sqrt(
          hookEntity.velocity.x ** 2 +
          hookEntity.velocity.y ** 2 +
          hookEntity.velocity.z ** 2
        )

        // Chỉ đếm velocity trên ngưỡng nhiễu (>0.05)
        if (velocityMagnitude > 0.05) {
          fishingIndicators.velocityDetections++
        }

        // Velocity cá cắn + âm thanh (ngưỡng tối ưu >0.25)
        if (velocityMagnitude > 0.25 && bobberThrowCount >= 2) {
          console.log(`🐟 VELOCITY CÁ CẮN + ÂM THANH! V: ${velocityMagnitude.toFixed(3)}`)
          handleSmartFishCaught()
          return
        }

        // Velocity gần như chắc chắn (>0.40)
        if (velocityMagnitude > 0.40) {
          console.log(`🐟 VELOCITY CHẮC CHẮN! V: ${velocityMagnitude.toFixed(3)}`)
          handleSmartFishCaught()
          return
        }
      }

      // Cập nhật vị trí cuối của phao
      if (hookEntity.position) {
        lastHookPosition = { ...hookEntity.position }
      }

      // HỆ THỐNG DỰ PHÒNG - CHỈ KÍCH HOẠT MUỘN HƠN
      const totalIndicators = fishingIndicators.particleCount + fishingIndicators.velocityDetections + fishingIndicators.positionChanges

      // DỰ PHÒNG 1: Sau 10 giây + nhiều dấu hiệu mạnh
      if (fishingDuration > 10000 && fishingIndicators.strongMovements >= 5) {
        console.log(`🐟 DỰ PHÒNG (10s): Strong movements: ${fishingIndicators.strongMovements}`)
        handleSmartFishCaught()
        return
      }

      // DỰ PHÒNG 2: Sau 15 giây + có dấu hiệu + âm thanh
      if (fishingDuration > 15000 && totalIndicators >= 10 && bobberThrowCount >= 1) {
        console.log(`🐟 DỰ PHÒNG (15s): Total: ${totalIndicators}, Sounds: ${bobberThrowCount}`)
        handleSmartFishCaught()
        return
      }

      // Timeout sau 25 giây (giảm từ 30 giây)
      if (fishingDuration > 25000) {
        console.log('⏰ Timeout 25s - rút cần và thả lại')
        try {
          bot.activateItem()
          console.log('🎣 Đã rút cần timeout')
        } catch (error) {
          console.log('❌ Lỗi rút cần timeout:', error)
        }
        isFishing = false
        currentHook = null
        bobberThrowCount = 0
        setTimeout(() => {
          if (autoFishingActive && !isFishing) {
            console.log('🎣 Thả cần mới sau timeout...')
          }
        }, 1000)
      }

    }, 100) // Tăng interval từ 30ms lên 100ms để giảm load
  }

  // Setup fishing event listeners để backup detection
  function setupFishingEventListeners() {
    console.log('🎣 Setting up fishing event listeners...')

    // Clear tất cả sound listeners cũ trước khi thêm mới
    bot.removeAllListeners('soundEffectHeard')
    bot.removeAllListeners('particle')
    console.log('🧹 Đã xóa tất cả sound listeners cũ')

    // Listen for sound effects
    const soundListener = (sound: any, position: any) => {
      if (!autoFishingActive || !isFishing || hasFishBitten) return

      const fishingDuration = Date.now() - fishingStartTime
      if (fishingDuration < 4000) return // Chỉ listen sau 4 giây

      // Console để debug âm thanh - CHỈ LOG QUAN TRỌNG
      if (sound.includes('entity.fishing_bobber.splash')) {
        console.log(`🔊 Splash sound detected`)
      }

      // Đếm số lần âm thanh fishing_bobber.throw xuất hiện
      if (sound.includes('entity.fishing_bobber.throw')) {
        bobberThrowCount++
        console.log(`🎣 Âm thanh fishing_bobber.throw lần ${bobberThrowCount}`)

        // Chỉ rút cần khi âm thanh này xuất hiện lần thứ 2 (cá cắn thật)
        if (bobberThrowCount === 2) {
          console.log('🐟 SOUND DETECTION - CÁ CẮN THẬT! (Lần 2)')
          handleSmartFishCaught()
        }
        return // Thoát khỏi function sau khi xử lý
      }

      // Bỏ qua các âm thanh khác không liên quan
      if (sound.includes('entity.fishing_bobber.retrieve') ||
          sound.includes('.step') ||
          sound.includes('.aggro') ||
          sound.includes('.converted') ||
          sound.includes('.break')) {
        return
      }

      // Phương pháp dự phòng: Chỉ phát hiện âm thanh water splash thực sự từ cá cắn
      if (sound && (sound.includes('entity.generic.splash') ||
                   sound.includes('block.water.ambient') ||
                   sound.includes('entity.bobber.splash'))) {
        console.log('🐟 BACKUP SOUND DETECTION - CÁ CẮN!')
        handleSmartFishCaught()
      }
    }

    // Listen for particles near fishing hook - CHỈ ĐỂ THEO DÕI, KHÔNG RÚT CẦN
    const particleListener = (particle: any) => {
      if (!autoFishingActive || !isFishing || hasFishBitten) return
      if (!currentHook) return

      const fishingDuration = Date.now() - fishingStartTime
      if (fishingDuration < 4000) return

      // Check if particle is near fishing hook
      if (particle.position && currentHook.position) {
        const distance = Math.sqrt(
          (particle.position.x - currentHook.position.x) ** 2 +
          (particle.position.y - currentHook.position.y) ** 2 +
          (particle.position.z - currentHook.position.z) ** 2
        )

        if (distance < 3) {
          // CHỈ LOG ĐỂ THEO DÕI - KHÔNG RÚT CẦN (BỎ LOG ĐỂ GIẢM SPAM)
          // Particle detected but waiting for sound confirmation
        }
      }
    }

    // Thêm listeners
    bot.on('soundEffectHeard', soundListener)
    bot.on('particle', particleListener)

    // Lưu references để cleanup sau này (sẽ được cleanup trong stopSmartAutoFishing)
    // Listeners sẽ được remove bằng removeAllListeners khi setup lại
  }

  function handleSmartFishCaught() {
    if (!isFishing) return
    if (hasFishBitten) return // Tránh xử lý trùng lặp

    hasFishBitten = true

    // Dừng timer theo dõi ngay lập tức
    if (hookCheckInterval) {
      clearInterval(hookCheckInterval)
      hookCheckInterval = null
    }

    console.log('🎣 Phát hiện cá cắn! Đang rút cần...')

    // Rút cần NGAY LẬP TỨC - không delay, không chat spam
    try {
      // Đảm bảo bot đang cầm cần câu
      const fishingRod = bot.inventory.items().find(item => item.name.includes('fishing_rod'))
      if (fishingRod && (!bot.heldItem || !bot.heldItem.name.includes('fishing_rod'))) {
        bot.equip(fishingRod, 'hand').then(() => {
          // Rút cần sau khi trang bị
          bot.activateItem()
          console.log('🎣 Đã rút cần sau khi trang bị!')
          // Chat chỉ 1 lần khi thành công
          bot.chat('🎣 Câu thành công! ✨')
        }).catch(err => {
          console.log('Lỗi trang bị cần khi rút:', err)
          bot.activateItem() // Thử rút dù sao
          bot.chat('🎣 Câu thành công! ✨')
        })
      } else {
        // Đã cầm cần câu rồi, rút ngay
        bot.activateItem()
        console.log('🎣 Đã rút cần!')
        // Chat chỉ 1 lần khi thành công
        bot.chat('🎣 Câu thành công! ✨')
      }
    } catch (error) {
      console.log('❌ Lỗi khi rút cần:', error)
      // Thử rút lần nữa
      setTimeout(() => {
        try {
          bot.activateItem()
          console.log('🎣 Thử rút cần lần 2')
          bot.chat('🎣 Câu thành công! ✨')
        } catch (e) {
          console.log('❌ Không thể rút cần:', e)
        }
      }, 200)
    }

    // Reset trạng thái
    isFishing = false
    currentHook = null
    lastHookPosition = null
    bobberThrowCount = 0 // Reset đếm âm thanh fishing_bobber.throw cho lần câu tiếp theo

    // Reset để câu tiếp - không có chat thêm
    setTimeout(() => {
      hasFishBitten = false
      fishingStartTime = 0
      lastHookPosition = null
      console.log('🎣 Sẵn sàng câu tiếp...')
    }, 1000)
  }

  // Alias để tương thích với code cũ
  function handleFishCaught() {
    return handleSmartFishCaught()
  }

  stopSmartAutoFishing = function() {
    autoFishingActive = false
    autoItemCollectionDisabled = false  // Bật lại nhặt đồ
    autoEquipDisabled = false           // Bật lại tự động trang bị

    isFishing = false
    hasFishBitten = false
    bobberThrowCount = 0 // Reset đếm âm thanh fishing_bobber.throw

    if (fishingInterval) {
      clearInterval(fishingInterval)
      fishingInterval = null
    }

    if (hookCheckInterval) {
      clearInterval(hookCheckInterval)
      hookCheckInterval = null
    }

    currentHook = null
    lastHookPosition = null

    // Chỉ chat khi được gọi trực tiếp, không chat khi dừng tất cả
    if (!arguments[0]) { // Không có parameter silent
      bot.chat('🎣 Dừng auto câu! Các chức năng khác hoạt động lại~')
    }
    console.log('⏹️ Smart Auto Fishing - Deactivated')
    console.log('✅ Auto item collection: Enabled')
    console.log('✅ Auto equipment: Enabled')
  }

  // Alias để tương thích với code cũ
  function stopAutoFishing() {
    return stopSmartAutoFishing()
  }

  // ------------------ AUTO MINING REMOVED ------------------
  // Chức năng auto mining đã được loại bỏ hoàn toàn

  // ------------------ AUTO CHEST HUNTING REMOVED ------------------
  // Chức năng auto tìm rương đã được xóa bỏ hoàn toàn

  // ------------------ SMART AUTO BUILD - PHIÊN BÊN MỚI ------------------
  let autoBuildActive = false
  let currentBuildProject: any = null
  let buildProgress = 0

  // Danh sách thiết kế có sẵn tối ưu
  const quickBuilds: { [key: string]: any } = {
    'nhà nhỏ': {
      name: 'Ngôi nhà nhỏ xinh',
      size: '7x7x4',
      blocks: [
        // Y=0: Nền
        [
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks']
        ],
        // Y=1: Tường
        [
          ['oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','oak_door','air','air','air','air','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs']
        ],
        // Y=2: Tường + cửa sổ
        [
          ['oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','glass','air','air','air','glass','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','air','air','air','air','air','oak_logs'],
          ['oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs','oak_logs']
        ],
        // Y=3: Mái
        [
          ['air','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','air'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks'],
          ['air','oak_planks','oak_planks','oak_planks','oak_planks','oak_planks','air']
        ]
      ],
      materials: { 'oak_planks': 40, 'oak_logs': 30, 'oak_door': 1, 'glass': 2 }
    },

    'tháp nhỏ': {
      name: 'Tháp quan sát',
      size: '5x5x8',
      blocks: Array.from({length: 8}, (_, y) => {
        if (y === 0) {
          // Nền
          return Array.from({length: 5}, () => Array(5).fill('stone_bricks'))
        } else if (y < 7) {
          // Tường tháp
          const layer = Array.from({length: 5}, () => Array(5).fill('air'))
          for (let x = 0; x < 5; x++) {
            layer[0][x] = 'stone_bricks'
            layer[4][x] = 'stone_bricks'
            layer[x][0] = 'stone_bricks'
            layer[x][4] = 'stone_bricks'
          }
          // Cửa ở tầng 1
          if (y === 1) layer[2][0] = 'oak_door'
          // Cửa sổ
          if (y === 3 || y === 5) {
            layer[0][2] = 'glass'
            layer[4][2] = 'glass'
            layer[2][0] = 'glass'
            layer[2][4] = 'glass'
          }
          return layer
        } else {
          // Mái tháp
          return Array.from({length: 5}, () => Array(5).fill('dark_oak_planks'))
        }
      }),
      materials: { 'stone_bricks': 60, 'dark_oak_planks': 25, 'oak_door': 1, 'glass': 8 }
    },

    'cầu': {
      name: 'Cây cầu gỗ',
      size: '15x3x2',
      blocks: [
        // Y=0: Nền cầu
        Array.from({length: 3}, () => Array.from({length: 15}, () => 'oak_planks')),
        // Y=1: Lan can
        Array.from({length: 3}, (x) =>
          Array.from({length: 15}, (z) => {
            if (x === 0 || x === 2) return 'oak_fence'
            return 'air'
          })
        )
      ],
      materials: { 'oak_planks': 45, 'oak_fence': 30 }
    }
  }

  startSmartAutoBuild = async function(buildType: string) {
    if (autoBuildActive) {
      bot.chat('🏗️ Đang xây công trình khác rồi!')
      return
    }

  // Dừng các hoạt động khác
  stopFollowing()
  stopProtecting()
  if (autoFishingActive) stopAutoFishing()
  if (autoFarmActive) stopAutoFarm()

    const lowerType = buildType.toLowerCase()
    let selectedBuild = null

    // KIỂM TRA CHẾĐỘ SÁNG TẠO AI
    if (lowerType.includes('tự do') || lowerType.includes('sáng tạo') || lowerType.includes('ai')) {
      bot.chat('🤖 Chế độ AI sáng tạo! Tớ sẽ thiết kế theo ý tưởng của cậu!')

      // Lấy mô tả từ lệnh
      const description = buildType.replace(/tự do|sáng tạo|ai/gi, '').trim()

      if (!description) {
        bot.chat('🤔 Cậu muốn tớ thiết kế gì? VD: "auto xây tự do lâu đài nhỏ"')
        return
      }

      // Tạo thiết kế AI dựa trên mô tả
      selectedBuild = await generateAIBuildDesign(description)

      if (!selectedBuild) {
        bot.chat('😵 Tớ không thể thiết kế theo ý tưởng đó, thử mô tả khác nhé!')
        return
      }
    } else {
      // Tìm thiết kế có sẵn
      for (const [key, build] of Object.entries(quickBuilds)) {
        if (lowerType.includes(key) || key.includes(lowerType)) {
          selectedBuild = build
          break
        }
      }

      if (!selectedBuild) {
        bot.chat('🤔 Tớ chưa biết xây loại đó. Thử: nhà nhỏ, tháp nhỏ, cầu')
        bot.chat('🔧 Hoặc dùng "auto xây tự do [mô tả]" để AI thiết kế!')
        return
      }
    }

    autoBuildActive = true
    currentBuildProject = selectedBuild
    buildProgress = 0

    bot.chat(`🏗️ Bắt đầu xây ${selectedBuild.name}!`)
    bot.chat(`📏 Kích thước: ${selectedBuild.size}`)

    try {
      // Chuẩn bị materials
      await prepareSmartBuildMaterials(selectedBuild.materials)

      // Bắt đầu xây
      const buildPos = {
        x: Math.floor(bot.entity.position.x + 3),
        y: Math.floor(bot.entity.position.y),
        z: Math.floor(bot.entity.position.z + 3)
      }

      await executeSmartBuild(selectedBuild.blocks, buildPos)

    } catch (error) {
      console.log('❌ Lỗi smart auto build:', error)
      bot.chat('😵 Có lỗi khi xây! Thử lại nhé!')
      autoBuildActive = false
    }
  }

  // HÀM AI SÁNG TẠO THIẾT KẾ XÂY DỰNG
  async function generateAIBuildDesign(description: string): Promise<any | null> {
    try {
      bot.chat(`🧠 AI đang thiết kế "${description}"... Chờ tí nhé!`)
      console.log(`🤖 AI Creative Build: Designing "${description}"`)

      // Phân tích mô tả để tạo thiết kế thông minh
      let buildCategory = 'house'
      let sizeMultiplier = 1
      let height = 4
      let width = 7
      let length = 7

      if (description.toLowerCase().includes('lâu đài') || description.toLowerCase().includes('castle')) {
        buildCategory = 'castle'
        sizeMultiplier = 2
        height = 8
        width = 12
        length = 12
      } else if (description.toLowerCase().includes('tháp') || description.toLowerCase().includes('tower')) {
        buildCategory = 'tower'
        height = 10
        width = 5
        length = 5
      } else if (description.toLowerCase().includes('cầu') || description.toLowerCase().includes('bridge')) {
        buildCategory = 'bridge'
        height = 2
        width = 3
        length = 15
      } else if (description.toLowerCase().includes('nhà thờ') || description.toLowerCase().includes('church')) {
        buildCategory = 'church'
        height = 6
        width = 9
        length = 12
      } else if (description.toLowerCase().includes('kho') || description.toLowerCase().includes('warehouse')) {
        buildCategory = 'warehouse'
        height = 4
        width = 10
        length = 15
      }

      //Xác định kích thước
      if (description.toLowerCase().includes('nhỏ') || description.toLowerCase().includes('mini')) {
        sizeMultiplier = 0.7
      } else if (description.toLowerCase().includes('lớn') || description.toLowerCase().includes('big') || description.toLowerCase().includes('khổng lồ')) {
        sizeMultiplier = 1.5
      }

      width = Math.floor(width * sizeMultiplier)
      length = Math.floor(length * sizeMultiplier)
      height = Math.floor(height * sizeMultiplier)

      // Chọn vật liệu dựa trên mô tả
      let primaryMaterial = 'oak_planks'
      let secondaryMaterial = 'oak_logs'
      let roofMaterial = 'dark_oak_planks'

      if (description.toLowerCase().includes('đá') || description.toLowerCase().includes('stone')) {
        primaryMaterial = 'stone_bricks'
        secondaryMaterial = 'stone'
        roofMaterial = 'stone_brick_stairs'
      } else if (description.toLowerCase().includes('gỗ') || description.toLowerCase().includes('wood')) {
        primaryMaterial = 'oak_planks'
        secondaryMaterial = 'oak_logs'
      } else if (description.toLowerCase().includes('gạch') || description.toLowerCase().includes('brick')) {
        primaryMaterial = 'bricks'
        secondaryMaterial = 'stone_bricks'
      }

      // TẠO THIẾT KẾ THÔNG MINH
      const blocks = generateSmartStructure(buildCategory, width, length, height, primaryMaterial, secondaryMaterial, roofMaterial)

      // Tính toán vật liệu cần thiết
      const materials = calculateMaterials(blocks, primaryMaterial, secondaryMaterial, roofMaterial)

      const aiDesign = {
        name: `${description} (AI thiết kế)`,
        size: `${width}x${length}x${height}`,
        blocks: blocks,
        materials: materials,
        isAIGenerated: true
      }

      bot.chat(`✨ AI đã thiết kế xong! Kích thước: ${width}x${length}x${height}`)
      console.log(`🤖 AI Design complete: ${width}x${length}x${height}`)

      return aiDesign

    } catch (error) {
      console.log('❌ Lỗi AI creative build:', error)
      bot.chat('😵 AI gặp lỗi khi thiết kế, dùng mẫu có sẵn nhé!')
      return quickBuilds['nhà nhỏ'] // Fallback
    }
  }

  // HÀM TẠO CẤU TRÚC THÔNG MINH
  function generateSmartStructure(category: string, width: number, length: number, height: number, primary: string, secondary: string, roof: string): any[] {
    const blocks: any[] = []

    for (let y = 0; y < height; y++) {
      const layer: any[][] = []

      for (let x = 0; x < width; x++) {
        const row: any[] = []

        for (let z = 0; z < length; z++) {
          let blockType = 'air'

          if (y === 0) {
            // Nền
            blockType = primary
          } else if (y === height - 1) {
            // Mái
            if (category === 'castle') {
              blockType = x === 0 || x === width-1 || z === 0 || z === length-1 ? secondary : 'air'
            } else {
              blockType = roof
            }
          } else {
            // Tường
            if (x === 0 || x === width-1 || z === 0 || z === length-1) {
              blockType = secondary

              // Cửa ở tầng 1
              if (y === 1 && x === Math.floor(width/2) && z === 0) {
                blockType = 'oak_door'
              }

              // Cửa sổ ở tầng 2+
              if (y >= 2 && ((x === 0 || x === width-1) && z % 3 === 1) ||
                           ((z === 0 || z === length-1) && x % 3 === 1)) {
                blockType = 'glass'
              }
            } else {
              blockType = 'air'
            }
          }

          row.push(blockType)
        }
        layer.push(row)
      }
      blocks.push(layer)
    }

    return blocks
  }

  // HÀM TÍNH TOÁN VẬT LIỆU
  function calculateMaterials(blocks: any[], primary: string, secondary: string, roof: string): {[key: string]: number} {
    const materials: {[key: string]: number} = {}

    for (const layer of blocks) {
      for (const row of layer) {
        for (const block of row) {
          if (block !== 'air') {
            materials[block] = (materials[block] || 0) + 1
          }
        }
      }
    }

    // Làm tròn lên và thêm 20% buffer
    Object.keys(materials).forEach(material => {
      materials[material] = Math.ceil(materials[material] * 1.2)
    })

    return materials
  }

  async function prepareSmartBuildMaterials(materials: {[key: string]: number}) {
    bot.chat('📦 Chuẩn bị vật liệu xây dựng...')

    // Material mapping để convert tên
    const materialMap: {[key: string]: string} = {
      'oak_logs': 'oak_log',
      'oak_planks': 'oak_planks',
      'stone_bricks': 'stone_bricks',
      'dark_oak_planks': 'dark_oak_planks',
      'oak_door': 'oak_door',
      'oak_fence': 'oak_fence',
      'glass': 'glass'
    }

    for (const [material, amount] of Object.entries(materials)) {
      const mcItem = materialMap[material] || material
      const stacks = Math.ceil(amount / 64)

      for (let i = 0; i < stacks; i++) {
        bot.chat(`/give ${bot.username} ${mcItem} 64`)
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }

    bot.chat('✅ Đã chuẩn bị xong vật liệu!')
  }

  async function executeSmartBuild(blocks: any[], buildPos: {x: number, y: number, z: number}) {
    let totalBlocks = 0
    let placedBlocks = 0

    // Đếm tổng số blocks
    for (const layer of blocks) {
      for (const row of layer) {
        for (const block of row) {
          if (block !== 'air') totalBlocks++
        }
      }
    }

    bot.chat(`🔨 Bắt đầu xây ${totalBlocks} blocks!`)

    for (let y = 0; y < blocks.length; y++) {
      const layer = blocks[y]

      for (let x = 0; x < layer.length; x++) {
        const row = layer[x]

        for (let z = 0; z < row.length; z++) {
          const blockType = row[z]

          if (blockType === 'air' || !autoBuildActive) continue

          const pos = {
            x: buildPos.x + x,
            y: buildPos.y + y,
            z: buildPos.z + z
          }

          try {
            // Kiểm tra và xử lý block cũ
            const existingBlock = bot.blockAt(new Vec3(pos.x, pos.y, pos.z))
            if (existingBlock && existingBlock.name !== 'air') {
              console.log(`🔨 Đào block cũ ${existingBlock.name} tại ${pos.x},${pos.y},${pos.z}`)

              // Đào block cũ trước khi đặt block mới
              try {
                await bot.dig(existingBlock)
                console.log(`✅ Đã đào xong ${existingBlock.name}`)
                await new Promise(resolve => setTimeout(resolve, 300))
              } catch (digError) {
                console.log(`❌ Không thể đào ${existingBlock.name}, bỏ qua vị trí này`)
                continue
              }
            }

            // Di chuyển đến gần vị trí với timeout ngắn hơn
            const distance = bot.entity.position.distanceTo(new Vec3(pos.x, pos.y, pos.z))
            if (distance > 4) {
              const goal = new goals.GoalNear(pos.x, pos.y, pos.z, 2)
              bot.pathfinder.setGoal(goal)
              await new Promise(resolve => setTimeout(resolve, 800))
            }

            // Tìm và trang bị block
            const itemMap: {[key: string]: string} = {
              'oak_logs': 'oak_log',
              'oak_planks': 'oak_planks',
              'stone_bricks': 'stone_bricks',
              'dark_oak_planks': 'dark_oak_planks',
              'oak_door': 'oak_door',
              'oak_fence': 'oak_fence',
              'glass': 'glass'
            }

            const itemName = itemMap[blockType] || blockType
            const item = bot.inventory.items().find(i => i.name === itemName)

            if (!item) {
              console.log(`⚠️ Không có ${itemName}`)
              continue
            }

            await bot.equip(item, 'hand')

            // Tìm vị trí đặt block tốt nhất
            const possibleTargetBlocks = [
              bot.blockAt(new Vec3(pos.x, pos.y - 1, pos.z)),     // Dưới
              bot.blockAt(new Vec3(pos.x + 1, pos.y, pos.z)),     // Bên phải
              bot.blockAt(new Vec3(pos.x - 1, pos.y, pos.z)),     // Bên trái
              bot.blockAt(new Vec3(pos.x, pos.y, pos.z + 1)),     // Phía sau
              bot.blockAt(new Vec3(pos.x, pos.y, pos.z - 1))      // Phía trước
            ].filter(block => block && block.name !== 'air')

            let placeSuccess = false

            // Thử đặt block vào các hướng khác nhau
            for (let targetBlock of possibleTargetBlocks) {
              if (!targetBlock) continue

              // Thử 3 lần cho mỗi hướng
              for (let attempt = 0; attempt < 3; attempt++) {
                try {
                  // Tính vector hướng đặt
                  const targetPos = targetBlock.position
                  const placeVector = new Vec3(
                    pos.x - targetPos.x,
                    pos.y - targetPos.y,
                    pos.z - targetPos.z
                  )

                  await Promise.race([
                    bot.placeBlock(targetBlock, placeVector),
                    new Promise((_, reject) =>
                      setTimeout(() => reject(new Error('Place timeout')), 2500)
                    )
                  ])

                  placeSuccess = true
                  console.log(`✅ Đã đặt ${blockType} tại ${pos.x},${pos.y},${pos.z}`)
                  break
                } catch (retryError) {
                  if (attempt === 0) {
                    console.log(`⚠️ Thử lại đặt ${blockType} (lần ${attempt + 1})`)
                    await new Promise(resolve => setTimeout(resolve, 400))
                  }
                }
              }

              if (placeSuccess) break // Thoát khỏi loop target blocks nếu thành công
            }

            if (placeSuccess) {
              placedBlocks++
              // Report progress mỗi 5 blocks để giảm spam
              if (placedBlocks % 5 === 0) {
                const progress = Math.round((placedBlocks / totalBlocks) * 100)
                bot.chat(`🏗️ Tiến độ: ${progress}% (${placedBlocks}/${totalBlocks})`)
              }
            } else {
              console.log(`❌ Không thể đặt ${blockType} tại ${pos.x},${pos.y},${pos.z} sau nhiều lần thử`)
            }

            // Tăng delay giữa các block để server xử lý
            await new Promise(resolve => setTimeout(resolve, 200))

          } catch (error) {
            console.log(`⚠️ Lỗi đặt ${blockType} tại ${pos.x},${pos.y},${pos.z}:`, (error as Error).message || error)
          }
        }
      }
    }

    // Kiểm tra hoàn thành thực sự
    const completionPercentage = Math.round((placedBlocks / totalBlocks) * 100)

    if(completionPercentage >= 80) {
      // Hoàn thành thành công (>=80%)
      autoBuildActive = false
      currentBuildProject = null
      bot.chat('🎉 Xây xong rồi! Đẹp không nè? ✨')
      bot.chat(`📊 Kết quả tuyệt vời: ${placedBlocks}/${totalBlocks} blocks (${completionPercentage}%)`)
      console.log('✅ Smart Auto Build completed successfully')
    } else if (completionPercentage >= 50) {
      // Hoàn thành một phần (50-79%)
      autoBuildActive = false
      currentBuildProject = null
      bot.chat('🏗️ Xây được một phần rồi! Có thể cần dọn dẹp thêm!')
      bot.chat(`📊 Kết quả: ${placedBlocks}/${totalBlocks} blocks (${completionPercentage}%)`)
      bot.chat('💡 Tip: Chọn vùng phẳng hơn để xây dựng tốt hơn!')
      console.log('⚠️ Smart Auto Build partially completed')
    } else {
      // Hoàn thành kém (<50%)
      autoBuildActive = false
      currentBuildProject = null
      bot.chat('😅 Xây không được bao nhiêu do địa hình khó!')
      bot.chat(`📊 Chỉ xây được: ${placedBlocks}/${totalBlocks} blocks (${completionPercentage}%)`)
      bot.chat('💡 Tip: Tìm vùng phẳng, không có cây cỏ để xây nhé!')
      console.log('❌ Smart Auto Build completion rate too low')
    }
  }

  async function startSmartAutoBuildWithClear(buildType: string) {
    if (autoBuildActive) {
      bot.chat('🏗️ Đang xây công trình khác rồi!')
      return
    }

  // Dừng các hoạt động khác
  stopFollowing()
  stopProtecting()
  if (autoFishingActive) stopAutoFishing()
  if (autoFarmActive) stopAutoFarm()

    bot.chat('🌱 Sẽ dọn phẳng khu vực trước khi xây!')
    console.log('🌱 Starting auto build with terrain clearing')

    // Tìm thiết kế
    const lowerType = buildType.toLowerCase()
    let selectedBuild = null

    for (const [key, build] of Object.entries(quickBuilds)) {
      if (lowerType.includes(key) || key.includes(lowerType)) {
        selectedBuild = build
        break
      }
    }

    if (!selectedBuild) {
      selectedBuild = quickBuilds['nhà nhỏ'] // Default
    }

    autoBuildActive = true
    currentBuildProject = selectedBuild

    //Xác định khu vực xây dựng
    const buildPos = {
      x: Math.floor(bot.entity.position.x + 3),
      y: Math.floor(bot.entity.position.y),
      z: Math.floor(bot.entity.position.z + 3)
    }

    try {
      // BƯỚC 1: Clear terrain trước
      await clearBuildTerrain(selectedBuild.blocks, buildPos)

      // BƯỚC 2: Chuẩn bị materials
      await prepareSmartBuildMaterials(selectedBuild.materials)

      // BƯỚC 3: Bắt đầu xây trên terrain đã được clear
      await executeSmartBuild(selectedBuild.blocks, buildPos)

    } catch (error) {
      console.log('❌ Lỗi smart auto build with clear:', error)
      bot.chat('😵 Có lỗi khi xây! Thử lại nhé~')
      autoBuildActive = false
    }
  }

  async function clearBuildTerrain(blocks: any[], buildPos: {x: number, y: number, z: number}) {
    bot.chat('🌿 Bắt đầu dọn dẹp địa hình...')

    // Tính toán kích thước khu vực
    const sizeX = blocks[0]?.length || 7
    const sizeZ = blocks[0]?.[0]?.length || 7
    const sizeY = blocks.length

    let clearedBlocks = 0

    // Clear từ trên xuống dưới và mở rộng 1 block xung quanh
    for (let y = buildPos.y + sizeY; y >= buildPos.y - 1; y--) {
      for (let x = buildPos.x - 1; x <= buildPos.x + sizeX; x++) {
        for (let z = buildPos.z - 1; z <= buildPos.z + sizeZ; z++) {
          if (!autoBuildActive) return // Dừng nếu bị cancel

          try {
            const blockToClear = bot.blockAt(new Vec3(x, y, z))

            if (blockToClear && blockToClear.name !== 'air' &&
                blockToClear.name !== 'bedrock' && blockToClear.name !== 'barrier') {

              // Di chuyển đến gần nếu cần
              const distance = bot.entity.position.distanceTo(new Vec3(x, y, z))
              if (distance > 4) {
                const goal = new goals.GoalNear(x, y, z, 3)
                bot.pathfinder.setGoal(goal)
                await new Promise(resolve => setTimeout(resolve, 600))
              }

              // Đào block
              await bot.dig(blockToClear)
              clearedBlocks++

              if (clearedBlocks % 10 === 0) {
                bot.chat(`🌿 Đã dọn ${clearedBlocks} blocks...`)
              }

              await new Promise(resolve => setTimeout(resolve, 150))
            }
          } catch (error) {
            // Bỏ qua lỗi clear terrain
            console.log(`⚠️ Bỏ qua block tại ${x},${y},${z}:`, (error as Error).message || error)
          }
        }
      }
    }

    bot.chat(`✅ Đã dọn phẳng ${clearedBlocks} blocks! Bắt đầu xây dựng!`)
    console.log(`✅ Terrain cleared: ${clearedBlocks} blocks`)
  }

  stopSmartAutoBuild = function() {
    autoBuildActive = false
    currentBuildProject = null
    buildProgress = 0
    bot.pathfinder.setGoal(null)

    // Chỉ chat khi được gọi trực tiếp
    if (!arguments[0]) { // Không có parameter silent
      bot.chat('🛑 Dừng xây!')
    }
    console.log('⏹️ Smart Auto Build - Deactivated')
  }

  // ------------------ AUTO CHEST HUNTING - NEW IMPLEMENTATION (Per User Requirements) ------------------
  // Main function to start auto chest hunting - VÒNG LẶP
  startAutoChestHunting = async function() {
    // Kiểm tra pickaxe
    const hasPickaxe = bot.inventory.items().some(item => item.name.includes('pickaxe'))

    if (!hasPickaxe) {
      bot.chat('🥺 Không có pickaxe! Không thể tìm rương!')
      console.log('❌ No pickaxe found')
      return
    }

    // Stop other activities
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoCropFarmerActive) stopAutoCropFarmer()

    autoChestHuntingActive = true
    bot.chat('📦 Bắt đầu tìm rương! Đào → Loot → Lặp lại!')
    console.log('📦 Auto Chest Hunting - Activated (Loop mode)')

    // Chạy vòng lặp
    const runLoop = async () => {
      while (autoChestHuntingActive) {
        try {
          await executeChestHuntingCycle()
          await new Promise(resolve => setTimeout(resolve, 1000))
        } catch (error) {
          console.log('❌ Lỗi chest hunting:', error)
          await new Promise(resolve => setTimeout(resolve, 3000))
        }
      }
    }

    runLoop()
  }

  // Chu kỳ tìm rương: TÌM → ĐÀO ĐẾN → LOOT → LẶP LẠI
  async function executeChestHuntingCycle() {
    if (!autoChestHuntingActive) return

    // Tìm rương gần nhất với khoảng cách lớn hơn
    const chestBlock = bot.findBlock({
      matching: (block: any) => {
        if (!block || !block.position) return false
        if (block.position.y >= 40) return false // Chỉ tìm dưới y=40
        return block.name && (
          block.name.includes('chest') ||
          block.name.includes('barrel') ||
          block.name.includes('shulker_box')
        )
      },
      maxDistance: 128, // Tăng lên 128 blocks (8 chunks)
      count: 1
    })

    if (chestBlock) {
      const distance = bot.entity.position.distanceTo(chestBlock.position)
      console.log(`📦 Tìm thấy ${chestBlock.name} tại (${chestBlock.position.x}, ${chestBlock.position.y}, ${chestBlock.position.z}) - ${distance.toFixed(1)} blocks`)

      // Đào đến rương
      await digToChest(chestBlock)

      // Mở và loot rương
      await lootChest(chestBlock)

      // Lặp lại ngay (tìm rương mới)
      return

    } else {
      console.log('📍 Không có rương trong 128 blocks, đào thẳng để explore...')
      
      // Đào thẳng 1 hướng để tìm
      await digStraightToExplore()
    }
  }

  // Đào đến rương
  async function digToChest(chestBlock: any) {
    if (!autoChestHuntingActive) return

    try {
      const distance = bot.entity.position.distanceTo(chestBlock.position)
      console.log(`⛏️ Đào đến rương (${distance.toFixed(1)} blocks)`)

      // Trang bị pickaxe tốt nhất
      const pickaxe = bot.inventory.items()
        .filter(item => item.name.includes('pickaxe'))
        .sort((a, b) => {
          const order = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden']
          return order.indexOf(a.name.split('_')[0]) - order.indexOf(b.name.split('_')[0])
        })[0]

      if (pickaxe) {
        await bot.equip(pickaxe, 'hand')
      }

      // Pathfinder với canDig = true
      const movements = new Movements(bot)
      movements.canDig = true // CHO PHÉP ĐÀO
      movements.digCost = 1
      movements.allow1by1towers = true
      movements.allowParkour = false
      movements.allowSprinting = true
      movements.blocksCantBreak.clear()
      movements.blocksCantBreak.add(bot.registry.blocksByName.bedrock?.id || 0)
      movements.blocksCantBreak.add(bot.registry.blocksByName.barrier?.id || 0)
      bot.pathfinder.setMovements(movements)

      const goal = new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 2)
      bot.pathfinder.setGoal(goal)

      // Chờ đến gần rương - tăng thời gian chờ dựa vào khoảng cách
      const maxWait = Math.max(120, Math.ceil(distance / 2)) // Ít nhất 120 giây, hoặc distance/2
      let waited = 0
      let lastLogTime = 0
      
      while (autoChestHuntingActive && waited < maxWait) {
        await new Promise(resolve => setTimeout(resolve, 1000))
        const dist = bot.entity.position.distanceTo(chestBlock.position)
        
        // Log khoảng cách mỗi 5 giây
        if (waited - lastLogTime >= 5) {
          console.log(`📏 Khoảng cách đến rương: ${dist.toFixed(1)} blocks`)
          lastLogTime = waited
        }
        
        if (dist <= 3) {
          console.log('✅ Đã đến rương!')
          bot.pathfinder.setGoal(null)
          break
        }
        
        waited++
      }

      if (waited >= maxWait) {
        console.log('⏱️ Timeout đào đến rương, bỏ qua')
        bot.pathfinder.setGoal(null)
      }

    } catch (error) {
      console.log('❌ Lỗi đào đến rương:', (error as any)?.message || error)
      bot.pathfinder.setGoal(null)
    }
  }

  // Mở và loot rương
  async function lootChest(chestBlock: any) {
    if (!autoChestHuntingActive) return

    try {
      console.log('📦 Mở rương...')
      
      // Mở rương
      const chest = await bot.openContainer(chestBlock)
      console.log(`📦 Rương có ${chest.containerItems().length} items`)

      // Lấy hết đồ
      for (const item of chest.containerItems()) {
        try {
          await chest.withdraw(item.type, null, item.count)
          console.log(`✅ Lấy ${item.name} x${item.count}`)
          await new Promise(resolve => setTimeout(resolve, 200))
        } catch (e) {
          // Bỏ qua lỗi
        }
      }

      chest.close()
      bot.chat('📦 Đã loot xong rương!')
      console.log('✅ Loot xong, tìm rương mới...')

      // Kiểm tra túi đầy
      if (bot.inventory.emptySlotCount() <= 2) {
        bot.chat('🎒 Túi gần đầy rồi!')
      }

    } catch (error) {
      console.log('❌ Lỗi loot rương:', (error as any)?.message || error)
    }
  }

  // Đào thẳng 1 hướng để explore
  let exploreDirection: { x: number, z: number } | null = null

  async function digStraightToExplore() {
    if (!autoChestHuntingActive) return

    try {
      // Chọn hướng ngẫu nhiên nếu chưa có
      if (!exploreDirection) {
        const angle = Math.random() * Math.PI * 2
        exploreDirection = {
          x: Math.cos(angle),
          z: Math.sin(angle)
        }
        console.log(`🧭 Chọn hướng explore: ${angle.toFixed(2)} rad`)
      }

      // Tính điểm đích (30 blocks theo hướng đã chọn)
      const currentPos = bot.entity.position
      const targetX = currentPos.x + exploreDirection.x * 30
      const targetZ = currentPos.z + exploreDirection.z * 30

      console.log(`⛏️ Đào thẳng đến (${Math.round(targetX)}, ${Math.round(targetZ)})`)

      // Trang bị pickaxe
      const pickaxe = bot.inventory.items()
        .filter(item => item.name.includes('pickaxe'))
        .sort((a, b) => {
          const order = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'golden']
          return order.indexOf(a.name.split('_')[0]) - order.indexOf(b.name.split('_')[0])
        })[0]

      if (pickaxe) {
        await bot.equip(pickaxe, 'hand')
      }

      // Pathfinder với canDig = true
      const movements = new Movements(bot)
      movements.canDig = true
      movements.digCost = 1
      movements.allow1by1towers = true
      movements.allowParkour = false
      movements.allowSprinting = true
      movements.blocksCantBreak.clear()
      movements.blocksCantBreak.add(bot.registry.blocksByName.bedrock?.id || 0)
      movements.blocksCantBreak.add(bot.registry.blocksByName.barrier?.id || 0)
      bot.pathfinder.setMovements(movements)

      const goal = new goals.GoalXZ(targetX, targetZ)
      bot.pathfinder.setGoal(goal)

      // Đào trong 10 giây rồi tìm rương lại
      await new Promise(resolve => setTimeout(resolve, 10000))
      bot.pathfinder.setGoal(null)

    } catch (error) {
      console.log('❌ Lỗi explore:', (error as any)?.message || error)
    }
  }

  // Function to stop auto chest hunting
  stopAutoChestHunting = function() {
    console.log('⏹️ Stopping auto chest hunting...')
    autoChestHuntingActive = false
    isCurrentlyApproachingChest = false
    currentChestTarget = null

    if (chestHuntingInterval) {
      clearInterval(chestHuntingInterval)
      chestHuntingInterval = null
    }

    bot.pathfinder.setGoal(null)

    // Reset control states
    try {
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('sprint', false)
    } catch (error) {
      // Ignore control state errors
    }

    bot.chat('🛑 Dừng auto tìm rương.')
    console.log('⏹️ Auto Chest Hunting - Deactivated')
  }

  // ------------------ PVP SYSTEM - NEW IMPLEMENTATION ------------------

  // Helper: Trang bị sword tốt nhất
  async function equipBestSword(): Promise<boolean> {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return false
      }
      
      const swords = bot.inventory.items().filter(item =>
        item.name.includes('sword')
      )

      if (swords.length > 0) {
        const priority = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'wood']
        let bestSword = null

        for (const material of priority) {
          const sword = swords.find(s => s.name.includes(material))
          if (sword) {
            bestSword = sword
            break
          }
        }

        if (!bestSword) bestSword = swords[0]

        if (!bot.heldItem || bot.heldItem.name !== bestSword.name) {
          await bot.equip(bestSword, 'hand')
          console.log(`⚔️ Trang bị ${bestSword.name}`)
        }
        return true
      }
      return false
    } catch (error) {
      console.log('❌ Lỗi trang bị sword:', (error as any)?.message || error)
      return false
    }
  }

  // Helper: Check và ăn golden apple nếu có
  async function eatGoldenAppleIfAvailable(): Promise<boolean> {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return false
      }
      
      const goldenApple = bot.inventory.items().find(item =>
        item.name.includes('golden_apple')
      )

      if (goldenApple) {
        console.log('🍎 Ăn táo vàng ngay!')
        await bot.equip(goldenApple, 'hand')
        await bot.consume()
        // Trang bị lại sword
        await equipBestSword()
        return true
      }
      return false
    } catch (error) {
      console.log('⚠️ Lỗi ăn táo vàng:', (error as any)?.message || error)
      return false
    }
  }

  // Helper: Ăn thức ăn để hồi máu - với cooldown log
  async function eatFoodToHeal(): Promise<boolean> {
    try {
      // Kiểm tra inventory có sẵn sàng chưa
      if (!bot.inventory) {
        return false
      }
      
      const safeFood = bot.inventory.items().find(item => {
        const name = item.name.toLowerCase()
        const safeItems = [
          'bread', 'apple', 'cooked_beef', 'cooked_pork', 'cooked_chicken',
          'cooked_salmon', 'cooked_cod', 'baked_potato', 'carrot',
          'cooked_mutton', 'cookie', 'melon_slice', 'sweet_berries'
        ]
        return safeItems.some(safe => name.includes(safe))
      })

      if (safeFood) {
        // Chỉ log mỗi 5 giây để giảm spam
        const now = Date.now()
        if (!lastEatTime || now - lastEatTime > 5000) {
          console.log(`🍖 Ăn ${safeFood.name} để hồi máu`)
          lastEatTime = now
        }

        await bot.equip(safeFood, 'hand')
        await bot.consume()
        // Trang bị lại sword
        await equipBestSword()
        return true
      }
      return false
    } catch (error) {
      // Chỉ log lỗi quan trọng, bỏ qua "Food is full"
      const errorMsg = (error as any)?.message || (error as any)?.toString() || ''
      if (!errorMsg.includes('Food is full') && !errorMsg.includes('Consuming cancelled')) {
        console.log('⚠️ Lỗi ăn thức ăn:', errorMsg)
      }
      return false
    }
  }

  // Main PVP function - Standard
  startPvP = async function(targetName: string) {
    // Dừng các hoạt động khác
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoChestHuntingActive) stopAutoChestHunting()

    // ensure we know /tp permission before we start any combat logic
    if (hasTpPermission === null) {
      console.log('🔍 Kiểm tra quyền /tp trước khi PVP...')
      await checkTpPermissionOnce() // existing helper on top-level
    }
    if (hasTpPermission === false) {
      bot.chat('⚠️ Tớ không có quyền /tp nhưng vẫn sẽ cố gắng đuổi theo bạn!')
      console.log('⚠️ No /tp permission, PVP will proceed without teleporting.')
    }

    // Validate player name trước khi bắt đầu PVP
    const allPlayers = Object.keys(bot.players)
    console.log(`📋 Kiểm tra player "${targetName}" trong danh sách: [${allPlayers.join(', ')}]`)

    // Tìm player với nhiều phương pháp
    let validatedName = targetName

    // Phương pháp 1: Tìm chính xác
    if (!bot.players[targetName]) {
      // Phương pháp 2: Tìm không phân biệt hoa thường
      const foundName = allPlayers.find(name =>
        name.toLowerCase() === targetName.toLowerCase()
      )

      if (foundName) {
        validatedName = foundName
        console.log(`✅ Đã tìm thấy player: "${foundName}" (khớp với "${targetName}")`)
      } else {
        // Phương pháp 3: Tìm gần đúng
        const nearName = allPlayers.find(name =>
          name.toLowerCase().includes(targetName.toLowerCase()) ||
          targetName.toLowerCase().includes(name.toLowerCase())
        )

        if (nearName) {
          validatedName = nearName
          console.log(`✅ Đã tìm thấy player gần đúng: "${nearName}" (từ "${targetName}")`)
        } else {
          bot.chat(`🥺 Không tìm thấy player "${targetName}" trong server!`)
          console.log(`❌ Player "${targetName}" không tồn tại. Danh sách players: [${allPlayers.join(', ')}]`)
          return
        }
      }
    }

    pvpActive = true
    pvpTargetName = validatedName
    hasWarnedWeakPlayer = false

    bot.chat(`⚔️ Bắt đầu PVP với ${validatedName}!`)
    console.log(`⚔️ PVP Mode - Target: ${validatedName}`)

    // Trang bị sword ngay
    await equipBestSword()

    // Clear existing interval
    if (pvpInterval) clearInterval(pvpInterval)

    pvpInterval = setInterval(async () => {
      if (!pvpActive) {
        clearInterval(pvpInterval!)
        pvpInterval = null
        return
      }

      try {
        // Timeout protection: nếu PVP cycle chạy quá 3 giây thì skip
        await Promise.race([
          executePvPCycle(),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('PVP cycle timeout')), 3000)
          )
        ])
      } catch (error) {
        const errMsg = (error as any)?.message || error
        if (errMsg !== 'PVP cycle timeout') {
          console.log('❌ Lỗi PVP cycle:', errMsg)
        }
        // Reset control states nếu bị lỗi
        try {
          bot.setControlState('jump', false)
          bot.setControlState('forward', false)
        } catch {}
      }
    }, 500) // Check every 0.5 seconds for fast reaction
  }

  // Biến lưu tên player đã tìm thấy để tránh spam logs
  let lastFoundPlayerName = ''
  let lastPlayerSearchLog = 0
  let lastHighJumpLog = 0
  let pvpCycleRunning = false
  let lastShieldLog = 0

  async function executePvPCycle() {
    if (!pvpActive) return
    
    // Tránh chạy nhiều cycle cùng lúc
    if (pvpCycleRunning) return
    pvpCycleRunning = true

    try {
      await executePvPCycleInternal()
    } finally {
      pvpCycleRunning = false
    }
  }

  async function executePvPCycleInternal() {
    const now = Date.now()
    const allPlayers = Object.keys(bot.players)

    // Debug: Log danh sách players mỗi 30 giây (tăng từ 10 giây)
    if (allPlayers.length > 0 && (!lastPvpTpAttempt || now - lastPvpTpAttempt > 30000)) {
      console.log(`📋 Danh sách players trong server: [${allPlayers.join(', ')}]`)
      lastPvpTpAttempt = now
    }

    // Tìm target player với nhiều phương pháp
    let targetPlayer = bot.players[pvpTargetName]?.entity
    let foundPlayerName = ''

    // Phương pháp 1: Tìm theo tên chính xác
    if (!targetPlayer) {
      // Phương pháp 2: Tìm không phân biệt hoa thường
      const playerNames = Object.keys(bot.players)
      const foundName = playerNames.find(name =>
        name.toLowerCase() === pvpTargetName.toLowerCase()
      )

      if (foundName) {
        foundPlayerName = foundName
        targetPlayer = bot.players[foundName]?.entity
        pvpTargetName = foundName // Cập nhật tên chính xác

        // Chỉ log khi tìm thấy lần đầu hoặc sau 10 giây
        if (lastFoundPlayerName !== foundName || now - lastPlayerSearchLog > 10000) {
          console.log(`✅ Tìm thấy player: "${foundName}"`)
          lastFoundPlayerName = foundName
          lastPlayerSearchLog = now
        }
      }
    } else {
      foundPlayerName = pvpTargetName
    }

    // Phương pháp 3: Tìm theo tên gần đúng (contains)
    if (!targetPlayer) {
      const playerNames = Object.keys(bot.players)
      const foundName = playerNames.find(name =>
        name.toLowerCase().includes(pvpTargetName.toLowerCase()) ||
        pvpTargetName.toLowerCase().includes(name.toLowerCase())
      )

      if (foundName) {
        foundPlayerName = foundName
        targetPlayer = bot.players[foundName]?.entity
        pvpTargetName = foundName // Cập nhật tên chính xác

        // Chỉ log khi tìm thấy lần đầu hoặc sau 10 giây
        if (lastFoundPlayerName !== foundName || now - lastPlayerSearchLog > 10000) {
          console.log(`✅ Tìm thấy player gần đúng: "${foundName}"`)
          lastFoundPlayerName = foundName
          lastPlayerSearchLog = now
        }
      }
    }

    if (!targetPlayer || !targetPlayer.position) {
      // Chỉ log lỗi mỗi 10 giây và chỉ khi thực sự không tìm thấy player
      if (!foundPlayerName && (lastFoundPlayerName !== '' || now - lastPlayerSearchLog > 10000)) {
        console.log(`⚠️ Không tìm thấy player "${pvpTargetName}" trong render distance (~128 blocks)`)
        lastFoundPlayerName = ''
        lastPlayerSearchLog = now
      } else if (foundPlayerName && now - lastPlayerSearchLog > 10000) {
        // Tìm thấy player nhưng entity chưa load
        console.log(`⏳ Player "${foundPlayerName}" đang load entity...`)
        lastPlayerSearchLog = now
      }
      return
    }

    // ===== LUÔN AIM VÀO TARGET =====
    // Ngắm vào target liên tục để theo dõi chính xác
    try {
      const targetPos = targetPlayer.position.clone()
      targetPos.y += targetPlayer.height * 0.6 // Ngắm vào chest level
      bot.lookAt(targetPos, true) // force = true để aim chính xác
    } catch (aimError) {
      // Ignore aim errors
    }

    // Check if target is dead - CHỈ CHECK KHI THỰC SỰ CHẾT
    // Không dựa vào metadata vì không đáng tin cậy
    
    // Chỉ coi là chết khi:
    // 1. Entity không hợp lệ (đã despawn)
    // 2. Y position < 0 (rơi xuống void)
    // 3. Health = 0 (thực sự chết)
    const isReallyDead = !targetPlayer.isValid || 
                         targetPlayer.position.y < 0 || 
                         (targetPlayer.health !== undefined && targetPlayer.health <= 0)

    if (isReallyDead) {
      // Stop pathfinder immediately to prevent chasing
      bot.pathfinder.setGoal(null)
      bot.pvp.stop()

      bot.chat(`💪 ${pvpTargetName} đã bị tớ đánh bại rồi! Tớ giỏi lắm nhỉ 😎`)
      console.log(`✅ ${pvpTargetName} đã die/respawn, dừng PVP`)
      stopPvP()
      return
    }

    const distance = bot.entity.position.distanceTo(targetPlayer.position)

    // Check máu bot
    const health = bot.health

    // Nếu có táo vàng, ăn ngay không cần bỏ chạy
    if (health < 10) {
      const hasGoldenApple = await eatGoldenAppleIfAvailable()
      if (hasGoldenApple) {
        // Silent - không log để giảm spam
        // Tiếp tục tấn công
      } else if (health < 8) {
        // Không có táo vàng và máu rất yếu, bỏ chạy - chỉ log 1 lần
        if (!lastEatTime || Date.now() - lastEatTime > 5000) {
          console.log('🏃 Máu yếu, bỏ chạy để ăn!')
          lastEatTime = Date.now()
        }

        // Di chuyển ra xa 5 blocks
        const escapeAngle = Math.atan2(
          bot.entity.position.z - targetPlayer.position.z,
          bot.entity.position.x - targetPlayer.position.x
        )
        const escapeX = bot.entity.position.x + Math.cos(escapeAngle) * 5
        const escapeZ = bot.entity.position.z + Math.sin(escapeAngle) * 5

        const movements = new Movements(bot)
        movements.allowSprinting = true
        bot.pathfinder.setMovements(movements)

        const escapeGoal = new goals.GoalNear(escapeX, bot.entity.position.y, escapeZ, 1)
        bot.pathfinder.setGoal(escapeGoal)

        // Nhảy khi bỏ chạy để nhanh hơn
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)

        await new Promise(resolve => setTimeout(resolve, 1000))

        bot.setControlState('jump', false)

        // Ăn thức ăn
        await eatFoodToHeal()

        return
      }
    }

    // Check khoảng cách
    if (distance > 20) {
      // Player chạy xa quá, check quyền OP và /tp
      if (!hasWarnedWeakPlayer || Date.now() - lastPvpTpAttempt > 10000) {
        lastPvpTpAttempt = Date.now()

        // Thử /tp với safeTeleport
        try {
          const tpSuccess = safeTeleport(`/tp ${pvpTargetName}`)
          if (tpSuccess) {
            await new Promise(resolve => setTimeout(resolve, 500))

            // Check xem có /tp thành công không
            const newDistance = bot.entity.position.distanceTo(targetPlayer.position)
            if (newDistance < distance) {
              bot.chat('Cậu không thoát được đâu❤')
              console.log('✅ Đã /tp đến target')
            }
          } else {
            console.log('⚠️ Không thể /tp (không có quyền hoặc cooldown)')
          }
        } catch (tpError) {
          console.log('⚠️ Lỗi khi thử /tp')
        }
      }
    } else if (distance > 12 && !hasWarnedWeakPlayer) {
      // Player bỏ chạy xa 12 blocks
      bot.chat('Sao cậu yếu thế😆')
      hasWarnedWeakPlayer = true
      console.log('😆 Đã chat "Sao cậu yếu thế"')
    }

    // Trang bị vũ khí phù hợp với chế độ
    if (bowModeActive) {
      // Bow mode: trang bị cung
      const bow = bot.inventory.items().find(item => 
        item.name === 'bow' || item.name === 'crossbow'
      )
      if (bow && (!bot.heldItem || !bot.heldItem.name.includes('bow'))) {
        await bot.equip(bow, 'hand')
      }
    } else {
      // Melee mode: trang bị sword
      if (!bot.heldItem || !bot.heldItem.name.includes('sword')) {
        await equipBestSword()
      }
    }

    // Check shield mỗi 2 giây - KHÔNG BLOCKING
    if (now - lastShieldCheck > 2000) {
      lastShieldCheck = now

      // Kiểm tra xem player có đang chặn khiên không (metadata 8 bit 0 = đang blocking)
      const playerMetadata = targetPlayer.metadata as any
      const isBlocking = playerMetadata?.[8] === 1 // Active hand = blocking

      if (isBlocking && !isCirclingBehind) {
        // Chỉ log mỗi 3 giây
        if (now - lastShieldLog > 3000) {
          console.log('🛡️ Player đang chặn khiên! Vòng ra sau lưng...')
          lastShieldLog = now
        }
        isCirclingBehind = true

        // Tính góc để vòng ra sau lưng player
        const angleToPlayer = Math.atan2(
          targetPlayer.position.z - bot.entity.position.z,
          targetPlayer.position.x - bot.entity.position.x
        )
        // Thêm 180 độ để ra sau lưng
        const behindAngle = angleToPlayer + Math.PI
        const behindX = targetPlayer.position.x + Math.cos(behindAngle) * 2
        const behindZ = targetPlayer.position.z + Math.sin(behindAngle) * 2

        try {
          const movements = new Movements(bot)
          movements.allowSprinting = true
          movements.allowParkour = true
          movements.canDig = false
          bot.pathfinder.setMovements(movements)

          const behindGoal = new goals.GoalNear(behindX, targetPlayer.position.y, behindZ, 1)
          bot.pathfinder.setGoal(behindGoal, true)

          // Nhảy khi vòng ra sau - KHÔNG AWAIT
          bot.setControlState('jump', true)
          bot.setControlState('sprint', true)

          setTimeout(() => {
            bot.setControlState('jump', false)
            isCirclingBehind = false
          }, 600)
        } catch (circleError) {
          isCirclingBehind = false
        }
      } else if (!isBlocking) {
        isCirclingBehind = false
      }
    }

    // Di chuyển về phía target và tấn công - HỖ TRỢ BOW/MELEE MODE
    // Tính khoảng cách 3D (bao gồm cả độ cao)
    const dx = targetPlayer.position.x - bot.entity.position.x
    const dy = targetPlayer.position.y - bot.entity.position.y
    const dz = targetPlayer.position.z - bot.entity.position.z
    const distance3D = Math.sqrt(dx * dx + dy * dy + dz * dz)
    const horizontalDistance = Math.sqrt(dx * dx + dz * dz)
    const heightDiff = Math.abs(dy)
    
    // Khoảng cách tấn công tùy theo chế độ
    const attackRange = bowModeActive ? 20 : 4 // Bow: 20 blocks, Melee: 4 blocks
    const approachRange = bowModeActive ? 15 : 2 // Bow: giữ khoảng cách 15, Melee: đến gần 2
    
    // Nếu player bay cao hơn 4 blocks, bot phải nhảy/leo lên (chỉ với melee)
    if (!bowModeActive && heightDiff > 4 && dy > 0) {
      if (now - lastHighJumpLog > 3000) {
        console.log(`🚀 Player bay cao! Độ cao: ${heightDiff.toFixed(1)} blocks`)
        lastHighJumpLog = now
      }
      
      try {
        const movements = new Movements(bot)
        movements.allowSprinting = true
        movements.allowParkour = true
        movements.canDig = false
        bot.pathfinder.setMovements(movements)

        const goal = new goals.GoalNear(
          targetPlayer.position.x, 
          targetPlayer.position.y, 
          targetPlayer.position.z, 
          3
        )
        bot.pathfinder.setGoal(goal, true)
        
        bot.setControlState('jump', true)
        bot.setControlState('sprint', true)
        
        setTimeout(() => {
          bot.setControlState('jump', false)
        }, 200)
      } catch (pathError) {
        bot.setControlState('jump', true)
        setTimeout(() => bot.setControlState('jump', false), 200)
      }
      
    } else if (horizontalDistance > attackRange) {
      // Player ở xa - di chuyển lại gần
      try {
        const movements = new Movements(bot)
        movements.allowSprinting = true
        movements.allowParkour = true
        movements.canDig = false
        bot.pathfinder.setMovements(movements)

        const goal = new goals.GoalNear(
          targetPlayer.position.x, 
          targetPlayer.position.y, 
          targetPlayer.position.z, 
          approachRange
        )
        bot.pathfinder.setGoal(goal, true)

        bot.setControlState('sprint', true)
      } catch (pathError) {
        bot.lookAt(targetPlayer.position)
        bot.setControlState('forward', true)
        bot.setControlState('sprint', true)
      }
      
    } else {
      // Trong tầm tấn công
      bot.pathfinder.setGoal(null)
      bot.setControlState('forward', false)
      bot.setControlState('sprint', true)

      if (targetPlayer && targetPlayer.isValid) {
        if (bowModeActive) {
          // Bow mode: bắn cung tầm xa
          await bowAttack(targetPlayer, distance3D)
        } else {
          // Melee mode: đánh kiếm
          meleeAttack(targetPlayer, distance3D)
        }
      }
    }
  }

  // Stop PVP function
  stopPvP = function(silent: boolean = false) {
    console.log('⏹️ Stopping PVP...')
    pvpActive = false
    pvpTargetName = ''
    hasWarnedWeakPlayer = false

    if (pvpInterval) {
      clearInterval(pvpInterval)
      pvpInterval = null
    }

    try {
      bot.pvp.stop()
      bot.pathfinder.setGoal(null)

      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('sprint', false)
    } catch (error) {
      // Ignore cleanup errors
    }

    if (!silent) {
      bot.chat('⚔️ Dừng PVP rồi!')
    }
    console.log('⏹️ PVP - Deactivated')
  }

  // ------------------ AI Helper Function (Groq - Llama 3) ------------------
  let lastAIChatTime = 0 // Cooldown cho AI chat
  
  async function callAI(prompt: string, systemPrompt?: string): Promise<string | null> {
    if (!groqApiKey) {
      console.log('⚠️ Groq API key không được cấu hình')
      return null
    }

    try {
      console.log(`🔍 Groq AI analyzing: "${prompt}"`)
      
      const Groq = (await import('groq-sdk')).default
      const groq = new Groq({ apiKey: groqApiKey })
      
      const messages: any[] = []
      
      // Validate và thêm system message
      if (systemPrompt && typeof systemPrompt === 'string' && systemPrompt.trim() !== '') {
        messages.push({
          role: 'system',
          content: systemPrompt.trim()
        })
      }
      
      // Validate user message
      if (!prompt || typeof prompt !== 'string' || prompt.trim() === '') {
        console.log('⚠️ Invalid prompt')
        return null
      }
      
      messages.push({
        role: 'user',
        content: prompt.trim()
      })

      console.log(`📤 Sending ${messages.length} messages to Groq`)

      const completion = await groq.chat.completions.create({
        model: 'llama-3.1-8b-instant', // Llama 3.1 8B - cực nhanh, miễn phí
        messages: messages,
        temperature: 0.7,
        max_tokens: 100, // Tăng lên 100 cho câu trả lời đầy đủ hơn
        top_p: 1,
        stream: false
      })

      const response = completion.choices[0]?.message?.content
      console.log(`✅ Groq response: ${response}`)
      return response || null
      
    } catch (error: any) {
      console.log('❌ Groq API Error:', error?.message || error)
      
      // Fallback responses bình thường
      const fallbacks = [
        'Tôi không hiểu câu hỏi của bạn.',
        'Xin lỗi, tôi cần thêm thông tin.',
        'Tôi chưa có câu trả lời cho điều này.',
        'Bạn có thể hỏi rõ hơn được không?'
      ]
      return fallbacks[Math.floor(Math.random() * fallbacks.length)]
    }
  }

  // ------------------ AI Agent Handler ------------------
  async function handleAIAgentCommand(username: string, actionRequest: string) {
    if (!groqApiKey) {
      // Im lặng nếu không có AI
      return
    }

    try {
      // Set flag AI Agent đang chạy
      aiAgentActive = true
      aiAgentShouldStop = false
      
      bot.chat(`🤖 AI đang phân tích: "${actionRequest}"...`)
      console.log(`🤖 AI Agent: Processing request from ${username}: ${actionRequest}`)

      // Gọi AI với fallback
      const systemPrompt = `Bạn là AI agent điều khiển bot Minecraft. Phân tích yêu cầu và trả về JSON với các hành động cụ thể.

Yêu cầu: "${actionRequest}"

Trả về JSON với format:
{
  "actions": [
    {"type": "move", "target": "tree", "distance": 10},
    {"type": "collect", "item": "oak_log", "count": 5},
    {"type": "craft", "item": "planks", "count": 20}
  ],
  "summary": "Tóm tắt ngắn gọn những gì bot sẽ làm"
}

Các loại action hợp lệ:
- move: Di chuyển đến (target: player_name, tree, water, cave, chest)
- collect: Thu thập item (item: oak_log, stone, dirt, wheat, etc.)
- dig: Đào block (block: stone, dirt, coal_ore, iron_ore, etc.)
- craft: Chế tạo (item: planks, stick, crafting_table, etc.)
- smelt: Nung (input: oak_log, iron_ore, output: charcoal, iron_ingot)
- attack: Tấn công (target: zombie, skeleton, creeper, etc.)
- follow: Theo player (player: username)
- chat: Nói (message: "Hello world")

Chỉ trả về JSON, không giải thích thêm.`

      const generatedText = await callAI(systemPrompt, '300')

      // Check nếu bị dừng
      if (aiAgentShouldStop) {
        bot.chat('⏸️ AI Agent đã bị dừng!')
        aiAgentActive = false
        return
      }

      if (!generatedText) {
        aiAgentActive = false
        return
      }

      // Parse JSON response
      let aiPlan
      try {
        // Làm sạch response (loại bỏ markdown code blocks nếu có)
        const cleanJson = generatedText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
        aiPlan = JSON.parse(cleanJson)
      } catch (parseError) {
        console.log('❌ JSON parse error:', parseError)
        bot.chat('😵 AI trả về format không hợp lệ!')
        aiAgentActive = false
        return
      }

      // Thông báo kế hoạch
      bot.chat(`✨ ${aiPlan.summary || 'Bắt đầu thực hiện!'}`)
      console.log('📋 AI Plan:', aiPlan)

      // Thực thi từng action
      for (let i = 0; i < aiPlan.actions.length; i++) {
        // Check nếu bị dừng
        if (aiAgentShouldStop) {
          bot.chat('⏸️ AI Agent đã bị dừng!')
          break
        }
        
        const action = aiPlan.actions[i]
        console.log(`🎯 Executing action ${i + 1}/${aiPlan.actions.length}:`, action)

        try {
          await executeAIAction(action, username)
          await new Promise(resolve => setTimeout(resolve, 1000)) // Delay giữa các action
        } catch (actionError) {
          console.log('❌ Action execution error:', actionError)
          bot.chat(`😵 Lỗi khi thực hiện: ${action.type}`)
          break
        }
      }

      if (!aiAgentShouldStop) {
        bot.chat('✅ Hoàn thành tất cả AI actions!')
      }
      console.log('✅ AI Agent: All actions completed')

    } catch (error) {
      console.log('❌ AI Agent error:', error)
      bot.chat('😵 Có lỗi khi xử lý AI command!')
    } finally {
      // Reset flag
      aiAgentActive = false
      aiAgentShouldStop = false
    }
  }

  // Thực thi một action cụ thể từ AI plan
  async function executeAIAction(action: any, requestUsername: string) {
    const actionType = action.type?.toLowerCase()

    switch (actionType) {
      case 'move':
        await executeAIMove(action)
        break
      case 'collect':
        await executeAICollect(action)
        break
      case 'dig':
        await executeAIDig(action)
        break
      case 'craft':
        await executeAICraft(action)
        break
      case 'smelt':
        await executeAISmelt(action)
        break
      case 'attack':
        await executeAIAttack(action)
        break
      case 'follow':
        await executeAIFollow(action, requestUsername)
        break
      case 'chat':
        bot.chat(action.message || 'Hello!')
        break
      default:
        console.log(`⚠️ Unknown action type: ${actionType}`)
    }
  }

  // AI Move action
  async function executeAIMove(action: any) {
    if (aiAgentShouldStop) return // Check stop flag
    
    const target = action.target?.toLowerCase()
    const distance = action.distance || 20

    bot.chat(`🚶 Đang di chuyển đến ${target}...`)

    if (target === 'tree') {
      const tree = bot.findBlock({
        matching: (block: any) => block && (block.name.includes('log') || block.name.includes('oak')),
        maxDistance: distance
      })
      if (tree) {
        await bot.pathfinder.goto(new goals.GoalNear(tree.position.x, tree.position.y, tree.position.z, 2))
        if (!aiAgentShouldStop) bot.chat(`✅ Đã đến cây!`)
      } else {
        bot.chat(`🥺 Không tìm thấy cây gần đây!`)
      }
    } else if (target === 'water') {
      const water = bot.findBlock({
        matching: (block: any) => block && block.name === 'water',
        maxDistance: distance
      })
      if (water) {
        await bot.pathfinder.goto(new goals.GoalNear(water.position.x, water.position.y, water.position.z, 2))
        if (!aiAgentShouldStop) bot.chat(`✅ Đã đến nước!`)
      } else {
        bot.chat(`🥺 Không tìm thấy nước!`)
      }
    } else {
      // Di chuyển ngẫu nhiên
      const currentPos = bot.entity.position
      const randomX = currentPos.x + (Math.random() - 0.5) * distance
      const randomZ = currentPos.z + (Math.random() - 0.5) * distance
      await bot.pathfinder.goto(new goals.GoalXZ(randomX, randomZ))
      if (!aiAgentShouldStop) bot.chat(`✅ Đã di chuyển!`)
    }
  }

  // AI Collect action
  async function executeAICollect(action: any) {
    if (aiAgentShouldStop) return // Check stop flag
    
    const itemName = action.item?.toLowerCase()
    const count = action.count || 5

    bot.chat(`🌳 Đang thu thập ${count} ${itemName}...`)

    for (let i = 0; i < count; i++) {
      if (aiAgentShouldStop) break // Check stop flag in loop
      
      const block = bot.findBlock({
        matching: (block: any) => block && block.name.toLowerCase().includes(itemName),
        maxDistance: 32
      })

      if (block) {
        await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 2))
        if (aiAgentShouldStop) break
        await bot.dig(block)
        await new Promise(resolve => setTimeout(resolve, 500))
      } else {
        bot.chat(`🥺 Chỉ thu thập được ${i}/${count} ${itemName}`)
        break
      }
    }

    if (!aiAgentShouldStop) bot.chat(`✅ Đã thu thập ${itemName}!`)
  }

  // AI Dig action
  async function executeAIDig(action: any) {
    const blockName = action.block?.toLowerCase()
    const count = action.count || 10

    bot.chat(`⛏️ Đang đào ${count} ${blockName}...`)

    // Trang bị pickaxe nếu cần
    if (blockName.includes('ore') || blockName.includes('stone')) {
      await equipBestPickaxe()
    }

    for (let i = 0; i < count; i++) {
      const block = bot.findBlock({
        matching: (block: any) => block && block.name.toLowerCase().includes(blockName),
        maxDistance: 32
      })

      if (block) {
        await bot.pathfinder.goto(new goals.GoalNear(block.position.x, block.position.y, block.position.z, 3))
        await bot.dig(block)
        await new Promise(resolve => setTimeout(resolve, 800))
      } else {
        bot.chat(`🥺 Chỉ đào được ${i}/${count} ${blockName}`)
        break
      }
    }

    bot.chat(`✅ Đã đào xong ${blockName}!`)
  }

  // AI Craft action
  async function executeAICraft(action: any) {
    const itemName = action.item?.toLowerCase()
    const count = action.count || 1

    bot.chat(`🔨 Đang chế tạo ${count} ${itemName}...`)

    // Placeholder - cần implement craft logic phức tạp hơn
    bot.chat(`⚠️ Craft chưa được implement đầy đủ!`)
  }

  // AI Smelt action
  async function executeAISmelt(action: any) {
    bot.chat(`🔥 Đang nung ${action.input} thành ${action.output}...`)
    bot.chat(`⚠️ Smelt chưa được implement đầy đủ!`)
  }

  // AI Attack action
  async function executeAIAttack(action: any) {
    const targetMob = action.target?.toLowerCase()

    bot.chat(`⚔️ Đang tìm và tấn công ${targetMob}...`)

    const mob = bot.nearestEntity((entity: any) => {
      if (!entity || !entity.position) return false
      const mobName = entity.name?.toLowerCase() || ''
      return mobName.includes(targetMob) && bot.entity.position.distanceTo(entity.position) < 20
    })

    if (mob) {
      await equipBestSwordForCombat()
      await bot.pathfinder.goto(new goals.GoalFollow(mob, 2))

      for (let i = 0; i < 10; i++) {
        if (mob.isValid) {
          bot.attack(mob)
          await new Promise(resolve => setTimeout(resolve, 500))
        } else {
          break
        }
      }

      bot.chat(`✅ Đã tấn công ${targetMob}!`)
    } else {
      bot.chat(`🥺 Không tìm thấy ${targetMob} gần đây!`)
    }
  }

  // AI Follow action
  async function executeAIFollow(action: any, requestUsername: string) {
    const playerName = action.player || requestUsername
    bot.chat(`👣 Đang theo ${playerName}...`)
    startFollowingPlayer(playerName)
  }

  // ------------------ Chat Commands ------------------
  bot.on('chat', async (username: string, message: string) => {
    // FAST LOG - không chờ
    console.log(`💬 [${username}]: ${message}`)

    // Bỏ qua chat từ bot, server, console và các plugin - NHANH HÚN
    if (username === bot.username ||
        username === 'server' ||
        username === 'console' ||
        username === 'Shop' ||
        username.startsWith('[') ||
        username.includes('Plugin') ||
        username.includes('System') ||
        username.includes('Admin') ||
        message.includes('plugin') ||
        message.includes('update available') ||
        message.includes('download at:') ||
        message.includes('spigotmc.org')) {
      return // NHANH - không log
    }

    // Update last command time - NHANH
    lastPlayerCommand = Date.now()
    const cleanMessage = message.toLowerCase().trim()

    // FAST COMMAND PROCESSING - xử lý ngay lập tức không chờ
    setImmediate(async () => {
      console.log(`🔍 Processing: "${cleanMessage}" từ ${username}`)

      // ============= LỆNH HELP - HIỂN THỊ DANH SÁCH LỆNH =============
      if (cleanMessage === 'chunhan' || cleanMessage === 'help' || cleanMessage === 'lệnh') {
        bot.chat('📋 Lệnh: theo, bảo vệ, dừng, farm, câu, đào <quặng>, rương, trồng, khám phá, pvp <tên>, thu thập, home, AI <yêu cầu>')
        return
      }

      // ============= KIỂM TRA QUYỀN ĐIỀU KHIỂN BOT =============
      // Danh sách các lệnh điều khiển cần kiểm tra quyền
      const controlCommands = [
        'theo', 'bảo vệ', 'dừng', 'stop', 'farm', 'câu', 'fishing',
        'auto mine', 'auto đào', 'dừng đào', 'stop mining',
        'auto xây', 'dừng xây', 'stop build',
        'auto tìm rương', 'auto chest', 'dừng tìm rương', 'dừng chest', 'stop chest',
        'auto explore', 'tự khám phá', 'dừng explore', 'stop explore',
        'auto thu thập', 'auto collect', 'thu thập', 'dừng thu thập', 'stop collect',
        'auto farmer', 'crop farm', 'dừng farmer', 'stop farmer',
        'pvp ', 'ngủ', 'cần', 'cất đồ', 'home', 'về nhà',
        'spam attack', 'tấn công spam', 'en '
      ]
      
      // Kiểm tra xem có phải lệnh điều khiển không
      const isControlCommand = controlCommands.some(cmd => cleanMessage.includes(cmd)) ||
                               message.startsWith('AI ') || message.startsWith('ai ')
      
      if (isControlCommand) {
        // Kiểm tra quyền
        if (!isPlayerAuthorized(username)) {
          console.log(`🚫 Player "${username}" không có quyền điều khiển bot`)
          // Bot không phản hồi gì cả - im lặng hoàn toàn
          return
        }
        console.log(`✅ Player "${username}" có quyền điều khiển bot`)
      }

      // KIỂM TRA AI AGENT COMMAND TRƯỚC TIÊN - ƯU TIÊN CAO
      if (message.startsWith('AI ') || message.startsWith('ai ')) {
        const actionRequest = message.substring(3).trim()
        if (actionRequest) {
          await handleAIAgentCommand(username, actionRequest)
          return
        }
      }

      // Xử lý các lệnh chat - TỐI ƯU HÓA THỨ TỰ CÁC LỆNH HAY DÙNG NHẤT
      if (cleanMessage.includes('dừng') || cleanMessage.includes('stop')) {
        // LỆNH DỪNG - ƯU TIÊN CAO NHẤT
        stopAll()
        return
      } else if (cleanMessage.startsWith('auto xây ')) {
        // LỆNH AUTO XÂY - THỨ TỰ CAO
        // Lấy loại công trình từ lệnh
        const buildType = message.substring(9).trim() // Lấy phần sau "auto xây "
        if (buildType) {
          // Kiểm tra có lệnh "phẳng" để clear terrain trước
          if (buildType.includes('phẳng') || buildType.includes('clear')) {
            const realBuildType = buildType.replace(/phẳng|clear/g, '').trim()
            autoBuildManager.startSmartAutoBuild(realBuildType || 'nhà nhỏ')
          } else {
            autoBuildManager.startSmartAutoBuild(buildType)
          }
        } else {
          bot.chat('🏠 Các loại công trình có sẵn:')
          bot.chat('🏘️ Nhà nhỏ: auto xây nhà nhỏ')
          bot.chat('🗼 Tháp: auto xây tháp nhỏ')
          bot.chat('🌉 Cầu: auto xây cầu')
          bot.chat('🌱 Dọn phẳng: auto xây phẳng [loại]')
          bot.chat('✨ Nhanh, đẹp và tiết kiệm vật liệu!')
        }
      } else if (cleanMessage.includes('dừng xây') || cleanMessage.includes('stop build')) {
        autoBuildManager.stopSmartAutoBuild()
      } else if (cleanMessage.includes('theo')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác

        // Kiểm tra xem có chỉ định player cụ thể không
        const followMatch = cleanMessage.match(/theo\s+(.+)/)
        if (followMatch && followMatch[1].trim() !== '' && !cleanMessage.startsWith('theo tớ')) {
          const targetName = followMatch[1].trim()
          followingManager.startFollowingPlayer(targetName)
        } else {
          followingManager.startFollowingPlayer(username)
        }
      } else if (cleanMessage.includes('bảo vệ')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác

        // Kiểm tra xem có chỉ định player cụ thể không
        const protectMatch = cleanMessage.match(/bảo vệ\s+(.+)/)
        if (protectMatch && protectMatch[1].trim() !== '' && !cleanMessage.startsWith('bảo vệ tớ')) {
          const targetName = protectMatch[1].trim()
          protectingManager.startProtectingPlayer(targetName)
        } else {
          protectingManager.startProtectingPlayer(username)
        }
      // Bow commands removed
      } else if (cleanMessage.includes('ngủ')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác
        goSleep()
      } else if (cleanMessage.includes('cần')) {
        giveItemToPlayer(username, message)
      } else if (cleanMessage.includes('cất đồ')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác
        storeItemsInChest()
      } else if (cleanMessage.includes('auto farmer') || cleanMessage.includes('crop farm')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác
        startAutoCropFarmer()
      } else if (cleanMessage.includes('dừng farmer') || cleanMessage.includes('stop farmer')) {
        stopAutoCropFarmer()
      } else if (cleanMessage.includes('auto farm all') || cleanMessage.includes('farm')) {
        if (autoFishingActive) stopAutoFishing() // Dừng câu khi có lệnh khác
        autoFarmManager.startAutoFarmAll()
      } else if (cleanMessage.startsWith('tớ hỏi nè')) {
        handleQuestionWithAI(username, message)
      } else if (cleanMessage.includes('auto câu') || cleanMessage.includes('fishing')) {
        startSmartAutoFishing()
      } else if (cleanMessage.includes('dừng câu') || cleanMessage.includes('stop fishing')) {
        stopSmartAutoFishing()
      } else if (cleanMessage.includes('auto eat') || cleanMessage.includes('auto ăn')) {
        // Turn on auto eat mode
        startAutoEatMode()
      } else if (cleanMessage === 'off' || cleanMessage === 'tắt chat') {
        // Silence bot chat completely
        chatEnabled = false
        console.log('🤫 Chat đã tắt - bot sẽ im lặng trong mọi hành động')
      } else if (cleanMessage === 'on' || cleanMessage === 'bật chat') {
        // Re-enable bot chat
        chatEnabled = true
        bot.chat('💬 Chat đã bật - tớ sẽ nói chuyện như bình thường!')
        console.log('💬 Chat enabled')
      } else if (cleanMessage.includes('auto mine') || cleanMessage.includes('auto đào')) {
        // Parse ore type from command
        const oreMatch = cleanMessage.match(/(?:auto mine|auto đào)\s+(\w+)/)
        if (oreMatch) {
          const oreType = oreMatch[1].toLowerCase()
          startAutoMining(oreType)
        } else {
          bot.chat('🤔 Cậu muốn đào quặng gì? VD: "auto mine diamond" hoặc "auto đào iron"')
          bot.chat('📝 Các loại quặng: diamond, iron, gold, coal, copper, emerald, redstone, lapis')
        }
      } else if (cleanMessage.includes('dừng đào') || cleanMessage.includes('stop mining')) {
        if (autoMiningActive) {
          stopAutoMining()
        } else {
          bot.chat('🤔 Tớ không đang đào mà!')
        }
      // Auto chest hunting commands
      } else if (cleanMessage.includes('auto tìm rương') || cleanMessage.includes('auto chest')) {
        startAutoChestHunting()
      } else if (cleanMessage.includes('dừng tìm rương') || cleanMessage.includes('dừng chest') || cleanMessage.includes('stop chest')) {
        stopAutoChestHunting()
      // End auto chest hunting commands
      // Auto Explore commands
      } else if (cleanMessage.includes('auto explore') || cleanMessage.includes('tự khám phá')) {
        startAutoExplore()
      } else if (cleanMessage.includes('dừng explore') || cleanMessage.includes('stop explore')) {
        stopAutoExplore()
      // End Auto Explore commands
      // Auto Collect commands
      } else if (cleanMessage.includes('auto thu thập') || cleanMessage.includes('auto collect') || cleanMessage.includes('thu thập')) {
        startAutoCollect()
      } else if (cleanMessage.includes('dừng thu thập') || cleanMessage.includes('stop collect')) {
        stopAutoCollect()
      // Home command
      } else if (cleanMessage === 'home' || cleanMessage === 'về nhà') {
        goHome()
      // End Auto Collect commands
      // PVP commands
      } else if (cleanMessage.startsWith('pvp ')) {
        // Standard PVP command: pvp <playername>
        const targetName = message.substring(4).trim()
        if (targetName) {
          startPvP(targetName)
        } else {
          bot.chat('🤔 Cậu muốn PVP với ai? VD: "pvp Steve"')
        }
      } else if (cleanMessage === 'list players' || cleanMessage === 'danh sách players') {
        // Debug command: hiển thị danh sách players
        const allPlayers = Object.keys(bot.players)
        if (allPlayers.length > 0) {
          bot.chat(`📋 Players trong server: [${allPlayers.join(', ')}]`)
          console.log(`📋 DEBUG - Danh sách players:`, allPlayers)
        } else {
          bot.chat('📋 Không có player nào trong server (ngoài tớ)')
          console.log('📋 DEBUG - Player list empty')
        }
      // End PVP commands
      } else if (cleanMessage.startsWith('hãy nói ')) {
        // Chức năng lặp lại câu nói
        const textToRepeat = message.substring(8).trim() // Lấy phần sau "hãy nói "
        if (textToRepeat) {
          bot.chat(textToRepeat)
          console.log(`🔊 Bot lặp lại: "${textToRepeat}"`)
        } else {
          bot.chat('🤔 Cậu muốn tớ nói gì?')
        }
      } else if (cleanMessage.includes('spam attack') || cleanMessage.includes('tấn công spam')) {
        // Kích hoạt chế độ spam attack đặc biệt
        bot.chat('🔥 SPAM ATTACK MODE ON! Tớ sẽ đánh cực nhanh không delay!')
        console.log('🔥 Spam Attack Mode: ACTIVATED')

        // Tìm và spam attack mob gần nhất
        const nearestMob = bot.nearestEntity((entity: any) => {
          if (!entity || !entity.position) return false
          const distance = bot.entity.position.distanceTo(entity.position)
          if (distance > 10) return false

          const hostileMobs = [
            'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'pillager', 'vindicator',
            'evoker', 'husk', 'stray', 'phantom', 'drowned', 'enderman', 'breeze', 'bogged',
            'slime', 'silverfish', 'cave_spider'
          ]
          const mobName = entity.name ? entity.name.toLowerCase() : ''
          const displayName = entity.displayName ? entity.displayName.toLowerCase() : ''

          const isHostile = hostileMobs.some(mobType =>
            mobName.includes(mobType) || displayName.includes(mobType)
          )

          const isMobType = entity.type === 'mob' &&
                           !mobName.includes('villager') &&
                           !mobName.includes('iron_golem')

          return isHostile || isMobType
        })

        if (nearestMob) {
          equipBestWeapon()
          bot.setControlState('sprint', true)

          // ULTRA MEGA SPAM - 20 lần tấn công liên tiếp
          for (let megaSpam = 0; megaSpam < 20; megaSpam++) {
            meleeAttack(nearestMob, bot.entity.position.distanceTo(nearestMob.position))
          }
          bot.chat('⚔️ MEGA SPAM COMPLETE! 20x attacks delivered!')
        } else {
          bot.chat('🤔 Không thấy mob nào để spam attack!')
        }
      } else if (cleanMessage.startsWith('en ')) {
        // Chức năng enchant công cụ
        const toolName = message.substring(3).trim()
        await handleEnchantTool(username, toolName)
      } else if (!isCommand(cleanMessage)) {
        // Chat thường không phải lệnh - sử dụng AI để trả lời
        console.log(`🧠 Đang suy nghĩ để trả lời chat: "${message}"`)
        await handleChatWithAI(username, message)
      }
    })
  })

  // Theo dõi player join game
  bot.on('playerJoined', (player: any) => {
    if (player.username !== bot.username) {
      console.log(`🎉 Player ${player.username} joined game`)
      // Không chào từng player nữa - chỉ log thôi
    }
  })

  // Theo dõi player left game
  bot.on('playerLeft', (player: any) => {
    if (player.username !== bot.username) {
      console.log(`👋 Player ${player.username} left game`)
    }
  })

  // ------------------ Enchant Tool Function ------------------
  async function handleEnchantTool(username: string, toolName: string) {
    if (!toolName) {
      bot.chat('🤔 Cậu muốn tớ enchant công cụ gì? VD: en diamond_sword')
      return
    }

    try {
      // Bước 1: Kiểm tra quyền OP bằng cách thử enchant đơn giản
      bot.chat('🔍 Kiểm tra quyền OP...')

      // Thử lệnh gamemode để test OP permission
      try {
        bot.chat('/gamemode survival')
        await new Promise(resolve => setTimeout(resolve, 1000))

        // Nếu không có lỗi chat về permission thì có OP
        if (typeof bot.chat === 'function') { // Check if chat function is callable
          console.log('✅ Bot có quyền OP - có thể enchant')
        } else {
           throw new Error("Chat function unavailable");
        }
      } catch (error) {
        bot.chat('🥺 Tớ không có quyền OP để enchant!')
        return
      }

      // Bước 2: Tìm công cụ trong túi đồ
      const toolItem = bot.inventory.items().find(item => {
        const itemName = item.name.toLowerCase()
        const searchName = toolName.toLowerCase()
        return itemName.includes(searchName) ||
               itemName === searchName ||
               itemName.replace('_', '').includes(searchName.replace('_', ''))
      })

      if (!toolItem) {
        bot.chat(`🥺 Không có ${toolName} trong túi để enchant!`)
        bot.chat('Có lỗi rồi')
        return
      }

      // Bước 3: Trang bị công cụ
      await bot.equip(toolItem, 'hand')
      bot.chat(`⚔️ Đã cầm ${toolItem.name}, bắt đầu enchant!`)

      await new Promise(resolve => setTimeout(resolve, 1000))

      // Bước 4: Enchant theo loại công cụ với lệnh đúng định dạng
      const itemName = toolItem.name.toLowerCase()
      let enchantSuccess = true

      if (itemName.includes('sword')) {
        // Enchant cho kiếm với delay dài hơn và format đúng
        bot.chat(`⚔️ Enchant kiếm khó ra dòng xịn lắm`)
        bot.chat(`/enchant sharpness 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant sweeping 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant looting 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fire_aspect 2`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant knockback 2`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('helmet')) {
        // Enchant cho mũ với delay dài hơn
        bot.chat(`Enchant tốn thời gian ghê!!`)
        bot.chat(`/enchant protection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fireprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant blastprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant projectileprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant respiration 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant aquaaffinity 1`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('chestplate')) {
        // Enchant cho áo giáp với delay dài hơn
        bot.chat(`🛡️ Enchant áo giáp`)
        bot.chat(`/enchant protection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fireprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant blastprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant projectileprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('leggings')) {
        // Enchant cho quần với delay dài hơn
        bot.chat(`👖 Enchant quần`)
        bot.chat(`/enchant protection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fireprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant blastprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant projectileprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('boots')) {
        // Enchant cho giày với delay dài hơn
        bot.chat(`👢 Enchant giày`)
        bot.chat(`/enchant protection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fireprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant blastprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant projectileprotection 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant featherfalling 4`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant depthstrider 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('bow')) {
        // Enchant cho cung với delay dài hơn
        bot.chat(`🏹 Enchant cung với power tối đa!`)
        bot.chat(`/enchant power 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant punch 2`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant flame 1`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant infinity 1`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('trident')) {
        // Enchant cho đinh ba với delay dài hơn
        bot.chat(`🔱 Enchant đinh ba với impaling tối đa!`)
        bot.chat(`/enchant impaling 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant loyalty 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant channeling 1`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('pickaxe')) {
        // Enchant cho cuốc với delay dài hơn
        bot.chat(`⛏️ Enchant pickaxe`)
        bot.chat(`/enchant efficiency 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant fortune 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('axe')) {
        // Enchant cho rìu với delay dài hơn
        bot.chat(`🪓 Enchant rìu `)
        bot.chat(`/enchant efficiency 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant sharpness 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('shovel')) {
        // Enchant cho xẻng với delay dài hơn
        bot.chat(`🥄 Enchant xẻng`)
        bot.chat(`/enchant efficiency 5`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else if (itemName.includes('elytra')) {
        // Enchant cho cánh với delay dài hơn
        bot.chat(`🪶 Enchant elytra!`)
        bot.chat(`/enchant unbreaking 3`)
        await new Promise(resolve => setTimeout(resolve, 1200))
        bot.chat(`/enchant mending 1`)

      } else {
        bot.chat(`🤔 Không biết cách enchant ${toolItem.name}`)
        enchantSuccess = false
      }

      // Bước 5: Hoàn thành với kiểm tra kết quả
      await new Promise(resolve => setTimeout(resolve, 2000))

      if (enchantSuccess) {
        bot.chat(`✨ Hoàn tất enchant ${toolItem.name}! Nè`)
      } else {
        bot.chat(`🤔 Không thể enchant ${toolItem.name} - không hỗ trợ loại này!`)
      }
      bot.chat('Có lỗi rồi')

    } catch (error) {
      console.log('❌ Lỗi enchant tool:', error)
      bot.chat('🥺 Có lỗi khi enchant!')
      bot.chat('Có lỗi rồi')
    }
  }

  // ------------------ Function kiểm tra có phải command không ------------------
  function isCommand(message: string): boolean {
    const commands = [
      'auto xây', 'dừng xây', 'stop build',
      'theo', 'bảo vệ', 'dừng', 'stop',
      'ngủ', 'cần', 'cất đồ',
      'farm', 'auto farm all', 'spam attack',
      'auto farmer', 'crop farm', 'dừng farmer', 'stop farmer',
      'tớ hỏi nè', 'auto câu', 'fishing',
      'dừng câu', 'stop fishing',

      'auto tìm rương', 'auto chest', 'dừng tìm rương', 'dừng chest', 'stop chest',
      'auto explore', 'tự khám phá', 'dừng explore', 'stop explore',
      'hãy nói', 'en '
    ]

    return commands.some(cmd => message.includes(cmd))
  }

  // ------------------ Player Join Welcome ------------------
  function welcomePlayer(username: string) {
    const welcomeMessages = [
      `🎉 Chào mừng ${username} đến server! Tớ là bot helper đây~`,
      `✨ Xin chào ${username}! Cần giúp gì cứ gọi tớ nhé!`,
      `🌟 Hi ${username}! Tớ có thể giúp cậu với nhiều thứ đấy!`,
      `💫 Chào ${username}! Tớ ở đây để hỗ trợ cậu!`,
      `🎈 Welcome ${username}! Tớ là bot thông minh nè~`
    ]

    const randomMessage = welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]

    // Delay ngẫu nhiên 1-3 giây để tự nhiên hơn
    const delay = 1000 + Math.random() * 2000
    setTimeout(() => {
      bot.chat(randomMessage)
    }, delay)
  }

  // ------------------ AI Chat Handler cho chat thường ------------------
  async function handleChatWithAI(username: string, message: string) {
    if (!groqApiKey) {
      console.log('⚠️ Groq API key không được cấu hình, bỏ qua AI chat')
      return
    }

    // Cooldown 3 phút (180 giây)
    const now = Date.now()
    const cooldownTime = 180000 // 3 phút = 180000ms
    
    if (now - lastAIChatTime < cooldownTime) {
      const remainingTime = Math.ceil((cooldownTime - (now - lastAIChatTime)) / 1000)
      console.log(`⏳ AI cooldown: còn ${remainingTime}s`)
      return // Im lặng, không trả lời
    }

    try {
      console.log(`🤖 Groq AI đang phân tích chat từ ${username}: "${message}"`)

      const systemPrompt = `Bạn là bot Minecraft tên ice.

Phong cách trả lời:
- Xưng tôi, gọi bạn
- Không dùng emoji
- Trả lời bình thường, tự nhiên
- Dưới 100 ký tự để chat game không bị cắt
- Trả lời ngắn gọn, súc tích`

      const generatedText = await callAI(message, systemPrompt)

      if (generatedText && generatedText.trim() !== '') {
        // Trả lời AI trong game - cắt ngắn cho chat
        const aiResponse = generatedText.substring(0, 100)
        bot.chat(aiResponse)
        console.log(`💬 Groq AI đã trả lời: "${aiResponse}"`)
        
        // Cập nhật thời gian chat cuối
        lastAIChatTime = now
      } else {
        console.log(`🤖 Groq AI không có phản hồi`)
      }
    } catch (error: any) {
      console.error(`❌ Lỗi Groq AI chat với ${username}:`, error?.message || error)
    }
  }

  // ------------------ Question AI Response ------------------
  async function handleQuestionWithAI(username: string, message: string) {
    if (!groqApiKey) {
      return
    }

    // Cooldown 3 phút
    const now = Date.now()
    const cooldownTime = 180000
    
    if (now - lastAIChatTime < cooldownTime) {
      const remainingTime = Math.ceil((cooldownTime - (now - lastAIChatTime)) / 1000)
      console.log(`⏳ AI cooldown: còn ${remainingTime}s`)
      return
    }

    try {
      const question = message.replace(/tớ hỏi nè/i, '').trim()
      const systemPrompt = `Bạn là bot Minecraft tên ice.

Trả lời câu hỏi:
- Ngắn gọn, súc tích (dưới 100 ký tự)
- Xưng tôi, gọi bạn
- Không dùng emoji
- Trả lời bình thường, tự nhiên
- Nếu không biết, thừa nhận thẳng thắn`

      const generatedText = await callAI(`${systemPrompt}\n\nCâu hỏi: ${question}`, '120')

      if (generatedText && generatedText.trim() !== '') {
        const aiResponse = generatedText.substring(0, 100)
        bot.chat(aiResponse)
        lastAIChatTime = now
      } else {
        console.log('⚠️ No AI available for question')
      }
    } catch (error: any) {
      console.log('❌ Lỗi AI question:', (error as any)?.message || error)
    }
  }

  // ------------------ Follow / Protect ------------------
  startFollowingPlayer = function(username: string) {
    // Tìm player entity với nhiều cách khác nhau
    let playerEntity = bot.players[username]?.entity

    // Nếu không tìm thấy, thử tìm theo tên không có dấu chấm
    if (!playerEntity && username.startsWith('.')) {
      const nameWithoutDot = username.substring(1)
      playerEntity = bot.players[nameWithoutDot]?.entity
    }

    // Nếu vẫn không tìm thấy, thử tìm theo tên có dấu chấm
    if (!playerEntity && !username.startsWith('.')) {
      const nameWithDot = '.' + username
      playerEntity = bot.players[nameWithDot]?.entity
    }

    // Tìm trong tất cả players nếu vẫn không thấy
    if (!playerEntity) {
      const allPlayers = Object.keys(bot.players)
      console.log(`🔍 Tìm kiếm player: ${username} trong danh sách:`, allPlayers)

      // Tìm player gần đúng
      for (const playerName of allPlayers) {
        if (playerName.toLowerCase().includes(username.toLowerCase()) ||
            username.toLowerCase().includes(playerName.toLowerCase())) {
          playerEntity = bot.players[playerName]?.entity
          console.log(`✅ Tìm thấy player tương ứng: ${playerName}`)
          break
        }
      }
    }

    if (!playerEntity) {
      bot.chat(`🥺 Cậu phải ở trong tầm nhìn của tớ thì tớ mới đi theo được!!?`)
      console.log(`❌ Không tìm thấy player: ${username}`)
      return
    }

    targetPlayer = playerEntity
    bot.chat(`❤️ Tớ sẽ theo cậu đến cùng trời cuối đất!`)
    stopProtecting()
    itemCollectionDisabled = false // Bật lại nhặt đồ khi dùng chức năng
    startFollowing()
    console.log(`✅ Bắt đầu theo ${username}`)
  }

  function startFollowing() {
    isFollowing = true
    if (followInterval) clearInterval(followInterval)

    let tpFailCount = 0 // Đếm số lần /tp thất bại
    let lastBoatCheck = 0 // Track lần cuối kiểm tra thuyền
    let isInBoat = false // Track trạng thái đang ngồi thuyền
    let hasAskedToJoinBoat = false // Track đã xin ngồi cùng chưa
    let lastMovementTime = 0 // Track để giảm spam movement

    followInterval = setInterval(async () => {
      if (!targetPlayer || !targetPlayer.isValid) {
        stopFollowing()
        return
      }

      const targetPos = targetPlayer.position
      const distance = bot.entity.position.distanceTo(targetPos)
      const currentTime = Date.now()

      // TRANG BỊ CÔNG CỤ PHÙHỢP KHI ĐI THEO (không phải combat) - giảm frequency
      if (currentTime % 15000 < 2000) { // Mỗi 15 giây kiểm tra 1 lần thay vì 10 giây
        equipBestToolForFollowing()
      }

      // KIỂM TRA THUYỀN MỖI 2 GIÂY
      if (currentTime - lastBoatCheck > 2000) {
        lastBoatCheck = currentTime

        // Kiểm tra xem player có đang ngồi thuyền không - CHẶT CHẼ HƠN
        const playerVehicle = targetPlayer.vehicle
        const isPlayerOnBoat = playerVehicle && 
                               playerVehicle.name && 
                               (playerVehicle.name === 'boat' || 
                                playerVehicle.name === 'oak_boat' ||
                                playerVehicle.name === 'spruce_boat' ||
                                playerVehicle.name === 'birch_boat' ||
                                playerVehicle.name === 'jungle_boat' ||
                                playerVehicle.name === 'acacia_boat' ||
                                playerVehicle.name === 'dark_oak_boat' ||
                                playerVehicle.name === 'mangrove_boat' ||
                                playerVehicle.name === 'cherry_boat' ||
                                playerVehicle.name === 'bamboo_raft')

        // Debug log
        if (playerVehicle) {
          console.log(`🔍 Player vehicle: ${playerVehicle.name}, isBoat: ${isPlayerOnBoat}`)
        }

        // Nếu player vừa mới ngồi lên thuyền và bot chưa xin ngồi cùng
        if (isPlayerOnBoat && !isInBoat && !hasAskedToJoinBoat) {
          // Chat dễ thương xin ngồi cùng
          const cuteMessages = [
            '🥺 Cậu đi thuyền à? Cho tớ ngồi cùng được không?',
            '🛥️ Ơ cậu lên thuyền rồi! Tớ cũng muốn ngồi cùng~',
            '💕 Đợi tớ với! Tớ cũng muốn đi thuyền cùng cậu!',
            '🌊 Cậu đi thuyền mà không rủ tớ sao? Cho tớ lên với~'
          ]
          const randomMessage = cuteMessages[Math.floor(Math.random() * cuteMessages.length)]
          bot.chat(randomMessage)
          hasAskedToJoinBoat = true
          
          console.log(`🛥️ Player ${targetPlayer.username} đã ngồi thuyền, bot đang tìm thuyền để ngồi cùng...`)
        }

        // Tìm thuyền gần nhất trong bán kính 8 blocks (tăng từ 5 lên 8)
        const nearbyBoats = Object.values(bot.entities).filter((entity: any) => {
          if (!entity || !entity.position || !entity.name) return false
          if (!entity.name.includes('boat')) return false
          const boatDistance = bot.entity.position.distanceTo(entity.position)
          return boatDistance <= 8 // Tăng bán kính tìm kiếm
        })

        // Nếu player đang ngồi thuyền và bot chưa ngồi
        if (isPlayerOnBoat && !isInBoat && nearbyBoats.length > 0) {
          try {
            // Tìm thuyền gần nhất
            let closestBoat = nearbyBoats[0]
            let closestDistance = bot.entity.position.distanceTo(closestBoat.position)
            
            for (const boat of nearbyBoats) {
              const dist = bot.entity.position.distanceTo(boat.position)
              if (dist < closestDistance) {
                closestBoat = boat
                closestDistance = dist
              }
            }

            console.log(`🎯 Tìm thấy thuyền gần nhất cách ${closestDistance.toFixed(1)} blocks`)

            // Nếu thuyền quá xa, di chuyển đến gần trước (tăng ngưỡng từ 2 lên 3)
            if (closestDistance > 3) {
              const movements = new Movements(bot)
              movements.allowSprinting = true
              movements.canDig = false
              bot.pathfinder.setMovements(movements)
              bot.pathfinder.setGoal(new goals.GoalNear(
                closestBoat.position.x, 
                closestBoat.position.y, 
                closestBoat.position.z, 
                1
              ))
              
              console.log(`🚶 Di chuyển đến thuyền...`)
            }

            // Đợi 2 giây rồi thử ngồi lên thuyền (tăng từ 1.5 lên 2)
            setTimeout(async () => {
              try {
                // Kiểm tra lại khoảng cách trước khi mount (tăng từ 3 lên 4)
                const currentDistance = bot.entity.position.distanceTo(closestBoat.position)
                if (currentDistance <= 4 && closestBoat.isValid) {
                  await bot.mount(closestBoat)
                  isInBoat = true
                  bot.chat('🛥️ Hehe, tớ lên thuyền rồi! Đi thôi~')
                  console.log(`✅ Bot đã ngồi lên thuyền thành công`)
                } else {
                  console.log(`⚠️ Thuyền quá xa hoặc không hợp lệ (${currentDistance.toFixed(1)} blocks)`)
                  hasAskedToJoinBoat = false // Reset để thử lại
                }
              } catch (mountError: any) {
                console.log(`❌ Lỗi khi ngồi lên thuyền:`, mountError.message)
                hasAskedToJoinBoat = false // Reset để thử lại
              }
            }, 2000) // Tăng từ 1500ms lên 2000ms
          } catch (error: any) {
            console.log(`❌ Lỗi khi tìm thuyền:`, error.message)
            hasAskedToJoinBoat = false // Reset để thử lại
          }
        } 
        // Nếu player xuống thuyền thì bot cũng xuống ngay
        else if (isInBoat && !isPlayerOnBoat) {
          try {
            await bot.dismount()
            isInBoat = false
            hasAskedToJoinBoat = false // Reset flag
            bot.chat('🛥️ Cậu xuống thuyền rồi à? Tớ cũng xuống theo!')
            console.log(`✅ Bot đã xuống thuyền vì player xuống`)
          } catch (error: any) {
            console.log(`❌ Lỗi khi xuống thuyền:`, error.message)
            isInBoat = false // Reset trạng thái
            hasAskedToJoinBoat = false
          }
        }
        // Nếu bot cách xa player quá (player di chuyển xa)
        else if (isInBoat && distance > 8) {
          try {
            await bot.dismount()
            isInBoat = false
            hasAskedToJoinBoat = false
            bot.chat('🛥️ Cậu đi xa quá! Tớ xuống thuyền theo cậu!')
            console.log(`✅ Bot đã xuống thuyền vì player đi xa`)
          } catch (error: any) {
            console.log(`❌ Lỗi khi xuống thuyền:`, error.message)
            isInBoat = false
            hasAskedToJoinBoat = false
          }
        }
        // Reset flag nếu player không còn ngồi thuyền
        else if (!isPlayerOnBoat && hasAskedToJoinBoat) {
          hasAskedToJoinBoat = false
        }
      }

      // Nếu đang ngồi thuyền và gần player thì không cần làm gì thêm
      if (isInBoat && distance <= 4) {
        return
      }

      // Nếu quá xa thì teleport
      if (distance > 14) {
        try {
          // Kiểm tra quyền /tp
          if (hasTpPermission === false) {
            console.log('⚠️ Không có quyền /tp, không thể theo player xa')
            return
          }

          // Sử dụng safeTeleport
          const tpSuccess = safeTeleport(`/tp ${bot.username} ${targetPlayer.username}`)
          
          if (!tpSuccess) {
            console.log('⚠️ Không thể /tp (cooldown hoặc không có quyền)')
            return
          }

          // Kiểm tra thành công sau 2 giây
          setTimeout(() => {
            if (!targetPlayer || !targetPlayer.isValid) return

            const newDistance = bot.entity.position.distanceTo(targetPlayer.position)
            if (newDistance > 15) {
              console.log('⚠️ Teleport không thành công')
            } else {
              console.log('✅ Teleport thành công')
            }
          }, 2500)

        } catch (e) {
          tpFailCount++
          if (tpFailCount >= 3) {
            bot.chat('🥺 Tớ không thể đến gần cậu! Dừng theo dõi!')
            stopFollowing()
            return
          }
        }
        return
      }

      // Reset count khi ở gần
      if (distance <= 12) {
        tpFailCount = 0
      }

      // Di chuyển theo logic cải tiến - giảm spam movement
      if (!isInBoat && distance > 3 && currentTime - lastMovementTime > 1000) {
        lastMovementTime = currentTime

        try {
          // Sử dụng createSmartMovements() để tự động cho phép đào nếu không có OP
          const movements = createSmartMovements()
          movements.allow1by1towers = true
          movements.allowEntityDetection = true
          movements.allowFreeMotion = true
          movements.canOpenDoors = true
          movements.infiniteLiquidDropCost = 5
          movements.scafoldingBlocks = [bot.registry.itemsByName.cobblestone?.id, bot.registry.itemsByName.dirt?.id].filter(Boolean)
          bot.pathfinder.setMovements(movements)

          // Sử dụng GoalNear thay vì GoalFollow để ổn định hơn
          const followDistance = distance > 8 ? 3 : 2
          bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, followDistance))

        } catch (error) {
          // Silent fail để giảm spam log
        }
      }
    }, 1500) // Giảm frequency từ 2000ms xuống 1500ms cho responsive hơn
  }

  stopFollowing = function() {
    isFollowing = false
    if (followInterval) clearInterval(followInterval)
    followInterval = null
    bot.pathfinder.setGoal(null)
  }

  startProtectingPlayer = function(username: string) {
    // Tìm player entity với nhiều cách khác nhau
    let playerEntity = bot.players[username]?.entity

    // Nếu không tìm thấy, thử tìm theo tên không có dấu chấm
    if (!playerEntity && username.startsWith('.')) {
      const nameWithoutDot = username.substring(1)
      playerEntity = bot.players[nameWithoutDot]?.entity
    }

    // Nếu vẫn không tìm thấy, thử tìm theo tên có dấu chấm
    if (!playerEntity && !username.startsWith('.')) {
      const nameWithDot = '.' + username
      playerEntity = bot.players[nameWithDot]?.entity
    }

    // Tìm trong tất cả players nếu vẫn không thấy
    if (!playerEntity) {
      const allPlayers = Object.keys(bot.players)
      console.log(`🔍 Tìm kiếm player: ${username} trong danh sách:`, allPlayers)

      // Tìm player gần đúng
      for (const playerName of allPlayers) {
        if (playerName.toLowerCase().includes(username.toLowerCase()) ||
            username.toLowerCase().includes(playerName.toLowerCase())) {
          playerEntity = bot.players[playerName]?.entity
          console.log(`✅ Tìm thấy player tương ứng: ${playerName}`)
          break
        }
      }
    }

    if (!playerEntity) {
      bot.chat(`🥺 Cậu phải ở gần tớ thì tớ mới bảo vệ được!?💞`)
      console.log(`❌ Không tìm thấy player: ${username}`)
      return
    }

    targetPlayer = playerEntity
    bot.chat(`🛡️ Tớ sẽ bảo vệ cậu khỏi tất cả nguy hiểm!`)
    stopFollowing()
    itemCollectionDisabled = false // Bật lại nhặt đồ khi dùng chức năng
    startProtecting()
    console.log(`✅ Bắt đầu bảo vệ ${username}`)
  }

  // Biến kiểm tra quyền OP
  let hasOpPermission: boolean | null = null
  let hasTriedOpCommand = false
  let lastOpCheckTime = 0

  function startProtecting() {
    isProtecting = true
    if (protectInterval) clearInterval(protectInterval)

    // Tắt nhặt đồ khi bảo vệ để tập trung chiến đấu
    itemCollectionDisabled = true

    // Tự động trang bị giáp tốt nhất khi bắt đầu bảo vệ
    equipBestArmor()

    // Tự động trang bị khiên vào offhand nếu có
    const shield = bot.inventory.items().find(item => item.name.includes('shield'))
    if (shield) {
      bot.equip(shield, 'off-hand').then(() => {
        console.log('🛡️ Đã trang bị khiên vào offhand sẵn sàng!')
        bot.chat('🛡️ Đã trang bị khiên để chống Creeper!')
      }).catch(e => {
        console.log('⚠️ Không thể trang bị khiên:', e)
      })
    }

    // Reset OP check khi bắt đầu bảo vệ mới
    hasOpPermission = null
    hasTriedOpCommand = false
    lastOpCheckTime = 0
    let lastMovementTime = 0 // Track để giảm spam movement logs
    let lastBoatCheck = 0 // Track lần cuối kiểm tra thuyền
    let isInBoat = false // Track trạng thái đang ngồi thuyền
    let hasAskedToJoinBoat = false // Track đã xin ngồi cùng chưa

    protectInterval = setInterval(async () => {
      if (!targetPlayer || !targetPlayer.isValid) {
        stopProtecting()
        return
      }

      const targetPos = targetPlayer.position
      const distanceToPlayer = bot.entity.position.distanceTo(targetPos)
      const health = bot.health
      const protectTime = Date.now()

      // KIỂM TRA THUYỀN MỖI 2 GIÂY - GIỐNG NHƯ FOLLOW
      if (protectTime - lastBoatCheck > 2000) {
        lastBoatCheck = protectTime

        // Kiểm tra xem player có đang ngồi thuyền không - CHẶT CHẼ HƠN
        const playerVehicle = targetPlayer.vehicle
        const isPlayerOnBoat = playerVehicle && 
                               playerVehicle.name && 
                               (playerVehicle.name === 'boat' || 
                                playerVehicle.name === 'oak_boat' ||
                                playerVehicle.name === 'spruce_boat' ||
                                playerVehicle.name === 'birch_boat' ||
                                playerVehicle.name === 'jungle_boat' ||
                                playerVehicle.name === 'acacia_boat' ||
                                playerVehicle.name === 'dark_oak_boat' ||
                                playerVehicle.name === 'mangrove_boat' ||
                                playerVehicle.name === 'cherry_boat' ||
                                playerVehicle.name === 'bamboo_raft')

        // Debug log
        if (playerVehicle) {
          console.log(`🔍 Player vehicle: ${playerVehicle.name}, isBoat: ${isPlayerOnBoat}`)
        }

        // Nếu player vừa mới ngồi lên thuyền và bot chưa xin ngồi cùng
        if (isPlayerOnBoat && !isInBoat && !hasAskedToJoinBoat) {
          // Chat dễ thương xin ngồi cùng
          const cuteMessages = [
            '🥺 Cậu đi thuyền à? Tớ cũng muốn ngồi cùng để bảo vệ cậu!',
            '🛥️ Đợi tớ với! Tớ phải ngồi cùng mới bảo vệ được cậu~',
            '💕 Cậu lên thuyền rồi! Cho tớ ngồi cùng nhé, tớ sẽ bảo vệ cậu!',
            '🌊 Tớ cũng lên thuyền với cậu! Có tớ ở đây an toàn mà~'
          ]
          const randomMessage = cuteMessages[Math.floor(Math.random() * cuteMessages.length)]
          bot.chat(randomMessage)
          hasAskedToJoinBoat = true
          
          console.log(`🛥️ Player ${targetPlayer.username} đã ngồi thuyền, bot đang tìm thuyền để bảo vệ...`)
        }

        // Tìm thuyền gần nhất trong bán kính 5 blocks
        const nearbyBoats = Object.values(bot.entities).filter((entity: any) => {
          if (!entity || !entity.position || !entity.name) return false
          if (!entity.name.includes('boat')) return false
          const boatDistance = bot.entity.position.distanceTo(entity.position)
          return boatDistance <= 5
        })

        // Nếu player đang ngồi thuyền và bot chưa ngồi
        if (isPlayerOnBoat && !isInBoat && nearbyBoats.length > 0) {
          try {
            // Tìm thuyền gần nhất
            let closestBoat = nearbyBoats[0]
            let closestDistance = bot.entity.position.distanceTo(closestBoat.position)
            
            for (const boat of nearbyBoats) {
              const dist = bot.entity.position.distanceTo(boat.position)
              if (dist < closestDistance) {
                closestBoat = boat
                closestDistance = dist
              }
            }

            console.log(`🎯 Tìm thấy thuyền gần nhất cách ${closestDistance.toFixed(1)} blocks`)

            // Nếu thuyền quá xa, di chuyển đến gần trước
            if (closestDistance > 2) {
              const movements = new Movements(bot)
              movements.allowSprinting = true
              movements.canDig = false
              bot.pathfinder.setMovements(movements)
              bot.pathfinder.setGoal(new goals.GoalNear(
                closestBoat.position.x, 
                closestBoat.position.y, 
                closestBoat.position.z, 
                1
              ))
              
              console.log(`🚶 Di chuyển đến thuyền...`)
            }

            // Đợi 1.5 giây rồi thử ngồi lên thuyền
            setTimeout(async () => {
              try {
                // Kiểm tra lại khoảng cách trước khi mount
                const currentDistance = bot.entity.position.distanceTo(closestBoat.position)
                if (currentDistance <= 3 && closestBoat.isValid) {
                  await bot.mount(closestBoat)
                  isInBoat = true
                  bot.chat('🛥️ Tớ lên thuyền rồi! Yên tâm đi, tớ bảo vệ cậu~')
                  console.log(`✅ Bot đã ngồi lên thuyền để bảo vệ`)
                } else {
                  console.log(`⚠️ Thuyền quá xa hoặc không hợp lệ (${currentDistance.toFixed(1)} blocks)`)
                  hasAskedToJoinBoat = false // Reset để thử lại
                }
              } catch (mountError: any) {
                console.log(`❌ Lỗi khi ngồi lên thuyền:`, mountError.message)
                hasAskedToJoinBoat = false // Reset để thử lại
              }
            }, 1500)
          } catch (error: any) {
            console.log(`❌ Lỗi khi tìm thuyền:`, error.message)
            hasAskedToJoinBoat = false // Reset để thử lại
          }
        } 
        // Nếu player xuống thuyền thì bot cũng xuống ngay
        else if (isInBoat && !isPlayerOnBoat) {
          try {
            await bot.dismount()
            isInBoat = false
            hasAskedToJoinBoat = false // Reset flag
            bot.chat('🛥️ Cậu xuống thuyền rồi à? Tớ cũng xuống theo!')
            console.log(`✅ Bot đã xuống thuyền vì player xuống`)
          } catch (error: any) {
            console.log(`❌ Lỗi khi xuống thuyền:`, error.message)
            isInBoat = false // Reset trạng thái
            hasAskedToJoinBoat = false
          }
        }
        // Nếu bot cách xa player quá (player di chuyển xa)
        else if (isInBoat && distanceToPlayer > 8) {
          try {
            await bot.dismount()
            isInBoat = false
            hasAskedToJoinBoat = false
            bot.chat('🛥️ Cậu đi xa quá! Tớ xuống thuyền theo cậu!')
            console.log(`✅ Bot đã xuống thuyền vì player đi xa`)
          } catch (error: any) {
            console.log(`❌ Lỗi khi xuống thuyền:`, error.message)
            isInBoat = false
            hasAskedToJoinBoat = false
          }
        }
        // Reset flag nếu player không còn ngồi thuyền
        else if (!isPlayerOnBoat && hasAskedToJoinBoat) {
          hasAskedToJoinBoat = false
        }
      }

      // ✅ CHO PHÉP TẤN CÔNG MOB KHI NGỒI THUYỀN
      // Removed blocking logic - bot có thể tấn công khi ngồi thuyền

      // Auto buff khi máu yếu - giảm frequency check
      if (health < 8 && (protectTime - lastOpCheckTime) > 15000) { // Tăng lên 15 giây
        lastOpCheckTime = protectTime

        if (hasOpPermission === null && !hasTriedOpCommand) {
          hasTriedOpCommand = true
          bot.chat(`/effect give ${bot.username} regeneration 5 100 true`)
          setTimeout(() => bot.chat('Đòi ăn ai'), 100)

          setTimeout(() => {
            if (bot.health > health) {
              hasOpPermission = true
            } else {
              hasOpPermission = false
              bot.chat('🥺 Tớ không có quyền OP để tự buff, nhưng vẫn bảo vệ cậu!')
            }
          }, 3000)

        } else if (hasOpPermission === true) {
          bot.chat(`/effect give ${bot.username} regeneration 5 100 true`)
          setTimeout(() => bot.chat(`/effect give ${bot.username} strength 5 2 true`), 100)
          setTimeout(() => bot.chat('Đòi ăn ai'), 200)
        }
      }

      // Tìm quái gần nhất - CHỈ NHỮNG CON NHÌN THẤY (không xuyên tường)
      let mob = bot.nearestEntity((entity: any) => {
        if (!entity || !entity.position) return false

        const distanceToMob = bot.entity.position.distanceTo(entity.position)
        if (distanceToMob > 20) return false // Tăng lên 20 blocks để phát hiện sớm hơn

        const hostileMobs = [
          'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'pillager', 'vindicator', 'evoker',
          'husk', 'stray', 'phantom', 'drowned', 'enderman', 'breeze', 'bogged',
          'slime', 'silverfish', 'cave_spider'
        ]
        const mobName = entity.name ? entity.name.toLowerCase() : ''
        const displayName = entity.displayName ? entity.displayName.toLowerCase() : ''

        const isHostile = hostileMobs.some(mobType =>
          mobName.includes(mobType) || displayName.includes(mobType)
        )

        const isMobType = entity.type === 'mob' &&
                         !mobName.includes('villager') &&
                         !mobName.includes('iron_golem')

        // KIỂM TRA LINE OF SIGHT - CHỈ TẤN CÔNG QUÁI NHÌN THẤY
        if (isHostile || isMobType) {
          // Sử dụng hàm hasLineOfSight để kiểm tra chính xác
          if (!hasLineOfSight(entity)) {
            return false // Có tường chắn, bỏ qua mob này
          }
          
          return true
        }

        return false
      })

      // KIỂM TRA CREEPER GẦN VÀ CHỐNG KHIÊN - ƯU TIÊN CAO NHẤT (cũng cần line of sight)
      const nearbyCreeper = bot.nearestEntity((entity: any) => {
        if (!entity || !entity.position) return false
        const mobName = entity.name ? entity.name.toLowerCase() : ''
        const displayName = entity.displayName ? entity.displayName.toLowerCase() : ''
        const isCreeper = (mobName.includes('creeper') || displayName.includes('creeper'))
        
        if (isCreeper) {
          // Kiểm tra line of sight cho Creeper
          if (!hasLineOfSight(entity)) {
            return false // Creeper bị tường chắn, bỏ qua
          }
          return true
        }
        
        return false
      })

      if (nearbyCreeper) {
        const creeperDistance = bot.entity.position.distanceTo(nearbyCreeper.position)
        
        // Nếu Creeper gần trong 3 blocks
        if (creeperDistance <= 3) {
          // Kiểm tra có khiên không
          const shield = bot.inventory.items().find(item => 
            item.name.includes('shield')
          )
          
          if (shield) {
            // Trang bị khiên vào offhand nếu chưa có
            const offhandItem = bot.inventory.slots[45]
            if (!offhandItem || !offhandItem.name.includes('shield')) {
              try {
                await bot.equip(shield, 'off-hand')
                console.log('🛡️ Đã trang bị khiên vào offhand!')
              } catch (e) {
                console.log('⚠️ Không thể trang bị khiên:', e)
              }
            }
            
            // Nhìn thẳng vào Creeper
            await bot.lookAt(nearbyCreeper.position.offset(0, nearbyCreeper.height * 0.5, 0))
            
            // Chống khiên xuống (giữ chuột phải)
            if (!isBlockingWithShield) {
              bot.activateItem() // Bắt đầu chống khiên
              isBlockingWithShield = true
              lastShieldBlockTime = Date.now()
              console.log('🛡️ CHỐNG KHIÊN! Creeper cách ' + Math.floor(creeperDistance) + ' blocks!')
              bot.chat('🛡️ Chống khiên chống Creeper!')
            }
            
            // Giữ chống khiên trong 2 giây
            if (isBlockingWithShield && (Date.now() - lastShieldBlockTime) > 2000) {
              bot.deactivateItem() // Thả khiên
              isBlockingWithShield = false
              console.log('🛡️ Đã hạ khiên')
            }
            
            // Không tấn công khi đang chống khiên, chỉ lùi lại
            if (creeperDistance < 4) {
              bot.setControlState('back', true)
              setTimeout(() => bot.setControlState('back', false), 500)
            }
            
            return // Dừng logic tấn công thường, ưu tiên chống khiên
          }
        } else if (isBlockingWithShield) {
          // Creeper đã xa, hạ khiên
          bot.deactivateItem()
          isBlockingWithShield = false
          console.log('🛡️ Creeper đã xa, hạ khiên')
        }
      } else if (isBlockingWithShield) {
        // Không còn Creeper, hạ khiên
        bot.deactivateItem()
        isBlockingWithShield = false
        console.log('🛡️ Không còn Creeper, hạ khiên')
      }

      // LOGIC BẢO VỆ CẢI THIỆN với ít spam log hơn
      if (distanceToPlayer > 14) { // Giảm ngưỡng teleport xuống 14 blocks
        try {
          // Sử dụng safeTeleport thay vì bot.chat trực tiếp
          const tpSuccess = safeTeleport(`/tp ${bot.username} ${targetPlayer.username}`)
          
          if (tpSuccess) {
            bot.pvp.stop()
          } else {
            // Không thể /tp, dùng pathfinder với khả năng đào
            const movements = createSmartMovements()
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
          }

          setTimeout(() => {
            if (!targetPlayer || !targetPlayer.isValid) return

            const newDistance = bot.entity.position.distanceTo(targetPlayer.position)
            if (newDistance > 15) {
              // Setup safe movement với khả năng đào
              const movements = createSmartMovements()
              bot.pathfinder.setMovements(movements)
              bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
            }
          }, 2500)
        } catch (e) {
          // Fallback movement với khả năng đào
          const movements = createSmartMovements()
          movements.canDig = false // Không đào xuyên tường
          movements.allowSprinting = true
          bot.pathfinder.setMovements(movements)
          bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
        }
      } else if (mob && health > 6 && !isEating) {
        // CÓ QUÁI VÀ ĐỦ MÁU: TẤN CÔNG (chỉ quái nhìn thấy)
        const mobDistance = bot.entity.position.distanceTo(mob.position)
        const mobName = mob.name || mob.displayName || 'Unknown'
        
        // Log xác nhận đã nhìn thấy mob - CHỈ LOG 1 LẦN KHI MỚI PHÁT HIỆN
        // Removed spam log - chỉ log khi cần debug

        // Trang bị vũ khí chỉ khi cần thiết
        const currentWeapon = bot.heldItem
        if (!currentWeapon || !currentWeapon.name.includes('sword')) {
          equipBestSwordForCombat()
          await new Promise(resolve => setTimeout(resolve, 200))
        }

        // ✅ LOGIC ĐẶC BIỆT KHI NGỒI THUYỀN
        if (isInBoat) {
          // Khi ngồi thuyền, chỉ tấn công mob trong tầm, không di chuyển
          if (mobDistance <= 4) {
            // Mob đủ gần, tấn công trực tiếp
            bot.pathfinder.setGoal(null)
            bot.setControlState('sprint', false) // Không sprint khi ngồi thuyền
            
            if (mob && mob.isValid) {
              // Tấn công nhiều lần
              for (let attack = 0; attack < 10; attack++) {
                meleeAttack(mob, mobDistance)
              }
            }
          } else {
            // Mob xa, không làm gì (không thể di chuyển khi ngồi thuyền)
            bot.pathfinder.setGoal(null)
          }
        }
        // LOGIC BÌNH THƯỜNG KHI KHÔNG NGỒI THUYỀN
        else if (distanceToPlayer > 8) {
          // Quá xa player, quay về
          bot.pvp.stop()
          const movements = createSmartMovements()
          bot.pathfinder.setMovements(movements)
          bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
        } else if (mobDistance > 4) {
          // Tiến đến mob nhanh hơn
          const mobPos = mob.position
          const futureDistanceToPlayer = targetPlayer.position.distanceTo(mobPos)

          if (futureDistanceToPlayer <= 8) { // Tăng từ 6 lên 8 để tấn công chủ động hơn
            const movements = createSmartMovements()
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.setGoal(new goals.GoalNear(mobPos.x, mobPos.y, mobPos.z, 1)) // Giảm từ 2 xuống 1 để đến gần hơn
            bot.setControlState('sprint', true) // Bật sprint ngay
          } else {
            // Mob quá xa, ưu tiên player
            const movements = createSmartMovements()
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 3))
          }
        } else {
          // Tấn công trực tiếp
          bot.pathfinder.setGoal(null)
          bot.setControlState('sprint', true)

          if (mob && mob.isValid) {
            // Tăng số đòn tấn công lên 10 để giết nhanh hơn
            for (let attack = 0; attack < 10; attack++) {
              meleeAttack(mob, mobDistance)
            }
          }
        }
      } else if (health <= 6) {
        // MÁU YẾU: Về gần player
        bot.pvp.stop()
        const movements = new Movements(bot)
        movements.allowSprinting = true
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2))
      } else if (distanceToPlayer > 4 && protectTime - lastMovementTime > 2000) {
        // KHÔNG CÓ QUÁI VÀ XA PLAYER: Di chuyển về gần - giảm spam logs
        lastMovementTime = protectTime
        bot.pvp.stop()
        const movements = new Movements(bot)
        movements.allowSprinting = true
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2))
      }

    }, 200) // Giảm xuống 200ms (0.2 giây) để phản xạ cực nhanh
  }

  stopProtecting = function() {
    isProtecting = false
    if (protectInterval) {
      clearInterval(protectInterval)
      protectInterval = null
    }

    // Hạ khiên nếu đang chống
    if (isBlockingWithShield) {
      bot.deactivateItem()
      isBlockingWithShield = false
      console.log('🛡️ Dừng bảo vệ - hạ khiên')
    }

    // Bật lại nhặt đồ khi dừng bảo vệ
    itemCollectionDisabled = false

    bot.pvp.stop()
    bot.pathfinder.setGoal(null)
  }

  function stopAll() {
    // Dừng tất cả hoạt động SILENT - không chat
    
    // Dừng AI Agent
    if (aiAgentActive) {
      aiAgentShouldStop = true
      console.log('🛑 Stopping AI Agent...')
    }
    
    if (followInterval) {
      clearInterval(followInterval)
      followInterval = null
    }
    if (protectInterval) {
      clearInterval(protectInterval)
      protectInterval = null
    }

    // Dừng fishing silent
    autoFishingActive = false
    autoItemCollectionDisabled = false
    autoEquipDisabled = false
    isFishing = false
    hasFishBitten = false
    if (fishingInterval) {
      clearInterval(fishingInterval)
      fishingInterval = null
    }
    if (hookCheckInterval) {
      clearInterval(hookCheckInterval)
      hookCheckInterval = null
    }

    // Dừng build silent
    autoBuildActive = false
    currentBuildProject = null
    buildProgress = 0

    // Dừng mining silent
    if (autoMiningActive) {
      autoMiningActive = false
      if (miningInterval) {
        clearInterval(miningInterval)
        miningInterval = null
      }
      isCurrentlyDigging = false
    }

  // Dừng farm silent
  if (autoFarmActive) stopAutoFarm()

    // Dừng chest hunting silent
    if (autoChestHuntingActive) {
      autoChestHuntingActive = false
      isCurrentlyApproachingChest = false
      currentChestTarget = null
      if (chestHuntingInterval) {
        clearInterval(chestHuntingInterval)
        chestHuntingInterval = null
      }
    }

    // Dừng crop farmer silent
    if (autoCropFarmerActive) {
      autoCropFarmerActive = false
      currentHoeTool = null
      harvestedCrops.clear()
      if (cropFarmerInterval) {
        clearInterval(cropFarmerInterval)
        cropFarmerInterval = null
      }
    }

    // Dừng PVP (gọi stopPvP silent để tránh spam chat)
    if (pvpActive) {
      stopPvP(true) // true = silent mode, không chat
    }

    // Dừng auto explore silent
    if (autoExploreActive) {
      autoExploreActive = false
      exploreDirection = null
      discoveredStructures.clear()
      if (exploreInterval) {
        clearInterval(exploreInterval)
        exploreInterval = null
      }
    }

    // Dừng auto collect silent
    if (autoCollectActive) {
      autoCollectActive = false
      if (collectInterval) {
        clearInterval(collectInterval)
        collectInterval = null
      }
    }

    // Reset states
    isFollowing = false
    isProtecting = false

    // Dừng PVP và pathfinder
    try {
      bot.pvp.stop()
    } catch (e) {
      // Ignore PVP stop errors
    }

    try {
      bot.pathfinder.setGoal(null)
    } catch (e) {
      // Ignore pathfinder errors
    }

    // CHỈ CHAT 1 LẦN DUY NHẤT
    if (bot && bot._client && bot._client.state === 'play') {
      bot.chat(`🛑 Dừng tất cả rồi nha cậu! 💕`)
    }
    console.log('⏹️ Dừng tất cả hoạt động')
  }

  // ------------------ Sleep ------------------
  async function goSleep() {
    console.log('😴 Yêu cầu bot đi ngủ')

    if (bot.time.isDay) {
      bot.chat(`☀️ Trời đang sáng mà cậu, chưa đi ngủ được đâu!`)
      return
    }

    // Tìm giường trong bán kính 32 blocks (tăng từ 16)
    const bedBlock = bot.findBlock({
      matching: (block: any) => {
        return block.name.includes('bed')
      },
      maxDistance: 32 // Tăng từ 16 lên 32
    })

    if (bedBlock) {
      const distance = bot.entity.position.distanceTo(bedBlock.position)
      console.log(`🛏️ Tìm thấy giường cách ${distance.toFixed(1)} blocks`)
      
      bot.chat(`😴 Tớ buồn ngủ quá, đi ngủ thôi nào!`)
      
      try {
        // Nếu giường xa hơn 3 blocks, di chuyển đến gần trước
        if (distance > 3) {
          console.log(`🚶 Di chuyển đến giường...`)
          const movements = new Movements(bot)
          movements.allowSprinting = true
          movements.canDig = false
          bot.pathfinder.setMovements(movements)
          
          // Di chuyển đến gần giường
          bot.pathfinder.setGoal(new goals.GoalNear(
            bedBlock.position.x,
            bedBlock.position.y,
            bedBlock.position.z,
            2
          ))
          
          // Đợi di chuyển đến gần (tối đa 10 giây)
          let waitTime = 0
          while (waitTime < 10000) {
            await new Promise(resolve => setTimeout(resolve, 500))
            waitTime += 500
            
            const currentDistance = bot.entity.position.distanceTo(bedBlock.position)
            if (currentDistance <= 3) {
              console.log(`✅ Đã đến gần giường`)
              break
            }
          }
        }
        
        // Thử ngủ
        await bot.sleep(bedBlock)
        bot.chat(`Zzz... 😴`)
        console.log(`✅ Bot đã ngủ thành công`)
      } catch (err: any) {
        bot.chat(`😢 Tớ không ngủ được ở đây. Cậu tìm chỗ khác nhé.`)
        console.log('❌ Lỗi ngủ:', err.message || err)
      }
    } else {
      bot.chat(`🛌 Tớ không tìm thấy giường nào trong bán kính 32 blocks.`)
      console.log('❌ Không tìm thấy giường')
    }
  }

  // ------------------ Give Item ------------------
  async function giveItemToPlayer(username: string, msg: string) {
    const match = msg.match(/cần (\d+) (\w+)/)
    if (!match) return

    const qty = parseInt(match[1])
    const name = match[2]

    // Tìm player entity với nhiều cách khác nhau
    let playerEntity = bot.players[username]?.entity

    // Nếu không tìm thấy, thử tìm theo tên không có dấu chấm
    if (!playerEntity && username.startsWith('.')) {
      const nameWithoutDot = username.substring(1)
      playerEntity = bot.players[nameWithoutDot]?.entity
    }

    // Nếu vẫn không tìm thấy, thử tìm theo tên có dấu chấm
    if (!playerEntity && !username.startsWith('.')) {
      const nameWithDot = '.' + username
      playerEntity = bot.players[nameWithDot]?.entity
    }

    // Tìm trong tất cả players nếu vẫn không thấy
    if (!playerEntity) {
      const allPlayers = Object.keys(bot.players)
      for (const playerName of allPlayers) {
        if (playerName.toLowerCase().includes(username.toLowerCase()) ||
            username.toLowerCase().includes(playerName.toLowerCase())) {
          playerEntity = bot.players[playerName]?.entity
          break
        }
      }
    }

    if (!playerEntity) {
      bot.chat(`🥺 Không thấy cậu để đưa ${name}`)
      return
    }

    const item = bot.inventory.items().find(i => i.name.includes(name))
    if (!item) {
      bot.chat(`🥺 Không có ${name}`)
      return
    }

    try {
      const distance = bot.entity.position.distanceTo(playerEntity.position)
      
      // BƯỚC 1: Di chuyển đến gần player 2 blocks nếu xa
      if (distance > 2.5) {
        bot.chat(`🏃 Đợi tớ một chút, đang đến gần để đưa ${name} nè~`)
        
        const movements = new Movements(bot)
        movements.canDig = false
        movements.allow1by1towers = false
        bot.pathfinder.setMovements(movements)
        bot.pathfinder.setGoal(new goals.GoalNear(playerEntity.position.x, playerEntity.position.y, playerEntity.position.z, 2))
        
        // Đợi bot đến gần (timeout 10 giây)
        const startTime = Date.now()
        while (bot.entity.position.distanceTo(playerEntity.position) > 2.5) {
          if (Date.now() - startTime > 10000) {
            bot.chat(`🥺 Không thể đến gần được, cậu lại gần tớ nhé!`)
            bot.pathfinder.setGoal(null)
            return
          }
          await new Promise(resolve => setTimeout(resolve, 100))
        }
        
        bot.pathfinder.setGoal(null)
      }
      
      // BƯỚC 2: Chat để player đứng yên
      bot.chat(`📍 Đứng yên giúp tớ nhé, tớ sắp ném ${name} rồi! 🎁`)
      await new Promise(resolve => setTimeout(resolve, 500))
      
      // BƯỚC 3: Nhìn vào chân player (feet position)
      const feetPosition = playerEntity.position.clone()
      await bot.lookAt(feetPosition)
      await new Promise(resolve => setTimeout(resolve, 300))
      
      // BƯỚC 4: Ném vật phẩm
      await bot.toss(item.type, null, qty)
      bot.chat(`🎁 Đã ném ${qty} ${item.name} cho cậu rồi nè! ✨`)
      console.log(`✅ Đã ném ${qty} ${item.name} cho ${username}`)
      
    } catch (error) {
      console.log('❌ Lỗi ném item:', error)
      bot.chat(`🥺 Có lỗi khi ném ${name}, thử lại nhé!`)
    }
  }

  // ------------------ Cất đồ vào rương ------------------
  async function storeItemsInChest() {
    try {
      bot.chat('📦 Tớ sẽ cất TẤT CẢ đồ vào rương và sắp xếp theo ưu tiên!')

      // Tìm rương gần nhất
      const chestBlock = bot.findBlock({
        matching: (block: any) => {
          return block.name.includes('chest') ||
                 block.name.includes('barrel') ||
                 block.name.includes('shulker')
        },
        maxDistance: 32
      })

      if (!chestBlock) {
        bot.chat('🥺 Tớ không tìm thấy rương nào gần để cất đồ...')
        return
      }

      // Di chuyển đến rương
      const goal = new goals.GoalNear(chestBlock.position.x, chestBlock.position.y, chestBlock.position.z, 1)
      await bot.pathfinder.goto(goal)

      // Mở rương và cất đồ
      await bot.lookAt(chestBlock.position, true)
      const chest = await bot.openChest(chestBlock)

      // Phân loại đồ theo ưu tiên: khoáng sản > thức ăn > block > linh tinh
      const categorizedItems = {
        minerals: [] as any[],
        food: [] as any[],
        blocks: [] as any[],
        misc: [] as any[]
      }

      // Danh sách khoáng sản
      const minerals = ['diamond', 'emerald', 'gold', 'iron', 'coal', 'redstone', 'lapis', 'quartz', 'netherite', 'copper', 'amethyst']
      // Danh sách thức ăn
      const foods = ['bread', 'apple', 'meat', 'fish', 'potato', 'carrot', 'beef', 'pork', 'chicken', 'mutton', 'salmon', 'cod', 'golden_apple', 'enchanted_golden_apple', 'cookie', 'cake', 'pie', 'soup', 'stew']
      // Danh sách block
      const blocks = ['stone', 'dirt', 'grass', 'wood', 'log', 'plank', 'cobblestone', 'sand', 'gravel', 'glass', 'wool', 'brick', 'concrete', 'terracotta']

      // Phân loại items
      for (const item of bot.inventory.items()) {
        const itemName = item.name.toLowerCase()

        if (minerals.some(mineral => itemName.includes(mineral))) {
          categorizedItems.minerals.push(item)
        } else if (foods.some(food => itemName.includes(food))) {
          categorizedItems.food.push(item)
        } else if (blocks.some(block => itemName.includes(block))) {
          categorizedItems.blocks.push(item)
        } else {
          categorizedItems.misc.push(item)
        }
      }

      let storedCount = 0

      const storeCategory = async (items: any[], categoryName: string) => {
        for (const item of items) {
          try {
            await chest.deposit(item.type, null, item.count)
            storedCount++
            console.log(`📦 Cất ${categoryName}: ${item.name} x${item.count}`)
            await new Promise(resolve => setTimeout(resolve, 100))
          } catch (error) {
            console.log('Lỗi cất', categoryName, ':', error)
          }
        }
      }

      // Cất theo thứ tự ưu tiên
      await storeCategory(categorizedItems.minerals, 'khoáng sản')
      await storeCategory(categorizedItems.food, 'thức ăn')
      await storeCategory(categorizedItems.blocks, 'block')
      await storeCategory(categorizedItems.misc, 'linh tinh')

      chest.close()

      bot.chat(`✅ Đã cất TẤT CẢ ${storedCount} items theo ưu tiên:`)
      bot.chat(`💎 Khoáng sản: ${categorizedItems.minerals.length}`)
      bot.chat(`🍞 Thức ăn: ${categorizedItems.food.length}`)
      bot.chat(`🧱 Block: ${categorizedItems.blocks.length}`)
      bot.chat(`📦 Linh tinh: ${categorizedItems.misc.length}`)

    } catch (error) {
      bot.chat('🥺 Có lỗi khi cất đồ...')
      console.log('Lỗi store items:', error)
    }
  }

  // ------------------ Auto Farm All ------------------
  startAutoFarmAll = function() {
    autoFarmActive = true
    itemCollectionDisabled = false // Bật lại nhặt đồ khi farm

    // Reset OP check cho farm mode
    hasOpPermission = null
    hasTriedOpCommand = false
    lastOpCheckTime = 0

    bot.chat('🗡️ Bắt đầu farm tất cả mob')

    const farmInterval = setInterval(async () => {
      if (!autoFarmActive) {
        clearInterval(farmInterval)
        return
      }

      try {
        // Trang bị vũ khí tốt nhất
        equipBestWeapon()

        // TÌM MOB GẦN NHẤT TRƯỚC TIÊN - ưu tiên gần nhất
        let mob = bot.nearestEntity((entity: any) => {
          if (!entity || !entity.position) return false

          const distance = bot.entity.position.distanceTo(entity.position)
          if (distance > 25) return false // Phạm vi tìm kiếm tối đa 25 blocks

          // Các loại mob cần farm - UPDATED LIST (loại bỏ 'horse')
          const farmableMobs = [
            'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'slime',
            'cow', 'pig', 'chicken', 'sheep', 'rabbit', // Loại bỏ 'horse'
            'zombie_villager', 'husk', 'stray', 'phantom', 'drowned',
            'pillager', 'vindicator', 'evoker', 'ravager', 'enderman', 'xtray', 'sulked',
            'breeze', 'bogged', 'silverfish', 'cave_spider'
          ]

          const mobName = entity.name ? entity.name.toLowerCase() : ''
          const displayName = entity.displayName ? entity.displayName.toLowerCase() : ''

          // Loại trừ các mob không nên farm
          if (mobName.includes('villager') ||
              mobName.includes('iron_golem') ||
              mobName.includes('wolf') ||
              mobName.includes('horse') ||
              entity.username) {
            return false
          }

          // Kiểm tra theo tên
          const isFarmable = farmableMobs.some(mobType =>
            mobName.includes(mobType) || displayName.includes(mobType)
          )

          // Hoặc kiểm tra theo type
          const isMobType = entity.type === 'mob'

          return isFarmable || isMobType
        })

        // Kiểm tra máu vàsử dụng effect nếu cần (tương tự như protect mode)
        const health = bot.health
        const autoFarmTime = Date.now()
        if (health < 8 && (autoFarmTime - lastOpCheckTime) > 10000) { // Tăng lên 10 giây
          lastOpCheckTime = autoFarmTime

          if (hasOpPermission === null && !hasTriedOpCommand) {
            hasTriedOpCommand = true
            bot.chat(`/effect give ${bot.username} regeneration 5 100 true`)
            setTimeout(() => bot.chat('Đòi ăn ai'), 100)

            setTimeout(() => {
              if (bot.health > health) {
                hasOpPermission = true
                console.log('✅ Farm mode: Bot có quyền OP')
              } else {
                hasOpPermission = false
                console.log('❌ Farm mode: Bot không có quyền OP')
              }
            }, 3000)

          } else if (hasOpPermission === true) {
            // AUTO FARM: LOẠI BỎ speed và resistance - chỉ dùng regeneration và strength
            bot.chat(`/effect give ${bot.username} regeneration 5 100 true`)
            setTimeout(() => bot.chat(`/effect give ${bot.username} strength 5 2 true`), 100)
            setTimeout(() => bot.chat('Đòi ăn ai'), 200)
            console.log('💪 Auto farm: Bot đã tự buff!')
          }
        }

        if (mob) {
          // Chỉ log mỗi 10 giây để giảm spam
          const currentTime = Date.now()
          if (!lastAttackTime || currentTime - lastAttackTime > 10000) {
            console.log(`🗡️ Farming ${mob.name || mob.displayName} (${Math.round(bot.entity.position.distanceTo(mob.position))}m)`)
            lastAttackTime = currentTime
          }

          // Di chuyển đến gần mob nếu cần
          const distance = bot.entity.position.distanceTo(mob.position)
          if (distance > 6) {
            const movements = new Movements(bot)
            movements.canDig = false // Không đào khi farm
            movements.allowSprinting = true
            movements.allowParkour = true
            bot.pathfinder.setMovements(movements)

            bot.pathfinder.setGoal(new goals.GoalFollow(mob, 2))

            // Đợi di chuyển một chút
            await new Promise(resolve => setTimeout(resolve, 500))
          }

          // Tấn công mob gần nhất - ÁP DỤNG LOGIC GIỐNG PROTECT
          const mobDistance = bot.entity.position.distanceTo(mob.position)

          // TRONG AUTO MINE: Giữ pickaxe để đánh mob (không đổi sang kiếm)
          // Đảm bảo đang cầm pickaxe
          if (!bot.heldItem || !bot.heldItem.name.includes('pickaxe')) {
            await equipBestPickaxe()
          }
          
          if (mobDistance <= 4) {
            // Mob đủ gần - TẤN CÔNG TRỰC TIẾP với pickaxe
            bot.pathfinder.setGoal(null)
            bot.setControlState('sprint', true)

            if (mob && mob.isValid) {
              // Đánh mob bằng pickaxe (không cần critical hit phức tạp)
              for (let attack = 0; attack < 10; attack++) {
                if (mob && mob.isValid) {
                  bot.attack(mob)
                  await new Promise(resolve => setTimeout(resolve, 500))
                }
              }
            }
          } else if (mobDistance <= 7) {
            // Mob hơi xa - di chuyển lại gần
            const movements = new Movements(bot)
            movements.canDig = false
            movements.allowSprinting = true
            bot.pathfinder.setMovements(movements)
            bot.pathfinder.setGoal(new goals.GoalNear(mob.position.x, mob.position.y, mob.position.z, 2))
          }

          // Thu thập item sau khi giết
          setTimeout(() => {
            const entities = Object.values(bot.entities)
            for (const entity of entities) {
              if (entity.name === 'item' && entity.position &&
                  bot.entity.position.distanceTo(entity.position) < 8) {
                bot.collectBlock.collect(entity).catch(() => {})
              }
            }
          }, 1000)

        } else {
          // Không có mob gần, di chuyển ngẫu nhiên để tìm
          if (Math.random() < 0.3) { // 30% cơ hội di chuyển
            const randomX = Math.floor(Math.random() * 21) - 10
            const randomZ = Math.floor(Math.random() * 21) - 10
            const currentPos = bot.entity.position
            const goal = new goals.GoalXZ(currentPos.x + randomX, currentPos.z + randomZ)
            bot.pathfinder.setGoal(goal)
          }
        }
      } catch (error) {
        console.log('Lỗi auto farm:', error)
        bot.pathfinder.setGoal(null)
        bot.pvp.stop()
      }
    }, 1500) // Giảm tần suất farm từ 500ms lên 1500ms để giảm spam
  }

  stopAutoFarm = function() {
    autoFarmActive = false
    if (farmInterval) {
      clearInterval(farmInterval)
      farmInterval = null
    }

    // Defensive cleanup: clear pathfinder goal and stop pvp
    try { bot.pathfinder.setGoal(null) } catch (e) { console.log('Error clearing pathfinder goal in stopAutoFarm:', e) }
    try { bot.pvp.stop() } catch (e) { console.log('Error stopping pvp in stopAutoFarm:', e) }

    // Reset common control states so the bot can be controlled by other managers
    const controlsToReset = ['forward','back','left','right','jump','sneak','sprint']
    for (const c of controlsToReset) {
      try { bot.setControlState(c as any, false) } catch (e) {}
    }

    console.log('⏹️ Auto Farm All - Deactivated')
  }

  // ------------------ AUTO MINING SYSTEM - IMPLEMENTED PER USER REQUIREMENTS ------------------
  startAutoMining = function(oreType: string) {
    // 1. Dừng các hoạt động khác trước khi bắt đầu mine
    stopFollowing()
    stopProtecting()
  if (autoFishingActive) stopSmartAutoFishing()
  if (autoFarmActive) stopAutoFarm()

    autoMiningActive = true
    targetOreType = oreType.toLowerCase()
    currentMiningTarget = null
    lastMinedPosition = null

    bot.chat(`⛏️ Bắt đầu auto mine ${oreType}! Tớ sẽ tìm kiếm trong phạm vi 128 blocks!`)
    console.log(`🔥 Auto Mining ${oreType} - Activated`)

    // Clear previous interval if any
    if (miningInterval) {
      clearInterval(miningInterval)
    }

    miningInterval = setInterval(async () => {
      // Kiểm tra ngay để phản ứng nhanh với lệnh dừng
      if (!autoMiningActive) {
        clearInterval(miningInterval!)
        miningInterval = null
        return
      }

      try {
        await executeMiningCycle()
      } catch (error) {
        console.log('❌ Lỗi auto mining:', error)
        bot.pathfinder.setGoal(null)
      }
    }, 3000) // 3 giây mỗi cycle
  }

  // Hàm thực hiện một chu kỳ mining theo yêu cầu user
  async function executeMiningCycle() {
    // Check if mining is still active first
    if (!autoMiningActive) {
      console.log('⏹️ Mining stopped, exiting cycle')
      return
    }

    // 2. Quét và tìm mục tiêu với bot.findBlock() - phạm vi 128 blocks
    if (isCurrentlyDigging) {
      return // Bỏ qua nếu đang đào
    }

    // Kiểm tra túi đồ đầy - edge case handling
    const inventoryFull = bot.inventory.emptySlotCount() <= 2
    if (inventoryFull) {
      bot.chat('🎒 Túi đồ đầy rồi! Dừng auto mine!')
      stopAutoMining()
      return
    }

    // Kiểm tra đói - CHỈ ĐỔI SANG THỨC ĂN KHI THỰC SỰ ĐÓI
    const food = bot.food
    if (food < 6) { // Chỉ khi đói dưới 6 (3 đùi)
      const safeFood = bot.inventory.items().find(item => {
        const name = item.name.toLowerCase()
        const safeItems = [
          'bread', 'apple', 'cooked_beef', 'cooked_pork', 'cooked_chicken',
          'cooked_salmon', 'cooked_cod', 'baked_potato', 'carrot',
          'golden_apple', 'enchanted_golden_apple', 'cooked_mutton',
          'cookie', 'melon_slice', 'sweet_berries'
        ]
        return safeItems.some(safe => name.includes(safe))
      })

      if (safeFood && !isEating) {
        console.log(`🍞 Mining: Đói (${food}/20), ăn ${safeFood.name} trước khi tiếp tục`)
        isEating = true

        try {
          await bot.equip(safeFood, 'hand')
          await bot.consume()
          console.log(`✅ Đã ăn ${safeFood.name}, tiếp tục mining`)
          isEating = false

          // Trang bị lại pickaxe sau khi ăn
          await equipBestPickaxe()
        } catch (eatError) {
          console.log('⚠️ Lỗi ăn:', (eatError as Error).message || eatError)
          isEating = false
        }
        return // Bỏ qua cycle này để ăn
      }
    }

    // Trang bị pickaxe tốt nhất (chỉ khi không đang ăn)
    if (!isEating) {
      if (!await equipBestPickaxe()) {
        bot.chat('🥺 Không có pickaxe để đào!')
        stopAutoMining()
        return
      }
    }

    // Tìm block quặng - sử dụng bot.findBlock() như yêu cầu
    const oreBlock = bot.findBlock({
      matching: (block: any) => {
        if (!block) return false
        if (!isTargetOreType(block, targetOreType)) return false
        
        // ANTI-XRAY: Chỉ đào quặng đã lộ ra (có ít nhất 1 mặt tiếp xúc với không khí)
        // Kiểm tra 6 mặt xung quanh block
        const pos = block.position
        const surroundingPositions = [
          pos.offset(1, 0, 0),   // Đông
          pos.offset(-1, 0, 0),  // Tây
          pos.offset(0, 1, 0),   // Trên
          pos.offset(0, -1, 0),  // Dưới
          pos.offset(0, 0, 1),   // Nam
          pos.offset(0, 0, -1)   // Bắc
        ]
        
        // Kiểm tra xem có ít nhất 1 mặt là không khí hoặc nước (block đã lộ ra)
        for (const checkPos of surroundingPositions) {
          const adjacentBlock = bot.blockAt(checkPos)
          if (adjacentBlock) {
            const blockName = adjacentBlock.name.toLowerCase()
            // Block được coi là "lộ ra" nếu tiếp xúc với không khí, nước, lava, hoặc các block trong suốt
            if (blockName === 'air' || 
                blockName === 'cave_air' || 
                blockName === 'water' || 
                blockName === 'lava' ||
                blockName === 'grass' ||
                blockName === 'tall_grass' ||
                adjacentBlock.transparent) {
              return true
            }
          }
        }
        
        return false // Block bị bao quanh hoàn toàn = quặng ảo từ anti-xray
      },
      maxDistance: 128, // Đúng như yêu cầu user - phạm vi 128 blocks
      useExtraInfo: true,
      count: 1 // Tìm 1 block một lần như yêu cầu user
    })

    if (oreBlock) {
      // Reset search khi tìm thấy
      console.log(`⛏️ Tìm thấy ${oreBlock.name} tại (${oreBlock.position.x}, ${oreBlock.position.y}, ${oreBlock.position.z})`)

      // 3. Tính toán và di chuyển đến mục tiêu - đào từng block một
      await approachAndDigTarget(oreBlock)

    } else {
      // 4. Xử lý trường hợp đặc biệt - không tìm thấy quặng
      console.log(`🔍 Không tìm thấy ${targetOreType} trong phạm vi 128 blocks`)

      // Di chuyển ngẫu nhiên để khám phá vùng mới
      await exploreRandomDirection()
    }
  }

  // Kiểm tra xem block có phải là loại quặng đích không
  function isTargetOreType(block: any, oreType: string): boolean {
    const blockName = block.name.toLowerCase()

    // Mapping các tên quặng Minecraft
    const oreMapping: { [key: string]: string[] } = {
      'diamond': ['diamond_ore', 'deepslate_diamond_ore'],
      'iron': ['iron_ore', 'deepslate_iron_ore'],
      'gold': ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
      'coal': ['coal_ore', 'deepslate_coal_ore'],
      'copper': ['copper_ore', 'deepslate_copper_ore'],
      'emerald': ['emerald_ore', 'deepslate_emerald_ore'],
      'redstone': ['redstone_ore', 'deepslate_redstone_ore'],
      'lapis': ['lapis_ore', 'deepslate_lapis_ore'],
      'netherite': ['ancient_debris'],
      'ancient_debris': ['ancient_debris']
    }

    const targetOres = oreMapping[oreType] || [oreType + '_ore', 'deepslate_' + oreType + '_ore']
    return targetOres.some(ore => blockName.includes(ore))
  }

  // Trang bị pickaxe tốt nhất với ưu tiên từ xịn đến cùi
  async function equipBestPickaxe(): Promise<boolean> {
    try {
      // Tìm tất cả pickaxe trong inventory
      const pickaxes = bot.inventory.items().filter(item => item.name.includes('pickaxe'))

      if (pickaxes.length > 0) {
        // Ưu tiên từ xịn đến cùi: netherite > diamond > iron > stone > wooden
        const priority = ['netherite', 'diamond', 'iron', 'stone', 'wooden', 'wood']
        let bestPickaxe = null

        // Tìm pickaxe tốt nhất theo thứ tự ưu tiên
        for (const material of priority) {
          const pickaxe = pickaxes.find(p => p.name.includes(material))
          if (pickaxe) {
            bestPickaxe = pickaxe
            break
          }
        }

        // Nếu không tìm thấy theo priority, lấy cái đầu tiên
        if (!bestPickaxe) {
          bestPickaxe = pickaxes[0]
        }

        // Chỉ trang bị nếu chưa cầm pickaxe này
        if (!bot.heldItem || bot.heldItem.name !== bestPickaxe.name) {
          await bot.equip(bestPickaxe, 'hand')
          console.log(`⛏️ Trang bị ${bestPickaxe.name} để đào`)
        }
        return true
      } else {
        console.log('⚠️ Không có pickaxe nào trong inventory!')
        return false
      }
    } catch (error) {
      console.log('❌ Lỗi trang bị pickaxe:', (error as Error).message || error)
      return false
    }
  }

  // 3. Di chuyển đến mục tiêu và đào - cải thiện để tránh lỗi "Digging aborted"
  async function approachAndDigTarget(oreBlock: any) {
    // Check if mining is still active
    if (!autoMiningActive) {
      console.log('⏹️ Mining stopped during approach, aborting')
      return
    }

    try {
      isCurrentlyDigging = true
      currentMiningTarget = oreBlock

      // Đảm bảo đang cầm pickaxe trước khi đào
      if (!bot.heldItem || !bot.heldItem.name.includes('pickaxe')) {
        console.log('⛏️ Trang bị pickaxe trước khi đào...')
        if (!await equipBestPickaxe()) {
          console.log('❌ Không có pickaxe, bỏ qua block này')
          return
        }
      }

      const distance = bot.entity.position.distanceTo(oreBlock.position)

      // Di chuyển gần target nếu cần - tối ưu hóa pathfinding
      if (distance > 3.5) {
        console.log(`🚶 Di chuyển đến quặng (${Math.round(distance)} blocks away)`)

        // Dừng tất cả pathfinding trước khi thiết lập mới
        bot.pathfinder.setGoal(null)
        await new Promise(resolve => setTimeout(resolve, 200))

        // Thiết lập pathfinder cải thiện
        const movements = new Movements(bot)
        movements.canDig = true
        movements.digCost = 1   // Giảm cost để đào nhanh hơn
        movements.allow1by1towers = true
        movements.allowParkour = true
        movements.allowSprinting = false  // Tắt sprint khi đào để chính xác hơn
        movements.blocksCantBreak.clear()
        movements.blocksCantBreak.add(bot.registry.blocksByName.bedrock?.id || 0)
        movements.blocksCantBreak.add(bot.registry.blocksByName.barrier?.id || 0)
        movements.scafoldingBlocks = [bot.registry.itemsByName.cobblestone?.id, bot.registry.itemsByName.dirt?.id].filter(Boolean)
        bot.pathfinder.setMovements(movements)

        // Di chuyển đến vị trí tối ưu (gần hơn)
        const goal = new goals.GoalNear(oreBlock.position.x, oreBlock.position.y, oreBlock.position.z, 1.5)
        bot.pathfinder.setGoal(goal)

        // Đợi di chuyển với timeout ngắn hơn
        await new Promise(resolve => setTimeout(resolve, 2000))

        // Dừng pathfinder trước khi đào
        bot.pathfinder.setGoal(null)
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      // Kiểm tra block vẫn tồn tại và có thể đào được
      const currentBlock = bot.blockAt(oreBlock.position)
      if (!currentBlock || currentBlock.name === 'air' || currentBlock.name !== oreBlock.name) {
        console.log(`⚠️ Block ${oreBlock.name} đã bị đào hoặc không tồn tại`)
        lastMinedPosition = { ...oreBlock.position, timestamp: Date.now() }
        return
      }

      // Kiểm tra khoảng cách cuối cùng
      const finalDistance = bot.entity.position.distanceTo(oreBlock.position)
      if (finalDistance > 5) {
        console.log(`⚠️ Quá xa để đào (${finalDistance.toFixed(1)} blocks), bỏ qua`)
        return
      }

      // Chuẩn bị đào: nhìn về phía block và đứng yên
      console.log(`⛏️ Bắt đầu đào ${oreBlock.name}...`)
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('sprint', false)

      await bot.lookAt(oreBlock.position.offset(0.5, 0.5, 0.5), true)
      await new Promise(resolve => setTimeout(resolve, 500))

      // Kiểm tra lại pickaxe trước khi đào
      if (!bot.heldItem || !bot.heldItem.name.includes('pickaxe')) {
        await equipBestPickaxe()
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      // Đào với improved error handling
      let digSuccess = false
      for (let attempt = 0; attempt < 3; attempt++) {
        // Check if mining is still active before each attempt
        if (!autoMiningActive) {
          console.log('⏹️ Mining stopped during dig attempts, aborting')
          break
        }

        try {
          const digBlock = bot.blockAt(oreBlock.position)
          if (!digBlock || digBlock.name === 'air') {
            console.log(`⚠️ Block đã biến mất trong lúc đào`)
            break
          }

          console.log(`⛏️ Thử đào lần ${attempt + 1}...`)

          // Đào với timeout ngắn hơn cho mỗi attempt
          const digPromise = bot.dig(digBlock)
          const timeoutPromise = new Promise((_, reject) =>
            setTimeout(() => reject(new Error('Dig timeout')), 8000)
          )

          await Promise.race([digPromise, timeoutPromise])
          console.log(`✅ Đã đào xong ${oreBlock.name}!`)
          digSuccess = true
          
          // ĐÀO TOÀN BỘ CỤM QUẶNG LIỀN KỀ (VEIN MINING)
          await digAdjacentOres(oreBlock.position, oreBlock.name)
          
          break

        } catch (digError) {
          const errorMsg = (digError as Error).message || (digError as Error).toString()

          if (errorMsg.includes('Digging aborted') || errorMsg.includes('aborted')) {
            console.log(`⚠️ Đào bị hủy lần ${attempt + 1}, thử lại...`)

            // Reset trạng thái và thử lại
            try {
              bot.stopDigging()
            } catch (e) {}

            await new Promise(resolve => setTimeout(resolve, 500))

            // Trang bị lại pickaxe và điều chỉnh vị trí
            await equipBestPickaxe()
            await bot.lookAt(oreBlock.position.offset(0.5, 0.5, 0.5), true)
            await new Promise(resolve => setTimeout(resolve, 300))

          } else if (errorMsg.includes('Dig timeout')) {
            console.log(`⏰ Timeout lần ${attempt + 1}`)
            try {
              bot.stopDigging()
            } catch (e) {}
            await new Promise(resolve => setTimeout(resolve, 200))
          } else {
            console.log(`❌ Lỗi đào lần ${attempt + 1}: ${errorMsg}`)
            break
          }
        }
      }

      if (!digSuccess) {
        console.log(`❌ Không thể đào ${oreBlock.name} sau 3 lần thử - bỏ qua block này`)
      }

      // Lưu vị trí đã đào để tránh lặp lại
      lastMinedPosition = { ...oreBlock.position, timestamp: Date.now() }

      // Thu thập items rơi
      await collectDroppedItems(oreBlock.position)

    } catch (error) {
      console.log('❌ Lỗi approach and dig:', (error as Error).message || error)
      try {
        bot.stopDigging()
      } catch (e) {}

      // Lưu vị trí lỗi để không thử lại
      lastMinedPosition = { ...oreBlock.position, timestamp: Date.now() }
    } finally {
      isCurrentlyDigging = false
      currentMiningTarget = null

      // Reset control states
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('sprint', false)
    }
  }

  // Hàm đào tất cả quặng liền kề (vein mining)
  async function digAdjacentOres(centerPos: any, oreName: string) {
    if (!autoMiningActive) return
    
    const dugPositions = new Set<string>()
    const toCheck: any[] = []
    
    // Thêm vị trí trung tâm vào danh sách đã đào
    dugPositions.add(`${centerPos.x},${centerPos.y},${centerPos.z}`)
    
    // Kiểm tra 26 vị trí xung quanh (3x3x3 cube)
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          if (dx === 0 && dy === 0 && dz === 0) continue
          toCheck.push(centerPos.offset(dx, dy, dz))
        }
      }
    }
    
    // Đào từng block liền kề
    for (const checkPos of toCheck) {
      if (!autoMiningActive) break
      
      const posKey = `${checkPos.x},${checkPos.y},${checkPos.z}`
      if (dugPositions.has(posKey)) continue
      
      const block = bot.blockAt(checkPos)
      if (!block || block.name !== oreName) continue
      
      // Kiểm tra khoảng cách
      const distance = bot.entity.position.distanceTo(checkPos)
      if (distance > 5) continue
      
      console.log(`⛏️ Đào quặng liền kề tại (${checkPos.x}, ${checkPos.y}, ${checkPos.z})`)
      
      try {
        // Đảm bảo đang cầm pickaxe
        if (!bot.heldItem || !bot.heldItem.name.includes('pickaxe')) {
          await equipBestPickaxe()
        }
        
        // Nhìn vào block
        await bot.lookAt(checkPos.offset(0.5, 0.5, 0.5), true)
        await new Promise(resolve => setTimeout(resolve, 100))
        
        // Đào block
        await bot.dig(block, true)
        console.log(`✅ Đã đào quặng liền kề!`)
        
        dugPositions.add(posKey)
        
        // Đệ quy đào các quặng liền kề của block này
        await digAdjacentOres(checkPos, oreName)
        
      } catch (error) {
        // Bỏ qua lỗi và tiếp tục với block tiếp theo
      }
    }
  }

  // Thu thập items rơi sau khi đào
  async function collectDroppedItems(digPosition: any) {
    console.log('🎁 Thu thập items...')
    await new Promise(resolve => setTimeout(resolve, 1000))

    try {
      const entities = Object.values(bot.entities)
      const nearbyItems = entities
        .filter(entity => entity.name === 'item' && entity.position)
        .filter(entity => {
          const distance = digPosition.distanceTo(entity.position!)
          return distance < 8
        })
        .sort((a, b) => {
          const distA = digPosition.distanceTo(a.position!)
          const distB = digPosition.distanceTo(b.position!)
          return distA - distB
        })

      let itemsCollected = 0
      for (const entity of nearbyItems.slice(0, 3)) {
        try {
          await bot.collectBlock.collect(entity)
          itemsCollected++
          await new Promise(resolve => setTimeout(resolve, 300))
        } catch (collectError) {
          // Bỏ qua lỗi thu thập
        }
      }

      if (itemsCollected > 0) {
        console.log(`✅ Thu thập ${itemsCollected} items`)
      }
    } catch (error) {
      console.log('⚠️ Lỗi thu thập items:', error)
    }
  }

  // Khám phá ngẫu nhiên khi không tìm thấy quặng
  async function exploreRandomDirection() {
    if (Math.random() < 0.4) { // 40% cơ hội di chuyển
      const distance = 20 + Math.random() * 15 // 20-35 blocks
      const angle = Math.random() * Math.PI * 2
      const currentPos = bot.entity.position

      const targetX = currentPos.x + Math.cos(angle) * distance
      const targetZ = currentPos.z + Math.sin(angle) * distance

      console.log(`🔍 Khám phá vùng mới để tìm ${targetOreType}...`)

      const movements = new Movements(bot)
      movements.canDig = true
      movements.digCost = 3
      bot.pathfinder.setMovements(movements)

      const goal = new goals.GoalXZ(targetX, targetZ)
      bot.pathfinder.setGoal(goal)

      await new Promise(resolve => setTimeout(resolve, 2000))
    }
  }

  // 5. Lệnh dừng auto mining
  stopAutoMining = function() {
    console.log('🛑 Stopping auto mining...')

    // Set flags first to stop all activities immediately
    autoMiningActive = false
    targetOreType = ''
    currentMiningTarget = null
    isCurrentlyDigging = false
    lastMinedPosition = null

    // Clear interval immediately
    if (miningInterval) {
      clearInterval(miningInterval)
      miningInterval = null
      console.log('✅ Mining interval cleared')
    }

    // Stop digging immediately
    try {
      if (bot.targetDigBlock) {
        bot.stopDigging()
        console.log('✅ Stopped current digging')
      }
    } catch (error) {
      // Ignore stop digging error
    }

    // Stop pathfinding
    try {
      bot.pathfinder.setGoal(null)
      console.log('✅ Pathfinder cleared')
    } catch (error) {
      // Ignore pathfinder error
    }

    // Reset control states
    try {
      bot.setControlState('forward', false)
      bot.setControlState('back', false)
      bot.setControlState('left', false)
      bot.setControlState('right', false)
      bot.setControlState('sprint', false)
    } catch (error) {
      // Ignore control state errors
    }

    // Chỉ chat khi được gọi trực tiếp
    if (!arguments[0] && bot && bot._client && bot._client.state === 'play') {
      bot.chat('⛏️ Dừng auto mine rồi nha!')
    }
    console.log('⏹️ Auto Mining - Deactivated completely')
  }

  // ------------------ AUTO CROP FARMING SYSTEM ------------------

  // Function to find and equip best hoe
  async function equipBestHoe(): Promise<boolean> {
    try {
      const hoes = bot.inventory.items().filter(item => item.name.includes('hoe'))

      if (hoes.length > 0) {
        // Thứ tự ưu tiên: Netherite > Diamond > Iron > Stone > Gold > Wood
        const priority = ['netherite', 'diamond', 'iron', 'stone', 'golden', 'wooden', 'wood']
        let bestHoe = hoes[0]

        for (const material of priority) {
          const hoe = hoes.find(h => h.name.includes(material))
          if (hoe) {
            bestHoe = hoe
            break
          }
        }

        if (!bot.heldItem || bot.heldItem.name !== bestHoe.name) {
          await bot.equip(bestHoe, 'hand')
          console.log(`🌾 Đã trang bị ${bestHoe.name}`)
        }
        currentHoeTool = bestHoe
        return true
      } else {
        console.log('❌ Không tìm thấy cuốc (hoe) trong túi đồ')
        return false
      }
    } catch (error) {
      console.log('❌ Lỗi trang bị cuốc:', error)
      return false
    }
  }

  // Check if crop is mature - ĐƠN GIẢN HÓA
  function isCropMature(block: any): boolean {
    if (!block || !block.name) return false

    const blockName = block.name.toLowerCase()

    // Get age from block metadata
    let cropAge = -1
    
    // Method 1: block.metadata (MOST RELIABLE)
    if (block.metadata !== undefined && block.metadata !== null) {
      cropAge = Number(block.metadata)
    }
    
    // Method 2: block.properties?.age
    if (cropAge === -1 && block.properties?.age !== undefined) {
      cropAge = Number(block.properties.age)
    }
    
    // Method 3: stateId calculation
    if (cropAge === -1 && block.stateId !== undefined) {
      if (blockName.includes('wheat')) {
        cropAge = (block.stateId - 3357) % 8
      } else if (blockName.includes('carrot')) {
        cropAge = (block.stateId - 6322) % 8
      } else if (blockName.includes('potato')) {
        cropAge = (block.stateId - 6338) % 8
      } else if (blockName.includes('beetroot')) {
        cropAge = (block.stateId - 9223) % 4
      }
    }

    // Check maturity
    if (blockName.includes('wheat') || blockName.includes('carrot') || blockName.includes('potato')) {
      return cropAge === 7
    }
    if (blockName.includes('beetroot')) {
      return cropAge === 3
    }
    if (blockName.includes('nether_wart')) {
      return cropAge === 3
    }

    return false
  }

  // Find seeds in inventory
  function findSeeds(): any {
    const seeds = bot.inventory.items().find(item => {
      const name = item.name.toLowerCase()
      return name.includes('wheat_seeds') ||
             name.includes('carrot') ||
             name.includes('potato') ||
             name.includes('beetroot_seeds') ||
             name.includes('nether_wart')
    })
    return seeds
  }

  // Find bone meal in inventory
  function findBoneMeal(): any {
    return bot.inventory.items().find(item =>
      item.name.toLowerCase().includes('bone_meal')
    )
  }

  // Start auto crop farming - VÒNG LẶP VÔ HẠN
  startAutoCropFarmer = function() {
    // Stop other activities
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoChestHuntingActive) stopAutoChestHunting()

    autoCropFarmerActive = true
    harvestedCrops.clear()

    bot.chat('🌾 Bắt đầu auto farmer vòng lặp! Thu hoạch → Trồng → Bón phân!')
    console.log('🌾 Auto Crop Farmer - Activated (Vòng lặp)')

    // Chạy vòng lặp vô hạn
    const runCycle = async () => {
      while (autoCropFarmerActive) {
        try {
          await executeCropFarmingCycle()
          // Chờ 2 giây trước khi lặp lại
          await new Promise(resolve => setTimeout(resolve, 2000))
        } catch (error) {
          console.log('❌ Lỗi auto crop farming:', error)
          await new Promise(resolve => setTimeout(resolve, 5000))
        }
      }
    }

    runCycle()
  }

  // Execute one crop farming cycle - 3 PHA: THU HOẠCH → TRỒNG → BÓN PHÂN → LẶP LẠI
  async function executeCropFarmingCycle() {
    if (!autoCropFarmerActive) return

    // Trang bị hoe
    if (!await equipBestHoe()) {
      bot.chat('Tôi không có hoe để làm nông.')
      stopAutoCropFarmer()
      return
    }

    // ===== PHA 1: THU HOẠCH HẾT =====
    console.log('🌾 === PHA 1: THU HOẠCH ===')
    
    // Debug: Tìm TẤT CẢ cây trồng trước
    const allCrops = bot.findBlocks({
      matching: (block: any) => {
        if (!block) return false
        const name = block.name
        return name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'beetroots'
      },
      maxDistance: 32,
      count: 20
    })
    
    console.log(`🔍 Tìm thấy ${allCrops.length} cây trồng trong phạm vi`)
    
    // Debug: Kiểm tra 5 cây đầu tiên
    for (let i = 0; i < Math.min(5, allCrops.length); i++) {
      const block = bot.blockAt(allCrops[i])
      if (block) {
        const mature = isCropMature(block)
        console.log(`  ${block.name}: metadata=${block.metadata}, stateId=${block.stateId}, chín=${mature}`)
      }
    }
    
    let harvestCount = 0
    let maxAttempts = 100 // Giới hạn để tránh vòng lặp vô hạn
    
    for (let i = 0; i < maxAttempts && autoCropFarmerActive; i++) {
      // Tìm cây chín gần nhất
      const matureCrops = bot.findBlocks({
        matching: (block: any) => {
          if (!block) return false
          const name = block.name
          if (name !== 'wheat' && name !== 'carrots' && name !== 'potatoes' && name !== 'beetroots') {
            return false
          }
          return isCropMature(block)
        },
        maxDistance: 32,
        count: 1
      })

      if (matureCrops.length === 0) {
        console.log(`✅ Không còn cây chín! Đã thu hoạch ${harvestCount} cây`)
        break
      }

      const cropPos = matureCrops[0]
      const cropBlock = bot.blockAt(cropPos)
      if (!cropBlock) continue

      try {
        // Di chuyển đến cây
        const movements = new Movements(bot)
        movements.canDig = false
        bot.pathfinder.setMovements(movements)
        await bot.pathfinder.goto(new goals.GoalNear(cropPos.x, cropPos.y, cropPos.z, 1))

        // Thu hoạch
        await bot.dig(cropBlock)
        harvestCount++
        console.log(`✅ Thu hoạch ${cropBlock.name} (${harvestCount})`)

        // Chờ và thu thập item
        await new Promise(resolve => setTimeout(resolve, 500))

        // Kiểm tra túi đầy
        if (bot.inventory.emptySlotCount() <= 1) {
          bot.chat('Hành lý đầy!')
          stopAutoCropFarmer()
          return
        }

      } catch (error) {
        console.log('❌ Lỗi thu hoạch:', (error as any)?.message || error)
      }
    }

    // ===== PHA 2: TRỒNG LẠI HẾT =====
    console.log('🌱 === PHA 2: TRỒNG LẠI ===')
    
    // Kiểm tra hạt giống
    const seeds = bot.inventory.items().filter(item => {
      return item.name === 'wheat_seeds' || item.name === 'carrot' || 
             item.name === 'potato' || item.name === 'beetroot_seeds'
    })
    
    console.log(`📦 Hạt giống: ${seeds.map(s => `${s.name} x${s.count}`).join(', ')}`)
    
    if (seeds.length === 0) {
      console.log('⚠️ Không có hạt giống!')
      bot.chat('Không có hạt giống để trồng!')
      stopAutoCropFarmer()
      return
    }
    
    // Debug: Tìm TẤT CẢ farmland trước
    const allFarmlands = bot.findBlocks({
      matching: (block: any) => {
        return block && block.name === 'farmland'
      },
      maxDistance: 32,
      count: 50
    })
    
    console.log(`🔍 Tìm thấy ${allFarmlands.length} farmland trong phạm vi`)
    
    // Kiểm tra từng farmland xem có trống không
    let emptyCount = 0
    for (const pos of allFarmlands) {
      const farmland = bot.blockAt(pos)
      if (farmland && farmland.position) {
        const above = bot.blockAt(farmland.position.offset(0, 1, 0))
        if (above && above.name === 'air') {
          emptyCount++
        }
      }
    }
    console.log(`🔍 Trong đó có ${emptyCount} farmland trống`)
    
    let plantCount = 0
    let maxPlantAttempts = 100
    
    for (let i = 0; i < maxPlantAttempts && autoCropFarmerActive; i++) {
      // Tìm farmland trống từng cái một
      let foundEmpty = null
      
      for (const pos of allFarmlands) {
        const farmland = bot.blockAt(pos)
        if (farmland && farmland.position) {
          const above = bot.blockAt(farmland.position.offset(0, 1, 0))
          if (above && above.name === 'air') {
            foundEmpty = farmland
            break
          }
        }
      }

      if (!foundEmpty) {
        console.log(`✅ Không còn đất trống! Đã trồng ${plantCount} cây`)
        break
      }

      // Lấy hạt giống
      const seed = bot.inventory.items().find(item => {
        return item.name === 'wheat_seeds' || item.name === 'carrot' || 
               item.name === 'potato' || item.name === 'beetroot_seeds'
      })

      if (!seed) {
        console.log('⚠️ Hết hạt giống!')
        break
      }

      try {
        // Di chuyển đến farmland
        const movements = new Movements(bot)
        movements.canDig = false
        bot.pathfinder.setMovements(movements)
        await bot.pathfinder.goto(new goals.GoalNear(foundEmpty.position.x, foundEmpty.position.y, foundEmpty.position.z, 1))

        // Trang bị và trồng
        await bot.equip(seed, 'hand')
        await new Promise(resolve => setTimeout(resolve, 200))
        await bot.placeBlock(foundEmpty, new Vec3(0, 1, 0))
        
        plantCount++
        console.log(`✅ Trồng ${seed.name} (${plantCount})`)
        await new Promise(resolve => setTimeout(resolve, 300))

      } catch (error) {
        console.log('❌ Lỗi trồng:', (error as any)?.message || error)
      }
    }

    // ===== PHA 3: BÓN PHÂN (BONE MEAL) =====
    console.log('💀 === PHA 3: BÓN PHÂN ===')
    
    // Kiểm tra có bone meal không
    const boneMeal = bot.inventory.items().find(item => 
      item.name === 'bone_meal'
    )
    
    if (!boneMeal) {
      console.log('⚠️ Không có bone meal - Chờ cây chín...')
      console.log(`🎉 Chu kỳ hoàn thành! Thu hoạch: ${harvestCount}, Trồng: ${plantCount}`)
      
      // Chờ cho đến khi có cây chín
      let waitCount = 0
      while (autoCropFarmerActive) {
        await new Promise(resolve => setTimeout(resolve, 5000)) // Chờ 5 giây
        waitCount++
        
        // Kiểm tra có cây chín không
        const matureCrops = bot.findBlocks({
          matching: (block: any) => {
            if (!block) return false
            const name = block.name
            if (name !== 'wheat' && name !== 'carrots' && name !== 'potatoes' && name !== 'beetroots') {
              return false
            }
            return isCropMature(block)
          },
          maxDistance: 32,
          count: 1
        })
        
        if (matureCrops.length > 0) {
          console.log(`✅ Có cây chín rồi! Quay lại pha 1 (đã chờ ${waitCount * 5}s)`)
          return // Quay lại pha 1
        }
        
        // Log mỗi 30 giây
        if (waitCount % 6 === 0) {
          console.log(`⏳ Đang chờ cây chín... (${waitCount * 5}s)`)
        }
      }
      return
    }
    
    console.log(`💀 Có ${boneMeal.count} bone meal`)
    
    let boneMealCount = 0
    let maxBoneMealAttempts = 200 // Giới hạn cao hơn vì bón nhiều lần
    
    for (let i = 0; i < maxBoneMealAttempts && autoCropFarmerActive; i++) {
      // Kiểm tra còn bone meal không
      const currentBoneMeal = bot.inventory.items().find(item => item.name === 'bone_meal')
      if (!currentBoneMeal) {
        console.log('✅ Hết bone meal!')
        break
      }
      
      // Tìm cây chưa chín
      const immatureCrops = bot.findBlocks({
        matching: (block: any) => {
          if (!block) return false
          const name = block.name
          if (name !== 'wheat' && name !== 'carrots' && name !== 'potatoes' && name !== 'beetroots') {
            return false
          }
          return !isCropMature(block) // Cây CHƯA chín
        },
        maxDistance: 32,
        count: 1
      })

      if (immatureCrops.length === 0) {
        console.log(`✅ Không còn cây chưa chín! Đã bón ${boneMealCount} lần`)
        break
      }

      const cropPos = immatureCrops[0]
      const cropBlock = bot.blockAt(cropPos)
      if (!cropBlock) continue

      try {
        const movements = new Movements(bot)
        movements.canDig = false
        bot.pathfinder.setMovements(movements)
        await bot.pathfinder.goto(new goals.GoalNear(cropPos.x, cropPos.y, cropPos.z, 3))

        // Trang bị bone meal
        await bot.equip(currentBoneMeal, 'hand')
        await new Promise(resolve => setTimeout(resolve, 200))
        
        // Bón phân (activateBlock)
        await bot.activateBlock(cropBlock)
        boneMealCount++
        console.log(`💀 Bón phân ${cropBlock.name} (${boneMealCount})`)
        await new Promise(resolve => setTimeout(resolve, 300))

      } catch (error) {
        console.log('❌ Lỗi bón phân:', (error as any)?.message || error)
      }
    }

    // ===== BÁO CÁO CHU KỲ =====
    console.log(`🎉 === CHU KỲ HOÀN THÀNH ===`)
    console.log(`Thu hoạch: ${harvestCount} cây`)
    console.log(`Trồng lại: ${plantCount} cây`)
    console.log(`Bón phân: ${boneMealCount} lần`)
    console.log(`⏳ Quay lại pha 1...`)
  }

  // Stop auto crop farming
  stopAutoCropFarmer = function() {
    console.log('🛑 Stopping auto crop farmer...')

    autoCropFarmerActive = false
    currentHoeTool = null
    harvestedCrops.clear()

    if (cropFarmerInterval) {
      clearInterval(cropFarmerInterval)
      cropFarmerInterval = null
    }

    try {
      bot.pathfinder.setGoal(null)
    } catch (error) {
      // Ignore
    }

    bot.chat('🌾 Dừng auto farmer rồi!')
    console.log('⏹️ Auto Crop Farmer - Deactivated')
  }

  // ------------------ AUTO EXPLORE SYSTEM ------------------

  // Minecraft structure signatures - 2 block patterns to identify structures
  const STRUCTURE_SIGNATURES = {
    'Village': [
      { blocks: ['oak_planks', 'cobblestone'], pattern: 'adjacent' },
      { blocks: ['oak_log', 'oak_planks'], pattern: 'vertical' },
      { blocks: ['hay_block', 'oak_planks'], pattern: 'adjacent' }
    ],
    'Desert Temple': [
      { blocks: ['sandstone', 'orange_terracotta'], pattern: 'adjacent' },
      { blocks: ['chiseled_sandstone', 'sandstone'], pattern: 'vertical' }
    ],
    'Jungle Temple': [
      { blocks: ['mossy_cobblestone', 'cobblestone'], pattern: 'adjacent' },
      { blocks: ['cobblestone', 'vine'], pattern: 'adjacent' }
    ],
    'Witch Hut': [
      { blocks: ['oak_planks', 'spruce_planks'], pattern: 'adjacent' },
      { blocks: ['oak_fence', 'spruce_planks'], pattern: 'vertical' }
    ],
    'Ocean Monument': [
      { blocks: ['prismarine', 'prismarine_bricks'], pattern: 'adjacent' },
      { blocks: ['dark_prismarine', 'prismarine'], pattern: 'adjacent' }
    ],
    'Stronghold': [
      { blocks: ['stone_bricks', 'cracked_stone_bricks'], pattern: 'adjacent' },
      { blocks: ['iron_bars', 'stone_bricks'], pattern: 'adjacent' }
    ],
    'Mineshaft': [
      { blocks: ['oak_fence', 'cobweb'], pattern: 'adjacent' },
      { blocks: ['rail', 'oak_planks'], pattern: 'adjacent' }
    ],
    'Nether Fortress': [
      { blocks: ['nether_bricks', 'nether_brick_fence'], pattern: 'adjacent' },
      { blocks: ['nether_bricks', 'nether_brick_stairs'], pattern: 'adjacent' }
    ],
    'End City': [
      { blocks: ['end_stone_bricks', 'purpur_block'], pattern: 'adjacent' },
      { blocks: ['purpur_pillar', 'purpur_block'], pattern: 'vertical' }
    ],
    'Pillager Outpost': [
      { blocks: ['dark_oak_log', 'dark_oak_planks'], pattern: 'vertical' },
      { blocks: ['cobblestone', 'dark_oak_log'], pattern: 'adjacent' }
    ],
    'Ruined Portal': [
      { blocks: ['obsidian', 'crying_obsidian'], pattern: 'adjacent' },
      { blocks: ['netherrack', 'obsidian'], pattern: 'adjacent' }
    ],
    'Shipwreck': [
      { blocks: ['oak_planks', 'oak_log'], pattern: 'adjacent' },
      { blocks: ['oak_fence', 'oak_planks'], pattern: 'adjacent' }
    ],
    'Buried Treasure': [
      { blocks: ['chest', 'sand'], pattern: 'vertical' },
      { blocks: ['chest', 'sandstone'], pattern: 'vertical' }
    ]
  }

  // Start auto explore
  startAutoExplore = function() {
    // Stop other activities
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoCropFarmerActive) stopAutoCropFarmer()
    if (autoChestHuntingActive) stopAutoChestHunting()

    autoExploreActive = true
    discoveredStructures.clear()

    // Pick a random direction to explore
    const angle = Math.random() * Math.PI * 2
    exploreDirection = {
      x: Math.cos(angle),
      z: Math.sin(angle)
    }

    bot.chat('🗺️ Bắt đầu khám phá! Tớ sẽ tìm công trình và đánh quái!')
    console.log('🗺️ Auto Explore - Activated')
    console.log(`📍 Hướng khám phá: ${Math.round(angle * 180 / Math.PI)}°`)

    // Clear previous interval
    if (exploreInterval) {
      clearInterval(exploreInterval)
    }

    exploreInterval = setInterval(async () => {
      if (!autoExploreActive) {
        clearInterval(exploreInterval!)
        exploreInterval = null
        return
      }

      try {
        await executeExploreCycle()
      } catch (error) {
        console.log('❌ Lỗi auto explore:', error)
        bot.pathfinder.setGoal(null)
      }
    }, 3000) // Every 3 seconds
  }

  // Execute one explore cycle
  async function executeExploreCycle() {
    if (!autoExploreActive) return

    const health = bot.health
    const food = bot.food

    // Step 1: Auto eat if hungry
    if (food < 6) {
      console.log('🍞 Đang đói, ăn thức ăn...')
      await eatFoodToHeal()
    }

    // Step 2: Scan for hostile mobs TRƯỚC
    const nearestMob = bot.nearestEntity((entity: any) => {
      if (!entity || !entity.position) return false
      const distance = bot.entity.position.distanceTo(entity.position)
      if (distance > 30) return false

      const hostileMobs = [
        'zombie', 'skeleton', 'creeper', 'spider', 'witch', 'pillager', 'vindicator',
        'evoker', 'husk', 'stray', 'phantom', 'drowned', 'enderman', 'breeze', 'bogged',
        'slime', 'silverfish', 'cave_spider', 'wither_skeleton', 'blaze', 'ghast'
      ]
      const mobName = entity.name ? entity.name.toLowerCase() : ''
      const displayName = entity.displayName ? entity.displayName.toLowerCase() : ''

      const isHostile = hostileMobs.some(mobType =>
        mobName.includes(mobType) || displayName.includes(mobType)
      )

      return entity.type === 'mob' && isHostile
    })

    // Step 3: Combat if mob found and health > 6
    if (nearestMob && health > 6) {
      const distance = bot.entity.position.distanceTo(nearestMob.position)
      console.log(`⚔️ Phát hiện ${nearestMob.name || 'mob'} cách ${distance.toFixed(1)}m, đánh quái!`)

      await equipBestSword()

      const movements = new Movements(bot)
      movements.allowSprinting = true
      movements.canDig = false
      bot.pathfinder.setMovements(movements)

      try {
        await bot.pathfinder.goto(new goals.GoalNear(nearestMob.position.x, nearestMob.position.y, nearestMob.position.z, 2))
        bot.pvp.attack(nearestMob)
        await new Promise(resolve => setTimeout(resolve, 3000))
        bot.pvp.stop()
        console.log('✅ Đã tiêu diệt quái')
      } catch (error) {
        console.log('⚠️ Lỗi combat:', (error as any)?.message || error)
      }

      return
    } else if (nearestMob && health <= 6) {
      console.log(`⚠️ Máu yếu (${health}/20), tránh quái`)
    }

    // Step 4: Scan for structures (không chặn di chuyển)
    scanForStructures().catch(() => {})

    // Step 5: DI CHUYỂN LIÊN TỤC (bỏ check lastExploreMove)
    const currentPos = bot.entity.position
    const distance = 50 // Di chuyển 50 blocks mỗi lần

    const targetX = currentPos.x + exploreDirection!.x * distance
    const targetZ = currentPos.z + exploreDirection!.z * distance

    console.log(`🚶 Khám phá đến (${Math.floor(targetX)}, ${Math.floor(targetZ)})`)

    const movements = new Movements(bot)
    movements.canDig = false
    movements.allowSprinting = true
    movements.allowParkour = true
    bot.pathfinder.setMovements(movements)

    const goal = new goals.GoalXZ(targetX, targetZ)
    bot.pathfinder.setGoal(goal)
  }

  // Scan for structures
  async function scanForStructures() {
    const scanRadius = 180
    const botPos = bot.entity.position

    // Scan blocks in radius
    for (const [structureName, signatures] of Object.entries(STRUCTURE_SIGNATURES)) {
      for (const signature of signatures) {
        const [block1Name, block2Name] = signature.blocks

        // Find first block type
        const block1 = bot.findBlock({
          matching: (block: any) => block && block.name === block1Name,
          maxDistance: scanRadius,
          count: 1
        })

        if (!block1) continue

        // Check for second block nearby (adjacent or vertical)
        const offsets = signature.pattern === 'adjacent'
          ? [[1,0,0], [-1,0,0], [0,0,1], [0,0,-1]]
          : [[0,1,0], [0,-1,0]]

        for (const [dx, dy, dz] of offsets) {
          const checkPos = block1.position.offset(dx, dy, dz)
          const block2 = bot.blockAt(checkPos)

          if (block2 && block2.name === block2Name) {
            // Found structure signature!
            const structureKey = `${structureName}_${Math.floor(block1.position.x)}_${Math.floor(block1.position.z)}`

            if (!discoveredStructures.has(structureKey)) {
              discoveredStructures.add(structureKey)
              const coords = `(${Math.floor(block1.position.x)}, ${Math.floor(block1.position.y)}, ${Math.floor(block1.position.z)})`
              bot.chat(`🏛️ Phát hiện ${structureName} tại ${coords}!`)
              console.log(`🏛️ Discovered ${structureName} at ${coords}`)
              return // Only announce one structure per cycle
            }
          }
        }
      }
    }
  }

  // Stop auto explore
  stopAutoExplore = function() {
    console.log('🛑 Stopping auto explore...')

    autoExploreActive = false
    exploreDirection = null
    discoveredStructures.clear()

    if (exploreInterval) {
      clearInterval(exploreInterval)
      exploreInterval = null
    }

    try {
      bot.pathfinder.setGoal(null)
      bot.pvp.stop()
    } catch (error) {
      // Ignore
    }

    bot.chat('🗺️ Dừng khám phá rồi!')
    console.log('⏹️ Auto Explore - Deactivated')
  }

  // ============= AUTO COLLECT (GỖ, HẠT GIỐNG, V.V.) =============
  
  startAutoCollect = function() {
    // Dừng các hoạt động khác
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoCropFarmerActive) stopAutoCropFarmer()
    if (autoChestHuntingActive) stopAutoChestHunting()
    if (autoExploreActive) stopAutoExplore()

    autoCollectActive = true
    bot.chat('🌳 Bắt đầu auto thu thập! Tớ sẽ tìm gỗ, hạt giống và vật phẩm!')
    console.log('🌳 Auto Collect - Activated')

    if (collectInterval) {
      clearInterval(collectInterval)
    }

    collectInterval = setInterval(async () => {
      if (!autoCollectActive) {
        clearInterval(collectInterval!)
        collectInterval = null
        return
      }

      try {
        await executeCollectCycle()
      } catch (error) {
        console.log('❌ Lỗi auto collect:', error)
        bot.pathfinder.setGoal(null)
      }
    }, 2000) // Kiểm tra mỗi 2 giây
  }

  async function executeCollectCycle() {
    if (!autoCollectActive) return

    const currentTime = Date.now()

    // Bước 1: Tìm gỗ gần nhất
    const logBlock = bot.findBlock({
      matching: (block) => {
        if (!block) return false
        const name = block.name.toLowerCase()
        return name.includes('log') || name.includes('wood')
      },
      maxDistance: 32,
      count: 1
    })

    if (logBlock) {
      // Log chỉ mỗi 10 giây để tránh spam
      if (currentTime - lastCollectLog > 10000) {
        console.log(`🌳 Tìm thấy gỗ tại ${logBlock.position}`)
        lastCollectLog = currentTime
      }

      // Di chuyển đến và đào gỗ
      const movements = new Movements(bot)
      movements.canDig = true
      movements.allowSprinting = true
      bot.pathfinder.setMovements(movements)

      try {
        // Trang bị rìu tốt nhất
        await equipBestAxe()
        
        // Đào gỗ
        await bot.collectBlock.collect(logBlock)
        console.log(`✅ Đã thu thập ${logBlock.name}`)
        
        // Đợi một chút trước khi tìm tiếp
        await new Promise(resolve => setTimeout(resolve, 500))
        return
      } catch (error) {
        // Bỏ qua lỗi, tìm block khác
      }
    }

    // Bước 2: Tìm hạt giống (wheat, carrots, potatoes, beetroot)
    const cropBlock = bot.findBlock({
      matching: (block) => {
        if (!block) return false
        const name = block.name.toLowerCase()
        // Chỉ thu hoạch khi chín (age = 7)
        return (name === 'wheat' || name === 'carrots' || name === 'potatoes' || name === 'beetroots') &&
               block.metadata === 7
      },
      maxDistance: 32,
      count: 1
    })

    if (cropBlock) {
      if (currentTime - lastCollectLog > 10000) {
        console.log(`🌾 Tìm thấy cây trồng chín tại ${cropBlock.position}`)
        lastCollectLog = currentTime
      }

      try {
        await bot.collectBlock.collect(cropBlock)
        console.log(`✅ Đã thu hoạch ${cropBlock.name}`)
        await new Promise(resolve => setTimeout(resolve, 500))
        return
      } catch (error) {
        // Bỏ qua lỗi
      }
    }

    // Bước 3: Tìm item entities gần đó
    const nearbyItems = Object.values(bot.entities).filter(entity => 
      entity.name === 'item' && 
      entity.position && 
      bot.entity.position.distanceTo(entity.position) < 16
    )

    if (nearbyItems.length > 0) {
      const closestItem = nearbyItems[0]
      if (currentTime - lastCollectLog > 10000) {
        console.log(`🎁 Tìm thấy ${nearbyItems.length} vật phẩm gần đó`)
        lastCollectLog = currentTime
      }

      try {
        await bot.collectBlock.collect(closestItem)
        await new Promise(resolve => setTimeout(resolve, 300))
        return
      } catch (error) {
        // Bỏ qua lỗi
      }
    }

    // Bước 4: Lang thang tìm kiếm nếu không có gì
    const randomAngle = Math.random() * Math.PI * 2
    const distance = 20
    const targetX = bot.entity.position.x + Math.cos(randomAngle) * distance
    const targetZ = bot.entity.position.z + Math.sin(randomAngle) * distance

    if (currentTime - lastCollectLog > 15000) {
      console.log(`🚶 Lang thang tìm kiếm...`)
      lastCollectLog = currentTime
    }

    const movements = new Movements(bot)
    movements.canDig = false
    movements.allowSprinting = true
    bot.pathfinder.setMovements(movements)

    const goal = new goals.GoalXZ(targetX, targetZ)
    bot.pathfinder.setGoal(goal)

    // Đợi 3 giây trước khi tìm tiếp
    await new Promise(resolve => setTimeout(resolve, 3000))
  }

  // Hàm trang bị rìu tốt nhất
  async function equipBestAxe() {
    try {
      if (!bot.inventory) return

      const axes = bot.inventory.items().filter(item => item.name.includes('axe'))
      if (axes.length === 0) return

      const bestAxe = axes.sort((a, b) => {
        const getTier = (name: string) => {
          if (name.includes('netherite')) return 10
          if (name.includes('diamond')) return 8
          if (name.includes('iron')) return 6
          if (name.includes('stone')) return 4
          if (name.includes('wooden') || name.includes('wood')) return 2
          return 1
        }
        return getTier(b.name) - getTier(a.name)
      })[0]

      if (!bot.heldItem || bot.heldItem.name !== bestAxe.name) {
        await bot.equip(bestAxe, 'hand')
        console.log(`🪓 Trang bị ${bestAxe.name}`)
      }
    } catch (error) {
      // Bỏ qua lỗi
    }
  }

  stopAutoCollect = function() {
    autoCollectActive = false

    if (collectInterval) {
      clearInterval(collectInterval)
      collectInterval = null
    }

    try {
      bot.pathfinder.setGoal(null)
    } catch (error) {
      // Ignore
    }

    bot.chat('🌳 Dừng auto thu thập!')
    console.log('⏹️ Auto Collect - Deactivated')
  }

  // ============= GO HOME (QUAY VỀ SPAWN POINT) =============
  
  goHome = function() {
    if (!spawnPoint) {
      bot.chat('🥺 Tớ chưa lưu spawn point! Hãy đợi tớ spawn lần đầu.')
      console.log('❌ Spawn point chưa được lưu')
      return
    }

    // Dừng tất cả hoạt động
    stopFollowing()
    stopProtecting()
    if (autoFishingActive) stopSmartAutoFishing()
    if (autoFarmActive) stopAutoFarm()
    if (autoMiningActive) stopAutoMining()
    if (autoCropFarmerActive) stopAutoCropFarmer()
    if (autoChestHuntingActive) stopAutoChestHunting()
    if (autoExploreActive) stopAutoExplore()
    if (autoCollectActive) stopAutoCollect()

    const distance = bot.entity.position.distanceTo(spawnPoint)
    bot.chat(`🏠 Đang về nhà! Cách ${Math.floor(distance)}m`)
    console.log(`🏠 Quay về spawn point: ${Math.floor(spawnPoint.x)}, ${Math.floor(spawnPoint.y)}, ${Math.floor(spawnPoint.z)}`)

    // Sử dụng pathfinder để di chuyển về spawn
    const movements = createSmartMovements()
    movements.allowSprinting = true
    movements.allowParkour = true
    bot.pathfinder.setMovements(movements)

    const goal = new goals.GoalNear(spawnPoint.x, spawnPoint.y, spawnPoint.z, 2)
    bot.pathfinder.setGoal(goal)

    // Kiểm tra khi đến nơi bằng interval
    const checkArrival = setInterval(() => {
      if (!spawnPoint) {
        clearInterval(checkArrival)
        return
      }

      const currentDistance = bot.entity.position.distanceTo(spawnPoint)
      if (currentDistance < 3) {
        bot.chat('🏠 Đã về đến nhà rồi!')
        console.log('✅ Đã về spawn point')
        clearInterval(checkArrival)
        bot.pathfinder.setGoal(null)
      }
    }, 1000) // Kiểm tra mỗi giây

    // Timeout sau 60 giây
    setTimeout(() => {
      clearInterval(checkArrival)
    }, 60000)
  }

  // Heartbeat để duy trì connection - cải thiện với error handling
  setInterval(() => {
    if (bot && bot._client && bot._client.state === 'play') {
      try {
        // Chỉ heartbeat khi bot thực sự connected và không có hoạt động quan trọng
        if (!isCurrentlyDigging && !isEating) {
          bot.setControlState('sneak', true)
          setTimeout(() => {
            if (bot && bot._client && bot._client.state === 'play') {
              try {
                bot.setControlState('sneak', false)
              } catch (e) {
                // Ignore minor control errors
              }
            }
          }, 50) // Giảm delay từ 100ms xuống 50ms
        }
      } catch (error) {
        // Chỉ log lỗi heartbeat nếu không phải EPIPE
        const err = error as any
        if (!err.message?.includes('EPIPE')) {
          console.log('⚠️ Heartbeat warning:', err.message || error)
        }
      }
    }
  }, 300000) // 5 phút

  // Auto-check bot presence in server every 5 seconds and reconnect if needed
  let presenceCheckFailures = 0
  const MAX_PRESENCE_FAILURES = 3
  let lastPresenceCheck = Date.now()

  setInterval(async () => {
    const currentTime = Date.now()

    // Kiểm tra xem bot có còn connected không
    if (!bot || !bot._client || bot._client.state !== 'play' || bot._client.ended) {
      presenceCheckFailures++
      console.log(`❌ Bot presence check failed (${presenceCheckFailures}/${MAX_PRESENCE_FAILURES})`)

      if (presenceCheckFailures >= MAX_PRESENCE_FAILURES && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        console.log('🔄 Bot not present in server, attempting reconnect...')

        // Reset presence failures
        presenceCheckFailures = 0

        // Cleanup current bot instance
        try {
          if (bot && bot._client && !bot._client.ended) {
            bot._client.end()
          }
        } catch (e) {
          // Ignore cleanup errors
        }

        // Trigger reconnect
        console.log('🚀 Reconnecting due to presence check failure...')
        setTimeout(() => {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            console.log('🚀 Auto-reconnecting due to presence check failure...')
            createBot()
          }
        }, 2000)

        return
      }
    } else {
      // Bot is connected, check if it's actually responsive
      try {
        // Test if bot can perform basic operations
        const health = bot.health
        const position = bot.entity?.position

        if (health !== undefined && position) {
          // Bot is responsive, reset failure count
          if (presenceCheckFailures > 0) {
            console.log('✅ Bot presence restored')
            presenceCheckFailures = 0
          }
          lastPresenceCheck = currentTime
        } else {
          presenceCheckFailures++
          console.log(`⚠️ Bot unresponsive (${presenceCheckFailures}/${MAX_PRESENCE_FAILURES})`)
        }
      } catch (error) {
        presenceCheckFailures++
        console.log(`⚠️ Bot presence check error (${presenceCheckFailures}/${MAX_PRESENCE_FAILURES}):`, (error as Error).message || error)
      }
    }

    // Check for stale connection (no updates for 30+ seconds)
    if (currentTime - lastPresenceCheck > 30000) {
      presenceCheckFailures++
      console.log(`⏰ Stale connection detected (${presenceCheckFailures}/${MAX_PRESENCE_FAILURES})`)
    }

  }, 5000) // Kiểm tra mỗi 5 giây

  // Helper function để kiểm tra kết nối trước khi thực hiện hành động
  function isConnected(): boolean {
    return bot && bot._client && bot._client.state === 'play' && !bot._client.ended
  }

  // Helper function để thực hiện action an toàn
  function safeAction(action: () => void, actionName: string = 'action') {
    try {
      if (!isConnected()) {
        console.log(`⚠️ Bỏ qua ${actionName} - bot không connected`)
        return false
      }
      action()
      return true
    } catch (error) {
      const err = error as any
      if (!err.message?.includes('EPIPE')) {
        console.log(`⚠️ Lỗi ${actionName}:`, err.message || error)
      }
      return false
    }
  }

  // Handle kick events to see why bot is being disconnected
  bot.on('kicked', (reason: string) => {
    console.log('⚠️ Bot bị kick khỏi server!')
    console.log('📋 Lý do kick:', reason)
    try {
      const reasonObj = JSON.parse(reason)
      console.log('📋 Chi tiết kick:', JSON.stringify(reasonObj, null, 2))
    } catch {
      console.log('📋 Raw kick reason:', reason)
    }
  })

  // Error handling với improved EPIPE handling và auto-reconnect
  bot.on('error', (err: any) => {
    const errorMessage = err.message || err.toString()

    // Chỉ log lỗi quan trọng, bỏ qua spam
    if (!errorMessage.includes('write EPIPE') &&
        !errorMessage.includes('read ECONNRESET') &&
        !errorMessage.includes('ECONNRESET') &&
        !errorMessage.includes('ECONN') &&
        !errorMessage.includes('EADDRINUSE')) {
      console.log('🛑 Bot gặp lỗi:', errorMessage)
    }

    // Phân loại lỗi để xử lý phù hợp
    const criticalErrors = ['ENOTFOUND', 'Invalid username', 'EAUTH', 'Failed to authenticate', 'Invalid session']
    const networkErrors = ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'socketClosed', 'ECONN']
    const serverErrors = ['Server closed', 'Connection lost', 'Timed out', 'kicked']

    if (criticalErrors.some(errType => errorMessage.includes(errType))) {
      console.log('❌ Lỗi nghiêm trọng, dừng auto-reconnect')
      reconnectAttempts = MAX_RECONNECT_ATTEMPTS // Force stop reconnection
      return
    }

    if (networkErrors.some(errType => errorMessage.includes(errType)) ||
        serverErrors.some(errType => errorMessage.includes(errType))) {
      // Chỉ log EPIPE warning một lần
      if (errorMessage.includes('EPIPE') && !(bot as any)._epipeWarned) {
        console.log('⚠️ Kết nối bị ngắt (EPIPE), sẽ auto-reconnect...')
        ;(bot as any)._epipeWarned = true
      }

      // Cleanup safely để tránh thêm EPIPE errors
      try {
        stopAll()
      } catch (cleanupError) {
        // Ignore cleanup errors
      }

      // Trigger auto-reconnect for network/server errors if within limit
      if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
        console.log('🔄 Network error detected, scheduling auto-reconnect...')
        setTimeout(() => {
          if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
            console.log('🚀 Auto-reconnecting due to network error...')
            createBot()
          }
        }, 3000)
      }
      return
    }

    console.log('⚠️ Lỗi khác, tiếp tục hoạt động...')
  })

  bot.on('end', (reason: string) => {
    console.log('💔 Bot đã ngắt kết nối:', reason || 'Unknown reason')
    if (pvpActive) {
      console.log('🔴 Bot đang ở chế độ PVP khi mất kết nối - có thể do server chống gian lận hoặc spam hành vi')
    }

    // Ensure PVP state is cleared so we don't resume mistakenly
    pvpActive = false
    if (pvpInterval) {
      clearInterval(pvpInterval)
      pvpInterval = null
    }

    // Graceful cleanup - catch any errors
    try {
      // Clear all activities when disconnected
      if (autoFarmActive) stopAutoFarm()
      autoFishingActive = false
      if (typeof autoMiningActive !== 'undefined') {
        autoMiningActive = false
      }
      isEating = false
      if (typeof isCurrentlyDigging !== 'undefined') {
        isCurrentlyDigging = false
      }
      autoEatPluginActive = false
      autoChestHuntingActive = false
      isCurrentlyApproachingChest = false
      currentChestTarget = null

      // Clear intervals safely
      if (followInterval) clearInterval(followInterval)
      if (protectInterval) clearInterval(protectInterval)
      if (typeof miningInterval !== 'undefined' && miningInterval) clearInterval(miningInterval)
      if (fishingInterval) clearInterval(fishingInterval)
      if (hookCheckInterval) clearInterval(hookCheckInterval)
      if (chestHuntingInterval) clearInterval(chestHuntingInterval)

      // Reset pathfinder safely
      if (bot && bot.pathfinder) {
        try {
                    bot.pathfinder.setGoal(null)
        } catch (e) {
          // Ignore pathfinder errors during cleanup
        }
      }

      // Cleanup prismarine-viewer instance
      if (prismarineViewerInstance) {
        try {
          console.log('🧹 Cleaning up prismarine-viewer instance on disconnect...')
          if (typeof prismarineViewerInstance.close === 'function') {
            prismarineViewerInstance.close()
          }
          prismarineViewerInstance = null
          console.log('✅ Prismarine-viewer cleanup completed')
        } catch (viewerCleanupError) {
          // Silent cleanup để tránh spam log
          prismarineViewerInstance = null
        }
      }

      // Reset viewer setup flag to allow setup on reconnect
      prismarineViewerSetup = false
      console.log('🔄 Reset prismarine viewer setup flag for future connections')

    } catch (cleanupError) {
      console.log('⚠️ Lỗi cleanup khi disconnect:', (cleanupError as Error).message || cleanupError)
    }

    // Cập nhật bot status cho web interface
    setBotConnected(false)

    const shouldReconnect =
      (
        reason === 'socketClosed' ||
        reason === 'disconnect.timeout' ||
        reason === 'disconnect.quitting' ||
        reason === 'ECONNRESET' ||
        !reason || reason === ''
      ) &&
      reconnectAttempts < MAX_RECONNECT_ATTEMPTS

    if (shouldReconnect) {
      reconnectAttempts++
      // Tăng delay base lên 60s và max lên 5 phút để giảm spam reconnect
      const delay = Math.min(60000 * reconnectAttempts, 300000)
      console.log(`⏳ Server có thể đang không ổn định. Chờ ${delay/1000} giây trước khi reconnect... (${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`)

      setTimeout(async () => {
        console.log('🔄 Kiểm tra server và thử kết nối lại...')

        // Kiểm tra server trước khi reconnect
        const serverOnline = await testServerConnection()
        if (!serverOnline) {
          console.log('❌ Server vẫn offline, sẽ thử lại sau...')
          // Reset để thử lại
          setTimeout(() => createBot(), 30000)
          return
        }

        createBot()
      }, delay)
    } else {
      console.log('❌ Dừng auto-reconnect')
      console.log(`💡 Lý do: ${reason} | Số lần thử: ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`)

      // Reset reconnect counter sau 10 phút để có thể thử lại sau
      setTimeout(() => {
        reconnectAttempts = 0
        console.log('🔄 Reset reconnect counter, có thể thử manual restart')
      }, 600000)
    }
  })
}

// Khởi tạo bot
createBot()
