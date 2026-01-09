const express = require('express');
const { LiveChat } = require('youtube-chat');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Store active chat connections
const activeChats = new Map();

// Generate vibrant color from username
function getUsernameColor(username) {
    const colors = [
        '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF',
        '#00FFFF', '#FFA500', '#800080', '#008000', '#000080',
        '#800000', '#008080', '#FF4500', '#DA70D6', '#32CD32'
    ];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = username.charCodeAt(i) + ((hash << 5) - hash);
    }
    return colors[Math.abs(hash) % colors.length];
}

// Homepage route
app.get('/', (req, res) => {
    res.sendFile('index.html', { root: './public' });
});

// Generate overlay link
app.post('/generate-overlay', (req, res) => {
    const { channelId } = req.body;
    
    if (!channelId) {
        return res.status(400).json({ error: 'Channel ID is required' });
    }
    
    const overlayId = `overlay_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const overlayUrl = `${req.protocol}://${req.get('host')}/overlay/${overlayId}`;
    
    res.json({ overlayUrl, overlayId });
});

// Overlay page
app.get('/overlay/:id', (req, res) => {
    res.sendFile('overlay.html', { root: './public' });
});

// WebSocket/SSE endpoint for chat data
app.get('/stream/:overlayId', (req, res) => {
    const { overlayId } = req.params;
    
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
    });
    
    // Store this connection
    if (!activeChats.has(overlayId)) {
        activeChats.set(overlayId, []);
    }
    activeChats.get(overlayId).push(res);
    
    // Remove connection when client closes
    req.on('close', () => {
        const connections = activeChats.get(overlayId);
        if (connections) {
            const index = connections.indexOf(res);
            if (index > -1) {
                connections.splice(index, 1);
            }
            if (connections.length === 0) {
                activeChats.delete(overlayId);
            }
        }
    });
});

// Start YouTube chat monitoring
app.post('/start-chat', async (req, res) => {
    const { overlayId, channelId } = req.body;
    
    try {
        const liveChat = new LiveChat({ channelId });
        
        liveChat.on('start', (liveId) => {
            console.log(`Started monitoring chat for live ID: ${liveId}`);
        });
        
        liveChat.on('chat', (chatItem) => {
            // Process chat message
            const message = {
                id: Date.now() + Math.random(),
                author: {
                    name: chatItem.author.name,
                    color: getUsernameColor(chatItem.author.name),
                    badges: {
                        isMembership: chatItem.isMembership,
                        isVerified: chatItem.isVerified,
                        isOwner: chatItem.isOwner,
                        isModerator: chatItem.isModerator,
                        customBadge: chatItem.author.badge
                    }
                },
                message: chatItem.message.map(item => {
                    if ('text' in item) {
                        return { type: 'text', content: item.text };
                    } else {
                        return { 
                            type: 'emoji', 
                            url: item.url,
                            alt: item.alt,
                            isCustomEmoji: item.isCustomEmoji
                        };
                    }
                }),
                timestamp: chatItem.timestamp
            };
            
            // Send to all connected clients for this overlay
            const connections = activeChats.get(overlayId);
            if (connections) {
                connections.forEach(client => {
                    client.write(`data: ${JSON.stringify(message)}\n\n`);
                });
            }
        });
        
        liveChat.on('error', (err) => {
            console.error('Chat error:', err);
        });
        
        liveChat.on('end', (reason) => {
            console.log(`Chat ended: ${reason}`);
        });
        
        const ok = await liveChat.start();
        if (!ok) {
            return res.status(500).json({ error: 'Failed to start chat monitoring' });
        }
        
        // Store the liveChat instance
        if (!activeChats.has(`instance_${overlayId}`)) {
            activeChats.set(`instance_${overlayId}`, liveChat);
        }
        
        res.json({ success: true, message: 'Chat monitoring started' });
        
    } catch (error) {
        console.error('Error starting chat:', error);
        res.status(500).json({ error: 'Failed to start chat monitoring' });
    }
});

// Stop chat monitoring
app.post('/stop-chat', (req, res) => {
    const { overlayId } = req.body;
    
    const instanceKey = `instance_${overlayId}`;
    const liveChat = activeChats.get(instanceKey);
    
    if (liveChat) {
        liveChat.stop();
        activeChats.delete(instanceKey);
    }
    
    res.json({ success: true });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
