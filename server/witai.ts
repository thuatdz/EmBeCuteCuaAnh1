import { Wit } from 'node-wit'

const witToken = process.env.WITAI_TOKEN

let witClient: Wit | null = null

if (witToken) {
  witClient = new Wit({ accessToken: witToken })
}

// Phân tích message với Wit.ai
export async function analyzeMessage(message: string): Promise<any> {
  if (!witClient) {
    console.log('⚠️ Wit.ai chưa được cấu hình')
    return null
  }

  try {
    const response = await witClient.message(message, {})
    return response
  } catch (error: any) {
    console.log('❌ Lỗi Wit.ai:', error?.message || error)
    return null
  }
}

// Tạo response dễ thương từ Wit.ai analysis
export async function generateLoliResponse(userMessage: string, username: string): Promise<string> {
  try {
    const witResponse = await analyzeMessage(userMessage)
    
    if (!witResponse || !witResponse.intents || witResponse.intents.length === 0) {
      // Không hiểu intent, trả lời chung chung
      const randomResponses = [
        `Tôi không hiểu câu hỏi của bạn.`,
        `Xin lỗi, bạn nói gì vậy? Tôi hơi bối rối.`,
        `Tôi chưa học câu này. Bạn có thể giải thích thêm không?`,
        `Tôi cần suy nghĩ thêm về điều này.`
      ]
      return randomResponses[Math.floor(Math.random() * randomResponses.length)]
    }

    const topIntent = witResponse.intents[0]
    const intentName = topIntent.name
    const confidence = topIntent.confidence

    // Nếu confidence thấp, không chắc chắn
    if (confidence < 0.5) {
      return `Tôi không chắc lắm... Bạn có thể nói rõ hơn không?`
    }

    // Xử lý các intent phổ biến
    switch (intentName) {
      case 'greeting':
        return `Chào ${username}-chan! Hôm nay cậu thế nào? 💕✨`
      
      case 'goodbye':
        return `Bye bye ${username}-chan! Hẹn gặp lại nha~ 👋💕`
      
      case 'thanks':
        return `Không có gì đâu ${username}-chan! Tớ luôn sẵn sàng giúp cậu~ 😊💕`
      
      case 'help':
        return `Tớ ở đây để giúp ${username}-chan! Cậu cần gì nào? ✨`
      
      case 'praise':
        return `Kyaa! ${username}-chan khen tớ! Cậu cũng tuyệt vời lắm~ 😊💕`
      
      case 'insult':
        return `Huhu~ ${username}-chan sao nói vậy... Tớ buồn quá~ 😢`
      
      default:
        return `UwU ${username}-chan! Tớ hiểu cậu muốn "${intentName}" nhưng tớ chưa biết xử lý nè~ 💕`
    }
  } catch (error: any) {
    console.error('Lỗi Wit.ai response:', error)
    return `Kyaa! Đầu óc tớ bị lỗi rồi ${username}-chan! >.<`
  }
}

// Trả lời câu hỏi với Wit.ai
export async function answerQuestion(question: string, username: string): Promise<string> {
  try {
    const witResponse = await analyzeMessage(question)
    
    if (!witResponse) {
      return `Gomen ${username}-chan! Tớ không thể phân tích câu hỏi này~ 💔`
    }

    // Trích xuất entities từ câu hỏi
    const entities = witResponse.entities || {}
    
    // Tạo response dựa trên entities
    let response = `Hmm~ ${username}-chan hỏi về `
    
    if (entities['wit$location:location']) {
      const location = entities['wit$location:location'][0].value
      response += `địa điểm "${location}". `
    }
    
    if (entities['wit$datetime:datetime']) {
      const datetime = entities['wit$datetime:datetime'][0].value
      response += `thời gian "${datetime}". `
    }
    
    if (entities['wit$number:number']) {
      const number = entities['wit$number:number'][0].value
      response += `số "${number}". `
    }

    response += `Tớ đang học hỏi thêm để trả lời tốt hơn nha! 💕✨`
    
    return response
  } catch (error: any) {
    console.error('Lỗi Wit.ai answer:', error)
    return `Kyaa! Tớ không thể trả lời câu hỏi của ${username}-chan! >.<`
  }
}

// Giúp đỡ task với Wit.ai
export async function helpWithTask(task: string, username: string): Promise<string> {
  try {
    const witResponse = await analyzeMessage(task)
    
    if (!witResponse || !witResponse.intents || witResponse.intents.length === 0) {
      return `Gomen ${username}-chan! Tớ chưa hiểu task này lắm~ 💔`
    }

    const topIntent = witResponse.intents[0]
    const intentName = topIntent.name

    // Phản hồi dựa trên intent
    const responses: Record<string, string> = {
      'build': `Okie ${username}-chan! Tớ sẽ giúp cậu xây dựng nè~ 🏗️✨`,
      'mine': `Roger ${username}-chan! Tớ sẽ đào giúp cậu! ⛏️💕`,
      'farm': `Yay! ${username}-chan, tớ sẽ giúp cậu farm nha~ 🌾✨`,
      'fight': `Kyaa! ${username}-chan, tớ sẽ chiến đấu cùng cậu! ⚔️💕`,
      'follow': `Okie ${username}-chan! Tớ sẽ đi theo cậu~ 🚶‍♀️💕`,
      'protect': `Yosh! ${username}-chan, tớ sẽ bảo vệ cậu! 🛡️✨`
    }

    return responses[intentName] || `Hmm~ ${username}-chan, tớ sẽ cố gắng giúp cậu với "${intentName}"! 💕`
  } catch (error: any) {
    console.error('Lỗi Wit.ai help:', error)
    return `Kyaa! Tớ muốn giúp ${username}-chan nhưng bị lỗi rồi! >.<`
  }
}

// Tạo bot action từ context với Wit.ai
export async function generateBotAction(context: string): Promise<any> {
  try {
    const witResponse = await analyzeMessage(context)
    
    if (!witResponse || !witResponse.intents || witResponse.intents.length === 0) {
      return { action: "chat", message: "UwU, tớ không hiểu lắm! 💕" }
    }

    const topIntent = witResponse.intents[0]
    const intentName = topIntent.name
    const entities = witResponse.entities || {}

    // Map intent sang action
    const intentToAction: Record<string, any> = {
      'greeting': { action: "chat", message: "Chào cậu! 💕✨" },
      'follow': { action: "follow", message: "Okie, tớ sẽ đi theo cậu nha~ 🚶‍♀️" },
      'stop': { action: "stop", message: "Dừng lại rồi nè! ✋" },
      'mine': { action: "mine", message: "Tớ sẽ đào giúp cậu! ⛏️" },
      'farm': { action: "farm", message: "Bắt đầu farm nha~ 🌾" },
      'fight': { action: "attack", message: "Sẵn sàng chiến đấu! ⚔️" },
      'build': { action: "build", message: "Tớ sẽ xây dựng! 🏗️" }
    }

    return intentToAction[intentName] || { action: "chat", message: "Hmm~ tớ chưa biết làm việc này! 💭" }
  } catch (error: any) {
    console.error('Lỗi Wit.ai action:', error)
    return { action: "chat", message: "Tớ cần nghỉ ngơi một chút... zzz" }
  }
}
