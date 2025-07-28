import express from 'express';
import { Server } from 'socket.io';
import { createServer } from 'http';

const app = express();

// CORREGIDO: Usar el puerto correcto para Railway
const PORT = process.env.PORT || 3001;
const HOST = '0.0.0.0'; // IMPORTANTE: Escuchar en todas las interfaces

// --- Detección de entorno robusta para CORS ---
const isRailway = !!process.env.RAILWAY_STATIC_URL;
const isVercel = !!process.env.VERCEL;
const isLocal = !isRailway && !isVercel;

console.log('NODE_ENV:', process.env.NODE_ENV, 'isLocal:', isLocal, 'isRailway:', isRailway, 'isVercel:', isVercel);

// --- Helper para aceptar previews de Vercel ---
function isAllowedOrigin(origin) {
  if (!origin) return false;
  // Permitir todos los *.vercel.app
  if (/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(origin)) return true;
  // Permitir los orígenes definidos en CORS_ORIGIN
  if (process.env.CORS_ORIGIN && process.env.CORS_ORIGIN.split(",").includes(origin)) return true;
  return false;
}

const server = createServer(app);

// --- Configuración de Socket.IO con CORS dinámico y automatización de previews ---
const io = new Server(server, {
  cors: isLocal
    ? { origin: "*" }
    : {
        origin: (origin, callback) => {
  console.log("[CORS] Origin recibido en callback:", origin);
  if (isAllowedOrigin(origin)) {
    console.log("[CORS] Origin PERMITIDO:", origin);
    callback(null, true);
  } else {
    console.log("[CORS] Origin RECHAZADO:", origin);
    callback(new Error("Not allowed by CORS"));
  }
},
        methods: ["GET", "POST"],
        credentials: true,
      },
  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,
    skipMiddlewares: true
  },
});

// Variables para control de intervalos
let gameLoopInterval = null;
let gameTimer = null;

// Estado del juego
let gameState = {
  player1: null,
  player2: null,
  player1Keys: {},
  player2Keys: {},
  player1IsMobile: false,
  player2IsMobile: false,
  game: {
    player1: {
      x: 100, y: 300, hp: 100, maxHp: 100, facing: 'right',
      isAttacking: false, isBlocking: false, isJumping: false,
      jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
    },
    player2: {
      x: 600, y: 300, hp: 100, maxHp: 100, facing: 'left',
      isAttacking: false, isBlocking: false, isJumping: false,
      jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
    },
    gameStarted: false,
    winner: null,
    round: 1,
    timer: 90
  }
};

// CORREGIDO: Ruta de salud para Railway
app.get('/', (req, res) => {
  const host = req.get('host') || `localhost:${PORT}`;
  res.status(200).json({
    status: 'online',
    message: 'Servidor Street Fighter funcionando',
    timestamp: new Date().toISOString(),
    port: PORT,
    socket: `wss://${host}`, // Usar wss para HTTPS
    players: {
      player1: !!gameState.player1,
      player2: !!gameState.player2,
      total: (gameState.player1 ? 1 : 0) + (gameState.player2 ? 1 : 0)
    },
    gameStatus: gameState.game.gameStarted ? 'running' : 'waiting'
  });
});

// NUEVO: Ruta de health check adicional
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// NUEVO: Ruta para obtener estado del juego
app.get('/api/game-state', (req, res) => {
  res.status(200).json({
    players: {
      player1Connected: !!gameState.player1,
      player2Connected: !!gameState.player2,
      total: (gameState.player1 ? 1 : 0) + (gameState.player2 ? 1 : 0)
    },
    gameState: gameState.game
  });
});

// Funciones de broadcast mejoradas
const broadcastPlayersUpdate = () => {
  const connectedPlayers = 
    (gameState.player1 ? 1 : 0) + (gameState.player2 ? 1 : 0);
  
  io.emit("playersUpdate", {
    player1Connected: !!gameState.player1,
    player2Connected: !!gameState.player2,
    total: connectedPlayers,
    gameStatus: gameState.game.gameStarted ? 'running' : 'waiting'
  });
};

const broadcastGameState = () => {
  if (!gameState.game) return;
  try {
    io.emit("gameStateUpdate", gameState.game);
  } catch (error) {
    console.error("Error broadcasting game state:", error);
  }
};

