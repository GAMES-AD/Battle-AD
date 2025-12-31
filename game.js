/**
 * Battle City - Современная реализация на чистом JS
 * Особенности: Псевдо-2.5D, Процедурный звук, Адаптивный Fullscreen, Умная физика
 */

// --- Инициализация Canvas ---
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Базовое разрешение (логическое)
canvas.width = 800;
canvas.height = 600;

// --- Константы ---
const TILE_SIZE = 40;
const MAP_COLS = canvas.width / TILE_SIZE;
const MAP_ROWS = canvas.height / TILE_SIZE;

const GameState = {
    MENU: 'MENU',
    PLAYING: 'PLAYING',
    GAME_OVER: 'GAME_OVER'
};

const Tile = {
    EMPTY: 0,
    BRICK: 1,
    STEEL: 2
};

const AIState = {
    PATROL: 'PATROL',
    ATTACK_BASE: 'ATTACK_BASE',
    ATTACK_PLAYER: 'ATTACK_PLAYER'
};

let enemiesFrozenTimer = 0;

// --- Менеджер звука (Web Audio API) ---
class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    }

    playShoot() { this.playTone(440, 110, 0.1, 'square'); }
    playExplosion() {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(100, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + 0.5);
    }
    playPowerup() { this.playTone(200, 800, 0.3, 'sine'); }
    playGameOver() { this.playTone(150, 50, 1.0, 'square'); }

    playTone(startFreq, endFreq, duration, type) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(startFreq, this.ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(endFreq, this.ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.1, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.ctx.destination);
        osc.start();
        osc.stop(this.ctx.currentTime + duration);
    }
}

const sounds = new SoundManager();

// --- Вспомогательные функции ---
function rectIntersect(x1, y1, w1, h1, x2, y2, w2, h2) {
    return x2 < x1 + w1 && x2 + w2 > x1 && y2 < y1 + h1 && y2 + h2 > y1;
}

// --- Классы сущностей ---

class Bullet {
    constructor(x, y, angle, ownerType) {
        this.x = x;
        this.y = y;
        this.width = 6;
        this.height = 6;
        this.speed = 450;
        this.angle = angle;
        this.ownerType = ownerType;
        this.active = true;
    }

    update(dt) {
        const rad = this.angle * Math.PI / 180;
        this.x += Math.sin(rad) * this.speed * dt;
        this.y -= Math.cos(rad) * this.speed * dt;

        if (this.x < 0 || this.x > canvas.width || this.y < 0 || this.y > canvas.height) {
            this.active = false;
        }

        const tile = map.getTileAt(this.x, this.y);
        if (tile && tile.type !== Tile.EMPTY) {
            if (tile.type === Tile.BRICK) {
                map.setTile(tile.row, tile.col, Tile.EMPTY);
                sounds.playExplosion();
            }
            this.active = false;
        }

        if (this.active && rectIntersect(this.x - 3, this.y - 3, 6, 6, base.x, base.y, base.width, base.height)) {
            base.destroy();
            this.active = false;
        }
    }

    draw(ctx) {
        ctx.fillStyle = this.ownerType === 'player' ? '#fff' : '#ff0';
        ctx.beginPath();
        ctx.arc(this.x, this.y, 3, 0, Math.PI * 2);
        ctx.fill();
    }
}

class Tank {
    constructor(x, y) {
        this.x = x;
        this.y = y;
        this.width = 32; 
        this.height = 32;
        this.angle = 0;
        this.speed = 130;
        this.active = true;
        this.shootTimer = 0;
        this.shootCooldown = 0.6;
    }

