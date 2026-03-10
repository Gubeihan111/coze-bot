const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'bot_db';
const COLLECTION_NAME = 'conversations';

const COZE_API_URL = 'https://h2k7fgbmn3.coze.site/stream_run'; // 你的扣子 API 地址
const COZE_TOKEN = process.env.COZE_TOKEN;
const PROJECT_ID = process.env.PROJECT_ID;

let cachedClient = null;

async function connectToDatabase() {
    if (cachedClient) return cachedClient;
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    cachedClient = client;
    return client;
}

module.exports = async (req, res) => {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, question } = req.body;
    if (!userId || !question) {
        return res.status(400).json({ error: 'Missing userId or question' });
    }

    try {
        // 调用扣子 API
        const cozeResponse = await fetch(COZE_API_URL, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${COZE_TOKEN}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                content: {
                    query: {
                        prompt: [
                            { type: 'text', content: { text: question } }
                        ]
                    }
                },
                type: 'query',
                session_id: userId,
                project_id: parseInt(PROJECT_ID)
            })
        });

        const cozeData = await cozeResponse.json();
        // 根据实际返回格式调整解析逻辑，这里假设回复在 cozeData.content 或类似位置
        let botReply = cozeData.content || cozeData.reply || '无法解析回复';

        // 存入数据库
        const client = await connectToDatabase();
        const db = client.db(DB_NAME);
        const collection = db.collection(COLLECTION_NAME);
        await collection.insertOne({
            userId,
            sessionId: userId,
            userMessage: question,
            botResponse: botReply,
            timestamp: new Date()
        });

        res.status(200).json({ reply: botReply });

    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};