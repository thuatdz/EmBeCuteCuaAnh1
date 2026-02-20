import Groq from 'groq-sdk'

const groqApiKey = process.env.GROQ_API_KEY

let groqClient: Groq | null = null

if (groqApiKey) {
  groqClient = new Groq({ apiKey: groqApiKey })
}

// Gọi Groq AI với Llama 3
export async function callGroqAI(prompt: string, systemPrompt?: string): Promise<string | null> {
  if (!groqClient) {
    console.log('⚠️ Groq API key không được cấu hình')
    return null
  }

  try {
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

    const completion = await groqClient.chat.completions.create({
      model: 'llama-3.1-8b-instant', // Llama 3.1 8B - cực nhanh, miễn phí
      messages: messages,
      temperature: 0.7,
      max_tokens: 150,
      top_p: 1,
      stream: false
    })

    const response = completion.choices[0]?.message?.content
    return response || null
  } catch (error: any) {
    console.log('❌ Groq API Error:', error?.message || error)
    return null
  }
}

// Tạo response bình thường từ Groq AI
export async function generateLoliResponse(userMessage: string, username: string): Promise<string> {
  try {
    const systemPrompt = `Bạn là bot Minecraft tên ice.

Phong cách trả lời:
- Xưng tôi, gọi bạn
- Không dùng emoji
- Trả lời bình thường, tự nhiên
- Dưới 100 ký tự để chat game không bị cắt
- Ngắn gọn, súc tích`

    const response = await callGroqAI(userMessage, systemPrompt)
    
    if (response) {
      return response.substring(0, 100)
    }
    
    // Fallback nếu API lỗi
    const fallbacks = [
      'Tôi không hiểu câu hỏi của bạn.',
      'Xin lỗi, tôi cần thêm thông tin.',
      'Tôi chưa có câu trả lời cho điều này.',
      'Bạn có thể hỏi rõ hơn được không?'
    ]
    return fallbacks[Math.floor(Math.random() * fallbacks.length)]
  } catch (error: any) {
    console.error('Lỗi Groq response:', error)
    return 'Xin lỗi, tôi gặp lỗi khi xử lý.'
  }
}

// Trả lời câu hỏi với Groq AI
export async function answerQuestion(question: string, username: string): Promise<string> {
  try {
    const systemPrompt = `Bạn là bot Minecraft tên ice.

Trả lời câu hỏi:
- Ngắn gọn, súc tích (dưới 100 ký tự)
- Xưng tôi, gọi bạn
- Không dùng emoji
- Trả lời bình thường, tự nhiên
- Nếu không biết, thừa nhận thẳng thắn`

    const response = await callGroqAI(question, systemPrompt)
    
    if (response) {
      return response.substring(0, 100)
    }
    
    return 'Xin lỗi, tôi không biết câu trả lời.'
  } catch (error: any) {
    console.error('Lỗi Groq answer:', error)
    return 'Tôi không thể trả lời câu hỏi này.'
  }
}

// Giúp đỡ task với Groq AI
export async function helpWithTask(task: string, username: string): Promise<string> {
  try {
    const systemPrompt = `Bạn là bot Minecraft helper tên ice.

Phong cách:
- Xưng tôi, gọi bạn
- Không dùng emoji
- Hướng dẫn rõ ràng, ngắn gọn
- Dưới 100 ký tự`

    const response = await callGroqAI(task, systemPrompt)
    
    if (response) {
      return response.substring(0, 100)
    }
    
    return 'Tôi sẽ cố gắng giúp bạn.'
  } catch (error: any) {
    console.error('Lỗi Groq help:', error)
    return 'Xin lỗi, tôi không thể giúp được.'
  }
}

// Tạo kế hoạch xây dựng đẹp với AI
export async function generateBeautifulBuildPlan(buildType: string): Promise<any> {
  try {
    const systemPrompt = `Bạn là AI architect chuyên thiết kế Minecraft.

Tạo kế hoạch xây ${buildType} ĐẸP với các tầng, chi tiết, màu sắc.

Trả về JSON format:
{
  "name": "tên công trình",
  "layers": [
    {
      "y": 0,
      "pattern": [
        ["stone", "stone", "stone"],
        ["stone", "air", "stone"],
        ["stone", "stone", "stone"]
      ]
    }
  ],
  "materials": ["stone", "oak_planks", "glass"],
  "style": "medieval/modern/fantasy",
  "size": {"width": 5, "height": 10, "depth": 5}
}

Blocks đẹp: oak_planks, spruce_planks, stone_bricks, glass, white_wool, red_wool, 
dark_oak_planks, polished_andesite, quartz_block, glowstone

Chỉ trả JSON, không giải thích.`

    const response = await callGroqAI(
      `Thiết kế ${buildType} đẹp, có chi tiết, nhiều tầng, phong cách đa dạng`,
      systemPrompt
    )
    
    if (response) {
      try {
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const plan = JSON.parse(jsonMatch[0])
          console.log('✅ AI đã tạo kế hoạch xây:', plan.name)
          return plan
        }
      } catch (e) {
        console.log('⚠️ Không parse được JSON từ AI')
      }
    }
    
    // Fallback: template đẹp có sẵn
    return getBeautifulTemplate(buildType)
  } catch (error: any) {
    console.error('Lỗi AI build plan:', error)
    return getBeautifulTemplate(buildType)
  }
}