    canMove(nx, ny, isPlayer = false) {
        // Margin для стен (6px) - дает свободу в проходах
        const wallMargin = 6;
        const cx = nx + wallMargin;
        const cy = ny + wallMargin;
        const cw = this.width - wallMargin * 2;
        const ch = this.height - wallMargin * 2;

        // 1. Границы холста
        if (nx < 0 || nx + this.width > canvas.width || ny < 0 || ny + this.height > canvas.height) return false;
        
        // 2. Коллизия с картой (стены)
        if (map.checkCollision(cx, cy, cw, ch)) return false;
        
        // 3. Коллизия с базой
        if (rectIntersect(cx, cy, cw, ch, base.x, base.y, base.width, base.height)) return false;

        // 4. Коллизия с другими танками (используем небольшое наложение для плавности)
        const tankMargin = 4;
        if (isPlayer) {
            for (let e of enemies) {
                if (e.active && rectIntersect(nx + tankMargin, ny + tankMargin, this.width - tankMargin*2, this.height - tankMargin*2, e.x + tankMargin, e.y + tankMargin, e.width - tankMargin*2, e.height - tankMargin*2)) return false;
            }
        } else {
            if (rectIntersect(nx + tankMargin, ny + tankMargin, this.width - tankMargin*2, this.height - tankMargin*2, player.x + tankMargin, player.y + tankMargin, player.width - tankMargin*2, player.height - tankMargin*2)) return false;
            for (let e of enemies) {
                if (e !== this && e.active && rectIntersect(nx + tankMargin, ny + tankMargin, this.width - tankMargin*2, this.height - tankMargin*2, e.x + tankMargin, e.y + tankMargin, e.width - tankMargin*2, e.height - tankMargin*2)) return false;
            }
        }
        return true;
    }

    shoot(ownerType) {
        if (this.shootTimer <= 0) {
            const bx = this.x + this.width / 2;
            const by = this.y + this.height / 2;
            bullets.push(new Bullet(bx, by, this.angle, ownerType));
            this.shootTimer = this.shootCooldown;
            if (ownerType === 'player') sounds.playShoot();
        }
    }

    drawTank(ctx, color, barrelColor) {
        ctx.save();
        ctx.translate(this.x + this.width / 2, this.y + this.height / 2);
        ctx.rotate(this.angle * Math.PI / 180);
        ctx.fillStyle = color;
        ctx.shadowBlur = 5;
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.fillRect(-this.width / 2, -this.height / 2, this.width, this.height);
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#333';
        ctx.fillRect(-this.width / 2 - 2, -this.height / 2, 6, this.height);
        ctx.fillRect(this.width / 2 - 4, -this.height / 2, 6, this.height);
        ctx.fillStyle = barrelColor;
        ctx.fillRect(-8, -8, 16, 16);
        ctx.fillRect(-3, -this.height / 2 - 5, 6, 15);
        ctx.restore();
    }
}

class Player extends Tank {
    constructor() {
        super(0, 0);
        this.lives = 3;
        this.score = 0;
        this.shieldTimer = 0;
        this.respawn();
    }

    respawn() {
        const bc = Math.floor(MAP_COLS / 2);
        this.x = bc * TILE_SIZE + (TILE_SIZE - this.width) / 2;
        this.y = (MAP_ROWS - 4) * TILE_SIZE + (TILE_SIZE - this.height) / 2;
        this.angle = 0;
        this.shieldTimer = 3;
    }

    update(dt) {
        if (this.shootTimer > 0) this.shootTimer -= dt;
        if (this.shieldTimer > 0) this.shieldTimer -= dt;

        let dx = 0, dy = 0, isMoving = false;
        let requestedAngle = this.angle;

        // 1. Определение направления (приоритет последнего нажатия)
        if (keys['ArrowUp'] || keys['KeyW']) { dy = -1; requestedAngle = 0; isMoving = true; }
        else if (keys['ArrowDown'] || keys['KeyS']) { dy = 1; requestedAngle = 180; isMoving = true; }
        else if (keys['ArrowLeft'] || keys['KeyA']) { dx = -1; requestedAngle = 270; isMoving = true; }
        else if (keys['ArrowRight'] || keys['KeyD']) { dx = 1; requestedAngle = 90; isMoving = true; }

        if (isMoving) {
            const snapSize = TILE_SIZE / 2; // 20px
            const centerOffset = (TILE_SIZE - this.width) / 2; // 4px

            // 2. Grid Snapping при смене направления (мгновенное центрирование)
            if (requestedAngle !== this.angle) {
                if (requestedAngle === 0 || requestedAngle === 180) {
                    this.x = Math.round((this.x - centerOffset) / snapSize) * snapSize + centerOffset;
                } else {
                    this.y = Math.round((this.y - centerOffset) / snapSize) * snapSize + centerOffset;
                }
                this.angle = requestedAngle;
            }

            // 3. Попытка основного движения
            let nx = this.x + dx * this.speed * dt;
            let ny = this.y + dy * this.speed * dt;

            if (this.canMove(nx, ny, true)) {
                this.x = nx;
                this.y = ny;
            } else {
                // 4. Улучшенная Sliding Logic: доводка до центра "коридора" при блокировке
                const alignSpeed = this.speed * dt * 1.8;
                if (dy !== 0) { // Движение по вертикали, выравниваем горизонталь
                    const targetX = Math.round((this.x - centerOffset) / snapSize) * snapSize + centerOffset;
                    const diff = targetX - this.x;
                    if (Math.abs(diff) > 0.5 && Math.abs(diff) < 18) {
                        const step = (diff > 0) ? Math.min(alignSpeed, diff) : Math.max(-alignSpeed, diff);
                        if (this.canMove(this.x + step, this.y, true)) this.x += step;
                    }
                } else if (dx !== 0) { // Движение по горизонтали, выравниваем вертикаль
                    const targetY = Math.round((this.y - centerOffset) / snapSize) * snapSize + centerOffset;
                    const diff = targetY - this.y;
                    if (Math.abs(diff) > 0.5 && Math.abs(diff) < 18) {
                        const step = (diff > 0) ? Math.min(alignSpeed, diff) : Math.max(-alignSpeed, diff);
                        if (this.canMove(this.x, this.y + step, true)) this.y += step;
                    }
                }
            }
        }

        if (keys['Space']) this.shoot('player');
    }

