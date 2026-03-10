const { MongoClient } = require('mongodb');

const MONGODB_URI = process.env.MONGODB_URI;
const DB_NAME = 'bot_db';
const COLLECTION_NAME = 'conversations';
const COZE_API_URL = 'https://h2k7fgbmn3.coze.site/stream_run';
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
    console.log('Request received:', req.method, req.body);

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, question } = req.body || {};
    if (!userId || !question) {
        return res.status(400).json({ error: 'Missing userId or question' });
    }

    try {
        // 1. 调用扣子 API
        console.log('Calling Coze API...');
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

        console.log('Coze API response status:', cozeResponse.status);
        const responseText = await cozeResponse.text();
        console.log('Coze API raw response:', responseText);

        let botReply = '无法解析回复';
        try {
            const cozeData = JSON.parse(responseText);
            botReply = cozeData.content || cozeData.reply || cozeData.answer || JSON.stringify(cozeData);
        } catch (parseErr) {
            console.error('JSON parse error:', parseErr);
            botReply = responseText; // 直接返回原始文本
        }

        // 2. 存入数据库
        try {
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
            console.log('Database insert success');
        } catch (dbErr) {
            console.error('Database error:', dbErr);
            // 即使数据库失败，也继续返回回复
        }

        res.status(200).json({ reply: botReply });

    } catch (error) {
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
};
