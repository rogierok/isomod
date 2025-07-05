class IsoMOD {
    constructor() {
        this.canvas = document.getElementById('gameCanvas');
        this.ctx = this.canvas.getContext('2d');
        this.socket = io();
        
        this.roomId = window.location.pathname.substring(1);
        this.playerId = null;
        this.players = new Map();
        this.config = null;
        
        this.keys = {};
        this.lastFrameTime = 0;
        
        // Sprite sheet and rendering
        this.spriteSheet = new Image();
        this.spriteSheet.src = '/isomodconfig/sprites/set.png';
        this.spriteSize = 32;
        this.tileWidth = 32;
        this.tileHeight = 16; 
        
        this.world = [];
        this.spriteConfigs = null;
        
        this.cameraX = 0;
        this.cameraY = 0;
        
        this.selectedSpriteId = 1;
        
        this.playerSprite = new Image();
        this.playerSprite.onload = () => {
            console.log('Player sprite loaded');
        };
        this.createPlayerSprite();
        
        this.playerDirection = 'down';
        
        this.init();
    }
    
    init() {
        this.setupSocketListeners();
        this.setupEventListeners();
        this.joinRoom();
        this.gameLoop();
    }
    
    setupSocketListeners() {
        this.socket.on('gameState', (data) => {
            this.playerId = data.playerId;
            this.config = data.config;
            this.players.clear();
            
            data.players.forEach(player => {
                this.players.set(player.id, player);
            });
            
            if (data.worldState) {
                this.world = [...data.worldState];
            } else {
                this.world = this.config.worldConfig.tiles || [];
            }
            
            this.loadWorld();
            this.updateUI();
        });
        
        this.socket.on('playerJoined', (player) => {
            this.players.set(player.id, player);
        });
        
        this.socket.on('playerMoved', (moveData) => {
            const player = this.players.get(moveData.playerId);
            if (player) {
                player.x = moveData.x;
                player.y = moveData.y;
                player.z = moveData.z;
                player.velocityX = moveData.velocityX;
                player.velocityY = moveData.velocityY;
                player.velocityZ = moveData.velocityZ;
                player.isJumping = moveData.isJumping;
            }
        });
        
        this.socket.on('playerLeft', (playerId) => {
            this.players.delete(playerId);
        });
        
        this.socket.on('configUpdated', (newConfig) => {
            this.config = newConfig;
            this.loadWorld();
        });
        
        this.socket.on('tileChanged', (tileData) => {
            if (tileData.action === 'break') {
                this.world = this.world.filter(tile => 
                    !(tile.x === tileData.x && tile.y === tileData.y && tile.layer === tileData.layer)
                );
            } else if (tileData.action === 'place') {
                this.world.push({
                    x: tileData.x,
                    y: tileData.y,
                    spriteId: tileData.spriteId,
                    layer: tileData.layer
                });
            }
        });
        
        this.socket.on('worldStateUpdated', (newWorldState) => {
            this.world = [...newWorldState];
        });
        
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    }
    
    setupEventListeners() {
        document.addEventListener('keydown', (e) => {
            this.keys[e.key.toLowerCase()] = true;
            
            if (e.key.toLowerCase() === 'q') {
                this.changeSpriteSelection(-1);
            } else if (e.key.toLowerCase() === 'e') {
                this.changeSpriteSelection(1);
            }
        });
        
        document.addEventListener('keyup', (e) => {
            this.keys[e.key.toLowerCase()] = false;
        });
        
        this.canvas.addEventListener('click', (e) => {
            if (e.button === 0) {
                this.handleTileBreak(e);
            }
        });
        
        this.canvas.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.handleTilePlace(e);
        });
        
        this.canvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            this.handleSpriteSelection(e);
        });
        
        document.getElementById('uploadButton').addEventListener('click', () => {
            document.getElementById('fileInput').click();
        });
        
        document.getElementById('fileInput').addEventListener('change', (e) => {
            this.uploadConfig(e.target.files);
        });
    }
    
    joinRoom() {
        this.socket.emit('joinRoom', this.roomId);
    }
    
    loadWorld() {
        if (!this.config) return;
        
        const worldConfig = this.config.worldConfig;
        this.spriteConfigs = worldConfig.spriteConfigs || {};
        
        if (this.world.length === 0) {
            this.world = worldConfig.tiles || [];
        }
        
        this.cameraX = this.canvas.width / 2;
        this.cameraY = this.canvas.height / 3;
    }
    
    updateUI() {
        document.getElementById('playerId').textContent = this.playerId || '-';
        document.getElementById('selectedSprite').textContent = this.selectedSpriteId;
        
        if (this.playerId === 1) {
            document.getElementById('uploadButton').style.display = 'block';
        }
    }
    
    uploadConfig(files) {
        if (this.playerId !== 1) return;
        
        const formData = new FormData();
        const spriteFiles = [];
        
        Array.from(files).forEach(file => {
            const fileName = file.name.toLowerCase();
            const filePath = file.webkitRelativePath || file.name;
            
            if (fileName.includes('player.json')) {
                formData.append('player', file);
            } else if (fileName.includes('world.json')) {
                formData.append('world', file);
            } else if (filePath.includes('sprites/') && (fileName.endsWith('.png') || fileName.endsWith('.jpg') || fileName.endsWith('.gif'))) {
                spriteFiles.push(file);
            }
        });
        
        spriteFiles.forEach(file => {
            formData.append('sprites', file);
        });
        
        fetch(`/api/${this.roomId}/config`, {
            method: 'POST',
            body: formData
        })
        .then(response => response.json())
        .then(data => {
            if (data.error) {
                console.error('Upload error:', data.error);
                alert('Upload error: ' + data.error);
            } else {
                alert('Configuration uploaded successfully!');
            }
        })
        .catch(error => {
            console.error('Upload failed:', error);
            alert('Upload failed: ' + error.message);
        });
    }
    
    changeSpriteSelection(direction) {
        const validSpriteIds = Object.keys(this.spriteConfigs || {})
            .map(id => parseInt(id))
            .filter(id => id > 0 && id < 100)
            .sort((a, b) => a - b);
        
        if (validSpriteIds.length === 0) return;
        
        const currentIndex = validSpriteIds.indexOf(this.selectedSpriteId);
        let newIndex;
        
        if (currentIndex === -1) {
            newIndex = 0;
        } else {
            newIndex = currentIndex + direction;
            if (newIndex < 0) newIndex = validSpriteIds.length - 1;
            if (newIndex >= validSpriteIds.length) newIndex = 0;
        }
        
        this.selectedSpriteId = validSpriteIds[newIndex];
        this.updateUI();
    }

    handleSpriteSelection(event) {
        const delta = event.deltaY > 0 ? 1 : -1;
        this.changeSpriteSelection(delta);
    }
    
    handleTileBreak(event) {
        if (!this.world || !this.config) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const clickedTile = this.findTileUnderMouse(mouseX, mouseY);
        if (!clickedTile) return;
        
        const config = this.spriteConfigs[clickedTile.spriteId.toString()];
        
        // playholder, next tools with different toughness capabilities
        if (config && config.toughness === 0) {
            this.socket.emit('tileBreak', {
                x: clickedTile.x,
                y: clickedTile.y,
                layer: clickedTile.layer
            });
        }
    }
    
    handleTilePlace(event) {
        if (!this.world || !this.config) return;
        
        const rect = this.canvas.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        const clickedTile = this.findTileUnderMouse(mouseX, mouseY);
        let targetX, targetY, targetLayer;
        
        if (clickedTile) {
            targetX = clickedTile.x;
            targetY = clickedTile.y;
            targetLayer = clickedTile.layer + 1;
        } else {
            const worldPos = this.screenToWorld(mouseX, mouseY);
            if (!worldPos) return;
            
            targetX = Math.floor(worldPos.x);
            targetY = Math.floor(worldPos.y);
            targetLayer = 0;
        }
        
        const gridSize = this.config.worldConfig.gridSize;
        if (targetX < 0 || targetX >= gridSize.x || targetY < 0 || targetY >= gridSize.y) {
            return;
        }

        this.socket.emit('tilePlace', {
            x: targetX,
            y: targetY,
            spriteId: this.selectedSpriteId,
            layer: targetLayer
        });
    }
    
    
    updatePlayer(deltaTime) {
        const player = this.players.get(this.playerId);
        if (!player || !this.config) return;
        
        const stats = player.config.stats;
        const physics = this.config.worldConfig.physics;
        
        let moveX = 0;
        let moveY = 0;
        
        if (this.keys['w'] || this.keys['arrowup']) {
            moveY -= 1;
            this.playerDirection = 'up';
        }
        if (this.keys['s'] || this.keys['arrowdown']) {
            moveY += 1;
            this.playerDirection = 'down';
        }
        if (this.keys['a'] || this.keys['arrowleft']) {
            moveX -= 1;
            this.playerDirection = 'left';
        }
        if (this.keys['d'] || this.keys['arrowright']) {
            moveX += 1;
            this.playerDirection = 'right';
        }
        
        // iso movement
        if (moveX !== 0 && moveY !== 0) {
            moveX *= 0.707;
            moveY *= 0.707;
        }
        
        const speed = stats.speed * deltaTime;
        let newX = player.x;
        let newY = player.y;
        
        if (moveX !== 0) {
            const testX = player.x + moveX * speed;
            if (!this.checkCollision(testX, player.y, player.z)) {
                newX = testX;
            }
        }
        
        if (moveY !== 0) {
            const testY = player.y + moveY * speed;
            if (!this.checkCollision(newX, testY, player.z)) {
                newY = testY;
            }
        }
        
        player.x = newX;
        player.y = newY;
        
        if (this.keys[' '] && !player.isJumping && this.isOnGround(player.x, player.y, player.z)) {
            player.velocityZ = stats.jumpHeight;
            player.isJumping = true;
        }
        
        if (!this.isOnGround(player.x, player.y, player.z)) {
            player.velocityZ -= physics.gravity * deltaTime;
            player.isJumping = true;
        }
        
        const newZ = player.z + player.velocityZ * deltaTime;
        
        const groundZ = this.getGroundLevel(player.x, player.y);
        if (newZ <= groundZ) {
            player.z = groundZ;
            
            const surfaceConfig = this.getSurfaceConfig(player.x, player.y, groundZ);
            if (surfaceConfig && player.velocityZ < -0.5) {
                player.velocityZ = -player.velocityZ * surfaceConfig.bounciness;
                if (player.velocityZ < 1.0) {
                    player.velocityZ = 0;
                    player.isJumping = false;
                }
            } else {
                player.velocityZ = 0;
                player.isJumping = false;
            }
        } else {
            player.z = newZ;
        }
        
        const gridSize = this.config.worldConfig.gridSize;
        player.x = Math.max(0.5, Math.min(gridSize.x - 0.5, player.x));
        player.y = Math.max(0.5, Math.min(gridSize.y - 0.5, player.y));
        
        document.getElementById('position').textContent = 
            `${player.x.toFixed(1)}, ${player.y.toFixed(1)}, ${player.z.toFixed(1)}`;
        
        this.socket.emit('playerMove', {
            x: player.x,
            y: player.y,
            z: player.z,
            velocityX: moveX * stats.speed,
            velocityY: moveY * stats.speed,
            velocityZ: player.velocityZ,
            isJumping: player.isJumping
        });
    }
    
    checkCollision(x, y, z) {
        if (!this.world || !this.spriteConfigs) return false;
        
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);
        const gridZ = Math.floor(z);
        
        const gridSize = this.config.worldConfig.gridSize;
        if (gridX < 0 || gridX >= gridSize.x || gridY < 0 || gridY >= gridSize.y) {
            return true;
        }
        
        const tilesAtPosition = this.world.filter(tile => 
            tile.x === gridX && tile.y === gridY && tile.layer === gridZ
        );
        
        for (const tile of tilesAtPosition) {
            const config = this.spriteConfigs[tile.spriteId.toString()];
            if (config && config.solid) {
                return true;
            }
        }
        
        return false;
    }
    
    isOnGround(x, y, z) {
        return this.checkCollision(x, y, z - 0.01);
    }
    
    getGroundLevel(x, y) {
        if (!this.world) return 0;
        
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);
        const gridSize = this.config.worldConfig.gridSize;
        
        if (gridX < 0 || gridX >= gridSize.x || gridY < 0 || gridY >= gridSize.y) {
            return 0;
        }
        
        const tilesAtPosition = this.world.filter(tile => tile.x === gridX && tile.y === gridY);
        let highestSolidLayer = -1;
        
        for (const tile of tilesAtPosition) {
            const config = this.spriteConfigs[tile.spriteId.toString()];
            if (config && config.solid && tile.layer > highestSolidLayer) {
                highestSolidLayer = tile.layer;
            }
        }
        
        return highestSolidLayer >= 0 ? highestSolidLayer + 1 : 0;
    }
    
    getSurfaceConfig(x, y, z) {
        if (!this.world || !this.spriteConfigs) return null;
        
        const gridX = Math.floor(x);
        const gridY = Math.floor(y);
        const gridZ = Math.floor(z - 0.01);
        
        const gridSize = this.config.worldConfig.gridSize;
        if (gridX < 0 || gridX >= gridSize.x || gridY < 0 || gridY >= gridSize.y || gridZ < 0) {
            return null;
        }
        
        const tile = this.world.find(t => t.x === gridX && t.y === gridY && t.layer === gridZ);
        if (!tile) return null;
        
        return this.spriteConfigs[tile.spriteId.toString()];
    }
    
    
    screenToWorld(screenX, screenY) {
        const player = this.players.get(this.playerId);
        if (!player) return null;
        
        const offsetX = screenX - this.cameraX;
        const offsetY = screenY - this.cameraY;
        
        const worldX = (offsetX / this.tileWidth + offsetY / this.tileHeight);
        const worldY = (offsetY / this.tileHeight - offsetX / this.tileWidth);
        
        return { x: worldX, y: worldY, z: player.z };
    }
    
    worldToScreen(worldX, worldY, worldZ = 0) {
        const isoX = (worldX - worldY) * this.tileWidth / 2;
        const isoY = (worldX + worldY) * this.tileHeight / 2 - worldZ * this.tileHeight;
        
        return {
            x: isoX + this.cameraX,
            y: isoY + this.cameraY
        };
    }
    
    drawSprite(spriteId, screenX, screenY, offsetX = 0, offsetY = 0) {
        if (!this.spriteConfigs || !this.spriteSheet.complete) return;
        
        const config = this.spriteConfigs[spriteId.toString()];
        if (!config || config.color === 'transparent') return;
        
        const spriteSheetX = config.spriteX * this.spriteSize;
        const spriteSheetY = config.spriteY * this.spriteSize;
        
        const finalX = screenX + offsetX + (config.offsetX || 0);
        const finalY = screenY + offsetY + (config.offsetY || 0);

        this.ctx.drawImage(
            this.spriteSheet,
            spriteSheetX, spriteSheetY, this.spriteSize, this.spriteSize,
            finalX - this.spriteSize/2, finalY - this.spriteSize/2, this.spriteSize, this.spriteSize
        );
    }
    
    drawFallbackRect(color, screenX, screenY, offsetX = 0, offsetY = 0) {
        this.ctx.fillStyle = color;
        this.ctx.fillRect(
            screenX + offsetX - this.tileWidth/2,
            screenY + offsetY - this.tileHeight/2,
            this.tileWidth,
            this.tileHeight
        );
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 1;
        this.ctx.strokeRect(
            screenX + offsetX - this.tileWidth/2,
            screenY + offsetY - this.tileHeight/2,
            this.tileWidth,
            this.tileHeight
        );
    }
    
    render() {
        if (!this.config || !this.world) return;
        
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        
        const sortedTiles = [...this.world].sort((a, b) => {
            const depthA = (a.y * 1000) + (a.x * 100) + (a.layer * 10);
            const depthB = (b.y * 1000) + (b.x * 100) + (b.layer * 10);
            
            return depthA - depthB;
        });
        
        const allRenderables = [];
        
        sortedTiles.forEach(tile => {
            allRenderables.push({
                type: 'tile',
                data: tile,
                depth: (tile.y * 1000) + (tile.x * 100) + (tile.layer * 10),
                screenPos: this.worldToScreen(tile.x, tile.y, tile.layer)
            });
        });
        
        Array.from(this.players.values()).forEach(player => {
            allRenderables.push({
                type: 'player',
                data: player,
                depth: (player.y * 1000) + (player.x * 100) + (player.z * 10),
                screenPos: this.worldToScreen(player.x, player.y, player.z)
            });
        });
        
        allRenderables.sort((a, b) => a.depth - b.depth);
        
        allRenderables.forEach(renderable => {
            if (renderable.type === 'tile') {
                const tile = renderable.data;
                if (this.spriteSheet.complete) {
                    this.drawSprite(tile.spriteId, renderable.screenPos.x, renderable.screenPos.y);
                } else {
                    const config = this.spriteConfigs[tile.spriteId.toString()];
                    if (config && config.color !== 'transparent') {
                        this.drawFallbackRect(config.color, renderable.screenPos.x, renderable.screenPos.y);
                    }
                }
            } else if (renderable.type === 'player') {
                this.drawPlayer(renderable.data);
            }
        });
        
        this.drawUI();
    }
    
    drawPlayer(player) {
        const screenPos = this.worldToScreen(player.x, player.y, player.z);
        
        if (this.playerSprite.complete) {
            let direction = 'down';
            if (player.id === this.playerId) {
                direction = this.playerDirection;
            } else {
                if (Math.abs(player.velocityX) > Math.abs(player.velocityY)) {
                    direction = player.velocityX > 0 ? 'right' : 'left';
                } else if (Math.abs(player.velocityY) > 0.1) {
                    direction = player.velocityY > 0 ? 'down' : 'up';
                }
            }
            
            const directionOffsets = {
                'down': 0,
                'up': 32,
                'left': 64,
                'right': 96
            };
            
            const srcX = directionOffsets[direction] || 0;
            
            this.ctx.drawImage(
                this.playerSprite,
                srcX, 0, 32, 32,
                screenPos.x - 16, screenPos.y - 24, 32, 32
            );
        } else {
            this.ctx.fillStyle = '#FF6347';
            this.ctx.fillRect(
                screenPos.x - 8, 
                screenPos.y - 16, 
                16, 
                16
            );
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 2;
            this.ctx.strokeRect(
                screenPos.x - 8, 
                screenPos.y - 16, 
                16, 
                16
            );
        }
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = 'bold 12px Arial';
        this.ctx.textAlign = 'center';
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 3;
        this.ctx.strokeText(`P${player.id}`, screenPos.x, screenPos.y - 30);
        this.ctx.fillText(`P${player.id}`, screenPos.x, screenPos.y - 30);
    }
    
    drawUI() {
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(10, 10, 160, 40);
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '14px Arial';
        this.ctx.textAlign = 'left';
        this.ctx.fillText(`Selected Sprite: ${this.selectedSpriteId}`, 20, 30);
        
        const config = this.spriteConfigs[this.selectedSpriteId.toString()];
        if (config) {
            this.ctx.fillText(`${config.name}`, 20, 45);
        }
        
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.8)';
        this.ctx.fillRect(10, this.canvas.height - 95, 350, 85);
        
        this.ctx.fillStyle = '#FFFFFF';
        this.ctx.font = '12px Arial';
        this.ctx.fillText('Left Click: Break | Right Click: Place', 20, this.canvas.height - 75);
        this.ctx.fillText('Q/E or Mouse Wheel: Change Sprite | WASD: Move | Space: Jump', 20, this.canvas.height - 60);
        this.ctx.fillText('Selected sprite will appear on next layer above existing tiles', 20, this.canvas.height - 45);
        this.ctx.fillText('Hold Shift + Click to break through multiple layers', 20, this.canvas.height - 30);
        this.ctx.fillText('Only toughness 0 blocks can be broken', 20, this.canvas.height - 15);
    }
    
    gameLoop(currentTime = 0) {
        const deltaTime = (currentTime - this.lastFrameTime) / 1000;
        this.lastFrameTime = currentTime;
        
        this.updatePlayer(deltaTime);
        this.render();
        
        requestAnimationFrame((time) => this.gameLoop(time));
    }
    
    createPlayerSprite() {
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 32;
        const ctx = canvas.getContext('2d');
        
        ctx.clearRect(0, 0, 128, 32);
        
        const directions = [
            { name: 'down', x: 0 },
            { name: 'up', x: 32 },
            { name: 'left', x: 64 },
            { name: 'right', x: 96 }
        ];
        
        // vibe coded playholder player sprite, do not judge me, why are you even reading at this old commit?
        directions.forEach(dir => {
            const x = dir.x;
            

            ctx.fillStyle = '#FFDBAC';
            ctx.fillRect(x + 12, 6, 8, 8);
            
            ctx.fillStyle = '#4169E1';
            ctx.fillRect(x + 10, 14, 12, 10);
            
            ctx.fillStyle = '#FFDBAC';
            if (dir.name === 'left') {
                ctx.fillRect(x + 6, 16, 6, 4);
                ctx.fillRect(x + 20, 16, 4, 6);
            } else if (dir.name === 'right') {
                ctx.fillRect(x + 8, 16, 4, 6);
                ctx.fillRect(x + 18, 16, 6, 4);
            } else {
                ctx.fillRect(x + 8, 16, 4, 6);
                ctx.fillRect(x + 20, 16, 4, 6);
            }
        
            ctx.fillStyle = '#654321';
            ctx.fillRect(x + 12, 24, 3, 6);
            ctx.fillRect(x + 17, 24, 3, 6);
            
            ctx.fillStyle = '#000';
            if (dir.name === 'up') {
            } else if (dir.name === 'left') {
                ctx.fillRect(x + 13, 8, 1, 1);
            } else if (dir.name === 'right') {
                ctx.fillRect(x + 18, 8, 1, 1);
            } else {
                ctx.fillRect(x + 14, 8, 1, 1);
                ctx.fillRect(x + 17, 8, 1, 1);
            }
        });
        
        this.playerSprite.src = canvas.toDataURL();
    }
    
    findTileUnderMouse(mouseX, mouseY) {
        const sortedTiles = [...this.world].sort((a, b) => {
            const depthA = (a.y * 1000) + (a.x * 100) + (a.layer * 10);
            const depthB = (b.y * 1000) + (b.x * 100) + (b.layer * 10);
            return depthB - depthA;
        });
        
        for (const tile of sortedTiles) {
            const screenPos = this.worldToScreen(tile.x, tile.y, tile.layer);
            
            const tileLeft = screenPos.x - 16;
            const tileRight = screenPos.x + 16;
            const tileTop = screenPos.y - 16;
            const tileBottom = screenPos.y + 16;
            
            if (mouseX >= tileLeft && mouseX <= tileRight && 
                mouseY >= tileTop && mouseY <= tileBottom) {
                return tile;
            }
        }
        
        return null;
    }
}

window.addEventListener('load', () => {
    new IsoMOD();
});