    draw(ctx) {
        this.drawTank(ctx, '#2e7d32', '#1b5e20');
        if (this.shieldTimer > 0) {
            ctx.beginPath();
            ctx.arc(this.x + this.width / 2, this.y + this.height / 2, this.width * 0.8, 0, Math.PI * 2);
            ctx.strokeStyle = 'cyan';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }
}

class Enemy extends Tank {
    constructor(x, y, type) {
        super(x, y);
        this.type = type;
        this.aiState = AIState.PATROL;
        this.dirTimer = 0;
        if (type === 'fast') this.speed = 170;
        if (type === 'armored') this.health = 3; else this.health = 1;
    }

    update(dt) {
        if (this.shootTimer > 0) this.shootTimer -= dt;
        if (enemiesFrozenTimer > 0) return;
        this.dirTimer -= dt;

        if (Math.random() < 0.005) {
            const rand = Math.random();
            if (rand < 0.7) this.aiState = AIState.ATTACK_BASE;
            else if (rand < 0.9) this.aiState = AIState.PATROL;
            else this.aiState = AIState.ATTACK_PLAYER;
        }

        if (this.dirTimer <= 0) {
            this.updateAIDirection();
            this.dirTimer = 1.5 + Math.random() * 2;
        }

        const rad = this.angle * Math.PI / 180;
        const nx = this.x + Math.sin(rad) * this.speed * dt;
        const ny = this.y - Math.cos(rad) * this.speed * dt;

        if (this.canMove(nx, ny, false)) {
            this.x = nx;
            this.y = ny;
        } else {
            this.dirTimer = 0; // Немедленная смена курса при столкновении
            const checkX = nx + Math.sin(rad) * 15;
            const checkY = ny - Math.cos(rad) * 15;
            const tile = map.getTileAt(checkX, checkY);
            if (tile && tile.type === Tile.BRICK) this.shoot('enemy');
        }
        if (Math.random() < 0.015) this.shoot('enemy');
    }

    updateAIDirection() {
        let targetX = base.x, targetY = base.y;
        if (this.aiState === AIState.ATTACK_PLAYER) { targetX = player.x; targetY = player.y; }
        if (this.aiState === AIState.PATROL) {
            const dirs = [0, 90, 180, 270];
            this.angle = dirs[Math.floor(Math.random() * dirs.length)];
        } else {
            const dx = targetX - this.x, dy = targetY - this.y;
            if (Math.abs(dx) > Math.abs(dy)) this.angle = dx > 0 ? 90 : 270;
            else this.angle = dy > 0 ? 180 : 0;
        }
    }

