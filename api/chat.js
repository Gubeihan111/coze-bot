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
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const { userId, question } = req.body;
    if (!userId || !question) {
        return res.status(400).json({ error: 'Missing userId or question' });
    }

    try {
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

        if (!cozeResponse.ok) {
            const errorText = await cozeResponse.text();
            console.error('Coze API error:', cozeResponse.status, errorText);
            return res.status(502).json({ error: `Coze API responded with ${cozeResponse.status}` });
        }

        // 处理 SSE 流
        const reader = cozeResponse.body.getReader();
        const decoder = new TextDecoder('utf-8');
        let buffer = '';
        let fullAnswer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    const dataStr = line.slice(6);
                    try {
                        const eventData = JSON.parse(dataStr);
                        if (eventData.type === 'answer' && eventData.content?.answer) {
                            fullAnswer += eventData.content.answer;
                        }
                    } catch (e) {
                        console.error('Failed to parse event data:', dataStr, e);
                    }
                }
            }
        }

        const botReply = fullAnswer.trim() || '无法获取回复';

        // 存入数据库
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
        } catch (dbErr) {
            console.error('Database error:', dbErr);
        }

        res.status(200).json({ reply: botReply });

    } catch (error) {
        console.error('Unhandled error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