// Función de ataque optimizada
const performAttack = (attacker, defender, type = 'normal') => {
  const distance = Math.abs(attacker.x - defender.x);
  if (distance < 80) {
    let damage = type === 'special' ? 25 : 15;
    if (attacker.combo > 0) damage += Math.floor(attacker.combo * 2);

    if (defender.isBlocking) {
      damage *= 0.3;
      return { hp: Math.max(0, defender.hp - damage), breakCombo: true };
    }
    return { hp: Math.max(0, defender.hp - damage), breakCombo: false };
  }
  return { hp: defender.hp, breakCombo: false };
};

// Game loop con manejo de errores
const gameLoop = () => {
  try {
    if (!gameState.game.gameStarted || gameState.game.winner) return;

    const newGame = { ...gameState.game };

    // Procesamiento de inputs del jugador 1
    const p1Keys = gameState.player1Keys || {};
    // --- Diferenciar lógica móvil/PC ---
    if (gameState.player1IsMobile) {
      // Movimiento por toque único (solo un paso por input)
      if (p1Keys['a'] && newGame.player1.x > 50) {
        newGame.player1.x -= 5;
        gameState.player1Keys['a'] = false;
      }
      if (p1Keys['d'] && newGame.player1.x < 720) {
        newGame.player1.x += 5;
        gameState.player1Keys['d'] = false;
      }
      // Salto de toque único
      if (p1Keys['w'] && !newGame.player1.isJumping) {
        newGame.player1.isJumping = true;
        newGame.player1.jumpVelocity = -15;
        gameState.player1Keys['w'] = false;
      }
      // Bloqueo de toque único
      if (p1Keys['g']) {
        newGame.player1.isBlocking = true;
        gameState.player1Keys['g'] = false;
      } else {
        newGame.player1.isBlocking = false;
      }
      // Ataque normal de toque único
      if (p1Keys['f'] && !newGame.player1.isAttacking) {
        newGame.player1.isAttacking = true;
        newGame.player1.lastAttackTime = Date.now();
        const result = performAttack(newGame.player1, newGame.player2);
        newGame.player2.hp = result.hp;
        newGame.player1.combo = result.breakCombo ? 0 : newGame.player1.combo + 1;
        setTimeout(() => { newGame.player1.isAttacking = false; broadcastGameState(); }, 200);
        gameState.player1Keys['f'] = false;
      }
      // Especial de toque único
      if (p1Keys['h'] && newGame.player1.special >= 100 && !newGame.player1.isAttacking) {
        newGame.player1.isAttacking = true;
        newGame.player1.lastAttackTime = Date.now();
        const result = performAttack(newGame.player1, newGame.player2, 'special');
        newGame.player2.hp = result.hp;
        newGame.player1.combo = result.breakCombo ? 0 : newGame.player1.combo + 1;
        newGame.player1.special = 0;
        setTimeout(() => { newGame.player1.isAttacking = false; broadcastGameState(); }, 400);
        gameState.player1Keys['h'] = false;
      }
    } else {
      // --- PC: movimiento/ataque continuo mientras la tecla esté pulsada ---
      if (p1Keys['a'] && newGame.player1.x > 50) {
        newGame.player1.x -= 5;
      }
      if (p1Keys['d'] && newGame.player1.x < 720) {
        newGame.player1.x += 5;
      }
      if (p1Keys['w'] && !newGame.player1.isJumping) {
        newGame.player1.isJumping = true;
        newGame.player1.jumpVelocity = -15;
      }
      if (p1Keys['g']) {
        newGame.player1.isBlocking = true;
      } else {
        newGame.player1.isBlocking = false;
      }
      if (p1Keys['f'] && !newGame.player1.isAttacking) {
        newGame.player1.isAttacking = true;
        newGame.player1.lastAttackTime = Date.now();
        const result = performAttack(newGame.player1, newGame.player2);
        newGame.player2.hp = result.hp;
        newGame.player1.combo = result.breakCombo ? 0 : newGame.player1.combo + 1;
        setTimeout(() => { newGame.player1.isAttacking = false; broadcastGameState(); }, 200);
      }
      if (p1Keys['h'] && newGame.player1.special >= 100 && !newGame.player1.isAttacking) {
        newGame.player1.isAttacking = true;
        newGame.player1.lastAttackTime = Date.now();
        const result = performAttack(newGame.player1, newGame.player2, 'special');
        newGame.player2.hp = result.hp;
        newGame.player1.combo = result.breakCombo ? 0 : newGame.player1.combo + 1;
        newGame.player1.special = 0;
        setTimeout(() => { newGame.player1.isAttacking = false; broadcastGameState(); }, 400);
      }
    }
    // Procesamiento de inputs del jugador 2 (idéntico, adaptado a isMobile)
    const p2Keys = gameState.player2Keys || {};
    if (gameState.player2IsMobile) {
      if (p2Keys['a'] && newGame.player2.x > 50) {
        newGame.player2.x -= 5;
        gameState.player2Keys['a'] = false;
      }
      if (p2Keys['d'] && newGame.player2.x < 720) {
        newGame.player2.x += 5;
        gameState.player2Keys['d'] = false;
      }
      if (p2Keys['w'] && !newGame.player2.isJumping) {
        newGame.player2.isJumping = true;
        newGame.player2.jumpVelocity = -15;
        gameState.player2Keys['w'] = false;
      }
      if (p2Keys['g']) {
        newGame.player2.isBlocking = true;
        gameState.player2Keys['g'] = false;
      } else {
        newGame.player2.isBlocking = false;
      }
      if (p2Keys['f'] && !newGame.player2.isAttacking) {
        newGame.player2.isAttacking = true;
        newGame.player2.lastAttackTime = Date.now();
        const result = performAttack(newGame.player2, newGame.player1);
        newGame.player1.hp = result.hp;
        newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
        setTimeout(() => { newGame.player2.isAttacking = false; broadcastGameState(); }, 200);
        gameState.player2Keys['f'] = false;
      }
      if (p2Keys['h'] && newGame.player2.special >= 100 && !newGame.player2.isAttacking) {
        newGame.player2.isAttacking = true;
        newGame.player2.lastAttackTime = Date.now();
        const result = performAttack(newGame.player2, newGame.player1, 'special');
        newGame.player1.hp = result.hp;
        newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
        newGame.player2.special = 0;
        setTimeout(() => { newGame.player2.isAttacking = false; broadcastGameState(); }, 400);
        gameState.player2Keys['h'] = false;
      }
    } else {
      if (p2Keys['a'] && newGame.player2.x > 50) {
        newGame.player2.x -= 5;
      }
      if (p2Keys['d'] && newGame.player2.x < 720) {
        newGame.player2.x += 5;
      }
      if (p2Keys['w'] && !newGame.player2.isJumping) {
        newGame.player2.isJumping = true;
        newGame.player2.jumpVelocity = -15;
      }
      if (p2Keys['g']) {
        newGame.player2.isBlocking = true;
      } else {
        newGame.player2.isBlocking = false;
      }
      if (p2Keys['f'] && !newGame.player2.isAttacking) {
        newGame.player2.isAttacking = true;
        newGame.player2.lastAttackTime = Date.now();
        const result = performAttack(newGame.player2, newGame.player1);
        newGame.player1.hp = result.hp;
        newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
        setTimeout(() => { newGame.player2.isAttacking = false; broadcastGameState(); }, 200);
      }
      if (p2Keys['h'] && newGame.player2.special >= 100 && !newGame.player2.isAttacking) {
        newGame.player2.isAttacking = true;
        newGame.player2.lastAttackTime = Date.now();
        const result = performAttack(newGame.player2, newGame.player1, 'special');
        newGame.player1.hp = result.hp;
        newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
        newGame.player2.special = 0;
        setTimeout(() => { newGame.player2.isAttacking = false; broadcastGameState(); }, 400);
      }
    }
    if (p1Keys['h'] && newGame.player1.special >= 50) {
      newGame.player1.special -= 50;
      const result = performAttack(newGame.player1, newGame.player2, 'special');
      newGame.player2.hp = result.hp;
      newGame.player1.combo += 1;
      gameState.player1Keys['h'] = false;
    }

    // Procesamiento de inputs del jugador 2
    // Ya declarado arriba: const p2Keys = gameState.player2Keys || {};
    // Movimiento por toque único (solo un paso por input)
    if (p2Keys['arrowleft'] && newGame.player2.x > 50) {
      newGame.player2.x -= 5;
      gameState.player2Keys['arrowleft'] = false;
    }
    if (p2Keys['arrowright'] && newGame.player2.x < 720) {
      newGame.player2.x += 5;
      gameState.player2Keys['arrowright'] = false;
    }
    // Salto de toque único
    if (p2Keys['arrowup'] && !newGame.player2.isJumping) {
      newGame.player2.isJumping = true;
      newGame.player2.jumpVelocity = -15;
      gameState.player2Keys['arrowup'] = false;
    }
    // Bloqueo de toque único
    if (p2Keys['2']) {
      newGame.player2.isBlocking = true;
      gameState.player2Keys['2'] = false;
    } else {
      newGame.player2.isBlocking = false;
    }
    newGame.player2.facing = p2Keys['arrowleft'] ? 'left' : p2Keys['arrowright'] ? 'right' : newGame.player2.facing;

    // Ataque normal de toque único
    if (p2Keys['1'] && !newGame.player2.isAttacking) {
      newGame.player2.isAttacking = true;
      const result = performAttack(newGame.player2, newGame.player1);
      newGame.player1.hp = result.hp;
      newGame.player2.combo = result.breakCombo ? 0 : newGame.player2.combo + 1;
      setTimeout(() => {
        gameState.game.player2.isAttacking = false;
        broadcastGameState();
      }, 200);
      gameState.player2Keys['1'] = false;
    }
    // Especial de toque único
    if (p2Keys['3'] && newGame.player2.special >= 50) {
      newGame.player2.special -= 50;
      const result = performAttack(newGame.player2, newGame.player1, 'special');
      newGame.player1.hp = result.hp;
      newGame.player2.combo += 1;
      gameState.player2Keys['3'] = false;
    }

    // Física del juego
    [newGame.player1, newGame.player2].forEach(player => {
      if (player.isJumping) {
        player.y += player.jumpVelocity;
        player.jumpVelocity += 1;
        if (player.y >= 300) {
          player.y = 300;
          player.isJumping = false;
          player.jumpVelocity = 0;
        }
      }
    });

    // Regeneración de energía
    newGame.player1.special = Math.min(100, newGame.player1.special + 0.5);
    newGame.player2.special = Math.min(100, newGame.player2.special + 0.5);

    // Reset de combos
    const now = Date.now();
    if (now - newGame.player1.lastAttackTime > 2000) newGame.player1.combo = 0;
    if (now - newGame.player2.lastAttackTime > 2000) newGame.player2.combo = 0;

    // Verificación de ganador
    if (newGame.player1.hp <= 0) newGame.winner = 'Player 2';
    else if (newGame.player2.hp <= 0) newGame.winner = 'Player 1';

    gameState.game = newGame;
    broadcastGameState();

  } catch (error) {
    console.error("Error in game loop:", error);
  }
};