    draw(ctx) {
        let color = '#c62828';
        if (this.type === 'fast') color = '#f9a825';
        if (this.type === 'armored') color = '#4e342e';
        this.drawTank(ctx, color, '#212121');
    }
}

class GameMap {
    constructor() { this.tiles = []; this.generate(); }
    generate() {
        for (let r = 0; r < MAP_ROWS; r++) {
            this.tiles[r] = [];
            for (let c = 0; c < MAP_COLS; c++) {
                if (r < 2 || r > MAP_ROWS - 5 || c < 2 || c > MAP_COLS - 3) {
                    this.tiles[r][c] = Tile.EMPTY;
                    continue;
                }
                const rand = Math.random();
                if (rand < 0.2) this.tiles[r][c] = Tile.BRICK;
                else if (rand < 0.05) this.tiles[r][c] = Tile.STEEL;
                else this.tiles[r][c] = Tile.EMPTY;
            }
        }
        const br = MAP_ROWS - 2, bc = Math.floor(MAP_COLS / 2);
        this.tiles[br][bc-1] = Tile.BRICK; this.tiles[br-1][bc-1] = Tile.BRICK;
        this.tiles[br-1][bc] = Tile.BRICK; this.tiles[br-1][bc+1] = Tile.BRICK;
        this.tiles[br][bc+1] = Tile.BRICK;
    }
    getTileAt(x, y) {
        const c = Math.floor(x / TILE_SIZE), r = Math.floor(y / TILE_SIZE);
        if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) return { type: this.tiles[r][c], row: r, col: c };
        return null;
    }
    setTile(r, c, type) { if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) this.tiles[r][c] = type; }
    checkCollision(x, y, w, h) {
        // Precision epsilon (0.5) для предотвращения "липкости" на стыках тайлов
        const eps = 0.5;
        const x1 = Math.floor((x + eps) / TILE_SIZE);
        const x2 = Math.floor((x + w - eps) / TILE_SIZE);
        const y1 = Math.floor((y + eps) / TILE_SIZE);
        const y2 = Math.floor((y + h - eps) / TILE_SIZE);
        for (let r = y1; r <= y2; r++) {
            for (let c = x1; c <= x2; c++) {
                if (r >= 0 && r < MAP_ROWS && c >= 0 && c < MAP_COLS) {
                    if (this.tiles[r][c] !== Tile.EMPTY) return true;
                }
            }
        }
        return false;
    }
    draw(ctx) {
        for (let r = 0; r < MAP_ROWS; r++) {
            for (let c = 0; c < MAP_COLS; c++) {
                if (this.tiles[r][c] === Tile.EMPTY) continue;
                const x = c * TILE_SIZE, y = r * TILE_SIZE;
                if (this.tiles[r][c] === Tile.BRICK) {
                    ctx.fillStyle = '#a52a2a'; ctx.fillRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                    ctx.strokeStyle = '#5d1a1a'; ctx.strokeRect(x + 2, y + 2, TILE_SIZE - 4, TILE_SIZE - 4);
                } else {
                    ctx.fillStyle = '#999'; ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
                    ctx.strokeStyle = '#eee'; ctx.strokeRect(x + 5, y + 5, TILE_SIZE - 10, TILE_SIZE - 10);
                }
            }
        }
    }
}

class Base {
    constructor() {
        this.width = TILE_SIZE; this.height = TILE_SIZE;
        this.x = Math.floor(MAP_COLS / 2) * TILE_SIZE; this.y = (MAP_ROWS - 2) * TILE_SIZE;
        this.alive = true;
    }
    destroy() { if (this.alive) { this.alive = false; sounds.playExplosion(); gameOver(); } }
    draw(ctx) {
        ctx.fillStyle = this.alive ? '#ffd700' : '#333';
        ctx.beginPath(); ctx.moveTo(this.x + 20, this.y + 5); ctx.lineTo(this.x + 35, this.y + 35);
        ctx.lineTo(this.x + 5, this.y + 35); ctx.closePath(); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.stroke();
    }
}

class WaveManager {
    constructor() { this.wave = 0; this.toSpawn = 0; this.timer = 0; }
    update(dt) {
        if (this.toSpawn > 0) {
            this.timer -= dt;
            if (this.timer <= 0) { this.spawn(); this.timer = 2; this.toSpawn--; }
        } else if (enemies.length === 0) { this.wave++; this.toSpawn = 3 + this.wave * 2; this.timer = 3; }
    }
    spawn() {
        const points = [{x: 40, y: 40}, {x: canvas.width / 2 - 20, y: 40}, {x: canvas.width - 80, y: 40}];
        const p = points[Math.floor(Math.random() * points.length)];
        const types = ['normal', 'fast', 'armored'];
        const type = types[Math.floor(Math.random() * Math.min(types.length, this.wave))];
        enemies.push(new Enemy(p.x, p.y, type));
    }
}

