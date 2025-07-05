const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const gameRooms = new Map();

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

//need to fix this, not the way i want to handle file uploads
const upload = multer({ dest: 'uploads/' });

app.use('/isomodconfig', express.static(path.join(__dirname, 'isomodconfig')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function loadDefaultConfig() {
  const playerConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'isomodconfig', 'player.json'), 'utf8'));
  const worldConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'isomodconfig', 'world.json'), 'utf8'));
  const spriteConfigs = JSON.parse(fs.readFileSync(path.join(__dirname, 'isomodconfig', 'sprites.json'), 'utf8'));
  
  worldConfig.spriteConfigs = spriteConfigs;
  
  return { playerConfig, worldConfig };
}

// need to switch to something better than UUIDs for room names
app.get('/new', (req, res) => {
  const roomId = uuidv4();
  const { playerConfig, worldConfig } = loadDefaultConfig();
  
  gameRooms.set(roomId, {
    players: new Map(),
    config: { playerConfig, worldConfig },
    worldState: [...(worldConfig.tiles || [])],
    nextPlayerId: 1
  });
  
  res.redirect(`/${roomId}`);
});

app.get('/:roomId', (req, res) => {
  const roomId = req.params.roomId;
  
  if (!gameRooms.has(roomId)) {
    return res.status(404).send('Room not found');
  }
  
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/api/:roomId/config', (req, res) => {
  const roomId = req.params.roomId;
  const room = gameRooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  res.json(room.config);
});

app.post('/api/:roomId/config', upload.fields([
  { name: 'player', maxCount: 1 },
  { name: 'world', maxCount: 1 },
  { name: 'sprites', maxCount: 20 }
]), (req, res) => {
  const roomId = req.params.roomId;
  const room = gameRooms.get(roomId);
  
  if (!room) {
    return res.status(404).json({ error: 'Room not found' });
  }
  
  try {
    if (req.files.player) {
      const playerData = fs.readFileSync(req.files.player[0].path, 'utf8');
      room.config.playerConfig = JSON.parse(playerData);
    }
    
    if (req.files.world) {
      const worldData = fs.readFileSync(req.files.world[0].path, 'utf8');
      room.config.worldConfig = JSON.parse(worldData);
      
      room.worldState = [...(room.config.worldConfig.tiles || [])];
    }
    
    const spritesPath = path.join(__dirname, 'isomodconfig', 'sprites.json');
    if (fs.existsSync(spritesPath)) {
      const spriteConfigs = JSON.parse(fs.readFileSync(spritesPath, 'utf8'));
      room.config.worldConfig.spriteConfigs = spriteConfigs;
    }

    if (req.files.sprites) {
      console.log(`Received ${req.files.sprites.length} sprite files for room ${roomId}`);
    }
    
    io.to(roomId).emit('configUpdated', room.config);
    
    if (req.files.world) {
      io.to(roomId).emit('worldStateUpdated', room.worldState);
    }

    if (req.files.player) fs.unlinkSync(req.files.player[0].path);
    if (req.files.world) fs.unlinkSync(req.files.world[0].path);
    if (req.files.sprites) {
      req.files.sprites.forEach(file => fs.unlinkSync(file.path));
    }
    
    res.json({ success: true });
  } catch (error) {
    res.status(400).json({ error: 'Invalid configuration files' });
  }
});

io.on('connection', (socket) => {
  console.log('Player connected:', socket.id);
  
  socket.on('joinRoom', (roomId) => {
    const room = gameRooms.get(roomId);
    if (!room) {
      socket.emit('error', 'Room not found');
      return;
    }
    
    socket.join(roomId);
    socket.roomId = roomId;
    
    const playerId = room.nextPlayerId++;
    socket.playerId = playerId;
    
    const spawnPoint = room.config.worldConfig.spawns[0];
    const player = {
      id: playerId,
      x: spawnPoint.x,
      y: spawnPoint.y,
      z: spawnPoint.z,
      velocityX: 0,
      velocityY: 0,
      velocityZ: 0,
      isJumping: false,
      lastUpdate: Date.now(),
      config: { ...room.config.playerConfig }
    };
    
    room.players.set(playerId, player);
    
    socket.emit('gameState', {
      playerId: playerId,
      players: Array.from(room.players.values()),
      config: room.config,
      worldState: room.worldState
    });
    
    socket.to(roomId).emit('playerJoined', player);
    
    console.log(`Player ${playerId} joined room ${roomId}`);
  });
  
  socket.on('playerMove', (moveData) => {
    const room = gameRooms.get(socket.roomId);
    if (!room || !socket.playerId) return;
    
    const player = room.players.get(socket.playerId);
    if (!player) return;
    
    player.x = moveData.x;
    player.y = moveData.y;
    player.z = moveData.z;
    player.velocityX = moveData.velocityX;
    player.velocityY = moveData.velocityY;
    player.velocityZ = moveData.velocityZ;
    player.isJumping = moveData.isJumping;
    player.lastUpdate = Date.now();
    
    socket.to(socket.roomId).emit('playerMoved', {
      playerId: socket.playerId,
      ...moveData
    });
  });
  
  socket.on('tileBreak', (tileData) => {
    const room = gameRooms.get(socket.roomId);
    if (!room || !socket.playerId) return;
    
    const gridSize = room.config.worldConfig.gridSize;
    if (tileData.x < 0 || tileData.x >= gridSize.x ||
        tileData.y < 0 || tileData.y >= gridSize.y) {
      return;
    }
    
    room.worldState = room.worldState.filter(tile => 
      !(tile.x === tileData.x && tile.y === tileData.y && tile.layer === tileData.layer)
    );

    io.to(socket.roomId).emit('tileChanged', {
      action: 'break',
      x: tileData.x,
      y: tileData.y,
      layer: tileData.layer
    });
    
    console.log(`Tile broken at ${tileData.x},${tileData.y} layer ${tileData.layer} in room ${socket.roomId}`);
  });
  
  socket.on('tilePlace', (tileData) => {
    const room = gameRooms.get(socket.roomId);
    if (!room || !socket.playerId) return;
    
    const gridSize = room.config.worldConfig.gridSize;
    if (tileData.x < 0 || tileData.x >= gridSize.x ||
        tileData.y < 0 || tileData.y >= gridSize.y) {
      return;
    }
    
    const spriteConfigs = room.config.worldConfig.spriteConfigs;
    if (!spriteConfigs || !spriteConfigs[tileData.spriteId.toString()]) {
      return;
    }
    
    room.worldState.push({
      x: tileData.x,
      y: tileData.y,
      spriteId: tileData.spriteId,
      layer: tileData.layer
    });
    
    io.to(socket.roomId).emit('tileChanged', {
      action: 'place',
      x: tileData.x,
      y: tileData.y,
      spriteId: tileData.spriteId,
      layer: tileData.layer
    });
    
    console.log(`Tile placed at ${tileData.x},${tileData.y} layer ${tileData.layer} sprite ${tileData.spriteId} in room ${socket.roomId}`);
  });
  
  socket.on('disconnect', () => {
    console.log('Player disconnected:', socket.id);
    
    if (socket.roomId && socket.playerId) {
      const room = gameRooms.get(socket.roomId);
      if (room) {
        room.players.delete(socket.playerId);
        socket.to(socket.roomId).emit('playerLeft', socket.playerId);

        if (room.players.size === 0) {
          gameRooms.delete(socket.roomId);
          console.log(`Room ${socket.roomId} deleted (empty)`);
        }
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`isoMOD server running on port ${PORT}`);
});