// Timer del juego mejorado
const startGameTimer = () => {
  if (gameTimer) clearInterval(gameTimer);
  
  gameTimer = setInterval(() => {
    if (gameState.game.gameStarted && !gameState.game.winner) {
      gameState.game.timer -= 1;
      
      if (gameState.game.timer <= 0) {
        gameState.game.winner = 
          gameState.game.player1.hp > gameState.game.player2.hp ? 'Player 1' :
          gameState.game.player2.hp > gameState.game.player1.hp ? 'Player 2' : 'Draw';
        gameState.game.timer = 0;
        clearInterval(gameTimer);
      }
      
      broadcastGameState();
    }
  }, 1000);
};

// Iniciar game loop con seguridad
const startGameLoop = () => {
  if (gameLoopInterval) clearInterval(gameLoopInterval);
  gameLoopInterval = setInterval(gameLoop, 16);
};

// Manejo de conexiones Socket.IO (actualizado)
io.on("connection", (socket) => {
  console.log(`[${new Date().toISOString()}] Nuevo cliente conectado: ${socket.id}`);

  // Asignación de jugador clásica
  if (!gameState.player1) {
    gameState.player1 = socket.id;
    socket.emit("assignPlayer", {
      role: "player1",
      controls: {
        left: "a", right: "d", jump: "w",
        attack: "f", block: "g", special: "h"
      },
      position: "left"
    });
    console.log(`Jugador 1 asignado: ${socket.id}`);
  } else if (!gameState.player2) {
    gameState.player2 = socket.id;
    socket.emit("assignPlayer", {
      role: "player2",
      controls: {
        left: "a", right: "d", jump: "w",
        attack: "f", block: "g", special: "h"
      },
      position: "right"
    });
    console.log(`Jugador 2 asignado: ${socket.id}`);
  } else {
    socket.emit("assignPlayer", { role: "spectator" });
    console.log(`Espectador conectado: ${socket.id}`);
  }

  // Enviar estado inicial
  broadcastPlayersUpdate();
  socket.emit("gameStateUpdate", gameState.game);

  // Manejo de acciones (actualizado para coincidir con frontend)
  socket.on("playerAction", (keys) => {
    if (socket.id === gameState.player1) {
      gameState.player1Keys = keys.keys;
      gameState.player1IsMobile = !!keys.isMobile;
    } else if (socket.id === gameState.player2) {
      gameState.player2Keys = keys.keys;
      gameState.player2IsMobile = !!keys.isMobile;
    }
  });

  // Inicio del juego con validación
  socket.on("startGame", () => {
    if ((socket.id !== gameState.player1 && socket.id !== gameState.player2) || 
        (gameState.game.gameStarted && !gameState.game.winner)) {
      return;
    }

    console.log(`Juego iniciado por: ${socket.id}`);
    
    // Limpiar intervalos previos
    clearInterval(gameLoopInterval);
    clearInterval(gameTimer);

    // Reiniciar estado del juego
    gameState.game = {
      player1: {
        x: 100, y: 300, hp: 100, maxHp: 100, facing: 'right',
        isAttacking: false, isBlocking: false, isJumping: false,
        jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
      },
      player2: {
        x: 600, y: 300, hp: 100, maxHp: 100, facing: 'left',
        isAttacking: false, isBlocking: false, isJumping: false,
        jumpVelocity: 0, combo: 0, special: 100, lastAttackTime: 0
      },
      gameStarted: true,
      winner: null,
      round: 1,
      timer: 90
    };

    startGameLoop();
    startGameTimer();
    broadcastGameState();
  });

  // Manejo de desconexión robusto
  socket.on("disconnect", () => {
    console.log(`[${new Date().toISOString()}] Cliente desconectado: ${socket.id}`);

    if (socket.id === gameState.player1) {
      gameState.player1 = null;
      gameState.player1Keys = {};
      console.log("Jugador 1 desconectado - espacio liberado");
    } else if (socket.id === gameState.player2) {
      gameState.player2 = null;
      gameState.player2Keys = {};
      console.log("Jugador 2 desconectado - espacio liberado");
    }

    // Pausar juego si estaba activo
    if (gameState.game.gameStarted) {
      gameState.game.gameStarted = false;
      clearInterval(gameLoopInterval);
      clearInterval(gameTimer);
      console.log("Juego pausado por desconexión");
    }

    broadcastPlayersUpdate();
    broadcastGameState();
  });

  // Manejo de errores de socket
  socket.on("error", (error) => {
    console.error(`Error de socket (${socket.id}):`, error);
  });
});

// CORREGIDO: Inicio del servidor con HOST específico
server.listen(PORT, HOST, () => {
  console.log(`🟢 Servidor iniciado en puerto ${PORT}`);
  console.log(`🔗 URL HTTP: http://${HOST}:${PORT}`);
  console.log(`🔌 WebSocket: ws://${HOST}:${PORT}`);
  console.log(`🌍 Servidor escuchando en todas las interfaces (${HOST})`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Error: El puerto ${PORT} está en uso`);
    console.log('👉 Soluciones:');
    console.log(`1. Cambia el puerto en las variables de entorno (ahora usando ${PORT})`);
    console.log('2. Ejecuta: npx kill-port 8080');
    console.log('3. Espera 1-2 minutos y vuelve a intentar');
  } else {
    console.error('Error al iniciar el servidor:', err);
  }
  process.exit(1);
});

// Manejo de errores global
process.on('uncaughtException', (error) => {
  console.error('⚠️ Excepción no capturada:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('⚠️ Rechazo no manejado en:', promise, 'razón:', reason);
});