class PowerUp {
    constructor(x, y, type) {
        this.x = x; this.y = y; this.width = 30; this.height = 30;
        this.type = type; this.active = true; this.timer = 10;
    }
    update(dt) { this.timer -= dt; if (this.timer <= 0) this.active = false; }
    apply(p) {
        sounds.playPowerup();
        switch(this.type) {
            case 'shield': p.shieldTimer = 10; break;
            case 'life': p.lives++; break;
            case 'rapid': p.shootCooldown = 0.25; setTimeout(() => { p.shootCooldown = 0.6; }, 10000); break;
            case 'freeze': enemiesFrozenTimer = 5; break;
        }
    }
    draw(ctx) {
        const colors = { shield: '#00f', life: '#f0f', rapid: '#f00', freeze: '#0ff' };
        ctx.fillStyle = colors[this.type] || '#ff0';
        ctx.beginPath(); ctx.arc(this.x + 15, this.y + 15, 14, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.stroke();
        ctx.fillStyle = '#fff'; ctx.font = 'bold 14px Arial'; ctx.textAlign = 'center';
        ctx.fillText(this.type[0].toUpperCase(), this.x + 15, this.y + 20);
    }
}

// --- Глобальные переменные и управление ---
let player, map, base, waveManager;
let bullets = [], enemies = [], powerUps = [];
let currentGameState = GameState.MENU;
let keys = {};
let lastTime = 0;

window.addEventListener('keydown', e => keys[e.code] = true);
window.addEventListener('keyup', e => keys[e.code] = false);

// Мобильное управление
const mobileBtns = { 'btn-up': 'ArrowUp', 'btn-down': 'ArrowDown', 'btn-left': 'ArrowLeft', 'btn-right': 'ArrowRight', 'btn-shoot': 'Space' };
Object.keys(mobileBtns).forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
        const start = (e) => { e.preventDefault(); keys[mobileBtns[id]] = true; };
        const end = (e) => { e.preventDefault(); keys[mobileBtns[id]] = false; };
        btn.addEventListener('touchstart', start); btn.addEventListener('touchend', end);
        btn.addEventListener('mousedown', () => keys[mobileBtns[id]] = true);
        btn.addEventListener('mouseup', () => keys[mobileBtns[id]] = false);
        btn.addEventListener('mouseleave', () => keys[mobileBtns[id]] = false);
    }
});

const fullscreenBtn = document.getElementById('fullscreen-btn');
fullscreenBtn.onclick = () => {
    if (!document.fullscreenElement) document.getElementById('game-container').requestFullscreen();
    else document.exitFullscreen();
};

document.getElementById('start-button').addEventListener('click', startGame);
document.getElementById('restart-button').addEventListener('click', startGame);