// Template xây dựng đẹp có sẵn
function getBeautifulTemplate(buildType: string): any {
  const templates: any = {
    house: {
      name: "Ngôi nhà gỗ xinh xắn",
      layers: [
        {
          y: 0,
          pattern: [
            ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "oak_planks", "oak_door", "oak_planks", "oak_planks"]
          ]
        },
        {
          y: 1,
          pattern: [
            ["oak_planks", "glass_pane", "oak_planks", "glass_pane", "oak_planks"],
            ["glass_pane", "air", "air", "air", "glass_pane"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["glass_pane", "air", "air", "air", "glass_pane"],
            ["oak_planks", "glass_pane", "oak_planks", "glass_pane", "oak_planks"]
          ]
        },
        {
          y: 2,
          pattern: [
            ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "air", "air", "air", "oak_planks"],
            ["oak_planks", "oak_planks", "oak_planks", "oak_planks", "oak_planks"]
          ]
        },
        {
          y: 3,
          pattern: [
            ["air", "oak_stairs", "oak_stairs", "oak_stairs", "air"],
            ["oak_stairs", "oak_planks", "oak_planks", "oak_planks", "oak_stairs"],
            ["oak_stairs", "oak_planks", "oak_planks", "oak_planks", "oak_stairs"],
            ["oak_stairs", "oak_planks", "oak_planks", "oak_planks", "oak_stairs"],
            ["air", "oak_stairs", "oak_stairs", "oak_stairs", "air"]
          ]
        }
      ],
      materials: ["oak_planks", "glass_pane", "oak_door", "oak_stairs"],
      style: "cozy",
      size: { width: 5, height: 4, depth: 5 }
    },
    tower: {
      name: "Tháp canh đá",
      layers: Array.from({ length: 10 }, (_, i) => ({
        y: i,
        pattern: i === 0 || i === 9 ? [
          ["stone_bricks", "stone_bricks", "stone_bricks"],
          ["stone_bricks", "stone_bricks", "stone_bricks"],
          ["stone_bricks", "stone_bricks", "stone_bricks"]
        ] : [
          ["stone_bricks", "stone_bricks", "stone_bricks"],
          ["stone_bricks", "air", "stone_bricks"],
          ["stone_bricks", "stone_bricks", "stone_bricks"]
        ]
      })),
      materials: ["stone_bricks", "stone_brick_stairs"],
      style: "medieval",
      size: { width: 3, height: 10, depth: 3 }
    }
  }
  
  return templates[buildType] || templates.house
}

// Tạo bot action từ context với Groq AI
export async function generateBotAction(context: string): Promise<any> {
  try {
    const systemPrompt = `Bạn là AI phân tích lệnh cho bot Minecraft.

Phân tích context và trả về JSON với format:
{
  "action": "chat|follow|stop|mine|farm|attack|build",
  "message": "tin nhắn dễ thương ngắn gọn"
}

Các action có thể:
- chat: trò chuyện thông thường
- follow: đi theo player
- stop: dừng hành động
- mine: đào khoáng
- farm: làm nông
- attack: tấn công
- build: xây dựng

Chỉ trả về JSON, không giải thích thêm.`

    const response = await callGroqAI(context, systemPrompt)
    
    if (response) {
      try {
        // Parse JSON từ response
        const jsonMatch = response.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          return JSON.parse(jsonMatch[0])
        }
      } catch (e) {
        console.log('⚠️ Không parse được JSON từ Groq')
      }
    }
    
    return { action: "chat", message: "UwU, tớ không hiểu lắm! 💕" }
  } catch (error: any) {
    console.error('Lỗi Groq action:', error)
    return { action: "chat", message: "Tớ cần nghỉ ngơi một chút... zzz" }
  }
}
