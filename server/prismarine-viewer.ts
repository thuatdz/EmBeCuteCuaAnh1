
import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';

const app = express();
const server = createServer(app);

// Add body parser middleware
app.use(express.json());

// Add favicon route to support connection testing
app.get('/favicon.ico', (req, res) => {
  res.status(200).end();
});

// Add health check route for connection testing
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'prismarine-viewer' });
});

// 3D Minecraft World Viewer - Real-time view through bot's eyes
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html lang="vi">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>🎮 Bot Loli Cute - 3D Minecraft World View</title>
        <style>
            body {
                margin: 0;
                padding: 0;
                background: #000;
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                color: white;
                height: 100vh;
                overflow: hidden;
            }
            .header {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                z-index: 1000;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                padding: 10px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            }
            .header h1 {
                margin: 0;
                font-size: 1.5rem;
                text-shadow: 2px 2px 4px rgba(0,0,0,0.3);
            }
            .header-controls {
                display: flex;
                gap: 10px;
            }
            .btn {
                padding: 8px 16px;
                background: rgba(255, 255, 255, 0.1);
                color: white;
                text-decoration: none;
                border-radius: 20px;
                font-weight: bold;
                transition: all 0.3s;
                backdrop-filter: blur(10px);
                border: 1px solid rgba(255, 255, 255, 0.2);
            }
            .btn:hover {
                background: rgba(255, 255, 255, 0.2);
                transform: translateY(-2px);
            }
            .viewer-container {
                position: absolute;
                top: 60px;
                left: 0;
                right: 0;
                bottom: 0;
                display: flex;
                justify-content: center;
                align-items: center;
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .info-box {
                text-align: center;
                padding: 40px;
                background: rgba(0, 0, 0, 0.6);
                border-radius: 20px;
                backdrop-filter: blur(10px);
            }
            .info-box h2 {
                margin: 0 0 20px 0;
                font-size: 2rem;
            }
            .info-box p {
                margin: 10px 0;
                opacity: 0.9;
            }
            .bot-status {
                position: fixed;
                bottom: 20px;
                right: 20px;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(10px);
                padding: 15px;
                border-radius: 10px;
                border: 1px solid rgba(255, 255, 255, 0.1);
                font-size: 0.9rem;
            }
            .status-online {
                color: #4CAF50;
            }
            .status-offline {
                color: #ff6b6b;
            }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>🎮 Bot Loli Cute - Minecraft World Viewer</h1>
            <div class="header-controls">
                <a href="http://localhost:5000" class="btn" target="_blank">
                    🤖 Bot Manager
                </a>
            </div>
        </div>

        <div class="viewer-container">
            <div class="info-box">
                <h2>📡 3D World Viewer</h2>
                <p>🔧 Prismarine viewer được khởi tạo qua bot process</p>
                <p>👁️ Viewer sẽ tự động khởi động khi bot connect vào server</p>
                <p>🌐 Check console logs để xem viewer URL</p>
                <div style="margin-top: 20px; padding: 15px; background: rgba(255,255,255,0.1); border-radius: 10px;">
                    <strong>Status:</strong> <span id="viewerStatus">Đợi bot kết nối...</span>
                </div>
            </div>
        </div>

        <div class="bot-status" id="botStatus">
            <div>🤖 <span id="botName">botlolicute</span></div>
            <div>Status: <span id="status" class="status-offline">Loading...</span></div>
            <div>❤️ HP: <span id="health">-</span></div>
            <div>🍞 Food: <span id="food">-</span></div>
            <div>📍 Pos: <span id="position">-</span></div>
        </div>

        <script>
            // Fetch bot status từ API
            async function updateBotStatus() {
                try {
                    const response = await fetch('/api/bot-status');
                    const bot = await response.json();

                    if (bot && bot.status !== 'offline') {
                        document.getElementById('status').textContent = bot.status || 'Offline';
                        const pos = bot.position || { x: 0, y: 0, z: 0 };
                        document.getElementById('position').textContent = Math.floor(pos.x) + ', ' + Math.floor(pos.y) + ', ' + Math.floor(pos.z);
                        document.getElementById('health').textContent = (bot.health || 0) + '/20';
                        document.getElementById('food').textContent = (bot.food || 0) + '/20';
                        document.getElementById('status').className = 'status-online';
                        document.getElementById('viewerStatus').textContent = 'Bot đang online - Check console logs';
                    } else {
                        document.getElementById('status').textContent = 'Offline';
                        document.getElementById('status').className = 'status-offline';
                        document.getElementById('position').textContent = '-';
                        document.getElementById('health').textContent = '-';
                        document.getElementById('food').textContent = '-';
                        document.getElementById('viewerStatus').textContent = 'Đợi bot kết nối...';
                    }
                } catch (error) {
                    console.log('Error fetching bot status:', error);
                    document.getElementById('status').textContent = 'Offline';
                    document.getElementById('status').className = 'status-offline';
                }
            }

            updateBotStatus();
            setInterval(updateBotStatus, 3000);
        </script>
    </body>
    </html>
  `);
});

// Global variable để lưu bot status data từ bot process
let cachedBotStatus = {
  connected: false,
  status: 'offline',
  position: { x: 0, y: 64, z: 0 },
  health: 0,
  food: 0,
  inventory: { items: [], equipment: {}, totalItems: 0 }
};

// API endpoint để nhận real-time bot data từ bot process
app.post('/api/bot-viewer-sync', (req, res) => {
  try {
    const { position, health, food, status, connected, inventory } = req.body;

    cachedBotStatus = {
      connected: connected || false,
      status: status || 'offline',
      position: position || { x: 0, y: 64, z: 0 },
      health: health || 0,
      food: food || 0,
      inventory: inventory || { items: [], equipment: {}, totalItems: 0 }
    };

    if (Math.random() < 0.02) {
      console.log('🔄 Bot viewer sync:', {
        connected: cachedBotStatus.connected,
        health: cachedBotStatus.health,
        food: cachedBotStatus.food,
        items: cachedBotStatus.inventory?.totalItems || 0
      });
    }

    res.json({ success: true });
  } catch (error) {
    console.log('❌ Bot viewer sync error:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// API endpoint để lấy thông tin bot với real-time data
app.get('/api/bot-status', async (req, res) => {
  try {
    // Sử dụng cached data từ bot sync
    if (cachedBotStatus.connected) {
      res.json({
        status: cachedBotStatus.status || 'online',
        position: cachedBotStatus.position || { x: 0, y: 64, z: 0 },
        health: cachedBotStatus.health || 20,
        food: cachedBotStatus.food || 20,
        inventory: cachedBotStatus.inventory || { items: [], equipment: {}, totalItems: 0 },
        connected: true
      });
    } else {
      res.json({ 
        status: cachedBotStatus.status || 'offline', 
        connected: false,
        position: { x: 0, y: 64, z: 0 },
        health: 0,
        food: 0,
        inventory: { items: [], equipment: {}, totalItems: 0 }
      });
    }
  } catch (error) {
    console.log('Lỗi lấy bot status:', error);
    res.json({ 
      status: 'offline', 
      error: (error as Error).message, 
      connected: false, 
      inventory: { items: [], equipment: {}, totalItems: 0 } 
    });
  }
});

// Start server trên port 3001
const PORT = 3001;

server.on('error', (error: any) => {
  if (error.code === 'EADDRINUSE') {
    console.log(`⚠️ Port ${PORT} đã được sử dụng`);
  } else {
    console.log(`❌ Lỗi khởi động prismarine-viewer:`, error.message);
  }
});

const host = process.platform === 'win32' ? 'localhost' : '0.0.0.0';
server.listen(PORT, host, () => {
  console.log(`✅ Bot Viewer Dashboard đã khởi động thành công!`);
  console.log(`👁️ Truy cập dashboard tại: http://localhost:${PORT}`);
});

export default app;