function resizeCanvas() {
    const ratio = canvas.width / canvas.height;
    if (window.innerWidth / window.innerHeight > ratio) {
        canvas.style.width = (window.innerHeight * ratio) + 'px'; canvas.style.height = window.innerHeight + 'px';
    } else {
        canvas.style.width = window.innerWidth + 'px'; canvas.style.height = (window.innerWidth / ratio) + 'px';
    }
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

function startGame() {
    // Порядок критичен: сначала карта и база, потом игрок (для respawn)
    map = new GameMap();
    base = new Base();
    player = new Player(); // Player.respawn() использует base.x и base.y
    waveManager = new WaveManager();
    
    bullets = [];
    enemies = [];
    powerUps = [];
    enemiesFrozenTimer = 0;
    
    currentGameState = GameState.PLAYING;
    document.getElementById('menu-screen').classList.add('hidden');
    document.getElementById('game-over-screen').classList.add('hidden');
    if (sounds.ctx.state === 'suspended') sounds.ctx.resume();
}

function gameOver() {
    currentGameState = GameState.GAME_OVER;
    document.getElementById('game-over-screen').classList.remove('hidden');
    document.getElementById('final-score').innerText = `SCORE: ${player.score}`;
    sounds.playGameOver();
}

function update(dt) {
    if (currentGameState !== GameState.PLAYING) return;
    player.update(dt); waveManager.update(dt);
    if (enemiesFrozenTimer > 0) enemiesFrozenTimer -= dt;
    bullets.forEach(b => b.update(dt)); enemies.forEach(e => e.update(dt)); powerUps.forEach(p => p.update(dt));

    bullets.forEach(b => {
        if (!b.active) return;
        if (b.ownerType === 'player') {
            enemies.forEach(e => {
                if (e.active && rectIntersect(b.x-3, b.y-3, 6, 6, e.x, e.y, e.width, e.height)) {
                    b.active = false; e.health--;
                    if (e.health <= 0) {
                        e.active = false; player.score += 100; sounds.playExplosion();
                        if (Math.random() < 0.2) {
                            const types = ['shield', 'life', 'rapid', 'freeze'];
                            powerUps.push(new PowerUp(e.x, e.y, types[Math.floor(Math.random()*4)]));
                        }
                    }
                }
            });
        } else {
            if (player.shieldTimer <= 0 && rectIntersect(b.x-3, b.y-3, 6, 6, player.x, player.y, player.width, player.height)) {
                b.active = false; player.lives--; sounds.playExplosion();
                if (player.lives <= 0) gameOver(); else player.respawn();
            }
        }
    });
    bullets = bullets.filter(b => b.active); enemies = enemies.filter(e => e.active); powerUps = powerUps.filter(p => p.active);
    powerUps.forEach(p => { if (p.active && rectIntersect(player.x, player.y, player.width, player.height, p.x, p.y, p.width, p.height)) { p.apply(player); p.active = false; } });

    // --- Визуальные эффекты ---
    if (enemiesFrozenTimer > 0) {
        // Визуальный эффект "заморозки" врагов (анимированный лед)
        enemies.forEach(e => {
            if (e.active) {
                // Анимированный "лед" вокруг врага
                ctx.save();
                ctx.globalAlpha = 0.5;
                ctx.fillStyle = '#e0f7fa'; // PaleTurquoise
                ctx.fillRect(e.x - 2, e.y - 2, e.width + 4, e.height + 4);
                ctx.restore();
            }
        });
    }
}

// --- Вспомогательные функции для цвета ---
function lightenColor(color, percent) {
    const num = parseInt(color.slice(1), 16);
    const amt = Math.round(2.55 * percent);
    const R = (num >> 16) + amt;
    const G = (num >> 8 & 0x00FF) + amt;
    const B = (num & 0x0000FF) + amt;
    return `#${(
        0x1000000 +
        (R < 255 ? (R < 1 ? 0 : R) : 255) * 0x10000 +
        (G < 255 ? (G < 1 ? 0 : G) : 255) * 0x100 +
        (B < 255 ? (B < 1 ? 0 : B) : 255)
    ).toString(16).slice(1)}`;
}

function shadeColor(color, percent) {
    const f = parseInt(color.slice(1), 16);
    const t = percent < 0 ? 0 : 255;
    const p = percent < 0 ? percent * -1 : percent;
    const R = f >> 16;
    const G = f >> 8 & 0x00FF;
    const B = f & 0x0000FF;
    return `#${(
        0x1000000 +
        (Math.round((t - R) * p) + R) * 0x10000 +
        (Math.round((t - G) * p) + G) * 0x100 +
        (Math.round((t - B) * p) + B)
    ).toString(16).slice(1)}`;
}

function draw() {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (currentGameState === GameState.PLAYING || currentGameState === GameState.GAME_OVER) {
        map.draw(ctx); base.draw(ctx); powerUps.forEach(p => p.draw(ctx));
        player.draw(ctx); enemies.forEach(e => e.draw(ctx)); bullets.forEach(b => b.draw(ctx));
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(0, 0, canvas.width, 40);
        ctx.fillStyle = '#ffd700'; ctx.font = 'bold 18px Arial'; ctx.textAlign = 'left';
        ctx.fillText(`🛡️ LIVES: ${player.lives}`, 20, 26); ctx.fillText(`⭐ SCORE: ${player.score}`, 150, 26);
        ctx.textAlign = 'right'; ctx.fillText(`🌊 WAVE: ${waveManager.wave}`, canvas.width - 180, 26);
        ctx.fillText(`💀 ENEMIES: ${enemies.length + waveManager.toSpawn}`, canvas.width - 20, 26);
    }
}

function loop(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1); lastTime = timestamp;
    update(dt); draw(); requestAnimationFrame(loop);
}
requestAnimationFrame(loop);